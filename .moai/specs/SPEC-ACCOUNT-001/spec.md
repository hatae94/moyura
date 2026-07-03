---
id: SPEC-ACCOUNT-001
version: "0.2.0"
status: in-progress
created: 2026-07-02
updated: 2026-07-03
author: hatae
priority: critical
issue_number: 0
---

# SPEC-ACCOUNT-001 — 회원 탈퇴 (인앱 계정 삭제)

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md) | 리서치: [research.md](./research.md) | 인터뷰: [interview.md](./interview.md)
> 형제 SPEC: SPEC-SAFETY-001(신고/차단) — 순환 의존 금지(R-15), **구현 순서 = SAFETY 선행**(§7 확정).

## HISTORY

- 2026-07-03 (v0.2.0): 구현 완료(커밋 `88432e7`, 브랜치 `feature/SPEC-ACCOUNT-001`). 품질 게이트 전 통과 — tsc 0 error, nx lint backend/web clean, jest 635/635 PASS(37 suites), evaluator-active 4차원 PASS(이터레이션 3), TRUST 5 PASS, MX 태그 검증 완료. 단, AC-4-2(iOS 시뮬레이터 WebView 탈퇴 종단 — session:cleared → SecureStore 토큰/sb-* 쿠키 삭제 → 로그인 복귀) 검증이 device-gated 잔여로 status는 in-progress 유지(프로젝트 컨벤션). 계획 대비 발산 항목은 "구현 노트" 섹션에 문서화.
- 2026-07-02 (v0.1.0): 최초 작성(draft). 인터뷰 1개 라운드(2개 결정) + 계획 검토 승인 반영.
  - 스토어 출시 정책 대응: Apple App Review 5.1.1(v), Google Play 계정 삭제 요건 — 앱 내(웹·모바일 WebView 공유 표면) 계정 삭제 제공.
  - 확정 범위: Supabase auth 계정 + PII(profile 행/이메일 identity/FCM 토큰) 즉시 삭제(유예 없음), 작성 UGC는 "탈퇴한 사용자"로 익명화하되 모임 기록(채팅/일정/정산) 무결성 보존.
  - 핵심 설계: 어떤 테이블도 `profile.id`로의 FK가 없어(research.md:15-17) 삭제는 캐스케이드하지 않는다 → 사용자 컬럼 보유 테이블을 명시 순회하는 **오케스트레이션**. auth.users는 Supabase 관리 영역이라 트랜잭션 밖 Admin API 호출(research.md:142) → "앱 데이터 정리(멱등 트랜잭션) → auth 계정 삭제" 순서로 중간 실패 재실행 가능.
  - 사용자 확정 결정(2026-07-02): (1) report 함께 삭제(보존 테이블 이관 없음), (2) 구현 순서 SAFETY 선행 + no-op 가드, (3) safety 고아 행 정리 소유자 = 본 SPEC(양쪽 plan 정합 확인).

## 1. 목표 (Goal)

앱 내에서 접근 가능한 회원 탈퇴를 제공한다. 탈퇴 시 Supabase auth 계정과 PII(profile 행, 이메일 identity, FCM 디바이스 토큰)를 즉시 삭제하고, 사용자가 남긴 UGC는 "탈퇴한 사용자"로 익명화하되 다른 멤버를 위한 모임 원장(채팅/일정/정산)의 무결성은 보존한다. 탈퇴 성공 후 웹·네이티브 세션을 전면 무효화해 로그인 화면으로 되돌린다.

## 2. 스토어 정책 근거 매핑 (Store Policy → 설계)

| 스토어 요건 | 근거 | 설계 대응 | REQ |
|---|---|---|---|
| Apple App Review Guideline 5.1.1(v) — 계정 생성이 가능한 앱은 **앱 내 계정 삭제** 제공 필수 (Apple 1.2 안전 요건 계열) | Apple 5.1.1(v) | `(main)/profile` 설정 화면에 "회원 탈퇴" 진입점 + 파괴적·불가역 확인 단계 | REQ-ACCOUNT-005/005b |
| Google Play — 앱 내 계정 삭제 제공(웹 경로 포함) 상응 요건 | Google Play 계정 삭제 요건 | `(main)/profile`은 웹·모바일 WebView 공유 표면(research.md:72) — 단일 구현이 양 표면 커버 | REQ-ACCOUNT-005 |
| 계정·PII 즉시 삭제 | Apple 5.1.1(v) / Google Play | auth.users(Admin API) + profile + device_token + notification 삭제 | REQ-ACCOUNT-001 |
| 삭제 후 재접근/부활 차단 | 삭제 실효성 | withdrawn 툼스톤으로 `GET /me`(`upsertBySub`)의 profile 부활 차단 | REQ-ACCOUNT-003 |
| 삭제 후 세션 종료 | 삭제 실효성 | 웹 signOut + 네이티브 브리지(SecureStore/쿠키) 정리 → 로그인 화면 | REQ-ACCOUNT-004 |
| 다른 멤버 기록 무결성 보존 | 데이터 무결성 | UGC 원장 행 삭제 금지, 표시명만 "탈퇴한 사용자"로 익명화 + owner 고아화 방지 | REQ-ACCOUNT-001/002 |

