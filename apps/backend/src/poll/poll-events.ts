// @MX:ANCHOR: [AUTO] 투표 도메인 이벤트 계약(SPEC-NOTIFICATIONS-001 M2). poll 모듈이 소유·export하며
// NotificationListener(인앱 알림)와 향후 PushListener(M6 FCM)가 이 계약에 단방향 의존한다(poll은 notification/
// push의 존재를 인식하지 않음 — 느슨한 결합 HARD).
// @MX:REASON: "투표 생성/마감 성공 → 이벤트 발행" 계약의 단일 출처. 이벤트 이름/페이로드 형태가 여기서만 정의되어
// 발행 측(PollService.createPoll/closePoll)과 구독 측(NotificationListener)이 드리프트 없이 합의한다(생산자별 소유).
// 날짜/장소 투표가 close 로 finalize 되어도 schedule.confirmed/location 을 추가 발행하지 않는다 — poll.closed 하나로
// 통일한다(소음 방지, plan §2 확정). 페이로드는 식별자 + 질문 미리보기만 운반한다(nickname/모임명 미포함 — 트리거 thin).

// moim.poll.created 도메인 이벤트 이름(createPoll).
export const MOIM_POLL_CREATED = 'moim.poll.created';

// moim.poll.closed 도메인 이벤트 이름(closePoll — 신규 마감으로 전이될 때만).
export const MOIM_POLL_CLOSED = 'moim.poll.closed';

// moim.poll.created 페이로드. 식별자 + 질문 미리보기만 운반한다.
export interface MoimPollCreatedPayload {
  // 투표가 생성된 모임 id. 구독 측이 수신 대상(멤버 − actor)을 산정하는 기준.
  moimId: string;
  // 투표를 만든 사용자 sub(= 유발자, 수신 대상에서 제외).
  actorId: string;
  // 생성된 투표 id(딥링크 타깃 — data.pollId).
  pollId: string;
  // 투표 질문(카피 미리보기 — data.question).
  question: string;
}

// moim.poll.closed 페이로드. 식별자 + 질문 미리보기만 운반한다.
export interface MoimPollClosedPayload {
  moimId: string;
  actorId: string;
  pollId: string;
  question: string;
}
