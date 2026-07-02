# Acceptance — SPEC-ACCOUNT-001 (회원 탈퇴 / 인앱 계정 삭제)

> REQ↔AC 매핑은 spec.md 각 REQ의 "AC:" 라인 참조. 각 요구사항 모듈(A~E)은 핵심 경로 시나리오를 2개 이상 커버한다.
> 백엔드 시나리오는 fake Prisma 단위 테스트(notification.service.spec.ts 패턴, research.md:124)로 검증한다.

## Given/When/Then 시나리오

### 모듈 A — 탈퇴 오케스트레이션 + PII 삭제 + UGC 익명화

#### AC-1-1 (REQ-ACCOUNT-001) — PII 삭제 + 익명화 + 툼스톤 + auth 삭제 순서
- **Given** 인증된 사용자 sub=U(소유 모임 없음, device_token/notification/moim_invite/moim_member 행 보유)
- **When** 탈퇴 확인이 제출되어 `AccountService.deleteAccount(U)` 실행
- **Then** 단일 트랜잭션에서 `deviceToken.deleteMany({ userId: U })`, `notification.deleteMany({ recipientId: U })`, `moimInvite.deleteMany({ createdBy: U })`, `moimMember.updateMany`(nickname="탈퇴한 사용자" + withdrawnAt=now + role='member'), `withdrawnAccount.upsert({ sub: U })`, `profile.deleteMany({ id: U })`가 각각 호출되고, 그 **뒤에** 트랜잭션 밖에서 Admin Client `deleteUser(U)`가 1회 호출된다(앱 데이터 정리가 auth 삭제보다 선행).

#### AC-1-2 (REQ-ACCOUNT-001) — 멱등 재실행
- **Given** AC-1-1이 1회 완료된 상태(툼스톤 기록됨, profile 삭제됨)
- **When** 동일 sub=U로 `deleteAccount(U)`가 재호출됨(예: auth 삭제 단계에서 이전에 실패)
- **Then** 모든 `deleteMany`/`updateMany`/`upsert`가 count 0 또는 멱등으로 성공하고(P2025 예외 없음) 트랜잭션이 완료되며 `deleteUser(U)`가 다시 호출된다(복구 가능).

#### AC-1-3 (REQ-ACCOUNT-001) — safety 고아 정리 (SAFETY 배포 시 / no-op 가드)
- **Given (배포)** `block`/`report` 테이블 존재 + 탈퇴 sub=U가 block(blocker/blocked)·report(reporter/target) 양측에 등장
- **When** `deleteAccount(U)` 실행
- **Then** `prisma.block.deleteMany({ OR: [{ blockerId: U }, { blockedUserId: U }] })` + `prisma.report.deleteMany({ OR: [{ reporterId: U }, { targetUserId: U }] })`가 호출되고, 소스 정적 검사상 `account`가 `SafetyModule`/`BlockService`를 import하지 않는다(grep 0건 — 비순환).
- **Given (미배포)** SAFETY 미배포로 block/report 모델/테이블 부재
- **When** `deleteAccount(U)` 실행
- **Then** no-op 가드로 safety 정리를 스킵하고 나머지 정리·삭제는 정상 완료된다(예외 없음).

#### AC-1-4 (REQ-ACCOUNT-001b) — 원장 행 삭제 금지
- **Given** 탈퇴 sub=U가 `chat_message`/`schedule_slot`/`expense`/`settlement`/`poll_vote` 행을 보유
- **When** `deleteAccount(U)` 실행
- **Then** 위 원장 테이블에 대한 delete 호출이 **발생하지 않으며**(mock에 delete 미기록), 표시명 익명화(`moim_member.nickname`)만 수행된다.

### 모듈 B — 모임 소유자 고아화 방지

#### AC-2-1 (REQ-ACCOUNT-002) — 활성 타 멤버 존재 시 소유권 이양
- **Given** 탈퇴 사용자 U가 owner인 모임 M에 활성(withdrawnAt: null) 비-owner 멤버 V가 존재
- **When** `deleteAccount(U)`의 사전 검증 단계 실행
- **Then** `MoimService.transferOwner`가 호출되어 소유권이 활성 멤버 V(가장 오래된 활성 비-owner)에게 이양되고, 이후 U의 moim_member 행은 익명화·탈퇴 마킹된다.

