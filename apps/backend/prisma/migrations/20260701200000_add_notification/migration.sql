-- CreateTable
CREATE TABLE "notification" (
    "id" BIGSERIAL NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_recipient_id_id_idx" ON "notification"("recipient_id", "id" DESC);

-- CreateIndex
CREATE INDEX "notification_recipient_id_read_at_idx" ON "notification"("recipient_id", "read_at");

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-NOTIFICATIONS-001 M1 수동 SQL (Prisma 스키마로 표현 불가 — R-6 드리프트 주의).
-- 이 블록은 prisma migrate diff에 잡히지 않으므로 .moai/project/db/에 문서화한다(add_chat 선례).
-- ──────────────────────────────────────────────────────────────────────────────

-- notification RLS enable + 정책 없음(default deny).
--   Prisma는 postgres 롤로 직접 연결되므로 이 RLS의 영향을 받지 않는다(쓰기/읽기 인가 = NestJS 서비스 레이어).
--   용도: anon/authenticated 롤의 PostgREST 직접 접근을 차단(정책이 없으면 모두 거부 = default deny).
--   근거: 웹은 백엔드 API 로만 알림을 읽는다(전 도메인 동일) → Supabase 직독을 열면 인가가 두 곳(백엔드+RLS)으로
--   분산되어 드리프트 위험. 실시간 배지 방송 트리거 + realtime.messages RLS 게이트는 M4 에서 별도 마이그레이션으로 추가한다.
ALTER TABLE "notification" ENABLE ROW LEVEL SECURITY;
