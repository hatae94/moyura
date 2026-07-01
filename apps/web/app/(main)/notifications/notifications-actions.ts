// 인앱 알림 읽음 처리 Server Action (Notifications M5 — 웹 알림 탭).
//
// schedule-actions.ts 의 requireToken + Server Action 패턴을 미러한다: 토큰은 서버 경계(쿠키 세션)에서만
// 다루고 클라이언트에 노출하지 않으며, 인가는 백엔드(recipientId===sub)가 최종 출처다.
//
// revalidatePath 를 쓰지 않는 이유: 읽음 상태(readAt)는 클라이언트가 낙관적으로 반영하고(NotificationFeed),
//   배지는 컨텍스트(useNotificationCount)가 소비하므로, 서버 재검증은 낙관적 상태를 잠깐 되돌리는 플리커만
//   유발한다. 이 액션은 "쓰기 요청 발사"만 책임지고, 화면 갱신은 클라 낙관적 업데이트 + 컨텍스트가 담당한다.
"use server";

import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { type MarkReadRequest, markRead } from "@/lib/notifications/api";
import { createClient } from "@/lib/supabase/server";

/** 알림 읽음 액션 결과 상태(schedule-actions 의 ScheduleActionState 와 동형). */
export type MarkReadActionState = { ok?: boolean; error?: string } | undefined;

const GENERIC_ERROR = "요청을 처리하지 못했습니다. 다시 시도해 주세요.";

/** 쿠키 세션을 읽어 access_token 을 돌려준다. 세션 부재면 /login 리다이렉트(schedule-actions 미러). */
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
 * 알림을 읽음 처리한다. { ids:[id] } = 탭한 알림 1건, { all:true } = 모두 읽음.
 * 실패(네트워크/백엔드 오류)는 일반화 오류로 돌려 클라가 낙관적 UI 를 유지/무시하도록 한다(비차단).
 */
export async function markNotificationsReadAction(
  input: MarkReadRequest,
): Promise<MarkReadActionState> {
  const token = await requireToken();

  try {
    const api = createApiClient({ baseUrl: API_BASE_URL, getToken: () => token });
    await markRead(api, input);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(
      `markNotificationsReadAction: POST /notifications/read 실패 (status ${status})`,
    );
    return { error: GENERIC_ERROR };
  }

  return { ok: true };
}
