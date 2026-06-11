# SPEC-CHAT-001 (compact)

priority: high | status: draft | depends: SPEC-MOIM-001 | parallel-with: SPEC-MOIM-002

## REQ (modules: A 메시징 / B 접근 제어)
- REQ-CHAT-001 [Event-driven] 멤버 전송 → 메시지 영속 저장 + 저장 메시지 반환 + chat.message.created(id·moimId·senderId·preview) 발행. (AC-1)
- REQ-CHAT-002 [Event-driven] 새 메시지 저장 시 모임 private 실시간 채널 구독자에게 전파(페이로드=메시지 레코드만, nickname 미포함). (AC-1)
- REQ-CHAT-003 [Ubiquitous] keyset 페이지네이션(커서=마지막 식별자, 내림차순/최신순). (AC-2)
- REQ-CHAT-004 [State-driven] 비멤버는 실시간 채널 메시지 구독 거부. (AC-4)
- REQ-CHAT-005 [Unwanted] 비멤버 전송은 저장/발행 없이 403. (AC-3)
- REQ-CHAT-006 [Ubiquitous] 웹 채팅 화면 진입 시 채널 구독 + 수신 메시지 표시(nickname은 멤버 목록 해석) + 전송. (AC-5)

## Acceptance
- AC-1 전송 → 실시간 전파 종단 수신 + 이벤트 발행 (broadcast 페이로드 nickname 미포함)
- AC-2 keyset 히스토리(내림차순, row만)
- AC-3 비멤버 전송 403, 미저장/미발행
- AC-4 비멤버 구독 RLS 거부
- AC-5 웹 구독/표시/전송 + build/lint + CSP 위반 없는 구독

## Files to modify/create
- [MODIFY] apps/backend/prisma/schema.prisma (ChatMessage)
- [MODIFY] apps/backend/src/app.module.ts (EventEmitterModule + ChatModule)
- [MODIFY] apps/backend/package.json (@nestjs/event-emitter)
- [MODIFY] apps/web/proxy.ts (조건부 wss:)
- [NEW] apps/backend/prisma/migrations/<ts>_add_chat/ (모델 + 트리거 + RLS)
- [NEW] apps/backend/src/chat/** + chat-events.ts(계약, payload=ids+preview, nickname 미포함)
- [NEW] apps/web/app/moims/[id]/chat/** + lib/chat/useChatChannel.ts (nickname 클라이언트 해석)
- [NEW/MODIFY] .moai/project/db/*.md
- [REGEN] openapi.json + packages/api-client

## Exclusions
- FCM/백그라운드 푸시(CHAT-002), 읽음 확인, 타이핑 인디케이터, 메시지 수정/삭제, 첨부/리액션, 네이티브 채팅 화면, 웹 푸시
