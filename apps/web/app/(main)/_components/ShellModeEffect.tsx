// 셸 모드 감지 client effect (SPEC-MOBILE-003 F2 — D-V3 수정). 출력 없음(null).
//
// 배경(D-V3): (main)/layout.tsx 의 인라인 셸 감지 스크립트는 *전체 문서 로드* 시에만 동기 실행된다.
//   App Router soft-navigation(<Link> pushState, server-action redirect)으로 (main) 그룹에 진입하면
//   React 가 렌더한 인라인 <script> 는 재실행되지 않아 html[data-shell] 가 세팅되지 않는다 → 셸 모드에서
//   웹 하단 탭바가 그대로 노출(이중 탭바). 인라인 스크립트는 flash-free 초기 로드를 위해 그대로 유지하고,
//   client-side 라우트 전환을 이 effect 가 보강한다.
//
// 설정만(제거 로직 없음): 데스크톱 브라우저는 두 전역 모두 거짓이라 절대 세팅하지 않으며, 셸은 세션 내내
//   유지되므로 한 번 세팅하면 해제할 필요가 없다(인라인 스크립트와 동일 판정식).
"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** WebViewShell 이 injectedJavaScriptBeforeContentLoaded 로 콘텐츠 로드 전 세팅하는 셸 마커. */
    __MOYURA_NATIVE_SHELL__?: boolean;
  }
}

/**
 * 셸 모드(네이티브 WebView)면 html[data-shell="native"] 를 세팅한다(soft-nav 안전 보강 — F2).
 * 인라인 부트스트랩 스크립트(layout)와 동일 판정식이며, 데스크톱에서는 no-op(전역 미존재).
 */
export function ShellModeEffect(): null {
  useEffect(() => {
    if (window.__MOYURA_NATIVE_SHELL__ === true || !!window.ReactNativeWebView) {
      document.documentElement.dataset.shell = "native";
    }
  }, []);

  return null;
}
