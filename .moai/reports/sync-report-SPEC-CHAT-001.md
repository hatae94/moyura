# Sync Report — SPEC-CHAT-001 (모임 채팅 코어)

**Date**: 2026-06-14
**Branch**: feature/SPEC-MOBILE-004
**Commit (run)**: f3fe178
**Synced by**: manager-docs

---

## 상태 전이

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
