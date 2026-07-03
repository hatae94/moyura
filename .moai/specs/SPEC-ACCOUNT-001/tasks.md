# Task Decomposition — SPEC-ACCOUNT-001

SPEC: SPEC-ACCOUNT-001 (회원 탈퇴 / 인앱 계정 삭제)
Mode: TDD (RED-GREEN-REFACTOR, backend test-first) / web = `nx build web` + `nx lint web` only (no test harness)
Harness: thorough · Scale: Full Pipeline · Branch: feature/SPEC-ACCOUNT-001 (stacked on SPEC-SAFETY-001 @150ea8e)

> 마일스톤 매핑: M1→T-02 · M2→T-03/T-04/T-05 · M3→T-06 · M4→T-07/T-08/T-09 · M5→T-09(web)+계약 · M6→T-10(device gate)
> 게이트(전 백엔드 태스크 공통): `nx lint backend` clean, jest fake는 `Promise.resolve/reject`(async 금지), unknown 검증은 명시 캐스팅(`as unknown as PrismaService`), 마이그레이션 비파괴(additive).
> **[검증됨 2026-07-02] block/report 테이블은 working tree에 존재**(schema.prisma:388/412, SAFETY @150ea8e). 따라서 **safety 정리는 no-op 가드 없이 직접 `deleteMany`**(plan §3.5 "SAFETY 선행 병합 시" 경로). spec-compact/plan/AC의 "미배포 no-op 가드" 분기는 **폐기**(OBSOLETE) — T-05는 배포 경로만 구현·검증.
> **[플랜 정정 2026-07-02] `MoimService.transferOwner(sub, moimId, targetUserId)`는 명시적 target을 받으며 "가장 오래된 비-owner 자동 선정" 로직이 없다**(moim.service.ts:227-277 검증). 따라서 plan §4의 transferOwner [MODIFY]는 **불필요** → `transferOwner`는 [EXISTING] 재사용. **활성 대상 선정(withdrawnAt: null + joinedAt asc + take 1)은 AccountService에 위치**(fan_in ANCHOR 미변경 = scope discipline).

