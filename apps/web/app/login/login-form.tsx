// 로그인/회원가입 화면 (Client Component, SPEC-LOGIN-UI-001).
//
// Figma Make "Meetup" LoginScreen 디자인을 그대로 이식한 self-contained 컴포넌트.
// 시각(plain Tailwind utility + lucide 아이콘 + 인라인 GoogleIcon SVG)은 디자인 소스를 따르되,
// 데이터 계층은 기존 SPEC-AUTH-001 server action(signInAction/signUpAction/signInWithOAuthAction)을
// 재사용한다. supabase.auth 직접 호출/edge-function/alert/console.log 는 사용하지 않는다(R-D3).
"use client";

import { useState } from "react";
import { useActionState } from "react";
import Image from "next/image";
import { Apple, Mail } from "lucide-react";

import {
  signInAction,
  signInWithOAuthAction,
  signUpAction,
  type AuthActionState,
} from "@/lib/auth/actions";
import { requestNativeGoogleSignIn } from "@/lib/native-bridge/bridge-client";

import { InviteLinkEntry } from "./invite-link-entry";

// 인라인 Google 아이콘(R-A3/R-F1: lucide 가 아닌 인라인 20×20 SVG 컴포넌트로 유지).
function GoogleIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

export function LoginForm({ initialError }: { initialError?: string }) {
  // OD-2: OAuth 실패는 서버 컴포넌트가 ?error= 로 복귀시켜 initialError 로 전달된다.
  // 에러 박스는 이메일 폼 안에 있으므로, initialError 가 있으면 이메일 폼을 먼저 열어
  // 사용자가 에러 메시지를 볼 수 있게 한다(EC-2/AC-E3).
  const [showEmailForm, setShowEmailForm] = useState(Boolean(initialError));
  const [isSignUp, setIsSignUp] = useState(false);

  // 로그인/회원가입은 기존 패턴대로 각각 useActionState 로 처리한다.
  // signIn 쪽에 initialError 를 seed 해 서버 ?error= 초기값을 에러 박스에 반영한다(OD-2).
  const [signInState, signIn, signInPending] = useActionState<
    AuthActionState,
    FormData
  >(signInAction, initialError ? { error: initialError } : undefined);
  const [signUpState, signUp, signUpPending] = useActionState<
    AuthActionState,
    FormData
  >(signUpAction, undefined);

  // isSignUp 에 따라 폼 action/pending/state 를 전환한다.
  const formAction = isSignUp ? signUp : signIn;
  const pending = isSignUp ? signUpPending : signInPending;
  // 두 채널 에러를 함께 반영한다(useActionState 에러 + 서버 ?error= 초기값, OD-2).
  const error = isSignUp ? signUpState?.error : signInState?.error;

  // 소셜 랜딩 뷰(R-A1~R-A5).
  if (!showEmailForm) {
    return (
      // 독립 풀스크린 페이지(body min-h-dvh 의 직접 자식) — min-h-dvh w-full 로 라이브 뷰포트를 채운다
      // (size-full 의 h-full=height:100% 는 min-height 만 가진 body 에 대해 불확정이라 채움 보장 안 됨).
      <div className="min-h-dvh w-full flex flex-col grow bg-background">
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
          <div className="w-full max-w-md">
            {/* 헤더: 공식 앱 아이콘(블롭 링 — "모여라")을 히어로로. 아이콘이 자체 스퀘어클 배경을 가지므로
                그라데이션 배지 래퍼 없이 이미지를 직접 렌더하고 모서리만 둥글린다. 워드마크는 제거한다
                (아이콘 중심 미니멀 — 스플래시/로그인 트렌드), 태그라인만 남겨 맥락을 준다. [DEV] 는 좌상단 배지로 이동. */}
            <div className="text-center">
              <Image
                src="/app-icon.png"
                alt="moyura"
                width={96}
                height={96}
                priority
                className="animate-scale-in mx-auto mb-6 h-24 w-24 rounded-[1.75rem]"
              />
              <p className="animate-fade-in-up text-muted-foreground leading-relaxed">
                간편하게 모임을 만들고
                <br />
                일정, 장소, 투표를 한곳에서
              </p>
            </div>

            {/* 소셜 버튼 3종(R-A3) + "또는" 디바이더(R-A4) */}
            <div className="animate-fade-in-up flex flex-col gap-3 mt-9 [animation-delay:0.12s]">
              {/* Google: 인라인 GoogleIcon outline 버튼(OD-1 form + hidden provider).
                  SPEC-MOBILE-004: 네이티브 셸 안에서는 OAuth 제출을 막고 네이티브 Google Sign-In SDK 를
                  브리지로 직접 요청한다(외부 브라우저 이탈 없이 인앱 로그인). 데스크톱 브라우저는
                  requestNativeGoogleSignIn() 이 false 라 기존 웹 OAuth 서버 액션이 그대로 제출된다. */}
              <form action={signInWithOAuthAction}>
                <input type="hidden" name="provider" value="google" />
                <button
                  type="submit"
                  onClick={(e) => {
                    if (requestNativeGoogleSignIn()) {
                      e.preventDefault();
                    }
                  }}
                  className="w-full border border-border bg-card rounded-2xl py-3.5 flex items-center justify-center gap-3 font-semibold text-foreground shadow-sm transition-all hover:bg-muted active:scale-[0.98]"
                >
                  <GoogleIcon />
                  Google로 계속하기
                </button>
              </form>

              {/* Apple: solid-black 버튼(OD-1 form + hidden provider) */}
              <form action={signInWithOAuthAction}>
                <input type="hidden" name="provider" value="apple" />
                <button
                  type="submit"
                  className="w-full bg-foreground text-background rounded-2xl py-3.5 flex items-center justify-center gap-3 font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                >
                  <Apple size={20} />
                  Apple로 계속하기
                </button>
              </form>

              {/* "또는" 디바이더(R-A4): Apple 과 Email 사이 */}
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 bg-background text-muted-foreground text-sm">또는</span>
                </div>
              </div>

              {/* Email: outline 버튼 → 이메일 폼으로 전환(R-C1) */}
              <button
                type="button"
                onClick={() => setShowEmailForm(true)}
                className="w-full border border-border bg-card rounded-2xl py-3.5 flex items-center justify-center gap-3 font-semibold text-foreground shadow-sm transition-all hover:bg-muted active:scale-[0.98]"
              >
                <Mail size={20} />
                이메일로 계속하기
              </button>
            </div>

            {/* 비가입 게스트 경로(SPEC-MOIM-011 후속): 받은 초대 링크로 계정 없이 바로 참여(익명 가입).
                정상 로그인과 경쟁하지 않게 보조 링크로 두고, 탭하면 입력창이 펼쳐진다. */}
            <div className="animate-fade-in-up mt-6 [animation-delay:0.18s]">
              <InviteLinkEntry />
            </div>

            {/* 푸터: 약관/개인정보 비기능 underline 텍스트(R-A5, OD-4) */}
            <p className="text-xs text-muted-foreground text-center mt-8">
              계속 진행하면 <span className="underline">이용약관</span> 및{" "}
              <span className="underline">개인정보처리방침</span>에 동의하는 것으로 간주됩니다
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 이메일 폼 뷰(R-B1~R-B5).
  return (
    // 독립 풀스크린 페이지 — min-h-dvh w-full 로 라이브 뷰포트를 채운다(size-full → 불확정 높이 회피).
    <div className="min-h-dvh w-full flex flex-col bg-background">
      <div className="animate-fade-in flex-1 flex flex-col px-6 py-8">
        {/* ← 뒤로: 소셜 랜딩으로 복귀(R-C2) */}
        <button
          type="button"
          onClick={() => setShowEmailForm(false)}
          className="self-start flex items-center gap-1 text-sm font-medium text-muted-foreground mb-8 transition-colors hover:text-foreground"
        >
          ← 뒤로
        </button>

        {/* 동적 제목/서브타이틀(R-B2) */}
        <h1 className="text-3xl font-extrabold tracking-tight mb-2">
          {isSignUp ? "회원가입" : "로그인"}
        </h1>
        <p className="text-muted-foreground mb-8">
          {isSignUp ? "새로운 계정을 만들어주세요" : "이메일로 계속하기"}
        </p>

        {/* 에러 박스(R-E3): 폼 상단에 두 채널 에러를 통합 표시(OD-2) */}
        {error ? (
          <div
            role="alert"
            className="animate-fade-in-down bg-destructive/10 text-destructive px-4 py-3 rounded-2xl text-sm mb-4"
          >
            {error}
          </div>
        ) : null}

        <form action={formAction} className="flex flex-col gap-4">
          {/* 이름 필드: 회원가입일 때만 이메일 위에 렌더(R-B4). SPEC-MOBILE-004 AC-4: signUpAction 이
              이 name 을 읽어 user_metadata + Profile.name 으로 영속한다(이메일·소셜 통합 이름 수집). */}
          {isSignUp ? (
            <div>
              <label htmlFor="login-name" className="block text-sm font-semibold mb-2">
                이름
              </label>
              <input
                id="login-name"
                name="name"
                type="text"
                placeholder="홍길동"
                className="w-full px-4 py-3.5 border border-border bg-card rounded-2xl transition-shadow focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
              />
            </div>
          ) : null}

          <div>
            <label htmlFor="login-email" className="block text-sm font-semibold mb-2">
              이메일
            </label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="example@email.com"
              className="w-full px-4 py-3.5 border border-border bg-card rounded-2xl transition-shadow focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-semibold mb-2">
              비밀번호
            </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
              placeholder="••••••••"
              className="w-full px-4 py-3.5 border border-border bg-card rounded-2xl transition-shadow focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
            />
          </div>

          {/* 제출 버튼(R-B5): pending 시 disable + "처리 중..."(R-E1), 평상시 라벨(R-E2) */}
          <button
            type="submit"
            disabled={pending}
            className="w-full bg-gradient-brand text-white py-3.5 rounded-2xl font-bold shadow-lg shadow-primary/25 transition-transform mt-4 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {pending ? "처리 중..." : isSignUp ? "가입하기" : "로그인"}
          </button>
        </form>

        {/* 토글 링크(R-C3): isSignUp 반전 */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setIsSignUp((prev) => !prev)}
            className="text-sm font-semibold text-primary transition-opacity hover:opacity-80"
          >
            {isSignUp
              ? "이미 계정이 있으신가요? 로그인"
              : "계정이 없으신가요? 회원가입"}
          </button>
        </div>
      </div>
    </div>
  );
}
