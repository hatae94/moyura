// /home HomeTab (클라이언트 컴포넌트, SPEC-MOBILE-003 R-WB2 + SPEC-MOIM-003 REQ-MOIM3-001) — 실 모임 목록.
//
// SPEC-MOIM-003: mock(MOCK_MEETUPS) → 실 모임(GET /moims, page.tsx 가 prop 주입). 카드는 이름 + 생성일만
// 표시하고(실 Moim 은 { id, name, createdBy, createdAt } 뿐 — date/time/location/status/memberCount 출처
// 없음, §5 그레이스풀 degrade), /home/{id} 링크로 상세 이동한다. status 필터 칩은 데이터 출처가 없어 제거한다
// (status 필터 미구현 — Exclusions). 인사말/표시이름/아바타 이니셜은 서버에서 도출해 prop 으로 받는다.
//
// 셸 일관성을 위해 클라이언트 컴포넌트로 둔다(필터 useState 는 제거됨). 새 모임 만들기 CTA 는 홈 우측 하단
// FAB(HomeActionDock)로 이전됐다.
"use client";

import Link from "next/link";
import { Calendar, ChevronRight, MapPin } from "lucide-react";

import type { MoimResponse } from "@moyura/api-client";

import { formatMoimSchedule } from "@/lib/moim/api";

export interface HomeTabProps {
  /** 서버에서 세션 user 로 도출한 표시 이름(인사말 헤더). */
  displayName: string;
  /** 아바타 이니셜(표시 이름 첫 글자). */
  avatarInitial: string;
  /** 인사말 — 시간대별 문구(서버 렌더 일관성을 위해 서버에서 계산해 전달). */
  greeting: string;
  /** 실 모임 목록(GET /moims). 빈 배열이면 빈 상태 UI 를 표시한다(REQ-MOIM3-001). */
  moims: MoimResponse[];
}

/** 생성일 표시 — ISO-8601 createdAt 을 한국어 날짜로 포맷(실 데이터 출처 있는 필드만, §5 degrade). */
function formatCreatedDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * 실 모임 카드 — 이름 + 일정 + 장소 + 생성일 표시, /home/{id} 상세 링크.
 *
 * SPEC-MOIM-004 REQ-MOIM4-006(정직 표시): 일정(startsAt)은 있으면 한국어 포맷, 없으면 "일정 미정"으로
 * 표시한다(허위 값 금지). 장소(location)는 있을 때만 라인을 렌더하고 없으면 생략한다(빈/허위 값 금지).
 * 카드 레이아웃 셸(rounded-2xl border, ChevronRight 진입 어포던스)은 유지해 시각적 일관성을 보존한다.
 */
function MeetupCard({ moim }: { moim: MoimResponse }) {
  // 모임 이니셜 — 그라데이션 아바타(인스타 피드 행처럼 좌측 썸네일 자리).
  const initial = moim.name.charAt(0).toUpperCase() || "M";
  return (
    <Link
      href={`/home/${moim.id}`}
      // content-auto-card: 화면 밖 카드 렌더 스킵(긴 모임 목록 스크롤 부드러움 — SPEC-WEBVIEW-NATIVE-FEEL-001 M5).
      // hover lift + press scale 로 네이티브 카드 감각. 그림자는 호버 시 강조된다.
      className="content-auto-card group flex items-center gap-3.5 rounded-3xl border border-border bg-card p-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/[0.06] active:scale-[0.99]"
    >
      {/* 모임 이니셜 그라데이션 아바타. */}
      <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand text-xl font-extrabold text-white shadow-md shadow-primary/20">
        {initial}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="truncate text-[15px] font-bold text-card-foreground">{moim.name}</h3>
        {/* 일정 — startsAt 있으면 포맷, 없으면 "일정 미정"(정직 표시). */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar size={13} className="shrink-0" />
          <span className="truncate">{formatMoimSchedule(moim.startsAt)}</span>
        </div>
        {/* 장소 — location 있을 때만 라인 렌더(없으면 생략). */}
        {moim.location ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin size={13} className="shrink-0" />
            <span className="truncate">{moim.location}</span>
          </div>
        ) : null}
        {/* 개설일(보존 — 실 데이터 출처 있는 필드). */}
        <span className="text-[11px] text-muted-foreground/60">
          {formatCreatedDate(moim.createdAt)} 개설
        </span>
      </div>
      <ChevronRight
        size={18}
        className="shrink-0 text-muted-foreground/50 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary"
      />
    </Link>
  );
}

export function HomeTab({ displayName, avatarInitial, greeting, moims }: HomeTabProps) {
  return (
    // 문서 스크롤: flex-1 로 셸을 채우고(짧은 콘텐츠도 화면을 채움) 콘텐츠가 길면 흐름대로 자라 문서가 스크롤된다.
    <div className="flex flex-1 flex-col bg-background">
      {/* 헤더: 인사말 + 표시 이름 + 스토리링 아바타. sticky top-0 으로 문서 스크롤 중에도 상단에 고정.
          z-30: 콘텐츠 위, 고정 탭바(z-40)·모달(z-50) 아래. 반투명 + backdrop-blur 로 스크롤 시 콘텐츠가
          유리 너머로 비치는 인스타틱 헤더. hairline 보더로 콘텐츠와 분리. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-5 pb-4 pt-page backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs font-medium text-muted-foreground">{greeting} 👋</span>
            <span className="truncate text-2xl font-extrabold tracking-tight text-foreground">
              {displayName}
              <span className="text-gradient-brand">님</span>
            </span>
          </div>
          {/* 스토리링 아바타 — 그라데이션 보더 링(인스타 시그니처) 안에 이니셜.
              [중요] 이니셜은 별도 span 으로 감싼다: bg-card(흰 원)와 text-gradient-brand 는 둘 다
              background-image 를 쓰므로 같은 요소에 두면 충돌한다(흰 원이 그라데이션으로 덮이고 텍스트가
              투명해짐). 흰 원(bg-card)과 그라데이션 텍스트(자식 span)를 분리한다. */}
          <span className="gradient-ring shrink-0 shadow-md shadow-primary/15">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-card text-base font-extrabold">
              <span className="text-gradient-brand">{avatarInitial}</span>
            </span>
          </span>
        </div>
      </header>

      {/* 콘텐츠 영역: 카드 리스트 / 빈 상태. 문서 스크롤이라 overflow-y-auto 제거(흐름대로 자람).
          flex-1 유지로 빈 상태가 화면을 채워 중앙 정렬을 유지한다. (status 필터 칩 제거 — Exclusions.)
          pb-24: 우측 하단 speed dial FAB(HomeActionDock)에 스크롤 끝 마지막 카드가 가리지 않도록 하단
          여백을 확보한다(모임 상세 page.tsx 와 동일 회피 값). */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-24 pt-4">
        {moims.length > 0 ? (
          // stagger-children: 각 카드가 순차 페이드업 진입(인스타 피드 로딩 감각).
          <div className="stagger-children flex flex-col gap-3">
            {moims.map((moim) => (
              <MeetupCard key={moim.id} moim={moim} />
            ))}
          </div>
        ) : (
          <div className="animate-fade-in-up flex flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
            <div className="bg-gradient-brand-soft flex h-24 w-24 items-center justify-center rounded-full text-4xl ring-1 ring-border">
              🗓️
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-bold text-foreground">아직 모임이 없어요</p>
              <p className="text-sm text-muted-foreground">우측 하단 버튼으로 첫 모임을 만들어보세요</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