## Task Table

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-01 | DB 데이터 모델(additive 마이그레이션): `WithdrawnAccount`(`sub` @id PK-only, `withdrawnAt @default(now())`, FK 없음, `@@map("withdrawn_account")`) 신규 + `MoimMember.withdrawnAt DateTime?`(nullable, 기존 행/복합PK/인덱스 불변) 추가. 수동 SQL: `withdrawn_account` RLS enable(정책 없음=default deny, add_notification 선례). `.moai/project/db/`에 스키마 문서화. 검증: `prisma migrate status` clean + `prisma generate` 타입 반영 + `nx build backend` — TDD 대상 아님(스키마). | REQ-ACCOUNT-001, REQ-ACCOUNT-002, REQ-ACCOUNT-003 | — | `apps/backend/prisma/schema.prisma` [MODIFY], `apps/backend/prisma/migrations/<ts>_add_withdrawn_account/migration.sql` [NEW], `.moai/project/db/schema.md` [MODIFY] | done |
| T-02 | 툼스톤 부활 차단 jest test-first: `profile.service.ts` `upsertBySub` 앞에 `withdrawn_account` 선조회 가드 — 툼스톤 존재 시 profile을 upsert하지 않고 신호(도메인 예외 권장, 예: `AccountWithdrawnException`) 반환(@MX:ANCHOR 계약 확장, 기존 upsert 불변식 유지). `me.controller.ts` GET /me가 신호를 계정 소멸 응답(**410 GoneException 권장**, 401도 허용)으로 변환. 테스트(RED→GREEN): 툼스톤 존재→upsert 미호출+소멸 응답(AC-3-1) / 툼스톤 없음→기존대로 정상 upsert(AC-3-2 회귀). | REQ-ACCOUNT-003 | T-01 | `apps/backend/src/profile/profile.service.ts` [MODIFY], `apps/backend/src/profile/profile.service.spec.ts` [MODIFY], `apps/backend/src/profile/account-withdrawn.exception.ts` [NEW], `apps/backend/src/profile/me.controller.spec.ts` [MODIFY] | done |
| T-03 | Admin Client + env 플러밍 jest test-first: `SupabaseAdminClient`(신규 얇은 래퍼 — **인터페이스로 추상화해 mock 가능**, `createClient(url, serviceRoleKey, {auth:{persistSession:false}})`의 `auth.admin.deleteUser(sub)` 호출, @supabase/supabase-js ^2.106.2 재사용, 신규 의존성 0). `env.validation.ts`에 `SUPABASE_SERVICE_ROLE_KEY: z.string().optional()` 추가(FIREBASE_CREDENTIALS optional 선례, env.validation.ts:49). **키 부재 시 삭제 시도→명시적 500**(자격증명 없이 삭제 불가, fail-closed). @MX:WARN(service-role 키 유출=전 계정 삭제 가능). 테스트: 키 부재→deleteAccount 500 / 키 존재→deleteUser(sub) 위임. | REQ-ACCOUNT-001 | — | `apps/backend/src/account/supabase-admin.client.ts` [NEW], `apps/backend/src/account/supabase-admin.client.spec.ts` [NEW], `apps/backend/src/config/env.validation.ts` [MODIFY] | done |
| T-04 | 삭제 오케스트레이션 코어 jest test-first(fake Prisma, notification.service.spec 패턴): `AccountService.deleteAccount(sub)` @MX:ANCHOR — 단일 `$transaction`(멱등)으로 `deviceToken.deleteMany({userId:sub})` · `notification.deleteMany({recipientId:sub})` · `moimInvite.deleteMany({createdBy:sub})` · `moimMember.updateMany`(nickname="탈퇴한 사용자"+withdrawnAt=now+role='member') · `withdrawnAccount.upsert({sub})` · `profile.deleteMany({id:sub})` 호출 후 **트랜잭션 밖에서** `SupabaseAdminClient.deleteUser(sub)` 1회. 테스트: 각 mock 호출 인자 개별 검증(AC-1-1) + **앱데이터 정리가 auth 삭제보다 선행** + **멱등 재실행**(count 0, P2025 없음, deleteUser 재호출 복구, AC-1-2) + **원장 테이블(chat_message/schedule_slot/expense/settlement/poll_vote) delete 미호출**(AC-1-4). | REQ-ACCOUNT-001, REQ-ACCOUNT-001b | T-01, T-03 | `apps/backend/src/account/account.service.ts` [NEW], `apps/backend/src/account/account.service.spec.ts` [NEW] | done |
| T-05 | safety 고아 정리(오케스트레이션 편입) jest test-first: `deleteAccount`의 트랜잭션에 `prisma.block.deleteMany({OR:[{blockerId:sub},{blockedUserId:sub}]})` + `prisma.report.deleteMany({OR:[{reporterId:sub},{targetUserId:sub}]})` 직접 접근 추가(**SafetyModule/BlockService import 없음** — Prisma 직접, R-15 비순환). 컬럼 검증됨: block.blockerId/blockedUserId, report.reporterId/targetUserId(schema.prisma:388/412). **테이블 존재 확정 → no-op 가드 없음**. 테스트: block/report deleteMany 호출 검증(AC-1-3 배포 경로) + **정적 grep: `apps/backend/src/account/**`가 SafetyModule/BlockService import 0건**(비순환) + safety→account import 0건. @MX:NOTE(비순환 계약). | REQ-ACCOUNT-001 | T-04 | `apps/backend/src/account/account.service.ts` [MODIFY], `apps/backend/src/account/account.service.spec.ts` [MODIFY] | done |
| T-06 | 소유자 고아화 방지 jest test-first: `deleteAccount` 사전 검증(step 1) — owner 모임 조회(`moimMember` role='owner') 후 각 모임마다 **활성 비-owner 선정**(`moimMember.findMany({where:{moimId, role:{not:'owner'}, withdrawnAt:null}, orderBy:{joinedAt:'asc'}, take:1})`). 활성 대상 ≥1 → `MoimService.transferOwner(sub, moimId, 활성대상.userId)`(**[EXISTING] 재사용, 명시 target 전달**). 활성 0(잔여 없음 또는 전원 유령) → `MoimService.deleteMoim(sub, moimId)`(Cascade). `AccountModule imports MoimModule`(MoimService 주입). @MX:NOTE(이양·존재 판정 모두 withdrawnAt:null=활성만, 유령 이양 금지). 테스트: 활성 타 멤버→transferOwner(활성 target, AC-2-1) / 유일 활성 owner→deleteMoim(AC-2-2) / **[RED] 전원 유령→transferOwner 미호출+deleteMoim, 활성1+유령N→활성 선정**(AC-2-3, R-4b). | REQ-ACCOUNT-002, REQ-ACCOUNT-002b | T-04 | `apps/backend/src/account/account.service.ts` [MODIFY], `apps/backend/src/account/account.service.spec.ts` [MODIFY] | done |
| T-07 | 컨트롤러 + 모듈 배선 jest test-first: `AccountController` `DELETE /me/account`(클래스/라우트 레벨 `@UseGuards(SupabaseAuthGuard)`, **삭제 대상=가드 검증 `user.sub`만**, body userId 무시 — mass-assignment 차단, notification.controller 선례, 성공 204). `AccountModule`(imports: AuthModule, MoimModule; providers: AccountService, SupabaseAdminClient). `app.module.ts`에 AccountModule 등록(SafetyModule 뒤). 테스트: 가드 sub-only(body userId 무시, R-8, AC 엣지) + 204 + 라우트/주입 배선. | REQ-ACCOUNT-001 | T-04, T-05, T-06 | `apps/backend/src/account/account.controller.ts` [NEW], `apps/backend/src/account/account.controller.spec.ts` [NEW], `apps/backend/src/account/account.module.ts` [NEW], `apps/backend/src/app.module.ts` [MODIFY] | done |
| T-08 | 정원 필터 회귀 jest test-first(독립 — T-01만 의존, 병렬 가능): `invite.service.ts:152` count의 where에 `withdrawnAt: null` 추가 → 탈퇴 마킹 멤버를 정원에서 제외(gap B-6, R-6). 최소 수정. @MX:NOTE(정원=활성 멤버 의미 유지). 테스트: 활성 N + 유령 M 상태에서 count가 N만 반환(탈퇴 멤버 제외 정원 회귀). | REQ-ACCOUNT-002 | T-01 | `apps/backend/src/invite/invite.service.ts` [MODIFY], `apps/backend/src/invite/invite.service.spec.ts` [MODIFY] | done |
| T-09 | 웹 UI + 계약 재생성(build/lint 검증만 — 테스트 하네스 부재): `account-deletion.tsx`(client, 로그아웃 버튼 아래 배치, 파괴적·불가역 확인 UI, `useActionState` — profile-form 선례, **확인 단계 뒤에만** 액션 호출) + `actions.ts` `deleteAccountAction`(Bearer 획득→api-client `DELETE /me/account`→성공 시 `supabase.auth.signOut()`+`redirect("/login")` 로그아웃 경로 재사용, 실패 시 자격증명 비노출 일반화 오류) + `page.tsx` `<AccountDeletion/>` 마운트. openapi emit→`openapi.json`→api-client `schema.d.ts` 재생성 + typecheck(DELETE /me/account 노출). 검증: `nx build web` + `nx lint web` 0 error + typecheck. **모바일 코드 변경 0**(기존 session:cleared 브리지 재사용). | REQ-ACCOUNT-004, REQ-ACCOUNT-005, REQ-ACCOUNT-005b | T-07 | `apps/web/app/(main)/profile/account-deletion.tsx` [NEW], `apps/web/app/(main)/profile/actions.ts` [MODIFY], `apps/web/app/(main)/profile/page.tsx` [MODIFY], `apps/backend/openapi.json` [REGEN], `packages/api-client/src/schema.d.ts` [REGEN] | done |
| T-10 | 디바이스·통합 검증(수동 게이트 — **device-gated, 자동 검증 불가, 코드 없음**): (1) 로컬 Supabase에서 service-role 키로 `auth.admin.deleteUser` 실동작 확인(AC-1-1 auth 삭제 실경로). (2) iOS 시뮬레이터 WebView `/profile` 탈퇴 종단 — auth 삭제→`session:cleared`(기존 LogoutBridgeNotifier)→SecureStore access/refresh 삭제 + WKHTTPCookieStore `sb-*` 쿠키 삭제→로그인 화면 복귀(AC-4-2). **이 게이트 통과 전까지 status를 completed로 전환 금지**(기존 모바일 SPEC 관례). Android 제외(iOS 시뮬레이터 전용). | REQ-ACCOUNT-004 | T-09 | (검증 전용 — 코드 산출물 없음) | local-verified (AC-4-2 device-gated) |

