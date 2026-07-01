-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-NOTIFICATIONS-001 M2: 정산 "요청"(creditor → debtor) — additive 신규 테이블.
-- 기존 테이블/컬럼/PK/트리거 무변경(순수 additive). add_expense 선례 미러.
-- 정산 완료(Settlement)와 분리한 별도 테이블(요청=pending / 완료=done) — 매칭 로직 오염 방지.
-- FK ON DELETE CASCADE — moim 삭제 시 settlement_request 가 함께 정리된다.
-- ──────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "settlement_request" (
    "id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "debtor_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "settlement_request_moim_id_idx" ON "settlement_request"("moim_id");

-- AddForeignKey
ALTER TABLE "settlement_request" ADD CONSTRAINT "settlement_request_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-NOTIFICATIONS-001 M2 수동 SQL (Prisma 스키마로 표현 불가 — R-6 드리프트 주의).
-- 이 블록은 prisma migrate diff에 잡히지 않으므로 .moai/project/db/에 문서화한다(add_notification 선례).
-- ──────────────────────────────────────────────────────────────────────────────

-- settlement_request RLS enable + 정책 없음(default deny).
--   Prisma는 postgres 롤로 직접 연결되므로 이 RLS의 영향을 받지 않는다(쓰기/읽기 인가 = NestJS 서비스 레이어).
--   용도: anon/authenticated 롤의 PostgREST 직접 접근을 차단(정책이 없으면 모두 거부 = default deny).
--   근거: 웹은 백엔드 API 로만 정산 요청을 다룬다(전 도메인 동일) → Supabase 직독을 열면 인가가 두 곳으로
--   분산되어 드리프트 위험. notification 테이블과 동일한 default-deny 정책이다.
ALTER TABLE "settlement_request" ENABLE ROW LEVEL SECURITY;
