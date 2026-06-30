// 이름 온보딩 폼 (Client Component, SPEC-MOBILE-004 REQ-MOB4-004 / AC-1/AC-8).
//
// prefill: Google user_metadata.name 등 prefill 값을 기본값으로 채우되 사용자가 확인·수정할 수 있다.
//   (값이 없으면 빈 값으로 시작하고 입력을 강제한다 — 엣지 케이스.)
// 제출은 submitNameAction(Server Action) 으로 — 성공 시 /home, 실패 시 머무르며 일반화된 오류 표시.
"use client";

import { useActionState } from "react";

import {
  submitNameAction,
  type OnboardingActionState,
} from "./actions";

export function OnboardingForm({ prefillName }: { prefillName: string }) {
  const [state, action, pending] = useActionState<
    OnboardingActionState,
    FormData
  >(submitNameAction, undefined);

  return (
    // 독립 풀스크린 페이지 — min-h-dvh w-full 로 라이브 뷰포트를 채운다(size-full → 불확정 높이 회피).
    <div className="min-h-dvh w-full flex flex-col bg-background">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="animate-fade-in-up text-center mb-8">
            {/* 환영 그라데이션 배지 — 첫 진입을 따뜻하게(scale-in 등장). */}
            <div className="bg-gradient-brand-animated animate-scale-in mx-auto inline-flex items-center justify-center w-20 h-20 rounded-[1.75rem] shadow-xl shadow-primary/25 mb-5">
              <span className="text-4xl">👋</span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight mb-2">이름을 알려주세요</h1>
            <p className="text-muted-foreground">모임에서 표시될 이름을 입력해 주세요</p>
          </div>

          {/* 에러 박스(AC-8): 빈 값/백엔드 실패 시 일반화된 오류를 표시한다. */}
          {state?.error ? (
            <div
              role="alert"
              className="animate-fade-in-down bg-destructive/10 text-destructive px-4 py-3 rounded-2xl text-sm mb-4"
            >
              {state.error}
            </div>
          ) : null}

          <form action={action} className="animate-fade-in-up flex flex-col gap-4 [animation-delay:0.08s]">
            <div>
              <label htmlFor="onboarding-name" className="block text-sm font-semibold mb-2">
                이름
              </label>
              <input
                id="onboarding-name"
                name="name"
                type="text"
                // prefill: user_metadata 이름이 있으면 기본값(확인·수정 가능), 없으면 빈 값.
                defaultValue={prefillName}
                placeholder="홍길동"
                autoComplete="name"
                className="w-full px-4 py-3.5 border border-border bg-card rounded-2xl transition-shadow focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-gradient-brand text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-primary/25 transition-transform mt-4 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
            >
              {pending ? "저장 중..." : "시작하기"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
