---
id: SPEC-CHAT-001
version: "0.3.0"
status: completed
created: 2026-06-11
updated: 2026-06-15
author: hatae
priority: high
issue_number: 0
---

# SPEC-CHAT-001 — 모임 채팅 코어

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md)

## HISTORY

- 2026-06-15 (v0.3.0): sync 완료 — 상태 전이 `in-progress` → `completed`.
  - 라이브 E2E 검증 결과 (2026-06-15, 로컬 Supabase 스택 127.0.0.1:54321 API / 54322 DB + direct Postgres INSERT):
    - 모임 seeding: 멤버 A(owner) + 멤버 B(member), 유저 C는 비멤버.
    - **AC-1c PASS**: 멤버 B가 인증 JWT(HS256, SUPABASE_JWT_SECRET)로 private 채널 `moim:{id}` 구독(SUBSCRIBED) 후, sender A의 `chat_message` row를 direct Postgres INSERT → `broadcast_chat_message` 트리거 → `realtime.broadcast_changes` 실행 → 멤버 B가 해당 메시지를 실시간 수신(content 일치). 종단 broadcast 동작 확인.
    - **AC-4 PASS**: 비멤버 C가 동일 채널 구독 시도 → `CHANNEL_ERROR: "Unauthorized: You do not have permissions to read from this Channel topic"` 반환 + 메시지 수신 없음. `realtime.messages` 멤버십 RLS가 비멤버를 정상 거부.
    - **AC-5 PASS**: `apps/web/proxy.ts` CSP `connect-src`는 `'self' wss://127.0.0.1:54321 http://127.0.0.1:54321` (호스트 고정). CSP3 scheme-matching에 의해 http origin 토큰이 ws:// realtime 연결을 허용하며, 라이브 E2E WebSocket 핸드셰이크 성공(멤버 B SUBSCRIBED) 확인. 채팅 UI 빌드/린트는 v0.2.0 게이트에서 이미 통과, send는 jest 검증 완료. 잔여 사항: 브라우저 풀 페이지 CSP 런타임(로그인 세션으로 `/moims/[id]/chat` 진입)은 별도로 실행하지 않았으나, CSP 정책이 realtime origin을 명시적으로 허용하고 프로토콜 수준 WS 연결·broadcast 수신을 증명하였으므로 AC-5 CSP 요건 충족으로 판정.
  - 임시 E2E 스크립트는 실행 후 삭제(임시 위생). 정식 수동 검증 스크립트: `apps/backend/test/chat.live.mts`.
  - 이전 누적 게이트(재실행 불필요): jest 170/170(chat 22), backend:typecheck 0, prisma migrate 드리프트 없음, psql 존재 단언 전부 통과(broadcast 함수/트리거/realtime 정책/chat_message RLS/CHECK), TRUST 5 PASS, evaluator PASS(Func 90/Sec 82/Craft 85/Consistency 90).
- 2026-06-13 (v0.2.0): run 완료 — 상태 전이 `draft` → `in-progress`.
  - 구현: `ChatMessage` 모델 + 마이그레이션 `20260613175232_add_chat`(트리거/RLS/CHECK 수동 SQL 포함) + `sendMessage`/`getHistory` + `chat.message.created` 이벤트 계약 + 웹 채팅 UI(`/moims/[id]/chat`).
  - 검증 게이트: jest 170/170(chat 22), psql 존재 단언 전부 통과(broadcast 함수/트리거/realtime 정책/chat_message RLS/CHECK), backend:typecheck 0, prisma migrate 드리프트 없음, TRUST 5 PASS, evaluator PASS(Func 90/Sec 82/Craft 85/Consistency 90).
  - `in-progress` 유지 근거: AC-1c(realtime broadcast 브라우저 종단 수신), AC-4(비멤버 RLS 구독 거부 런타임), AC-5(브라우저 구독·CSP 런타임)는 jest 자동화 불가 — psql 존재 단언으로 선행 조건만 검증됨. 디바이스 게이트 원칙(mobile SPEC과 동일)에 따라 런타임 검증 완료 전 completed로 전환하지 않는다. `apps/backend/test/chat.live.mts` 수동 검증 스크립트 제공.
