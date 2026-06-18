// 웹/앱 동일 라우트 트리의 순수 매핑 로직 (SPEC-MOBILE-003 R-NC1, AC-3).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 함수/상수만 제공한다 — vitest node 환경에서 mock 없이
// 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션). 모바일 expo-router 네이티브 라우트와
// 그 라우트가 호스팅하는 웹 페이지 URL 사이의 1:1 매핑 계약을 담는다.
//
// 단일 원칙: 모바일에서 화면을 바꾸는 주체는 expo-router 뿐이다. WebView 의 교차 라우트 이동은
// decideWebViewLoad(auth-bridge-core)가 이 모듈의 isCrossRoute 로 판정해 차단하고 네이티브 라우트로
// 디스패치한다. 인증 플로우 내부(/login, /auth/callback)는 앱 라우트가 아니므로 디스패치 대상이
// 아니며(WebView 내 유지), 기존 허용 규칙(MOBILE-001/002)이 그대로 적용된다(R-NC3).

/** 웹/앱 공통 라우트 식별자(M3 네비게이션 계약 — home/explore/notifications/profile). */
export type AppRoute = "home" | "explore" | "notifications" | "profile";

// 앱 라우트의 정확한 집합. 비-앱 경로(/login, /auth/callback, /me)와 중첩 경로(/home/123)는
// 포함되지 않는다 — routeForUrl 이 그것들을 null 로 처리해 디스패치 대상에서 제외한다.
// @MX:ANCHOR: [AUTO] 앱 라우트의 단일 진실 집합 — route-map-core 의 모든 매핑/디스패치 결정과
//             T-009 탭 래퍼·가드가 이 집합을 참조한다.
// @MX:REASON: 이 집합이 잘못되면 WebView↔네이티브 1:1 매핑(R-NC1)과 교차 라우트 차단(R-NC2)이
//             동시에 깨진다 — 라우트 추가/변경 시 반드시 검토.
export const APP_ROUTES: readonly AppRoute[] = [
  "home",
  "explore",
  "notifications",
  "profile",
] as const;

const APP_ROUTE_SET: ReadonlySet<string> = new Set<string>(APP_ROUTES);

/** URL 을 안전하게 파싱한다(실패 시 null) — malformed 입력에서 throw 하지 않는다. */
function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * URL 의 pathname 을 앱 라우트로 매핑한다(R-NC1). 매핑되지 않으면 null.
 *
 * 정확히 단일 세그먼트(/home, /explore 등)만 매핑한다. trailing slash 는 무시하고, query/hash 는
 * pathname 에 영향을 주지 않는다. 중첩 경로(/home/123)·비-앱 경로(/login, /auth/callback, /me)·
 * 루트(/)·malformed 입력은 null 이다 — 디스패치 대상에서 제외(R-NC3 인증 플로우 보존, R-AS5).
 *
 * @param url 판정할 절대 URL
 * @returns 매핑된 AppRoute, 매핑 불가/파싱 실패면 null
 * @MX:ANCHOR: [AUTO] URL→네이티브 라우트 매핑의 단일 진입점 — isCrossRoute·decideWebViewLoad·
 *             탭 래퍼가 호출(fan_in >= 3).
 * @MX:REASON: 이 함수의 매핑 범위가 넓어지면 인증 플로우 URL(/login 등)까지 디스패치되어 in-WebView
 *             로그인 흐름(R-PR2)이 깨지고, 좁아지면 교차 라우트 차단(R-NC2)이 누락된다.
 */
export function routeForUrl(url: string): AppRoute | null {
  const parsed = tryParseUrl(url);
  if (!parsed) {
    return null;
  }
  // pathname 을 단일 세그먼트로 정규화한다(선행 슬래시 제거 + trailing slash 무시).
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 1) {
    return null; // 루트(0 세그먼트)·중첩 경로(2+ 세그먼트)는 앱 라우트 아님.
  }
  const candidate = segments[0];
  return APP_ROUTE_SET.has(candidate) ? (candidate as AppRoute) : null;
}

/**
 * 앱 라우트가 호스팅하는 웹 URL 을 조립한다(R-NC1 — 탭 WebView 의 source URL).
 *
 * @param route 대상 앱 라우트
 * @param webUrl 호스팅 웹 base(WEB_URL — EXPO_PUBLIC_WEB_URL 파생)
 * @returns `${webUrl 호스트}/${route}` 형태의 절대 URL(중복 슬래시 없음)
 * @MX:ANCHOR: [AUTO] 네이티브 라우트→WebView source URL 매핑 — 탭 래퍼 4종(T-009)과
 *             교차 라우트 디스패치 후 재로드 경로가 호출(fan_in >= 3).
 * @MX:REASON: routeForUrl 과의 round-trip 1:1(urlForRoute→routeForUrl 동일 라우트)이 깨지면
 *             네이티브↔웹 라우트 계약(R-NC1)이 무너진다.
 */
export function urlForRoute(route: AppRoute, webUrl: string): string {
  // URL 생성자로 base 와 경로를 결합한다 — trailing slash 중복을 자동 정규화한다.
  return new URL(`/${route}`, webUrl).toString();
}

// ── SPEC-MOIM-003 중첩 detail 라우트(`/home/[id]`) 분류 (REQ-MOIM3-003) ───────────────
// routeForUrl 은 단일 세그먼트만 매핑하므로 /home/123 같은 2-세그먼트는 null 이다 — 그러면
// isCrossRoute 도 false 가 되어 decideWebViewLoad 가 WebView 자체 이동(trusted-load)으로 떨어진다
// (MOBILE-003 계약 위반). 아래 함수는 routeForUrl 동작을 보존하면서(회귀 0) 중첩 detail 분류를
// 별도 순수 함수로 추가한다. decideWebViewLoad 가 이를 push 디스패치 판정에 쓴다.

