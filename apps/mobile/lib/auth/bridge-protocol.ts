// 버전드 양방향 브리지 프로토콜 (SPEC-MOBILE-002 R-T1, AC-T1) — forward-compat 가드레일 2.
//
// Native↔Web 토큰 동기화 메시지의 버전드/확장 가능 스키마 `{ version, type, payload? }` 와 그 직렬화/
// 파싱·페이로드 빌더·수신 분기 결정을 제공한다. expo/RN import 가 전혀 없는 순수 모듈이다
// (oauth-bridge.ts 패턴) — vitest node 환경에서 mock 없이 단위 테스트한다.
//
// 동일 스키마를 apps/web 브리지 모듈도 사용한다(인라인 동등 구현). 신규 type/필드 추가가 additive 가
// 되도록 unknown type 은 양쪽에서 안전히 무시하고(throw 없음), version 불일치는 graceful degrade 한다.
//
// PII 최소화(OD-4): payload 는 access/refresh 토큰만 담는다 — userId/프로필은 절대 싣지 않는다.
// 네이티브가 사용자 식별자가 필요하면 access token 의 JWT `sub` 를 디코드한다(브리지를 가로지르는 PII 0).
//
// 보안(SPEC-MOBILE-002 v0.2.0 — C-1/H-1/OD-11): 모든 메시지(양방향)는 per-session one-time nonce 를
// envelope 에 싣는다. 네이티브가 cold-start 시 신뢰 origin 채널로 nonce 를 1회 주입하고, 이후 모든
// 브리지 메시지가 그 nonce 를 포함한다. 수신 측(웹/네이티브)은 nonce 를 상수시간 비교로 검증해
// foreign-origin/미인증(스키마는 맞으나 nonce 불일치) 메시지를 거부한다 — 동일 page 의 임의 스크립트는
// nonce 를 모르므로 session:restore 위조(세션 고정)나 토큰 탈취가 불가능하다.

/** 스키마 버전. 필드/ type 추가는 additive 이므로 기존 메시지 파싱을 깨지 않는다(OD-6). */
export const BRIDGE_VERSION = 1 as const;

// 보장 type 집합(R-T1 의 5종). const 객체로 고정해 오타를 컴파일 타임에 차단한다(M-3).
// 신규 type 은 이 객체에 additive 로 추가한다.
export const BRIDGE_MESSAGE_TYPES = {
  /** native→web: 저장된 토큰을 웹에 주입(콜드스타트 핸드셰이크 시작 — R-T2). */
  RESTORE: "session:restore",
  /** web→native: setSession 검증/갱신 후 최신 토큰 회신(R-T3 valid/refreshed). */
  SYNCED: "session:synced",
  /** web→native: 세션 없음/만료/예외(R-T3 empty·expired·throw 폴백) — 웹 가드가 /login 으로 라우팅. */
  NONE: "session:none",
  /** web→native: 로그아웃(R-R2) — 네이티브가 SecureStore 클리어. 콜드스타트 결과 아님(M-1). */
  CLEARED: "session:cleared",
  /** native→web: resume 시 토큰 재주입 + 재검증 신호(R-R1). */
  REVALIDATE: "resume:revalidate",
} as const;

/** 보장 message type 의 유니온. */
export type BridgeMessageType =
  (typeof BRIDGE_MESSAGE_TYPES)[keyof typeof BRIDGE_MESSAGE_TYPES];

/** 토큰 페이로드 — access/refresh 만(userId/프로필 미포함 — PII 최소화 OD-4). */
export interface TokenPayload {
  access: string;
  refresh: string;
}

/**
 * 버전드 브리지 메시지. payload 는 토큰을 싣는 type(restore/synced/revalidate)에만 존재한다.
 * none/cleared 는 payload 없는 신호 메시지다. 모든 메시지는 인증용 nonce 를 envelope 에 싣는다(R-T8).
 */
export type BridgeMessage =
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.RESTORE; nonce: string; payload: TokenPayload }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.SYNCED; nonce: string; payload: TokenPayload }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.REVALIDATE; nonce: string; payload: TokenPayload }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.NONE; nonce: string }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.CLEARED; nonce: string };

const KNOWN_TYPES: ReadonlySet<string> = new Set<string>(
  Object.values(BRIDGE_MESSAGE_TYPES),
);

// 토큰 페이로드를 싣는 type 집합(파싱 시 payload 유효성 검사에 사용).
const TOKEN_BEARING_TYPES: ReadonlySet<string> = new Set<string>([
  BRIDGE_MESSAGE_TYPES.RESTORE,
  BRIDGE_MESSAGE_TYPES.SYNCED,
  BRIDGE_MESSAGE_TYPES.REVALIDATE,
]);

