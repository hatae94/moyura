-- SPEC-MOIM-008 REQ-MOIM8-001: 투표 종류(kind) + 날짜 옵션(option_date) — 비파괴(데이터 보존) 마이그레이션.
-- (1) poll.kind 컬럼 ADD (additive, NOT NULL DEFAULT 'general').
--     기존 poll row 는 모두 kind='general'(일반 투표 — MOIM-005/006/007 동작 보존).
--     string 컬럼(Prisma enum 아님): CREATE TYPE 마이그레이션 마찰 회피, 허용 값 검증은 컨트롤러가 담당.
-- (2) poll_option.option_date 컬럼 ADD (additive, nullable).
--     기존 option row 는 모두 option_date=NULL(날짜 없음 — 일반 투표 옵션 보존).
-- (3) poll_vote PK(pollId,optionId,userId), FK, 인덱스, 다른 테이블 무변경.
-- 비파괴 논증: (1) NOT NULL DEFAULT 컬럼 추가는 기존 row 에 'general' 을 채우므로 row 손실 0.
--             (2) nullable 컬럼 추가는 기존 row 에 NULL 을 채우므로 row 손실 0.
-- prisma migrate dev 의 파괴적 reset 회피(hand-edited add_chat realtime 트리거 보존):
-- diff → db execute → migrate resolve --applied → migrate status clean.

-- AlterTable poll: kind 컬럼 추가(string, NOT NULL DEFAULT 'general')
ALTER TABLE "poll" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'general';

-- AlterTable poll_option: option_date 컬럼 추가(nullable datetime)
ALTER TABLE "poll_option" ADD COLUMN "option_date" TIMESTAMP(3);
