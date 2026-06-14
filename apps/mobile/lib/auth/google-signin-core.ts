// 네이티브 Google Sign-In 결과 순수 분류기 (SPEC-MOBILE-004 R-MOB4-001/005, AC-1/2/6a/6b).
//
// 이 모듈은 expo/RN/@react-native-google-signin import 가 전혀 없는 순수 함수만 제공한다 —
// 네이티브 모듈 mock 없이 vitest node 환경에서 단위 테스트한다(mobile-pure-core-test-seam).
// google-signin.ts 얇은 래퍼가 GoogleSignin.configure + signIn() 호출(expo/네이티브)을 담고,
// 그 resolve 응답(또는 catch 한 에러)을 이 분류기에 넘긴다 — oauth.ts 의 OAuthLaunchResult 분류
// 패턴과 동일하다(외부 SDK 경계의 다양한 결과/예외를 throw 없이 복구 가능한 분류로 흡수).
//
// ── Google Original API(무료) signIn() 응답 형태 (공식 문서 기준) ─────────────────
// 무료 "Original" 모듈의 signIn() 은 다음 중 하나로 resolve 한다:
//   - { type: 'success', data: { idToken: string, user, scopes, serverAuthCode } }
//   - { type: 'cancelled', data: null }              (사용자 취소 — 모던 contract)
//   - { type: 'noSavedCredentialFound', data: null } (signInSilently 경로 — 방어적 처리)
// 또는 statusCodes 기반 에러를 throw 한다(SIGN_IN_CANCELLED / IN_PROGRESS /
// PLAY_SERVICES_NOT_AVAILABLE 등). 래퍼가 throw 를 catch 해 이 분류기에 넘기면, 취소 코드는
// cancelled 로, 그 외는 error 로 분류한다(유료 Universal/OneTap 미사용 — Original API 만 사용).
//
// 보안(AC-6b): 분류 결과/ reason 에 idToken 값이나 입력 페이로드의 비밀을 절대 싣지 않는다 —
// reason 은 고정 사유 코드 문자열만 사용한다(자격증명 비노출).

/**
 * Google Sign-In 결과 분류.
 * - `idToken`: signIn 성공 + 유효한 Google idToken 획득 → signInWithIdToken 진행(AC-1/2).
 * - `cancelled`: 사용자 취소(또는 저장 자격증명 없음) — 미인증 유지, 즉시 재시도 가능(AC-6a).
 * - `error`: idToken 누락/검증 불가/네이티브 실패 등 복구 가능한 오류 — 미인증 유지(AC-6b).
 */
export type GoogleSignInResult =
  | { kind: "idToken"; token: string }
  | { kind: "cancelled" }
  | { kind: "error"; reason: string };

/** 사용자 취소를 의미하는 status code 집합(Original API). 취소는 에러가 아니라 cancelled 로 분류한다. */
const CANCEL_CODES: ReadonlySet<string> = new Set<string>([
  "SIGN_IN_CANCELLED",
  // 일부 플랫폼/버전이 숫자 코드(Android 12501)를 문자열로 노출할 수 있어 방어적으로 포함.
  "12501",
]);

/** 토큰을 싣지 않는 cancelled-유사 응답 type 집합(토큰 없음 — 미인증 유지). */
const CANCELLED_RESPONSE_TYPES: ReadonlySet<string> = new Set<string>([
  "cancelled",
  "noSavedCredentialFound",
]);

/** unknown 값에서 문자열 프로퍼티를 안전하게 읽는다(없으면 undefined). */
function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

/**
 * GoogleSignin.signIn() 의 resolve 응답 또는 catch 한 에러를 순수하게 분류한다(R-MOB4-001/005).
 *
 * 방어적(parseBridgeMessage 스타일): null/원시값/배열/형태 불일치 등 어떤 입력도 throw 하지 않고
 * 분류한다. idToken 값은 결과에만 싣고 reason 에는 절대 노출하지 않는다(AC-6b — 자격증명 비노출).
 *
 * 분류(우선순위):
 *   1. 취소: response.type ∈ {cancelled, noSavedCredentialFound}, 또는 error.code ∈ CANCEL_CODES.
 *   2. 성공: response.type==='success' AND data.idToken 이 비어있지 않은 문자열 → idToken.
 *   3. 그 외(idToken 누락/non-string/빈값, 비취소 에러, malformed): error(고정 사유 코드).
 *
 * @param raw signIn() resolve 응답 또는 catch 된 에러(unknown — 래퍼가 그대로 전달)
 * @returns idToken | cancelled | error 분류(미인증 유지·복구 가능 — 토큰 값 비노출)
 */
// @MX:NOTE: [AUTO] 네이티브 Google SDK 결과 경계 분류기(SPEC-MOBILE-004) — signIn() 의 성공/취소/
//   에러/throw 를 idToken/cancelled/error 로 흡수한다. reason 에 토큰을 싣지 않는다(AC-6b).
export function classifyGoogleSignInResult(raw: unknown): GoogleSignInResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "error", reason: "google_signin_malformed" };
  }
  const obj = raw as Record<string, unknown>;

  // 1) throw 된 에러 형태(code 보유) — 취소 코드는 cancelled, 그 외는 error.
  const code = readString(obj, "code");
  if (code !== undefined) {
    if (CANCEL_CODES.has(code)) {
      return { kind: "cancelled" };
    }
    // 비취소 status code(IN_PROGRESS/PLAY_SERVICES_NOT_AVAILABLE 등) — 토큰 비노출 고정 사유.
    return { kind: "error", reason: "google_signin_failed" };
  }

  // 2) resolve 응답 형태(type 보유).
  const type = readString(obj, "type");
  if (type !== undefined) {
    if (CANCELLED_RESPONSE_TYPES.has(type)) {
      return { kind: "cancelled" };
    }
    if (type === "success") {
      const data = obj.data;
      if (typeof data === "object" && data !== null) {
        const token = readString(data as Record<string, unknown>, "idToken");
        if (token) {
          return { kind: "idToken", token };
        }
      }
      // success 인데 유효 idToken 없음 — 진행 불가(토큰 비노출 고정 사유).
      return { kind: "error", reason: "google_signin_missing_id_token" };
    }
  }

  // 3) 알 수 없는 형태 — 미인증 유지(토큰 비노출 고정 사유).
  return { kind: "error", reason: "google_signin_unknown_result" };
}
