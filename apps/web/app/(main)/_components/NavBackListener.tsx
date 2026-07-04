// 웹측 nav:back 리스너 마운트 client effect (SPEC-MOBILE-NAV-001 REQ-MOBNAV-020/021).
//
// 네이티브 헤더 back chevron 탭 / Android 하드웨어 web-back 시 네이티브가 브리지로 nav:back 을 post 한다
// (mobile useAuthBridge.injectNavBack). 그 신호를 웹이 수신해 in-app back(router.back()) 또는 딥링크 첫
// 진입 시 /home 폴백(router.replace)을 실행해야 헤더 back 이 실제로 동작한다. bridge-client.installNavBackListener
// 가 수신/판정(history.length)을 담당하지만 순수 비-React 모듈이라 useRouter 훅을 직접 못 쓴다 — 이 컴포넌트가
// Next router 를 NavBackNavigator 어댑터로 주입해 라우팅 소유권을 호출부에 둔다(NavStateReporter 가 usePathname
// 을 소유하듯). 이 마운트가 없으면 네이티브가 보낸 nav:back 을 수신할 핸들러가 없어 헤더 back 이 무동작한다
// (useAuthBridge @MX:WARN 의 "핸들러 미등록" 경계).
//
// 셸 모드 전용: installNavBackListener 가 getNativeBridge() 가드로 데스크톱에서는 no-op 이다(REQ-MOBNAV-010).
// 번들 최적화(ShellSessionAnnouncer 와 동형): bridge-client 는 @supabase/supabase-js 를 transitively 끌어오므로
//   런타임 static import 를 피하고 WebView 가드 통과 후에만 dynamic import 한다 → 순수 웹 First Load JS 에서
//   supabase 를 async chunk 로 분리한다. NavBackNavigator 는 import type(런타임 미포함)으로만 참조한다.
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import type { NavBackNavigator } from "@/lib/native-bridge/bridge-client";

// bridge-client 를 런타임 static import 하지 않으므로(supabase chunk 분리), 가드 분기용 Window 타입만 로컬 재선언한다.
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

/**
 * 셸 모드면 네이티브 nav:back 을 수신해 in-app back/폴백을 실행하는 리스너를 마운트한다(REQ-MOBNAV-020/021).
 * 데스크톱은 import 조차 하지 않는 no-op. 렌더 출력은 없다(null) — 부수효과만 담당한다.
 */
export function NavBackListener(): null {
  // App Router useRouter() 는 렌더 간 안정 참조라 effect 는 마운트당 1회만 재실행된다(deps=[router] 는
  // 사실상 [] — exhaustive-deps 를 만족시키면서 재구독을 유발하지 않는다). router 를 effect 클로저에서 직접
  // 소비해 라우팅 소유권을 살아있는 router 에 둔다(별도 ref 우회 불필요 — react-hooks/refs 준수).
  const router = useRouter();

  useEffect(() => {
    // R-T4 가드(앞당김): 일반 브라우저/SSR 이면 bridge-client 를 import 하기 전에 즉시 bail out.
    if (typeof window === "undefined" || !window.ReactNativeWebView) {
      return;
    }

    let cancelled = false;
    let uninstall: (() => void) | null = null;

    // REQ-MOBNAV-020/021: nav:back → in-app 히스토리 있으면 router.back(), 딥링크 첫 진입이면 /home 폴백.
    //   판정(window.history.length)은 bridge-client.installNavBackListener 가 소유한다 — 여기선 router 만 위임한다.
    const navigate: NavBackNavigator = {
      back: () => router.back(),
      replace: (path) => router.replace(path),
    };

    void import("@/lib/native-bridge/bridge-client")
      .then(({ installNavBackListener }) => {
        if (cancelled) {
          return; // import 도중 unmount → 리스너 설치하지 않는다.
        }
        uninstall = installNavBackListener(navigate);
      })
      .catch(() => {
        // dynamic import 실패 — 리스너 미설치(순수 웹 무영향). 에러 내용 미노출(R-V2).
      });

    return () => {
      cancelled = true;
      uninstall?.(); // window message 리스너 해제(설치됐으면).
    };
  }, [router]);

  return null;
}
