// 일정 조율 Server Action (SPEC-SCHEDULE-001).
//
// expense-actions.ts 의 requireToken + Server Action 패턴을 미러한다.
// 토큰은 서버 경계에서만 다루고 클라이언트에 노출하지 않는다. 인가는 백엔드가 최종 출처.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import {
  type ScheduleConfigInput,
  type SlotInput,
  confirmSchedule,
  deleteSchedule,
  setMyAvailability,
  setSchedule,
} from "@/lib/schedule/api";
import { createClient } from "@/lib/supabase/server";

/** 일정 조율 액션 공통 결과 상태 */
export type ScheduleActionState = { ok?: boolean; error?: string } | undefined;

const GENERIC_ERROR = "요청을 처리하지 못했습니다. 다시 시도해 주세요.";

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
 * 일정 조율 세션을 설정/재설정한다(owner). 성공 시 일정 페이지를 재검증한다.
 * 실패(403 비-owner / 400 무효 입력 / 네트워크) → 일반화 오류.
 */
export async function setScheduleAction(
  moimId: string,
  input: ScheduleConfigInput,
): Promise<ScheduleActionState> {
  if (!moimId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({ baseUrl: API_BASE_URL, getToken: () => token });
    await setSchedule(api, moimId, input);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`setScheduleAction: PUT schedule 실패 (status ${status})`);
    // 400(검증 실패)은 사용자 입력 문제라 서버 메시지를 노출해도 안전(토큰 비노출).
    if (err instanceof ApiError && err.status === 400) {
      return { error: err.message || GENERIC_ERROR };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/schedule`);
  return { ok: true };
}

/**
 * 내 가능 슬롯을 통째로 교체 저장한다(멤버). 성공 시 일정 페이지를 재검증한다.
 * 실패(403 비멤버 / 400 확정됨·범위밖 / 네트워크) → 일반화 오류.
 */
export async function setMyAvailabilityAction(
  moimId: string,
  slots: SlotInput[],
): Promise<ScheduleActionState> {
  if (!moimId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({ baseUrl: API_BASE_URL, getToken: () => token });
    await setMyAvailability(api, moimId, slots);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`setMyAvailabilityAction: PUT schedule/me 실패 (status ${status})`);
    if (err instanceof ApiError && err.status === 400) {
      return { error: err.message || GENERIC_ERROR };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/schedule`);
  return { ok: true };
}

/**
 * 일정을 확정한다(owner). moim.startsAt 이 갱신되므로 일정 페이지 + 모임 상세를 함께 재검증한다.
 * 실패(403 비-owner / 400 범위 밖 / 네트워크) → 일반화 오류.
 */
export async function confirmScheduleAction(
  moimId: string,
  date: string,
  startMinute: number,
): Promise<ScheduleActionState> {
  if (!moimId || !date) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({ baseUrl: API_BASE_URL, getToken: () => token });
    await confirmSchedule(api, moimId, date, startMinute);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`confirmScheduleAction: POST schedule/confirm 실패 (status ${status})`);
    if (err instanceof ApiError && err.status === 400) {
      return { error: err.message || GENERIC_ERROR };
    }
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/schedule`);
  // 확정은 moim.startsAt 을 갱신하므로 모임 상세(헤더 일정)도 재검증한다.
  revalidatePath(`/home/${moimId}`);
  return { ok: true };
}

/**
 * 일정 조율 세션을 삭제/초기화한다(owner). 성공 시 일정 페이지를 재검증한다.
 */
export async function deleteScheduleAction(
  moimId: string,
): Promise<ScheduleActionState> {
  if (!moimId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({ baseUrl: API_BASE_URL, getToken: () => token });
    await deleteSchedule(api, moimId);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`deleteScheduleAction: DELETE schedule 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/schedule`);
  return { ok: true };
}
