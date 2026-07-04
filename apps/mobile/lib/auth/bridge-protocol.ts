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
  /**
   * web→native: 셸 안에서 Google 버튼을 탭했을 때 네이티브 Google Sign-In SDK 실행을 요청하는 명령
   * (SPEC-MOBILE-004). 토큰 없는 신호 메시지다 — 외부 브라우저 OAuth 이탈 없이 네이티브 인앱 로그인을
   * 띄우기 위한 결정적 경로(웹의 OAuth 네비게이션 인터셉트 의존 제거). additive type 이므로 v1 유지.
   */
  GOOGLE_SIGNIN_REQUEST: "auth:google-request",
  /**
   * web→native: 초대 수락 페이지에서 로드 시 초대가 무효(미지/만료/폐기)로 판정됐을 때, 네이티브가
   * Alert + 라우팅을 수행하도록 요청하는 명령(SPEC-MOIM-011 후속). payload.loggedIn(실제 계정 세션 여부)에
   * 따라 네이티브가 분기한다: true → "유효하지 않은 초대입니다." Alert → (tabs)/home, false → (auth)/login.
   * 토큰을 싣지 않는다(불리언 신호만 — PII 0). additive type 이므로 v1 유지.
   */
  INVITE_INVALID: "invite:invalid",
  /**
   * web→native: route 변경마다 웹이 자신의 nav 상태(`{pathname, title, canGoBack}`)를 보고하는 명령
   * (SPEC-MOBILE-NAV-001 REQ-MOBNAV-010/011). 네이티브 헤더 바(back chevron 가시성 + 타이틀)를 구동한다.
   * 단일 진실 출처 = 웹 — 네이티브는 이 상태만 소비해 헤더를 그린다. 토큰을 싣지 않는다(PII 0).
   * additive v1 신규 nav 채널 — 기존 세션 타입/nonce 봉투 불변(UNIFY-001 R-U2 공유 채널 계약과 동일).
   */
  NAV_STATE: "nav:state",
  /**
   * native→web: 헤더 back chevron 탭 시 네이티브가 웹에 in-app back 을 위임하는 신호(REQ-MOBNAV-020).
   * 웹이 `router.back()`/`history.back()` 또는 딥링크 첫 진입 시 `/home` 폴백을 결정한다(OD-2/OD-3).
   * 페이로드 없는 신호 메시지 — 네이티브 발신이므로 네이티브 수신 분기(decideInboundAction)에서는 무시된다.
   * additive v1 신규 nav 채널 — 기존 세션 타입/nonce 봉투 불변.
   */
  NAV_BACK: "nav:back",
} as const;

/** 토큰 페이로드 — access/refresh 만(userId/프로필 미포함 — PII 최소화 OD-4). */
export interface TokenPayload {
  access: string;
  refresh: string;
}

/** invite:invalid 페이로드 — 실제 계정 로그인 여부만(토큰/PII 미포함 — OD-4). */
export interface InviteInvalidPayload {
  loggedIn: boolean;
}

/**
 * nav:state 페이로드(SPEC-MOBILE-NAV-001) — 웹이 보고하는 현재 nav 상태.
 * pathname: 현재 웹 route(헤더 필요 페이지 판정 키). title: 컨텍스트 타이틀(모임명 등 — 헤더 표시).
 * canGoBack: in-app back 가능 여부(back chevron 가시성 결정). 토큰/PII 미포함(OD-4).
 */
export interface NavStatePayload {
  pathname: string;
  title: string;
  canGoBack: boolean;
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
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.CLEARED; nonce: string }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST; nonce: string }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.INVITE_INVALID; nonce: string; payload: InviteInvalidPayload }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.NAV_STATE; nonce: string; payload: NavStatePayload }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.NAV_BACK; nonce: string };

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

/** invite:invalid 페이로드 형태 가드(loggedIn 이 boolean). */
function isValidInviteInvalidPayload(value: unknown): value is InviteInvalidPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof (value as Record<string, unknown>).loggedIn === "boolean";
}

/**
 * nav:state 페이로드 형태 가드(pathname 은 비어 있지 않은 문자열, title 은 문자열, canGoBack 은 boolean).
 * pathname 은 라우팅 키라 비어 있으면 안 되지만(항상 최소 "/"), title 은 전이 중 빈 문자열이 유효할 수
 * 있어 non-empty 를 강제하지 않는다(유효 메시지 누락 방지 — REQ-MOBNAV-012).
 */
