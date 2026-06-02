// PKCE 콜백 분기 로직 (순수 함수 — 테스트 가능 단위, SPEC-AUTH-001 R-D2 / R-D2a, M-6).
//
// OAuth provider 가 콜백으로 돌려보내는 쿼리 파라미터를 분석해, "코드 교환을 시도해야 하는지"
// 또는 "에러로 처리해야 하는지"를 결정한다. 이 분기를 Route Handler 본문에서 분리해 둠으로써
// 음성 경로(error param / 누락·빈 code)를 Supabase 세션/Next cookies 없이도 단위 테스트할 수 있다.
//
// 주의: state/PKCE verifier 불일치로 exchangeCodeForSession 자체가 실패하는 경우는 이 순수 함수가
// 아니라 Route Handler 의 try/catch 에서 처리된다(외부 I/O 결과이므로). 이 함수는 "교환 시도 이전"의
// 결정적 분기만 담당한다.

/** 콜백 쿼리에서 추출한 결정 결과. */
export type CallbackOutcome =
  | { kind: "exchange"; code: string }
  | { kind: "error"; reason: string };

/**
 * 콜백 URL 의 search params 를 받아 다음 행동을 결정한다.
 *
 * - `error`/`error_description` 가 있으면(코드 유무와 무관) → error (세션 미확립).
 * - `code` 가 없거나 공백뿐이면 → error (세션 미확립).
 * - 유효한 `code` 가 있으면 → exchange (코드 교환 시도).
 *
 * @param params 콜백 요청 URL 의 URLSearchParams (예: new URL(request.url).searchParams)
 */
export function resolveCallbackOutcome(
  params: URLSearchParams,
): CallbackOutcome {
  // R-D2a: error/error_description 가 오면 코드가 있어도 세션을 확립하지 않는다.
  const error = params.get("error");
  const errorDescription = params.get("error_description");
  if (error || errorDescription) {
    return {
      kind: "error",
      reason: errorDescription?.trim() || error?.trim() || "oauth_error",
    };
  }

  // R-D2a: code 누락/빈 문자열 → 세션 미확립.
  const code = params.get("code")?.trim();
  if (!code) {
    return { kind: "error", reason: "missing_code" };
  }

  return { kind: "exchange", code };
}
