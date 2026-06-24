// 경비 관리 페이지 (Server Component, SPEC-MOIM-EXPENSE).
//
// moims 그룹 하위라 상위 layout 의 이름 가드를 상속한다(chat/page.tsx 와 동일 그룹 구조).
// 서버에서 세션 토큰으로 멤버 목록 + 경비 GET 을 병렬 조회한 뒤 클라이언트 섬(ExpensesView)에 전달한다.
// 비멤버 403 / 미존재 404 → notFound()(콘텐츠/토큰/오류 상세 비노출 — REQ-MOIM3-005 정책과 일관).
import { notFound } from "next/navigation";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { requireNamedSession } from "@/lib/auth/require-named-session";
import { getMoimMembers, moimErrorStatus, type MoimMember } from "@/lib/moim/api";
import { listExpenses, type ExpenseListResponse } from "@/lib/moim/expenses";
import { ExpensesView } from "./expenses-view";

export default async function ExpensesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Next 16: Server Component params 는 Promise 를 await 한다.
  const { id } = await params;

  // 직접 URL 진입 보호 + access_token 확보(idempotent — 이름 가드 상속).
  const { session } = await requireNamedSession();

  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });

  // 멤버 목록 + 경비 병렬 조회.
  let members: MoimMember[];
  let expenseData: ExpenseListResponse;
  try {
    [members, expenseData] = await Promise.all([
      getMoimMembers(api, id),
      listExpenses(api, id),
    ]);
  } catch (err) {
    const status = moimErrorStatus(err);
    if (status === 403 || status === 404) {
      notFound();
    }
    notFound();
  }

  // role="owner" 여부를 서버에서 판정해 클라이언트 섬에 전달.
  const isOwner = members.some(
    (m) => m.userId === session.user.id && m.role === "owner",
  );

  // userId → nickname 매핑(직렬화 가능 plain object).
  const nicknameMap: Record<string, string> = {};
  for (const m of members) {
    nicknameMap[m.userId] = m.nickname;
  }

  return (
    <ExpensesView
      moimId={id}
      data={expenseData}
      members={members}
      nicknameMap={nicknameMap}
      isOwner={isOwner}
      currentUserId={session.user.id}
      accessToken={session.access_token}
    />
  );
}