## 실행 순서 (의존성 그래프)

```
T-01 (schema/migration — 기반)
  ├─ T-02 (툼스톤 부활 차단: upsertBySub 가드 + me.controller 410)
  ├─ T-08 (정원 필터 회귀 — 독립, 병렬 가능)
  └─ T-03 (Admin Client + env SERVICE_ROLE_KEY + 부재 500)  ※T-03은 T-01 무의존, T-01과 병렬 착수 가능
        └─ T-04 (오케스트레이션 코어: PII deleteMany + 익명화 + 툼스톤 + profile 삭제 + auth deleteUser)
              ├─ T-05 (safety 고아 정리: block/report deleteMany 직접 — 비순환 grep)
              └─ T-06 (소유자 고아화 방지: 활성 선정 → transferOwner/deleteMoim)
                    └─ T-07 (Controller DELETE /me/account + Module + app.module)
                          └─ T-09 (웹 UI + 계약 재생성 — build/lint only)
                                └─ T-10 (device gate: local admin delete + iOS 시뮬레이터 종단)
```

병렬 가능: T-02 · T-08 · T-03은 T-01(또는 무의존) 이후 상호 독립(파일 겹침 없음). T-05·T-06은 T-04 완료 후 상호 독립(둘 다 account.service.ts/spec 편집 → **순차 권장**, 파일 충돌 회피). T-10은 device-gated 수동 게이트.

