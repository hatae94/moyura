-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-MOIM-009: 투표 결과 실시간 갱신 — poll/poll_vote 변경을 모임 private 채널로 방송한다.
-- SPEC-CHAT-001 add_chat 의 broadcast 트리거 패턴을 미러한다(security definer + search_path='' +
-- realtime private 채널 moim:{id} + realtime.messages RLS 재사용). 단, 페이로드는 변경 row 가 아니라
-- 경량 신호({moimId, pollId})만 싣는다 — poll_vote row(user_id/option_id)를 전체 멤버에게 노출하지 않기
-- 위함(누가 무엇에 투표했는지 비노출 — UI 집계 모델과 정합). 신호를 받은 클라이언트는 재조회(router.refresh)로
-- 자신의 myVotes 포함 집계를 서버에서 다시 가져온다(서버 = 단일 출처).
--
-- 이 SQL 은 Prisma 스키마로 표현 불가(트리거 — R-6 드리프트). 스키마 변경 시 수동 동기화 대상이며
-- .moai/project/db/ 에 문서화한다. 테이블/컬럼 변경 없음(순수 트리거 추가 — 비파괴).
-- ──────────────────────────────────────────────────────────────────────────────

-- @MX:WARN: [AUTO] security-definer 트리거 함수 + Prisma-diff 비가시 + realtime 스키마 런타임 의존.
-- @MX:REASON: realtime.send 를 정의자(postgres) 권한으로 호출한다. search_path='' 로 하이재킹 차단.
-- realtime.send 는 내부적으로 realtime.messages 에 private 메시지를 넣어 add_chat 이 만든 멤버십 RLS
-- ("members can receive moim broadcasts")를 그대로 거친다 — 신규 RLS/채널 불필요(CHAT-001 재사용).
-- poll 은 moim_id 컬럼을 직접, poll_vote 는 moim_id 컬럼이 없어 poll_id 로 public.poll 을 조회해 해소한다.
CREATE OR REPLACE FUNCTION broadcast_poll_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_moim_id text;
  v_poll_id text;
BEGIN
  IF TG_TABLE_NAME = 'poll' THEN
    -- poll 트리거는 INSERT/UPDATE 만(DELETE 없음) → NEW 항상 존재. moim_id 직접 사용.
    v_poll_id := NEW.id;
    v_moim_id := NEW.moim_id;
  ELSE
    -- poll_vote 트리거는 INSERT/DELETE(UPDATE 없음). INSERT=NEW, DELETE=OLD 에서 poll_id 를 얻는다.
    IF TG_OP = 'DELETE' THEN
      v_poll_id := OLD.poll_id;
    ELSE
      v_poll_id := NEW.poll_id;
    END IF;
    -- poll_vote 에는 moim_id 가 없으므로 poll 에서 조회한다(poll 이 이미 삭제됐으면 NULL → 방송 생략).
    SELECT p.moim_id INTO v_moim_id FROM public.poll p WHERE p.id = v_poll_id;
  END IF;

  IF v_moim_id IS NOT NULL THEN
    PERFORM realtime.send(
      jsonb_build_object('moimId', v_moim_id, 'pollId', v_poll_id),  -- 경량 신호(집계/표 정보 없음)
      'poll_change',                                                  -- event (채팅의 'INSERT' 와 구별 — 교차 수신 방지)
      'moim:' || v_moim_id,                                           -- topic (CHAT-001 와 동일 private 채널)
      true                                                            -- private (realtime.messages RLS 게이트)
    );
  END IF;

  RETURN NULL;  -- AFTER 트리거 — 반환값 무시.
END;
$$;

-- poll 생성/마감(closesAt·finalize 시 UPDATE)을 방송한다. 새 투표 등장 + "마감됨"/일정 확정이 실시간 반영된다.
DROP TRIGGER IF EXISTS poll_broadcast ON "poll";
CREATE TRIGGER poll_broadcast
  AFTER INSERT OR UPDATE ON "poll"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_poll_change();

-- 투표 변동(단일=교체로 delete+insert / 다중=토글로 insert·delete)을 방송한다. 득표 수가 실시간 갱신된다.
DROP TRIGGER IF EXISTS poll_vote_broadcast ON "poll_vote";
CREATE TRIGGER poll_vote_broadcast
  AFTER INSERT OR DELETE ON "poll_vote"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_poll_change();
