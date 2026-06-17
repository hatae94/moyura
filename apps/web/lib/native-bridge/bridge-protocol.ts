// 네이티브↔웹 토큰 동기화 브리지 프로토콜 (SPEC-MOBILE-002 R-T1) — 웹 측 인라인 등가 구현.
//
// apps/mobile/lib/auth/bridge-protocol.ts 와 동일한 버전드 스키마 `{ version, type, payload? }` 를
// 웹에서도 쓴다(모노레포 cross-package import 대신 인라인 등가 — 양측이 같은 wire 포맷에 합의).
// 신규 type/필드 추가가 additive 가 되도록 unknown type 은 무시하고(throw 없음), version 불일치는
// graceful degrade 한다(OD-6).
//
// PII 최소화(OD-4): payload 는 access/refresh 토큰만 — userId/프로필은 절대 싣지 않는다.
//
// 보안(SPEC-MOBILE-002 v0.2.0 — C-1/H-1/OD-11): 모든 메시지가 per-session nonce 를 envelope 에 싣는다.
// 웹은 인바운드 토큰 메시지를 처리하기 전 (1) event.origin === 신뢰 origin, (2) nonce 상수시간 일치를
// 검증한다 — foreign-origin/미인증(스키마는 맞으나 nonce 불일치) session:restore 를 거부해 세션 고정·
// 토큰 탈취를 차단한다. 모바일 bridge-protocol.ts 와 동일한 wire 포맷에 합의한다(인라인 등가).
//
// 이 모듈은 @supabase/* 나 RN 의존이 없는 순수 타입/직렬화 헬퍼다 — bridge-client.ts 가 사용한다.

/** 스키마 버전(모바일 BRIDGE_VERSION 과 일치). */
export const BRIDGE_VERSION = 1 as const;

/** 보장 type 집합(R-T1 의 5종). const 로 고정해 오타를 컴파일 타임에 차단한다(M-3). */
export const BRIDGE_MESSAGE_TYPES = {
  /** native→web: 저장 토큰 주입(콜드스타트 핸드셰이크 시작 — R-T2). */
  RESTORE: "session:restore",
  /** web→native: setSession 검증/갱신 후 최신 토큰 회신(R-T3 valid/refreshed). */
  SYNCED: "session:synced",
  /** web→native: 세션 없음/만료/예외(R-T3 empty·expired·throw 폴백). */
  NONE: "session:none",
  /** web→native: 로그아웃(R-R2). 콜드스타트 결과 아님(M-1). */
  CLEARED: "session:cleared",
  /** native→web: resume 토큰 재주입 + 재검증 신호(R-R1). */
  REVALIDATE: "resume:revalidate",
  /** web→native: 셸 안에서 Google 버튼 탭 시 네이티브 Google Sign-In 실행 요청(SPEC-MOBILE-004, 토큰 없음). */
  GOOGLE_SIGNIN_REQUEST: "auth:google-request",
} as const;

/** 토큰 페이로드 — access/refresh 만(PII 최소화 OD-4). */
export interface TokenPayload {
  access: string;
  refresh: string;
}

const TOKEN_BEARING_TYPES: ReadonlySet<string> = new Set<string>([
  BRIDGE_MESSAGE_TYPES.RESTORE,
  BRIDGE_MESSAGE_TYPES.REVALIDATE,
]);

const KNOWN_INBOUND_TYPES: ReadonlySet<string> = new Set<string>([
  BRIDGE_MESSAGE_TYPES.RESTORE,
  BRIDGE_MESSAGE_TYPES.REVALIDATE,
]);

/** 네이티브가 웹으로 보내는 메시지(웹이 수신/처리하는 type). 모든 메시지는 인증용 nonce 를 싣는다(R-T8). */
export type InboundNativeMessage =
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.RESTORE; nonce: string; payload: TokenPayload }
  | { version: number; type: typeof BRIDGE_MESSAGE_TYPES.REVALIDATE; nonce: string; payload: TokenPayload };

function isValidTokenPayload(value: unknown): value is TokenPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return typeof p.access === "string" && !!p.access && typeof p.refresh === "string" && !!p.refresh;
}

