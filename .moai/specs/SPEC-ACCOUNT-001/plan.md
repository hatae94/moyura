# Plan — SPEC-ACCOUNT-001 (회원 탈퇴)

> 리서치: [research.md](./research.md) | 인터뷰: [interview.md](./interview.md)
> 형제 SPEC: SPEC-SAFETY-001(신고/차단) — 순환 의존 금지(리스크 R-15).
> **구현 순서 고정 [확정]**: SPEC-SAFETY-001 **선행** + no-op 가드 — 사용자 승인됨(2026-07-02). block/report 테이블 존재가 본 SPEC의 고아 행 정리 전제이며, SAFETY 미배포 상태면 정리 태스크(M2의 block/report deleteMany)는 no-op 가드로 스킵하고, SAFETY 배포 후 활성화한다. **고아 행 정리 소유자 = 본 SPEC(SPEC-ACCOUNT-001)** — 양쪽 plan이 이미 '정리 소유자 = ACCOUNT-001'로 정합 확인됨(SAFETY plan R-10/§9와 동일 방향, 2026-07-02 정합 확인 완료).

## 1. 개요 + 정책 근거

앱 내에서 접근 가능한 회원 탈퇴를 구현한다. 확정 범위: Supabase auth 계정 + PII(profile 행, 이메일 identity, FCM 토큰)를 즉시(유예 없이) 삭제하고, 작성 UGC는 "탈퇴한 사용자"로 익명화하되 다른 멤버를 위한 모임 기록(채팅/일정/정산) 무결성은 보존한다. 탈퇴 성공 후 웹·네이티브 세션을 전면 무효화해 로그인 화면으로 되돌린다.

핵심 설계 결정: **어떤 테이블도 profile.id로의 FK가 없어**(research.md:15-17) profile 행 삭제는 아무것도 캐스케이드하지 않는다. 따라서 탈퇴는 사용자 컬럼 보유 테이블을 명시적으로 순회하는 **오케스트레이션**이어야 한다. auth.users는 Supabase 관리 영역이라 Prisma 트랜잭션에 포함할 수 없으므로(research.md:142), "앱 데이터 정리(멱등 트랜잭션) → auth 계정 삭제(Admin API)" 순서로 설계해 중간 실패 시 재실행 가능하게 한다.

### 스토어 요건 → 설계 매핑

| 스토어 요건 | 설계 대응 | REQ |
|---|---|---|
| Apple 5.1.1(v) — 앱 내 계정 삭제 제공 | profile 설정 화면에 "회원 탈퇴" 진입점 + 파괴적 확인 단계 | REQ-ACCOUNT-005 |
| Google Play — 앱 내/웹 계정 삭제 제공 | `(main)/profile` 은 웹·모바일 WebView 공유 표면(research.md:72) — 단일 구현이 양 표면 커버 | REQ-ACCOUNT-005 |
| 계정·PII 즉시 삭제 | auth.users(Admin API) + profile + device_token + notification 삭제 | REQ-ACCOUNT-001 |
| 삭제 후 재접근/부활 차단 | withdrawn 툼스톤으로 GET /me(`upsertBySub`)의 profile 부활 차단 | REQ-ACCOUNT-003 |
| 삭제 후 세션 종료 | 웹 signOut + 네이티브 브리지(SecureStore/쿠키) 정리 → 로그인 화면 | REQ-ACCOUNT-004 |
| 다른 멤버 기록 무결성 보존 | UGC 행은 삭제하지 않고 표시명만 "탈퇴한 사용자"로 익명화 + owner 고아화 방지 | REQ-ACCOUNT-001/002 |

## 2. EARS 요구사항 설계 (모듈 5개)

### REQ-ACCOUNT-001 [Event-driven] — 탈퇴 오케스트레이션 + PII 삭제 + UGC 익명화
When 인증된 사용자가 탈퇴 확인을 제출하면, the system shall (1) 소유 모임을 처리(REQ-ACCOUNT-002)한 뒤, (2) 단일 Prisma 트랜잭션으로 PII를 삭제(profile 행, `device_token` by `userId` 벌크, `notification` by `recipientId`, 본인 발행 `moim_invite` by `createdBy`)하고, safety 고아 행을 정리(`block` where blockerId OR blockedUserId = sub, `report` where reporterId OR targetUserId = sub — **Prisma 직접 접근**, SafetyModule import 금지)하며, UGC를 익명화(`moim_member.nickname` → "탈퇴한 사용자")하고 withdrawn 툼스톤을 기록하고, (3) Supabase Admin Client로 `auth.admin.deleteUser(sub)`를 호출해야 한다. (2)는 멱등해야 하며 (3) 실패 시 재실행으로 복구 가능해야 한다. UGC 원장 행(`chat_message`, `schedule_slot`, `expense`, `settlement`, `poll_vote`)은 삭제하지 않는다. safety 테이블 정리는 SPEC-SAFETY-001 배포를 전제로 하며, 미존재 시 no-op 가드로 스킵한다(구현 순서 = SAFETY 선행).

