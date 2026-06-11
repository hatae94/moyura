// route-map-core 순수 모듈 단위 테스트 (SPEC-MOBILE-003 R-NC1, AC-3).
//
// 웹/앱 동일 라우트 트리(home/explore/notifications/profile)의 URL↔라우트 1:1 매핑 계약을
// 검증한다. expo/RN import 0 — vitest node 환경에서 mock 없이 단위 테스트(mobile-pure-core-test-seam).
//   - routeForUrl: pathname → AppRoute | null (앱 라우트만 매핑, 비-앱 경로/중첩/malformed 는 null).
//   - urlForRoute: AppRoute + webUrl → 호스팅 URL.
//   - isCrossRoute: 교차 라우트 디스패치 판정(동일 라우트 query/hash 변경은 cross 아님).
import { describe, it, expect } from "vitest";

import { routeForUrl, urlForRoute, isCrossRoute, APP_ROUTES } from "./route-map-core";

describe("routeForUrl (R-NC1: pathname → AppRoute 1:1 매핑)", () => {
  it("앱 라우트 4종을 정확히 매핑한다", () => {
    expect(routeForUrl("http://localhost:3000/home")).toBe("home");
    expect(routeForUrl("http://localhost:3000/explore")).toBe("explore");
    expect(routeForUrl("http://localhost:3000/notifications")).toBe("notifications");
    expect(routeForUrl("http://localhost:3000/profile")).toBe("profile");
  });

  it("trailing slash 가 있어도 동일 라우트로 매핑한다", () => {
    expect(routeForUrl("http://localhost:3000/home/")).toBe("home");
    expect(routeForUrl("http://localhost:3000/profile/")).toBe("profile");
  });

  it("query string / hash 는 무시하고 pathname 으로만 매핑한다", () => {
    expect(routeForUrl("http://localhost:3000/home?filter=upcoming")).toBe("home");
    expect(routeForUrl("http://localhost:3000/explore#section")).toBe("explore");
    expect(routeForUrl("http://localhost:3000/home?tab=x#y")).toBe("home");
  });

  it("중첩 경로(/home/123)는 이 SPEC 의 라우트 집합에 없으므로 null", () => {
    expect(routeForUrl("http://localhost:3000/home/123")).toBeNull();
    expect(routeForUrl("http://localhost:3000/profile/settings")).toBeNull();
  });

  it("비-앱 경로(/login, /auth/callback, /me)는 null (디스패치 불가 — R-AS5)", () => {
    expect(routeForUrl("http://localhost:3000/login")).toBeNull();
    expect(routeForUrl("http://localhost:3000/auth/callback?code=abc")).toBeNull();
    expect(routeForUrl("http://localhost:3000/me")).toBeNull();
    expect(routeForUrl("http://localhost:3000/")).toBeNull();
  });

  it("malformed URL 은 throw 하지 않고 null", () => {
    expect(routeForUrl("not a url")).toBeNull();
    expect(routeForUrl("")).toBeNull();
    expect(routeForUrl("about:blank")).toBeNull();
  });

  it("APP_ROUTES 는 4종 라우트의 정확한 집합이다", () => {
    expect(APP_ROUTES).toEqual(["home", "explore", "notifications", "profile"]);
  });
});

describe("urlForRoute (R-NC1: AppRoute → 호스팅 웹 URL)", () => {
  it("webUrl 호스트에 라우트 경로를 결합한다", () => {
    expect(urlForRoute("home", "http://localhost:3000")).toBe("http://localhost:3000/home");
    expect(urlForRoute("explore", "http://localhost:3000")).toBe(
      "http://localhost:3000/explore",
    );
  });

  it("webUrl 에 trailing slash 가 있어도 중복 슬래시 없이 결합한다", () => {
    expect(urlForRoute("profile", "http://localhost:3000/")).toBe(
      "http://localhost:3000/profile",
    );
  });

  it("에뮬레이터 호스트(10.0.2.2)도 일관되게 결합한다 (OD-7)", () => {
    expect(urlForRoute("notifications", "http://10.0.2.2:3000")).toBe(
      "http://10.0.2.2:3000/notifications",
    );
  });

  it("urlForRoute 의 결과는 routeForUrl 로 다시 같은 라우트가 된다 (round-trip 1:1)", () => {
    for (const route of APP_ROUTES) {
      expect(routeForUrl(urlForRoute(route, "http://localhost:3000"))).toBe(route);
    }
  });
});

describe("isCrossRoute (R-NC2/R-NC3: 교차 라우트 디스패치 판정)", () => {
  it("서로 다른 앱 라우트 pathname 은 cross-route (디스패치 대상)", () => {
    expect(
      isCrossRoute("http://localhost:3000/home", "http://localhost:3000/explore"),
    ).toBe(true);
    expect(
      isCrossRoute("http://localhost:3000/profile", "http://localhost:3000/home"),
    ).toBe(true);
  });

  it("동일 라우트의 query/hash 변경은 cross-route 아님 (WebView 내 유지)", () => {
    expect(
      isCrossRoute("http://localhost:3000/home", "http://localhost:3000/home?filter=x"),
    ).toBe(false);
    expect(
      isCrossRoute("http://localhost:3000/home", "http://localhost:3000/home#section"),
    ).toBe(false);
    expect(
      isCrossRoute("http://localhost:3000/home?a=1", "http://localhost:3000/home?a=2"),
    ).toBe(false);
  });

  it("타깃이 비-앱 경로면 cross-route 아님 (디스패치 불가 — 인증 플로우 내부 보존)", () => {
    expect(
      isCrossRoute("http://localhost:3000/home", "http://localhost:3000/login"),
    ).toBe(false);
    expect(
      isCrossRoute("http://localhost:3000/home", "http://localhost:3000/auth/callback?code=x"),
    ).toBe(false);
    expect(isCrossRoute("http://localhost:3000/home", "http://localhost:3000/me")).toBe(
      false,
    );
  });

  it("타깃이 중첩 경로(라우트 집합 밖)면 cross-route 아님", () => {
    expect(
      isCrossRoute("http://localhost:3000/home", "http://localhost:3000/home/123"),
    ).toBe(false);
  });

  it("현재가 비-앱 경로(/me)이고 타깃이 앱 라우트면 cross-route (디스패치 대상)", () => {
    expect(isCrossRoute("http://localhost:3000/me", "http://localhost:3000/home")).toBe(
      true,
    );
  });

  it("malformed URL 은 throw 하지 않고 safe false (타깃 매핑 불가)", () => {
    expect(isCrossRoute("not a url", "also not a url")).toBe(false);
    expect(isCrossRoute("http://localhost:3000/home", "not a url")).toBe(false);
    expect(isCrossRoute("", "")).toBe(false);
  });
});
