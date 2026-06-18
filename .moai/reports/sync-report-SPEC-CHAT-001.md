# Sync Report — SPEC-CHAT-001 (모임 채팅 코어)

**최초 생성**: 2026-06-14 (v0.2.0 — in-progress 전환)
**완료 검증 추가**: 2026-06-15 (v0.3.0 — completed 전환)
**사후 강화 + AC-5 수정 추가**: 2026-06-18 (v0.3.1 — completed 유지)
**Branch**: feature/SPEC-MOBILE-004
**Commits**: f3fe178 (run) / 0aba5f3 (UI redesign) / b86a80c (CSP fix) / 5e35248 (fetch fix)
**Synced by**: manager-docs

---

## 상태 전이 이력

| 날짜 | 버전 | 이전 status | 이후 status | 근거 |
|------|------|------------|------------|------|
| 2026-06-14 | v0.2.0 | `draft` | `in-progress` | run 완료, AC-1c/4/5 런타임 검증 대기 |
| 2026-06-15 | v0.3.0 | `in-progress` | `completed` | 라이브 E2E 검증 AC-1c/AC-4/AC-5 전부 PASS |
| 2026-06-18 | v0.3.1 | `completed` | `completed` (유지) | UI 리디자인 + 버그 2건 수정 + AC-5 추론→실증 PASS 정직한 수정 |

---

## [v0.3.1 추가] 라이브 브라우저 검증 + 사후 강화 — 2026-06-18

### 개요

v0.3.0에서 completed로 전환 후, 채팅 페이지 UI 리디자인 작업 중 라이브 브라우저(Chrome DevTools, 실제 moyura-verify 세션)에서 채팅 페이지가 동작하지 않는 두 가지 잠재 결함이 발견되어 수정됨. AC-5 판정 수정(추론 PASS → 실증 PASS). SPEC-CHAT-001은 completed 상태를 유지하며 이 수정들이 완성도를 강화함.

### 근본 원인 분석

#### 결함 1 — CSP connect-src `ws://` 누락 + 백엔드 API origin 누락 (b86a80c)

**파일**: `apps/web/proxy.ts`

**증상**: 브라우저 콘솔에서 CSP 위반 오류 발생
- `ws://127.0.0.1:54321` 연결 차단 (Supabase Realtime)
- `http://localhost:3001` fetch 차단 (백엔드 API)

**근본 원인**:
1. 로컬 Supabase Realtime은 `ws://127.0.0.1:54321`로 연결하지만 기존 connect-src에는 `wss://127.0.0.1:54321`만 있었음. Chrome에서 `http://host` origin 토큰은 `ws://`를 허용하지 않음(이전 v0.3.0 판단 "CSP3 scheme-matching에 의해 http origin이 ws:// 연결을 허용"은 오류).
2. 채팅 페이지가 클라이언트 측에서 백엔드 API를 직접 호출하는 첫 번째 페이지. 홈/상세(MOIM-003)는 서버 사이드 fetch(CSP 비대상)라 API origin 누락이 드러나지 않았음.

**수정**: `realtimeWssSource()` 함수가 `wss://${host} ws://${host}` 두 스킴을 모두 반환하도록 수정. `apiOriginSource()` 신규 함수 추가(`NEXT_PUBLIC_API_BASE_URL`의 origin 추출). connect-src에 두 값 모두 포함.

#### 결함 2 — api-client detached fetch (`Illegal invocation`) (5e35248)

**파일**: `packages/api-client/src/index.ts`

**증상**: 채팅 히스토리/멤버 로드 실패 — `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`

**근본 원인**: 기본 fetch가 `globalThis.fetch`(detached 참조)로 지정되어 있었음. 브라우저에서는 `fetch`가 `window`에 바인딩되어 있어야 하며, 분리된 참조로 호출하면 Illegal invocation 발생. Node.js는 이를 관대하게 처리하므로 jest/E2E에서 미검출.

**수정**: `globalThis.fetch.bind(globalThis)`로 변경.

**크로스 컷팅 영향**: 이 수정은 `api-client`를 브라우저에서 사용하는 모든 소비자에 영향. chat은 현재 유일한 클라이언트 측 api-client 소비자이지만, 향후 추가되는 모든 브라우저 측 api-client 호출이 이 수정 덕에 정상 동작함.

### AC-5 판정 정직한 수정

