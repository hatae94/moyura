# Evaluation Report
SPEC: SPEC-MOIM-002 (초대 링크 + 게스트 참여)
Date: 2026-06-14
Harness: standard (final-pass)
Branch: feature/SPEC-MOBILE-004
Overall Verdict: **FAIL**

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 92/100 | PASS | 41 tests pass; AC-1~8 모두 검증; build/typecheck/migration green |
| Security (25%) | 90/100 | PASS | CSPRNG 확인; assertOwner 전 라우트 커버; conditional updateMany 원자성 확인 |
| Craft (20%) | 72/100 | FAIL | 브랜치 커버리지 84.61% < 85% 임계값; 경쟁 테스트 롤백 시뮬레이션 미검증 |
| Consistency (15%) | 93/100 | PASS | MOIM-001 패턴 준수; GoneException/ConflictException 정규 사용 |

**Hard Threshold 적용:** Security PASS → overall 집계는 FAIL (Craft 임계값 미달).

---

## Gate 실행 결과

### 백엔드 테스트
```
Tests: 41 passed, 41 total
src/invite - % Stmts: 100 | % Branch: 84.61 | % Funcs: 100 | % Lines: 100
```
- invite 모듈 브랜치 커버리지: **84.61% (임계값 85% 미달, 차이 0.39%)**

### Typecheck / Build
```
nx run backend:typecheck  → SUCCESS (캐시)
nx run api-client:typecheck → SUCCESS (캐시)
nx build web             → SUCCESS; /invite/[token] 경로 등록 확인
```

### Prisma Migration Status
```
3 migrations found; Database schema is up to date!
```
- `moim_invite` 테이블, token UNIQUE INDEX, Cascade FK 모두 적용됨.

### Supabase 익명 로그인
```toml
enable_anonymous_sign_ins = true   # SPEC-MOIM-002 REQ-INV-007
anonymous_users = 30               # 시간당 IP별 익명 가입 rate limit
```

---

## Findings

### [HIGH] Craft — 브랜치 커버리지 85% 임계값 미달
- **Location:** `src/invite/invite.controller.ts` 브랜치 76.47%; 모듈 전체 84.61%
- **Root Cause (실증):** Istanbul이 NestJS `@Body()` 데코레이터 파라미터의 optional chaining(`body?.expiresAt`, `body?.maxUses`, `body?.nickname`) 에서 발생하는 null 브랜치를 추적함. NestJS는 요청 바디를 항상 객체로 제공하므로 해당 null 브랜치는 런타임에 도달 불가능(unreachable). 미커버 브랜치 목록:
  - controller.ts line 54: `body?.expiresAt` null arm
  - controller.ts line 55: `body?.maxUses` null arm
  - controller.ts line 93: `body?.nickname` (list) null arm
  - controller.ts line 123: `body?.nickname` (accept) null arm
  - service.ts line 31 (×2): constructor 파라미터 conditional
- **판정:** AC "커버리지 85%+" 미달. "It's probably fine" 수용 금지 — 보고한다.
- **Fix:** 컨트롤러에서 `body?.field` 를 `body.field` 로 교체(ValidationPipe 또는 `@Body()` 가 항상 객체를 보장하므로 안전). 또는 jest 커버리지 설정에 Istanbul `/* c8 ignore */` 처리 후 재계산.

### [MEDIUM] Craft — 동시 경쟁 테스트의 rollback 시뮬레이션 미검증
- **Location:** `src/invite/invite.service.spec.ts:515-529` — `accept() 동시성 경계` describe
- **Issue:** 가짜 `$transaction` 구현이 콜백 예외 시 `moimMember.create`를 롤백하지 않음. 테스트는 `updateMany.mockResolvedValueOnce({ count: 0 })` 로 409 예외와 usedCount=0 을 검증하지만, 멤버십이 실제로 미생성(롤백)됐는지 `tables.member.size` 단언이 없음.
- **Risk:** 실제 PostgreSQL `$transaction`은 rollback 보장이 있으나, 단위 테스트가 이 불변식을 검증하지 않아 가짜와 실제 동작 간 괴리(drift) 감지 불가.
- **Fix:** 동시성 테스트에 `expect(tables.member.has(memberKey(...))).toBe(false)` 추가.

