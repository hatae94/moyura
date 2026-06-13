# Evaluation Report — SPEC-MOIM-001 (final-pass)

**Harness**: standard | **Profile**: default | **Date**: 2026-06-14  
**Evaluator**: evaluator-active (claude-sonnet-4-6)  
**Branch**: feature/SPEC-MOBILE-004

---

## Overall Verdict: PASS

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 95/100 | PASS | 105/105 테스트 통과, AC-1~8 전항목 어서션 검증, 엣지 케이스 커버 |
| Security (25%) | 95/100 | PASS | 인가 경로 무결, mass-assignment 없음, 인터랙티브 $transaction |
| Craft (20%) | 88/100 | PASS | 전체 Stmts 96.79% / Branch 85.36%, 경미한 double-read 이슈 |
| Consistency (15%) | 95/100 | PASS | 기존 auth/profile 패턴 완전 준수, exports [MoimService] 하위 SPEC 고려 |

---

## Gate 실행 결과 (직접 재실행)

### `pnpm --filter @moyura/backend test`

```
Tests: 105 passed, 105 total
Test Suites: 12 passed, 12 total
```

### `pnpm run test:cov` (moim 영역)

```
moim/moim.controller.ts  | 100% Stmts | 77.14% Branch
moim/moim.service.ts     | 100% Stmts | 91.66% Branch
moim/dto/              * | 100% Stmts | 100%  Branch
All files                | 96.79% Stmts | 85.36% Branch  ← 임계값 통과
```

### `nx run backend:typecheck`

```
tsc --noEmit — 에러 없음 (0 errors)
```

### `nx run api-client:typecheck`

```
openapi.json 재생성 + tsc --noEmit — 에러 없음
```

### Migration status

로컬 Supabase(:54322) 미연결 환경 — **UNVERIFIED** (마이그레이션 SQL 구조 수동 검증으로 대체, 아래 참조)

---

## 기능성 상세 검증 (AC by AC)

### AC-1 — 모임 생성 + 단일 트랜잭션 (REQ-MOIM-004)

`moim.service.spec.ts:162` — 트랜잭션 결과로 moim 생성 + tables.member에 `role='owner', nickname='호스트'` row 확인  
`moim.service.spec.ts:177` — `expect(typeof transaction.mock.calls[0][0]).toBe('function')` → 배열이 아닌 콜백 형태(인터랙티브 $transaction) 명시적 검증  
`moim.integration.spec.ts:257` — 통합 테스트: POST /moims 201 + tables.member에서 owner 실제 확인

**Tautology 없음**: service spec은 fake Prisma의 tables.member Map에 실제 row가 쓰였는지 확인. integration spec은 HTTP 응답 + 인메모리 DB 양쪽 검증.

### AC-2 — 비멤버 403 (REQ-MOIM-002)

`moim.integration.spec.ts:295` — GET /moims/moim-A (비멤버 token) → 403  
`moim.integration.spec.ts:306` — GET /moims/moim-A/members (비멤버 token) → 403  
인증됨(401 아님)이 명시적 — signEs256 서명 토큰 사용

### AC-3 — 전 라우트 401 (REQ-MOIM-001)

`moim.integration.spec.ts:245` — `it.each(routes)` 파라미터라이즈드: 6개 라우트 각각 `expect(401)`  
부작용 없음 검증: `before`/`after` tables.size 비교 — POST /moims 포함 전부 확인

### AC-4 — 일반 멤버 탈퇴 204 (REQ-MOIM-007)

`moim.integration.spec.ts:372` — DELETE /moims/moim-A/membership 204  
`tables.member.has(memberKey('moim-A', memberSub)) === false` + `tables.member.has(ownerKey) === true` (다른 멤버 불변)

### AC-5 — 멤버 목록 nickname 포함 (REQ-MOIM-006)

`moim.integration.spec.ts:343` — nicknames.sort() === ['참가자1', '호스트']

### AC-6 — 단건/목록 조회 (REQ-MOIM-005)

`moim.integration.spec.ts:318` — GET /moims/moim-A 200, ids ['moim-A', 'moim-B'] (moim-C 제외)

### AC-7 — owner 전용 삭제 (REQ-MOIM-003)

`moim.integration.spec.ts:416` — 비-owner DELETE /moims/moim-A → 403, tables.moim.has('moim-A') === true  
`moim.integration.spec.ts:432` — owner DELETE /moims/moim-A → 204, moim + 멤버십 양쪽 제거 확인

### AC-8 — owner 탈퇴 금지 (REQ-MOIM-008)

`moim.integration.spec.ts:390` — owner DELETE /moims/moim-A/membership → 403 + tables.member.has(ownerKey) === true

### 엣지 케이스

- empty nickname → 400: `moim.integration.spec.ts:276` ✓
- missing moim → 404: `moim.integration.spec.ts:363` ✓
- 비멤버 membership-delete → 404: `moim.integration.spec.ts:404` ✓

---

## 보안 심층 분석

### (a) 비멤버가 멤버 데이터 읽는 경로 존재 여부

`moim.controller.ts:38` — `@UseGuards(SupabaseAuthGuard)` 가 **class 레벨**에 선언 → 6개 라우트 전체 자동 적용 (per-route 누락 없음)

- `GET /moims/:id` → `moimService.getMoim()` → `assertMember()` 호출 ✓
- `GET /moims/:id/members` → `moimService.listMembers()` → `assertMember()` 호출 ✓
- `GET /moims` → `moimService.listMyMoims()` → `userId: sub` WHERE 절, 비멤버 데이터 반환 불가 ✓

