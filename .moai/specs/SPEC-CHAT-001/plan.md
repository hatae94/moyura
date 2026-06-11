# Plan — SPEC-CHAT-001 (모임 채팅 코어)

> 공유 리서치: [research.md](./research.md) | 인터뷰: [interview.md](./interview.md)

## 구현 접근

채팅 쓰기는 NestJS 서비스(멤버 인가 → Prisma insert), 실시간 전파는 Postgres 트리거 → Supabase Realtime Broadcast, 수신은 웹 supabase-js private channel 구독. 푸시 결합은 도메인 이벤트로만 노출(`chat-events.ts` 계약을 chat이 소유). sender 표시는 `moim_member.nickname` join으로 해석. keyset 커서는 내림차순(최신순 무한 스크롤).

## 마일스톤 분할 (run 단계)

### M1 — 모델 + 트리거/RLS + 핵심 서비스 (RED → GREEN)
- `schema.prisma`에 `ChatMessage`(BigInt PK, `@@index([moimId, id desc])`) 추가
- `prisma migrate dev --create-only --name add_chat` → migration.sql에 **수동 삽입**:
  - `broadcast_chat_message()` 트리거 함수(`security definer`) + `chat_message_broadcast` 트리거
  - `realtime.messages` RLS 정책(moim_member 멤버십 기반 구독 인가)
  - `chat_message` RLS enable + 정책 없음(default deny, PostgREST 우회 차단)
- `ChatService.sendMessage(sub, moimId, content)` — `assertMember` → insert → 저장 메시지(row) 반환 (nickname 미포함)
- `ChatService.getHistory(sub, moimId, { cursor?, limit })` — keyset 내림차순, row만 반환 (nickname은 클라이언트 해석)
- 단위 테스트(비멤버 403 포함)

### M2 — 이벤트 계약 + 발행
- `@nestjs/event-emitter` 설치 + `EventEmitterModule.forRoot()` 등록
- `chat-events.ts`: `CHAT_MESSAGE_CREATED` 상수 + `ChatMessageCreatedPayload` 타입(messageId, moimId, senderId, preview) export — **nickname 미포함**(소비 측 해석). 푸시(CHAT-002)가 senderId로 서버 측 nickname 조회.
- `sendMessage`에서 발행 → 발행 검증 테스트(emit 호출 인자 단언)

### M3 — 웹 채팅 UI (REQ-CHAT-006)
- `apps/web/app/moims/[id]/chat/page.tsx`: 멤버 목록 로드(senderId→nickname 매핑) + 히스토리 로드(api-client) + 메시지 입력/전송
- `apps/web/lib/chat/useChatChannel.ts`: private channel broadcast 구독 훅; 필요 시 `supabase.realtime.setAuth(accessToken)`; 수신 메시지의 senderId를 멤버 목록 매핑으로 nickname 해석(미지 sender는 멤버 목록 재조회 폴백)
- CSP 검증(R-2): Realtime `wss://`가 `connect-src`에 막히면 `proxy.ts` 1줄 수정
- `nx build web` + `lint`

### M4 — 종단 검증 + 계약 재생성
- 트리거 종단(insert → broadcast 수신) 통합 검증
- openapi → api-client 재생성, typecheck/test 커버리지 85%+
- `.moai/project/db/` 트리거/RLS 문서화(`/moai db refresh`)

## 기술 스택 / 의존성 (production stable only)

- 신규: `@nestjs/event-emitter`(NestJS 11 호환 stable 라인 — run 단계에서 정확한 버전 핀; `@nestjs/common ^11`과 정합).
- 기존: `@prisma/client 7.8.0`, `@prisma/adapter-pg 7.8.0`, `@supabase/supabase-js 2.106.2`(웹, 설치됨), `@supabase/ssr 0.10.3`, `next 16.2.6`.

## Prisma 모델 (초안)

```prisma
model ChatMessage {
  id        BigInt   @id @default(autoincrement())
  moimId    String
  senderId  String   // profile.id
  content   String   // 길이 제한은 DTO + DB CHECK
  createdAt DateTime @default(now())
  moim      Moim @relation(fields: [moimId], references: [id], onDelete: Cascade)
  @@index([moimId, id(sort: Desc)])
  @@map("chat_message")
}
```

## 트리거/RLS (수동 SQL — research §5.2 참조)

- `broadcast_chat_message()` 트리거 함수 + `chat_message_broadcast` after-insert 트리거
- `realtime.messages` SELECT 정책: `moim_member`에서 `'moim:'||moim_id = realtime.topic() AND user_id = auth.uid()::text`
- `chat_message` RLS enable(default deny)