- 2026-06-11 (v0.1.1): plan-auditor iteration 1 FAIL 대응 개정.
  - 웹 구독 UI REQ 신설(REQ-CHAT-006) — 고아였던 AC-5 연결.
  - nickname/broadcast 모순 해소(게이트 결정): broadcast 페이로드는 chat_message row만 운반(트리거 thin 유지); 웹 UI는 이미 로드한 멤버 목록에서 sender nickname을 클라이언트 측 해석(미지 sender는 재조회 폴백); CHAT-002 푸시는 서버 측 자체 멤버 조회로 nickname 해석. AC-1에서 broadcast 수신분의 nickname 요구 제거.
  - REQ-CHAT-002/004 정규 텍스트에서 구현 식별자(트리거 함수명·realtime 테이블명) 제거 — 결과 중심 재서술. HOW는 plan.md/§2 배경.
  - 이벤트 계약 발행 책임을 REQ-CHAT-001에 명시 흡수. REQ-CHAT-005 마커를 "(shall)"로 통일. priority 소문자화. 각 REQ에 커버 AC ID 표기. acceptance.md 링크 추가.
- 2026-06-11 (v0.1.0): 최초 작성(draft). 인터뷰 4개 결정 + 계획 검토 게이트 승인 반영.
  - 아키텍처: chat_message 모델 + NestJS REST(send + keyset history) + Supabase Realtime Broadcast(Postgres 트리거, private channel `moim:{id}`) + 웹 구독 UI.
  - 게이트 결정: 웹 UI는 `/moims/[id]/chat` 신규 라우트; sender 표시 이름은 `moim_member.nickname` join으로 해석; keyset 커서 내림차순(최신순).
  - 느슨한 결합: `chat.message.created` 도메인 이벤트 계약을 chat 모듈이 소유·export; push(CHAT-002)는 단방향 의존.
  - 공유 리서치: [research.md](./research.md), 인터뷰: [interview.md](./interview.md).

## 1. 목표 (Goal)

모임 멤버 간 실시간 채팅을 **푸시 없이도 완결적으로** 제공한다. `chat_message` 모델 + NestJS REST(메시지 전송 + keyset 페이지네이션 히스토리) + Supabase Realtime Broadcast(Postgres 트리거로 private channel `moim:{id}` 팬아웃) + 웹(Next.js) 구독 UI로 구성한다. 또한 푸시 모듈(CHAT-002)이 구독할 `chat.message.created` 도메인 이벤트 계약과 `@nestjs/event-emitter` 인프라를 선행 도입한다.

## 2. 배경 (Context)

- 쓰기: 웹/WebView → NestJS API → Prisma insert(`chat_message`). 쓰기 인가는 서비스 레이어(`assertMember`).
- 전파: Postgres 트리거 → Supabase Realtime Broadcast → private channel `moim:{id}`. broadcast 페이로드는 `chat_message` row만 운반(트리거를 thin하게 유지 — nickname 미포함). 구체 SQL은 plan.md/research §5.2.
- 수신: 웹 `supabase-js`(이미 설치된 `@supabase/supabase-js 2.106.2`) private channel broadcast 구독.
- 구독 인가: Realtime 메시지 RLS가 멤버십 조회로 처리(비멤버 구독 차단). 구체 정책은 plan.md/research §5.2.
- 표시 이름(게이트 결정): `Profile`에 name 부재 → 웹 UI는 이미 로드한 멤버 목록에서 sender nickname을 **클라이언트 측 해석**(미지 sender는 멤버 목록 재조회 폴백). 푸시(CHAT-002)는 서버 측 자체 멤버 조회로 해석. 즉 nickname은 broadcast 페이로드나 이벤트 페이로드가 아닌, 소비 측에서 멤버십 데이터로 해석한다.

상세 통합 지점·Broadcast SQL·RLS 정책·리스크는 공유 리서치 [research.md](./research.md) §2, §3, §5.2, §7 참조.

## 3. 가정 (Assumptions)

