// /home HomeTab (클라이언트 컴포넌트, SPEC-MOBILE-003 R-WB2 + SPEC-MOIM-003 REQ-MOIM3-001) — 실 모임 목록.
//
// SPEC-MOIM-003: mock(MOCK_MEETUPS) → 실 모임(GET /moims, page.tsx 가 prop 주입). 카드는 이름 + 생성일만
// 표시하고(실 Moim 은 { id, name, createdBy, createdAt } 뿐 — date/time/location/status/memberCount 출처
// 없음, §5 그레이스풀 degrade), /home/{id} 링크로 상세 이동한다. status 필터 칩은 데이터 출처가 없어 제거한다
// (status 필터 미구현 — Exclusions). 인사말/표시이름/아바타 이니셜은 서버에서 도출해 prop 으로 받는다.
//
// 클라이언트 컴포넌트로 유지하는 이유: CreateMeetupButton(비기능 CTA) 등 셸 일관성. 필터 useState 는 제거됐다.
"use client";

import Link from "next/link";
import { Calendar, ChevronRight, Plus } from "lucide-react";

import type { MoimResponse } from "@moyura/api-client";

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
 * 실 모임 카드 — 이름 + 생성일 표시, /home/{id} 상세 링크.
 *
 * mock 의 풍부한 필드(시간/장소/상태 배지/멤버 수)는 실 데이터 출처가 없어 렌더하지 않는다(§5 정직성 degrade).
 * 카드 레이아웃 셸(rounded-2xl border, ChevronRight 진입 어포던스)은 유지해 시각적 일관성을 보존한다.
 */
function MeetupCard({ moim }: { moim: MoimResponse }) {
  return (
    <Link
      href={`/home/${moim.id}`}
      className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-colors hover:bg-accent"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 truncate font-bold text-card-foreground">{moim.name}</h3>
          <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar size={14} />
          <span>{formatCreatedDate(moim.createdAt)} 개설</span>
        </div>
      </div>
    </Link>
  );
}

/** 새 모임 만들기 CTA 카드 — 비기능 버튼(Exclusions: 실 모임 생성 없음). */
function CreateMeetupButton() {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-2xl bg-primary p-5 text-primary-foreground shadow-lg shadow-primary/20"
    >
      <span className="flex flex-col text-left">
        <span className="text-lg font-bold">새 모임 만들기</span>
        <span className="text-sm text-primary-foreground/80">일정·장소·투표를 한곳에서</span>
      </span>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
        <Plus size={22} />
      </span>
    </button>
  );
}

export function HomeTab({ displayName, avatarInitial, greeting, moims }: HomeTabProps) {
  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* 헤더: 인사말 + 표시 이름 + 아바타 이니셜. */}
      <header className="px-5 pb-5 pt-12">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-muted-foreground">{greeting} 👋</span>
            <span className="text-2xl font-extrabold text-foreground">{displayName}님</span>
          </div>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground">
            {avatarInitial}
          </span>
        </div>
      </header>

      {/* 스크롤 영역: CTA → 카드 리스트 / 빈 상태. (status 필터 칩 제거 — 실 데이터 출처 없음, Exclusions.) */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
        <CreateMeetupButton />

        {moims.length > 0 ? (
          <div className="flex flex-col gap-3">
            {moims.map((moim) => (
              <MeetupCard key={moim.id} moim={moim} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <div className="text-4xl">🗓️</div>
            <p className="font-bold text-foreground">모임이 없어요</p>
            <p className="text-sm text-muted-foreground">위 버튼으로 첫 모임을 만들어보세요!</p>
          </div>
        )}
      </div>
    </div>
  );
}
