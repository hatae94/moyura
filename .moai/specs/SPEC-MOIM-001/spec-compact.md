# SPEC-MOIM-001 (compact)

priority: high | status: draft | chain: MOIM-001 → {MOIM-002, CHAT-001} → CHAT-002

## REQ (modules: A 인증·인가 / B 라이프사이클·멤버십)
- REQ-MOIM-001 [Ubiquitous] 전 모임 라우트에 검증된 신원 없으면 401, 처리 없음. (AC-3)
- REQ-MOIM-002 [State-driven] 비멤버는 멤버 한정 조회(단건/멤버목록)에 403. (AC-2)
- REQ-MOIM-003 [State-driven] 비-owner는 모임 삭제에 403. (AC-7)
- REQ-MOIM-004 [Event-driven] 모임 생성 시 모임 + owner 멤버십(host nickname) 원자 생성. (AC-1)
- REQ-MOIM-005 [Event-driven] 멤버의 단건/내 모임 목록 조회 반환. (AC-6)
- REQ-MOIM-006 [Event-driven] 멤버 목록(nickname 포함) 반환. (AC-5)
- REQ-MOIM-007 [Event-driven] 비-owner 멤버 탈퇴 시 멤버십 삭제. (AC-4)
- REQ-MOIM-008 [Unwanted] owner 탈퇴 시도는 403, 멤버십 불변(퇴장=모임 삭제). (AC-8)

## Acceptance
- AC-1 생성 → 모임 + owner 멤버십(nickname) 원자 생성 (201)
- AC-2 비멤버 조회 → 403 (401 아님)
- AC-3 미인증 → 401 전 라우트, 부작용 없음
- AC-4 일반 멤버 탈퇴 → 204
- AC-5 멤버 목록에 nickname 포함
- AC-6 단건/내 모임 목록 조회
- AC-7 owner 전용 삭제(비-owner 403, owner 204 + Cascade)
- AC-8 owner 탈퇴 금지 403

## Files to modify/create
- [MODIFY] apps/backend/prisma/schema.prisma (Moim, MoimMember+nickname)
- [MODIFY] apps/backend/src/app.module.ts (MoimModule)
- [NEW] apps/backend/prisma/migrations/<ts>_add_moim/
- [NEW] apps/backend/src/moim/** (module/service/controller/dto + assertMember/assertOwner)
- [REGEN] openapi.json + packages/api-client

## Exclusions
- 가입 경로 일체(self-join/초대/게스트 → MOIM-002)
- 모임 수정(update), 소유권 이양(owner는 탈퇴 불가, 퇴장=삭제)
- 모임 발견/검색, 초대/승인, per-member 역할, 메타데이터 확장(name만), 웹 모임 관리 화면, 메시지 아카이빙(Cascade)
