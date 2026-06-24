-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-MOIM-EXPENSE-001 REQ-EXP-001: 경비 하위 도메인 — additive 신규 테이블 + 컬럼.
-- 기존 테이블/컬럼/PK/트리거 무변경(순수 additive). add_poll 선례 미러.
-- Moim.budget(nullable Int) + expense/expense_share/settlement 테이블 CREATE.
-- FK 는 모두 ON DELETE CASCADE — moim 삭제 시 expense→expense_share/settlement 가 함께 정리된다.
-- ──────────────────────────────────────────────────────────────────────────────

-- Moim.budget 컬럼 추가(nullable, 기존 row 는 모두 null — 비파괴 additive).
ALTER TABLE "moim" ADD COLUMN "budget" integer;

-- CreateTable: expense(경비 헤더)
CREATE TABLE "expense" (
    "id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "amount" integer NOT NULL,
    "category" TEXT NOT NULL,
    "payer_user_id" TEXT NOT NULL,
    "memo" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable: expense_share(경비 분담, 복합 PK)
CREATE TABLE "expense_share" (
    "expense_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "share_amount" integer NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_share_pkey" PRIMARY KEY ("expense_id","user_id")
);

-- CreateTable: settlement(정산 완료 마커, surrogate id PK)
CREATE TABLE "settlement" (
    "id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "amount" integer NOT NULL,
    "settled_by" TEXT NOT NULL,
    "settled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: expense(moim_id) — 모임별 목록 조회 커버
CREATE INDEX "expense_moim_id_idx" ON "expense"("moim_id");

-- CreateIndex: expense_share(user_id) — 멤버별 분담 조회 커버
CREATE INDEX "expense_share_user_id_idx" ON "expense_share"("user_id");

-- CreateIndex: settlement(moim_id) — 모임별 마커 조회 커버
CREATE INDEX "settlement_moim_id_idx" ON "settlement"("moim_id");

-- AddForeignKey: expense → moim (CASCADE)
ALTER TABLE "expense" ADD CONSTRAINT "expense_moim_id_fkey"
    FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: expense_share → expense (CASCADE)
ALTER TABLE "expense_share" ADD CONSTRAINT "expense_share_expense_id_fkey"
    FOREIGN KEY ("expense_id") REFERENCES "expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: settlement → moim (CASCADE)
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_moim_id_fkey"
    FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
