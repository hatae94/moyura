// @MX:ANCHOR: [AUTO] 모임 멤버십 변동 도메인 이벤트 계약(SPEC-NOTIFICATIONS-001 M2). moim 모듈이 소유·export하며
// NotificationListener(인앱 알림)와 향후 PushListener(M6 FCM)가 이 계약에 단방향 의존한다(moim은 notification/
// push의 존재를 인식하지 않음 — 느슨한 결합 HARD).
// @MX:REASON: "소유권 이양/강제 퇴장 성공 → 이벤트 발행" 계약의 단일 출처. 이벤트 이름/페이로드 형태가 여기서만
// 정의되어 발행 측(MoimService.transferOwner/kickMember)과 구독 측(NotificationListener)이 드리프트 없이 합의한다.
// invite-events(moim.member.joined)와 별도 파일로 분리한 이유: 생산자별 소유 원칙 — member.joined 는 InviteService
// 가, owner.transferred/member.kicked 는 MoimService 가 발행하므로 계약도 생산 도메인(moim)에 둔다.
// 페이로드는 식별자만 운반한다(nickname/모임명 미포함 — 트리거 thin 유지, 소비 측이 응답 시점에 표시 이름 해석).

// moim.owner.transferred 도메인 이벤트 이름(@nestjs/event-emitter 토픽).
export const MOIM_OWNER_TRANSFERRED = 'moim.owner.transferred';

// moim.member.kicked 도메인 이벤트 이름(@nestjs/event-emitter 토픽).
export const MOIM_MEMBER_KICKED = 'moim.member.kicked';

// moim.owner.transferred 이벤트 페이로드. 식별자만 운반한다(nickname/모임명 미포함).
export interface MoimOwnerTransferredPayload {
  // 소유권이 이양된 모임 id. 구독 측이 수신 대상(모임 전체 − actor)을 산정하는 기준.
  moimId: string;
  // 이양을 실행한 현 owner sub(= 유발자). 수신 대상에서 제외된다.
  actorId: string;
  // 새 owner 로 지정된 멤버 sub(모임 전체 공지에서 강조 대상 — data.newOwnerId 로 실린다).
  newOwnerId: string;
}

// moim.member.kicked 이벤트 페이로드. 식별자만 운반한다(nickname/모임명 미포함).
export interface MoimMemberKickedPayload {
  // 멤버가 퇴장당한 모임 id.
  moimId: string;
  // 퇴장을 실행한 owner sub(= 유발자).
  actorId: string;
  // 강제 퇴장당한 멤버 sub(= 유일한 수신 대상 — 퇴장 당사자에게만 알린다).
  targetId: string;
}
