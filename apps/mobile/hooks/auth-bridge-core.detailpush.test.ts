// decideWebViewLoad detail-push 변형 테스트 (SPEC-MOIM-003 REQ-MOIM3-003, AC-3).
//
// MOBILE-003 의 교차 라우트 디스패치(auth-bridge-core.crossroute.test.ts)는 그대로 보존하고
// (이 파일은 그것을 건드리지 않는다 — 회귀 0), 같은 탭 내 중첩 detail 네비게이션(`/home/[id]`)에 대한
// ADDITIVE push 변형만 추가 검증한다:
//   - currentUrl 부재 → 기존 동작 그대로(detail 도 trusted-load, 회귀 0).
//   - currentUrl 이 같은 탭 list(/home) + 타깃 detail(/home/123) → { action: "push", route, id }.
//   - cross-tab detail(/explore → /home/123)은 push 아님 — trusted-load(WebView 내 유지, MOBILE-003 보존).
//   - 비신뢰 origin / OAuth / 채팅(/moims/{id}/chat) 은 push 아님.
// expo/RN import 0.
import { describe, it, expect } from "vitest";

import { decideWebViewLoad } from "./auth-bridge-core";

const ctx = {
  trustedWebUrl: "http://localhost:3000",
  supabaseBaseUrl: "http://127.0.0.1:54321",
};

describe("decideWebViewLoad — detail push (REQ-MOIM3-003, 같은 탭 중첩)", () => {
  it("home list(/home) 에서 home detail(/home/123) 로의 이동은 push 디스패치", () => {
    expect(
      decideWebViewLoad("http://localhost:3000/home/123", {
        ...ctx,
        currentUrl: "http://localhost:3000/home",
      }),
    ).toEqual({ action: "push", route: "home", id: "123" });
  });

  it("uuid id 도 그대로 push 변형에 싣는다", () => {
    expect(
      decideWebViewLoad(
        "http://localhost:3000/home/15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8",
        { ...ctx, currentUrl: "http://localhost:3000/home" },
      ),
    ).toEqual({
      action: "push",
      route: "home",
      id: "15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8",
    });
  });

  it("같은 탭 list 의 query 변형(/home?filter=x)에서 detail 로 가도 push", () => {
    expect(
      decideWebViewLoad("http://localhost:3000/home/123", {
        ...ctx,
        currentUrl: "http://localhost:3000/home?filter=upcoming",
      }),
    ).toEqual({ action: "push", route: "home", id: "123" });
  });
});

describe("decideWebViewLoad — detail push 회귀 0 (R-NC3 보존)", () => {
  it("currentUrl 부재면 detail 도 push 아님 → trusted-load(회귀 0)", () => {
    expect(decideWebViewLoad("http://localhost:3000/home/123", ctx)).toBe(
      "trusted-load",
    );
  });

  it("cross-tab detail(/explore → /home/123)은 push 아님 → trusted-load (MOBILE-003 보존)", () => {
    // route(currentUrl)=explore !== detailRoute=home → 같은 탭 push 아님. 기존 crossroute 테스트와 일치.
    expect(
      decideWebViewLoad("http://localhost:3000/home/123", {
        ...ctx,
        currentUrl: "http://localhost:3000/explore",
      }),
    ).toBe("trusted-load");
  });

  it("비신뢰 origin 의 detail 은 push 아님 → deny(외부 위임)", () => {
    expect(
      decideWebViewLoad("https://evil.example.com/home/123", {
        ...ctx,
        currentUrl: "http://localhost:3000/home",
      }),
    ).toBe("deny");
  });

  it("채팅 입장(/moims/{id}/chat, 3 세그먼트)은 push/dispatch 아님 → trusted-load(WebView 내 유지)", () => {
    expect(
      decideWebViewLoad("http://localhost:3000/moims/abc/chat", {
        ...ctx,
        currentUrl: "http://localhost:3000/home/abc",
      }),
    ).toBe("trusted-load");
  });

  it("OAuth authorize URL 은 detail 컨텍스트여도 oauth-intercept 우선(인증 플로우 보존)", () => {
    expect(
      decideWebViewLoad("http://127.0.0.1:54321/auth/v1/authorize?provider=google", {
        ...ctx,
        currentUrl: "http://localhost:3000/home",
      }),
    ).toBe("oauth-intercept");
  });

  it("같은 탭 cross-route(다른 단일 세그먼트)는 여전히 dispatch(detail 추가가 영향 없음)", () => {
    expect(
      decideWebViewLoad("http://localhost:3000/explore", {
        ...ctx,
        currentUrl: "http://localhost:3000/home",
      }),
    ).toEqual({ action: "dispatch", route: "explore" });
  });
});
