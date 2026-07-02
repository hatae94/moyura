# Sprint Contract — SPEC-ACCOUNT-001
## evaluator-active × manager-tdd · harness=thorough

> 이 문서는 evaluator-active가 구현 착수 전 확립한 Done 기준(계약)이다.
> evaluator-active는 **이 계약에 명시된 기준만으로** 채점한다 — 계약에 없는 임의 기준 추가 금지.
> 구현자는 증거 없이 AC 충족을 주장할 수 없다.

---

## 우선순위 차원 (Priority Dimension)

**Primary**: Functionality — 탈퇴 오케스트레이션의 정확성 + 멱등성·복구 정합성

**Focus areas** (채점 가중치 순):
1. 삭제 순서 정합성: 앱 데이터(멱등 트랜잭션) → auth 삭제 선행 불변식
2. 삭제 멱등성: P2025 예외 없는 재실행, deleteUser 재호출 복구
3. 유령 멤버 이양 차단: 존재 판정·선정 모두 withdrawnAt:null
4. 툼스톤 부활 차단: upsertBySub 가드 + 410 응답
5. 비순환 정적 보증: account → SafetyModule/BlockService import 0건

---

## 태스크별 인수 체크리스트

### T-01 — DB 스키마 / 마이그레이션 (REQ-ACCOUNT-001, 002, 003)

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 1.1 | `WithdrawnAccount` 모델 — `sub String @id`, `withdrawnAt DateTime @default(now())`, FK 없음, `@@map("withdrawn_account")` | REQ-001 | `schema.prisma` 해당 모델 diff |
| 1.2 | `MoimMember.withdrawnAt DateTime?` nullable 컬럼 추가, 기존 복합 PK/인덱스 불변 | REQ-002 | `schema.prisma` 해당 필드 diff |
| 1.3 | 마이그레이션 파일이 additive만(DROP TABLE/COLUMN 없음) — `prisma migrate status` clean | REQ-001 | `prisma migrate status` 출력 |
| 1.4 | `prisma generate` 이후 `nx build backend` 성공 | REQ-001 | build 출력 |
| 1.5 | `withdrawn_account` RLS ENABLE (정책 없음 = default deny) SQL 수동 포함 | REQ-003 | migration.sql 해당 구문 |

**T-01 불합격 조건**: DROP/ALTER COLUMN 파괴적 변경 존재, migrate status dirty, build 실패.

---

### T-02 — 툼스톤 부활 차단 (REQ-ACCOUNT-003) · AC-3-1, AC-3-2

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 2.1 | 툼스톤 존재 시 `upsertBySub` — profile upsert 미호출 + `AccountWithdrawnException`(또는 동등한 도메인 신호) 반환 | AC-3-1 | jest 테스트 실행 결과 (RED→GREEN) |
| 2.2 | `me.controller.ts` — 위 신호를 **410 Gone**(또는 401) 응답으로 변환, `prisma.profile.upsert` 미호출 검증 | AC-3-1 | jest mock 호출 검증 |
| 2.3 | **[EDGE]** 410 반환 후 동일 sub로 재요청해도 profile 행이 생성되지 않음(멱등 차단) | AC-3-1 | jest 반복 호출 케이스 |
| 2.4 | 툼스톤 없는 정상 sub → 기존과 동일한 upsert 수행(회귀) | AC-3-2 | jest 정상 경로 케이스 |
| 2.5 | @MX:ANCHOR 계약 확장 주석 존재 (`upsertBySub` 함수 위 또는 내부) | REQ-003 | `profile.service.ts` 코드 확인 |

**T-02 불합격 조건**: 툼스톤 존재 시 upsert 호출 발생, 정상 sub 회귀 파손, 컨트롤러 응답이 2xx.

---

