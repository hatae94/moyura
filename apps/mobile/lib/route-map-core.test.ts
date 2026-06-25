// route-map-core 순수 모듈 단위 테스트 (SPEC-MOBILE-003 R-NC1, AC-3).
//
// 웹/앱 동일 라우트 트리(home/explore/notifications/profile)의 URL↔라우트 1:1 매핑 계약을
// 검증한다. expo/RN import 0 — vitest node 환경에서 mock 없이 단위 테스트(mobile-pure-core-test-seam).
//   - routeForUrl: pathname → AppRoute | null (앱 라우트만 매핑, 비-앱 경로/중첩/malformed 는 null).
//   - urlForRoute: AppRoute + webUrl → 호스팅 URL.
//   - isCrossRoute: 교차 라우트 디스패치 판정(동일 라우트 query/hash 변경은 cross 아님).
import { describe, it, expect } from "vitest";

import {
  routeForUrl,
  urlForRoute,
  isCrossRoute,
  detailRouteForUrl,
  APP_ROUTES,
} from "./route-map-core";

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

// 초대 라우트 in-WebView 불변식 잠금 — 탐색/로그인 탭의 "돌아가기" 일치 수정의 전제(premise-lock).
//
// 배경(버그): 탐색 탭 → /invite → /invite/{token} 으로 들어간 뒤 웹 "돌아가기"를 누르면 네이티브 탭(탐색)과
// WebView 내용(홈)이 어긋났다. 근본 원인은 웹 측 돌아가기 버튼이 절대 링크 `/`(RootEntry 세션 redirect →
// /home)였던 것이고, 수정은 apps/web/app/invite/page.tsx 에서 router.back()(웹 히스토리 back)으로 바꾼 것이다.
// 그 수정이 "탐색으로 복귀"하려면 /invite·/invite/{token} 가 네이티브 라우트로 디스패치되지 않고 진입한 탭의
// 같은 WebView 안에서 in-place 로 열려(그 WebView 의 히스토리에 /explore 가 남아 있어야) 한다 — 즉 invite 경로는
// routeForUrl/isCrossRoute/detailRouteForUrl 모두에서 비-디스패치(null/false)여야 한다. 만약 누군가 invite 를
// 앱 라우트로 승격하면 in-WebView 히스토리 모델이 깨져 router.back() 이 더는 탐색으로 복귀하지 않는다 — 이 블록이
// 그 회귀를 RED 로 잡는다. (웹 측 런타임 RED→GREEN 은 apps/web 에 테스트 하니스가 없어 도달 불가 — 이 순수
// 불변식 잠금 + 시뮬레이터 수동 재현으로 대체한다.)
describe("invite 라우트 in-WebView 불변식 (탐색/로그인 돌아가기 일치의 전제)", () => {
  const WEB = "http://localhost:3000";

  it("/invite 는 앱 라우트가 아니다 → routeForUrl null (디스패치 대상 아님, in-WebView 유지)", () => {
    expect(routeForUrl(`${WEB}/invite`)).toBeNull();
  });

  it("/invite/{token} 도 앱 라우트가 아니다 → routeForUrl null", () => {
    expect(routeForUrl(`${WEB}/invite/abc-123`)).toBeNull();
  });

  it("/invite/{token} 는 detail push 대상도 아니다 → detailRouteForUrl null (prefix 'invite' 는 앱 라우트 아님)", () => {
    // 만약 'invite' 가 detail prefix 로 인식되면 onShouldStartLoadWithRequest 가 router.push 로 네이티브
    // 화면을 띄워 in-WebView 히스토리(=/explore)가 사라진다 → 돌아가기가 탐색으로 못 돌아간다.
    expect(detailRouteForUrl(`${WEB}/invite/abc-123`)).toBeNull();
  });

  it("탐색(/explore)에서 /invite·/invite/{token} 로의 로드는 cross-route 아님 → 탐색 탭 WebView 에서 in-place 로드", () => {
    // false 라야 decideWebViewLoad 가 디스패치하지 않고 trusted-load(in-place) 로 떨어진다 — 탐색 탭의
    // WebView 가 자신의 히스토리에 /explore 를 남긴 채 /invite 를 연다 → 웹 router.back() 이 /explore 로 복귀.
    expect(isCrossRoute(`${WEB}/explore`, `${WEB}/invite`)).toBe(false);
    expect(isCrossRoute(`${WEB}/invite`, `${WEB}/invite/abc-123`)).toBe(false);
  });

  it("로그인(/login)에서 /invite 로의 로드도 cross-route 아님 → 로그인 WebView 에서 in-place 로드", () => {
    expect(isCrossRoute(`${WEB}/login`, `${WEB}/invite`)).toBe(false);
  });

  it("돌아가기 목적지(/)·루트는 앱 라우트가 아니다 → routeForUrl null (절대 `/` 링크가 위험한 이유: RootEntry 세션 redirect)", () => {
    // `/` 는 디스패치 가능한 앱 라우트가 아니라 WebView 가 그대로 로드하고, 서버가 /home|/login 으로 redirect
    // 한다 — 그래서 절대 `/` 링크는 네이티브 탭과 어긋난다(수정 전 버그). 그 대신 router.back() 을 써야 한다.
    expect(routeForUrl(`${WEB}/`)).toBeNull();
    expect(isCrossRoute(`${WEB}/explore`, `${WEB}/`)).toBe(false);
  });
});
