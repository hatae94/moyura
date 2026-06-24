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
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Calendar, ChevronRight, MapPin, MessageCircle } from "lucide-react";

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
import { InviteButton } from "./invite-button";
import { MembersSection } from "./members-section";


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

  // 상세 + 멤버 병렬 조회. 비멤버 403 는 로그인 상태로 리다이렉트, 미존재 404 는 notFound() 로 처리한다.
  let moim: MoimDetail;
  let members: MoimMember[];
  try {
    [moim, members] = await Promise.all([getMoim(api, id), getMoimMembers(api, id)]);
  } catch (err) {
    const status = moimErrorStatus(err);
    if (status === 404) {
      // 모임이 존재하지 않음 → 404 페이지(콘텐츠/토큰 비노출).
      notFound();
    }
    if (status === 403) {
      // 비멤버(강퇴·탈퇴 후 실시간 신호 미수신 등) → 로그인 상태에 따라 분기한다.
      // 실계정 세션(is_anonymous !== true) → 메인(/home), 익명·미로그인 → 로그인(/login).
      const isRealAccount = session.user?.is_anonymous !== true;
      redirect(isRealAccount ? "/home" : "/login");
    }
    // 그 외 오류도 상세 진입을 차단한다(fail-closed — 토큰/오류 상세 비노출).
    notFound();
  }

  // SPEC-MOIM-006: 투표 목록 + 결과(multiSelect + 호출자 myVotes 포함)를 서버에서 조회한다. 멤버십은 위 getMoim 이 이미
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

  // SPEC-MOIM-011/012: role 기반 isOwner 판정(createdBy 기반 대체).
  // 방장 위임(SPEC-MOIM-012) 후 MoimMember.role 이 변경되지만 Moim.createdBy 는 불변이므로
  // createdBy 기반 판정은 위임 후 새 owner 를 방장으로 인식하지 못한다. role="owner" 로 판정한다.
  const isOwner = members.some((m) => m.userId === session.user.id && m.role === "owner");

  return (
    <div className="flex flex-1 flex-col bg-background">
      {/* 헤더: 모임 이름 + 일정/장소(정직 표시 — SPEC-MOIM-004 REQ-MOIM4-006) + 개설일. */}
      <header className="px-5 pb-5 pt-page">
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

        {/* SPEC-MOIM-011: owner 전용 초대 링크 발급(비-owner 면 null 렌더). 모바일 WebView 안에서도 동작. */}
        <InviteButton moimId={moim.id} isOwner={isOwner} />

        {/* 멤버 목록(nickname + role). owner 에겐 강퇴·방장 위임·정원 수정 컨트롤 포함(SPEC-MOIM-012). */}
        <section className="flex flex-col gap-3">
          <MembersSection
            moimId={moim.id}
            members={members}
            isOwner={isOwner}
            currentUserId={session.user.id}
            accessToken={session.access_token}
            maxMembers={moim.maxMembers}
          />
        </section>

        {/* SPEC-MOIM-006/007: 투표 섹션(Client 섬). 투표 목록·득표 막대·내 표 강조·단일/다중 투표·마감·생성 폼.
            currentUserId(세션 user.id = JWT sub) 는 생성자 전용 "마감하기" 버튼 노출 판정에 쓰인다(직렬화 string). */}
        <PollsSection
          moimId={moim.id}
          polls={polls}
          currentUserId={session.user.id}
          accessToken={session.access_token}
        />
      </div>
    </div>
  );
}
