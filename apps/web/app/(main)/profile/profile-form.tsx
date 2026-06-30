// 마이 페이지 — 표시 이름 수정 폼 (Client Component, SPEC-PROFILE-001).
//
// onboarding-form 패턴 미러: useActionState 로 Server Action(updateProfileAction)을 호출한다. 성공 시
// "저장되었습니다" 피드백을 같은 화면에 표시하고(redirect 없음), 실패 시 일반화된 오류를 표시한다.
// input 은 uncontrolled(defaultValue) — 저장 후에도 사용자가 입력한 값을 유지한다.
"use client";

import { useActionState } from "react";

import { updateProfileAction, type ProfileActionState } from "./actions";

export function ProfileForm({ initialName }: { initialName: string }) {
  const [state, action, pending] = useActionState<ProfileActionState, FormData>(
    updateProfileAction,
    undefined,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      {state?.error ? (
        <div
          role="alert"
          className="animate-fade-in-down bg-destructive/10 text-destructive px-4 py-3 rounded-2xl text-sm"
        >
          {state.error}
        </div>
      ) : null}
      {state?.ok ? (
        <div
          role="status"
          className="animate-fade-in-down bg-gradient-brand-soft px-4 py-3 rounded-2xl text-sm font-semibold"
        >
          {/* 텍스트만 그라데이션 — soft 배경(background-image)과 text-gradient-brand(background-image) 충돌
              방지 위해 자식 span 으로 분리. */}
          <span className="text-gradient-brand">저장되었습니다.</span>
        </div>
      ) : null}

      <div>
        <label htmlFor="profile-name" className="block text-sm font-semibold mb-2 text-foreground">
          표시 이름
        </label>
        <input
          id="profile-name"
          name="name"
          type="text"
          defaultValue={initialName}
          placeholder="홍길동"
          autoComplete="name"
          className="w-full px-4 py-3.5 border border-border rounded-2xl bg-card text-foreground transition-shadow focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
        <p className="text-xs text-muted-foreground mt-1.5">
          모임에서 다른 멤버에게 표시되는 이름이에요.
        </p>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="bg-gradient-brand w-full text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {pending ? "저장 중..." : "저장"}
      </button>
    </form>
  );
}