/** 토큰 페이로드 형태 가드(access·refresh 가 비어 있지 않은 문자열). */
function isValidTokenPayload(value: unknown): value is TokenPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return typeof p.access === "string" && !!p.access && typeof p.refresh === "string" && !!p.refresh;
}

/** 브리지 메시지를 postMessage 로 보낼 JSON 문자열로 직렬화한다. */
export function serializeBridgeMessage(message: BridgeMessage): string {
  return JSON.stringify(message);
}

/**
 * postMessage 로 받은 원시 문자열을 BridgeMessage 로 파싱한다(R-T1/R-T8/OD-6).
 *
 * 방어적: JSON 파싱 실패, version 누락/비숫자, type 누락, unknown type(오타 포함), nonce 누락/비문자열,
 * 토큰 type 인데 payload 불완전 — 이 모든 경우 throw 하지 않고 null 을 반환한다(메시지 안전 무시).
 * nonce 가 비어 있지 않은 문자열로 존재해야 통과한다(R-T8: 미인증 메시지는 envelope 단계에서 거부).
 * 알려진 type 만 정확히 round-trip 한다.
 *
 * 주의: 여기서는 nonce 의 "존재/형태"만 확인한다. nonce "값" 검증(상수시간 비교)은 decideInboundAction
 * (네이티브 수신)·verifyInboundMessage(웹 수신)가 expected nonce 와 대조해 수행한다.
 *
 * @param raw onMessage 의 nativeEvent.data 또는 웹 message 이벤트 데이터
 * @returns 유효한 BridgeMessage, 그 외 null
 */
export function parseBridgeMessage(raw: string): BridgeMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const candidate = obj as Record<string, unknown>;
  if (typeof candidate.version !== "number") {
    return null; // 비버전드/비숫자 version — graceful degrade.
  }
  if (typeof candidate.type !== "string" || !KNOWN_TYPES.has(candidate.type)) {
    return null; // type 누락/오타/unknown — 안전 무시.
  }
  if (typeof candidate.nonce !== "string" || !candidate.nonce) {
    return null; // nonce 누락/비문자열/빈값 — 미인증 메시지(R-T8) 거부.
  }
  const nonce = candidate.nonce;
  if (TOKEN_BEARING_TYPES.has(candidate.type)) {
    if (!isValidTokenPayload(candidate.payload)) {
      return null; // 토큰 type 인데 payload 불완전 — 무시.
    }
    return {
      version: candidate.version,
      type: candidate.type as TokenPayload extends never ? never : typeof candidate.type,
      nonce,
      payload: { access: candidate.payload.access, refresh: candidate.payload.refresh },
    } as BridgeMessage;
  }
  // none/cleared — payload 없는 신호 메시지.
  return { version: candidate.version, type: candidate.type, nonce } as BridgeMessage;
}

/** 콜드스타트 토큰 주입용 session:restore 메시지를 만든다(R-T2/R-T8, 토큰+nonce — PII 최소화). */
export function buildRestoreMessage(
  tokens: TokenPayload,
  nonce: string,
): {
  version: number;
  type: typeof BRIDGE_MESSAGE_TYPES.RESTORE;
  nonce: string;
  payload: TokenPayload;
} {
  return {
    version: BRIDGE_VERSION,
    type: BRIDGE_MESSAGE_TYPES.RESTORE,
    nonce,
    payload: { access: tokens.access, refresh: tokens.refresh },
  };
}

/** resume 재검증용 resume:revalidate 메시지를 만든다(R-R1/R-T8, 토큰+nonce — PII 최소화). */
export function buildRevalidateMessage(
  tokens: TokenPayload,
  nonce: string,
): {
  version: number;
  type: typeof BRIDGE_MESSAGE_TYPES.REVALIDATE;
  nonce: string;
  payload: TokenPayload;
} {
  return {
    version: BRIDGE_VERSION,
    type: BRIDGE_MESSAGE_TYPES.REVALIDATE,
    nonce,
    payload: { access: tokens.access, refresh: tokens.refresh },
  };
}

