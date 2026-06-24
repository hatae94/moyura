// 멤버 강퇴·방장 위임 Server Action (SPEC-MOIM-012).
//
// invite-actions.ts 의 requireToken + Server Action 패턴을 미러한다.
// 토큰은 서버 경계에서만 다루고 클라이언트에 노출하지 않는다. 인가는 백엔드가 최종 출처.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { kickMember, transferOwner } from "@/lib/moim/members";
import { createClient } from "@/lib/supabase/server";

/** 강퇴/위임 공통 결과 상태 — ok 또는 일반화 오류. */
export type MemberActionState = { ok?: boolean; error?: string } | undefined;

const KICK_GENERIC_ERROR = "강퇴하지 못했습니다. 다시 시도해 주세요.";
const TRANSFER_GENERIC_ERROR = "위임하지 못했습니다. 다시 시도해 주세요.";

/** 쿠키 세션을 읽어 access_token 을 돌려준다. 세션 부재면 /login 리다이렉트. */
async function requireToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }
  return session.access_token;
}

/**
 * 멤버를 강퇴한다. 성공 시 상세(/home/:moimId)를 재검증해 멤버 목록이 갱신되게 한다.
 * 실패(403 비-owner / 403 target-is-owner / 404 / 네트워크) → 일반화 오류(토큰/상세 비노출).
 */
export async function kickMemberAction(
  moimId: string,
  userId: string,
): Promise<MemberActionState> {
  if (!moimId || !userId) {
    return { error: KICK_GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await kickMember(api, moimId, userId);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`kickMemberAction: DELETE members 실패 (status ${status})`);
    return { error: KICK_GENERIC_ERROR };
  }

  // 성공: 상세를 재검증해 멤버 목록이 갱신되게 한다.
  revalidatePath(`/home/${moimId}`);
  return { ok: true };
}

/**
 * 방장 권한을 위임한다. 성공 시 상세(/home/:moimId)를 재검증해 role 변경이 반영되게 한다.
 * 실패(403 비-owner / 400 자기자신 / 404 / 네트워크) → 일반화 오류(토큰/상세 비노출).
 */
export async function transferOwnerAction(
  moimId: string,
  userId: string,
): Promise<MemberActionState> {
  if (!moimId || !userId) {
    return { error: TRANSFER_GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await transferOwner(api, moimId, userId);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`transferOwnerAction: POST owner 실패 (status ${status})`);
    return { error: TRANSFER_GENERIC_ERROR };
  }

  // 성공: 상세를 재검증해 role 변경(방장↔멤버)이 멤버 목록과 owner 컨트롤에 반영되게 한다.
  revalidatePath(`/home/${moimId}`);
  return { ok: true };
}
