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
"use client";

import { useEffect } from "react";

import { announceSessionFromCookies } from "@/lib/native-bridge/bridge-client";

/**
 * (main) mount 시 셸 모드면 쿠키 세션을 네이티브로 session:synced push 한다(F1'). 데스크톱은 no-op.
 * 렌더 출력은 없다(null) — 부수효과만 담당한다.
 */
export function ShellSessionAnnouncer(): null {
  useEffect(() => {
    // announceSessionFromCookies 는 브리지 없으면 no-op cleanup 을 돌려준다(순수 웹 무영향).
    const cancel = announceSessionFromCookies();
    return cancel;
  }, []);

  return null;
}