### REQ-ACCOUNT-002 [Event-driven / Unwanted] — 모임 소유자 고아화 방지
When 탈퇴 확인이 제출되고 탈퇴 사용자가 어떤 모임의 owner이면, the system shall 각 소유 모임에 대해 다음을 수행해야 한다: (a) **활성(비탈퇴, `withdrawnAt: null`) 비-owner 멤버가 존재하면** 소유권을 **활성 멤버 중 가장 오래된 비-owner**에게 강제 이양(선정·존재 판정 모두 `withdrawnAt: null` 필터 적용 — 이미 탈퇴 마킹된 유령 멤버는 이양 대상에서 제외), (b) 탈퇴 사용자가 유일한 활성 멤버(잔여 멤버가 없거나 전원 탈퇴 마킹)이면 해당 모임을 삭제(FK Cascade). The system shall **접근 가능한(활성) owner가 없는 모임을 남기지 않아야** 한다(Unwanted) — 유령 멤버로의 이양은 접근 불가 owner를 남기므로 금지.

### REQ-ACCOUNT-003 [Unwanted] — 프로필 부활 차단(툼스톤)
If 탈퇴한 sub가 JWT 유예 창(`jwt_expiry=3600`, research.md:308) 내에 `GET /me`(`upsertBySub`)를 호출하면, then the system shall Profile 행을 재생성하지 않고(withdrawn 툼스톤 조회) 계정 소멸 응답(401/410)을 반환해야 한다. The system shall 삭제된 계정의 PII가 후속 요청으로 되살아나지 않도록 보장해야 한다.

### REQ-ACCOUNT-004 [Event-driven] — 세션 무효화(웹 + 네이티브)
When 탈퇴가 성공하면, the system shall 웹에서 `supabase.auth.signOut()` 후 `/login`으로 리다이렉트하고, 모바일 WebView에서는 기존 로그아웃 브리지(`session:cleared`)를 재사용해 네이티브가 SecureStore access/refresh 토큰과 WKHTTPCookieStore `sb-*` 쿠키를 삭제하고 로그인 화면으로 복귀하도록 해야 한다.

### REQ-ACCOUNT-005 [Ubiquitous / Event-driven] — 설정 진입점 + 파괴적 확인
The system shall `(main)/profile` 설정 화면에 "회원 탈퇴" 진입점을 제공해야 한다(Ubiquitous). When 사용자가 이를 선택하면, the system shall 파괴적·불가역 액션 확인 단계를 거친 뒤에만 탈퇴 서버 액션을 호출해야 한다(Event-driven).

## 3. 기술 설계

### 3.1 DB 스키마 (전부 additive/비파괴 — research.md:120)

**[NEW] `withdrawn_account` 테이블** — 계정 소멸 툼스톤(부활 차단의 진실 공급원):
```prisma
model WithdrawnAccount {
  sub         String   @id            // 삭제된 Supabase sub(= 구 profile.id). auth 재가입 시 새 sub 발급되므로 충돌 없음
  withdrawnAt DateTime @default(now())
  @@map("withdrawn_account")
}
```
- FK 없음(profile 행은 이미 삭제됨). PK만으로 존재 여부 조회.
- RLS: `ENABLE ROW LEVEL SECURITY` + 정책 없음(default deny) — Prisma는 postgres 롤로 우회(research.md:44, :121 패턴).

**[MODIFY] `moim_member`** — 정원 계산에서 탈퇴 멤버 제외용 nullable 마커 추가:
```prisma
withdrawnAt DateTime?   // 신규 nullable 컬럼(기존 행 무영향). NULL = 활성 멤버
```
- `nickname`은 스키마 변경 없이 값만 UPDATE("탈퇴한 사용자"). 행/복합 PK/인덱스 불변.
- FK/인덱스/realtime 영향 없음(컬럼 추가만).