### T-03 — Admin Client + Env 플러밍 (REQ-ACCOUNT-001) · AC 엣지

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 3.1 | `SupabaseAdminClient` — 인터페이스로 추상화(jest mock 가능), `createClient(url, serviceRoleKey, {auth:{persistSession:false}})` 패턴 | REQ-001 | `supabase-admin.client.ts` 소스 |
| 3.2 | **[EDGE] service-role 키 부재 시 fail-closed 500** — deleteAccount 호출 시 키 없으면 HTTP 500, partial 삭제 없음 | 엣지 | jest 테스트: 키 undefined → 500 |
| 3.3 | 키 존재 시 `auth.admin.deleteUser(sub)` 위임 정상 호출 | REQ-001 | jest 테스트: mock 호출 인자 검증 |
| 3.4 | `env.validation.ts` — `SUPABASE_SERVICE_ROLE_KEY: z.string().optional()` 추가, 기존 필드 불변 | REQ-001 | `env.validation.ts` diff |
| 3.5 | `@MX:WARN` (+ `@MX:REASON`) — service-role 키 유출 위험 명시 | REQ-001 | `supabase-admin.client.ts` 주석 |
| 3.6 | 신규 외부 의존성 0 — `@supabase/supabase-js` 기존 패키지만 재사용 | REQ-001 | `package.json` diff (no new deps) |

**T-03 불합격 조건**: 키 부재 시 부분 삭제 진행, 인터페이스 추상화 없어 mock 불가, 신규 패키지 추가.

---

### T-04 — 삭제 오케스트레이션 코어 (REQ-ACCOUNT-001, 001b) · AC-1-1, AC-1-2, AC-1-4

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 4.1 | `$transaction` 내 호출 순서 및 인자 개별 검증: `deviceToken.deleteMany({userId:sub})` · `notification.deleteMany({recipientId:sub})` · `moimInvite.deleteMany({createdBy:sub})` · `moimMember.updateMany(nickname="탈퇴한 사용자"+withdrawnAt+role='member')` · `withdrawnAccount.upsert({sub})` · `profile.deleteMany({id:sub})` | AC-1-1 | jest mock 인자 개별 expect |
| 4.2 | **앱 데이터 트랜잭션 완료 뒤에** `SupabaseAdminClient.deleteUser(sub)` 1회 호출(트랜잭션 밖) | AC-1-1 | jest 호출 순서 검증 |
| 4.3 | **[EDGE] 멱등 재실행** — count 0 반환 시 P2025 예외 없이 트랜잭션 완료 + deleteUser 재호출 가능(복구) | AC-1-2 | jest: 2차 실행 성공 케이스 |
| 4.4 | **[EDGE] auth 삭제 실패 복구** — deleteUser 실패해도 툼스톤이 이미 존재 → 재호출 시 멱등 복구 | AC-1-2 | jest: deleteUser throw → 재실행 성공 |
| 4.5 | 원장 테이블(chat_message, schedule_slot, expense, settlement, poll_vote) **delete 미호출** | AC-1-4 | jest mock: delete 미기록 단언 |
| 4.6 | `@MX:ANCHOR` (+ `@MX:REASON`) — `deleteAccount(sub)` 탈퇴 오케스트레이션 단일 진입점 불변식 명시 | REQ-001 | `account.service.ts` 주석 |

**T-04 불합격 조건**: 트랜잭션과 deleteUser 순서 역전, 원장 테이블 delete 호출 발생, P2025 예외 발생, 멱등 재실행 실패.

---

### T-05 — Safety 고아 정리 (REQ-ACCOUNT-001) · AC-1-3

> tasks.md 검증 완료: block/report 테이블 EXIST (SAFETY-001 선배포). no-op 가드 불필요 — **배포 경로만 구현**.

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 5.1 | `$transaction` 내 `prisma.block.deleteMany({OR:[{blockerId:sub},{blockedUserId:sub}]})` 호출 및 인자 검증 | AC-1-3 | jest mock 인자 expect |
| 5.2 | `$transaction` 내 `prisma.report.deleteMany({OR:[{reporterId:sub},{targetUserId:sub}]})` 호출 및 인자 검증 | AC-1-3 | jest mock 인자 expect |
| 5.3 | **[EDGE] 비순환 정적 검사** — `apps/backend/src/account/**` 에서 `SafetyModule`/`BlockService` import 0건 | AC-1-3 | `grep -r "SafetyModule\|BlockService" apps/backend/src/account/` → 0건 출력 |
| 5.4 | **[EDGE] 역방향 비순환** — `apps/backend/src/safety/**` (또는 관련 파일) 에서 `AccountModule`/`AccountService` import 0건 | AC-1-3 | `grep -r "AccountModule\|AccountService" apps/backend/src/safety/` → 0건 출력 |
| 5.5 | `@MX:NOTE` — 비순환 계약(`prisma.block`/`prisma.report` 직접 접근, SafetyModule import 금지) 명시 | REQ-001 | `account.service.ts` 주석 |

