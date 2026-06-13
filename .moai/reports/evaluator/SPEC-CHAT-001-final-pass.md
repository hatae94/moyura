# Evaluation Report

SPEC: SPEC-CHAT-001 (모임 채팅 코어)
Harness: standard (final-pass)
Branch: feature/SPEC-MOBILE-004
Evaluator: evaluator-active
Date: 2026-06-14
Overall Verdict: **PASS**

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 90/100 | PASS | 21 chat tests pass (169 total); all automatable ACs verified; psql assertions confirmed; builds pass |
| Security (25%) | 82/100 | PASS | No Critical/High findings; SECURITY DEFINER hardened; RLS confirmed; one MEDIUM finding (wss: host-unscoped) |
| Craft (20%) | 85/100 | PASS | src/chat: 100% Stmt/Func/Lines, 85.71% Branch (≥85% threshold met); one MEDIUM reliability finding |
| Consistency (15%) | 90/100 | PASS | moim/auth/profile 패턴 일관성 유지; EventEmitter2 NestJS 관용 사용 |

---

## Gate Execution Results

### `pnpm exec jest --testPathPattern="chat"` (apps/backend)
```
Test Suites: 2 passed (chat.service.spec.ts, chat.integration.spec.ts)
Tests:       21 passed
```

### Full suite
```
Test Suites: 16 passed, 16 total
Tests:       169 passed, 169 total
```

### `nx run backend:typecheck` — 0 errors (PASS)
### `nx run api-client:typecheck` — 0 errors (PASS)
### `nx build web` — Compiled successfully, /moims/[id]/chat route generated (PASS)
### `prisma migrate status` — "Database schema is up to date!" (no drift)

---

## Acceptance Criteria Verification

### AC-1a (REQ-CHAT-001) — sendMessage assertMember → insert → row 반환
- **PASS**: `chat.service.spec.ts:150-161` — `store.length === 1`, `msg.moimId/senderId/content` 단언
- **PASS**: `chat.integration.spec.ts:209-233` — POST 201 + `tables.message.length === 1` + BigInt→string 직렬화 단언

### AC-1b (REQ-CHAT-001) — CHAT_MESSAGE_CREATED 발행, payload messageId=STRING, nickname 미포함
- **PASS**: `chat.service.spec.ts:163-180`
  - `emit.mock.calls[0][0] === CHAT_MESSAGE_CREATED` ✓
  - `typeof payload.messageId === 'string'` ✓
  - `payload.messageId === msg.id.toString()` ✓
  - `expect(payload).not.toHaveProperty('nickname')` ✓

### AC-1c (REQ-CHAT-002) — 실시간 전파 수신 (브라우저 런타임)
- **UNVERIFIED** (runtime/live-pending, EXPECTED): 트리거/RLS는 psql로 확인됨(하단), 브라우저 수신은 자동화 불가

### AC-2 (REQ-CHAT-003) — keyset desc + cursor + nextCursor
- **PASS**: `chat.service.spec.ts:225-242` — 5개 메시지 중 limit=3 → [5n,4n,3n] 내림차순, nextCursor='3'
- **PASS**: `chat.service.spec.ts:245-265` — cursor=3 → [2n,1n], nextCursor=null
- **PASS**: `chat.integration.spec.ts:326-373` — HTTP 계층 검증, id 문자열 타입 확인

### AC-3 (REQ-CHAT-005) — 비멤버 403 + 미저장 + 미발행
- **PASS**: `chat.service.spec.ts:185-208`
  - 비멤버: `ForbiddenException` + `store.length === 0` + `emit not called` ✓
  - 없는 모임(404→403): `ForbiddenException` + `store.length === 0` + `emit not called` ✓
- **PASS**: `chat.integration.spec.ts:235-261` — HTTP 403 + `tables.message.length === 0`
- 미발행 통합 검증: insert 미발생이 emit 미발생을 보장함(emit은 insert 이후 코드 경로에만 위치)

### AC-3 엣지 — content 400 (빈/초과)
- **PASS**: `chat.integration.spec.ts:264-306` — 빈 content, 2001자, 비문자열 전부 400 + 미저장

### AC-3 엣지 — bad cursor 400
- **PASS**: `chat.service.spec.ts:268-277` + `chat.integration.spec.ts:376-385` — 400 반환

### AC-4 (REQ-CHAT-004) — 비멤버 구독 차단 (RLS)
- **UNVERIFIED** (runtime/live-pending, EXPECTED): RLS 정책 존재는 psql로 확인됨(하단), 실제 클라이언트 거부는 자동화 불가

### AC-5 (REQ-CHAT-006) — 채팅 UI 구독/표시/전송 + 빌드
- **BUILD PASS**: `nx build web` — `/moims/[id]/chat` 라우트 생성, TypeScript 무오류
- **RUNTIME UNVERIFIED**: 브라우저 구독/수신 동작은 자동화 불가 (EXPECTED)
- **CSP PASS**: `proxy.ts:53` — `connect-src 'self' wss: SUPABASE_URL` 추가됨(AC-5 R-2 요구사항 충족)

---

## psql 존재 단언 (실 DB 확인)