## 3. 가정 (Assumptions)

- 어떤 테이블도 `profile.id`로의 FK가 없다(research.md:15-17) → profile 삭제는 캐스케이드하지 않으며, 명시적 오케스트레이션이 유일한 삭제 경로.
- `auth.users`는 Supabase 관리 스키마라 Prisma 트랜잭션에 포함할 수 없다(research.md:142) → service-role 키 기반 Admin Client(`auth.admin.deleteUser`)를 트랜잭션 밖에서 호출.
- Supabase JWT는 오프라인 검증(auth.users 미조회, research.md:308)이라 삭제 후에도 `jwt_expiry=3600` 유예 창(≤1h) 동안 잔존 토큰이 존재할 수 있다 — 유계·수용 리스크로 문서화(§5, R-2).
- `(main)/profile`은 웹·모바일 WebView 공유 표면(research.md:72)이라 단일 웹 구현이 양 표면을 커버한다.
- SPEC-SAFETY-001(`block`/`report` 테이블)이 **선행 배포**된다는 전제. 미배포 시 정리 태스크는 no-op 가드로 스킵한다(§7, R-17).

## 4. 요구사항 (EARS Requirements)

요구사항 모듈: **5개**(모듈 ≤ 5 한도 준수). 각 REQ는 관찰 가능한 행위를 기술하고, 커버하는 AC ID를 함께 표기한다. 엔드포인트 경로·DB 연산·라이브러리명 등 신규 구현(HOW)은 plan.md/§6 델타 마커에 둔다(단, 순환 의존 금지 등 아키텍처 제약 명명은 요구사항 본질이므로 유지). 예외: 브라운필드 통합 지점을 식별하는 **기존** 식별자(`upsertBySub`, `session:cleared`, Supabase Admin Client 등)는 관찰 가능한 행위의 앵커(어느 기존 진입점이 대상인지)를 특정하기 위해 괄호 참조로 허용한다 — 신규 구현 세부는 아니다.

### 모듈 A — 탈퇴 오케스트레이션 + PII 삭제 + UGC 익명화

#### REQ-ACCOUNT-001 [Event-driven] — 탈퇴 처리
**When** 인증된 사용자가 탈퇴 확인을 제출하면, 시스템은 (1) 소유 모임을 처리(REQ-ACCOUNT-002)한 뒤, (2) 단일 멱등 트랜잭션으로 PII(profile 행, 사용자 소유 device_token, 수신 notification, 본인 발행 moim_invite)를 삭제하고, safety 고아 행(탈퇴 sub의 block·report 양측)을 정리하며, UGC 작성자 표시명을 "탈퇴한 사용자"로 익명화하고 withdrawn 툼스톤을 기록한 다음, (3) Supabase Admin Client로 auth 계정을 삭제한다(shall). (2)는 재실행 가능(멱등)해야 하며 (3)이 실패해도 (2)의 툼스톤이 계정을 이미 무력화하므로 재호출로 복구 가능해야 한다. safety 테이블 정리는 SPEC-SAFETY-001 배포를 전제로 하며, 미존재 시 no-op 가드로 스킵한다. — AC: AC-1-1, AC-1-2, AC-1-3

#### REQ-ACCOUNT-001b [Unwanted] — 원장 행 삭제 금지
**If** 탈퇴 처리가 다른 멤버의 원장·기록 행(`chat_message`, `schedule_event`/`schedule_slot`, `expense`/`expense_share`/`settlement`, `settlement_request`, `poll`/`poll_vote`)에 대한 삭제를 시도하면, **then** 시스템은 해당 삭제를 수행하지 않고 작성자 표시명 익명화만 적용한다(무결성 보존)(shall not delete). — AC: AC-1-4

### 모듈 B — 모임 소유자 고아화 방지

