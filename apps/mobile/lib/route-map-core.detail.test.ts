// detailRouteForUrl 순수 분류 테스트 (SPEC-MOIM-003 REQ-MOIM3-003, AC-3).
//
// 중첩 detail 라우트(`/home/[id]`) 분류를 검증한다. routeForUrl(단일 세그먼트)·urlForRoute·isCrossRoute
// 의 기존 동작은 route-map-core.test.ts 가 보존한다(이 파일은 그것을 건드리지 않는다 — 회귀 0).
//   - detailRouteForUrl: 정확히 2 세그먼트 + segment[0] 이 앱 라우트면 { route, id }, 그 외 null.
//   - 단일/3+ 세그먼트·비-앱 prefix·malformed 는 null(throw 없음).
// expo/RN import 0 — vitest node 환경(mobile-pure-core-test-seam).
import { describe, it, expect } from "vitest";

import { detailRouteForUrl, urlForDetailRoute } from "./route-map-core";

describe("detailRouteForUrl (REQ-MOIM3-003: /home/[id] 중첩 detail 분류)", () => {
  it("home detail URL 을 { route: 'home', id } 로 분류한다", () => {
    expect(detailRouteForUrl("http://localhost:3000/home/123")).toEqual({
      route: "home",
      id: "123",
    });
  });

  it("uuid 형태의 id 도 그대로 보존한다", () => {
    expect(
      detailRouteForUrl(
        "http://localhost:3000/home/15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8",
      ),
    ).toEqual({ route: "home", id: "15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8" });
  });

  it("다른 앱 라우트의 detail 도 분류한다(prefix 가 앱 라우트면)", () => {
    expect(detailRouteForUrl("http://localhost:3000/explore/abc")).toEqual({
      route: "explore",
      id: "abc",
    });
    expect(detailRouteForUrl("http://localhost:3000/profile/settings")).toEqual({
      route: "profile",
      id: "settings",
    });
  });

  it("trailing slash 가 있어도 2 세그먼트로 분류한다", () => {
    expect(detailRouteForUrl("http://localhost:3000/home/123/")).toEqual({
      route: "home",
      id: "123",
    });
  });

  it("query/hash 는 무시하고 pathname 으로만 분류한다", () => {
    expect(detailRouteForUrl("http://localhost:3000/home/123?ref=card")).toEqual({
      route: "home",
      id: "123",
    });
    expect(detailRouteForUrl("http://localhost:3000/home/123#top")).toEqual({
      route: "home",
      id: "123",
    });
  });

  it("URL-encoded id 는 디코드해 돌려준다", () => {
    expect(detailRouteForUrl("http://localhost:3000/home/a%20b")).toEqual({
      route: "home",
      id: "a b",
    });
  });

  it("단일 세그먼트(/home)는 detail 아님 → null", () => {
    expect(detailRouteForUrl("http://localhost:3000/home")).toBeNull();
    expect(detailRouteForUrl("http://localhost:3000/explore")).toBeNull();
  });

  it("3+ 세그먼트(/home/123/x)는 detail 아님 → null", () => {
    expect(detailRouteForUrl("http://localhost:3000/home/123/edit")).toBeNull();
  });

  it("prefix 가 앱 라우트가 아니면(/moims/{id}, /auth/callback) null", () => {
    // 채팅 입장(/moims/{id}/chat 은 3 세그먼트지만, /moims/{id} 자체도 앱 라우트 prefix 아님).
    expect(detailRouteForUrl("http://localhost:3000/moims/abc")).toBeNull();
    expect(detailRouteForUrl("http://localhost:3000/auth/callback")).toBeNull();
  });

  it("빈 id(트레일링 슬래시뿐) 또는 루트는 null", () => {
    expect(detailRouteForUrl("http://localhost:3000/")).toBeNull();
    expect(detailRouteForUrl("http://localhost:3000")).toBeNull();
  });

  it("malformed URL 은 throw 없이 null", () => {
    expect(detailRouteForUrl("not a url")).toBeNull();
    expect(detailRouteForUrl("")).toBeNull();
    expect(detailRouteForUrl("about:blank")).toBeNull();
  });
});

describe("urlForDetailRoute (REQ-MOIM3-003: detail 라우트 → 호스팅 웹 URL)", () => {
  it("webUrl 호스트에 detail 경로를 결합한다", () => {
    expect(urlForDetailRoute("home", "123", "http://localhost:3000")).toBe(
      "http://localhost:3000/home/123",
    );
  });

  it("webUrl trailing slash 가 있어도 중복 슬래시 없이 결합한다", () => {
    expect(urlForDetailRoute("home", "abc", "http://localhost:3000/")).toBe(
      "http://localhost:3000/home/abc",
    );
  });

  it("id 를 URL-인코딩한다(공백 등 안전 결합)", () => {
    expect(urlForDetailRoute("home", "a b", "http://localhost:3000")).toBe(
      "http://localhost:3000/home/a%20b",
    );
  });

  it("urlForDetailRoute 의 결과는 detailRouteForUrl 로 같은 route/id 가 된다(round-trip)", () => {
    const built = urlForDetailRoute("home", "xyz-1", "http://localhost:3000");
    expect(detailRouteForUrl(built)).toEqual({ route: "home", id: "xyz-1" });
  });
});
