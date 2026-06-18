-- SPEC-MOIM-004 REQ-MOIM4-001: Moim 이벤트 일정/장소(additive nullable).
-- 두 컬럼 모두 nullable 이라 기존 row 는 NULL 로 채워지며 무중단(additive)으로 추가된다.
-- AlterTable
ALTER TABLE "moim" ADD COLUMN     "starts_at" TIMESTAMP(3);
ALTER TABLE "moim" ADD COLUMN     "location" TEXT;
