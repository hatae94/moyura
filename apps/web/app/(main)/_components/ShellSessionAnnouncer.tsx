// (main) 진입 시 쿠키 세션을 네이티브로 핸드오버하는 client effect (SPEC-MOBILE-003 F1' — D-V2 재수정).
// 출력 없음(null).
//
// 배경(F1 onAuthStateChange announcer 가 server-action 로그인에 안 먹은 이유): 이메일 로그인은
//   SERVER ACTION(signInAction)으로 서버에서 signInWithPassword → 쿠키 세션을 확립한다. 브라우저 supabase
//   클라이언트는 로그인을 수행하지 않으므로 WebView 안에서 onAuthStateChange 가 SIGNED_IN 을 발생시키지
//   않는다 → 네이티브가 토큰을 못 받아 (tabs) 미마운트. (main) 진입은 서버 검증 세션을 의미하므로((main)
//   layout 가드가 세션 없으면 /login redirect), 여기서 쿠키 세션을 읽어 직접 announce 한다.
//
// 셸 모드 전용: announceSessionFromCookies 가 getNativeBridge() 가드로 데스크톱에서는 no-op 이다.
// soft-nav 로 (main) 내부를 이동할 때마다 effect 가 재실행될 수 있으나, dedupe(lastAnnouncedAccessToken)가
// 동일 토큰 중복 발신을 억제하고 네이티브 save 분기는 멱등이라 무해하다.
//
// 번들 최적화(First Load JS): session-bridge 는 @supabase/supabase-js 를 transitively 끌어온다. 이 컴포넌트는
//   (main) layout 에 마운트되어 /home·/explore·/notifications·/profile 모든 페이지에 실린다. announceSessionFromCookies
//   는 네이티브 WebView 에서만 실제 동작하므로, static import 를 제거하고 WebView 가드 통과 후에만 dynamic
//   import 한다 → 번들러가 supabase 를 async chunk 로 분리, 순수 웹의 (main) First Load JS 에서 supabase 제거.
"use client";

import { useEffect } from "react";

// session-bridge 를 static import 하지 않으므로(supabase chunk 분리), 가드 분기용 Window 타입만 로컬 재선언한다.
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
  }
}

/**
 * (main) mount 시 셸 모드면 쿠키 세션을 네이티브로 session:synced push 한다(F1'). 데스크톱은 import 조차
 * 하지 않는 no-op. 렌더 출력은 없다(null) — 부수효과만 담당한다.
 */
export function ShellSessionAnnouncer(): null {
  useEffect(() => {
    // R-T4 가드(앞당김): 일반 브라우저/SSR 이면 session-bridge 를 import 하기 전에 즉시 bail out.
    if (typeof window === "undefined" || !window.ReactNativeWebView) {
      return;
    }

    // 비동기 cleanup 정확성: announceSessionFromCookies 가 돌려주는 cancel(in-flight getSession 무시용)을
    // 보관해 (a) 이미 호출됐으면 cleanup 이 직접 cancel, (b) 아직 import 중이면 cancelled 플래그로 .then()
    // 이 announce 자체를 건너뛰게 한다.
    let cancelled = false;
    let cancel: (() => void) | null = null;

    void import("@/lib/native-bridge/session-bridge")
      .then(({ announceSessionFromCookies }) => {
        if (cancelled) {
          return; // import 도중 unmount → announce 시작하지 않는다.
        }
        cancel = announceSessionFromCookies();
      })
      .catch(() => {
        // dynamic import 실패 — announce 생략(순수 웹 무영향). 토큰/에러 내용 미노출(R-V2).
      });

    return () => {
      cancelled = true;
      cancel?.();
    };
  }, []);

  return null;
}
