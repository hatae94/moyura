// 모임 상세 페이지 (Server Component, SPEC-MOIM-003 REQ-MOIM3-002/004/005 + SPEC-MOIM-005 REQ-MOIM5-006
// + SPEC-MOIM-DETAIL-001) — 이름·멤버·채팅 입장·투표.
//
// 서버에서 세션 access_token 으로 GET /moims/:id/detail(집계) 를 1회 조회해 모임 이름·멤버 목록·"채팅 입장"
// 링크·투표 섹션·일정 요약을 렌더한다. (main) 그룹 하위라 (main)/layout.tsx 의 requireNamedSession() 가드를
// 상속하지만, 직접 URL 진입 보호 + access_token 확보를 위해 여기서 다시 호출한다(idempotent — 쿠키 세션 읽기).
//
// SPEC-MOIM-DETAIL-001: 이전에는 moim/members/polls/schedule 을 4개 개별 엔드포인트로 병렬 조회했으나(Vercel→
// 백엔드 네트워크 4콜), 백엔드 집계 엔드포인트 GET /moims/:id/detail 로 1콜에 합쳤다 — 백엔드가 DB fan-out 을
// 로컬에서 수행하므로 Vercel→백엔드 왕복이 1개로 준다. 인가는 백엔드가 단일 assertMember 게이트로 강제하고,
// 응답 각 필드 형태는 개별 엔드포인트와 byte-identical 하다. polls 는 집계에 함께 실려 오므로 별도 스트리밍이
// 불필요하다(1콜 후 전체 렌더 — 페이지 진입 스켈레톤은 loading.tsx 가 담당).
//
// SPEC-MOIM-005: 투표/생성은 인터랙티브하므로 본체(이 Server Component)는 데이터 fetch + 가드를 유지하고,
// 투표 컨트롤·생성 폼은 Client 하위 컴포넌트(<PollsSection/>) + Server Action(poll-actions.ts)으로 분리한다.
// polls 는 plain object(직렬화 가능)만 Client 섬에 전달한다(함수/인스턴스 금지 — Server→Client 경계 보존).
//
// 비멤버/미존재 안전 처리(REQ-MOIM3-005): 백엔드가 비멤버 403·미존재 404 를 반환하며(인가 단일 출처,
// 약화하지 않는다), 양쪽 모두 notFound()/redirect 로 처리해 모임 콘텐츠/토큰/오류 상세를 노출하지 않는다.
import { notFound, redirect } from "next/navigation";
import { Calendar, MapPin } from "lucide-react";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { requireNamedSession } from "@/lib/auth/require-named-session";
import {
  type MoimDetailBundle,
  formatMoimSchedule,
  getMoimDetail,
  moimErrorStatus,
} from "@/lib/moim/api";
import { PollsSection } from "./polls-section";
import { InviteButton } from "./invite-button";
import { MembersSection } from "./members-section";
import { MoimActionDock } from "./moim-action-dock";
import { ScheduleVoteBar } from "./schedule-vote-bar";


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

  // SPEC-MOIM-DETAIL-001: 모임+멤버+투표+일정을 집계 엔드포인트로 1회에 조회한다(4개 병렬 백엔드 호출 → 1개).
  // 인가는 백엔드가 단일 게이트로 강제한다 — 비멤버 403 은 로그인 상태로 리다이렉트, 미존재 404 는 notFound()
  // 로 처리한다. 일시적 실패(타임아웃/네트워크/5xx)는 404 로 숨기지 않고 에러 경계(app/error.tsx)로 승격해
  // 재시도 UI 를 노출한다(타임아웃 없는 fetch 가 콜드 백엔드에 영구 pending 되던 근인을 api-client 타임아웃으로
  // 끊고, 사용자가 갇히지 않게 재시도로 연결한다).
  let detail: MoimDetailBundle;
  try {
    detail = await getMoimDetail(api, id);
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
    throw err;
  }

  const { moim, members, polls } = detail;
  // 일정 요약: 집계 응답의 { schedule } 래퍼를 언랩한다. schedule 이 null 이면 미설정 → ScheduleVoteBar 가
  // "일정 조율 시작" CTA 로 대체한다(허위 값 금지).
  const schedule = detail.schedule.schedule;

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
    // 문서 스크롤: flex-1 로 셸을 채우고 콘텐츠가 길면 흐름대로 자라 문서가 스크롤된다.
    <div className="flex flex-1 flex-col bg-background">
      {/* 헤더: 모임 그라데이션 아바타 + 이름 + 일정/장소(정직 표시 — SPEC-MOIM-004 REQ-MOIM4-006) + 개설일.
          sticky top-0 z-30 + 반투명 backdrop-blur 로 문서 스크롤 중 상단 고정(탭바 z-40·모달 z-50 아래). */}
      <header
        data-shell-header="collapse"
        className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-5 pb-4 pt-page backdrop-blur-xl"
      >
        <div className="flex items-center gap-3.5">
          {/* 모임 이니셜 그라데이션 아바타 — 홈 카드와 동일 시각 언어로 연속성. */}
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-brand text-2xl font-extrabold text-white shadow-md shadow-primary/20">
            {moim.name.charAt(0).toUpperCase() || "M"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-extrabold tracking-tight text-foreground">
              {moim.name}
            </h1>
            {/* 일정 — startsAt 있으면 포맷, 없으면 "일정 미정"(허위 값 금지). */}
            <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Calendar size={14} className="shrink-0 text-primary" />
              <span className="truncate">{formatMoimSchedule(moim.startsAt)}</span>
            </div>
            {/* 장소 — location 있을 때만 라인 렌더(없으면 생략). */}
            {moim.location ? (
              <div className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin size={14} className="shrink-0 text-primary" />
                <span className="truncate">{moim.location}</span>
              </div>
            ) : null}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground/60">{createdDate} 개설</p>
      </header>

      {/* 문서 스크롤: overflow-y-auto 제거(흐름대로 자람). flex-1 유지로 짧은 콘텐츠가 화면을 채운다.
          pb-24: 우측 하단 플로팅 FAB(speed dial)에 마지막 콘텐츠가 가리지 않도록 하단 여백을 확보한다. */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-24 pt-4">
        {/* 채팅·일정 조율·경비 액션은 우측 하단 speed dial FAB(MoimActionDock)로 이동했다 — 트리 끝에서 렌더.
            목적지/기능은 동일하며, 초대·멤버·투표는 콘텐츠 흐름에 그대로 유지한다. */}

        {/* 최상단 — 후보 날짜별 참여(투표) 현황 가로 스크롤 바 그래프(일정 조율 요약). 미설정(null)이면 "시작" CTA.
            집계라 schedule 은 항상 로드돼 있어(atomic) 조건 없이 렌더한다 — null 처리는 ScheduleVoteBar 담당. */}
        <ScheduleVoteBar
          moimId={moim.id}
          schedule={schedule}
          memberCount={members.length}
        />

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
            currentUserId(세션 user.id = JWT sub) 는 생성자 전용 "마감하기" 버튼 노출 판정에 쓰인다(직렬화 string).
            집계로 polls 가 이미 로드돼 있어 스트리밍(Suspense) 불필요 — 직접 렌더한다. */}
        <PollsSection
          moimId={moim.id}
          polls={polls}
          currentUserId={session.user.id}
          accessToken={session.access_token}
        />
      </div>

      {/* 우측 하단 플로팅 speed dial — 채팅/일정 조율/경비 액션(fixed, 문서 흐름 밖). */}
      <MoimActionDock moimId={moim.id} />
    </div>
  );
}