### [LOW] Security — 동일 sub 동시 accept 시 P2002 → 500
- **Location:** `apps/backend/src/invite/invite.service.ts:137-144` (moimMember.create in $transaction)
- **Scenario:** 동일 사용자가 동시에 동일 초대 토큰으로 두 요청을 제출할 때:
  1. 두 요청 모두 멱등 선검사 통과(아직 멤버십 없음)
  2. 두 요청 모두 `$transaction` 진입
  3. 첫 번째 트랜잭션: `moimMember.create` 성공 → commit
  4. 두 번째 트랜잭션: `moimMember.create` → P2002 (복합 PK `(moimId, userId)` 중복) → 미처리 Prisma 에러 → **500** 반환
- **Expected:** 멱등 경로로 200 반환(또는 의도적 409)이어야 함.
- **Severity:** LOW (보안 취약점 아님, 신뢰성 결함. 같은 sub가 sub-millisecond 동시 중복 요청을 보내는 시나리오는 매우 드묾).
- **Fix:** `$transaction` 내부에서 P2002를 catch해 기존 멤버십 반환 또는 Conflict 처리 추가.

### [INFO] Security — updateMany OR 조건의 redundant arm
- **Location:** `src/invite/invite.service.ts:152-155`
- **Detail:** `limit !== null` 분기에서도 `OR: [{ maxUses: null }, { usedCount: { lt: limit } }]` 로 `maxUses: null` arm을 포함시킴. API 상 maxUses를 변경하는 엔드포인트가 없으므로 이 arm은 실제로 절대 매치되지 않아 dead code. 기능 영향 없음.
- **Fix:** `limit !== null` 분기에서는 `OR: [{ usedCount: { lt: limit } }]` 만 사용하도록 정리.

---

## AC별 검증 결과

| AC | 요구사항 | 검증 방법 | 결과 |
|----|---------|----------|------|
| AC-1 | token ≥128-bit, expiresAt=now+7d, usedCount=0 | service.spec: "토큰 ≥128-bit 엔트로피(base64url 32바이트=256-bit)" + integration: AC-1 | PASS |
| AC-2 | guest accept → member role + nickname + usedCount++ | integration.spec:396-413 | PASS |
| AC-3a | unknown → 404 | integration.spec:417-424 | PASS |
| AC-3b | expired → 410, usedCount 불변 | integration.spec:426-439 | PASS |
| AC-3c | revoked → 410 | integration.spec:441-449 | PASS |
| AC-3d | maxUses exceeded → 409, usedCount 불변 | integration.spec:451-464 | PASS |
| AC-4 | revoke → revokedAt 설정 | integration.spec:382-393 | PASS |
| AC-5a | non-owner POST → 403 | integration.spec:319-332 | PASS |
| AC-5b | non-owner GET → 403 (live 토큰 미노출) | integration.spec:334-345 | PASS |
| AC-5c | non-owner DELETE → 403 | integration.spec:347-361 | PASS |
| AC-6 | owner list → 200 + 목록(상태 포함) | integration.spec:364-379 | PASS |
| AC-7 | already-member re-accept → 200, usedCount 불변 | integration.spec:481-501 | PASS |
| AC-8 | /invite/[token] 빌드 + 익명로그인→accept→리다이렉트 | nx build web: /invite/[token] ƒ Dynamic 확인 | PASS |
| Edge: nickname 빈 400 | | integration.spec:467-478 | PASS |
| Edge: expiresAt>30d 400 | | service.spec:269-278 | PASS |

---

## Security 심층 탐침 결과

