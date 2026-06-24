// 무효 초대 처리 (Client Component, SPEC-MOIM-011 후속).
//
// 초대 수락 페이지(page.tsx)가 로드 시점에 초대를 무효(404 미지 / 410 만료·폐기)로 판정하면 폼 대신 이
// 컴포넌트를 렌더한다. 컨텍스트별로 분기한다:
//   - 앱(네이티브 WebView 셸): notifyInviteInvalid(loggedIn) 으로 네이티브에 위임 → 네이티브가
//     "유효하지 않은 초대입니다." Alert(backdrop 비활성) + (tabs)/home, 또는 (auth)/login 으로 라우팅.
//     웹은 자체 UI/네비게이션을 하지 않는다(중립 플레이스홀더만 — 폼 플래시 방지).
//   - 데스크톱/브라우저(브리지 없음): 로그인 사용자 → backdrop 비활성 웹 모달(확인 → /home),
//     미로그인 → /login 으로 즉시 이동.
//
// loggedIn = 실제 계정 세션 여부(서버에서 is_anonymous 로 판정해 내려줌 — 익명 게스트는 false).
"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { notifyInviteInvalid } from "@/lib/native-bridge/bridge-client";

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

  // 마운트당 1회만 부작용(브리지 전송/리다이렉트)을 수행한다(StrictMode 이중 실행 방어). setState 는 하지 않는다.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) {
      return;
    }
    handled.current = true;
    if (isInAppShell) {
      // 앱(WebView 셸): 네이티브가 Alert + 라우팅을 수행한다 — 웹은 UI/네비게이션 생략.
      notifyInviteInvalid(loggedIn);
      return;
    }
    if (!loggedIn) {
      // 데스크톱/브라우저 미로그인: 로그인 페이지로 즉시 이동(모달 없음).
      router.replace(ROUTE_LOGIN);
    }
    // 데스크톱/브라우저 + 로그인: 아래에서 모달을 선언적으로 렌더한다(effect 에서 setState 안 함).
  }, [isInAppShell, loggedIn, router]);

  // 모달 노출 = 데스크톱(브라우저) + 로그인 사용자. 앱(네이티브가 처리)·미로그인(리다이렉트 진행)은 플레이스홀더.
  const showModal = !isInAppShell && loggedIn;
  if (!showModal) {
    // 폼/내용 플래시 방지용 중립 플레이스홀더.
    return <main className="flex flex-1 items-center justify-center p-8" aria-hidden />;
  }

  // 데스크톱 + 로그인: backdrop 클릭 비활성 모달(닫힘은 "확인" 버튼만 → 메인 이동).
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="invite-invalid-title"
        // backdrop press 비활성: 오버레이에 닫기 핸들러를 두지 않는다(확인 버튼으로만 진행).
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      >
        <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <p
            id="invite-invalid-title"
            className="text-center text-base font-semibold text-gray-900"
          >
            유효하지 않은 초대입니다.
          </p>
          <button
            type="button"
            onClick={() => router.replace(ROUTE_MAIN)}
            className="mt-5 w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            확인
          </button>
        </div>
      </div>
    </main>
  );
}
