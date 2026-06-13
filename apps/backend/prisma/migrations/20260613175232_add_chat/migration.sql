-- CreateTable
CREATE TABLE "chat_message" (
    "id" BIGSERIAL NOT NULL,
    "moim_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_message_moim_id_id_idx" ON "chat_message"("moim_id", "id" DESC);

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_moim_id_fkey" FOREIGN KEY ("moim_id") REFERENCES "moim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────────────
-- SPEC-CHAT-001 수동 SQL (Prisma 스키마로 표현 불가 — R-6 드리프트 주의).
-- 이 블록은 prisma migrate diff에 잡히지 않으므로 .moai/project/db/에 문서화한다(T-010).
-- ──────────────────────────────────────────────────────────────────────────────

-- (1) content 길이 CHECK 제약 — 빈 메시지/과대 메시지를 DB 차원에서 거부한다(DTO 400 검증과 이중 강제).
--     서비스/컨트롤러 검증이 우회되어도 DB가 마지막 방어선이 된다(1..2000 char).
ALTER TABLE "chat_message"
  ADD CONSTRAINT "chat_message_content_length"
  CHECK (char_length("content") BETWEEN 1 AND 2000);

-- (2) chat_message RLS enable + 정책 없음(default deny).
--     Prisma는 postgres 롤로 직접 연결되므로 이 RLS의 영향을 받지 않는다(쓰기 인가 = NestJS 서비스 레이어).
--     용도: anon/authenticated 롤의 PostgREST 직접 접근을 차단(정책이 없으면 모두 거부 = default deny, research §5.2).
ALTER TABLE "chat_message" ENABLE ROW LEVEL SECURITY;

-- @MX:WARN: [AUTO] security-definer 트리거 함수 + Prisma-diff 비가시 드리프트 + realtime 스키마 의존.
-- @MX:REASON: 이 함수는 SECURITY DEFINER로 정의자(postgres) 권한으로 realtime.broadcast_changes를 호출한다.
-- search_path=''로 고정해 search_path 하이재킹을 막았다(보안 필수). 또한 트리거/RLS는 prisma schema로 표현
-- 불가해 `prisma migrate diff`에 잡히지 않으므로(R-6 드리프트), 스키마 변경 시 이 SQL을 수동 동기화해야 한다.
-- realtime 스키마가 없는 환경(Prisma shadow DB)에서는 정책이 가드되어 생략된다 — 실 DB에서만 완전 동작한다.
-- (3) broadcast 트리거 함수(security definer). 새 메시지가 영속 저장되면 모임 private 채널로 레코드를 전파한다(REQ-CHAT-002).
--     realtime.broadcast_changes(7-arg: topic, event, operation, table, schema, new, old)를 호출한다.
--       - topic = 'moim:'||moim_id → private channel 토픽(웹은 channel('moim:'+id, {private:true}) 구독).
--       - 내부적으로 realtime.send(private=true)로 realtime.messages에 넣어 RLS 게이트(아래 정책)를 거친다.
--       - level은 7-arg 시그니처에서 ROW로 기본 동작한다.
--     페이로드는 chat_message 레코드만 운반한다(트리거 thin 유지 — nickname 미포함, 소비 측 해석. spec §2/AC-1 Note).
CREATE OR REPLACE FUNCTION broadcast_chat_message()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.broadcast_changes(
    'moim:' || NEW.moim_id::text,  -- topic (private channel)
    'INSERT',                      -- event
    'INSERT',                      -- operation
    'chat_message',                -- table
    'public',                      -- schema
    NEW,                           -- new record
    NULL                           -- old record (insert-only)
  );
  RETURN NEW;
END;
$$;

-- (4) AFTER INSERT FOR EACH ROW 트리거 — 매 메시지 insert마다 broadcast 함수를 실행한다.
CREATE TRIGGER chat_message_broadcast
  AFTER INSERT ON "chat_message"
  FOR EACH ROW
  EXECUTE FUNCTION broadcast_chat_message();

-- (5) realtime.messages SELECT 정책 — private 채널 구독 인가(REQ-CHAT-004 / AC-4).
--     멤버십(moim_member) 조회로 게이트한다: 토픽 'moim:'||moim_id가 현재 구독 토픽과 일치하고
--     구독자(auth.uid())가 그 모임의 멤버일 때만 메시지 select를 허용한다(비멤버 구독 거부 = RLS 차단).
--
--     [실 DB 전용] realtime/auth 스키마는 Supabase 스택 DB(:54322)에만 존재하고 Prisma의 shadow DB
--     (마이그레이션 검증용 vanilla Postgres)에는 없다. shadow에서 ERROR 없이 검증되도록 realtime
--     스키마 존재 여부를 가드한다(to_regnamespace). 실 DB에서는 정상 생성된다(R-6 드리프트 문서화 대상).
DO $$
BEGIN
  IF to_regnamespace('realtime') IS NOT NULL THEN
    EXECUTE $pol$
      CREATE POLICY "members can receive moim broadcasts"
        ON realtime.messages
        FOR SELECT
        TO authenticated
        USING (
          EXISTS (
            SELECT 1 FROM public.moim_member m
            WHERE 'moim:' || m.moim_id::text = realtime.topic()
              AND m.user_id = (SELECT auth.uid())::text
          )
        )
    $pol$;
  END IF;
END $$;
