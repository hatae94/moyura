# SPEC-ACCOUNT-001 (compact) — 회원 탈퇴 / 인앱 계정 삭제

## REQ (EARS)

- **REQ-ACCOUNT-001 [Event-driven]** — When 인증 사용자가 탈퇴 확인을 제출하면, 시스템은 (1) 소유 모임 처리(REQ-002) → (2) 단일 멱등 트랜잭션으로 PII 삭제(profile / device_token by userId / notification by recipientId / moim_invite by createdBy) + safety 고아 행 정리(block·report 양측, SAFETY 배포 시 / no-op 가드) + UGC 표시명 "탈퇴한 사용자" 익명화 + withdrawn 툼스톤 기록 → (3) Admin Client로 auth 계정 삭제. (2) 재실행 가능, (3) 실패 시 재호출 복구.
- **REQ-ACCOUNT-001b [Unwanted]** — If 탈퇴 처리가 원장 행(chat_message, schedule_event/slot, expense/expense_share/settlement, settlement_request, poll/poll_vote) 삭제를 시도하면, then 삭제하지 않고 익명화만 적용.
- **REQ-ACCOUNT-002 [Event-driven]** — When 탈퇴 확인 제출 + 탈퇴자가 모임 owner이면, 각 소유 모임에 대해: (a) 활성 타 멤버 ≥1이면 소유권을 가장 오래된 활성 비-owner에게 이양, (b) 유일 활성 멤버이면 모임 삭제(Cascade). 조건 판정은 활성 멤버 기준.
- **REQ-ACCOUNT-002b [Unwanted]** — If 이양 대상 선정이 유령(탈퇴 마킹) 멤버를 owner로 선정하려 하면, then 이양 금지 — 접근 가능(활성) owner 없는 모임을 남기지 않는다(존재 판정·선정 모두 withdrawnAt: null).
- **REQ-ACCOUNT-003 [Unwanted]** — If 잔존 토큰이 유예 창 내 GET /me(upsertBySub) 호출하면, then 툼스톤 선조회로 profile 재생성 금지 + 계정 소멸 응답(401/410). PII 부활 차단.
- **REQ-ACCOUNT-004 [Event-driven]** — When 탈퇴 성공하면, 웹 signOut → /login, 모바일은 session:cleared 재사용(SecureStore + sb-* 쿠키 삭제 → 로그인 화면).
- **REQ-ACCOUNT-005 [Ubiquitous]** — 시스템은 (main)/profile에 "회원 탈퇴" 진입점을 제공한다.
- **REQ-ACCOUNT-005b [Event-driven]** — When 사용자가 진입점을 선택하면, 파괴적·불가역 확인 단계 뒤에만 탈퇴 서버 액션 호출.

## 수락 기준 요약

- A: PII deleteMany/updateMany/upsert + profile 삭제가 auth deleteUser보다 선행 / 멱등 재실행(P2025 없음) / safety 정리(배포 시 block·report OR 조건, 미배포 no-op) / 원장 delete 미발생.
- B: 활성 타 멤버 → transferOwner(활성 대상) / 유일 활성 owner → deleteMoim / 유령만 → deleteMoim(유령 이양 금지, 활성 카운트 기준).
- C: 툼스톤 있으면 upsertBySub 차단 + 401/410 / 툼스톤 없으면 정상 upsert(회귀).
- D: 웹 signOut+redirect("/login") / 모바일 session:cleared → 세션 정리 → 로그인 복귀(device-gated).
- E: /profile에 진입점 마운트 / 확인 단계 뒤에만 서버 액션 호출(취소 시 미호출).
- 게이트: `nx lint backend` clean, 백엔드 jest 85%+, account↛safety 비순환 grep, 웹은 `nx build web`+`nx lint web`만(테스트 하네스 없음), local Supabase Admin 삭제 실동작 + iOS 시뮬레이터 탈퇴 종단 수동 검증 전 completed 금지.

## 변경 파일 (Files to Modify)

- [NEW] `apps/backend/src/account/**` (module/controller/service/admin-client; safety 고아 정리 no-op 가드 포함)
- [MODIFY] `apps/backend/prisma/schema.prisma` (WithdrawnAccount 모델 + `moim_member.withdrawnAt` nullable)
- [NEW] `apps/backend/prisma/migrations/<ts>_add_withdrawn_account/`
- [MODIFY] `apps/backend/src/config/env.validation.ts` (SUPABASE_SERVICE_ROLE_KEY optional; 삭제 시 부재면 500)
- [MODIFY] `apps/backend/src/app.module.ts` (AccountModule 등록)
- [MODIFY] `apps/backend/src/moim/moim.service.ts` `transferOwner`(비-owner 선정 쿼리 withdrawnAt: null 가드)
- [EXISTING] `apps/backend/src/moim/moim.service.ts` `deleteMoim`(재사용)
- [MODIFY] `apps/backend/src/invite/invite.service.ts:152` (count withdrawnAt: null 필터)
- [MODIFY] `apps/backend/src/profile/profile.service.ts` `upsertBySub`(툼스톤 가드) + `me.controller.ts`(401/410)
- [EXISTING] `LogoutBridgeNotifier` / `session:cleared` 경로 (재사용)
- [MODIFY] `apps/web/app/(main)/profile/actions.ts` (deleteAccountAction)
- [NEW] `apps/web/app/(main)/profile/account-deletion.tsx` (확인 UI)
- [MODIFY] `apps/web/app/(main)/profile/page.tsx` (마운트)
- [REGEN] `apps/backend/openapi.json` + `packages/api-client/src/schema.d.ts` (DELETE /me/account)

## 제외 범위 (Exclusions)

- 원장 행(chat/schedule/expense/settlement/poll) 삭제 금지 — 익명화만.
- JWT 하드 회수(즉시 무효화)·denylist·realtime RLS 툼스톤 게이트 제외(≤1h 유예 창 수용 리스크).
- 유예 기간/복구(Undo)·소프트 삭제·데이터 다운로드(export) 없음.
- report 감사 장기 보존/이관 제외 — 함께 삭제(운영자 조치 불능). 관리자 검토 UI 별도 SPEC.
- safety 필터 로직·모더레이션 정책 제외(SPEC-SAFETY-001 소관) — 본 SPEC은 고아 행 정리만.
- 탈퇴 사유 수집/분석·관리자 강제 탈퇴 UI 제외.
- poll 생성자 표시명 UI 변경 없음(웹 미렌더).