function isValidNavStatePayload(value: unknown): value is NavStatePayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return (
    typeof p.pathname === "string" &&
    !!p.pathname &&
    typeof p.title === "string" &&
    typeof p.canGoBack === "boolean"
  );
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
  if (candidate.type === BRIDGE_MESSAGE_TYPES.INVITE_INVALID) {
    if (!isValidInviteInvalidPayload(candidate.payload)) {
      return null; // invite:invalid 인데 payload(loggedIn:boolean) 불완전 — 무시.
    }
    return {
      version: candidate.version,
      type: BRIDGE_MESSAGE_TYPES.INVITE_INVALID,
      nonce,
      payload: { loggedIn: candidate.payload.loggedIn },
    };
  }
  if (candidate.type === BRIDGE_MESSAGE_TYPES.NAV_STATE) {
    if (!isValidNavStatePayload(candidate.payload)) {
      return null; // nav:state 인데 payload({pathname,title,canGoBack}) 불완전 — 무시.
    }
    return {
      version: candidate.version,
      type: BRIDGE_MESSAGE_TYPES.NAV_STATE,
      nonce,
      payload: {
        pathname: candidate.payload.pathname,
        title: candidate.payload.title,
        canGoBack: candidate.payload.canGoBack,
      },
    };
  }
  // none/cleared/google-request/nav:back — payload 없는 신호 메시지.
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
  /** auth:google-request(nonce 인증 통과) → 네이티브 Google Sign-In SDK 실행(SPEC-MOBILE-004). */
  | { kind: "google-signin" }
  /**
   * invite:invalid(nonce 인증 통과) → 네이티브 무효 초대 처리(SPEC-MOIM-011 후속).
   * loggedIn(실제 계정 세션 여부)에 따라 호출부가 분기한다: true → Alert → (tabs)/home, false → (auth)/login.
   */
  | { kind: "invite-invalid"; loggedIn: boolean }
  /**
   * nav:state(nonce 인증 통과) → 네이티브 헤더 상태 갱신(SPEC-MOBILE-NAV-001 REQ-MOBNAV-010/011).
   * 호출부가 pathname/title/canGoBack 으로 헤더 바(back chevron 가시성 + 타이틀)를 그린다(단일 진실 출처 = 웹).
   */
  | { kind: "nav-state"; pathname: string; title: string; canGoBack: boolean }
  /** 네이티브 발신 type(restore/revalidate/nav:back) 수신, 또는 nonce 불일치(미인증) 등 — 무시. */
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
// @MX:NOTE: [AUTO] nonce 인증이 모든 인바운드 분기(세션 + nav 채널)의 선행 게이트다 — 위조/미인증 메시지는
// 어떤 부작용도 일으키지 않는다. SPEC-MOBILE-NAV-001 로 nav:state 분기가 additive 로 추가됐고 nav:back(네이티브 발신)은
// default→ignore 로 흡수된다. 새 인바운드 type 추가 시 반드시 nonce 검증 이후 분기에 놓는다.
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
    case BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST:
      // SPEC-MOBILE-004: 셸의 Google 버튼 탭 — 네이티브 Google Sign-In SDK 를 실행한다(nonce 인증 통과분만).
      return { kind: "google-signin" };
    case BRIDGE_MESSAGE_TYPES.INVITE_INVALID:
      // SPEC-MOIM-011 후속: 무효 초대 — loggedIn 에 따라 호출부가 Alert→(tabs)/home 또는 (auth)/login 분기.
      return { kind: "invite-invalid", loggedIn: message.payload.loggedIn };
    case BRIDGE_MESSAGE_TYPES.NAV_STATE:
      // SPEC-MOBILE-NAV-001: 웹 nav 상태 보고 — 호출부가 헤더 바(back chevron + 타이틀)를 갱신한다.
      return {
        kind: "nav-state",
        pathname: message.payload.pathname,
        title: message.payload.title,
        canGoBack: message.payload.canGoBack,
      };
    default:
      // session:restore / resume:revalidate / nav:back 등 네이티브 발신 type — 수신 분기에서 무시.
      return { kind: "ignore" };
  }
}
