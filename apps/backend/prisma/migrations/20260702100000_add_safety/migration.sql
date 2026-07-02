-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-SAFETY-001 M1: 신고·차단(UGC 모더레이션) — additive 신규 테이블 2개.
-- 기존 테이블/컬럼/PK/트리거 무변경(순수 additive). add_notification/add_settlement_request 선례 미러.
--   - block: 전역 1-way 차단(복합 PK, 모임 무관). 양쪽 user 컬럼 FK 없음(soft-ref).
--   - report: 단일 PK 콘텐츠 4종 신고. moim_id 만 FK CASCADE, reporter/target user 는 soft-ref.
-- 고아 정리(탈퇴 사용자 block/report)는 SPEC-ACCOUNT-001 deleteAccount 소관(prisma 직접 접근, 순환 의존 회피).
-- ──────────────────────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "block" (
    "blocker_id" TEXT NOT NULL,
    "blocked_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "block_pkey" PRIMARY KEY ("blocker_id","blocked_user_id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" TEXT NOT NULL,
    "reporter_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "block_blocker_id_idx" ON "block"("blocker_id");

-- CreateIndex
CREATE INDEX "block_blocked_user_id_idx" ON "block"("blocked_user_id");

-- CreateIndex
CREATE INDEX "report_reporter_id_idx" ON "report"("reporter_id");

-- CreateIndex
CREATE INDEX "report_target_user_id_idx" ON "report"("target_user_id");

-- CreateIndex
CREATE INDEX "report_moim_id_idx" ON "report"("moim_id");

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-SAFETY-001 M1 수동 SQL (Prisma 스키마로 표현 불가 — R-6 드리프트 주의).
-- 이 블록은 prisma migrate diff에 잡히지 않으므로 .moai/project/db/에 문서화한다(add_notification 선례).
-- ──────────────────────────────────────────────────────────────────────────────

-- report.content_type CHECK 제약(REQ-RPT-004): 단일 PK 콘텐츠 4종만 허용.
--   복합 PK 콘텐츠(poll_vote/expense_share/schedule_slot)는 단일 content_id 참조가 불가하므로
--   컨트롤러 화이트리스트(400)와 이중으로 DB 레벨에서도 미지 타입을 거른다.
ALTER TABLE "report" ADD CONSTRAINT "report_content_type_check"
    CHECK ("content_type" IN ('chat_message', 'poll', 'expense', 'settlement_request'));

-- block RLS enable + 정책 없음(default deny, REQ-CPL-004).
--   Prisma는 postgres 롤로 직접 연결되므로 이 RLS의 영향을 받지 않는다(쓰기/읽기 인가 = NestJS 서비스 레이어).
--   용도: anon/authenticated 롤의 PostgREST 직접 접근을 차단(정책이 없으면 모두 거부 = default deny).
--   근거: 웹은 백엔드 API 로만 차단을 다룬다(전 도메인 동일) → Supabase 직독을 열면 인가가 두 곳으로
--   분산되어 드리프트 위험. notification/settlement_request 테이블과 동일한 default-deny 정책이다.
ALTER TABLE "block" ENABLE ROW LEVEL SECURITY;

-- report RLS enable + 정책 없음(default deny, REQ-CPL-004).
--   운영자 수동 DB 조회(REQ-STO-001)는 postgres 롤(RLS 미적용) 경유이며, anon/authenticated 직독은 차단된다.
ALTER TABLE "report" ENABLE ROW LEVEL SECURITY;
