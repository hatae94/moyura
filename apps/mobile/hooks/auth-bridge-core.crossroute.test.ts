// decideWebViewLoad 교차 라우트 디스패치 확장 테스트 (SPEC-MOBILE-003 R-NC2/R-NC3/R-NC4, AC-3/AC-6).
//
// 기존 decideWebViewLoad 의 3분기(oauth-intercept/trusted-load/deny)는 auth-bridge-core.security.test.ts
// 가 13건으로 보존한다(이 파일은 그것을 건드리지 않는다). 여기서는 optional currentUrl 컨텍스트가
// 주어졌을 때의 교차 라우트 deny + 네이티브 디스패치 변형(widening)만 추가 검증한다:
//   - currentUrl 부재 → 기존 동작 그대로(회귀 0).
//   - currentUrl 존재 + 신뢰 origin + 교차 앱 라우트 → { action: "dispatch", route }.
//   - OAuth 인터셉트는 디스패치보다 우선(R-NC3 예외 — 인증 플로우 내부 허용 보존).
// expo/RN import 0.
import { describe, it, expect } from "vitest";

import { decideWebViewLoad } from "./auth-bridge-core";

const ctx = {
  trustedWebUrl: "http://192.168.219.102:3000",
  supabaseBaseUrl: "http://127.0.0.1:54321",
};

describe("decideWebViewLoad — currentUrl 부재 시 기존 동작 보존 (R-NC2 회귀 0)", () => {
  it("currentUrl 이 없으면 신뢰 라우트 로드는 여전히 trusted-load (디스패치 안 함)", () => {
    expect(decideWebViewLoad("http://192.168.219.102:3000/explore", ctx)).toBe("trusted-load");
  });

  it("currentUrl 이 없으면 비신뢰 origin 은 여전히 deny", () => {
    expect(decideWebViewLoad("https://evil.example.com/", ctx)).toBe("deny");
  });

  it("currentUrl 이 없으면 authorize URL 은 여전히 oauth-intercept", () => {
    expect(
      decideWebViewLoad(
        "http://127.0.0.1:54321/auth/v1/authorize?provider=google",
        ctx,
      ),
    ).toBe("oauth-intercept");
  });
});

describe("decideWebViewLoad — currentUrl 존재 시 교차 라우트 디스패치 (R-NC2)", () => {
  it("신뢰 origin 의 교차 앱 라우트 로드는 deny + 네이티브 라우트 디스패치 반환", () => {
    expect(
      decideWebViewLoad("http://192.168.219.102:3000/explore", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/home",
      }),
    ).toEqual({ action: "dispatch", route: "explore" });
  });

  it("여러 교차 라우트를 각각의 네이티브 라우트로 디스패치한다", () => {
    expect(
      decideWebViewLoad("http://192.168.219.102:3000/profile", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/home",
      }),
    ).toEqual({ action: "dispatch", route: "profile" });
    expect(
      decideWebViewLoad("http://192.168.219.102:3000/notifications", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/explore",
      }),
    ).toEqual({ action: "dispatch", route: "notifications" });
  });

  it("동일 라우트의 query/hash 변경은 디스패치 아님 — trusted-load(WebView 내 유지)", () => {
    expect(
      decideWebViewLoad("http://192.168.219.102:3000/home?filter=upcoming", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/home",
      }),
    ).toBe("trusted-load");
  });
});

describe("decideWebViewLoad — 인증 플로우/비신뢰 우선순위 (R-NC3 예외)", () => {
  it("OAuth authorize URL 은 currentUrl 이 있어도 oauth-intercept 가 우선 (인증 플로우 보존)", () => {
    expect(
      decideWebViewLoad("http://127.0.0.1:54321/auth/v1/authorize?provider=google", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/home",
      }),
    ).toBe("oauth-intercept");
  });

  it("비-앱 경로(/login)로의 이동은 디스패치 아님 — trusted-load(인증 플로우 내부 WebView 유지)", () => {
    expect(
      decideWebViewLoad("http://192.168.219.102:3000/login", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/home",
      }),
    ).toBe("trusted-load");
  });

  it("비신뢰 origin 으로의 교차 이동은 디스패치 아님 — deny(외부 브라우저 위임)", () => {
    expect(
      decideWebViewLoad("https://evil.example.com/home", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/home",
      }),
    ).toBe("deny");
  });

  it("중첩 경로(/home/123)는 디스패치 아님 — trusted-load(라우트 집합 밖, WebView 내 유지)", () => {
    expect(
      decideWebViewLoad("http://192.168.219.102:3000/home/123", {
        ...ctx,
        currentUrl: "http://192.168.219.102:3000/explore",
      }),
    ).toBe("trusted-load");
  });
});
