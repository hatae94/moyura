// 모임 상세 페이지 (Server Component, SPEC-MOIM-003 REQ-MOIM3-002/004/005 + SPEC-MOIM-005 REQ-MOIM5-006) —
// 이름·멤버·채팅 입장·투표.
//
// 서버에서 세션 access_token 으로 GET /moims/:id + GET /moims/:id/members + GET /moims/:id/polls 를 조회해
// 모임 이름·멤버 목록·"채팅 입장" 링크와 투표 섹션을 렌더한다. (main) 그룹 하위라 (main)/layout.tsx 의
// requireNamedSession() 가드를 상속한다 — 여기서 다시 호출하는 것은 (1) access_token 확보 (2) 직접 URL 진입 시
// 가드 재확인 목적이다(idempotent — 쿠키 세션 읽기). SPEC-WEB-GUARD-001 정책과 일관.
//
// SPEC-MOIM-005: 투표/생성은 인터랙티브하므로 본체(이 Server Component)는 데이터 fetch + 가드를 유지하고,
// 투표 컨트롤·생성 폼은 Client 하위 컴포넌트(<PollsSection/>) + Server Action(poll-actions.ts)으로 분리한다.
// polls 는 plain object(직렬화 가능)만 Client 섬에 전달한다(함수/인스턴스 금지 — Server→Client 경계 보존).
//
// 비멤버/미존재 안전 처리(REQ-MOIM3-005): 백엔드가 비멤버 403·미존재 404 를 반환하며(인가 단일 출처,
// 약화하지 않는다), 양쪽 모두 notFound() 로 처리해 모임 콘텐츠/토큰/오류 상세를 노출하지 않는다.
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  ChevronRight,
  Crown,
  MapPin,
  MessageCircle,
  User,
  Users,
} from "lucide-react";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { requireNamedSession } from "@/lib/auth/require-named-session";
import {
  type MoimDetail,
  type MoimMember,
  formatMoimSchedule,
  getMoim,
  getMoimMembers,
  moimErrorStatus,
} from "@/lib/moim/api";
import { type PollWithResults, listPolls } from "@/lib/moim/polls";
import { PollsSection } from "./polls-section";

/** 멤버 역할 배지(owner/member). owner 는 강조, 그 외는 muted. */
function RoleBadge({ role }: { role: string }) {
  const isOwner = role === "owner";
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        isOwner ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {isOwner ? <Crown size={12} /> : <User size={12} />}
      {isOwner ? "방장" : "멤버"}
    </span>
  );
}

/** 멤버 행 — 아바타 이니셜 + nickname + role 배지. */
function MemberRow({ member }: { member: MoimMember }) {
  const initial = member.nickname.charAt(0).toUpperCase() || "?";
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
        {initial}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
        {member.nickname}
      </span>
      <RoleBadge role={member.role} />
    </li>
  );
}

export default async function MoimDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16: Server Component 는 params Promise 를 await 한다(Client 는 use()).
  const { id } = await params;

  // (main) 가드 상속이지만, 직접 URL 진입 보호 + access_token 확보를 위해 명시적으로 호출한다(idempotent).
  const { session } = await requireNamedSession();

  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });

  // 상세 + 멤버 병렬 조회. 비멤버 403·미존재 404 는 모임 콘텐츠 노출 없이 notFound() 로 안전 처리한다.
  let moim: MoimDetail;
  let members: MoimMember[];
  try {
    [moim, members] = await Promise.all([getMoim(api, id), getMoimMembers(api, id)]);
  } catch (err) {
    const status = moimErrorStatus(err);
    // 403(비멤버)·404(미존재) → notFound(). 백엔드 인가를 약화시키지 않고 안전 결과로 처리(REQ-MOIM3-005).
    if (status === 403 || status === 404) {
      notFound();
    }
    // 그 외 오류도 상세 진입을 차단한다(fail-closed — 토큰/오류 상세 비노출).
    notFound();
  }

  // SPEC-MOIM-005: 투표 목록 + 결과(호출자 myVote 포함)를 서버에서 조회한다. 멤버십은 위 getMoim 이 이미
  // 통과시켰으므로(같은 assertMember 게이트) 정상 멤버에게는 성공한다. poll 조회 실패는 상세 전체를 막지 않고
  // 빈 배열로 graceful degrade 한다("아직 투표가 없어요" — 허위 값 금지). 인가는 위에서 이미 강제됐다.
  let polls: PollWithResults[];
  try {
    polls = await listPolls(api, id);
  } catch {
    polls = [];
  }

  const createdDate = new Date(moim.createdAt).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* 헤더: 모임 이름 + 일정/장소(정직 표시 — SPEC-MOIM-004 REQ-MOIM4-006) + 개설일. */}
      <header className="px-5 pb-5 pt-12">
        <h1 className="text-2xl font-extrabold text-foreground">{moim.name}</h1>
        {/* 일정 — startsAt 있으면 포맷, 없으면 "일정 미정"(허위 값 금지). */}
        <div className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Calendar size={15} className="text-primary" />
          <span>{formatMoimSchedule(moim.startsAt)}</span>
        </div>
        {/* 장소 — location 있을 때만 라인 렌더(없으면 생략). */}
        {moim.location ? (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin size={15} className="text-primary" />
            <span>{moim.location}</span>
          </div>
        ) : null}
        <p className="mt-1 text-xs text-muted-foreground/70">{createdDate} 개설</p>
      </header>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
        {/* 채팅 입장 — 기본 액션(/moims/{id}/chat 으로 이동). */}
        <Link
          href={`/moims/${moim.id}/chat`}
          className="flex w-full items-center justify-between rounded-2xl bg-primary p-5 text-primary-foreground shadow-lg shadow-primary/20"
        >
          <span className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <MessageCircle size={22} />
            </span>
            <span className="text-lg font-bold">채팅 입장</span>
          </span>
          <ChevronRight size={22} />
        </Link>

        {/* 멤버 목록(nickname + role). 멤버 0명이면 빈 멤버 안내(엣지 케이스). */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Users size={16} />
            <span>멤버 {members.length}명</span>
          </div>
          {members.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {members.map((member) => (
                <MemberRow key={member.userId} member={member} />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
              아직 멤버가 없어요
            </p>
          )}
        </section>

        {/* SPEC-MOIM-005: 투표 섹션(Client 섬). 투표 목록·득표 막대·내 표 강조·단일 선택 투표·생성 폼. */}
        <PollsSection moimId={moim.id} polls={polls} />
      </div>
    </div>
  );
}
