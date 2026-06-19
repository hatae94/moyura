-- SPEC-MOIM-006 REQ-MOIM6-001: 투표 다중 선택(multi-select) — 비파괴(데이터 보존) 마이그레이션.
-- (1) poll.multi_select 컬럼 ADD (additive, NOT NULL DEFAULT false → 기존 poll row 는 모두 단일 선택 보존).
-- (2) poll_vote 복합 PK 를 (poll_id, user_id) → (poll_id, option_id, user_id) 로 재정의.
--     비파괴 논증: 기존 단일 선택 표는 (poll_id, user_id) 당 정확히 한 row 이므로 그 (poll_id, option_id, user_id)
--     도 이미 유일하다 → 새 PK 를 위반 없이 만족한다(DROP/ADD 가 어떤 row 도 충돌·삭제하지 않음 — row 손실 0).
--     기존 FK(poll_vote_poll_id_fkey/poll_vote_option_id_fkey, ON DELETE CASCADE)와 poll_vote_option_id_idx 는 보존.
-- prisma migrate dev 의 파괴적 reset 회피(hand-edited add_chat realtime 트리거 보존 — MOIM-005 비파괴 선례):
-- diff → db execute → migrate resolve --applied → migrate status clean.

-- AlterTable
ALTER TABLE "poll" ADD COLUMN     "multi_select" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "poll_vote" DROP CONSTRAINT "poll_vote_pkey",
ADD CONSTRAINT "poll_vote_pkey" PRIMARY KEY ("poll_id", "option_id", "user_id");
