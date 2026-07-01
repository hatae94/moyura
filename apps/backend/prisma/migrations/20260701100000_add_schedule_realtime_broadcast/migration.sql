-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-SCHEDULE-001: schedule_event 변경을 모임 private 채널로 방송하는 트리거.
-- broadcast_expense_change 패턴을 미러한다:
--   SECURITY DEFINER + search_path='' + realtime.send(private=true) + topic moim:{id}.
-- 이벤트명 'schedule_change' — 채팅('INSERT')/poll('poll_change')/member('member_change')/
--   expense('expense_change')와 구별(교차 수신 방지).
--
-- [중요] schedule_slot 에는 트리거를 두지 않는다. 슬롯 통째 교체(PUT /me = deleteMany+createMany)는
-- 수십 행을 변경하므로 행마다 방송하면 클라가 수십 번 refresh 하게 된다. 대신 ScheduleService 가 모든
-- 변경(세션 설정/슬롯 교체/확정/삭제) 시 schedule_event 를 touch(updated_at 갱신)하도록 보장하여,
-- schedule_event 트리거가 변경당 정확히 1회만 방송한다. schedule_event 는 moim_id 직접 보유 → 역조회 불필요.
-- realtime.messages SELECT RLS("members can receive moim broadcasts")는 add_chat 마이그레이션이 생성했으므로 재사용.
-- ──────────────────────────────────────────────────────────────────────────────

-- @MX:WARN: [AUTO] security-definer 트리거 함수 + Prisma-diff 비가시 + realtime 스키마 런타임 의존.
-- @MX:REASON: realtime.send 를 정의자(postgres) 권한으로 호출한다. search_path='' 로 하이재킹 차단.
-- schedule_event 는 moim_id 직접 보유 → 역조회 불필요(expense_change 선례). INSERT/UPDATE=NEW, DELETE=OLD.
-- 슬롯 변경은 service 의 event touch 로 이 트리거를 1회 발화시킨다(schedule_slot 트리거 부재 — 방송 폭주 방지).
CREATE OR REPLACE FUNCTION broadcast_schedule_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_moim_id text;
BEGIN
  -- INSERT/UPDATE → NEW, DELETE → OLD 기준으로 moim_id 추출(직접 보유 — 역조회 불필요).
  IF TG_OP = 'DELETE' THEN
    v_moim_id := OLD.moim_id::text;
  ELSE
    v_moim_id := NEW.moim_id::text;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type', 'schedule_change',
      'moimId', v_moim_id
    ),
    'schedule_change',             -- event (다른 도메인 이벤트와 구별 — 교차 수신 방지)
    'moim:' || v_moim_id,         -- topic (CHAT-001/MOIM-009/MOIM-012/EXPENSE와 동일 private 채널)
    true                           -- private (realtime.messages RLS 게이트)
  );

  RETURN NULL;  -- AFTER 트리거 — 반환값 무시.
END;
$$;

-- schedule_event 생성/수정(세션 설정·슬롯 변경 touch·확정)/삭제(초기화)를 방송한다.
-- 그리드/히트맵/확정 상태가 실시간 갱신된다(클라는 'schedule_change' 수신을 신호로 서버 재조회).
DROP TRIGGER IF EXISTS schedule_event_broadcast ON "schedule_event";
CREATE TRIGGER schedule_event_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON "schedule_event"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_schedule_change();
