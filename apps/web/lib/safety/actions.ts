// 신고·차단 Server Action (SPEC-SAFETY-001 T-009).
//
// lib/moim 의 member-actions.ts(kick/transfer) requireToken + revalidatePath 패턴을 미러한다.
// 토큰은 서버 경계(쿠키 세션)에서만 다루고 클라이언트에 노출하지 않는다. 인가는 백엔드가 최종 출처
// (blockerId==sub WHERE 내장). 실패는 일반화 오류로만 반환한다(토큰/상세 비노출, R-A9).
//
// 채팅 화면(chat/page.tsx)은 자체 client-side ApiClient 로 lib/safety/api.ts 헬퍼를 직접 호출하므로
// (기존 sendMessage 패턴과 동일 — raw useState + 수동 무효화) 여기의 Server Action 은 멤버 목록·프로필
// (Server Component + revalidatePath 캐시 무효화) 표면 전용이다.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createBlock, unblock } from "@/lib/safety/api";
import { createClient } from "@/lib/supabase/server";

/** 차단/해제 공통 결과 상태 — ok 또는 일반화 오류. */
export type SafetyActionState = { ok?: boolean; error?: string } | undefined;

const BLOCK_GENERIC_ERROR = "차단하지 못했습니다. 다시 시도해 주세요.";
const UNBLOCK_GENERIC_ERROR = "차단을 해제하지 못했습니다. 다시 시도해 주세요.";

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
 * 멤버를 차단한다(멤버 목록 진입점 — POST /blocks, 멱등). 성공 시 모임 상세(/home/:moimId)를 재검증해
 * 뷰어 측 필터가 반영되게 한다(차단 대상은 멤버 목록에는 그대로 노출 — REQ-BLK-005). 차단은 전역이라
 * moimId 는 API 호출에 불필요하고 revalidate 대상 경로 결정에만 쓴다.
 * 실패(400 자기 차단 / 네트워크) → 일반화 오류(토큰/상세 비노출).
 */
export async function blockAction(
  moimId: string,
  blockedUserId: string,
): Promise<SafetyActionState> {
  if (!moimId || !blockedUserId) {
    return { error: BLOCK_GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await createBlock(api, blockedUserId);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`blockAction: POST /blocks 실패 (status ${status})`);
    return { error: BLOCK_GENERIC_ERROR };
  }

  // 성공: 상세를 재검증해 채팅/투표/지출/일정/알림 뷰어 측 필터가 반영되게 한다.
  revalidatePath(`/home/${moimId}`);
  return { ok: true };
}

/**
 * 차단을 해제한다(프로필 "차단한 멤버" 섹션 진입점 — DELETE /blocks/:blockedUserId, 멱등). 성공 시
 * /profile 을 재검증해 차단 목록이 갱신되게 한다. report 기반 숨김은 불변(해제 ≠ 신고 취소 — REQ-BLK-002).
 * 실패(네트워크) → 일반화 오류.
 */
export async function unblockAction(
  blockedUserId: string,
): Promise<SafetyActionState> {
  if (!blockedUserId) {
    return { error: UNBLOCK_GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await unblock(api, blockedUserId);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`unblockAction: DELETE /blocks 실패 (status ${status})`);
    return { error: UNBLOCK_GENERIC_ERROR };
  }

  // 성공: 프로필을 재검증해 "차단한 멤버" 목록에서 해제된 항목이 사라지게 한다.
  revalidatePath("/profile");
  return { ok: true };
}