#### REQ-ACCOUNT-002 [Event-driven] — 소유권 이양 / 모임 삭제
**When** 탈퇴 확인이 제출되고 탈퇴 사용자가 어떤 모임의 owner이면, 시스템은 각 소유 모임에 대해 다음을 수행한다(shall): (a) 활성(비탈퇴) 비-owner 멤버가 1명 이상 존재하면 소유권을 활성 비-owner 멤버 중 가장 오래된 멤버에게 강제 이양하고, (b) 탈퇴 사용자가 유일한 활성 멤버(잔여 멤버 없음 또는 전원 탈퇴 마킹)이면 해당 모임을 삭제(Cascade)한다. 조건 판정(존재·유일 여부)은 모두 활성 멤버 기준으로 수행한다. — AC: AC-2-1, AC-2-2

#### REQ-ACCOUNT-002b [Unwanted] — 접근 불가 owner 잔존 금지
**If** 소유권 이양 대상 선정이 유령(탈퇴 마킹) 멤버를 owner로 선정하려 하면, **then** 시스템은 그 이양을 수행하지 않는다 — 접근 불가 owner를 남기게 되므로, 존재 판정·이양 대상 선정을 모두 활성 멤버 기준으로 수행하여 접근 가능한(활성) owner가 없는 모임을 남기지 않는다(shall not leave orphaned owner). — AC: AC-2-3

### 모듈 C — 프로필 부활 차단

#### REQ-ACCOUNT-003 [Unwanted] — 툼스톤 부활 차단
**If** 탈퇴한 사용자의 잔존 토큰이 JWT 유예 창 내에 프로필 조회 진입점(`GET /me` → `upsertBySub`)을 호출하면, **then** 시스템은 withdrawn 툼스톤을 선조회하여 Profile 행을 재생성하지 않고 계정 소멸 응답(401/410)을 반환한다(shall not re-create profile). 시스템은 삭제된 계정의 PII가 후속 요청으로 되살아나지 않도록 보장한다. — AC: AC-3-1, AC-3-2

### 모듈 D — 세션 무효화 (웹 + 네이티브)

#### REQ-ACCOUNT-004 [Event-driven] — 탈퇴 후 세션 종료
**When** 탈퇴가 성공하면, 시스템은 웹에서 세션을 signOut한 뒤 `/login`으로 리다이렉트하고, 모바일 WebView에서는 기존 로그아웃 브리지(`session:cleared`)를 재사용해 네이티브가 SecureStore access/refresh 토큰과 `sb-*` 세션 쿠키를 삭제하고 로그인 화면으로 복귀하도록 한다(shall). — AC: AC-4-1, AC-4-2

### 모듈 E — 설정 진입점 + 파괴적 확인

#### REQ-ACCOUNT-005 [Ubiquitous] — 진입점 제공
시스템은 `(main)/profile` 설정 화면에 "회원 탈퇴" 진입점을 제공한다(shall). — AC: AC-5-1

#### REQ-ACCOUNT-005b [Event-driven] — 파괴적 확인 게이트
**When** 사용자가 회원 탈퇴 진입점을 선택하면, 시스템은 파괴적·불가역 액션 확인 단계를 거친 뒤에만 탈퇴 서버 액션을 호출한다(shall). — AC: AC-5-2

## 5. 잔존 리스크 요약 (수용 리스크)

- **R-2 — JWT 유예 창(≤1h) 내 잔존 토큰 접근**: 즉시 완화(PII 삭제 + 툼스톤 부활 차단 + 클라이언트 세션 즉시 정리)로 실질 접근을 차단. realtime/`assertMember` 하드 회수는 제외 범위(§8)로, 잔존 창은 PII 누출 없는 유계·수용 리스크(research.md gap A).
- **R-8/R-15 — service-role 키·순환 의존**: 키는 env/secret로만 주입(커밋 금지), Admin Client는 account 모듈 내부에만 두고 삭제 대상은 가드 검증 sub로 한정. safety 정리는 `SafetyModule`/`BlockService`를 import하지 않고 Prisma 직접 접근(비순환 계약).
- 전체 리스크 표·완화는 plan.md §7 참조.

## 6. 변경 마커 (Delta Markers — Brownfield)

