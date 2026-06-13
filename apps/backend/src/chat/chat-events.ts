// @MX:ANCHOR: [AUTO] 채팅 도메인 이벤트 계약(REQ-CHAT-001 / AC-1). chat 모듈이 소유·export하며
// SPEC-CHAT-002(FCM 푸시)가 이 계약에 단방향 의존한다(chat은 push 존재를 인식하지 않음 — 느슨한 결합).
// @MX:REASON: "메시지 저장 → 이벤트 발행" 계약의 단일 출처. 이벤트 이름/페이로드 형태가 여기서만 정의되어
// 발행 측(ChatService)과 구독 측(CHAT-002 PushListener)이 드리프트 없이 합의한다(fan_in: 발행 1 + 구독 1+).
// 페이로드는 식별자 + 미리보기만 포함하고 nickname은 의도적으로 제외한다(트리거 thin 유지와 동일 원칙 —
// 소비 측이 멤버십 데이터로 sender 표시 이름을 해석한다. spec §2 게이트 결정).

// chat.message.created 도메인 이벤트 이름(@nestjs/event-emitter 토픽).
export const CHAT_MESSAGE_CREATED = 'chat.message.created';

// chat.message.created 이벤트 페이로드. messageId는 BigInt PK를 문자열로 직렬화한 값이다
// (BigInt는 JSON/이벤트 경계에서 안전하게 다루기 위해 문자열로 운반 — T-006 응답 DTO와 동일 규칙).
export interface ChatMessageCreatedPayload {
  // 저장된 메시지 식별자(ChatMessage.id.toString()). 단조 증가 BigInt의 문자열 표현.
  messageId: string;
  // 메시지가 속한 모임 id.
  moimId: string;
  // 발신자 sub(= profile.id). 구독 측이 수신 대상(멤버 - sender)을 산정하는 데 쓴다.
  senderId: string;
  // 알림 미리보기 텍스트(원문 content). 푸시 본문 등에 사용된다. nickname은 포함하지 않는다.
  preview: string;
}
