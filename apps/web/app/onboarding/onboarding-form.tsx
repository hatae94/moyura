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
    <div className="min-h-dvh w-full flex flex-col bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-2">이름을 알려주세요</h1>
            <p className="text-gray-600">
              모임에서 표시될 이름을 입력해 주세요
            </p>
          </div>

          {/* 에러 박스(AC-8): 빈 값/백엔드 실패 시 일반화된 오류를 표시한다. */}
          {state?.error ? (
            <div
              role="alert"
              className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm mb-4"
            >
              {state.error}
            </div>
          ) : null}

          <form action={action} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="onboarding-name"
                className="block text-sm font-medium mb-2"
              >
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors mt-4 disabled:opacity-50"
            >
              {pending ? "저장 중..." : "시작하기"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
