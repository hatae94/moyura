-- SPEC-MOIM-005 REQ-MOIM5-001: 모임 투표(poll) — 신규 3 테이블 additive CREATE.
-- moim/moim_member/moim_invite/chat_message 등 기존 테이블은 무변경(add_moim_invite/add_chat 선례).
-- poll_vote 의 복합 PK (poll_id, user_id) 가 "멤버당 한 투표(변경 가능)" 불변식을 DB 레벨에서 강제한다.
-- FK 는 모두 ON DELETE CASCADE — moim 삭제 시 poll→option/vote 가, poll 삭제 시 option/vote 가 함께 정리된다.

-- CreateTable
CREATE TABLE "poll" (
    "id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_option" (
    "id" TEXT NOT NULL,
    "poll_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "poll_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_vote" (
    "poll_id" TEXT NOT NULL,
    "option_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "poll_vote_pkey" PRIMARY KEY ("poll_id","user_id")
);

-- CreateIndex
CREATE INDEX "poll_moim_id_idx" ON "poll"("moim_id");

-- CreateIndex
CREATE INDEX "poll_option_poll_id_idx" ON "poll_option"("poll_id");

-- CreateIndex
CREATE INDEX "poll_vote_option_id_idx" ON "poll_vote"("option_id");

-- AddForeignKey
ALTER TABLE "poll" ADD CONSTRAINT "poll_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_option" ADD CONSTRAINT "poll_option_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "poll_option"("id") ON DELETE CASCADE ON UPDATE CASCADE;