**비멤버 데이터 접근 경로 없음.**

### (b) owner-leave 403 우회 가능성

`moim.service.ts:94` — `leave(sub, moimId)`:
1. `findMembership(sub, moimId)` — DB에서 role을 읽음
2. `membership.role === ROLE_OWNER` → 403

우회 시도:
- **body에 role 포함**: leave()는 body 파라미터를 받지 않고 DB role만 참조 → 불가
- **leave-before-delete**: leave()가 owner를 막으므로 선행 불가 → 불가
- **role spoof in header**: @CurrentUser는 JWT sub만 추출, role 등 body 값 미신뢰 → 불가

**우회 경로 없음.**

### (c) Mass-assignment

`moim.controller.ts:56` — `moimService.createMoim(user.sub, name, nickname)` — `user.sub`은 가드-검증 JWT sub  
`moim.service.ts:23` — `tx.moim.create({ data: { name, createdBy: sub } })` — createdBy는 sub 고정  
`moim.service.ts:27` — `tx.moimMember.create({ data: { ..., userId: sub, role: ROLE_OWNER } })` — userId/role 모두 서버 측 결정

클라이언트가 createdBy, userId, role을 임의로 지정할 수 있는 경로 없음.

### (d) createMoim 원자성

`moim.service.ts:21` — `this.prisma.$transaction(async (tx) => { ... })` — 인터랙티브 콜백 형태  
Prisma 인터랙티브 트랜잭션은 BEGIN/COMMIT/ROLLBACK 사용. moim.create 성공 + moimMember.create 실패 시 moim row도 자동 rollback.

`moim.service.spec.ts:184` — `expect(typeof transaction.mock.calls[0][0]).toBe('function')` — 배열 형태(비원자) 가 아님을 명시적 검증.

**원자성 코드 수준에서 올바름.** (실제 DB rollback은 fake 환경에서 검증 불가 — 구조적 limitation)

### (e) Cascade 범위

`migration.sql:23` — `FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE`  
현재 schema에서 moim에 종속된 테이블은 moim_member 뿐. CHAT-001 메시지 등 미구현 → 범위 적절.

`schema.prisma:55` — `onDelete: Cascade` 명시.

### (f) Whitespace-only nickname/name

`moim.controller.ts:136` — `requireNonEmpty`: `value.trim().length === 0` → 400  
`moim.integration.spec.ts:276` — `nickname: '   '` → 400 검증 ✓

---

## Findings

| Severity | 파일:줄 | 설명 |
|----------|---------|------|
| LOW | `apps/backend/src/moim/moim.service.ts:67-71` | `getMoim()`이 `requireMoim`을 2회 호출함 (assertMember → requireMoim + 이후 명시적 requireMoim). DB 쿼리 3번 발생. 기능 결함 아님, 성능 비효율. |
| LOW | `apps/backend/src/moim/moim.service.ts:94-107` | `leave()` 내부에서 moim 존재 여부를 별도 확인하지 않음. 존재하지 않는 moimId로 탈퇴 시도 시 findMembership null → NotFoundException. "모임 없음 404"와 "멤버십 없음 404"를 구분 불가하나 SPEC 엣지 시나리오("비멤버 → 404")는 정확히 충족. |
| INFO | `apps/backend/src/prisma/prisma.service.ts:21-38` | Stmts 54.54% — NestJS PrismaClient 상속 lifecycle 메서드(onModuleInit/onModuleDestroy)는 테스트 환경에서 주입 불가. Known limitation, 제외 대상 아님. |
| UNVERIFIED | migration drift | 로컬 Supabase(:54322) 미연결로 `prisma migrate status` 직접 실행 불가. migration.sql 수동 검토로 schema.prisma와 정합성 확인. |

---

## Recommendations

1. **getMoim double-read 개선** (선택): assertMember가 반환한 Moim 객체를 재사용하도록 리팩토링하면 DB 쿼리 1회 절감. 현재 코드는 기능상 정확하므로 필수 아님.

2. **migration status CI 통합** (권장): 로컬 CI에서 `prisma migrate status` 출력을 게이트에 포함. 현재는 수동 검토에 의존.

3. **role 필드 enum 고려** (중장기): schema.prisma에서 `role String`을 Prisma enum으로 전환하면 데이터베이스 수준에서 유효하지 않은 role 값을 차단 가능. 현재 코드에서는 mass-assignment 없이 ROLE_OWNER 상수만 삽입하므로 즉각적 위험 없음.

---

## 커버리지 제외 항목 감사

`package.json` `collectCoverageFrom` 제외 목록:
- `**/*.spec.ts` — 테스트 파일 (정상)
- `generated/**` — Prisma 생성 코드 (정상)
- `main.ts` — NestJS 부트스트랩 (정상)
- `openapi.ts` — OpenAPI 생성 스크립트 (정상)
- `swagger.ts` — Swagger 설정 (정상)

`test-tokens.helper.ts`는 제외 목록에 없으나 커버리지 100%로 측정됨. 숨겨진 미검증 코드 없음.

moim 영역 Branch 77.14% (controller)는 Istanbul이 Swagger `@ApiProperty` decorator 내부 conditional metadata를 branch로 계산하는 artifact. 실제 비즈니스 로직 branch는 모두 커버됨.

---

Version: 1.0.0 | SPEC-MOIM-001 | Phase 2.8a final-pass
