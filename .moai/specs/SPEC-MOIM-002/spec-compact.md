# SPEC-MOIM-002 (compact)

priority: high | status: draft | depends: SPEC-MOIM-001 | parallel-with: SPEC-CHAT-001

## REQ (modules: A 초대 관리(owner) / B 초대 수락)
- REQ-INV-001 [Event-driven] owner 초대 발급 → 추측 불가 토큰(≥128-bit) + 만료(기본 7d, 상한 30d) + 선택 max_uses. (AC-1)
- REQ-INV-002 [Event-driven] owner 초대 목록(상태 포함) 조회. (AC-6)
- REQ-INV-003 [Event-driven] owner 초대 폐기. (AC-4)
- REQ-INV-004 [Unwanted] 비-owner 발급/목록/폐기 403(목록 live 토큰 유출 방지). (AC-5)
- REQ-INV-005 [Event-driven] 유효 토큰+nickname 수락 → 멤버십(nickname) 생성 + usedCount++; 이미 멤버 재수락 멱등(usedCount 불변). (AC-2, AC-7)
- REQ-INV-006 [State-driven] 무효 토큰 거부 고정 코드: 미지 404 / 만료·폐기 410 / 초과 409. (AC-3)
- REQ-INV-007 [State-driven] 세션 없는 방문자 랜딩 → 익명 로그인 → nickname → 수락 → 채팅 리다이렉트. (AC-8)

## Acceptance
- AC-1 발급 → 토큰(≥128-bit) + 7d 만료 (201)
- AC-2 게스트(익명 sub) 수락 → 멤버십(member, nickname) + usedCount++
- AC-3 미지 404 / 만료·폐기 410 / 초과 409, 미생성
- AC-4 host 폐기 → revokedAt, 이후 수락 410
- AC-5 비-owner 발급/목록/폐기 전부 403
- AC-6 owner 초대 목록 조회 200
- AC-7 이미 멤버 재수락 멱등(usedCount 불변)
- AC-8 게스트 웹 랜딩(익명 로그인→nickname→accept→chat redirect)

## Files to modify/create
- [MODIFY] apps/backend/prisma/schema.prisma (MoimInvite, Moim.invites)
- [MODIFY] apps/backend/src/app.module.ts
- [MODIFY] supabase/config.toml (enable_anonymous_sign_ins = true)
- [NEW] apps/backend/prisma/migrations/<ts>_add_moim_invite/
- [NEW] apps/backend/src/invite/** (module/service/controller/dto)
- [NEW] apps/web/app/invite/[token]/page.tsx (+ lib/invite)
- [REGEN] openapi.json + packages/api-client

## Exclusions
- 게스트→정회원 전환 UI(신원 연결 자동 이관 — 설명만), 초대 QR, email/SMS 발송, per-invite 역할 지정, 초대 분석/통계
