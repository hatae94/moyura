// 로그아웃 토큰 클리어 통지 컴포넌트 (SPEC-MOBILE-002 R-R2/OD-10) — /login 에 마운트.
//
// signOutAction 은 Server Action 이고 signOut() 직후 server redirect("/login") 하므로(actions.ts:69-73),
// client JS 가 실행될 기회가 그 본문 안에는 없다(H-2). 따라서 redirect 가 완료된 안정 시점 — /login
// 도착 후 client mount — 에서 session:cleared 를 1회 post 한다(OD-10 택일: /login mount 지점).
//
// 일반 브라우저에서는 notifyNativeSessionCleared 가 no-op 이므로(R-T4) 순수 웹 동작에 영향이 없다.
// 렌더 출력은 없다(null) — 마운트 부수효과(emit)만 담당한다.
"use client";

import { useEffect } from "react";

import { notifyNativeSessionCleared } from "./bridge-client";

/**
 * /login 도착 시 네이티브에 session:cleared 를 1회 post 한다(R-R2/OD-10). 일반 브라우저면 no-op(R-T4).
 *
 * 주의: /login 은 로그아웃 후뿐 아니라 일반 진입(미인증 콜드스타트 R-N5)에서도 마운트된다. 그 경우에도
 * session:cleared 를 보내는 것은 안전하다 — 네이티브는 clearTokens()(R-R3)를 실행해 stale 토큰을
 * 정리하며, 이미 비어 있으면 no-op 이다(SecureStore 삭제는 멱등). 콜드스타트 핸드셰이크 결과(synced/none)
 * 와 별개 채널이므로 스플래시 해제(R-N4)에는 영향을 주지 않는다(cleared 는 콜드스타트 결과 아님 — M-1).
 */
export function LogoutBridgeNotifier(): null {
  useEffect(() => {
    notifyNativeSessionCleared();
  }, []);

  return null;
}
