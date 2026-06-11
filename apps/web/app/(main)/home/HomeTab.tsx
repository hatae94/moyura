// /home HomeTab (클라이언트 컴포넌트, SPEC-MOBILE-003 R-WB2) — Figma Make HomeTab 적응.
//
// 필터 칩(전체/예정/완료)이 클라이언트 상태(useState)로 카드 리스트를 필터링하므로 클라이언트
// 컴포넌트다. 인사말/표시이름/아바타 이니셜은 서버에서 세션으로 도출해 prop 으로 받는다(page.tsx).
//
// 모임 카드는 렌더 전용(Exclusions) — MeetupDetail 은 후속 SPEC 으로 제외이므로 onClick/네비게이션 없음.
"use client";

import { Calendar, ChevronRight, Clock, MapPin, Plus, Users } from "lucide-react";
import { useState } from "react";

import { MOCK_MEETUPS, type Meetup, type MeetupStatus } from "./_mock";

export interface HomeTabProps {
  /** 서버에서 세션 user 로 도출한 표시 이름(인사말 헤더). */
  displayName: string;
  /** 아바타 이니셜(표시 이름 첫 글자). */
  avatarInitial: string;
  /** 인사말 — 시간대별 문구(서버 렌더 일관성을 위해 서버에서 계산해 전달). */
  greeting: string;
}

/** 필터 칩 정의 — 'all' 은 전체, 그 외는 MeetupStatus 매핑('ongoing' 은 mock 에 없어 미노출). */
const FILTERS = [
  { id: "all", label: "전체" },
  { id: "upcoming", label: "예정" },
  { id: "past", label: "완료" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

/** 상태 배지 — 텍스트/색상 매핑(Figma StatusBadge). */
function StatusBadge({ status }: { status: MeetupStatus }) {
  const styles: Record<MeetupStatus, { label: string; className: string }> = {
    upcoming: { label: "예정", className: "bg-primary/10 text-primary" },
    ongoing: { label: "진행중", className: "bg-green-100 text-green-700" },
    past: { label: "완료", className: "bg-muted text-muted-foreground" },
  };
  const { label, className } = styles[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

/** 모임 카드(렌더 전용 — 탭/네비게이션 없음, Exclusions). */
function MeetupCard({ meetup }: { meetup: Meetup }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl ${meetup.coverColor}`}
      >
        {meetup.emoji}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <h3 className="flex-1 truncate font-bold text-card-foreground">{meetup.title}</h3>
          <StatusBadge status={meetup.status} />
          <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar size={14} />
          <span>
            {meetup.date} {meetup.time}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin size={14} />
          <span className="truncate">{meetup.location}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users size={14} />
          <span>
            {meetup.memberCount}/{meetup.maxMembers}
          </span>
        </div>
      </div>
    </div>
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

export function HomeTab({ displayName, avatarInitial, greeting }: HomeTabProps) {
  const [filter, setFilter] = useState<FilterId>("all");

  const meetups =
    filter === "all"
      ? MOCK_MEETUPS
      : MOCK_MEETUPS.filter((m) => m.status === filter);

  const upcomingCount = MOCK_MEETUPS.filter((m) => m.status === "upcoming").length;

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
        {upcomingCount > 0 && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-secondary px-3 py-2 text-sm text-secondary-foreground">
            <Clock size={16} />
            <span>예정된 모임이 {upcomingCount}개 있어요</span>
          </div>
        )}
      </header>

      {/* 스크롤 영역: CTA → 필터 칩 → 카드 리스트 / 빈 상태. */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
        <CreateMeetupButton />

        <div className="flex gap-2">
          {FILTERS.map((f) => {
            const isActive = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {meetups.length > 0 ? (
          <div className="flex flex-col gap-3">
            {meetups.map((meetup) => (
              <MeetupCard key={meetup.id} meetup={meetup} />
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
