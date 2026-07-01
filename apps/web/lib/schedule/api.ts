// 일정 조율 API 헬퍼 (SPEC-SCHEDULE-001).
//
// expenses.ts 의 구체-경로 패턴을 미러한다(moimId 인코딩 + api.request(path as never)).
// api-client.request 는 path 를 baseUrl 뒤에 그대로 연결하므로 여기서 경로를 완성한다.
import { type ApiClient } from "@moyura/api-client";

// ─────────────────────────────────────────────
// 타입 정의 (백엔드 schedule-response.dto 미러)
// ─────────────────────────────────────────────

/** 멤버별 가능 슬롯 1건. startMinute 은 후보일 00:00 기준 분(>=1440 이면 다음날). */
export interface ScheduleSlot {
  userId: string;
  date: string;
  startMinute: number;
}

/** 일정 조율 세션 + 전체 멤버 슬롯. confirmedAt 이 있으면 확정 완료(읽기 전용). */
export interface ScheduleEvent {
  id: string;
  moimId: string;
  createdBy: string;
  dates: string[];
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  confirmedAt: string | null;
  slots: ScheduleSlot[];
}

/** GET /moims/:id/schedule 응답. schedule=null 이면 아직 미설정. */
export interface ScheduleResponse {
  schedule: ScheduleEvent | null;
}

/** 세션 설정/재설정 입력(owner). */
export interface ScheduleConfigInput {
  dates: string[];
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
}

/** 가능 슬롯 입력 1건(내 가능시간 교체 저장). */
export interface SlotInput {
  date: string;
  startMinute: number;
}

// ─────────────────────────────────────────────
// API 헬퍼
// ─────────────────────────────────────────────

/**
 * 일정 조율 세션 + 전체 멤버 슬롯을 조회한다(GET /moims/:id/schedule). 멤버 전용.
 * 비멤버 → 403, 미존재 → 404(ApiError 전파). 미설정이면 { schedule: null }.
 */
export async function getSchedule(
  api: ApiClient,
  moimId: string,
): Promise<ScheduleResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule`;
  return (await api.request(path as never, "get")) as ScheduleResponse;
}

/**
 * 일정 조율 세션을 설정/재설정한다(PUT /moims/:id/schedule). owner 전용.
 * 재설정 시 기존 멤버 슬롯이 초기화된다(후보/범위 변경). 비-owner → 403, 무효 입력 → 400.
 */
export async function setSchedule(
  api: ApiClient,
  moimId: string,
  input: ScheduleConfigInput,
): Promise<ScheduleResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule`;
  return (await api.request(path as never, "put", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as ScheduleResponse;
}

/**
 * 후보 날짜를 편집한다(PUT /moims/:id/schedule/dates). 멤버 누구나(협업적 날짜 추가/제거).
 * 시간범위/슬롯 단위는 유지되고 dates 만 교체된다(빠진 날짜의 슬롯만 삭제, 남은 슬롯 보존).
 * 비멤버 → 403, 미설정/확정됨/형식 오류 → 400/404(ApiError 전파).
 */
export async function updateScheduleDates(
  api: ApiClient,
  moimId: string,
  dates: string[],
): Promise<ScheduleResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule/dates`;
  return (await api.request(path as never, "put", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dates }),
  })) as ScheduleResponse;
}

/**
 * 시간대(조율 범위)를 넓힌다(PUT /moims/:id/schedule/window). 멤버 누구나(협업).
 * 넓히기 전용 — 좁히면 400. 슬롯 단위·격자는 유지되고 남은 슬롯은 모두 보존된다.
 * 비멤버 → 403, 미설정/확정됨/좁히기/격자 오류 → 400/404(ApiError 전파).
 */
export async function updateScheduleWindow(
  api: ApiClient,
  moimId: string,
  startMinute: number,
  endMinute: number,
): Promise<ScheduleResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule/window`;
  return (await api.request(path as never, "put", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startMinute, endMinute }),
  })) as ScheduleResponse;
}

/**
 * 내 가능 슬롯을 통째로 교체 저장한다(PUT /moims/:id/schedule/me). 멤버 전용.
 * 그리드에서 칠한 셀 전체를 매번 보낸다(증분 아님). 빈 배열 = 전부 해제. 확정된 세션 → 400.
 */
export async function setMyAvailability(
  api: ApiClient,
  moimId: string,
  slots: SlotInput[],
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule/me`;
  await api.request(path as never, "put", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slots }),
  });
}

/**
 * 일정을 확정한다(POST /moims/:id/schedule/confirm). owner 전용.
 * 선택한 (date, startMinute)이 moim.startsAt 으로 확정된다(KST 기준). 비-owner → 403, 범위 밖 → 400.
 */
export async function confirmSchedule(
  api: ApiClient,
  moimId: string,
  date: string,
  startMinute: number,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule/confirm`;
  await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, startMinute }),
  });
}

/**
 * 일정 조율 세션을 삭제/초기화한다(DELETE /moims/:id/schedule). owner 전용. 멱등.
 */
export async function deleteSchedule(
  api: ApiClient,
  moimId: string,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/schedule`;
  await api.request(path as never, "delete");
}

// ─────────────────────────────────────────────
// 시간 포맷 헬퍼 (자정 넘김 지원)
// ─────────────────────────────────────────────

/**
 * 후보일 00:00 기준 분(minute)을 "HH:MM" 표기로 변환한다. 1440 이상(자정 넘김)은 24시간으로 wrap 한다
 * (예: 1500 → "01:00"). 다음날 여부는 isNextDay 로 별도 판정한다(그리드에서 "+1일" 배지 표시).
 */
export function formatMinute(minute: number): string {
  const wrapped = minute % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 슬롯 시작 분이 자정을 넘겨 다음날에 속하는지(>=1440). 그리드에서 "+1일" 표기·날짜 경계 강조에 쓴다. */
export function isNextDay(minute: number): boolean {
  return minute >= 1440;
}
