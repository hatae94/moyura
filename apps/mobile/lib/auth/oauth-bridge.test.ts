// OAuth 브리지 순수 URL 헬퍼 단위 테스트 (SPEC-MOBILE-001 R-O1 / R-O3, AC-O1 / AC-O3).
//
// 이 헬퍼들은 expo/RN import 가 없는 순수 함수이므로(네이티브 모듈 mock 불필요),
// vitest node 환경에서 그대로 테스트한다.
import { describe, it, expect } from "vitest";

import {
  isOAuthAuthorizeUrl,
  rewriteAuthorizeRedirect,
  buildWebCallbackUrl,
} from "./oauth-bridge";

// 로컬 GoTrue 호스트(EXPO_PUBLIC_SUPABASE_URL 와 동일 형태) + 웹 호스트.
const SUPABASE_BASE = "http://127.0.0.1:54321";
const WEB_BASE = "http://localhost:3000";
const RETURN_URL = "moyura://auth-callback";

describe("isOAuthAuthorizeUrl (R-O1/AC-O1)", () => {
  it("supabase 호스트의 /authorize URL 이면 true (인터셉트 대상)", () => {
    const authorizeUrl =
      "http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback%3Fnext%3D%2Fme";
    expect(isOAuthAuthorizeUrl(authorizeUrl, SUPABASE_BASE)).toBe(true);
  });

  it("일반 웹 페이지 URL 이면 false (정상 네비게이션 차단 금지 — EC-5)", () => {
    expect(isOAuthAuthorizeUrl("http://localhost:3000/login", SUPABASE_BASE)).toBe(false);
  });

  it("웹 콜백 URL 이면 false (콜백은 인터셉트 대상이 아님)", () => {
    expect(
      isOAuthAuthorizeUrl("http://localhost:3000/auth/callback?code=abc", SUPABASE_BASE),
    ).toBe(false);
  });

  it("다른 호스트의 /authorize 라도 supabase 호스트가 아니면 false", () => {
    expect(
      isOAuthAuthorizeUrl("https://accounts.google.com/o/oauth2/v2/authorize", SUPABASE_BASE),
    ).toBe(false);
  });

  it("파싱 불가한 값이면 false (방어적 — 정상 네비게이션 차단 금지)", () => {
    expect(isOAuthAuthorizeUrl("not-a-url", SUPABASE_BASE)).toBe(false);
  });
});

describe("rewriteAuthorizeRedirect (R-O1/OD-5)", () => {
  it("authorize URL 의 redirect_to 를 deep-link 복귀 URL 로 재작성한다", () => {
    const authorizeUrl =
      "http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback%3Fnext%3D%2Fme";
    const rewritten = rewriteAuthorizeRedirect(authorizeUrl, RETURN_URL);

    const parsed = new URL(rewritten);
    expect(parsed.searchParams.get("redirect_to")).toBe(RETURN_URL);
    // provider 등 다른 쿼리 파라미터는 보존한다.
    expect(parsed.searchParams.get("provider")).toBe("google");
    // 호스트/경로는 그대로 유지한다.
    expect(parsed.host).toBe("127.0.0.1:54321");
    expect(parsed.pathname).toBe("/auth/v1/authorize");
  });
});

describe("buildWebCallbackUrl (R-O3/AC-O3)", () => {
  it("deep-link 복귀 URL 의 code 를 웹 콜백 URL(?code=...&next=/me)로 조립한다", () => {
    const returnUrl = "moyura://auth-callback?code=pkce-code-123";
    const webCallback = buildWebCallbackUrl(returnUrl, WEB_BASE);

    expect(webCallback).not.toBeNull();
    const parsed = new URL(webCallback as string);
    expect(`${parsed.protocol}//${parsed.host}`).toBe(WEB_BASE);
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("code")).toBe("pkce-code-123");
    expect(parsed.searchParams.get("next")).toBe("/me");
  });

  it("code 가 없으면 null 을 반환한다 (복구 가능 — half-auth 방지)", () => {
    const returnUrl = "moyura://auth-callback?error=access_denied";
    expect(buildWebCallbackUrl(returnUrl, WEB_BASE)).toBeNull();
  });

  it("파싱 불가한 복귀 URL 이면 null 을 반환한다", () => {
    expect(buildWebCallbackUrl("not-a-url", WEB_BASE)).toBeNull();
  });
});
