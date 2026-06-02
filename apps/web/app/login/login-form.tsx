// 로그인/회원가입 폼 (Client Component, SPEC-AUTH-001 group G UI plumbing).
//
// 스타일링 폴리시는 범위 밖이다 — 인증 흐름 배선(server action 연결 + 에러 표시)이 목표다.
// React 19 useActionState 로 server action 의 에러 상태를 표시한다.
"use client";

import { useActionState } from "react";

import {
  signInAction,
  signUpAction,
  type AuthActionState,
} from "@/lib/auth/actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [signInState, signIn, signInPending] = useActionState<
    AuthActionState,
    FormData
  >(signInAction, initialError ? { error: initialError } : undefined);
  const [signUpState, signUp, signUpPending] = useActionState<
    AuthActionState,
    FormData
  >(signUpAction, undefined);

  const error = signInState?.error ?? signUpState?.error;
  const pending = signInPending || signUpPending;

  return (
    <form className="flex flex-col gap-3 w-full max-w-sm">
      <label className="flex flex-col gap-1 text-sm">
        이메일
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="border rounded px-2 py-1"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        비밀번호
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="border rounded px-2 py-1"
        />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          formAction={signIn}
          disabled={pending}
          className="border rounded px-3 py-1"
        >
          {signInPending ? "로그인 중..." : "로그인"}
        </button>
        <button
          type="submit"
          formAction={signUp}
          disabled={pending}
          className="border rounded px-3 py-1"
        >
          {signUpPending ? "가입 중..." : "회원가입"}
        </button>
      </div>
    </form>
  );
}
