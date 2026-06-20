-- SPEC-MOIM-007 REQ-MOIM7-001: 투표 마감 시각(closes_at) — 비파괴(데이터 보존) 마이그레이션.
-- (1) poll.closes_at 컬럼 ADD (additive, nullable @default 없음).
--     기존 poll row 는 모두 closes_at=NULL(마감 없음 — MOIM-005/006 동작 보존).
-- (2) poll_vote PK, FK, 인덱스, 다른 테이블 무변경.
-- 비파괴 논증: nullable 컬럼 추가는 기존 row 에 NULL 을 채우므로 row 손실 0.
-- prisma migrate dev 의 파괴적 reset 회피(hand-edited add_chat realtime 트리거 보존):
-- diff → db execute → migrate resolve --applied → migrate status clean.

-- AlterTable
ALTER TABLE "poll" ADD COLUMN "closes_at" TIMESTAMP(3);
