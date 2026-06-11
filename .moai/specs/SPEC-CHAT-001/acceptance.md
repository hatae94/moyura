# Acceptance — SPEC-CHAT-001 (모임 채팅 코어)

> REQ↔AC 매핑은 spec.md 각 REQ의 "AC:" 라인 참조. 모든 AC는 1개 이상의 REQ를 커버한다.

## Given/When/Then 시나리오

### AC-1 (REQ-CHAT-001, REQ-CHAT-002) — 전송 → 실시간 전파 종단
- **Given** 모임 A의 실시간 채널을 구독 중인 멤버 클라이언트
- **When** 다른 멤버가 `POST /moims/A/messages { content }`
- **Then** 메시지 영속 저장 + 구독 클라이언트가 새 메시지 레코드(id·moimId·senderId·content·createdAt)를 실시간 수신 + `chat.message.created` 이벤트 발행
- **Note** broadcast 페이로드에는 sender nickname이 포함되지 않는다(게이트 결정 — 트리거 thin 유지). 클라이언트는 멤버 목록에서 senderId→nickname을 해석한다.

### AC-2 (REQ-CHAT-003) — keyset 히스토리 (내림차순)
- **Given** 모임 A에 메시지 N개
- **When** `GET /moims/A/messages?cursor=<id>&limit=K`
- **Then** 200 + 커서 이전 **최신순(내림차순)** K개 + 다음 커서 제공 (sender 표시 이름은 클라이언트가 멤버 목록으로 해석)

### AC-3 (REQ-CHAT-005) — 비멤버 전송 차단
- **Given** 모임 A의 비멤버(인증됨)
- **When** `POST /moims/A/messages`
- **Then** 403 + 메시지 미저장 + `chat.message.created` 미발행

### AC-4 (REQ-CHAT-004) — 비멤버 구독 차단 (RLS)
- **Given** 비멤버 인증 세션
- **When** 모임 A의 private 실시간 채널 구독 시도
- **Then** RLS가 구독(메시지 select) 인가 거부

### AC-5 (REQ-CHAT-006) — 채팅 UI 구독/표시/전송 + 빌드
- **Given** `/moims/[id]/chat` 라우트 + 구독 훅
- **When** 화면 진입(채널 구독 + 히스토리 로드) → 다른 멤버 메시지 수신 → 표시 → 전송; 그리고 `nx build web` + `lint`
- **Then** 진입 시 구독, 수신 메시지 즉시 렌더(sender nickname을 멤버 목록에서 해석), 전송 동작 + 빌드/린트 통과 + Realtime 구독이 CSP(`connect-src`) 위반 없이 연결(R-2)

## 엣지 케이스

- 빈 content / 길이 초과 → 400 (DTO 검증 + DB CHECK)
- cursor 없이 첫 페이지 요청 → 최신 K개 반환
- 존재하지 않는 모임으로 전송 → **403** (비멤버 처리와 동일 — 모임 존재 여부 노출 방지, 결정됨)
- 동시 다발 insert → 단조 증가 식별자로 순서 보존, keyset 커서 안정
- 미지 senderId(클라이언트가 멤버 목록에 없는 sender 수신) → 멤버 목록 재조회 폴백
- WebView 내 동일 쿠키 세션 → 추가 작업 없이 구독 동작(research §7c)

## 품질 게이트 기준

- **백엔드 테스트**: jest, 커버리지 **85%+** (전송/keyset/비멤버 403/이벤트 발행 경로).
- **전파 종단 검증**: 로컬에서 메시지 저장 → 실시간 구독 수신 통합 확인.
- **웹**: 테스트 하니스 없음 → `nx build web` + `lint`만 (기존 합의).
- 트리거/RLS가 마이그레이션 SQL에 포함되고 `.moai/project/db/`에 문서화(R-6).
- openapi.json + api-client 재생성 후 typecheck 통과.

## Definition of Done

- [ ] `ChatMessage` 모델 + 마이그레이션(트리거 + Realtime 메시지 RLS + chat_message default-deny RLS 포함)
- [ ] `sendMessage`(assertMember → insert → 저장 메시지 반환 → event emit) + `getHistory`(keyset 내림차순)
- [ ] `@nestjs/event-emitter` 등록 + `chat-events.ts` 계약 export(@MX:ANCHOR)
- [ ] 웹 `/moims/[id]/chat` UI: 구독 + 수신 표시(nickname 클라이언트 해석) + 전송
- [ ] CSP(R-2) 검증/수정
- [ ] 백엔드 커버리지 85%+, 전파 종단 검증, 웹 build/lint green
- [ ] openapi + api-client 재생성, db 문서 동기화