**T-05 불합격 조건**: SafetyModule/BlockService import 존재(비순환 위반), block/report deleteMany 누락, OR 조건 인자 오류.

---

### T-06 — 소유자 고아화 방지 (REQ-ACCOUNT-002, 002b) · AC-2-1, AC-2-2, AC-2-3

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 6.1 | 활성 비-owner 멤버 존재 시 → `MoimService.transferOwner(sub, moimId, 활성대상.userId)` 호출, 이양 대상이 `withdrawnAt:null` 멤버임을 인자로 검증 | AC-2-1 | jest mock 인자 expect |
| 6.2 | 유일 활성 멤버 owner 모임 → `MoimService.deleteMoim(sub, moimId)` 호출, `transferOwner` 미호출 | AC-2-2 | jest mock 검증 |
| 6.3 | **[EDGE] 전원 유령** — 비-owner 멤버 전원 `withdrawnAt≠null` → `transferOwner` 미호출 + `deleteMoim` 호출 | AC-2-3 | jest RED 케이스 |
| 6.4 | **[EDGE] 활성 1 + 유령 N 혼재** — `findMany` 쿼리에 `withdrawnAt:null` 필터 적용, `orderBy:{joinedAt:'asc'}`, `take:1` → 활성 멤버만 이양 대상 선정 | AC-2-3 | jest: 선정 쿼리 인자 검증 |
| 6.5 | 선정 쿼리(`moimMember.findMany`)에 `withdrawnAt:null` 조건 필수 포함 — 유령 배제 | AC-2-3 | jest mock where 인자 단언 |
| 6.6 | `@MX:NOTE` — 이양·존재 판정 모두 `withdrawnAt:null` 유령 이양 금지 계약 명시 | REQ-002b | `account.service.ts` 주석 |

**T-06 불합격 조건**: 유령 멤버로 transferOwner 호출, 전원 유령 모임에서 deleteMoim 미호출, withdrawnAt 필터 누락.

---

### T-07 — 컨트롤러 + 모듈 배선 (REQ-ACCOUNT-001) · AC 엣지

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 7.1 | `DELETE /me/account` — `@UseGuards(SupabaseAuthGuard)` 클래스 레벨, 성공 시 204 반환 | REQ-001 | jest 컨트롤러 테스트 |
| 7.2 | **[EDGE] body userId 무시** — 삭제 대상은 가드 검증 `user.sub`만 사용, body에 임의 uuid 주입 시도 → sub 기준 삭제만 수행 | 엣지(R-8) | jest: body.userId=다른uuid → deleteAccount(user.sub) 인자 검증 |
| 7.3 | `AccountModule` — imports: AuthModule, MoimModule; providers: AccountService, SupabaseAdminClient | REQ-001 | `account.module.ts` 소스 |
| 7.4 | `app.module.ts`에 AccountModule 등록 | REQ-001 | `app.module.ts` diff |
| 7.5 | `nx lint backend` clean (경고/에러 0) | 품질 게이트 | lint 명령 출력 |

**T-07 불합격 조건**: 가드 없는 엔드포인트 노출, body userId가 삭제 대상으로 사용됨, lint 실패.

---

### T-08 — 정원 필터 회귀 (REQ-ACCOUNT-002) · AC 엣지(R-6)

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 8.1 | `invite.service.ts:152` count where에 `withdrawnAt: null` 필터 추가 | REQ-002 | `invite.service.ts` diff |
| 8.2 | **[EDGE] 정원 계산 검증** — 활성 N명 + 탈퇴 마킹 M명 → count가 N만 반환(탈퇴 멤버 제외) | AC 엣지(R-6) | jest: mock count 반환값 단언 |
| 8.3 | 기존 정원 초과 방지 로직 회귀 없음 | REQ-002 | jest 기존 케이스 green |
| 8.4 | `@MX:NOTE` — `withdrawnAt:null` 필터: 정원=활성 멤버 의미 유지 명시 | REQ-002 | `invite.service.ts` 주석 |