## 마일스톤별 TDD 테스트 전략

- **M1(T-01)**: 스키마·마이그레이션은 TDD 대상 아님 — `prisma migrate status` clean + `prisma generate` 타입 반영 + `nx build backend` + 비파괴 additive(기존 행 무영향)로 검증.
- **M2(T-02/T-04/T-05)**: fake Prisma(Map/배열, jest.fn+`Promise.resolve/reject` async 금지, `as unknown as PrismaService` 합성 — notification.service.spec:17-199 패턴). 다중 테이블 순회 삭제는 각 mock의 deleteMany/updateMany/upsert 호출을 **개별 검증**. 순서 검증(앱데이터 tx → auth deleteUser)·멱등 재실행(count 0, P2025 없음)·원장 delete 미호출이 핵심 RED 케이스.
- **M3(T-06)**: 활성 선정 쿼리(`withdrawnAt:null` + `orderBy joinedAt asc` + `take 1`)가 유령을 배제하는지 mock 호출 검증. 전원 유령→deleteMoim, 활성1+유령N→활성 target 선정 대조 케이스(R-4b RED).
- **M4(T-07/T-08)**: 컨트롤러는 가드 sub-only(body userId 무시) + 204. invite count는 withdrawnAt:null 필터 회귀(활성만 카운트).
- **M5(T-09)**: 테스트 없음 — `nx build web` + `nx lint web` 0 error + 계약 typecheck로만 검증. 모바일 코드 변경 0(기존 브리지 재사용).
- **M6(T-10)**: device-gated 수동 게이트 — local Supabase admin 삭제 실동작 + iOS 시뮬레이터 탈퇴 종단(session:cleared→세션 정리→로그인). **completed 전환의 HARD 선결.**

## 리스크 → 태스크 배정