**삭제·수정 대상 데이터 (마이그레이션 아님 — 런타임 오케스트레이션)**:
- DELETE: `profile`(id=sub), `device_token`(userId=sub, 벌크), `notification`(recipientId=sub), `moim_invite`(createdBy=sub)
- DELETE (safety 고아 정리 — SAFETY 배포 시): `block`(blockerId=sub OR blockedUserId=sub), `report`(reporterId=sub OR targetUserId=sub). **Prisma 직접 접근**(`prisma.block`/`prisma.report`)으로 정리 — SafetyModule/`BlockService`를 import하지 않아 순환 의존 미발생(R-15). SAFETY 미배포로 테이블이 없으면 no-op 가드로 스킵. report는 대상 계정이 이미 소멸돼 운영자 조치(REQ-STO-001) 불능이 되므로 감사 보존 대신 정리 선택(감사 보존 tradeoff는 §9 문서화).
- UPDATE: `moim_member`(userId=sub) → `nickname='탈퇴한 사용자'`, `withdrawnAt=now()`, `role`은 이양 후 'member'
- INSERT: `withdrawn_account`(sub)
- 불변(보존): `chat_message`, `schedule_event`/`schedule_slot`, `expense`/`expense_share`/`settlement`, `settlement_request`, `poll`/`poll_vote` — 다른 멤버의 원장·기록(research.md:168)

**realtime 영향**: 신규 브로드캐스트 함수/트리거 없음. auth 삭제 후 잔존 JWT의 구독은 Supabase 아키텍처상 유예 창(≤1h) 내 유효할 수 있음(research.md:264, 갭 A-3) — 본 SPEC은 PII 즉시 삭제 + 클라이언트 세션 즉시 정리로 실질 접근을 차단하고, realtime/`assertMember` 하드 회수는 제외 범위로 문서화(§9, 리스크 R-2).

### 3.2 API 설계 (NestJS)

**[NEW] `apps/backend/src/account/` 모듈** (notification.module 구조 준거 — research.md:114):
- `AccountModule` — imports: `AuthModule`(가드), `MoimModule`(소유권 이양/삭제 재사용을 위해 `MoimService` 주입). `PrismaService`는 글로벌.
- `AccountController` — `DELETE /me/account`, 클래스 레벨 `@UseGuards(SupabaseAuthGuard)`. 탈퇴 대상은 **가드 검증 `user.sub`만** 사용(body의 userId 금지 — research.md:116). 성공 시 204.
- `AccountService.deleteAccount(sub)` — 오케스트레이션 진입점(아래 순서).
- `SupabaseAdminClient`(신규 얇은 래퍼) — `@supabase/supabase-js`의 `createClient(url, serviceRoleKey, { auth: { persistSession: false } })`로 `auth.admin.deleteUser(sub)` 호출. **인터페이스로 추상화해 jest mock 가능**(research.md:172).

**오케스트레이션 순서** (`AccountService.deleteAccount(sub)`):
1. **사전 검증** — 사용자가 owner인 모임 조회(`moim_member` where role='owner'). 각 모임에 대해 **활성 비-owner 멤버**(`moim_member` where moimId, role≠'owner', `withdrawnAt: null`)를 조회:
   - 활성 비-owner 멤버 ≥1 → 소유권을 **가장 오래된 활성 비-owner 멤버**에게 이양. **[HARD] 이양 대상 선정 쿼리에 `withdrawnAt: null` 필수** — 유령(탈퇴 마킹) 멤버가 새 owner로 선정되면 REQ-ACCOUNT-002 Unwanted 위반. `MoimService.transferOwner`가 내부에서 "가장 오래된 비-owner"를 자동 선정하므로, 그 선정 쿼리도 `withdrawnAt: null`을 반영해야 함(transferOwner 선정 조건 확장 = [MODIFY], §4 델타 참조) — 또는 account가 활성 대상을 사전 선정해 전달.
   - 활성 비-owner 멤버 0 (잔여 멤버 없음 **또는 전원 탈퇴 마킹**) → `MoimService.deleteMoim`(Cascade). '유일 멤버' 판정은 반드시 활성 멤버 카운트 기준(유령 포함 카운트 금지 — 유령 이양 방지). — REQ-ACCOUNT-002.
2. **앱 데이터 정리(단일 `$transaction`, 멱등)** — `moimMember.updateMany`(익명화+withdrawnAt+role), `deviceToken.deleteMany({ userId: sub })`, `notification.deleteMany({ recipientId: sub })`, `moimInvite.deleteMany({ createdBy: sub })`, (SAFETY 배포 시) `block.deleteMany({ OR: [{ blockerId: sub }, { blockedUserId: sub }] })` + `report.deleteMany({ OR: [{ reporterId: sub }, { targetUserId: sub }] })`(Prisma 직접 접근, import 없음), `withdrawnAccount.upsert({ sub })`, `profile.deleteMany({ id: sub })`. 전부 `deleteMany`/`updateMany`/`upsert`라 재실행 시 count 0/멱등(P2025 없음). safety 정리는 테이블 부재 시 no-op 가드로 스킵(SAFETY 선행 순서). — REQ-ACCOUNT-001.
3. **auth 계정 삭제** — `SupabaseAdminClient.deleteUser(sub)`. 트랜잭션 밖. 실패해도 (2)의 툼스톤이 이미 계정을 무력화(부활 차단) → 재호출로 복구. — REQ-ACCOUNT-001.