| 항목 | v0.3.0 판정 | v0.3.1 실제 상태 |
|------|------------|-----------------|
| 판정 방법 | Node E2E + CSP 정책 추론 | 라이브 브라우저(Chrome DevTools) |
| CSP ws:// | 허용된다고 추론(오류) | 차단됨 — b86a80c로 수정 |
| api-client fetch | 정상 동작한다고 가정 | Illegal invocation — 5e35248로 수정 |
| 최종 AC-5 판정 | PASS (추론, 잠재 결함 존재) | **PASS (실증 — 라이브 브라우저에서 realtime WS 연결, 히스토리/멤버 로드, 말풍선 렌더 모두 확인)** |

Node E2E는 CSP를 강제하지 않으므로, CSP 관련 AC를 브라우저 전용 검증 없이 PASS 판정한 것이 근본적 오류였음. 향후 CSP 관련 AC는 실제 브라우저 검증이 필요함을 기록.

### 채팅 UI 리디자인 (0aba5f3)

**파일**: `apps/web/app/moims/[id]/chat/page.tsx`

Meetup 디자인 시스템에 맞춰 채팅 UI를 재작성:
- **색상**: orange semantic 토큰 (`bg-primary #ff6b35`) — 모임 상세 `/home/[id]`와 동일 파레트
- **말풍선**: own(내 메시지) = 우측 정렬 + 오렌지 배경; other(상대 메시지) = 좌측 정렬 + muted 배경 + sender nickname 런(run)-기반 그룹핑
- **레이아웃**: sticky 헤더(뒤로가기 버튼 → `/home/{moimId}`) + sticky 입력 바
- **추가 UX**: 타임스탬프, 빈 상태 표시
- **데이터 레이어 무변경**: `useChatChannel`, `lib/chat/api.ts` 수정 없음

**테마 일관성 관찰**: 로그인/홈 페이지는 `bg-white` 하드코딩을 사용하나, 모임 상세/채팅은 theme-aware semantic 토큰을 사용. 다크 모드 전환 시 화면 간 색조 불일치 발생 가능. 선택적 후속 과제로 기록 — 이 sync에서 수정하지 않음.

### v0.3.1 동기화 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-CHAT-001/spec.md` | 수정 | version 0.3.0→0.3.1, updated 2026-06-15→2026-06-18, HISTORY v0.3.1 추가(UI 리디자인, CSP 수정, fetch 수정, AC-5 정직한 수정) |
| `CHANGELOG.md` | 수정 | CHAT-001 위에 "UI 리디자인 + CSP/fetch 버그 수정" 항목 추가(v0.3.1) |
| `.moai/project/tech.md` | 수정 | 상단 CHAT-001 선언 블록 + 구현됨 표 행: v0.3.1로 갱신, AC-5 실증 PASS 기록, fetch bind 수정, UI 리디자인 언급 |
| `.moai/project/structure.md` | 수정 | proxy.ts 설명에 connect-src 내용 추가; api-client 설명에 fetch bind 수정 언급; 채팅 페이지에 리디자인 언급 |
| `.moai/reports/sync-report-SPEC-CHAT-001.md` | 수정 | 본 섹션 추가 |

---

---

## [v0.3.0 추가] 라이브 E2E 검증 — 2026-06-15

### 검증 환경

- **스택**: 로컬 Supabase (API `127.0.0.1:54321` / DB `127.0.0.1:54322`)
- **검증 수단**: 인증 JWT(HS256, SUPABASE_JWT_SECRET)로 Supabase Realtime 구독 + direct Postgres INSERT로 트리거 발화
- **스크립트**: 임시 ad-hoc 스크립트(실행 후 삭제, 임시 위생). 정식 수동 검증 스크립트는 `apps/backend/test/chat.live.mts`.

### 데이터 시나리오

- 모임 seeding: 멤버 A(owner) + 멤버 B(member) / 유저 C는 비멤버
- 대상 채널: `moim:{id}` (Supabase Realtime private channel)

### AC-by-AC 검증 결과

#### AC-1c — realtime broadcast 종단 수신

**판정: PASS**

- 멤버 B가 인증 JWT(HS256, SUPABASE_JWT_SECRET 서명)로 private 채널 `moim:{id}`에 구독 → 상태 `SUBSCRIBED` 확인.
- sender A 명의로 `chat_message` row를 direct Postgres INSERT 실행.
- INSERT → `broadcast_chat_message()` AFTER INSERT 트리거 → `realtime.broadcast_changes` 호출.
- 멤버 B의 구독 클라이언트가 해당 메시지를 실시간 수신, content 일치 확인.
- **결론**: Postgres 트리거 → Realtime broadcast → 구독 클라이언트 수신 전체 경로 검증 완료.

#### AC-4 — 비멤버 구독 차단 (realtime.messages RLS)

**판정: PASS**

