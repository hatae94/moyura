---
id: SPEC-CHAT-001
version: "0.1.1"
status: draft
created: 2026-06-11
updated: 2026-06-11
author: hatae
priority: high
issue_number: 0
---

# SPEC-CHAT-001 — 모임 채팅 코어

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md)

## HISTORY

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