**[MODIFY] `profile.service.ts` `upsertBySub`** — 툼스톤 선조회로 부활 차단(REQ-ACCOUNT-003):
- `withdrawn_account`에 sub가 있으면 profile을 upsert하지 않고 신호(예: `null` 반환 또는 도메인 예외) → `me.controller.ts`가 401/410으로 변환. @MX:ANCHOR 계약 확장(기존 upsert 단일 진입점 불변식 유지).

**[MODIFY] `invite.service.ts:152` 정원 count** — `where: { moimId, withdrawnAt: null }`로 탈퇴 멤버 제외(gap B-6, research.md:388-391). 최소 수정.

**[MODIFY] `env.validation.ts`** — `SUPABASE_SERVICE_ROLE_KEY: z.string().optional()` 추가. FIREBASE_CREDENTIALS 패턴(optional + 소비 지점 graceful)을 따르되, 계정 삭제 시 부재면 명시적 500(자격증명 없이는 삭제 불가). `SUPABASE_URL`은 이미 required(env.validation.ts:37).

### 3.3 웹 UI 변경 (component-level)

- **[NEW] `apps/web/app/(main)/profile/account-deletion.tsx`** (client) — profile/page.tsx의 로그아웃 버튼(page.tsx:65-72) 아래 배치. "회원 탈퇴" 버튼 → 파괴적 확인 UI(불가역 경고 명시) → 확인 시 `deleteAccountAction` 호출. `useActionState` 패턴(profile-form.tsx 준거).
- **[MODIFY] `apps/web/app/(main)/profile/actions.ts`** — `deleteAccountAction()` 추가(기존 `updateProfileAction` 패턴 준거, actions.ts:26-58): 세션 쿠키에서 Bearer 획득 → api-client로 `DELETE /me/account` → 성공 시 `supabase.auth.signOut()` + `redirect("/login")`(로그아웃 경로 재사용, actions.ts:197-202 패턴). 실패 시 일반화 오류(자격증명 비노출).
- **[MODIFY] `apps/web/app/(main)/profile/page.tsx`** — `<AccountDeletion />` 마운트(로그아웃 버튼 아래).
- **React Query 캐시**: profile 화면은 서버 컴포넌트 + 서버 액션(React Query 미사용). 탈퇴 성공은 즉시 `/login` 리다이렉트로 수렴하므로 클라이언트 캐시 무효화 대상 없음. (기존 로그아웃과 동일 — 별도 invalidation 불필요.)
- **[REGEN] `apps/backend/openapi.json`, `packages/api-client/src/schema.d.ts`** — `DELETE /me/account` 노출.

### 3.4 모바일 브리지 영향

- **신규 브리지 메시지 없음**(최소 변경 — research.md:170). 탈퇴 성공 → 웹이 `/login` 리다이렉트 → 기존 `LogoutBridgeNotifier`가 `session:cleared` 발신(bridge-client.ts:346-352) → 네이티브가 SecureStore 토큰 삭제 + WKHTTPCookieStore `sb-*` 쿠키 삭제 + 상태 리셋(로그아웃과 동일 경로, research.md:88). 별도 `account:deleted` 타입은 네이티브 동작이 로그아웃과 동일하므로 불필요.
- FCM 토큰: 클라이언트 `unregisterDevice()`는 best-effort이므로 신뢰하지 않고 서버 측 `deviceToken.deleteMany({ userId: sub })`가 최종 보장(research.md:171).

## 4. 델타 마커 (모듈별)

| 모듈 | 대상 | 마커 |
|---|---|---|
| REQ-ACCOUNT-001 | `apps/backend/src/account/**`(module/controller/service/admin-client; safety 고아 정리 `prisma.block`/`prisma.report` 직접 deleteMany, SAFETY 배포 시, import 없음, 미배포 no-op 가드 포함) | [NEW] |
| REQ-ACCOUNT-001 | `schema.prisma`(WithdrawnAccount 모델 + moim_member.withdrawnAt) | [MODIFY] |
| REQ-ACCOUNT-001 | `migrations/<ts>_add_withdrawn_account` | [NEW] |
| REQ-ACCOUNT-001 | `apps/backend/src/config/env.validation.ts`(SUPABASE_SERVICE_ROLE_KEY) | [MODIFY] |
| REQ-ACCOUNT-001 | `apps/backend/src/app.module.ts`(AccountModule 등록) | [MODIFY] |
| REQ-ACCOUNT-002 | `MoimService.deleteMoim` 재사용(호출) | [EXISTING] |
| REQ-ACCOUNT-002 | `MoimService.transferOwner` 비-owner 선정 쿼리에 `withdrawnAt: null` 가드(유령 이양 방지) — 또는 account가 활성 대상 사전 선정·전달 | [MODIFY] |
| REQ-ACCOUNT-002/quota | `invite.service.ts:152` count 필터(`withdrawnAt: null`, moim_member.withdrawnAt 소비) | [MODIFY] |
| REQ-ACCOUNT-003 | `profile.service.ts`(upsertBySub 툼스톤) + `me.controller.ts`(응답) | [MODIFY] |
| REQ-ACCOUNT-004 | `LogoutBridgeNotifier` / `session:cleared` 경로 | [EXISTING] |
| REQ-ACCOUNT-004 | `apps/web/app/(main)/profile/actions.ts`(deleteAccountAction) | [MODIFY] |
| REQ-ACCOUNT-005 | `apps/web/app/(main)/profile/account-deletion.tsx` | [NEW] |
| REQ-ACCOUNT-005 | `apps/web/app/(main)/profile/page.tsx`(마운트) | [MODIFY] |
| 계약 | `openapi.json` / `packages/api-client/src/schema.d.ts` | [REGEN] |