### (a) 토큰 추측 가능성
`apps/backend/src/invite/invite.service.ts:200-202`:
```typescript
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');  // TOKEN_BYTES=32, 256-bit
}
```
- `import { randomBytes } from 'node:crypto'` (CSPRNG) 확인. `Math.random` 미사용.
- 결론: **PASS**

### (b) owner-only 우회 가능성
3개 관리 라우트 전체에서 `assertOwner` 호출 확인:
- `create()`: `await this.moim.assertOwner(sub, moimId)` (service.ts:45)
- `list()`: `await this.moim.assertOwner(sub, moimId)` (service.ts:66)
- `revoke()`: `await this.moim.assertOwner(sub, moimId)` (service.ts:77)
- `MoimService.assertOwner`: 모임 없음 404 / 비-owner·비멤버 403 (moim.service.ts:57-64)
- 결론: **PASS**

### (c) usedCount TOCTOU race / maxUses 초과 가능성
핵심 분석 (`accept()` service.ts:131-163):

**경쟁 윈도우:** `invite.usedCount >= invite.maxUses` 선검사(131줄)와 `$transaction` 내 `updateMany` 사이.

**방어 메커니즘:** Prisma `$transaction` 내 조건부 `updateMany`:
```sql
UPDATE moim_invite SET used_count = used_count + 1
WHERE id = :id
  AND revoked_at IS NULL
  AND (max_uses IS NULL OR used_count < :limit)
```
PostgreSQL READ COMMITTED에서 `UPDATE` 구문은 행 수준 잠금을 획득하고, 커밋된 최신 `used_count`를 조건에서 재평가한다. 따라서:
- 요청 A, B가 동시에 선검사 통과(used_count=0, maxUses=1)
- A 먼저 `updateMany` → 행 잠금 획득, used_count=0 < 1 ✓ → 1로 증가, count=1 → commit
- B가 행 잠금 획득 시도 → 커밋된 used_count=1 을 평가 → 1 < 1 false → count=0 → throw ConflictException → rollback
- **maxUses 초과 불가.** 결론: **PASS**

### (d) 멱등 홀: 이미 멤버의 재수락이 usedCount를 증가시키는가
- 멱등 선검사(service.ts:122-128)가 `$transaction` 진입 전에 기존 멤버십을 검사함.
- 이미 멤버 → `return invite` (usedCount 증가 없음, 트랜잭션 미진입)
- 결론: **PASS**

### (e) 익명 남용 / 무제한 리소스 생성
- config.toml: `anonymous_users = 30` (시간당 IP별 제한)
- `enable_anonymous_sign_ins = true` 설정됨
- 결론: **PASS** (rate limit 설정 확인됨)

### (f) mass-assignment: 클라이언트 공급 userId 신뢰 여부
- `AcceptInviteDto`에 `userId` 필드 없음. accept 컨트롤러는 `user.sub`(`@CurrentUser()` — JWT에서 검증된 sub)만 사용.
- 결론: **PASS**

### (g) invite-list 엔드포인트의 live 토큰 유출
- `GET /moims/:moimId/invites`는 `assertOwner`로 403 보호. 비-owner는 토큰에 접근 불가.
- 결론: **PASS**

---

## Recommendations

1. **[즉시] 브랜치 커버리지 수정:** 컨트롤러의 `body?.field` → `body.field` 교체(NestJS `@Body()`는 항상 객체 보장). 또는 istanbul `/* c8 ignore next */` 주석으로 unreachable arm 제외. 재실행 시 100% 브랜치 예상.

2. **[권장] 경쟁 테스트 롤백 단언 추가:** `invite.service.spec.ts` 의 동시성 경계 테스트에 `expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false)` 추가.

3. **[낮음] 동일 sub 동시 accept P2002 처리:** `$transaction` 내 `moimMember.create` 를 try-catch로 감싸고 P2002(Prisma error code) 시 기존 멤버십을 조회·반환해 200 멱등 처리.

4. **[낮음] redundant OR arm 제거:** `invite.service.ts:152-155` 에서 `limit !== null` 시 `{ maxUses: null }` arm 제거.