**T-08 불합격 조건**: 탈퇴 멤버가 정원에 카운트됨, 기존 정원 초과 방지 회귀 파손.

---

### T-09 — 웹 UI + 계약 재생성 (REQ-ACCOUNT-004, 005, 005b) · AC-4-1, AC-5-1, AC-5-2

> 웹은 테스트 프레임워크 없음 — `nx build web` + `nx lint web` 검증만.

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 9.1 | `account-deletion.tsx` — "회원 탈퇴" 진입점, 파괴적·불가역 확인 UI, 확인 단계 뒤에만 `deleteAccountAction` 호출, 취소 시 미호출 | AC-5-2 | 소스 코드 + `nx build web` 성공 |
| 9.2 | `profile/page.tsx` — 로그아웃 버튼 아래 `<AccountDeletion />` 마운트 | AC-5-1 | `page.tsx` diff |
| 9.3 | `deleteAccountAction` — 성공 시 `supabase.auth.signOut()` + `redirect("/login")`, 실패 시 자격증명 비노출 일반화 오류 | AC-4-1 | `actions.ts` 소스 |
| 9.4 | `openapi.json` 재생성 — `DELETE /me/account` 엔드포인트 노출 | REQ-001 | `openapi.json` diff |
| 9.5 | `packages/api-client/src/schema.d.ts` 재생성 + typecheck 통과 | REQ-001 | `tsc --noEmit` 출력 0 에러 |
| 9.6 | `nx build web` 성공 (0 error) | 품질 게이트 | build 출력 |
| 9.7 | `nx lint web` 성공 (0 error) | 품질 게이트 | lint 출력 |
| 9.8 | 모바일 코드 변경 0 — `apps/mobile/**` diff 없음 | REQ-004 | git diff `apps/mobile/` |

**T-09 불합격 조건**: build/lint 에러, 확인 단계 없이 deleteAccountAction 직접 호출, signOut 누락, 모바일 파일 변경.

---

### T-10 — 디바이스 게이트 (REQ-ACCOUNT-004, HARD 수동) · AC-4-2

| # | 기준 | AC | 필수 증거 |
|---|------|----|-----------|
| 10.1 | 로컬 Supabase에서 service-role 키로 `auth.admin.deleteUser` **실동작** 확인 | AC-1-1 (auth 경로) | 수동 검증 로그/스크린샷 |
| 10.2 | iOS 시뮬레이터 WebView `/profile` 탈퇴 종단: auth 삭제 → `session:cleared` → SecureStore access/refresh 삭제 + `sb-*` 쿠키 삭제 → 로그인 화면 복귀 | AC-4-2 | 시뮬레이터 수동 종단 검증 |
| 10.3 | Android **제외** (iOS 시뮬레이터 전용) | — | 명시적 제외 확인 |

> **[HARD]** T-10 양쪽 수동 게이트 통과 전까지 SPEC-ACCOUNT-001 status를 **completed로 전환 금지**.
> 자동 게이트만으로 completed 처리 불허 (기존 모바일 SPEC 관례, memory: mobile-spec-device-gated).

---

## 필수 엣지 케이스 (Edge Cases — 계약 필수 커버)

아래 케이스는 evaluator-active가 반드시 채점하는 edge 조건이다. 구현자는 각 케이스에 대해 **테스트 이름** 또는 **검증 명령 출력**을 증거로 제시해야 한다.