## 5. 태스크 분해 (run 단계 — TDD: 백엔드 jest test-first / 웹은 build·lint 검증만)

### M1 — withdrawn 툼스톤 + 부활 차단 (RED → GREEN)
- `schema.prisma`에 `WithdrawnAccount` 추가 → `prisma migrate dev --name add_withdrawn_account`
- `profile.service.spec.ts`: 툼스톤 존재 시 upsertBySub가 profile을 재생성하지 않음(부활 차단) RED → GREEN
- `me.controller.ts` 계정 소멸 응답(401/410) 단위 테스트

### M2 — 삭제 오케스트레이션 서비스 (RED → GREEN)
- `SupabaseAdminClient` 인터페이스 + 구현(mock 가능하게 추상화)
- `account.service.spec.ts`(fake Prisma — notification.service.spec.ts 패턴, research.md:124): 각 테이블 mock의 `deleteMany`/`updateMany`/`upsert` 호출을 개별 검증(device_token by userId, notification by recipientId, moim_invite by createdBy, moim_member 익명화, withdrawn upsert, profile 삭제), Admin Client `deleteUser(sub)` 호출 검증, 멱등 재실행 검증
- safety 고아 정리 검증: `prisma.block.deleteMany({OR:[{blockerId:sub},{blockedUserId:sub}]})` + `prisma.report.deleteMany({OR:[{reporterId:sub},{targetUserId:sub}]})` 호출을 mock으로 검증(직접 접근 — SafetyModule/BlockService import 없음: safety→account 순환 미발생 grep 정적 검사). SAFETY 미배포 no-op 가드 경로 검증
- `moim_member.withdrawnAt` 추가 → 동일 마이그레이션 또는 `add_moim_member_withdrawn_at`

### M3 — 소유자 고아화 방지 (RED → GREEN)
- `account.service.spec.ts`: owner + **활성** 타 멤버(`withdrawnAt: null`) → `transferOwner` 호출(활성 대상) 검증 / 유일 활성 멤버 owner → `deleteMoim` 호출 검증 / 다중 owner 모임 순회
- **[RED] 유령 이양 방지 케이스**: 잔여 비-owner 멤버가 **전원 탈퇴 마킹**(withdrawnAt≠null)인 모임 → `transferOwner` 아닌 `deleteMoim` 호출 검증(유령 멤버로 이양 금지). 활성 1 + 유령 N 혼재 시 → 활성 멤버가 이양 대상으로 선정되는지 검증.
- 존재 판정·이양 대상 선정 쿼리에 `withdrawnAt: null` 반영 검증(유령 카운트 배제). `transferOwner` 선정 조건이 유령을 제외하도록 배선(선정 쿼리 `withdrawnAt: null` 가드 또는 account 사전 선정 대상 전달).
- `MoimService` 주입 배선(AccountModule imports MoimModule)

### M4 — 컨트롤러 + env + 정원 필터 (RED → GREEN)
- `DELETE /me/account` 컨트롤러(가드, sub만 사용) 단위 테스트
- `env.validation.ts` `SUPABASE_SERVICE_ROLE_KEY` 추가 + 부재 시 삭제 500 테스트
- `invite.service.ts:152` count 필터(`withdrawnAt: null`) — 탈퇴 멤버 제외 정원 테스트(회귀)
- `app.module.ts` 등록, `nx lint backend` 통과, 백엔드 85%+

### M5 — 웹 UI + 계약 재생성 (build·lint 검증만 — 웹 테스트 태스크 없음)
- `account-deletion.tsx`(확인 UI) + `deleteAccountAction`(actions.ts) + page.tsx 마운트
- openapi → api-client 재생성
- `nx build web` + `nx lint web` (테스트 프레임워크 부재 — 빌드/린트로 검증)

