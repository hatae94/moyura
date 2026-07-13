// 네이티브 헤더 크롬 렌더의 순수 결정 로직 (SPEC-MOBILE-NAV-001 M1 — REQ-MOBNAV-001/002/003).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 함수/상수만 제공한다 — vitest node 환경에서 mock 없이
// 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션, route-map-core.ts/app-lifecycle-core.ts
// 와 동일 seam). 웹이 브리지 nav:state 로 보고한 nav 상태를 소비해 헤더 렌더 결정만 내린다.
//
// 단일 진실 출처 = 웹(plan §2.2). 타이틀(모임명 등)·canGoBack 은 웹이 소유하고 네이티브는 헤더를
// 그리기만 한다 — 이 모듈은 "그 pathname 에서 헤더를 그릴지, chevron 을 보일지"만 판정하며
// title 은 가공 없이 통과시킨다(REQ-MOBNAV-012 정합 — document.title 비의존, 웹 route 데이터 산출).

/** 웹이 nav:state 로 보고하는 nav 상태(브리지 payload). */
export interface NavState {
  /** 웹이 보고한 현재 pathname(query/hash 포함 가능 — 세그먼트 매칭 시 정규화). */
  pathname: string;
  /** 웹 route 데이터에서 산출한 컨텍스트 타이틀(모임명 등). document.title 비의존(REQ-MOBNAV-012). */
  title: string;
  /** in-app 히스토리 back 가능 여부(웹이 history.length/router 로 판정 — canGoBack). */
  canGoBack: boolean;
}

/** decideHeader 결정 결과 — NativeHeaderBar 가 소비하는 렌더 상태. */
export interface HeaderDecision {
  /** 헤더 바를 렌더할지(헤더 필요 5페이지에서만 true — REQ-MOBNAV-001/003). */
  headerVisible: boolean;
  /** back chevron 을 상호작용 어포던스로 표시할지(headerVisible + canGoBack — REQ-MOBNAV-002). */
  showBackChevron: boolean;
  /** 헤더에 그릴 타이틀(웹 보고 title 그대로 통과 — 네이티브 미가공). */
  headerTitle: string;
}

// 헤더 필요 5페이지(REQ-MOBNAV-001)의 세그먼트 규칙(§Exclusions 와 1:1).
// route-map-core 의 routeForUrl 은 home/explore/notifications/profile 앱 라우트 계약을 담을 뿐
// (중첩 경로 /home/{id}·3세그먼트 moims/* 는 그쪽에서 null) 헤더 판정 범위와 다르다 — 그래서 헤더
// 5페이지는 별도 세그먼트 매칭으로 판정한다(plan §4.1).
//   2세그먼트: /home/{id}, /moims/new
//   3세그먼트: /moims/{id}/{sub} where sub ∈ {chat, schedule, expenses}
const MOIMS_SUB_HEADER_PAGES: ReadonlySet<string> = new Set<string>([
  "chat",
  "schedule",
  "expenses",
]);

/**
 * pathname 을 세그먼트 배열로 정규화한다 — 선행 슬래시 제거 + trailing slash 무시 + query/hash 제거.
 * malformed 입력에서도 throw 하지 않는다(빈 배열 폴백).
 */
function pathSegments(pathname: string): string[] {
  // query/hash 를 잘라낸 뒤 세그먼트로 분해한다(웹이 raw pathname 을 보내지 않을 수 있어 방어).
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? "";
  return withoutQuery.split("/").filter((s) => s.length > 0);
}

/**
 * pathname 이 헤더 필요 5페이지 중 하나인지 판정한다(REQ-MOBNAV-001/003).
 *
 * - 2세그먼트 `/home/{id}`  → true (모임 상세). `/home/{id}/edit` 등 3세그먼트 home/* 는 false.
 * - 2세그먼트 `/moims/new`  → true (새 모임). `/moims/{id}` 자체는 웹 라우트 아님(홈 상세는 /home/*) → false.
 * - 3세그먼트 `/moims/{id}/{sub}` where sub ∈ {chat, schedule, expenses} → true.
 * - 그 외(탭 루트·보류 3페이지·루트·미매칭)는 false.
 */
function isHeaderPage(pathname: string): boolean {
  const segments = pathSegments(pathname);

  if (segments.length === 2) {
    const [first, second] = segments;
    if (first === "home") {
      return true; // /home/{id} — 모임 상세.
    }
    if (first === "moims" && second === "new") {
      return true; // /moims/new — 새 모임 만들기.
    }
    return false; // /moims/{id}(웹 라우트 아님)·/invite/{token}·기타 2세그먼트 제외.
  }

  if (segments.length === 3) {
    const [first, , third] = segments;
    return first === "moims" && MOIMS_SUB_HEADER_PAGES.has(third);
  }

  return false; // 0/1세그먼트(루트·탭 루트·/me·/invite) 및 4+세그먼트는 헤더 없음.
}

/**
 * 웹 nav 상태로부터 네이티브 헤더 렌더 결정을 내린다(REQ-MOBNAV-001/002/003, 012 정합).
 *
 * - headerVisible: 헤더 필요 5페이지에서만 true(탭 루트·보류 3페이지는 false — REQ-MOBNAV-003).
 * - showBackChevron: 헤더가 보이고(headerVisible) 웹이 in-app back 가능(canGoBack)이라 보고할 때만 true.
 *   헤더 없는 라우트에서는 항상 false(헤더 자체가 없으므로 chevron 도 없음).
 * - headerTitle: 웹 보고 title 을 가공 없이 통과(단일 진실 출처 = 웹).
 *
 * @param state 웹이 nav:state 로 보고한 {pathname, title, canGoBack}
 * @returns NativeHeaderBar 가 소비할 {headerVisible, showBackChevron, headerTitle}
 * @MX:NOTE: [AUTO] 네이티브 헤더 렌더 결정의 단일 진입점 — NativeHeaderBar(가시성·chevron·title 렌더)와
 *           BridgedWebView(헤더 오버레이 gating + WebViewShell edges 이중 top 인셋 조정)가 소비한다
 *           (Phase 3 배선 완료 — fan_in=2, 테스트 포함). 판정 범위가 넓어지면 탭 루트/보류 페이지에 헤더가
 *           오노출되고(REQ-MOBNAV-003 위반), 좁아지면 5페이지 중 일부에서 back affordance 가 누락된다
 *           (이 SPEC 의 원 버그 재발). fan_in < 3 이라 NOTE 유지(ANCHOR 임계 미달) — 3번째 소비자
 *           추가 시 ANCHOR 승격 검토(파일당 ANCHOR 한도 3 준수).
 */
export function decideHeader(state: NavState): HeaderDecision {
  const headerVisible = isHeaderPage(state.pathname);
  return {
    headerVisible,
    // 헤더가 보일 때만 chevron 을 평가한다 — 숨김 라우트에서는 canGoBack 과 무관하게 false.
    showBackChevron: headerVisible && state.canGoBack,
    headerTitle: state.title,
  };
}
