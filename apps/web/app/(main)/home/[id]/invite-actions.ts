// 모임 초대 발급 Server Action (SPEC-MOIM-011 REQ-MOIM11-003).
//
// poll-actions.ts 의 requireToken + Server Action 패턴을 미러한다. 토큰(가입 자격증명)은 서버 경계에서
// 발급해 클라이언트로 token 만 돌려준다 — owner 인가는 백엔드 assertOwner(403)가 최종 출처다(UI 는 버튼 숨김 = 방어선).
"use server";

import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createInvite } from "@/lib/moim/invites";
import { createClient } from "@/lib/supabase/server";

/** 초대 발급 결과 상태(클라이언트가 token 으로 링크 조립, 실패 시 일반화 오류). */
export type CreateInviteActionState =
  | { token?: string; error?: string }
  | undefined;

const GENERIC_ERROR = "초대 링크를 만들지 못했습니다. 다시 시도해 주세요.";

/** 쿠키 세션을 읽어 access_token 을 돌려준다. 세션 부재면 /login 리다이렉트(보호 경로 미진입). */
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
 * 모임 초대를 발급한다(owner 전용 — 비-owner 는 백엔드 403 → 일반화 오류). 성공 시 token 을 돌려주면
 * 클라이언트가 `{origin}/invite/{token}` 링크를 조립해 복사/공유한다. revalidate 불필요(목록 화면 미표시 — MVP).
 */
export async function createInviteAction(
  moimId: string,
): Promise<CreateInviteActionState> {
  if (!moimId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    const invite = await createInvite(api, moimId);
    return { token: invite.token };
  } catch (err) {
    // 백엔드 발급 실패(403 비-owner/404/네트워크) → 일반화된 오류(토큰/상세 비노출). 화면 머무름.
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`createInviteAction: POST invites 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }
}
