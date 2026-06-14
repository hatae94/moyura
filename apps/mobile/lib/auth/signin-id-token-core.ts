// Supabase signInWithIdToken 세션 응답 순수 분류기 (SPEC-MOBILE-004 R-MOB4-001/002/005, AC-1/2/5/6b).
//
// 이 모듈은 @supabase/supabase-js import 가 전혀 없는 순수 함수만 제공한다 — 실제 Supabase 클라이언트
// 없이 가짜 응답 객체로 vitest node 환경에서 단위 테스트한다(mobile-pure-core-test-seam).
// supabase-mobile.ts 얇은 래퍼가 createClient + auth.signInWithIdToken 호출(네이티브/네트워크)을
// 담고, 그 resolve 한 AuthTokenResponse 를 이 분류기에 넘긴다.
//
// ── Supabase signInWithIdToken 응답 형태 (공식 문서 기준) ──────────────────────────
// auth.signInWithIdToken({ provider: 'google', token }) 는 AuthTokenResponse 로 resolve 한다:
//   { data: { user: User|null, session: Session|null }, error: AuthError|null }
//   - 성공: error===null, data.session = { access_token, refresh_token, ... }
//   - 실패: data.session===null, error = AuthError(.message/.code/.status) — 토큰 검증 실패·
//           네트워크 오류·provider 미설정 등(R-MOB4-005).
//
// 보안(AC-6b): session 결과에는 access/refresh 만 싣고(브리지 TokenPayload 와 동일 — PII 최소화),
// error 결과의 reason 에는 토큰 값/ error.message(자격증명 포함 가능)를 절대 흘리지 않는다 —
// reason 은 고정 사유 코드 문자열만 사용한다.

/** 세션 토큰 쌍(브리지/저장소의 SessionTokens 와 동일 형태 — access/refresh 만). */
export interface IdTokenSessionTokens {
  access: string;
  refresh: string;
}

/**
 * signInWithIdToken 세션 분류.
 * - `session`: 세션 확립 성공 → saveTokens + session:restore 주입 진행(AC-1/2/5).
 * - `error`: 토큰 검증 실패/세션 없음/응답 불완전 등 복구 가능한 오류 — 미인증 유지(AC-6b).
 */
export type IdTokenSessionResult =
  | { kind: "session"; tokens: IdTokenSessionTokens }
  | { kind: "error"; reason: string };

/** unknown 객체에서 비어있지 않은 문자열 프로퍼티를 안전하게 읽는다(없거나 빈값이면 undefined). */
function readNonEmptyString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** unknown 값이 객체(배열/ null 아님)면 Record 로 좁혀 돌려준다(아니면 null). */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/**
 * Supabase signInWithIdToken 의 AuthTokenResponse 를 순수하게 분류한다(R-MOB4-001/002/005).
 *
 * 방어적: null/원시값/배열/형태 불일치 등 어떤 입력도 throw 하지 않고 분류한다. error 가 truthy 면
 * 무조건 error(세션 미확립), error 가 없어도 session.access_token/refresh_token 둘 다 비어있지
 * 않을 때만 session 으로 분류한다. reason 에는 토큰/ error.message 를 싣지 않는다(AC-6b).
 *
 * @param raw auth.signInWithIdToken 의 resolve 응답(unknown — 래퍼가 그대로 전달)
 * @returns session(access/refresh) | error(고정 사유 코드 — 자격증명 비노출)
 */
// @MX:NOTE: [AUTO] Supabase signInWithIdToken 세션 경계 분류기(SPEC-MOBILE-004) — Google idToken →
//   Supabase 세션 교환 결과를 session/error 로 흡수한다. reason 에 토큰/ error.message 비노출(AC-6b).
export function classifyIdTokenSession(raw: unknown): IdTokenSessionResult {
  const root = asRecord(raw);
  if (root === null) {
    return { kind: "error", reason: "id_token_signin_malformed" };
  }

  // error 가 존재하면 세션을 확립하지 않는다(토큰 검증 실패/네트워크/provider 미설정 — R-MOB4-005).
  // error.message 는 자격증명을 담을 수 있어 reason 으로 흘리지 않는다(AC-6b) — 고정 사유만 사용.
  if (root.error !== null && root.error !== undefined) {
    return { kind: "error", reason: "id_token_signin_rejected" };
  }

  const data = asRecord(root.data);
  const session = data === null ? null : asRecord(data.session);
  if (session === null) {
    // error 없는데 세션도 없음 — 세션 확립 불가(방어적).
    return { kind: "error", reason: "id_token_signin_no_session" };
  }

  const access = readNonEmptyString(session, "access_token");
  const refresh = readNonEmptyString(session, "refresh_token");
  if (!access || !refresh) {
    // 세션은 있으나 토큰 쌍 불완전 — 저장/주입 불가(refresh 없는 access 는 갱신 불가).
    return { kind: "error", reason: "id_token_signin_incomplete_session" };
  }

  return { kind: "session", tokens: { access, refresh } };
}