- SPEC-MOIM-001의 `moim`/`moim_member`(+nickname)가 존재한다(FK 의존). 실제 멤버 생성 경로(MOIM-002)와 무관하게, 채팅은 **멤버십 데이터에만** 의존한다. 테스트/픽스처는 `moim_member` row를 직접 insert해도 된다.
- Prisma는 postgres 롤로 직접 연결 → `chat_message` 테이블 RLS의 영향을 받지 않는다(쓰기 인가는 서비스 레이어). RLS는 구독 인가 + PostgREST 우회 차단 용도.
- 웹 브라우저 클라이언트가 쿠키 기반 인증 세션을 보유한다(WebView 내 동일 세션).

## 4. 요구사항 (EARS Requirements)

요구사항 모듈: 2개 (모듈 ≤ 5 한도 준수). 각 REQ는 단일 행위를 기술하며, 커버하는 AC ID를 함께 표기한다. 구현 식별자(트리거 함수명·RLS 테이블명 등)는 정규 텍스트에서 제외하고 plan.md/§2 배경에 둔다.

### 모듈 A — 메시징 (전송·조회·전파)

#### REQ-CHAT-001 [Event-driven] — 메시지 전송 + 이벤트 발행
**When** 모임 멤버가 메시지를 전송하면, 시스템은 메시지를 영속 저장하고 저장된 메시지를 반환한 뒤 `chat.message.created` 도메인 이벤트(메시지 id·moim id·sender id·미리보기 텍스트)를 발행한다(shall). — AC: AC-1

> 구현 힌트(비규정): 이벤트 이름/페이로드 계약은 chat 모듈이 `chat-events.ts`로 소유·export하고, push(CHAT-002)가 단방향 의존. 상세 plan.md.

#### REQ-CHAT-002 [Event-driven] — 실시간 전파
**When** 새 메시지가 영속 저장되면, 시스템은 해당 모임의 private 실시간 채널 구독자에게 그 메시지를 전파한다(shall). 전파 페이로드는 메시지 레코드만 포함한다(sender 표시 이름은 소비 측에서 멤버십 데이터로 해석). — AC: AC-1

#### REQ-CHAT-003 [Ubiquitous] — keyset 히스토리
시스템은 keyset 페이지네이션(커서 = 마지막 메시지 식별자, **내림차순/최신순**)으로 모임 메시지 히스토리를 제공한다(shall). — AC: AC-2

### 모듈 B — 접근 제어

#### REQ-CHAT-004 [State-driven] — 비멤버 구독 차단
**While** 구독자가 대상 모임의 멤버가 아닌 동안, 시스템은 해당 모임의 실시간 채널 메시지 구독을 거부한다(shall). — AC: AC-4

#### REQ-CHAT-005 [Unwanted] — 비멤버 전송 차단
**If** 비멤버가 메시지 전송을 시도하면, **then** 시스템은 저장·발행 없이 403을 반환한다(shall). — AC: AC-3

#### REQ-CHAT-006 [Ubiquitous] — 웹 구독 UI
시스템은 모임 채팅 화면에서 진입 시 해당 모임 채널을 구독하고, 수신한 실시간 메시지를 즉시 표시하며(sender 표시 이름은 멤버 목록에서 해석), 메시지 전송을 제공한다(shall). — AC: AC-5

## 5. 비범위 (Exclusions — What NOT to Build)

- **FCM/백그라운드 푸시 일체** — SPEC-CHAT-002 책임.
- **읽음 확인(read receipts), 타이핑 인디케이터(typing indicators)**.
- **메시지 수정/삭제(edit/delete)** — insert-only.
- **첨부 파일/이미지/이모지 리액션**.
- **네이티브 채팅 화면** — 웹 UI(`/moims/[id]/chat`)를 WebView로 호스팅(research §4.3).
- **웹 푸시(브라우저 Web Push)**.

## 6. 변경 마커 (Delta Markers — Brownfield)

