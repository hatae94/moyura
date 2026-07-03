-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-ACCOUNT-001 T-01: 회원 탈퇴 데이터 모델 — 순수 additive(비파괴).
-- 기존 테이블/컬럼/PK/인덱스/트리거 무변경. add_safety/add_notification 선례 미러.
--   - moim_member.withdrawn_at: nullable 마커 추가(기존 row 모두 NULL). 복합 PK/FK/인덱스 불변.
--     정원 count(withdrawnAt:null 필터, R-6)와 소유권 이양 대상 선정(활성만, R-4b)이 소비.
--   - withdrawn_account: 계정 소멸 툼스톤(REQ-ACCOUNT-003 부활 차단). sub PK-only, FK 없음.
-- ──────────────────────────────────────────────────────────────────────────────

-- AlterTable
ALTER TABLE "moim_member" ADD COLUMN     "withdrawn_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "withdrawn_account" (
    "sub" TEXT NOT NULL,
    "withdrawn_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawn_account_pkey" PRIMARY KEY ("sub")
);

-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-ACCOUNT-001 T-01 수동 SQL (Prisma 스키마로 표현 불가 — R-6 드리프트 주의).
-- 이 블록은 prisma migrate diff에 잡히지 않으므로 .moai/project/db/에 문서화한다(add_safety 선례).
-- ──────────────────────────────────────────────────────────────────────────────

-- withdrawn_account RLS enable + 정책 없음(default deny).
--   Prisma는 postgres 롤로 직접 연결되므로 이 RLS의 영향을 받지 않는다(부활 차단 조회 = NestJS 서비스 레이어).
--   용도: anon/authenticated 롤의 PostgREST 직접 접근을 차단(정책이 없으면 모두 거부 = default deny).
--   근거: 툼스톤 존재 여부는 백엔드(upsertBySub 가드)만 읽는다 — Supabase 직독을 열면 탈퇴 계정 목록이
--   노출되어 프라이버시 위험. notification/block/report 테이블과 동일한 default-deny 정책이다.
ALTER TABLE "withdrawn_account" ENABLE ROW LEVEL SECURITY;