#### AC-2-2 (REQ-ACCOUNT-002) — 유일 활성 멤버 owner 모임 삭제
- **Given** 탈퇴 사용자 U가 owner인 모임 M에 다른 활성 멤버가 없음(잔여 멤버 0 또는 전원 탈퇴 마킹)
- **When** `deleteAccount(U)`의 사전 검증 단계 실행
- **Then** `MoimService.deleteMoim(M)`이 호출되어 모임이 Cascade 삭제된다(transferOwner 미호출).

#### AC-2-3 (REQ-ACCOUNT-002b) — 유령 이양 금지 (활성 카운트 기준)
- **Given** 모임 M에 owner U + 비-owner 멤버 전원이 이미 탈퇴 마킹(withdrawnAt≠null)인 유령 멤버만 존재
- **When** `deleteAccount(U)` 실행
- **Then** 유령 멤버로의 `transferOwner`가 **호출되지 않고** `deleteMoim(M)`이 호출된다. 활성 1명 + 유령 N명 혼재 시에는 **활성 멤버**가 이양 대상으로 선정된다(선정 쿼리에 `withdrawnAt: null` 반영).

### 모듈 C — 프로필 부활 차단

#### AC-3-1 (REQ-ACCOUNT-003) — 툼스톤으로 upsertBySub 차단
- **Given** 탈퇴 sub=U의 withdrawn 툼스톤이 기록됨(profile 행은 삭제됨)
- **When** 잔존 토큰으로 `GET /me` → `upsertBySub(U)` 호출
- **Then** 툼스톤 선조회로 Profile 행을 재생성하지 않고 신호(null/도메인 예외)를 반환하며, `me.controller.ts`가 계정 소멸 응답(401 또는 410)으로 변환한다.

#### AC-3-2 (REQ-ACCOUNT-003) — 정상 사용자 부활 미영향(회귀)
- **Given** 툼스톤이 없는 정상 sub=W
- **When** 첫 `GET /me` → `upsertBySub(W)` 호출
- **Then** 기존과 동일하게 Profile 행이 upsert(생성/조회)된다 — 툼스톤 가드가 정상 플로우를 저해하지 않음.

### 모듈 D — 세션 무효화 (웹 + 네이티브)

#### AC-4-1 (REQ-ACCOUNT-004) — 웹 signOut + /login 리다이렉트
- **Given** 웹 `(main)/profile`에서 탈퇴 확인 완료, `DELETE /me/account`가 204 성공
- **When** `deleteAccountAction`이 응답을 처리
- **Then** `supabase.auth.signOut()` 후 `redirect("/login")`이 수행된다(로그아웃 경로 재사용). 실패 시 자격증명 비노출 일반화 오류.

#### AC-4-2 (REQ-ACCOUNT-004, 디바이스 게이트) — 네이티브 세션 정리 후 로그인 복귀
- **Given** iOS 시뮬레이터 WebView에서 로그인 상태, /profile 탈퇴 성공 → 웹이 `/login`으로 리다이렉트
- **When** 기존 `LogoutBridgeNotifier`가 `session:cleared`를 발신
- **Then** 네이티브가 SecureStore access/refresh 토큰 삭제 + WKHTTPCookieStore `sb-*` 쿠키 삭제 + 상태 리셋 → 로그인 화면으로 복귀한다(로그아웃과 동일 경로).
- **NOTE**: 이 시나리오는 **device-gated** — 시뮬레이터/실기기 수동 검증 필수. 자동 게이트만으로 completed 처리 금지.

### 모듈 E — 설정 진입점 + 파괴적 확인

#### AC-5-1 (REQ-ACCOUNT-005) — 진입점 노출
- **Given** 웹 `(main)/profile` 설정 화면(웹·모바일 WebView 공유 표면)
- **When** 화면 렌더
- **Then** 로그아웃 버튼 아래에 "회원 탈퇴" 진입점(`<AccountDeletion />`)이 마운트되어 표시된다.

