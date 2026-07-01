-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-SCHEDULE-001: 일정 조율(When2meet 스타일) — additive 신규 테이블만 추가.
-- 기존 테이블/컬럼/PK/트리거 무변경(순수 additive). add_expense 선례 미러.
-- schedule_event(모임당 1개, moim_id UNIQUE) + schedule_slot(멤버별 가능 슬롯, 복합 PK).
-- FK 는 모두 ON DELETE CASCADE — moim 삭제 시 schedule_event→schedule_slot 가 함께 정리된다.
-- ──────────────────────────────────────────────────────────────────────────────

-- CreateTable: schedule_event(일정 조율 세션 헤더). dates=Postgres text[](후보 날짜). 시간 범위는 분 단위
-- (start_minute~end_minute, end_minute>1440 이면 자정 넘김). confirmed_at 은 owner 확정 시각(→ moim.starts_at).
CREATE TABLE "schedule_event" (
    "id" TEXT NOT NULL,
    "moim_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "dates" TEXT[],
    "start_minute" integer NOT NULL,
    "end_minute" integer NOT NULL,
    "slot_minutes" integer NOT NULL DEFAULT 30,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable: schedule_slot(멤버별 가능 슬롯, 복합 PK = 멤버당 슬롯당 1행 불변식)
CREATE TABLE "schedule_slot" (
    "schedule_event_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "start_minute" integer NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_slot_pkey" PRIMARY KEY ("schedule_event_id","user_id","date","start_minute")
);

-- CreateIndex: schedule_event(moim_id) UNIQUE — 모임당 1개 보장 + upsert 키
CREATE UNIQUE INDEX "schedule_event_moim_id_key" ON "schedule_event"("moim_id");

-- CreateIndex: schedule_slot(schedule_event_id) — 세션별 전체 슬롯 조회(히트맵 집계) 커버
CREATE INDEX "schedule_slot_schedule_event_id_idx" ON "schedule_slot"("schedule_event_id");

-- AddForeignKey: schedule_event → moim (CASCADE)
ALTER TABLE "schedule_event" ADD CONSTRAINT "schedule_event_moim_id_fkey"
    FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: schedule_slot → schedule_event (CASCADE)
ALTER TABLE "schedule_slot" ADD CONSTRAINT "schedule_slot_schedule_event_id_fkey"
    FOREIGN KEY ("schedule_event_id") REFERENCES "schedule_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