- 비멤버 유저 C가 동일 채널 `moim:{id}` 구독 시도.
- `CHANNEL_ERROR: "Unauthorized: You do not have permissions to read from this Channel topic"` 응답 수신.
- 비멤버 C는 아무 메시지도 수신하지 않음.
- **결론**: `realtime.messages` 멤버십 RLS 정책이 비멤버의 채널 구독을 정상 거부.

#### AC-5 — 브라우저 Realtime 구독 + CSP 위반 없는 연결

**판정: PASS (정책 + 프로토콜 증거 기반)**

- `apps/web/proxy.ts` CSP `connect-src` 값: `'self' wss://127.0.0.1:54321 http://127.0.0.1:54321` (호스트 고정).
- CSP3 scheme-matching 규칙: `http://host` 토큰은 동일 host의 `ws://` 연결을 허용.
- 라이브 E2E WebSocket 핸드셰이크 성공 (멤버 B SUBSCRIBED 상태 확인) — realtime 엔드포인트 연결 실증.
- 채팅 UI 빌드/린트: v0.2.0 게이트에서 이미 통과. send 동작: jest 검증 완료.
- **잔여 미실행 항목**: 인증 세션으로 브라우저에서 `/moims/[id]/chat` 풀 페이지를 로드하는 인-브라우저 CSP 런타임은 별도로 실행하지 않음.
- **판정 근거**: CSP 정책이 realtime origin을 명시적으로 허용(정책 증거)하고, 프로토콜 수준 WS 연결 및 broadcast 수신을 라이브 E2E로 실증(프로토콜 증거)하였으므로 AC-5 CSP 요건 충족으로 판정.

### v0.3.0 동기화 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-CHAT-001/spec.md` | 수정 | status: in-progress→completed, version: 0.2.0→0.3.0, updated: 2026-06-15, HISTORY v0.3.0 추가 |
| `.moai/specs/SPEC-CHAT-001/acceptance.md` | 수정 | DoD 체크박스 전부 체크 완료, 전파 종단 검증 항목에 라이브 E2E 주석 추가 |
| `CHANGELOG.md` | 수정 | CHAT-001 항목 in-progress → completed, 라이브 E2E 결과 명시 |
| `.moai/project/tech.md` | 수정 | 상단 기록 블록 + 구현됨 표 CHAT-001 행 completed로 갱신 |
| `.moai/project/structure.md` | 수정 | chat.live.mts 설명 갱신(라이브 E2E 완료) |
| `.moai/reports/sync-report-SPEC-CHAT-001.md` | 수정 | 본 섹션 추가 |

---

## [v0.2.0] 최초 sync (2026-06-14, in-progress)

### 상태 전이 (v0.2.0)

| 항목 | 이전 | 이후 |
|------|------|------|
| spec.md status | `draft` | `in-progress` |
| spec.md version | `0.1.1` | `0.2.0` |
| spec.md updated | `2026-06-11` | `2026-06-13` |

> `completed`가 아닌 `in-progress` 유지 근거: AC-1c(realtime broadcast 브라우저 종단 수신), AC-4(비멤버 RLS 구독 거부 런타임), AC-5(브라우저 구독/CSP 런타임)는 jest 자동화 불가 — psql 존재 단언으로 선행 조건만 검증됨. 디바이스 게이트 원칙(mobile SPEC과 동일)에 따라 런타임 검증 완료 전 completed로 전환하지 않는다.

---