| EC | 설명 | 대상 태스크 | 검증 방법 |
|----|------|-----------|---------|
| EC-1 | **전원 유령 → deleteMoim** — 비-owner 전원 withdrawnAt≠null 모임에서 transferOwner 미호출 + deleteMoim 호출 | T-06 | jest AC-2-3 RED 케이스 |
| EC-2 | **활성1 + 유령N 혼재 → 활성 선정** — 혼재 시 withdrawnAt:null 멤버만 이양 대상 | T-06 | jest 혼재 케이스, findMany where 인자 단언 |
| EC-3 | **auth 삭제 실패 → 재실행 복구** — deleteUser throw 시 툼스톤 이미 존재 → 재호출 시 멱등 성공 + deleteUser 재시도 | T-04 | jest: deleteUser 1차 throw → 2차 성공 케이스 |
| EC-4 | **멱등 전체 재실행 (P2025-free)** — 1차 완료 후 동일 sub로 2차 deleteAccount: count 0, P2025 예외 없음 | T-04 | jest AC-1-2 멱등 케이스 |
| EC-5 | **서비스 롤 키 부재 → fail-closed 500** — 키 undefined 시 HTTP 500, 삭제 트랜잭션 미실행 | T-03 | jest 키 부재 케이스 |
| EC-6 | **툼스톤 410 + 재요청 차단** — 탈퇴 후 잔존 토큰으로 GET /me → 410, profile 행 미생성 멱등 | T-02 | jest AC-3-1 + 반복 요청 케이스 |
| EC-7 | **정원 카운트 탈퇴 멤버 제외** — 활성N + 유령M → count=N | T-08 | jest R-6 카운트 케이스 |
| EC-8 | **비순환 정적 grep** — account → Safety import 0건 + safety → account import 0건 | T-05 | grep 명령 0건 출력 |
| EC-9 | **body userId 무시** — 요청 body에 다른 userId 주입 시 가드 sub만 사용 | T-07 | jest R-8 케이스 |
| EC-10 | **원장 행 delete 미호출** — chat/schedule/expense/settlement/poll 테이블 delete mock 미기록 | T-04 | jest AC-1-4 미호출 단언 |

---

## 하드 품질 임계값 (Hard Thresholds)

| 게이트 | 임계값 | 측정 방법 | 불합격 시 결과 |
|--------|--------|---------|--------------|
| 백엔드 jest 커버리지 | account 모듈 신규 코드 **85% 이상** | `jest --coverage` lines/branches/functions | 전체 FAIL |
| nx lint backend | **경고/에러 0건** | `npx nx lint backend` | 전체 FAIL |
| TypeScript 타입 에러 | **0건** | `tsc --noEmit` (backend + packages/api-client) | 전체 FAIL |
| nx build web | **에러 0건** | `npx nx build web` | 전체 FAIL |
| nx lint web | **에러 0건** | `npx nx lint web` | 전체 FAIL |
| 비순환 grep | account→Safety import **0건** | grep 명령 | 전체 FAIL |
| 마이그레이션 | `prisma migrate status` **clean** | prisma CLI | 전체 FAIL |
| 디바이스 게이트 | local admin deleteUser **실동작 + iOS 시뮬레이터 종단** | 수동 검증 | completed 전환 금지 |

---

## jest fake 구현 규칙 (구현자 바인딩)

> CI 게이트(memory: ci-backend-lint-gate)에서 위반 시 lint 실패 → PR 블락.

- fake Prisma: `jest.fn()` + `Promise.resolve()` / `Promise.reject()` 사용 — `async` 키워드 금지
- unknown 타입 검증: 명시 캐스팅 (`as unknown as PrismaService`) 사용
- spec fake mock: `notification.service.spec.ts:17-199` 패턴 준수

---

## 계약 범위 외 (Out of Scope — evaluator 채점 제외)

- JWT 즉시 무효화 / 토큰 denylist / realtime RLS 툼스톤 게이트 — 제외 범위(plan §9)
- 유예 기간 / 복구(Undo) / 데이터 다운로드 — 제외 범위
- report 감사 보존 / 아카이브 — 삭제로 확정(plan §10-3)
- poll 생성자 표시명 UI 변경 — 웹 미렌더(제외)
- Android 디바이스 검증 — iOS 전용(memory: ios-simulator-only)
- safety 필터 로직·모더레이션 정책 — SPEC-SAFETY-001 소관

---

## 합격 기준 요약

SPEC-ACCOUNT-001 PASS 조건 (전부 충족 필요):

1. T-01~T-09 체크리스트 항목 전부 green (T-10은 device-gated, status completed 전환 조건)
2. EC-1~EC-10 전원 테스트/검증 증거 제시
3. 하드 임계값 전부 충족 (커버리지 85%+, lint/build 에러 0, grep 0, migrate clean)
4. 보안 게이트: service-role 키 fail-closed, body userId 무시, 가드 sub 단일 출처

---

*계약 작성: evaluator-active | 날짜: 2026-07-02 | 하네스: thorough*
*채점 시 이 계약에 없는 기준 추가 금지 — 추가 발견 사항은 findings로 별도 보고*
