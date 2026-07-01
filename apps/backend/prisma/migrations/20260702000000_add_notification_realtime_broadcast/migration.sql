-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-NOTIFICATIONS-001 M4a: notification INSERT 를 수신자 per-user 채널로 방송하는 트리거.
-- broadcast_member_change(per-row) / broadcast_chat_message(AFTER INSERT per-row) 패턴을 미러하되,
-- 토픽이 moim:{id} 가 아니라 user:{recipient_id} 다 — notification 이 recipient_id 를 직접 보유하므로
-- 조인 불필요(멤버십 게이트가 필요한 moim: 정책과 대비).
--
-- [중요] fan-out(수신자당 1행) INSERT → 각 행이 서로 다른 user:{id} 토픽으로 1회씩 발화 → 사용자당
-- 정확히 1회 수신(폭주 없음). member_change per-row 트리거와 동형이므로 collapse 하지 않는다
-- (per-statement 로 접으면 다중 수신자를 구별해 라우팅할 수 없다).
--
-- 이벤트명 'notification_new' — 다른 도메인 방송('INSERT'/'poll_change'/'member_change'/'expense_change'/
-- 'schedule_change', 모두 moim: 토픽)과 이벤트·토픽 모두 구별(교차 수신 방지).
--
-- realtime.messages SELECT RLS 는 add_chat 의 moim: 정책과 별개로 user: 정책을 신규 추가한다.
-- 둘 다 authenticated SELECT 정책 → OR 결합(구독자는 자기 moim: 또는 자기 user: 토픽만 수신).
-- to_regnamespace 가드로 shadow DB(realtime 스키마 부재)는 정책 생성을 생략(add_chat 선례).
--
-- 이 블록은 prisma migrate diff 에 잡히지 않으므로 .moai/project/db/ 에 문서화한다(add_chat/add_poll_realtime 선례).
-- ──────────────────────────────────────────────────────────────────────────────

-- @MX:WARN: [AUTO] security-definer 트리거 함수 + Prisma-diff 비가시 + realtime 스키마 런타임 의존.
-- @MX:REASON: realtime.send 를 정의자(postgres) 권한으로 호출한다. search_path='' 로 하이재킹 차단.
-- notification 은 recipient_id 직접 보유 → 역조회 불필요(per-user 토픽). INSERT-only(NEW 만 사용).
-- realtime.send 를 BEGIN...EXCEPTION 으로 감싸 방송 실패(realtime 부재/일시 오류)가 fan-out INSERT 를
-- 절대 중단시키지 않게 한다 — 알림 영속이 실시간 배지보다 우선(best-effort). 트리거/RLS 는 prisma schema
-- 로 표현 불가해 migrate diff 에 잡히지 않으므로(R-6 드리프트) 스키마 변경 시 이 SQL 을 수동 동기화한다.
CREATE OR REPLACE FUNCTION broadcast_notification_new()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  -- best-effort: 방송 실패가 notification INSERT 를 절대 중단시키지 않는다(알림 영속 우선).
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('type', NEW.type),  -- 경량 페이로드(알림 종류만 — 상세는 클라가 unread-count/목록 재조회)
      'notification_new',                     -- event (다른 도메인 방송과 구별 — 교차 수신 방지)
      'user:' || NEW.recipient_id,            -- topic (per-user private 채널 — 조인 불필요)
      true                                    -- private (realtime.messages RLS 게이트)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN NEW;
END;
$$;

-- notification 신규 행마다 수신자 채널로 방송한다. 미읽음 배지가 실시간 갱신된다
--   (클라는 'notification_new' 수신을 신호로 unread-count 재조회 또는 낙관적 +1).
DROP TRIGGER IF EXISTS notification_broadcast ON "notification";
CREATE TRIGGER notification_broadcast
  AFTER INSERT ON "notification"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_notification_new();

-- realtime.messages SELECT 정책 — per-user private 채널 구독 인가(조인 불필요, moim: 정책보다 단순).
--   토픽 'user:'||auth.uid() 와 현재 구독 토픽이 일치할 때만 select 허용(남의 user: 토픽 구독 거부).
--   add_chat 의 "members can receive moim broadcasts"(moim:) 정책과 공존 — 둘 다 SELECT → OR 결합.
--
--   [실 DB 전용] realtime/auth 스키마는 Supabase 스택 DB(:54322)에만 존재하고 Prisma shadow DB
--   (vanilla Postgres)에는 없다. shadow 에서 ERROR 없이 검증되도록 to_regnamespace('realtime') 가드.
--   DROP POLICY IF EXISTS 로 재실행 멱등 확보(트리거 DROP IF EXISTS 컨벤션과 동일 — CREATE POLICY 는
--   IF NOT EXISTS 를 지원하지 않으므로 drop-then-create).
DO $$
BEGIN
  IF to_regnamespace('realtime') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS "users can receive own notifications" ON realtime.messages';
    EXECUTE $pol$
      CREATE POLICY "users can receive own notifications"
        ON realtime.messages
        FOR SELECT
        TO authenticated
        USING ( realtime.topic() = 'user:' || (SELECT auth.uid())::text )
    $pol$;
  END IF;
END $$;