/**
 * 두 문자열을 상수시간으로 비교한다(R-T8/OD-11: nonce 검증 — 타이밍 사이드채널 회피).
 * 모바일 bridge-protocol.ts 의 constantTimeEquals 와 동일 동작(인라인 등가).
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
 * 인바운드 토큰 메시지를 처리하기 전 origin + nonce 인증을 검증한다(R-T8 — C-1/H-1).
 *
 * 스키마 형태(parseInboundMessage)만으로는 발신자 정체성을 검증할 수 없다 — 동일 page 의 임의 스크립트
 * (서드파티/XSS)도 스키마 맞는 메시지를 위조할 수 있다. 따라서 setSession 등 부작용 전에:
 *   1. event.origin === 신뢰 origin(WebView 가 잠긴 WEB_URL origin = window.location.origin).
 *   2. message.nonce === expected nonce(상수시간 비교) — 동일 page 스크립트는 nonce 를 모름.
 * 둘 다 통과해야만 true. 하나라도 실패하면 false(메시지 거부 — setSession 미호출).
 *
 * @param p eventOrigin/trustedOrigin/messageNonce/expectedNonce
 * @returns 인증 통과 시 true
 */
export function verifyInboundMessage(p: {
  eventOrigin: string;
  trustedOrigin: string;
  messageNonce: string;
  expectedNonce: string;
}): boolean {
  if (p.eventOrigin !== p.trustedOrigin) {
    return false; // foreign-origin 메시지 거부.
  }
  return constantTimeEquals(p.messageNonce, p.expectedNonce);
}

/**
 * 네이티브가 보낸 원시 메시지를 InboundNativeMessage 로 파싱한다(R-T1/OD-6).
 *
 * 방어적: JSON 실패, version 비숫자, type 누락/오타/unknown, 토큰 payload 불완전 — 모두 null(안전 무시,
 * throw 없음). 웹이 수신하는 type 은 restore/revalidate 뿐이다(synced/none/cleared 는 웹이 발신).
 *
 * @param raw window message 이벤트의 data(문자열)
 * @returns 유효한 InboundNativeMessage, 그 외 null
 */
export function parseInboundMessage(raw: string): InboundNativeMessage | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const c = obj as Record<string, unknown>;
  if (typeof c.version !== "number") {
    return null;
  }
  if (typeof c.type !== "string" || !KNOWN_INBOUND_TYPES.has(c.type)) {
    return null;
  }
  if (typeof c.nonce !== "string" || !c.nonce) {
    return null; // nonce 누락/비문자열/빈값 — 미인증 메시지(R-T8) 거부.
  }
  if (TOKEN_BEARING_TYPES.has(c.type)) {
    if (!isValidTokenPayload(c.payload)) {
      return null;
    }
    return {
      version: c.version,
      type: c.type as InboundNativeMessage["type"],
      nonce: c.nonce,
      payload: { access: c.payload.access, refresh: c.payload.refresh },
    };
  }
  return null;
}

/** web→native session:synced 메시지를 직렬화한다(최신 토큰 회신 — R-T3, 토큰+nonce). */
export function serializeSyncedMessage(tokens: TokenPayload, nonce: string): string {
  return JSON.stringify({
    version: BRIDGE_VERSION,
    type: BRIDGE_MESSAGE_TYPES.SYNCED,
    nonce,
    payload: { access: tokens.access, refresh: tokens.refresh },
  });
}

/** web→native session:none 메시지를 직렬화한다(empty/expired/throw 폴백 — R-T3, nonce 포함). */
export function serializeNoneMessage(nonce: string): string {
  return JSON.stringify({ version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.NONE, nonce });
}

/** web→native session:cleared 메시지를 직렬화한다(로그아웃 — R-R2, nonce 포함). */
export function serializeClearedMessage(nonce: string): string {
  return JSON.stringify({ version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.CLEARED, nonce });
}

/**
 * web→native auth:google-request 메시지를 직렬화한다(SPEC-MOBILE-004 — 셸 Google 버튼 탭).
 * 토큰 없는 명령 신호로, 네이티브가 nonce 인증 후 Google Sign-In SDK 를 실행한다. 외부 브라우저 OAuth
 * 이탈 없이 네이티브 인앱 로그인을 띄우는 결정적 경로다(웹의 OAuth 네비게이션 인터셉트 의존 제거).
 */
export function serializeGoogleSignInRequest(nonce: string): string {
  return JSON.stringify({ version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST, nonce });
}