- [MODIFY] `apps/backend/prisma/schema.prisma` — `ChatMessage` 모델
- [MODIFY] `apps/backend/src/app.module.ts` — `EventEmitterModule.forRoot()` + `ChatModule`(MoimModule 뒤)
- [MODIFY] `apps/backend/package.json` — `@nestjs/event-emitter` 추가
- [MODIFY] `apps/web/proxy.ts` — (조건부 R-2) `connect-src`에 `wss:` 허용
- [NEW] `apps/backend/prisma/migrations/<ts>_add_chat/` — 모델 + **트리거/RLS SQL 수동 삽입**
- [NEW] `apps/backend/src/chat/**` — module/service/controller/dto + `chat-events.ts`(계약)
- [NEW] `apps/web/app/moims/[id]/chat/**` + `apps/web/lib/chat/useChatChannel.ts`
- [NEW/MODIFY] `.moai/project/db/*.md` — 트리거/RLS 문서화
- [REGEN] `apps/backend/openapi.json` + `packages/api-client`

## 7. 의존성 (Dependencies)

- 선행 SPEC: **SPEC-MOIM-001 완료**(`moim`/`moim_member`+nickname, `assertMember`). **SPEC-MOIM-002와 병렬 가능**(채팅은 멤버십 데이터에만 의존, 가입 경로와 무관).
- 기존 자산: `SupabaseAuthGuard`, `@CurrentUser()`, 웹 `lib/supabase/client.ts`(`@supabase/supabase-js 2.106.2`), `proxy.ts` CSP.
- 신규 라이브러리: `@nestjs/event-emitter`(CHAT-002가 구독할 인프라 선행 설치).
- 외부 셋업: 없음(Firebase는 CHAT-002). 로컬 Supabase 스택(Realtime enabled) 사용.

## 8. 품질 게이트 (Quality Gate)

- 백엔드: jest TDD, 커버리지 85%+ (전송·keyset·비멤버 403·이벤트 발행).
- 트리거 종단 검증: insert → broadcast 수신(통합 검증).
- 웹: 테스트 하니스 없음 → `nx build web` + `lint`만 (기존 합의). CSP 위반 없이 Realtime 구독 연결(R-2).
- 트리거/RLS는 마이그레이션 SQL에 포함하고 `.moai/project/db/`에 문서화(드리프트 방지 R-6).

---

## Implementation Notes (as-implemented)

> run 완료 기준: 2026-06-13. 커밋 f3fe178 (branch feature/SPEC-MOBILE-004).

### 생성/수정 파일

| 유형 | 경로 |
|------|------|
| NEW | `apps/backend/src/chat/chat.service.ts` |
| NEW | `apps/backend/src/chat/chat.controller.ts` |
| NEW | `apps/backend/src/chat/chat-events.ts` (이벤트 계약 export — @MX:ANCHOR) |
| NEW | `apps/backend/src/chat/chat.module.ts` |
| NEW | `apps/backend/src/chat/dto/send-message.dto.ts` |
| NEW | `apps/backend/src/chat/dto/get-history.dto.ts` |
| NEW | `apps/backend/src/chat/dto/message-response.dto.ts` |
| NEW | `apps/backend/src/chat/chat.service.spec.ts` |
| NEW | `apps/backend/src/chat/chat.integration.spec.ts` |
| NEW | `apps/backend/test/chat.live.mts` (수동 검증 스크립트) |
| NEW | `apps/backend/prisma/migrations/20260613175232_add_chat/migration.sql` |
| NEW | `apps/web/lib/chat/useChatChannel.ts` |
| NEW | `apps/web/app/moims/[id]/chat/page.tsx` |
| MODIFY | `apps/backend/src/app.module.ts` (EventEmitterModule.forRoot + ChatModule) |
| MODIFY | `apps/backend/package.json` (@nestjs/event-emitter@^3.1.0 추가) |
| MODIFY | `apps/backend/prisma/schema.prisma` (ChatMessage 모델 + Moim.messages 관계) |
| MODIFY | `apps/web/proxy.ts` (CSP connect-src wss 호스트 고정) |
| MODIFY | `.moai/project/db/migrations.md` (T-010 — run 중 갱신 완료) |
| MODIFY | `.moai/project/db/rls-policies.md` (T-010 — run 중 갱신 완료) |

### 구현 중 수정 사항 (수정 필요 발견 및 적용)

