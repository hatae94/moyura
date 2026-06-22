// 게스트 초대 랜딩 페이지 (Client Component, SPEC-MOIM-002 REQ-INV-007 / AC-8).
//
// @MX:NOTE: 세션 없는 방문자 → 익명 로그인(signInAnonymously)으로 실제 sub 세션 확보 → nickname 입력 →
// 백엔드 POST /invites/:token/accept 제출 → 성공 시 /moims/:id/chat 리다이렉트. 익명 sub도 검증 가능한
// JWT라 백엔드 가드/RLS/FK는 무수정 동작한다(REQ-INV-007 전제). 세션은 쿠키 기반 → 쿠키 삭제 시 소실되고
// 같은 링크 재방문은 "새 익명 sub = 새 게스트"가 되어 기존 멤버십과 분리된다(문서화된 제약, 버그 아님).
//
// 리다이렉트 대상 /moims/[id]/chat 화면은 SPEC-CHAT-001 범위(미구현)다 — 경로는 문자열이라 web build는
// 깨지지 않는다(문서화된 cross-SPEC 의존). 채팅 화면이 생기면 그대로 동작한다.
"use client";

import { use, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { submitAccept } from "@/lib/invite/accept";
import { createClient } from "@/lib/supabase/client";

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Client Component page는 React use()로 params Promise를 푼다(Next 16 — params는 Promise).
  const { token } = use(params);
  const router = useRouter();

  const [nickname, setNickname] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SPEC-MOIM-011 REQ-MOIM11-005: 모바일 브라우저에서만 "앱에서 열기" 버튼을 노출한다. useSyncExternalStore 로
  // 서버 스냅샷=false, 클라이언트 스냅샷=userAgent 판정 → SSR 불일치 없이(effect-내 setState 안티패턴 회피)
  // 클라이언트에서만 모바일 판정을 반영한다(react-hooks/set-state-in-effect 회피, React 권장 패턴).
  const isMobile = useSyncExternalStore(
    () => () => {},
    () => /iphone|ipad|ipod|android/i.test(navigator.userAgent),
    () => false,
  );

  // SPEC-MOIM-011: 네이티브 셸(WebView) 안에서 실행 중인지 — window.ReactNativeWebView 존재로 판별
  // (bridge-client.ts 의 getNativeBridge 가드와 동일). 셸 안에서는 이미 앱이므로 딥링크 자동 열기를
  // 하지 않는다(앱 안에서 다시 앱을 여는 재진입 루프 방지). useSyncExternalStore 로 SSR 불일치 회피.
  const isInAppShell = useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && window.ReactNativeWebView != null,
    () => false,
  );

  // 커스텀 스킴으로 앱 열기 시도. 앱 미설치면 스킴이 no-op 이라 아래 웹 수락 폼으로 그대로 진행한다(폴백).
  function openInApp(): void {
    window.location.href = `moyura://invite/${encodeURIComponent(token)}`;
  }

  // SPEC-MOIM-011: 모바일 브라우저(앱 셸 아님)에서는 페이지 로드 시 앱 열기를 1회 자동 시도한다 —
  // 버튼을 한 번 더 누르지 않아도 앱 설치 시 바로 열리도록. 앱 미설치면 스킴이 no-op(또는 OS 안내)이라
  // 아래 웹 수락 폼으로 폴백한다. ref 가드로 마운트당 1회만 발화하고, "앱에서 열기" 버튼은 자동 시도가
  // 차단됐거나 사용자가 앱에서 되돌아온 경우의 수동 재시도로 남긴다.
  const autoOpenAttempted = useRef(false);
  useEffect(() => {
    if (autoOpenAttempted.current) return;
    if (isMobile && !isInAppShell) {
      autoOpenAttempted.current = true;
      window.location.href = `moyura://invite/${encodeURIComponent(token)}`;
    }
  }, [isMobile, isInAppShell, token]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = nickname.trim();
    if (!trimmed) {
      setError("닉네임을 입력해주세요.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const supabase = createClient();

      // 세션이 없으면 익명 로그인으로 실제 sub 세션을 확보한다(REQ-INV-007).
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        const { error: anonError } = await supabase.auth.signInAnonymously();
        if (anonError) {
          setError("게스트 로그인에 실패했습니다. 다시 시도해주세요.");
          return;
        }
      }

      // 확보된(또는 기존) 세션의 access_token을 Bearer로 주입하는 api-client.
      const api = createApiClient({
        baseUrl: API_BASE_URL,
        getToken: async () => {
          const {
            data: { session: s },
          } = await supabase.auth.getSession();
          return s?.access_token;
        },
      });

      const outcome = await submitAccept(api, token, trimmed);
      if (outcome.kind === "error") {
        setError(outcome.message);
        return;
      }

      // 가입 성공 → 대상 모임의 채팅 화면으로 이동(SPEC-CHAT-001, 미구현 — cross-SPEC 의존).
      router.replace(`/moims/${outcome.moimId}/chat`);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">모임 초대</h1>
        <p className="text-gray-600 text-center mb-8">
          닉네임을 입력하고 모임에 참여하세요.
        </p>

        {/* SPEC-MOIM-011: 모바일이면 앱으로 여는 버튼을 먼저 제안한다(앱 미설치 시 아래 웹 수락 폼으로 폴백). */}
        {isMobile && !isInAppShell ? (
          <div className="mb-6">
            <button
              type="button"
              onClick={openInApp}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
            >
              앱에서 열기
            </button>
            <p className="text-gray-500 text-center text-xs mt-2">
              앱이 자동으로 열리지 않으면 위 버튼을 누르거나, 아래에서 바로 참여할 수 있어요.
            </p>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-4"
          >
            {error}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="invite-nickname"
              className="block text-sm font-medium mb-2"
            >
              닉네임
            </label>
            <input
              id="invite-nickname"
              name="nickname"
              type="text"
              value={nickname}
              onChange={(ev) => setNickname(ev.target.value)}
              placeholder="게스트1"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {pending ? "참여하는 중..." : "모임 참여하기"}
          </button>
        </form>
      </div>
    </main>
  );
}