/** 네이티브가 수신 메시지에 대해 취할 행동(순수 결정 — useAuthBridge 가 실행한다). */
export type InboundAction =
  /** session:synced + 유효 토큰 → SecureStore 갱신. resolvesHandshake: 콜드스타트 스플래시 해제 여부. */
  | { kind: "save"; tokens: TokenPayload; resolvesHandshake: true }
  /**
   * session:none(또는 synced 인데 토큰 불완전) → clearTokens + 콜드스타트 종료(R-R4/M-3: stale refresh
   * 잔존 방지), 또는 session:cleared → clearTokens(로그아웃, 콜드스타트 결과 아님 — M-1).
   * resolvesHandshake 로 콜드스타트 결과(none/synced-불완전 = true) vs 로그아웃(cleared = false)을 구분한다.
   *
   * clearCookies (R-R4 (c) — 디바이스 검증 쿠키 부활 결함): session:cleared(명시 로그아웃)에서만 true.
   * 네이티브가 SecureStore clearTokens 에 더해 WebView 쿠키도 제거해야 하는지를 나타낸다 — 웹의 로그아웃
   * 쿠키 삭제가 binarycookies 에 영속되지 않는 갭을 네이티브에서 닫는다. session:none(setSession
   * network-throw 폴백 — R-T3)에는 false: 그 경로는 웹이 세션 권위이며 transient 오류로 유효 쿠키 세션을
   * 파괴하면 안 된다. synced-불완전(none 처럼 처리)도 false.
   */
  | { kind: "clear"; resolvesHandshake: boolean; clearCookies: boolean }
  /** 네이티브 발신 type(restore/revalidate) 수신, 또는 nonce 불일치(미인증) 등 — 무시. */
  | { kind: "ignore" };

/**
 * 두 문자열을 상수시간으로 비교한다(R-T8/OD-11: nonce 검증 — 타이밍 사이드채널 회피).
 *
 * 길이가 다르면 즉시 false(빈 문자열은 항상 false — 미인증 메시지). 길이가 같으면 모든 문자를 XOR
 * 누적해 조기 반환 없이 비교한다 — 일치 위치에 따른 실행시간 차이를 제거한다.
 *
 * @param a 수신 메시지의 nonce
 * @param b expected nonce(cold-start 에 확립한 per-session nonce)
 * @returns 두 값이 비어 있지 않고 정확히 같으면 true
 */
export function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * 웹→네이티브 수신 메시지의 처리 분기를 순수 함수로 결정한다(R-T5/R-R3/R-N4/R-R4 + R-T8 nonce 검증).
 *
 * - nonce 불일치(미인증 메시지) → ignore(부작용 없음 — 위조 session:cleared/synced 차단, C-1).
 * - session:synced + 유효 토큰 → save(SecureStore 갱신) + 콜드스타트 해제.
 * - session:synced 인데 토큰 불완전 / session:none → clear(R-R4/M-3: stale refresh 제거) + 콜드스타트
 *   해제, clearCookies:false(웹이 세션 권위인 폴백 경로 — 유효 쿠키 보존).
 * - session:cleared → clear(로그아웃 클리어) — 콜드스타트 결과 아님(M-1, resolvesHandshake false),
 *   clearCookies:true(R-R4 (c) — 명시 로그아웃에서만 WebView 쿠키도 제거해 부활 차단).
 * - 그 외(네이티브 발신 type 등) → ignore.
 *
 * @param message parseBridgeMessage 가 통과시킨 유효 BridgeMessage
 * @param expectedNonce cold-start 에 확립한 per-session nonce(이와 상수시간 비교해 인증)
 * @returns 네이티브가 실행할 InboundAction
 */
export function decideInboundAction(
  message: BridgeMessage,
  expectedNonce: string,
): InboundAction {
  // R-T8: nonce 인증 실패 메시지는 어떤 부작용도 일으키지 않는다(위조 거부).
  if (!constantTimeEquals(message.nonce, expectedNonce)) {
    return { kind: "ignore" };
  }
  switch (message.type) {
    case BRIDGE_MESSAGE_TYPES.SYNCED:
      if (isValidTokenPayload(message.payload)) {
        return { kind: "save", tokens: message.payload, resolvesHandshake: true };
      }
      // synced 인데 토큰 불완전 — none 처럼 처리(저장 안 함, clear, 콜드스타트 해제 — R-R4).
      // 쿠키는 보존한다(이 경로는 명시 로그아웃이 아님 — clearCookies false).
      return { kind: "clear", resolvesHandshake: true, clearCookies: false };
    case BRIDGE_MESSAGE_TYPES.NONE:
      // R-R4(a)/M-3: none 수신 시 clearTokens 까지 — stale refresh 잔존 방지. 콜드스타트 결과(해제).
      // R-R4 (c): none(setSession network-throw 폴백 포함)에는 쿠키 clear 미적용 — 웹이 세션 권위(R-T3).
      return { kind: "clear", resolvesHandshake: true, clearCookies: false };
    case BRIDGE_MESSAGE_TYPES.CLEARED:
      // R-R4 (c): 명시 로그아웃 — clearTokens + WebView 쿠키 제거(부활 차단). 콜드스타트 결과 아님(M-1).
      return { kind: "clear", resolvesHandshake: false, clearCookies: true };
    default:
      // session:restore / resume:revalidate 등 네이티브 발신 type — 수신 분기에서 무시.
      return { kind: "ignore" };
  }
}