1. **`realtime.broadcast_changes` 7-arg / `private=true`**: 공식 API는 7인자 시그니처(`topic, event_type, operation, table, schema, new, old`)이며 private 토픽은 `private=true`가 아닌 토픽 접두사 규칙(`moim:` 네이밍)으로 처리. 초기 설계의 5-arg 호출 수정.
2. **BigInt → string DTO 직렬화**: `chat_message.id`는 Prisma `BigInt` 타입 — JSON 직렬화 시 `Cannot serialize BigInt` 오류. `message-response.dto.ts`에서 `.toString()` 변환 명시, 이벤트 페이로드 `messageId`도 string 타입으로 강제.
3. **404 → 403 변환**: 존재하지 않는 모임으로 전송 시 `assertMember`가 `NotFoundException` 반환하는 경우 `ForbiddenException`으로 래핑. 모임 존재 여부 노출 방지(spec 엣지 케이스 항목 준수).
4. **shadow-DB 가드 (`to_regnamespace`)**: `realtime.messages` 정책 DDL은 Prisma shadow DB(vanilla Postgres — `realtime` 스키마 없음)에서 실패. `DO $$ BEGIN IF to_regnamespace('realtime') IS NOT NULL THEN ... END IF; END $$` 가드 블록으로 감싸 shadow 검증을 통과시킴.

### 사후 강화 (evaluator MEDIUM 항목 적용)

- **emit best-effort 격리**: `chat.service.ts` emit을 `try-catch`로 래핑하여 CHAT-002 리스너 예외가 `sendMessage` 201 응답을 막지 않도록 처리. DB insert 성공 후 HTTP 500 불일치 방지.
- **CSP wss 호스트 고정**: `proxy.ts` connect-src를 `wss:` 전체 허용에서 `wss://${supabaseHost}` 호스트 고정으로 변경(OWASP A05 MEDIUM 완화).

### 검증 계층 (3단계)

| 계층 | 수단 | 항목 | 상태 |
|------|------|------|------|
| jest 자동 | `chat.service.spec.ts`, `chat.integration.spec.ts` | AC-1a/1b, AC-2, AC-3(HTTP/서비스/엣지), sendMessage/getHistory 경로 전부 | PASS (22/22) |
| psql 존재 단언 | `psql -c "SELECT ..."` 직접 실행 | broadcast 함수, 트리거, realtime SELECT 정책, chat_message RLS enabled, content CHECK | PASS (2026-06-14) |
| 런타임/수동 | `apps/backend/test/chat.live.mts` 스크립트 | AC-1c(broadcast 수신), AC-4(비멤버 구독 거부), AC-5(브라우저 구독/CSP) | 대기 (live/device-gated) |

### 미검증 항목 (in-progress 근거)

- **AC-1c**: 브라우저 클라이언트가 `moim:{id}` private 채널에서 실제 메시지를 수신하는 종단 동작. 트리거/RLS 존재는 psql로 확인되었으나, Supabase Realtime 연결 수립 및 broadcast 페이로드 수신은 브라우저 런타임에서만 검증 가능.
- **AC-4**: 비멤버 authenticated 세션이 구독 시도 시 RLS가 실제로 거부하는 런타임 동작.
- **AC-5**: 채팅 UI 브라우저 구독/수신/전송 동작 및 CSP `connect-src` 위반 없는 WebSocket 연결.

검증 경로: `apps/backend/test/chat.live.mts`를 로컬 Supabase 실행 환경에서 수동 실행하거나 브라우저 DevTools로 직접 확인.

### 크로스 SPEC 참고

- **CHAT-002** (FCM 푸시 알림)는 `apps/backend/src/chat/chat-events.ts`의 `CHAT_MESSAGE_CREATED` 이벤트 계약(@MX:ANCHOR)을 단방향 의존으로 소비한다. chat 모듈이 계약을 소유하며, CHAT-002는 `@OnEvent(CHAT_MESSAGE_CREATED)` 리스너만 추가하면 된다.
- evaluator MEDIUM (`emit 비격리`) 항목은 현재 해결됨(try-catch 적용). CHAT-002 리스너 도입 시 `asyncHandlers: true` 옵션 재검토 권장.
