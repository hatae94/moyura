// 무효 초대 처리 (Client Component, SPEC-MOIM-011 후속).
//
// 초대 수락 페이지(page.tsx)가 로드 시점에 초대를 무효(404 미지 / 410 만료·폐기)로 판정하면 폼 대신 이
// 컴포넌트를 렌더한다. 컨텍스트별로 분기한다:
//   - 앱(네이티브 WebView 셸): notifyInviteInvalid(loggedIn) 으로 네이티브에 위임 → 네이티브가
//     "유효하지 않은 초대입니다." Alert(backdrop 비활성) → 확인 시 (tabs)/home 또는 (auth)/login 으로 라우팅.
//     웹은 자체 UI/네비게이션을 하지 않는다(중립 플레이스홀더만 — 폼 플래시 방지).
//   - 데스크톱/브라우저(브리지 없음): 로그인 여부와 무관하게 backdrop 비활성 웹 모달로 동일 안내를 띄우고,
//     확인 시 로그인 사용자 → /home, 미로그인/익명 → /login 으로 이동한다. 미로그인도 조용히 리다이렉트하지
//     않고 무효 사유를 먼저 보여준다(UX).
//
// loggedIn = 실제 계정 세션 여부(서버에서 is_anonymous 로 판정해 내려줌 — 익명 게스트는 false).
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { notifyInviteInvalid } from "@/lib/native-bridge/bridge-signals";

// 웹(데스크톱) 폴백 라우트. 앱에서는 네이티브가 (tabs)/home, (auth)/login 으로 전환한다.
const ROUTE_MAIN = "/home";
const ROUTE_LOGIN = "/login";

export function InviteInvalidHandler({ loggedIn }: { loggedIn: boolean }) {
  const router = useRouter();

  // 네이티브 셸(WebView) 안에서 실행 중인지 — window.ReactNativeWebView 존재로 판별(invite-accept-form 과
  // 동일). useSyncExternalStore 로 서버 스냅샷=false, 클라이언트 스냅샷=판정 → SSR 불일치/effect-내 setState
  // 안티패턴(react-hooks/set-state-in-effect) 없이 클라이언트에서만 셸 여부를 반영한다.
  const isInAppShell = useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && window.ReactNativeWebView != null,
    () => false,
  );

  // 앱(셸)일 때만 마운트당 1회 브리지로 위임한다(StrictMode 이중 실행 방어). 브라우저는 아래 모달을
  // 선언적으로 렌더하므로 effect 에서 setState/라우팅을 하지 않는다.
  const notified = useRef(false);
  useEffect(() => {
    if (isInAppShell && !notified.current) {
      notified.current = true;
      // 앱: 네이티브가 Alert + 라우팅을 수행한다 — 웹은 UI/네비게이션 생략.
      notifyInviteInvalid(loggedIn);
    }
  }, [isInAppShell, loggedIn]);

  // 앱(네이티브가 처리 중)에서는 중립 플레이스홀더(폼/내용 플래시 방지). 브라우저는 항상 모달을 띄운다.
  if (isInAppShell) {
    return <main className="flex flex-1 items-center justify-center p-8" aria-hidden />;
  }

  // 데스크톱/브라우저: 로그인 여부와 무관하게 backdrop 비활성 모달(닫힘은 "확인" 버튼만).
  // 확인 시 목적지: 로그인 사용자 → 메인(/home), 미로그인/익명 → 로그인(/login).
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="invite-invalid-title"
        // backdrop press 비활성: 오버레이에 닫기 핸들러를 두지 않는다(확인 버튼으로만 진행).
        className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      >
        <div className="animate-scale-in mx-4 w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
          <p id="invite-invalid-title" className="text-center text-base font-bold text-foreground">
            유효하지 않은 초대입니다.
          </p>
          <button
            type="button"
            onClick={() => router.replace(loggedIn ? ROUTE_MAIN : ROUTE_LOGIN)}
            className="bg-gradient-brand mt-5 w-full rounded-2xl py-3 text-sm font-bold text-white shadow-md shadow-primary/20 transition-transform active:scale-[0.98]"
          >
            확인
          </button>
        </div>
      </div>
    </main>
  );
}
