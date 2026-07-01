// @MX:ANCHOR: [AUTO] 일정 조율 도메인 이벤트 계약(SPEC-NOTIFICATIONS-001 M2). schedule 모듈이 소유·export하며
// NotificationListener(인앱 알림)와 향후 PushListener(M6 FCM)가 이 계약에 단방향 의존한다(schedule은
// notification/push의 존재를 인식하지 않음 — 느슨한 결합 HARD).
// @MX:REASON: "일정 조율 상태 변화(시작/날짜변경/시간대변경/확정) → 이벤트 발행" 계약의 단일 출처. 이벤트 이름/
// 페이로드 형태가 여기서만 정의되어 발행 측(ScheduleService)과 구독 측(NotificationListener)이 드리프트 없이
// 합의한다(생산자별 소유 원칙). 페이로드는 식별자 + 최소 미리보기만 운반한다(nickname/모임명 미포함 — 트리거 thin).
// started 는 setSchedule 의 create 경로에서만 발행하고 재설정(update) 경로는 발행하지 않는다(no-op/재설정 소음 방지).

// moim.schedule.started 도메인 이벤트 이름(setSchedule create 경로 전용).
export const MOIM_SCHEDULE_STARTED = 'moim.schedule.started';

// moim.schedule.dates_changed 도메인 이벤트 이름(updateDates).
export const MOIM_SCHEDULE_DATES_CHANGED = 'moim.schedule.dates_changed';

// moim.schedule.window_changed 도메인 이벤트 이름(updateWindow).
export const MOIM_SCHEDULE_WINDOW_CHANGED = 'moim.schedule.window_changed';

// moim.schedule.confirmed 도메인 이벤트 이름(confirmSchedule).
export const MOIM_SCHEDULE_CONFIRMED = 'moim.schedule.confirmed';

// moim.schedule.started 페이로드. 일정 조율 세션이 처음 생성된 경우에만 발행된다.
export interface MoimScheduleStartedPayload {
  // 일정 조율이 시작된 모임 id. 구독 측이 수신 대상(멤버 − actor)을 산정하는 기준.
  moimId: string;
  // 세션을 생성한 사용자 sub(= 유발자, 수신 대상에서 제외).
  actorId: string;
  // 생성된 일정 조율 세션 id(딥링크/추적용).
  scheduleEventId: string;
}

// moim.schedule.dates_changed 페이로드(후보 날짜 편집).
export interface MoimScheduleDatesChangedPayload {
  moimId: string;
  actorId: string;
}

// moim.schedule.window_changed 페이로드(조율 시간대 넓히기).
export interface MoimScheduleWindowChangedPayload {
  moimId: string;
  actorId: string;
}

// moim.schedule.confirmed 페이로드(일정 확정).
export interface MoimScheduleConfirmedPayload {
  moimId: string;
  actorId: string;
  // 확정된 절대 시각(ISO-8601 문자열 — 페이로드는 원시 식별자/문자열만 운반, Date 미노출).
  startsAt: string;
}
