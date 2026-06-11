// useAuthBridge 추출 분기 특성화 테스트 (SPEC-WEBVIEW-SHELL-001 R-S6/AC-S6).
//
// 행위 보존(characterization) 게이트: App.tsx 에서 추출한 OAuth 인터셉트 판별과 runOAuthBridge
// 결과 처리 분기가 추출 전후 동일함을 자동으로 검증한다. oauth-bridge.test.ts 패턴(expo/RN import
// 0, 순수 로직 / 주입 콜백)을 따른다.
import { describe, it, expect } from "vitest";

import {
  decideOAuthIntercept,
  resolveBridgeNavigation,
} from "./auth-bridge-core";

// oauth-bridge.test.ts 와 동일한 로컬 호스트 형태(주입 — 순수 유지, env 비의존).
const SUPABASE_BASE = "http://127.0.0.1:54321";
const WEB_BASE = "http://localhost:3000";

describe("decideOAuthIntercept (R-O1 / AC-S6: shouldBridgeOAuth true/false)", () => {
  it("supabase 호스트의 /authorize URL 이면 bridge (인터셉트 → 임베디드 로드 차단)", () => {
    const authorizeUrl =
      "http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fcallback";
    expect(decideOAuthIntercept(authorizeUrl, SUPABASE_BASE)).toBe("bridge");
  });

  it("일반 웹 페이지 URL 이면 allow (정상 네비게이션 — 차단 금지, EC-5)", () => {
    expect(decideOAuthIntercept("http://localhost:3000/login", SUPABASE_BASE)).toBe("allow");
  });

  it("웹 콜백 URL 이면 allow (콜백은 인터셉트 대상이 아님)", () => {
    expect(
      decideOAuthIntercept("http://localhost:3000/auth/callback?code=abc", SUPABASE_BASE),
    ).toBe("allow");
  });
});

describe("resolveBridgeNavigation (R-O3/R-O4 / AC-S6: runOAuthBridge 콜백 경로)", () => {
  it("authenticated → 웹 콜백 URL 로 네비게이트 (setSourceUri 대상)", () => {
    const result = {
      kind: "authenticated" as const,
      returnUrl: "moyura://auth-callback?code=pkce-code-123",
    };
    const navigation = resolveBridgeNavigation(result, WEB_BASE);

    expect(navigation).not.toBeNull();
    const parsed = new URL(navigation as string);
    expect(`${parsed.protocol}//${parsed.host}`).toBe(WEB_BASE);
    expect(parsed.pathname).toBe("/auth/callback");
    expect(parsed.searchParams.get("code")).toBe("pkce-code-123");
    expect(parsed.searchParams.get("next")).toBe("/home");
  });

  it("authenticated 이지만 code 누락이면 no-op (null — half-auth 방지, 미인증 유지)", () => {
    const result = {
      kind: "authenticated" as const,
      returnUrl: "moyura://auth-callback?error=access_denied",
    };
    expect(resolveBridgeNavigation(result, WEB_BASE)).toBeNull();
  });

  it("cancelled → no-op (null — 미인증 유지, 로그인 surface 에 머문다)", () => {
    expect(resolveBridgeNavigation({ kind: "cancelled" }, WEB_BASE)).toBeNull();
  });

  it("error → no-op (null — 미인증 유지, 크래시 없음)", () => {
    expect(
      resolveBridgeNavigation({ kind: "error", reason: "oauth_launch_failed" }, WEB_BASE),
    ).toBeNull();
  });
});