## 리스크 분석 + 완화

| # | 리스크 | 완화 |
|---|--------|------|
| R-2 | Realtime `wss://`가 CSP `connect-src`에 차단 | 구현 시 검증, 필요 시 `proxy.ts`에 `wss:` 스킴 1줄 추가. 수락 기준에 포함. |
| R-6 | 트리거/RLS가 prisma migrate diff에 미포착 → 드리프트 | `--create-only` 후 SQL 수동 삽입 + `.moai/project/db/` 문서화 |
| R-RLS | anon/authenticated PostgREST 직접 접근 | `chat_message` RLS enable + 정책 없음(default deny) |
| R-SETAUTH | SSR 쿠키 세션에서 채널 인가 토큰 미전달 | 구독 직전 `supabase.realtime.setAuth(accessToken)` 명시 호출 필요 여부 supabase-js 2.106 기준 확인 |
| nickname 해석 | sender 표시 이름 해석 위치 | **결정(게이트)**: broadcast/이벤트 페이로드에 nickname을 넣지 않는다(트리거 thin 유지). 웹은 이미 로드한 멤버 목록(`GET /moims/:id/members`)에서 senderId→nickname 매핑, 미지 sender는 멤버 목록 재조회 폴백. 히스토리 응답도 row만(nickname은 클라이언트 해석). 푸시(CHAT-002)는 서버 측 자체 멤버 조회로 해석. |

## 생성/수정 파일

- [MODIFY] `apps/backend/prisma/schema.prisma`
- [NEW] `apps/backend/prisma/migrations/<ts>_add_chat/migration.sql` (모델 + 트리거 + RLS)
- [NEW] `apps/backend/src/chat/chat.module.ts`, `chat.service.ts`, `chat.controller.ts`, `dto/*.ts`
- [NEW] `apps/backend/src/chat/chat-events.ts` (계약 — 상수 + 페이로드 타입)
- [NEW] `apps/backend/src/chat/chat.service.spec.ts`
- [MODIFY] `apps/backend/src/app.module.ts` (EventEmitterModule + ChatModule)
- [MODIFY] `apps/backend/package.json` (@nestjs/event-emitter)
- [NEW] `apps/web/app/moims/[id]/chat/page.tsx`, `apps/web/lib/chat/useChatChannel.ts`
- [MODIFY] `apps/web/proxy.ts` (조건부 R-2)
- [NEW/MODIFY] `.moai/project/db/*.md`
- [REGEN] `apps/backend/openapi.json`, `packages/api-client/src/schema.d.ts`

## MX 태그 계획 (mx_plan)

- `@MX:ANCHOR` — `chat-events.ts`의 `CHAT_MESSAGE_CREATED` 상수 + `ChatMessageCreatedPayload`: 느슨한 결합 계약. CHAT-002가 단방향 의존. 불변 계약으로 고정.
- `@MX:ANCHOR` — `ChatService.sendMessage()`: 전송 진입점(웹/모바일 공통 소비, 이벤트 발행 원점).
- `@MX:WARN` (+ `@MX:REASON`) — 마이그레이션 SQL `broadcast_chat_message()` 트리거 함수: `security definer` + 수동 SQL이 Prisma diff에 미포착(드리프트 위험), realtime 스키마 의존.
- `@MX:NOTE` — `ChatService.sendMessage()`의 insert→emit 순서 의도; `realtime.messages` RLS 정책의 인가 의미; keyset 커서 내림차순 규약; broadcast/이벤트 페이로드에 nickname을 넣지 않고 소비 측(웹 클라이언트 멤버 목록 / 푸시 서버 조회)에서 해석하는 설계 의도(트리거 thin 유지, profile name 부재).

## 참조 (Reference)

- Reference: `apps/backend/src/profile/profile.service.ts` / `profile.service.spec.ts` — 서비스 + jest 단위 테스트 패턴
- Reference: `apps/backend/src/auth/supabase-auth.guard.ts`, `current-user.decorator.ts` — 가드 + `@CurrentUser()`
- Reference: `apps/backend/prisma.config.ts` — Prisma 7 듀얼 URL(migrate=DIRECT_URL)
- Reference: `apps/web/lib/supabase/client.ts` — 브라우저 Supabase 클라이언트(Realtime 구독 출처)
- Reference: `apps/web/proxy.ts` — per-request CSP(connect-src) — R-2 검증 지점
- Reference (선행): `.moai/specs/SPEC-MOIM-001/spec.md` — `assertMember`, `moim_member.nickname`
- Reference: [research.md](./research.md) §5.2 — Broadcast 트리거 + realtime.messages RLS SQL 예시
