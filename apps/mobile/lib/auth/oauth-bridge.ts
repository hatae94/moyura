// Google OAuth 브리지 순수 URL 헬퍼 (SPEC-MOBILE-001 R-O1 / R-O3, AC-O1 / AC-O3).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 함수만 제공한다 — 네이티브 모듈 mock 없이
// vitest node 환경에서 단위 테스트 가능하다. oauth.ts 의 연기된 authorizeUrl 산출(R-F3)을
// Google 한정으로 완성하는 핵심 로직(인터셉트 판별 + redirect_to 재작성 + 콜백 URL 조립)이다.
//
// ── 브리지 설계 (OD-5 해소) ────────────────────────────────────────────────────
// 웹 흐름: WebView 가 웹 로그인 → "Google" 클릭 → signInWithOAuthAction 이
//   signInWithOAuth({ redirectTo: "http://localhost:3000/auth/callback?next=/me" }) 호출 →
//   data.url = GoTrue authorize URL(host = EXPO_PUBLIC_SUPABASE_URL host, path /auth/v1/authorize,
//   쿼리에 redirect_to=웹콜백) → 서버 redirect(data.url) → WebView 가 그 authorize URL 로 top-level 네비게이트.
//
// 문제(OD-5): openAuthSessionAsync(authorizeUrl, "moyura://auth-callback") 는 시스템 브라우저
//   흐름이 moyura://auth-callback 으로 끝나야 success 를 반환한다. 그러나 웹의 redirect_to 는
//   웹 콜백(localhost:3000/auth/callback)이므로, authorize URL 을 그대로 시스템 브라우저에 넘기면
//   흐름이 브라우저 안에서 끝나 세션 쿠키가 브라우저 쿠키 저장소(WebView 와 분리)에 설정된다 = half-auth.
//
// 해결(R-F3 Google 한정 완성): 인터셉트한 authorize URL 의 redirect_to 를 moyura://auth-callback 으로
//   재작성해 시스템 브라우저에 넘긴다 → GoTrue authorize → Google 동의 → GoTrue 콜백 →
//   moyura://auth-callback?code=... 로 복귀 → openAuthSessionAsync 가 {kind:"authenticated"} 반환.
//   그 후 WebView 를 ${WEB_URL}/auth/callback?code=...&next=/me 로 네비게이트하면, WebView 안에서
//   exchangeCodeForSession 이 (signInWithOAuth 시점에 WebView 에 설정된 PKCE code-verifier 쿠키와)
//   같은 WebView 쿠키 컨텍스트로 교환 → 세션 쿠키가 WebView 저장소에 안착 → /me 렌더(R-O3).

/** 웹 콜백 경로 — apps/web/app/auth/callback/route.ts 와 일치. */
const WEB_CALLBACK_PATH = "/auth/callback";

/** 소셜 로그인 성공 후 도착지 — 웹 signInWithOAuthAction 의 next 와 일관(R-O3). */
const DEFAULT_NEXT = "/me";

/**
 * 주어진 값을 URL 로 안전하게 파싱한다(실패 시 null). 정상 네비게이션을 실수로
 * 차단하지 않도록(EC-5) 파싱 불가 입력은 조용히 null 로 처리한다.
 */
function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * 네비게이션 URL 이 인터셉트해야 할 GoTrue authorize URL 인지 판별한다(R-O1).
 *
 * 판별 기준: host 가 supabase 호스트와 같고 pathname 에 "/authorize" 가 포함될 때.
 * supabase base 를 인자로 받아 순수/테스트 가능하게 유지한다(env.ts SUPABASE_URL 주입).
 *
 * 너무 넓으면 정상 네비게이션까지 차단하고, 너무 좁으면 OAuth 를 못 가로채므로(EC-5),
 * "supabase 호스트 + /authorize" 의 좁은 교집합만 매칭한다.
 *
 * @param navUrl WebView 가 로드하려는 네비게이션 URL
 * @param supabaseBaseUrl GoTrue 호스트 base(예: http://127.0.0.1:54321)
 * @returns 인터셉트 대상이면 true
 */
export function isOAuthAuthorizeUrl(navUrl: string, supabaseBaseUrl: string): boolean {
  const target = tryParseUrl(navUrl);
  const base = tryParseUrl(supabaseBaseUrl);
  if (!target || !base) {
    return false;
  }
  return target.host === base.host && target.pathname.includes("/authorize");
}

/**
 * 인터셉트한 GoTrue authorize URL 의 redirect_to 쿼리 파라미터를 deep-link 복귀 URL
 * (moyura://auth-callback)로 재작성한다(OD-5 해결). 그 외 쿼리(provider 등)와 host/path 는 보존한다.
 *
 * @param authorizeUrl 인터셉트한 GoTrue authorize URL
 * @param returnUrl deep-link 복귀 URL(buildReturnUrl() = moyura://auth-callback)
 * @returns redirect_to 가 재작성된 authorize URL
 */
export function rewriteAuthorizeRedirect(authorizeUrl: string, returnUrl: string): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set("redirect_to", returnUrl);
  return url.toString();
}

/**
 * deep-link 복귀 URL 에서 code 를 추출해 WebView 가 로드할 웹 콜백 URL
 * (${webUrl}/auth/callback?code=...&next=/me)을 조립한다(R-O3).
 *
 * code 가 없거나(예: error=access_denied) 복귀 URL 파싱이 불가하면 null 을 반환한다 —
 * code 없는 콜백 로드로 half-auth 가 되는 것을 막고, 호출부가 미인증 유지(R-O4)로 처리하게 한다.
 *
 * @param returnUrl openAuthSessionAsync 가 돌려준 deep-link 복귀 URL
 * @param webUrl 셸이 호스팅하는 웹 URL(WEB_URL)
 * @param next 콜백 후 도착 경로(기본 /me)
 * @returns 웹 콜백 URL 문자열, code 없거나 파싱 실패면 null
 */
export function buildWebCallbackUrl(
  returnUrl: string,
  webUrl: string,
  next: string = DEFAULT_NEXT,
): string | null {
  const parsed = tryParseUrl(returnUrl);
  if (!parsed) {
    return null;
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    return null;
  }
  const callback = new URL(WEB_CALLBACK_PATH, webUrl);
  callback.searchParams.set("code", code);
  callback.searchParams.set("next", next);
  return callback.toString();
}
