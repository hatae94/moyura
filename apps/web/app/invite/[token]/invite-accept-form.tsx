// 초대 수락 폼 (Client Component, SPEC-MOIM-002 REQ-INV-007 / SPEC-MOIM-011).
//
// @MX:NOTE: 세션 없는 방문자 → 익명 로그인(signInAnonymously)으로 실제 sub 세션 확보 → nickname 입력 →
// 백엔드 POST /invites/:token/accept 제출 → 성공 시 /home/:moimId(모임 상세)로 리다이렉트.
// 익명 sub도 검증 가능한 JWT라 백엔드 가드/RLS/FK는 무수정 동작한다(REQ-INV-007 전제).
//
// SPEC-MOIM-011: (1) 모바일 브라우저(앱 셸 아님) 로드 시 moyura://invite/{token} 1회 자동 발화(딥링크 자동 열기).
//   (2) initialNickname — 이미 앱에 가입된 회원(Profile.name 보유)이 링크로 들어오면 서버 컴포넌트(page.tsx)가
//   기존 닉네임을 prop 으로 내려 input 초기값으로 prefill 한다(게스트/익명/세션 없음은 빈 값).
//
// 409(정원 초과·사용 횟수 초과): 인라인 오류 대신 backdrop 비활성 모달로 서버 메시지를 표시한다.
// 확인 버튼 → 로그인 상태(실계정)이면 /home, 미로그인/익명이면 /login 으로 이동.
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { submitAccept } from "@/lib/invite/accept";
import { createClient } from "@/lib/supabase/client";

// ─────────────────────────────────────────────
// 정원 초과 안내 모달 — backdrop 비활성(invite-invalid-handler 스타일 재사용)
// ─────────────────────────────────────────────
function FullMoimModal({
  message,
  onConfirm,
}: {
  message: string;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="full-moim-title"
      // backdrop 비활성: 오버레이에 닫기 핸들러 없음(확인 버튼으로만 진행)
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="animate-scale-in mx-4 w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
        <p id="full-moim-title" className="text-center text-base font-bold text-foreground">
          {message}
        </p>
        <button
          type="button"
          onClick={onConfirm}
          className="bg-gradient-brand mt-5 w-full rounded-2xl py-3 text-sm font-bold text-white shadow-md shadow-primary/20 transition-transform active:scale-[0.98]"
        >
          확인
        </button>
      </div>
    </div>
  );
}

export function InviteAcceptForm({
  token,
  initialNickname,
}: {
  token: string;
  initialNickname: string;
}) {
  const router = useRouter();

  // SPEC-MOIM-011: 이미 가입된 회원이면 서버가 내려준 기존 닉네임으로 초기화한다(게스트/익명/세션 없음은 "").
  const [nickname, setNickname] = useState(initialNickname);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 409 정원 초과 모달 상태 — null이면 비표시, string이면 서버 메시지 표시
  const [fullMoimMessage, setFullMoimMessage] = useState<string | null>(null);

  // SPEC-MOIM-011 REQ-MOIM11-005: 모바일 브라우저에서만 "앱에서 열기" 버튼을 노출한다.
  const isMobile = useSyncExternalStore(
    () => () => {},
    () => /iphone|ipad|ipod|android/i.test(navigator.userAgent),
    () => false,
  );

  // SPEC-MOIM-011: 네이티브 셸(WebView) 안에서 실행 중인지 — window.ReactNativeWebView 존재로 판별.
  const isInAppShell = useSyncExternalStore(
    () => () => {},
    () => typeof window !== "undefined" && window.ReactNativeWebView != null,
    () => false,
  );

  // 커스텀 스킴으로 앱 열기 시도. 앱 미설치면 스킴이 no-op 이라 아래 웹 수락 폼으로 그대로 진행한다(폴백).
  function openInApp(): void {
    window.location.href = `moyura://invite/${encodeURIComponent(token)}`;
  }

  // SPEC-MOIM-011: 모바일 브라우저(앱 셸 아님)에서는 페이지 로드 시 앱 열기를 1회 자동 시도한다.
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

      if (outcome.kind === "ok") {
        // 가입 성공 → 모임 상세 화면으로 이동(채팅이 아닌 상세 페이지 — 첫 진입 UX 개선).
        router.replace(`/home/${outcome.moimId}`);
        return;
      }

      // 409 정원 초과·사용 횟수 초과 → 서버 메시지를 모달로 표시
      if (outcome.status === 409) {
        const msg =
          outcome.serverMessage ?? "더 이상 참여할 수 없는 초대예요.";
        setFullMoimMessage(msg);
        return;
      }

      // 그 외 오류 → 인라인 표시
      setError(outcome.message);
    } finally {
      setPending(false);
    }
  }

  // 409 모달 확인: 로그인 상태로 분기해 이동
  async function handleFullMoimConfirm() {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    // 실계정 세션(is_anonymous !== true) → 메인(/home), 익명·미로그인 → 로그인(/login).
    const isRealAccount = !!session && session.user?.is_anonymous !== true;
    router.replace(isRealAccount ? "/home" : "/login");
  }

  return (
    <>
      {/* 독립 풀스크린 페이지(body min-h-dvh 의 직접 자식) — min-h-dvh 로 라이브 뷰포트를 채워 수직 중앙 정렬.
          콘텐츠가 길면 흐름대로 자라 문서 스크롤된다(탭바 없는 공개 랜딩). */}
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
        <div className="animate-fade-in-up w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            {/* 그라데이션 환영 배지 — 모임 초대 첫인상. */}
            <div className="bg-gradient-brand-animated animate-scale-in mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] shadow-lg shadow-primary/20">
              <span className="text-3xl">🎉</span>
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight mb-2">모임 초대</h1>
            <p className="text-muted-foreground">닉네임을 입력하고 모임에 참여하세요.</p>
          </div>

          {/* SPEC-MOIM-011: 모바일이면 앱으로 여는 버튼을 함께 둔다(로드 시 자동 시도 + 수동 재시도 폴백). */}
          {isMobile && !isInAppShell ? (
            <div className="mb-6">
              <button
                type="button"
                onClick={openInApp}
                className="bg-gradient-brand w-full text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
              >
                앱에서 열기
              </button>
              <p className="text-muted-foreground text-center text-xs mt-2">
                앱이 자동으로 열리지 않으면 위 버튼을 누르거나, 아래에서 바로 참여할 수 있어요.
              </p>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="animate-fade-in-down bg-destructive/10 text-destructive px-4 py-3 rounded-2xl text-sm mb-4"
            >
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label htmlFor="invite-nickname" className="block text-sm font-semibold mb-2">
                닉네임
              </label>
              <input
                id="invite-nickname"
                name="nickname"
                type="text"
                value={nickname}
                onChange={(ev) => setNickname(ev.target.value)}
                placeholder="게스트1"
                className="w-full px-4 py-3.5 border border-border bg-card rounded-2xl transition-shadow focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="bg-gradient-brand w-full text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
            >
              {pending ? "참여하는 중..." : "모임 참여하기"}
            </button>
          </form>
        </div>
      </main>

      {/* 409 정원 초과·사용 횟수 초과 모달 */}
      {fullMoimMessage !== null ? (
        <FullMoimModal message={fullMoimMessage} onConfirm={handleFullMoimConfirm} />
      ) : null}
    </>
  );
}
