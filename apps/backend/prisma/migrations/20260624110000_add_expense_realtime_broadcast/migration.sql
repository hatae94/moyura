-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-MOIM-EXPENSE-001 REQ-EXP-008: expense/settlement 변경을 모임 private 채널로 방송하는 트리거.
-- broadcast_poll_change / broadcast_member_change 패턴을 미러한다:
--   SECURITY DEFINER + search_path='' + realtime.send(private=true) + topic moim:{id}.
-- 이벤트명 'expense_change' — 채팅('INSERT')/poll('poll_change')/member('member_change')와 구별(교차 수신 방지).
-- expense/settlement 행 모두 moim_id 직접 보유 → poll_vote 처럼 역조회 불필요(트리거 단순).
-- expense 트리거: AFTER INSERT OR UPDATE OR DELETE (추가/수정/삭제).
-- settlement 트리거: AFTER INSERT OR DELETE (정산 완료 토글 on/off).
-- 두 트리거가 같은 함수 broadcast_expense_change() 를 공유한다.
-- realtime.messages SELECT RLS("members can receive moim broadcasts")는 add_chat 마이그레이션이
-- 이미 생성했으므로 재사용(신규 RLS 불필요).
-- ──────────────────────────────────────────────────────────────────────────────

-- @MX:WARN: [AUTO] security-definer 트리거 함수 + Prisma-diff 비가시 + realtime 스키마 런타임 의존.
-- @MX:REASON: realtime.send 를 정의자(postgres) 권한으로 호출한다. search_path='' 로 하이재킹 차단.
-- expense/settlement 모두 moim_id 직접 보유 → 역조회 불필요. INSERT/UPDATE=NEW, DELETE=OLD 사용.
-- realtime.messages RLS 는 add_chat 이 생성한 "members can receive moim broadcasts" 를 재사용한다.
CREATE OR REPLACE FUNCTION broadcast_expense_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_moim_id text;
  v_expense_id text;
BEGIN
  -- INSERT/UPDATE → NEW 기준, DELETE → OLD 기준으로 moim_id 를 추출한다.
  IF TG_OP = 'DELETE' THEN
    v_moim_id := OLD.moim_id::text;
    -- expense 트리거 DELETE: expense_id = OLD.id. settlement 트리거에는 expense_id 없음(NULL 전송).
    IF TG_TABLE_NAME = 'expense' THEN
      v_expense_id := OLD.id::text;
    ELSE
      v_expense_id := NULL;
    END IF;
  ELSE
    v_moim_id := NEW.moim_id::text;
    IF TG_TABLE_NAME = 'expense' THEN
      v_expense_id := NEW.id::text;
    ELSE
      v_expense_id := NULL;
    END IF;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object(
      'type', 'expense_change',
      'moimId', v_moim_id,
      'expenseId', v_expense_id    -- settlement 트리거: null(정산 토글은 expenseId 불필요)
    ),
    'expense_change',              -- event (채팅/poll/member 이벤트와 구별 — 교차 수신 방지)
    'moim:' || v_moim_id,         -- topic (CHAT-001/MOIM-009/MOIM-012와 동일 private 채널)
    true                           -- private (realtime.messages RLS 게이트)
  );

  RETURN NULL;  -- AFTER 트리거 — 반환값 무시.
END;
$$;

-- expense 생성/수정/삭제(추가·수정·삭제)를 방송한다. 경비 목록/요약/정산이 실시간 갱신된다.
DROP TRIGGER IF EXISTS expense_broadcast ON "expense";
CREATE TRIGGER expense_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON "expense"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_expense_change();

-- settlement 토글(완료 on=INSERT / 완료 off=DELETE)을 방송한다. 정산 리스트 settled 표시가 실시간 갱신된다.
DROP TRIGGER IF EXISTS settlement_broadcast ON "settlement";
CREATE TRIGGER settlement_broadcast
  AFTER INSERT OR DELETE ON "settlement"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_expense_change();