### M6 — 디바이스·통합 검증 (수동 게이트)
- iOS 시뮬레이터 WebView에서 /profile 탈퇴 → auth 삭제 → `session:cleared` → SecureStore/쿠키 정리 → 로그인 화면 복귀 종단 검증
- 로컬 Supabase에서 service-role 키로 `auth.admin.deleteUser` 실동작 확인 → **이 검증 전까지 in-progress 유지**

## 6. 참조 구현 (Reference)

- Reference: `apps/backend/src/moim/moim.service.ts:227-277` — `transferOwner`(원자 트랜잭션, createdBy 불변) 재사용
- Reference: `apps/backend/src/moim/moim.service.ts:281-284` — `deleteMoim`(assertOwner + Cascade) 재사용
- Reference: `apps/backend/src/moim/moim.service.ts:145-161` — owner 탈퇴 = 모임 삭제 계약(고아화 방지 근거)
- Reference: `apps/backend/src/push/device-token.service.ts:40-44` — `deleteMany` 멱등 벌크 삭제 패턴(userId 조건)
- Reference: `apps/backend/src/profile/profile.service.ts:21-29` — `upsertBySub` @MX:ANCHOR(툼스톤 가드 삽입 지점)
- Reference: `apps/backend/src/invite/invite.service.ts:152-158` — 정원 count(withdrawnAt 필터 삽입 지점)
- Reference: `apps/backend/src/config/env.validation.ts:44-49` — optional env(FIREBASE_CREDENTIALS) 패턴 → SUPABASE_SERVICE_ROLE_KEY
- Reference: `apps/backend/src/notification/notification.service.spec.ts:17-199` — fake Prisma 다중 테이블 삭제 검증 패턴
- Reference: `apps/web/app/(main)/profile/actions.ts:26-58` — 서버 액션(Bearer 획득 + api-client + 일반화 오류) 패턴
- Reference: `apps/web/app/(main)/profile/page.tsx:65-72` — 로그아웃 버튼(탈퇴 진입점 배치 위치)
- Reference: `apps/web/lib/auth/actions.ts:197-202` — signOut + redirect("/login") 경로(탈퇴 후 재사용)
- Reference: `apps/web/lib/native-bridge/bridge-client.ts:346-352` — `session:cleared` 네이티브 통지(로그아웃 재사용)
- Reference: `apps/backend/src/auth/token-verifier.service.ts:87-121` — 오프라인 JWT 검증(auth.users 미조회 → 유예 창 근거, R-2)
- Reference (선행/형제): `.moai/specs/SPEC-SAFETY-001/` — `block`/`report` 스키마 출처(정리 대상 컬럼: block.blockerId/blockedUserId, report.reporterId/targetUserId). 정리 소유자 = 본 SPEC(Prisma 직접 접근, import 금지 → 순환 의존 미발생, R-15). SAFETY 선행 배포 전제

## 7. 리스크 분석 및 완화