- [NEW] `apps/backend/src/account/**` — module/controller/service/admin-client (탈퇴 오케스트레이션 진입점). safety 고아 정리(`prisma.block`/`prisma.report` 직접 deleteMany, SAFETY 배포 시, import 없음, 미배포 시 no-op 가드)를 이 신규 구현에 포함한다.
- [MODIFY] `apps/backend/prisma/schema.prisma` — `WithdrawnAccount` 모델 추가(부활 차단 툼스톤) + `moim_member.withdrawnAt`(nullable 마커) — 정원·이양에서 탈퇴 멤버 제외
- [NEW] `apps/backend/prisma/migrations/<ts>_add_withdrawn_account/` — WithdrawnAccount + moim_member.withdrawnAt 마이그레이션
- [MODIFY] `apps/backend/src/config/env.validation.ts` — `SUPABASE_SERVICE_ROLE_KEY`(optional, 삭제 시 부재면 500)
- [MODIFY] `apps/backend/src/app.module.ts` — `AccountModule` 등록
- [MODIFY] `apps/backend/src/moim/moim.service.ts` `transferOwner` — 비-owner 선정 쿼리에 `withdrawnAt: null` 가드(유령 이양 방지)
- [EXISTING] `apps/backend/src/moim/moim.service.ts` `deleteMoim` — 재사용(호출)
- [MODIFY] `apps/backend/src/invite/invite.service.ts:152` — 정원 count `withdrawnAt: null` 필터
- [MODIFY] `apps/backend/src/profile/profile.service.ts`(`upsertBySub` 툼스톤 가드) + `me.controller.ts`(계정 소멸 응답)
- [EXISTING] `LogoutBridgeNotifier` / `session:cleared` 경로 — 재사용
- [MODIFY] `apps/web/app/(main)/profile/actions.ts` — `deleteAccountAction`
- [NEW] `apps/web/app/(main)/profile/account-deletion.tsx` — 확인 UI
- [MODIFY] `apps/web/app/(main)/profile/page.tsx` — `<AccountDeletion />` 마운트
- [REGEN] `apps/backend/openapi.json` + `packages/api-client/src/schema.d.ts` — `DELETE /me/account` 노출

## 7. 의존성 및 구현 순서 (Dependencies & Ordering)

- 선행 SPEC: **SPEC-SAFETY-001 선행 [확정 2026-07-02]** — `block`/`report` 테이블 존재가 고아 행 정리 전제. SAFETY 미배포 상태면 정리 태스크는 no-op 가드로 스킵하고 SAFETY 배포 후 활성화(R-17).
- 재사용: `MoimService.transferOwner`/`deleteMoim`(모임 소유권 처리), `LogoutBridgeNotifier`/`session:cleared`(로그아웃 경로), `SupabaseAuthGuard`(가드 검증 sub).
- 신규 env: `SUPABASE_SERVICE_ROLE_KEY`(env/secret 주입, 커밋 금지). `SUPABASE_URL`은 기존 required 재사용.
- 신규 의존성: **0** — `@supabase/supabase-js`(이미 설치)의 `createClient` + `auth.admin.deleteUser`로 충분.

## 8. 제외 범위 (Exclusions — What NOT to Build)

- **UGC 원장 행 삭제 금지**: `chat_message`, `schedule_event`/`schedule_slot`, `expense`/`expense_share`/`settlement`, `settlement_request`, `poll`/`poll_vote`는 다른 멤버의 기록이므로 삭제하지 않고 표시명만 익명화한다(무결성 보존).
- **JWT 하드 회수(즉시 무효화) 제외**: 가드 레벨 auth.users 존재 검증, 토큰 denylist/블랙리스트, realtime RLS 툼스톤 게이트 추가는 본 SPEC 범위 밖. Supabase 오프라인 검증 아키텍처상 ≤1h 유예 창은 유계·수용 리스크(PII는 이미 삭제됨). 필요 시 후속 SPEC.
- **유예 기간/복구(Undo) 미제공**: 확정 범위 = 즉시 삭제. 소프트 삭제·복원·데이터 다운로드(GDPR data export) 없음.
- **report 감사 장기 보존/이관 제외 [확정 2026-07-02]**: 탈퇴 sub의 report는 대상 계정 소멸로 운영자 조치(REQ-STO-001) 불능이 되므로 별도 보존 테이블 이관 없이 **함께 삭제**한다. 운영자 검토 UI·감사 아카이브·관리자 도구는 별도 SPEC.
- **safety 필터 로직·모더레이션 정책 제외**: 뷰어 측 차단 필터·신고 접수 흐름 자체는 SPEC-SAFETY-001 소관. 본 SPEC은 탈퇴 시 고아 행 정리(정합성)만 담당.
- **탈퇴 사유 수집/분석 미포함**: 설문·리텐션 로깅 없음.
- **관리자용 강제 탈퇴 UI 제외**: 본 SPEC은 사용자 본인 탈퇴만. 어드민 삭제는 별도.
- **투표(poll) 생성자 표시명 UI 변경 없음**: 현재 웹이 poll 생성자명을 렌더링하지 않음(research.md:353-354) — 익명화 표시 대상 아님.