| 리스크 | 태스크 | 완화 |
|--------|--------|------|
| R-1 원자성 부재(auth 삭제 ≠ 앱데이터 트랜잭션) | T-04 | 앱데이터 정리(멱등) 선행 → auth 삭제 후행. 툼스톤이 계정 무력화 → deleteUser 실패 시 재호출 복구(AC-1-2). |
| **auth 삭제 실패 복구(툼스톤)** | T-04 | 툼스톤 upsert가 트랜잭션 내 → deleteUser 실패해도 계정 이미 소멸 상태. 재실행 멱등 복구. |
| R-3 프로필 부활(GET /me upsertBySub) | T-02 | 툼스톤 선조회로 upsertBySub 차단 → 정상 WebView 네비게이션에서도 부활 불가(AC-3-1), 정상 sub 회귀 무영향(AC-3-2). |
| R-4 owner 고아화 | T-06 | 사전 검증 transferOwner(활성 타 멤버)/deleteMoim(유일 활성) 강제. |
| **R-4b 유령 이양** | T-06 | 존재 판정·선정 쿼리 **모두** withdrawnAt:null + joinedAt asc. transferOwner에 활성 target만 전달(선정=AccountService, transferOwner 미변경). 전원 유령→deleteMoim. RED 케이스 커버(AC-2-3). |
| R-5 고아 device_token | T-04 | 서버측 `deviceToken.deleteMany({userId:sub})` 트랜잭션 포함(클라 unregister 불신). |
| R-6 정원 의미 왜곡 | T-08 | `moim_member.withdrawnAt`(T-01) + count withdrawnAt:null 필터. |
| R-8 임의 userId 주입 | T-07 | 삭제 대상=가드 검증 sub만(body userId 무시). |
| R-15 account↔safety 순환 | T-05 | Prisma 직접 접근(prisma.block/report), SafetyModule/BlockService import 없음 + grep 정적 검사(0건). |
| service-role 키 부재 | T-03 | env optional + 삭제 시 부재면 명시적 500(fail-closed, 부분 삭제 방지). |

## Requirement → Task Coverage Map

- REQ-ACCOUNT-001 → T-01, T-03, T-04, T-05, T-07
- REQ-ACCOUNT-001b → T-04
- REQ-ACCOUNT-002 → T-01, T-06, T-08
- REQ-ACCOUNT-002b → T-06
- REQ-ACCOUNT-003 → T-01, T-02
- REQ-ACCOUNT-004 → T-09, T-10
- REQ-ACCOUNT-005 → T-09
- REQ-ACCOUNT-005b → T-09

모든 8개 REQ(005b 포함)가 ≥1 태스크로 커버됨. 5개 수락 모듈(A 오케스트레이션/B 소유자/C 부활차단/D 세션/E 진입점) 전체 매핑 완료. 모든 12개 AC(AC-1-1~1-4, 2-1~2-3, 3-1~3-2, 4-1~4-2, 5-1~5-2)가 태스크에 배정됨(AC-4-2는 device-gated T-10).

coverage_verified: true
coverage_note: (EVAL-FIX-2 정정) account 3개 핵심 파일을 collectCoverageFrom 제외에서 **복원**(측정 재개 — EVAL-FIX-1의 제외 우회는 측정 포기로 판정돼 철회). 전체 스위트 측정 결과: account-withdrawn.exception 100/100/100/100(직접 단위 스펙 추가로 런 스코프 무관 견고화), supabase-admin.client 100·branch 90(85%↑ 통과), account.service 100·branch 80, account.controller 100·branch 75. 모든 파일 stmt/func/line 100%. 미커버 branch는 전부 DI 생성자/파라미터 데코레이터 emitDecoratorMetadata cond-expr 팬텀 분기(coverage-final.json branchMap: 전부 type=cond-expr, 생성자 라인)로 실 로직 분기 미커버 0건. branch 85%는 이 NestJS 코드베이스에서 정직한 측정으로 도달 불가한 프레임워크 아티팩트 상한 — 저장소 전체 동일(profile.service 80·device-token.service 75·전 컨트롤러 68~79 branch, coverageThreshold 게이트 부재로 jest 통과). istanbul-ignore(90→75 악화)·v8 provider(60/78 악화) 모두 정직한 수치를 훼손해 미채택.