| # | 리스크 | 완화 |
|---|---|---|
| R-1 | 원자성 부재(auth 삭제와 앱 데이터 삭제가 다른 트랜잭션 — research.md:142) | 앱 데이터 정리(멱등)를 먼저, auth 삭제를 마지막에. (2) 성공 후 (3) 실패 시 툼스톤이 계정을 이미 무력화 → 재호출로 복구 |
| R-2 | JWT 유예 창(≤1h) 내 잔존 토큰 접근(research.md gap A) | 즉시 완화: PII 삭제 + 툼스톤(부활 차단) + 클라이언트 세션 즉시 정리(웹/네이티브). realtime/assertMember 하드 회수는 제외 범위(§9) — 잔존 창은 PII 누출 없는 유계·수용 리스크로 문서화 |
| R-3 | 프로필 부활(GET /me upsertBySub가 정상 플로우로 재생성 — research.md:234) | 툼스톤 선조회로 upsertBySub 차단(REQ-ACCOUNT-003) — 정상 WebView 네비게이션에서도 부활 불가 |
| R-4 | 모임 owner 고아화(위임 강제 로직 부재 — research.md:51) | 사전 검증 단계에서 transferOwner(**활성** 타 멤버) / deleteMoim(유일 활성 멤버) 강제(REQ-ACCOUNT-002) |
| R-4b | **유령 멤버 이양**(멤버 행 보존으로 탈퇴 마킹 멤버가 새 owner로 선정 → 접근 불가 owner 잔존, REQ-ACCOUNT-002 자체 위반) | 존재 판정·이양 대상 선정 쿼리 **모두** `withdrawnAt: null` 필터. transferOwner 선정 조건이 유령 제외하도록 배선(선정 쿼리 가드 또는 활성 대상 사전 선정 전달). owner+유령만 남은 모임은 deleteMoim 경로. M3 RED 케이스로 커버 |
| R-5 | 고아 device_token 잔존 → 탈퇴 기기에 푸시(research.md:143) | 서버 측 `deviceToken.deleteMany({ userId: sub })`를 트랜잭션에 포함(클라이언트 unregister 신뢰 안 함) |
| R-6 | 정원 의미 왜곡(행 보존 시 탈퇴자 카운트 — research.md:391) | `moim_member.withdrawnAt` nullable 마커 + count 필터(withdrawnAt: null) |
| R-7 | 재가입 닉네임 충돌(gap B-7) | auth 재가입 시 새 sub 발급 → 새 moim_member 행. 구 "탈퇴한 사용자" 행(구 sub)과 복합 PK 미충돌 — 충돌 소멸 |
| R-8 | service-role 키 유출 시 전 계정 삭제 가능(고위험 자격증명) | 키는 env/secret로만(커밋 금지), Admin Client는 account 모듈 내부에만, 삭제 대상은 가드 검증 sub로 한정(임의 uuid 불가) |
| R-9 | 삭제 중 트리거 레이스(broadcast_*가 삭제된 user_id 참조 — research.md:147) | 브로드캐스트 트리거는 BEGIN…EXCEPTION…END best-effort라 실패 안 함. 앱 데이터 정리를 단일 트랜잭션으로 묶어 창 최소화 |
| R-10 | 로그아웃 통지 레이스(서버 redirect가 클라 통지보다 선행 — research.md:148) | 기존 로그아웃과 동일 리스크 상속. 네이티브 측 유계 재시도(R-N6) 방어선 재사용 — 신규 리스크 아님 |
| R-15 | account↔safety 순환 의존(research.md:154) | safety 고아 행 정리 소유자를 **본 SPEC으로 확정**하되 `SafetyModule`/`BlockService` import 대신 **Prisma 직접 접근**(`prisma.block`/`prisma.report`)으로 정리 → account가 safety 모듈을 참조하지 않아 순환 미발생. safety→account import도 없음(grep 정적 검사). EventEmitter 불필요 |
| R-16 | **정리 소유권 상호 위임 커버리지 홀**(SAFETY R-10/§9는 ACCOUNT 위임, 구 ACCOUNT §9는 SAFETY 위임 → 양쪽 미구현 시 고아 행 영구 잔존, report.targetUserId가 삭제 sub 지목해 REQ-STO-001 운영자 조치 불능) | **[해소 2026-07-02]** 소유권을 ACCOUNT로 일방 확정(§3.2/§9). 양쪽 plan이 이미 '정리 소유자 = ACCOUNT-001'로 정합 확인 완료 — 상호 위임 홀 닫힘 |
| R-17 | **테이블 부재 순서 리스크**(SAFETY 미배포 시 block/report 없음 → deleteMany 실패) | 구현 순서 SAFETY 선행 고정 + no-op 가드(테이블/모델 미존재 시 스킵). SAFETY 배포 후 정리 태스크 활성화 |

## 8. MX 태그 계획 (mx_plan)

- `@MX:ANCHOR` (+ `@MX:REASON`) — `AccountService.deleteAccount(sub)`: 탈퇴 오케스트레이션 단일 진입점(컨트롤러 + 향후 관리자 삭제가 의존). 불변식: 앱 데이터 정리(멱등)가 auth 삭제보다 선행, 삭제 대상은 가드 검증 sub만.
- `@MX:WARN` (+ `@MX:REASON`) — `SupabaseAdminClient.deleteUser`: service-role 권한 외부 호출 — 키 유출 시 전 계정 삭제 가능, sub 검증 없이 호출 금지.
- `@MX:ANCHOR` (기존 확장) — `profile.service.ts:5` upsertBySub 계약에 "withdrawn 툼스톤이면 부활 금지" 불변식 추가(부활 차단의 단일 출처).
- `@MX:NOTE` — `AccountService` 소유권 이양/삭제가 `MoimService.transferOwner`/`deleteMoim`(@MX:ANCHOR)를 재사용하는 의존 지점. **불변식: 이양 대상·존재 판정 모두 `withdrawnAt: null`(활성 멤버)만 — 유령 이양 금지**(R-4b).
- `@MX:NOTE` — `account.service` safety 고아 정리(`prisma.block`/`prisma.report` 직접 deleteMany): `SafetyModule`/`BlockService`를 import하지 않는다는 비순환 계약(R-15). safety 테이블 부재 시 no-op 가드.
- `@MX:NOTE` — `invite.service.ts:152` count의 `withdrawnAt: null` 필터: 정원=활성 멤버 의미 유지 이유.
- `@MX:NOTE` — `env.validation.ts` `SUPABASE_SERVICE_ROLE_KEY`(기존 @MX:ANCHOR 스키마 확장) + graceful/500 정책.