/** detailRouteForUrl 의 분류 결과 — detail 의 부모 앱 라우트 + id. */
export interface DetailRoute {
  /** detail 의 부모 앱 라우트(예: 홈 상세면 "home"). */
  route: AppRoute;
  /** detail id(URL-디코드된 경로 두 번째 세그먼트 — moim id 등). */
  id: string;
}

/**
 * URL 의 pathname 을 중첩 detail 라우트로 분류한다(REQ-MOIM3-003). 분류 불가면 null.
 *
 * 정확히 2 세그먼트이고 segment[0] 이 앱 라우트일 때 `{ route, id: segment[1] }` 를 반환한다.
 * trailing slash 는 무시하고, query/hash 는 pathname 에 영향을 주지 않는다. id 는 URL-디코드한다.
 * 단일 세그먼트(/home)·3+ 세그먼트(/moims/{id}/chat, /home/123/edit)·비-앱 prefix(/moims/{id},
 * /auth/callback)·루트(/)·malformed 입력은 null 이다 — push 디스패치 대상에서 제외.
 *
 * @param url 판정할 절대 URL
 * @returns 분류된 DetailRoute, 분류 불가/파싱 실패면 null
 * @MX:NOTE: [AUTO] URL→중첩 detail 라우트 분류의 단일 진입점 — decideWebViewLoad(detail push 판정)가 호출.
 *           분류 범위가 넓어지면 비-detail 경로(/moims/{id}/chat 등)까지 push 되어 MOBILE-003 인증/채팅
 *           흐름(R-NC3)이 깨지고, 좁아지면 홈 카드 탭의 detail push(REQ-MOIM3-003)가 누락된다.
 *           (파일당 ANCHOR 한도 3 준수 — 기존 APP_ROUTES/routeForUrl/urlForRoute 앵커 보존, fan_in 증가 시 승격.)
 */
export function detailRouteForUrl(url: string): DetailRoute | null {
  const parsed = tryParseUrl(url);
  if (!parsed) {
    return null;
  }
  // pathname 을 세그먼트 배열로 정규화한다(선행 슬래시 제거 + trailing slash 무시).
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 2) {
    return null; // 단일/3+ 세그먼트는 detail 아님.
  }
  const prefix = segments[0];
  if (!APP_ROUTE_SET.has(prefix)) {
    return null; // prefix 가 앱 라우트가 아니면 detail 디스패치 대상 아님(/moims/{id} 등).
  }
  // id 는 URL-디코드해 돌려준다(공백/특수문자 안전). 디코드 실패는 원본 세그먼트로 폴백한다.
  let id: string;
  try {
    id = decodeURIComponent(segments[1]);
  } catch {
    id = segments[1];
  }
  return { route: prefix as AppRoute, id };
}

/**
 * 중첩 detail 라우트가 호스팅하는 웹 URL 을 조립한다(REQ-MOIM3-003 — detail WebView 의 source URL).
 *
 * urlForRoute 와 일관된 URL 결합(URL 생성자)을 쓴다. id 는 URL-인코딩해 안전하게 결합한다.
 *
 * @param route detail 의 부모 앱 라우트
 * @param id detail id(moim id 등)
 * @param webUrl 호스팅 웹 base(WEB_URL)
 * @returns `${webUrl 호스트}/${route}/${encodeURIComponent(id)}` 형태의 절대 URL
 */
export function urlForDetailRoute(route: AppRoute, id: string, webUrl: string): string {
  return new URL(`/${route}/${encodeURIComponent(id)}`, webUrl).toString();
}

/**
 * 현재 WebView URL 에서 타깃 URL 로의 로드가 "교차 라우트 디스패치 대상"인지 판정한다(R-NC2/R-NC3).
 *
 * true 조건: 타깃이 앱 라우트로 매핑되고(routeForUrl != null) 그 라우트가 현재 라우트와 다를 때.
 * - 동일 라우트의 query/hash 변경(/home → /home?filter=x)은 false — WebView 내 그대로 유지.
 * - 타깃이 비-앱 경로(/login, /auth/callback, /me)·중첩 경로(/home/123)면 false — 디스패치 불가,
 *   인증 플로우 내부 기존 허용 규칙이 적용된다(R-NC3 예외).
 * - 현재가 비-앱 경로(/me)이고 타깃이 앱 라우트면 true — 디스패치 대상.
 * - malformed 입력은 throw 없이 safe false.
 *
 * @param currentUrl WebView 의 현재 navigation URL
 * @param targetUrl WebView 가 로드하려는 URL
 * @returns 교차 라우트 디스패치 대상이면 true
 * @MX:ANCHOR: [AUTO] 교차 라우트 차단/디스패치 판정의 단일 소스 — decideWebViewLoad 와
 *             onShouldStartLoadWithRequest 가드 래퍼가 호출(fan_in >= 3).
 * @MX:REASON: 잘못된 true 는 in-WebView 정상 네비게이션(동일 라우트 query 변경·인증 플로우)을
 *             차단하고, 잘못된 false 는 WebView 의 교차 라우트 자체 이동(R-NC3 금지)을 허용한다.
 */
export function isCrossRoute(currentUrl: string, targetUrl: string): boolean {
  const targetRoute = routeForUrl(targetUrl);
  if (targetRoute === null) {
    return false; // 타깃이 디스패치 가능한 앱 라우트가 아님 — 차단/디스패치 대상 아님.
  }
  return routeForUrl(currentUrl) !== targetRoute;
}
