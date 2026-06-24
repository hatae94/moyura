-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-MOIM-012 A: 모임 정원(max_members) 컬럼 추가.
-- 기본값 15 — 기존 row는 모두 15로 설정된다(비파괴 additive 마이그레이션).
-- ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE "moim" ADD COLUMN "max_members" integer NOT NULL DEFAULT 15;

-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-MOIM-012 B: moim_member 변경을 모임 private 채널로 방송하는 트리거.
-- add_poll_realtime_broadcast(SPEC-MOIM-009)의 트리거 패턴을 미러한다:
--   SECURITY DEFINER + search_path='' + realtime.send(private=true) + topic moim:{id}.
-- INSERT/UPDATE → NEW 기준, DELETE → OLD 기준으로 moim_id/user_id를 추출한다.
-- event 이름 'member_change' — 웹이 .on('broadcast', { event: 'member_change' }, ...) 로 구독한다.
-- realtime.messages SELECT RLS("members can receive moim broadcasts")는 add_chat 마이그레이션이
-- 이미 생성했으므로 재사용(신규 RLS 불필요).
-- ──────────────────────────────────────────────────────────────────────────────

-- @MX:WARN: [AUTO] security-definer 트리거 함수 + Prisma-diff 비가시 + realtime 스키마 런타임 의존.
-- @MX:REASON: realtime.send를 정의자(postgres) 권한으로 호출한다. search_path=''로 하이재킹 차단.
-- INSERT/UPDATE는 NEW, DELETE는 OLD에서 moim_id/user_id를 추출한다. COALESCE 패턴으로 NULL을 방지한다.
-- realtime.messages RLS는 add_chat이 생성한 "members can receive moim broadcasts"를 재사용한다.
CREATE OR REPLACE FUNCTION broadcast_member_change()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
DECLARE
  v_moim_id text;
  v_user_id text;
BEGIN
  -- INSERT/UPDATE → NEW 기준, DELETE → OLD 기준으로 moim_id와 user_id를 추출한다.
  IF TG_OP = 'DELETE' THEN
    v_moim_id := OLD.moim_id::text;
    v_user_id := OLD.user_id::text;
  ELSE
    v_moim_id := NEW.moim_id::text;
    v_user_id := NEW.user_id::text;
  END IF;

  PERFORM realtime.send(
    jsonb_build_object('op', TG_OP, 'userId', v_user_id),  -- 경량 신호(누가 변경됐는지만)
    'member_change',                                         -- event (웹 구독 키)
    'moim:' || v_moim_id,                                   -- topic (CHAT-001/MOIM-009와 동일 private 채널)
    true                                                     -- private (realtime.messages RLS 게이트)
  );

  RETURN NULL;  -- AFTER 트리거 — 반환값 무시.
END;
$$;

-- 멤버십 변경(가입·수정·탈퇴/강제퇴장)을 방송한다. 멤버 목록이 실시간 갱신된다.
DROP TRIGGER IF EXISTS member_change_broadcast ON "moim_member";
CREATE TRIGGER member_change_broadcast
  AFTER INSERT OR UPDATE OR DELETE ON "moim_member"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_member_change();
