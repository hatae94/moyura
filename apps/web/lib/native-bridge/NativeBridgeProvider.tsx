// 네이티브 토큰 동기화 브리지 설치 컴포넌트 (SPEC-MOBILE-002 R-T3/R-T4) — root layout 에 마운트.
//
// 앱 셸(root layout)에 한 번 마운트되어, WebView 안에서 실행될 때만(window.ReactNativeWebView 가드)
// 네이티브 토큰 동기화 리스너를 설치한다(R-T3/R-T7/R-R1). 일반 브라우저에서는 install* 가 no-op cleanup
// 을 반환하므로 순수 웹 앱이 동일하게 동작한다(R-T4, AC-T4) — DOM 을 렌더하지 않는다.
//
// SPEC-MOBILE-003 F1(D-V2): 토큰 수신 리스너에 더해, 셸 모드 한정 로그인 announcement(onAuthStateChange
//   SIGNED_IN/TOKEN_REFRESHED → session:synced push)도 함께 설치한다. fresh in-WebView 로그인에서 웹이
//   먼저 토큰을 네이티브로 핸드오버해 SecureStore 시딩(세션 영속) + 로그인 전환을 신호 기반으로 만든다.
//
// 번들 최적화(First Load JS): session-bridge 는 @supabase/supabase-js(GoTrue+Realtime+Postgrest, ~238KB)
//   를 transitively 끌어온다. 그러나 supabase 는 네이티브 WebView(window.ReactNativeWebView)에서만 실제로
//   호출되므로, 일반 브라우저에서는 static import 를 제거하고 WebView 가드 통과 후에만 dynamic import("./session-bridge")
//   한다. 이로써 번들러가 session-bridge+supabase 를 별도 async chunk 로 분리하고, 순수 웹 라우트(/home 등)의
//   First Load JS 에서 supabase 가 빠진다(브라우저는 이 chunk 를 fetch 하지 않음). 동작은 양 환경 동일 —
//   브라우저는 여전히 no-op, WebView 는 동일 브리지 동작(로드 방식만 lazy 로 변경).
//   (supabase 무의존 시그널 google/invite/nav/cleared 은 bridge-signals.ts 로 분리 — 정적 진입점 번들에서 supabase 배제.)
"use client";

import { useEffect } from "react";

// session-bridge 를 더 이상 static import 하지 않으므로(supabase chunk 분리 목적), 가드 분기에 필요한
// Window.ReactNativeWebView 타입만 로컬로 재선언한다. import type 도 가능하나, runtime 코드를 전혀
// 끌어오지 않도록 최소 declare global 을 택한다(번들 영향 0). bridge-transport.ts 의 선언과 호환된다.
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

/**
 * 네이티브 셸 안에서 토큰 동기화 리스너 + 로그인 announcement 를 설치한다(R-T3 + F1). 일반 브라우저면
 * 아무것도 하지 않는다(no-op, R-T4) — session-bridge(=supabase) 를 import 조차 하지 않는다. 렌더 출력은
 * 없다(null) — 부수효과(등록/해제)만 담당한다.
 */
export function NativeBridgeProvider(): null {
  useEffect(() => {
    // R-T4 가드(앞당김): 일반 브라우저/SSR 이면 session-bridge 를 import 하기 전에 즉시 bail out 한다.
    // → 번들러가 session-bridge+supabase 를 async chunk 로 분리하고, 브라우저는 그 chunk 를 받지 않는다.
    if (typeof window === "undefined" || !window.ReactNativeWebView) {
      return;
    }

    // 비동기 cleanup 정확성: cleanup 이 dynamic import resolve 전에 돌 수 있다. cancelled 플래그 +
    // uninstall 함수 보관으로, (a) 이미 설치됐으면 cleanup 이 직접 해제하고 (b) 아직 import 중이면
    // .then() 이 즉시 해제하게 한다(리스너/구독 누수 방지).
    let cancelled = false;
    let uninstallBridge: (() => void) | null = null;
    let uninstallAnnouncer: (() => void) | null = null;

    void import("./session-bridge")
      .then(({ installNativeTokenBridge, installSessionAnnouncer }) => {
        if (cancelled) {
          return; // import 도중 unmount → 설치하지 않는다.
        }
        uninstallBridge = installNativeTokenBridge();
        uninstallAnnouncer = installSessionAnnouncer();
      })
      .catch(() => {
        // dynamic import 실패(네트워크/청크 로드 오류) — 브리지 미설치. 순수 웹 동작에는 영향 없고,
        // 네이티브 토큰 복원은 네이티브 측 bounded 재시도(R-T7)가 흡수한다. 토큰/에러 내용 미노출(R-V2).
      });

    return () => {
      cancelled = true;
      uninstallBridge?.();
      uninstallAnnouncer?.();
    };
  }, []);

  return null;
}