#### AC-5-2 (REQ-ACCOUNT-005b) — 파괴적 확인 없이는 미호출
- **Given** "회원 탈퇴" 진입점 노출
- **When** 사용자가 진입점을 선택
- **Then** 불가역 경고를 명시한 파괴적 확인 UI가 표시되고, **확인 단계를 거친 뒤에만** `deleteAccountAction`(→ `DELETE /me/account`)이 호출된다(확인 취소 시 서버 액션 미호출).

## 엣지 케이스 (plan.md §7 리스크 표 유도)

- **원자성 부재(R-1)**: 앱 데이터 정리(2)는 성공했으나 auth 삭제(3)가 실패 → 툼스톤이 이미 계정을 무력화, 재호출로 복구(멱등, AC-1-2).
- **유령 멤버 이양(R-4b)**: 탈퇴 마킹 멤버가 새 owner로 선정되면 REQ-ACCOUNT-002b 위반 → 선정·존재 판정 모두 `withdrawnAt: null`로 유령 배제(AC-2-3).
- **고아 device_token(R-5)**: 클라이언트 `unregisterDevice`는 best-effort라 신뢰하지 않고 서버 측 `deviceToken.deleteMany({ userId: U })`가 최종 보장(AC-1-1).
- **정원 의미 왜곡(R-6)**: 멤버 행 보존 시 탈퇴자가 정원에 카운트되지 않도록 `invite.service.ts:152` count에 `withdrawnAt: null` 필터 — 탈퇴 멤버 제외 정원 회귀 테스트.
- **재가입 닉네임 충돌(R-7)**: auth 재가입 시 새 sub 발급 → 새 moim_member 행. 구 "탈퇴한 사용자"(구 sub) 행과 복합 PK 미충돌 → 충돌 소멸.
- **service-role 키 부재**: `SUPABASE_SERVICE_ROLE_KEY` 미설정 상태에서 탈퇴 시도 → 명시적 500(자격증명 없이는 삭제 불가), 부분 삭제 방지.
- **body의 임의 userId 주입(R-8)**: 삭제 대상은 가드 검증 `user.sub`만 사용 → body userId는 무시(임의 uuid 삭제 불가).

## 품질 게이트 기준 (Quality Gate)

- **백엔드 테스트**: jest TDD(test-first), 커버리지 **85%+** — 오케스트레이션 순서·멱등, PII deleteMany, safety 고아 정리(no-op 가드 포함), 소유권 이양/삭제(유령 배제), 툼스톤 부활 차단, 컨트롤러(가드 sub만), env 부재 500, 정원 필터 회귀.
- **린트**: `nx lint backend` clean(경고/에러 0) — 커밋/머지 전 필수(CI 백엔드 ESLint strict 게이트).
- **비순환 정적 검사**: `apps/backend/src/account/**`가 `SafetyModule`/`BlockService`를 import하지 않음(grep 0건). safety→account import도 없음.
- **웹**: 테스트 프레임워크 부재 — `nx build web` + `nx lint web`로만 검증(테스트 태스크 없음, 하네스 미설치).
- **계약 재생성**: openapi.json + api-client 재생성 후 typecheck 통과(`DELETE /me/account` 노출).
- **마이그레이션**: `prisma migrate status` clean(비파괴 additive — WithdrawnAccount 신규 + moim_member.withdrawnAt nullable).
- **디바이스 게이트(HARD)**: 로컬 Supabase에서 service-role 키로 `auth.admin.deleteUser` 실동작 확인 + iOS 시뮬레이터 WebView 탈퇴 종단(session:cleared → 세션 정리 → 로그인 복귀, AC-4-2) 수동 검증 전까지 **status를 completed로 전환하지 않는다**(기존 모바일 SPEC 관례).

## Definition of Done

- REQ-ACCOUNT-001~005b 전 모듈의 AC가 백엔드 jest(A~E 서버측)로 green, 웹 표면(D/E)은 build·lint로 검증.
- `nx lint backend` clean + 백엔드 커버리지 85%+ + 비순환 grep 통과.
- 계약(openapi/api-client) 재생성·typecheck 통과, 마이그레이션 status clean.
- 디바이스 게이트(local Supabase Admin 삭제 실동작 + iOS 시뮬레이터 탈퇴 종단) 수동 검증 완료 후에만 completed 전환.
