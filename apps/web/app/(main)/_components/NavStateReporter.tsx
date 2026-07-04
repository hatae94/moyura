// 웹측 nav 상태 리포터 client effect (SPEC-MOBILE-NAV-001 M2 — REQ-MOBNAV-010/012).
//
// route 변경마다 웹이 자신의 nav 상태({pathname, title, canGoBack})를 브리지 nav:state 로 네이티브에
// 보고한다(단일 진실 출처 = 웹). 네이티브는 이 보고만 소비해 헤더 바(back chevron + title)를 그린다
// (mobile/lib/nav-header-core.ts decideHeader). ShellModeEffect.tsx 와 동형 client effect 패턴이며,
// 데스크톱 브라우저에서는 브리지가 부재하므로 no-op 이다(REQ-MOBNAV-010).
//
// 관측 방식(SPIKE — REQ-MOBNAV-013 / OD-4, spike-nav-observation.md): usePathname() + useEffect([pathname])
//   단일 메커니즘으로 세 내비 유형(<Link> 클릭 · router.push() · Server Action redirect)을 누락 없이
//   포착한다. 세 유형 전부 App Router 의 단일 수렴점(canonicalUrl)을 통과하고, usePathname 은 그 상태에서
//   파생된 PathnameContext 를 구독하므로 pathname 변경 시 리렌더가 보장된다. Next 16 엔 모든 내비를
//   가로채는 공개 router-events / Link onNavigate 대체 API 가 없으며(onNavigate 는 <Link> 클릭만 잡아
//   router.push·redirect 를 누락), 그럴 필요도 없다 — usePathname 이 세 유형을 전부 커버한다.
//
// 셸 판정식은 ShellModeEffect 와 동일하게 전역 플래그(window.__MOYURA_NATIVE_SHELL__ / ReactNativeWebView)를
//   직접 읽는다(html[data-shell] 속성이 아니라 — soft-nav 시 data-shell 세팅 타이밍에 독립적, spike §4.1).
"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import {
  type NavStatePayload,
  serializeNavState,
} from "@/lib/native-bridge/bridge-protocol";

// window 전역은 프로젝트 전역에서 이미 타입 증강되어 있다(ShellModeEffect: __MOYURA_NATIVE_SHELL__,
// bridge-client: ReactNativeWebView / __MOYURA_BRIDGE_NONCE__). 여기서는 재선언하지 않고 그대로 참조한다.

// 헤더 필요 5페이지의 route-derived 타이틀(REQ-MOBNAV-012 — document.title 비의존, route 데이터 산출).
//
// 한계(plan §4.2 명시): 모임명(/home/[id] 등의 실제 이름)은 각 페이지가 서버/클라이언트에서 개별 조회하며
//   layout 레벨의 이 리포터(usePathname 만 보유)에서는 추가 API 호출 없이 얻을 수 없다. 따라서 각 페이지의
//   기능 라벨(페이지 자체 <h1> 과 동일 시맨틱)을 route 에서 산출해 보고한다. 실제 모임명 보고가 필요하면
//   후속으로 각 페이지가 nav:state 를 직접 재보고하는 방식으로 확장할 수 있다(현 SPEC 범위 밖).
// 비-헤더 route(탭 루트·/me·/invite 등)는 빈 타이틀 — 네이티브 decideHeader 가 헤더를 숨기므로 미사용.
function deriveTitle(pathname: string): string {
  // query/hash 를 잘라낸 뒤 세그먼트로 분해한다(nav-header-core.pathSegments 와 동일 정규화).
  const segments = (pathname.split(/[?#]/, 1)[0] ?? "")
    .split("/")
    .filter((s) => s.length > 0);

  if (segments.length === 2) {
    const [first, second] = segments;
    if (first === "home") {
      return "모임 상세"; // /home/{id} — 모임 상세(모임명은 layout 레벨 미가용, 한계 주석 참조).
    }
    if (first === "moims" && second === "new") {
      return "새 모임 만들기"; // /moims/new — create-moim-form.tsx <h1> 과 동일.
    }
    return "";
  }

  if (segments.length === 3 && segments[0] === "moims") {
    switch (segments[2]) {
      case "chat":
        return "모임 채팅"; // chat/page.tsx <h1> 과 동일.
      case "schedule":
        return "일정 조율"; // schedule 기능 라벨.
      case "expenses":
        return "경비 관리"; // expenses-view.tsx <h1> 과 동일.
      default:
        return "";
    }
  }

  return ""; // 0/1세그먼트(루트·탭 루트·/me·/invite) 및 4+세그먼트 — 헤더 없음(빈 타이틀).
}

/**
 * 셸 모드(네이티브 WebView)면 route 변경마다 nav:state({pathname,title,canGoBack})를 네이티브로 보고한다
 * (SPEC-MOBILE-NAV-001 REQ-MOBNAV-010/012). 데스크톱 브라우저에서는 no-op(브리지 미존재).
 *
 * @MX:NOTE: [AUTO] nav 관측 = usePathname + useEffect([pathname]) 단일 메커니즘(SPIKE 확정 —
 *           spike-nav-observation.md §4·§7). Link onNavigate/router-events 도입 금지(세 유형 중 일부
 *           누락). 셸 판정은 전역 플래그 직접 읽기(data-shell 속성 타이밍 독립 — spike §4.1). title 은
 *           route-derived(REQ-MOBNAV-012 — document.title 비의존), 모임명은 layout 레벨 미가용(한계 주석).
 */
export function NavStateReporter(): null {
  // usePathname 은 세 내비 유형(Link/router.push/Server Action redirect)의 공통 수렴점(canonicalUrl)을
  // 구독하므로 pathname 변경마다 이 컴포넌트가 리렌더된다(관측 단일 진입점).
  const pathname = usePathname();

  useEffect(() => {
    const bridge = window.ReactNativeWebView;
    // 셸 판정식 — ShellModeEffect 와 동일(전역 플래그 직접 읽기). 데스크톱은 둘 다 거짓 → no-op.
    const isShell = window.__MOYURA_NATIVE_SHELL__ === true || !!bridge;
    if (!isShell || !bridge) {
      return; // 데스크톱 브라우저 — 브리지 부재(순수 웹 무영향, REQ-MOBNAV-010).
    }

    // per-session nonce(네이티브가 injectedJavaScriptBeforeContentLoaded 로 확립 — R-T8). 미확립이면
    // 네이티브가 어차피 인증에 실패해 무시하므로 skip 한다(bridge-client announceTokens 가드와 동형).
    const nonce = window.__MOYURA_BRIDGE_NONCE__ ?? "";
    if (!nonce) {
      return;
    }

    const payload: NavStatePayload = {
      pathname,
      title: deriveTitle(pathname),
      // in-app 히스토리 back 가능 여부(canGoBack — REQ-MOBNAV-002). history.length > 1 이면 이전 route 존재.
      // 딥링크 첫 진입(history.length === 1)이면 false → 네이티브가 chevron 을 숨긴다. 권위 있는 폴백
      // (히스토리 없을 때 /home replace — REQ-MOBNAV-021)은 nav:back 핸들러가 소유한다(별도 태스크).
      canGoBack: window.history.length > 1,
    };
    // serializeNavState 는 bridge-protocol 의 순수 직렬화 헬퍼(nonce 봉투 재사용, additive v1 nav 채널).
    bridge.postMessage(serializeNavState(payload, nonce));
  }, [pathname]);

  return null;
}
