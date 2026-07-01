// 일정 조율 페이지 (Server Component, SPEC-SCHEDULE-001).
//
// moims 그룹 하위라 상위 layout 의 이름 가드를 상속한다(chat/expenses 와 동일 그룹 구조).
// 서버에서 세션 토큰으로 모임 + 멤버 + 일정 조율 세션을 병렬 조회한 뒤 클라이언트 섬(ScheduleView)에 전달한다.
// 비멤버 403 / 미존재 404 → notFound()(콘텐츠/토큰/오류 상세 비노출 — 다른 모임 하위 페이지와 일관).
import { notFound } from "next/navigation";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { requireNamedSession } from "@/lib/auth/require-named-session";
import {
  type MoimMember,
  getMoimMembers,
  moimErrorStatus,
} from "@/lib/moim/api";
import { type ScheduleResponse, getSchedule } from "@/lib/schedule/api";

import { ScheduleView } from "./schedule-view";

export default async function SchedulePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 직접 URL 진입 보호 + access_token 확보(idempotent — moims/layout 이름 가드 상속).
  const { session } = await requireNamedSession();

  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });

  // 멤버 + 일정 세션 병렬 조회. 비멤버 403 / 미존재 404 → notFound()(콘텐츠/토큰 비노출).
  // 멤버십·존재 게이트는 getMoimMembers/getSchedule 가 동일하게 강제하므로 별도 getMoim 은 두지 않는다.
  let members: MoimMember[];
  let scheduleRes: ScheduleResponse;
  try {
    [members, scheduleRes] = await Promise.all([
      getMoimMembers(api, id),
      getSchedule(api, id),
    ]);
  } catch (err) {
    const status = moimErrorStatus(err);
    if (status === 403 || status === 404) {
      notFound();
    }
    notFound();
  }

  // role="owner" 여부를 서버에서 판정(세션 가드 통과 = 멤버 보장).
  const isOwner = members.some(
    (m) => m.userId === session.user.id && m.role === "owner",
  );

  // userId → nickname 매핑(직렬화 가능 plain object — 히트맵 멤버 이름 해석).
  const nicknameMap: Record<string, string> = {};
  for (const m of members) {
    nicknameMap[m.userId] = m.nickname;
  }

  return (
    <ScheduleView
      moimId={id}
      schedule={scheduleRes.schedule}
      nicknameMap={nicknameMap}
      memberCount={members.length}
      isOwner={isOwner}
      currentUserId={session.user.id}
      accessToken={session.access_token}
    />
  );
}