## 동기화된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-CHAT-001/spec.md` | frontmatter status(`draft`→`in-progress`) / version(`0.1.1`→`0.2.0`) / updated(`2026-06-11`→`2026-06-13`) 갱신, HISTORY v0.2.0 항목 추가(run 완료 요약), "Implementation Notes (as-implemented)" 섹션 신규 추가(생성/수정 파일, 4개 수정 사항, 사후 강화, 검증 3계층, 미검증 항목, 크로스 SPEC 참고) |
| `.moai/specs/SPEC-CHAT-001/acceptance.md` | 변경 없음 — `api-client:build` 오류 참조 없음(line 48: `typecheck 통과`로 이미 올바름) |
| `CHANGELOG.md` | [Unreleased] > Added 최상단에 CHAT-001 항목 추가(MOIM-002 위) — jest/psql/evaluator 게이트, ChatMessage 모델+트리거+RLS, sendMessage/getHistory, 이벤트 계약, 웹 UI, CSP 호스트 고정 커버 |
| `.moai/project/structure.md` | `apps/backend/src/chat/` 모듈 항목 추가(ChatModule/chat-events.ts/@MX:ANCHOR/dto), `apps/backend/test/` 추가(chat.live.mts), prisma/ migrations에 `20260613175232_add_chat` 추가, `apps/web/lib/` chat/useChatChannel.ts 추가, `apps/web/app/moims/[id]/chat/` 페이지 추가, schema.prisma 모델 목록에 ChatMessage 추가 |
| `.moai/project/tech.md` | 도입부 CHAT-001 완료 선언 추가, 구현됨/계획됨 표 상단에 CHAT-001 행 추가(in-progress), 주요 설정 파일 표에 chat/ + test/chat.live.mts + web chat 파일 + migrations 항목 추가, `@nestjs/event-emitter` 신규 의존성 언급 |
| `.moai/project/db/schema.md` | `last_synced_at` 2026-06-14 갱신, Tables 표에 `chat_message` 추가, chat_message 컬럼 상세 문서화(BigInt PK / FK Cascade / content CHECK / 트리거 / realtime 정책 설명), Relationships에 moim→chat_message Cascade 추가, Indexes에 chat_message PK + (moimId,id) 복합 인덱스 추가, Constraints에 chat_message PK + FK + CHECK 추가 |
| `.moai/project/db/erd.mmd` | `CHAT_MESSAGE` 엔티티 추가(id/moim_id/sender_id/content/created_at), `MOIM ||--o{ CHAT_MESSAGE` Cascade 관계 추가, 최종 갱신 날짜 주석 2026-06-14 갱신 |
| `.moai/project/db/migrations.md` | 변경 없음 — run 중 T-010에서 `20260613175232_add_chat` + 수동 SQL 상세 + psql 존재 단언 + Pending/Rollback 항목이 이미 추가 완료됨 |
| `.moai/project/db/rls-policies.md` | 변경 없음 — run 중 T-010에서 `realtime.messages` SELECT 정책 + `chat_message` default-deny 항목이 이미 추가 완료됨 |

---

## 검증 결과 (run 단계에서 확인됨)

| 항목 | 결과 |
|------|------|
| jest (전체) | 170/170 PASS |
| jest (chat 모듈) | 22/22 PASS |
| chat 모듈 stmt 커버리지 | 100% |
| chat 모듈 branch 커버리지 | 85.71% (임계값 85% 충족) |
| backend:typecheck | 0 에러 |
| api-client:typecheck | 0 에러 |
| nx build web | PASS (`/moims/[id]/chat` 라우트 생성 확인) |
| prisma migrate status | 드리프트 없음 (4 migrations, up to date) |
| psql 존재 단언 | broadcast_chat_message 함수 / chat_message_broadcast 트리거 / realtime.messages SELECT 정책 / chat_message RLS enabled / content CHECK — 전부 EXISTS 확인 (2026-06-14) |

---

## DB 수동 갱신 (manual refresh)

- `chat_message` 테이블: schema.md / erd.mmd 수동 갱신 완료.
- migrations.md / rls-policies.md: run 중 T-010에서 이미 갱신 완료. sync 추가 변경 없음.
- db.yaml auto-sync는 `enabled: false` 유지.
- 다음 SPEC sync 시도 시 동일 방식으로 수동 갱신 필요.

---

## TRUST 5

| 차원 | 결과 |
|------|------|
| Tested | PASS — jest 170/170, chat branch 85.71%, psql 존재 단언 전부 통과 |
| Readable | PASS — NestJS 관용 패턴 준수, chat-events.ts 계약 분리, BigInt→string DTO 명시 |
| Unified | PASS — moim/auth/profile 패턴 일관성 유지, EventEmitter2 관용 사용 |
| Secured | PASS — SECURITY DEFINER search_path 고정, RLS default-deny, 비멤버 emit 누수 없음, CSP wss 호스트 고정, 비멤버 404→403 변환 |
| Trackable | PASS — Conventional Commits, f3fe178 |

---

## Evaluator 결과 (SPEC-CHAT-001-final-pass.md)

| 차원 | 점수 | 판정 |
|------|------|------|
| Functionality (40%) | 90/100 | PASS |
| Security (25%) | 82/100 | PASS |
| Craft (20%) | 85/100 | PASS |
| Consistency (15%) | 90/100 | PASS |
| **Overall** | | **PASS** |

MEDIUM 2건 모두 사후 강화 적용 완료 (emit 격리 try-catch, CSP wss 호스트 고정).

---

## 미검증 항목 (in-progress 유지)

| AC | 내용 | 검증 수단 |
|----|------|-----------|
| AC-1c | 브라우저 실시간 broadcast 수신 | `apps/backend/test/chat.live.mts` 수동 실행 |
| AC-4 | 비멤버 RLS 구독 거부 런타임 | 브라우저 DevTools 또는 live 스크립트 |
| AC-5 | 채팅 UI 구독/수신/전송 + CSP 런타임 | 브라우저 직접 검증 |
