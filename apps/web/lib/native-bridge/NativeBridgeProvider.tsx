// 네이티브 토큰 동기화 브리지 설치 컴포넌트 (SPEC-MOBILE-002 R-T3/R-T4) — root layout 에 마운트.
//
// 앱 셸(root layout)에 한 번 마운트되어, WebView 안에서 실행될 때만(window.ReactNativeWebView 가드)
// 네이티브 토큰 동기화 리스너를 설치한다(R-T3/R-T7/R-R1). 일반 브라우저에서는 install* 가 no-op cleanup
// 을 반환하므로 순수 웹 앱이 동일하게 동작한다(R-T4, AC-T4) — DOM 을 렌더하지 않는다.
//
// SPEC-MOBILE-003 F1(D-V2): 토큰 수신 리스너에 더해, 셸 모드 한정 로그인 announcement(onAuthStateChange
//   SIGNED_IN/TOKEN_REFRESHED → session:synced push)도 함께 설치한다. fresh in-WebView 로그인에서 웹이
//   먼저 토큰을 네이티브로 핸드오버해 SecureStore 시딩(세션 영속) + 로그인 전환을 신호 기반으로 만든다.
"use client";

import { useEffect } from "react";

import { installNativeTokenBridge, installSessionAnnouncer } from "./bridge-client";

/**
 * 네이티브 셸 안에서 토큰 동기화 리스너 + 로그인 announcement 를 설치한다(R-T3 + F1). 일반 브라우저면
 * 양쪽 모두 no-op(R-T4). 렌더 출력은 없다(null) — 부수효과(등록/해제)만 담당한다.
 */
export function NativeBridgeProvider(): null {
  useEffect(() => {
    // install* 는 브리지 없으면 no-op cleanup 을 돌려준다(순수 웹 무영향).
    const uninstallBridge = installNativeTokenBridge();
    const uninstallAnnouncer = installSessionAnnouncer();
    return () => {
      uninstallBridge();
      uninstallAnnouncer();
    };
  }, []);

  return null;
}
