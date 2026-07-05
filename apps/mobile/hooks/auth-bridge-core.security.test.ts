// useAuthBridge 보안 확장의 순수 결정 로직 테스트 (SPEC-MOBILE-002 R-T8/R-T9 — 보안 C-1/C-2/H-1).
//
// security-review.md 의 CRITICAL/HIGH 수정에 대한 RED 테스트:
//   - verifyNonce: 메시지 인증 nonce 의 상수시간 비교(accept 일치 / reject 불일치·빈값·길이차) — C-1/H-1.
//   - decideWebViewLoad: onShouldStartLoadWithRequest 의 3분기 결정(trusted-load / oauth-intercept /
//     deny) — C-2 WebView origin 잠금 + OAuth 인터셉트 보존.
//   - buildTargetOrigin: 네이티브→웹 주입 targetOrigin 이 신뢰 origin literal(NOT "*") — C-2(d)/H-1.
// expo/RN import 0 — vitest node 환경에서 mock 없이 단위 테스트.
import { describe, it, expect } from "vitest";

import {
  verifyNonce,
  decideWebViewLoad,
  buildTargetOrigin,
} from "./auth-bridge-core";

describe("verifyNonce (R-T8 / AC-T8: 메시지 인증 nonce 상수시간 비교 — C-1/H-1)", () => {
  it("nonce 가 정확히 일치하면 true (인증 통과 — 정상 브리지 메시지)", () => {
    expect(verifyNonce("a1b2c3d4e5f6", "a1b2c3d4e5f6")).toBe(true);
  });

  it("nonce 가 다르면 false (위조 메시지 거부 — 동일 page 임의 스크립트는 nonce 모름)", () => {
    expect(verifyNonce("a1b2c3d4e5f6", "deadbeefdeadbeef")).toBe(false);
  });

  it("같은 길이지만 한 글자만 달라도 false (부분 일치 거부)", () => {
    expect(verifyNonce("a1b2c3d4e5f6", "a1b2c3d4e5f7")).toBe(false);
  });

  it("길이가 다르면 false (truncation/확장 위조 거부)", () => {
    expect(verifyNonce("a1b2c3d4", "a1b2c3d4e5f6")).toBe(false);
    expect(verifyNonce("a1b2c3d4e5f6", "a1b2c3d4")).toBe(false);
  });

  it("빈 nonce 는 항상 false (미인증 메시지 — 스키마는 맞으나 nonce 누락)", () => {
    expect(verifyNonce("", "")).toBe(false);
    expect(verifyNonce("", "a1b2c3d4")).toBe(false);
    expect(verifyNonce("a1b2c3d4", "")).toBe(false);
  });
});

describe("decideWebViewLoad (R-T9 / AC-T9: WebView origin 잠금 + OAuth 인터셉트 보존 — C-2)", () => {
  const ctx = {
    trustedWebUrl: "http://192.168.219.102:3000",
    supabaseBaseUrl: "http://127.0.0.1:54321",
  };

  it("신뢰 WEB_URL origin 의 top-level 로드는 trusted-load (in-WebView 허용)", () => {
    expect(decideWebViewLoad("http://192.168.219.102:3000/", ctx)).toBe("trusted-load");
    expect(decideWebViewLoad("http://192.168.219.102:3000/me", ctx)).toBe("trusted-load");
    expect(decideWebViewLoad("http://192.168.219.102:3000/login?error=x", ctx)).toBe(
      "trusted-load",
    );
  });

  it("GoTrue authorize URL 은 oauth-intercept (시스템 브라우저 브리지 보존 — R-V1)", () => {
    expect(
      decideWebViewLoad(
        "http://127.0.0.1:54321/auth/v1/authorize?provider=google&redirect_to=x",
        ctx,
      ),
    ).toBe("oauth-intercept");
  });

  it("비신뢰 top-level http(s) origin 은 deny (외부 브라우저 위임 — C-2)", () => {
    expect(decideWebViewLoad("https://evil.example.com/", ctx)).toBe("deny");
    expect(decideWebViewLoad("https://accounts.google.com/o/oauth2/v2/auth", ctx)).toBe(
      "deny",
    );
  });

  it("신뢰 호스트의 다른 호스트/포트/scheme 는 deny (origin exact — 호스트/포트/scheme 불일치)", () => {
    expect(decideWebViewLoad("http://192.168.219.102:4000/me", ctx)).toBe("deny");
    expect(decideWebViewLoad("https://192.168.219.102:3000/me", ctx)).toBe("deny");
    // 신뢰 호스트와 다른 호스트(IP)는 deny — IP 는 서브도메인이 성립하지 않으므로 별개 호스트로 검증한다.
    expect(decideWebViewLoad("http://192.168.219.103:3000/me", ctx)).toBe("deny");
  });

  it("OAuth 인터셉트가 deny 보다 우선한다 (supabase 호스트도 비신뢰 origin 이지만 인터셉트)", () => {
    // supabase 호스트는 trusted origin 이 아니지만, authorize URL 이면 deny 가 아니라 intercept.
    expect(
      decideWebViewLoad("http://127.0.0.1:54321/auth/v1/authorize?provider=google", ctx),
    ).toBe("oauth-intercept");
  });

  it("비-http scheme/파싱 불가 URL 은 trusted-load (프레임워크 내부 — about:blank 등, 무회귀)", () => {
    // about:blank, data: 등 프레임워크 내부 요청은 막지 않는다(SHELL-001 무회귀).
    expect(decideWebViewLoad("about:blank", ctx)).toBe("trusted-load");
    expect(decideWebViewLoad("", ctx)).toBe("trusted-load");
  });
});

describe("buildTargetOrigin (R-T8 / AC-T8: specific targetOrigin — NOT '*' — C-2(d)/H-1)", () => {
  it("신뢰 WEB_URL 의 origin literal 을 반환한다 (와일드카드 아님)", () => {
    expect(buildTargetOrigin("http://192.168.219.102:3000")).toBe("http://192.168.219.102:3000");
    expect(buildTargetOrigin("http://192.168.219.102:3000/me")).toBe("http://192.168.219.102:3000");
    expect(buildTargetOrigin("http://10.0.2.2:3000/")).toBe("http://10.0.2.2:3000");
  });

  it("절대 '*' 를 반환하지 않는다 (토큰 브로드캐스트 차단)", () => {
    expect(buildTargetOrigin("http://192.168.219.102:3000")).not.toBe("*");
  });
});