## 9. 제외 범위 (What NOT to Build)

- **UGC 원장 행 삭제 금지**: `chat_message`, `schedule_event`/`schedule_slot`, `expense`/`expense_share`/`settlement`, `settlement_request`, `poll`/`poll_vote`는 다른 멤버의 기록이므로 삭제하지 않고 표시명만 익명화한다(무결성 보존).
- **JWT 하드 회수(즉시 무효화) 제외**: 가드 레벨 auth.users 존재 검증, 토큰 denylist/블랙리스트, realtime RLS 정책에 툼스톤 게이트 추가는 본 SPEC 범위 밖. Supabase 오프라인 검증 아키텍처상 ≤1h 유예 창은 유계·수용 리스크로 문서화(PII는 이미 삭제됨). 필요 시 후속 SPEC.
- **유예 기간/복구(Undo) 미제공**: 확정 범위 = 즉시 삭제. 소프트 삭제·복원·다운로드(GDPR data export) 없음.
- **신고/차단 고아 행 정리는 본 SPEC 소관(포함)**: 탈퇴 sub의 `block`(blocker/blocked 양측)·`report`(reporter/target 양측) 행을 탈퇴 트랜잭션에서 Prisma 직접 접근으로 정리한다(§3.2 (2)). SAFETY 배포 전제(no-op 가드). ※ SAFETY plan(R-10/§9)의 "정리는 ACCOUNT 위임" 문구와 방향 일치 확인 완료(2026-07-02, 양쪽 plan 정합). 단, **운영자 검토 UI / report 감사 장기 보존은 제외**: report 행은 정리(대상 계정 소멸로 조치 불능)하며 감사 아카이브·관리자 도구는 별도 SPEC.
- **safety 필터 로직·모더레이션 정책 제외**: 뷰어 측 차단 필터·신고 접수 흐름 자체는 SPEC-SAFETY-001 소관. 본 SPEC은 탈퇴 시 고아 행 정리(정합성)만 담당.
- **탈퇴 사유 수집/분석 미포함**: 설문·리텐션 로깅 없음.
- **관리자용 강제 탈퇴 UI 제외**: 본 SPEC은 사용자 본인 탈퇴만. 어드민 삭제는 별도.
- **투표(poll) 생성자 표시명 UI 변경 없음**: 현재 웹이 poll 생성자명을 렌더링하지 않음(research.md:353-354) — 익명화 표시 대상 아님.

## 10. 열린 질문 → 확정 결정 (사용자 승인 2026-07-02)

> 아래 3개 항목은 사용자 승인으로 모두 **해소**됨. 확정 결정을 기록으로 남긴다.

1. **[해소] 정리 소유권 방향 정렬(교차 SPEC 일관성)**: safety 고아 행 정리 소유자를 **SPEC-ACCOUNT-001로 확정**(§3.2/§9, R-15/R-16). 양쪽 plan(ACCOUNT §3.2/§9, SAFETY R-10/§9)이 이미 '정리 소유자 = ACCOUNT-001'로 정합 확인됨(2026-07-02). 상호 위임 커버리지 홀 닫힘 — 추가 확인 불필요.
2. **[해소] 구현 순서 고정**: SPEC-SAFETY-001 **선행** + no-op 가드 승인됨(2026-07-02). SAFETY 배포 전에는 정리 태스크(block/report deleteMany)를 no-op 가드로 스킵하고, SAFETY 배포 후 활성화한다(헤더/R-17 확정 표기).
3. **[해소] report 감사 보존 vs 정리 tradeoff**: **함께 삭제(정리)로 확정**(2026-07-02) — 보존 테이블 이관 없음. 탈퇴 대상 report는 대상 계정 소멸로 운영자 조치(REQ-STO-001)가 불능이 되므로 정리(삭제)를 택하며, 별도 감사 아카이브 후속 SPEC은 만들지 않는다(현 플랜 유지).

## 11. 사용 라이브러리 (production-stable only)

- **신규 의존성 0** — `@supabase/supabase-js ^2.106.2`(이미 설치, apps/backend/package.json:36)의 `createClient` + `auth.admin.deleteUser`를 service-role 키로 사용. 별도 admin SDK 불필요.
- 기존 재사용: Prisma(`$transaction`/`deleteMany`/`updateMany`), Zod(env 검증), NestJS 가드, `@supabase/ssr`(웹 signOut).
- 신규 env: `SUPABASE_SERVICE_ROLE_KEY`(env/secret 주입, 커밋 금지). `SUPABASE_URL`은 기존 required 재사용.