| 항목 | 쿼리 결과 | 상태 |
|------|----------|------|
| `broadcast_chat_message` 함수 | `Schema: public, Name: broadcast_chat_message, Type: func` | ✓ EXISTS |
| `chat_message_broadcast` 트리거 | `tgname=chat_message_broadcast, tgenabled=O` | ✓ EXISTS (enabled) |
| `realtime.messages` SELECT 정책 | `polname=members can receive moim broadcasts, polcmd=r, polroles={16444}` | ✓ EXISTS |
| `chat_message` RLS enabled | `relrowsecurity=t` | ✓ ENABLED |
| `chat_message_content_length` CHECK | `CHECK ((char_length(content) >= 1) AND (char_length(content) <= 2000))` | ✓ EXISTS |

---

## Findings

### [MEDIUM-SEC] `apps/web/proxy.ts:53` — CSP `wss:` 호스트 미고정 (OWASP A05:2021)

```typescript
`connect-src 'self' wss: ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}`.trim(),
```

`wss:` 디렉티브는 임의의 WebSocket 호스트를 허용한다. XSS가 선행될 경우 공격자가 임의의 `wss://attacker.example` 로 데이터를 유출할 수 있다. 다만 `script-src 'nonce-...' 'strict-dynamic'` (prod)에 의해 XSS 표면 자체가 강하게 통제되어 실질 위험은 낮다. 또한 스펙(R-2 delta marker)이 `wss:` 명시를 직접 요구하였으므로 구현은 스펙 준수 상태이다.

**완화 제안**: `wss:` → `wss://${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host}` 로 호스트 고정. Supabase Realtime은 HTTP URL과 동일한 호스트의 `/realtime/v1/websocket`을 사용하므로 안전하게 대체 가능하다.

분류: Security Misconfiguration (OWASP A05), Severity MEDIUM (XSS 선행 필요), **전체 FAIL 미발동** (Critical/High 아님)

---

### [MEDIUM-CRAFT] `apps/backend/src/chat/chat.service.ts:64` — emit 오류 비격리

```typescript
this.events.emit(CHAT_MESSAGE_CREATED, payload);
return message;
```

`EventEmitter2.emit()`은 동기 호출이다. 미래 CHAT-002 리스너(`@OnEvent('chat.message.created')`)가 동기적으로 예외를 던지면 그 예외가 `sendMessage()`로 전파되어 DB insert 성공 후 HTTP 500이 발생한다. 메시지는 저장되었으나 201을 반환하지 못하는 불일치 상태가 된다.

현재는 `@OnEvent` 리스너가 없으므로 재현 불가능하나, CHAT-002 구현 시 위험이 활성화된다.

**완화 제안**: `try { this.events.emit(...); } catch (e) { this.logger.error('이벤트 발행 실패', e); }` 또는 `EventEmitterModule.forRoot({ asyncHandlers: true })` 설정으로 비동기 격리.

---

### [INFO] AC-1c / AC-4 / AC-5 런타임 항목 UNVERIFIED

브라우저 실시간 broadcast 수신(AC-1c), RLS 기반 비멤버 구독 거부(AC-4), 채팅 UI 런타임 동작(AC-5)은 자동화 불가. 단 이들의 **자동화 가능한 선행 조건**(트리거/RLS 존재, 웹 빌드)은 모두 PASS 확인됨. UNVERIFIED는 **전체 FAIL 사유 아님** (수락 기준 품질 게이트 합의 사항).

---

## 보안 심층 분석

### SECURITY DEFINER 트리거 (`broadcast_chat_message`)
- `prosecdef = true` (SECURITY DEFINER 확인)
- `proconfig = {"search_path=\"\""}` — search_path가 빈 문자열로 고정 (**search_path 하이재킹 차단됨**)
- 동적 SQL 없음: `PERFORM realtime.broadcast_changes(...)` 는 인자를 문자열 인수로 전달 (SQL injection 벡터 없음)
- `moim_id::text` 캐스팅은 단순 타입 변환 (FK 제약으로 유효한 moim.id만 가능)
- **SECURE**

### RLS 토픽 스푸핑 gap
- 정책: `EXISTS (SELECT 1 FROM moim_member m WHERE 'moim:' || m.moim_id = realtime.topic() AND m.user_id = auth.uid())`
- 비멤버가 `moim:X` 채널 구독 시도 → `moim_member`에서 (moim_id=X, user_id=본인) 조회 → 없으면 EXISTS=false → 거부
- 클라이언트가 토픽 문자열을 임의로 조작해도 실제 멤버십 레코드 없이 우회 불가
- **SECURE**

### 비멤버 emit 누수 여부
- 코드 순서: `assertChatAccess` throw → (insert 미도달) → (emit 미도달)
- 단위 테스트: `chat.service.spec.ts:185-209` — `expect(emit).not.toHaveBeenCalled()` 명시 단언
- **SECURE**

### chat_message RLS default-deny 검증
- 정책 없음 → 실제 `authenticated` 역할로 INSERT 시도: `ERROR: new row violates row-level security policy`
- anon/authenticated 역할에 DML GRANT도 없음(`information_schema.role_table_grants` 확인)
- **SECURE**

---

## Recommendations

1. **[우선 HIGH]** `proxy.ts:53` — `wss:` 를 Supabase 호스트에 고정 (`wss://${supabaseHost}`)하여 불필요한 WebSocket 허용 범위를 축소한다.

2. **[CHAT-002 구현 전]** `chat.service.ts:64` — emit 오류를 try-catch로 격리하거나 `EventEmitterModule.forRoot({ asyncHandlers: true })` 로 전환하여 리스너 실패가 sendMessage 201 응답을 막지 못하도록 한다.

3. **[정보]** AC-1c/AC-4/AC-5 런타임 검증은 로컬 Supabase 환경에서 수동 통합 검증으로 완결하는 것을 권장한다.