---

관련: 상세 오케스트레이션 순서·리스크 표·MX 태그 계획은 plan.md, 수락 시나리오는 acceptance.md 참조.

---

## 구현 노트 (Implementation Notes)

> 본 섹션은 실제 구현(커밋 `88432e7`, 브랜치 `feature/SPEC-ACCOUNT-001`)과 계획(plan.md, tasks.md) 사이의 주요 발산 사항을 기록한다.

### 1. 마이그레이션 단일 결합 — `20260702200000_add_withdrawn_account`

`WithdrawnAccount` 툼스톤 테이블과 `moim_member.withdrawnAt` 컬럼을 단일 마이그레이션으로 결합 생성했다. 두 변경이 가산적(additive)이라 결합 무결성 문제 없음. dev DB 적용 시 `diff → execute → resolve` 방식으로 처리했다(plan.md의 두 개 별도 마이그레이션 서술과 달라짐).

### 2. `AccountWithdrawnException`(410) — `me.controller.ts` 코드 수정 없음

`profile.service.ts`의 `upsertBySub` 툼스톤 가드에서 `AccountWithdrawnException extends GoneException`(410)을 던지도록 구현했으나, `me.controller.ts` 프로덕션 코드는 수정하지 않았다. NestJS가 `GoneException`을 구조적으로 410 응답으로 변환하므로 컨트롤러 수준의 예외 매핑이 불필요했다(plan의 "me.controller.ts [MODIFY]" 서술은 실 코드와 달라 폐기).

### 3. `transferOwner` — [EXISTING] 재사용 + 활성 멤버 선정 로직 위치 변경

plan §4의 `transferOwner [MODIFY]` 서술(자동 선정 로직 추가 예정)은 실제 구현과 달라 폐기했다. `MoimService.transferOwner(sub, moimId, targetUserId)`는 명시적 target을 받는 기존 시그니처를 그대로 재사용하고, 활성 비-owner 선정 로직(`withdrawnAt: null + joinedAt asc + take 1`)은 `AccountService.deleteAccount` 내부에 위치시켰다(fan_in ANCHOR 미변경, scope discipline 준수).

### 4. SAFETY 선행 확정으로 no-op 가드 폐기 — Prisma 직접 deleteMany

SPEC-SAFETY-001이 선행 배포 확정(§7)됨에 따라 plan 및 REQ-ACCOUNT-001의 "no-op 가드" 분기를 폐기했다. `deleteAccount` 트랜잭션에서 `prisma.block.deleteMany`·`prisma.report.deleteMany`를 직접 호출한다. `SafetyModule`·`BlockService` import 없이 Prisma 직접 접근으로 비순환 계약을 유지했으며(R-15), grep으로 `apps/backend/src/account/**` → SafetyModule/BlockService import 0건 검증 완료.

### 5. `deleteAccountAction` — zero-arg 시그니처

웹 `apps/web/app/(main)/profile/actions.ts`의 `deleteAccountAction`은 인자를 받지 않는 zero-arg 시그니처로 구현했다. Next.js `useActionState` 타입 호환 및 웹 ESLint `no-unused-vars` 경고 회피를 위한 결정이다.

### 6. spec fixture `withdrawnAt: null` 29개 추가

`moim_member` 스키마에 `withdrawnAt` 컬럼이 추가됨에 따라, 전 도메인 spec(jest) fixture의 `MoimMember` 리터럴에 `withdrawnAt: null`을 29개 추가했다. 기계적 추가이며 단언(assertion) 로직은 변경되지 않았다.

### 7. AC-4-2 device-gated 잔여 상세

AC-4-2(iOS 시뮬레이터 WebView 탈퇴 종단)는 session:cleared → SecureStore 토큰 삭제 → sb-* 쿠키 삭제 → 로그인 화면 복귀 전 흐름을 실 기기/시뮬레이터에서 종단 검증해야 한다. 현재 검증 체크리스트 및 진행 상황은 `.moai/specs/SPEC-ACCOUNT-001/progress.md`와 `acceptance.md`에 위치한다. 이 항목이 완료되기 전까지 SPEC status는 `in-progress`를 유지한다.
