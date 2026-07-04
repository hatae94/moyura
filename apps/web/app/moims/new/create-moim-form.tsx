// 모임 생성 폼 (Client Component, SPEC-MOIM-004 REQ-MOIM4-005 / AC-4/AC-5).
//
// onboarding-form.tsx 의 useActionState 구조를 미러하되, 디자인 토큰은 Meetup 오렌지 시맨틱 토큰을 쓴다
// (bg-primary/text-primary-foreground/border-border/bg-card/text-muted-foreground/rounded-2xl) — login/onboarding
// 의 blue 인증 흐름 토큰이 아니다(REQ-MOIM4-006). (main)/home/[id] · HomeTab 과 동일한 시각 언어.
//
// 입력: 모임 이름(name, 필수) / 호스트 표시 이름(nickname, 필수) / 일정(startsAt, optional, datetime-local) /
//       장소(location, optional, text). 제출은 createMoimAction(Server Action) — 성공 시 /home/{id}, 실패 시
//       폼에 머무르며 일반화된 오류 표시.
"use client";

import { useActionState } from "react";
import { Calendar, MapPin, Users } from "lucide-react";

import {
  createMoimAction,
  type CreateMoimActionState,
} from "./actions";

export function CreateMoimForm() {
  const [state, action, pending] = useActionState<
    CreateMoimActionState,
    FormData
  >(createMoimAction, undefined);

  return (
    // 문서 스크롤: min-h-dvh 로 화면을 채우고 콘텐츠가 길면 흐름대로 자라 문서가 스크롤된다(탭바 없는 풀스크린).
    <div className="flex min-h-dvh flex-col bg-background">
      {/* sticky top-0 z-10 + 반투명 backdrop-blur 로 문서 스크롤 중 헤더 상단 고정(인스타틱 유리 헤더). */}
      <header
        data-shell-header
        className="sticky top-0 z-10 border-b border-border/60 bg-background/80 px-5 pb-4 pt-page backdrop-blur-xl"
      >
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">새 모임 만들기</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          모임 이름과 표시 이름을 입력하고, 일정·장소를 추가해 보세요.
        </p>
      </header>

      {/* 문서 스크롤: overflow-y-auto 제거(흐름대로 자람). flex-1 로 짧은 폼이 화면을 채운다. */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-4">
        {/* 에러 박스(AC-4 Unwanted): 빈 값/백엔드 실패 시 일반화된 오류를 표시한다. */}
        {state?.error ? (
          <div
            role="alert"
            className="animate-fade-in-down rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {state.error}
          </div>
        ) : null}

        <form action={action} className="animate-fade-in-up flex flex-col gap-5">
          {/* 모임 이름(필수) */}
          <div className="flex flex-col gap-2">
            <label htmlFor="moim-name" className="text-sm font-semibold text-foreground">
              모임 이름
            </label>
            <input
              id="moim-name"
              name="name"
              type="text"
              required
              placeholder="예: 주말 등산 모임"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 호스트 표시 이름(필수) */}
          <div className="flex flex-col gap-2">
            <label htmlFor="moim-nickname" className="text-sm font-semibold text-foreground">
              호스트 표시 이름
            </label>
            <input
              id="moim-nickname"
              name="nickname"
              type="text"
              required
              placeholder="모임에서 보일 내 이름"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 일정(optional, datetime-local) */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="moim-starts-at"
              className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <Calendar size={15} className="text-primary" />
              일정 <span className="text-xs font-normal text-muted-foreground">(선택)</span>
            </label>
            <input
              id="moim-starts-at"
              name="startsAt"
              type="datetime-local"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 장소(optional, text) */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="moim-location"
              className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <MapPin size={15} className="text-primary" />
              장소 <span className="text-xs font-normal text-muted-foreground">(선택)</span>
            </label>
            <input
              id="moim-location"
              name="location"
              type="text"
              placeholder="예: 강남역 스타벅스"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 최대 인원(optional, number) */}
          <div className="flex flex-col gap-2">
            <label
              htmlFor="moim-max-members"
              className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <Users size={15} className="text-primary" />
              최대 인원 <span className="text-xs font-normal text-muted-foreground">(선택)</span>
            </label>
            <input
              id="moim-max-members"
              name="maxMembers"
              type="number"
              min={1}
              placeholder="기본 15명"
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-card-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* 제출(브랜드 그라데이션). pending 동안 비활성. press scale 피드백. */}
          <button
            type="submit"
            disabled={pending}
            className="bg-gradient-brand mt-2 w-full rounded-2xl py-3.5 text-base font-bold text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {pending ? "만드는 중..." : "모임 만들기"}
          </button>
        </form>
      </div>
    </div>
  );
}
