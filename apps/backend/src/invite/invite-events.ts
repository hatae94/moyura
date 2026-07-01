// @MX:ANCHOR: [AUTO] 초대-멤버십 도메인 이벤트 계약(SPEC-NOTIFICATIONS-001 M1). invite 모듈이 소유·export하며
// SPEC-NOTIFICATIONS-001 NotificationListener(인앱 알림)와 향후 PushListener(M6 FCM)가 이 계약에 단방향
// 의존한다(invite는 notification/push의 존재를 인식하지 않음 — 느슨한 결합 HARD).
// @MX:REASON: "신규 멤버십 성공 → 이벤트 발행" 계약의 단일 출처. 이벤트 이름/페이로드 형태가 여기서만 정의되어
// 발행 측(InviteService.accept)과 구독 측(NotificationListener)이 드리프트 없이 합의한다(fan_in: 발행 1 + 구독 1+).
// 파일 위치는 chat-events 선례를 따라 "생산 도메인이 소유"한다 — 이벤트 이름은 moim.* 네임스페이스지만(모임
// 멤버십 사실을 표현) 발행 주체가 InviteService이므로 계약 파일은 invite 도메인에 둔다. M2 의 다른 moim.* 이벤트
// (owner.transferred·member.kicked)는 MoimService 가 발행하므로 별도 moim-events.ts 로 분리된다(생산자별 소유).
// 페이로드는 식별자만 포함하고 nickname은 의도적으로 제외한다(트리거 thin 유지 — 소비 측이 멤버십 데이터로
// 표시 이름을 응답 시점에 해석한다. plan §4).

// moim.member.joined 도메인 이벤트 이름(@nestjs/event-emitter 토픽).
export const MOIM_MEMBER_JOINED = 'moim.member.joined';

// moim.member.joined 이벤트 페이로드. 식별자만 운반한다(nickname/모임명 미포함 — 소비 측 해석).
export interface MoimMemberJoinedPayload {
  // 새 멤버가 가입한 모임 id. 구독 측이 수신 대상(모임 멤버 − actor)을 산정하는 기준.
  moimId: string;
  // 가입한 신규 멤버 sub(= profile.id). 알림 유발자이자 수신 대상에서 제외되는 당사자.
  actorId: string;
}
