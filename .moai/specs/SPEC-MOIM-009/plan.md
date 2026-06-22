# SPEC-MOIM-009 구현 계획 (Plan)

> SPEC-MOIM-009: 투표 결과 실시간 갱신 — Supabase Realtime broadcast (CHAT-001 인프라 재사용)
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 검증된 인프라 재사용(brownfield). SPEC-CHAT-001 이 라이브 검증한 Realtime 스택(broadcast 트리거 + `realtime.messages` RLS + private 채널 `moim:{id}` + 웹 setAuth 구독)을 poll 도메인에 복제한다 — 새 메커니즘 발명 금지. 백엔드는 NestJS 코드 변경이 없으므로(순수 DB 트리거) 신규 jest 불필요(기존 회귀만). 웹은 테스트 하니스 부재 → build/lint/tsc + LIVE 다중 클라이언트 검증.
- **데이터 흐름(순서 의존)**: (1) hand-authored 트리거 마이그레이션(poll_vote/poll broadcast → `'poll_change'`) → (2) 웹 poll 구독 훅(usePollChannel — useChatChannel 미러) + PollsSection 구독/router.refresh + page.tsx accessToken 전달 → (3) LIVE 종단 증명(poll-realtime.live.mts — chat.live.mts 미러) → (4) 자동 게이트(tsc/lint/build/migrate status) + 기존 jest 회귀.
- **재사용 원칙**: 같은 채널 `moim:{id}`, 같은 `realtime.messages` 멤버십 RLS(새 RLS 0), 같은 broadcast API(`realtime.broadcast_changes` `SECURITY DEFINER`/`SET search_path=''`), 같은 웹 구독 패턴(setAuth + private + removeChannel). **유일한 의도적 차이 = 구별 이벤트명 `'poll_change'`**(채팅 `'INSERT'` 와 분리 — collision-avoidance).
- **additive 원칙**: 테이블/컬럼/PK/FK/인덱스 변경 0 — 트리거 함수 1개 + 트리거 2개만 추가(realtime 트리거는 SQL 에만 살고 Prisma 모델 변경 없음 — add_chat 선례). 웹은 accessToken prop + 구독 useEffect 추가(읽기 모델·응답 shape·api-client 무변경).
- **백엔드 NestJS 무변경**: broadcast 는 DB 트리거다. 기존 create/vote/close 핸들러가 이미 트리거를 발화시키는 row(poll_vote INSERT/DELETE, poll INSERT/UPDATE)를 변경하므로 NestJS 서비스/컨트롤러/게이트웨이 코드를 추가하지 않는다(REQ-MOIM9-003).
- **moimId 해소**: poll 트리거는 NEW/OLD.moim_id 직접 사용. poll_vote 트리거는 NEW/OLD.poll_id 로 `poll.moim_id` 조회(poll_vote 에 moim_id 컬럼 없음 — chat_message 와의 차이를 트리거가 흡수).
- **클라이언트 갱신**: PollsSection 이 `'poll_change'` 수신 시 `router.refresh()`(next/navigation) → Server Component(page.tsx → listPolls + getMoim) 재실행 → 집계 결과 + 자신의 myVotes + 헤더 startsAt 재조회(서버 = 단일 진실 출처). 행위자는 기존 revalidatePath, 타 멤버는 broadcast(self-broadcast 는 멱등 refresh 로 무해).

## 2. 데이터/인프라 모델 — broadcast 트리거 (핵심)

- 추가: plpgsql broadcast 함수(`SECURITY DEFINER`/`SET search_path=''`) + 트리거 2개.
- 토픽/이벤트/페이로드: 토픽 `'moim:' || moimId::text`(private), 이벤트 `'poll_change'`, 페이로드 `{ type: 'poll_change', moimId, pollId }`(경량 시그널 — 집계/myVotes 미포함).
- 트리거 매핑:
  - `poll` AFTER INSERT OR UPDATE → moimId = NEW.moim_id(또는 OLD on 필요 시), pollId = NEW.id.
  - `poll_vote` AFTER INSERT OR DELETE → moimId = (SELECT moim_id FROM poll WHERE id = COALESCE(NEW.poll_id, OLD.poll_id)), pollId = COALESCE(NEW.poll_id, OLD.poll_id).
- broadcast API 형태: add_chat 의 `broadcast_chat_message` 미러 — `realtime.broadcast_changes('moim:'||moimId, 'poll_change', TG_OP, TG_TABLE_NAME, 'public', NEW, OLD)` 또는 시그널만 보내는 `realtime.send(jsonb_build_object('type','poll_change','moimId',moimId,'pollId',pollId), 'poll_change', 'moim:'||moimId, true)` — **구현 시 add_chat 의 정확한 호출 형태를 읽어 같은 시그니처를 쓴다**(broadcast_changes 는 record 운반형, 경량 시그널이면 realtime.send 직접 호출이 더 적합 — Design Note 의 "집계 아닌 시그널" 의도에 맞춰 send 권장하되 add_chat 시그니처와 정합 확인).
- **마이그레이션 SQL(비파괴, hand-authored — add_chat 미러)**:
  ```sql
  -- broadcast 함수(security definer). poll/poll_vote 변경 시 모임 private 채널로 poll_change 시그널 전파.
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
      v_moim_id := COALESCE(NEW.moim_id, OLD.moim_id);
      v_poll_id := COALESCE(NEW.id, OLD.id);
    ELSE  -- poll_vote: moim_id 컬럼 없음 → poll 조회.
      v_poll_id := COALESCE(NEW.poll_id, OLD.poll_id);
      SELECT p.moim_id INTO v_moim_id FROM public.poll p WHERE p.id = v_poll_id;
    END IF;
    PERFORM realtime.send(
      jsonb_build_object('type', 'poll_change', 'moimId', v_moim_id, 'pollId', v_poll_id),
      'poll_change',                 -- event (채팅 'INSERT' 와 구별)
      'moim:' || v_moim_id,          -- topic (private channel)
      true                           -- private
    );
    RETURN COALESCE(NEW, OLD);
  END;
  $$;

  CREATE TRIGGER poll_broadcast
    AFTER INSERT OR UPDATE ON "poll"
    FOR EACH ROW EXECUTE FUNCTION broadcast_poll_change();

  CREATE TRIGGER poll_vote_broadcast
    AFTER INSERT OR DELETE ON "poll_vote"
    FOR EACH ROW EXECUTE FUNCTION broadcast_poll_change();
  ```
  (정확한 realtime API/시그니처는 add_chat migration.sql 의 호출 형태로 확정 — 위는 의도 예시. `realtime.send` private 시그니처가 add_chat 의 `broadcast_changes` 내부 호출과 정합하는지 확인. realtime 스키마 가드(`to_regnamespace('realtime')`)로 함수/트리거 생성을 감싸 shadow DB 검증 통과 — add_chat §5 미러.)
- 적용: `migration.sql` 수동 작성 → `prisma db execute --file` 로 적용 → `prisma migrate resolve --applied {TS}_add_poll_realtime_broadcast` → `prisma migrate status` clean(add_chat 선례). `prisma migrate dev` 의 파괴적 reset 회피. **테이블 변경 0** — `prisma migrate diff` 는 트리거 SQL 을 표현 못 하므로 diff 불사용(add_chat 동일 — hand-author).

## 3. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M4). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 broadcast 트리거 마이그레이션 (Priority: High)

- 사전 정독: `apps/backend/prisma/migrations/20260613175232_add_chat/migration.sql` 의 broadcast 함수(`broadcast_chat_message`)·`realtime.broadcast_changes`/`realtime.send` 호출 형태·토픽 포맷·private 플래그·`to_regnamespace('realtime')` 가드·`SECURITY DEFINER`/`SET search_path=''` 를 읽고 **정확히 미러**한다.
- `apps/backend/prisma/migrations/{TS}_add_poll_realtime_broadcast/migration.sql` (ADD, hand-authored):
  - broadcast 함수 `broadcast_poll_change`(SECURITY DEFINER / search_path='' / 이벤트 `'poll_change'` / 토픽 `'moim:'||moimId` / 페이로드 `{type,moimId,pollId}`). poll 분기는 NEW/OLD.moim_id + NEW/OLD.id, poll_vote 분기는 poll_id → poll.moim_id 조회.
  - 트리거 2개: `AFTER INSERT OR UPDATE ON "poll"` / `AFTER INSERT OR DELETE ON "poll_vote"`.
  - realtime 스키마 가드(to_regnamespace) — shadow DB 에서 함수/트리거 생성 생략(실 DB 만 동작).
  - `@MX:WARN` + `@MX:REASON`: security-definer + Prisma-diff 비가시 드리프트 + realtime 의존(add_chat 주석 미러). `.moai/project/db/` 문서화 대상(sync).
- 마이그레이션(비파괴 — §2): `prisma db execute --file {migration.sql}` → `prisma migrate resolve --applied {TS}_add_poll_realtime_broadcast` → `prisma migrate status` clean.
- 게이트: migrate status clean, 테이블/컬럼/PK/FK/인덱스 무변경(트리거만 추가), 기존 poll/vote/모임/채팅 row·동작 회귀 0. 백엔드 tsc 0(코드 변경 없음 — 회귀 확인).

### M2 — 웹 poll 구독 훅 + PollsSection 구독 + page.tsx 토큰 전달 (Priority: High, depends: M1)

- `apps/web/app/(main)/home/[id]/use-poll-channel.ts` (ADD, 선택 — 인라인 useEffect 대체 가능하나 채팅 대칭 위해 훅 권장):
  - `usePollChannel(moimId: string, accessToken: string | null, onChange: () => void): void` — useChatChannel 미러. `accessToken` 없으면 구독 안 함(토큰 가드). `createClient()` → `supabase.realtime.setAuth(accessToken)` → `.channel('moim:'+moimId, { config: { private: true } }).on('broadcast', { event: 'poll_change' }, () => onChange()).subscribe()`. cleanup: `supabase.removeChannel(channel)`. 페이로드는 시그널만이라 record 해석 없이 onChange 콜백(채팅의 record 추출과 다름 — 시그널 = 단순 트리거).
  - `@MX:NOTE`: 채팅과 같은 채널 `moim:{id}` 공유, 구별 이벤트명 `'poll_change'` 로 교차 수신 방지.
- `apps/web/app/(main)/home/[id]/polls-section.tsx` (MODIFY):
  - props 에 `accessToken: string | null` 추가(기존 `moimId`/`polls`/`currentUserId` 보존).
  - `useRouter`(next/navigation) import + `usePollChannel(moimId, accessToken, () => router.refresh())` 호출(또는 인라인 useEffect 동일 패턴). 수신 시 router.refresh() → Server Component 재실행 → 투표 섹션 + 헤더 startsAt 재조회.
  - poll 렌더/투표/마감/생성 로직 무변경(MOIM-005~008 그대로 — 실시간은 refresh 가 기존 렌더 재실행).
- `apps/web/app/(main)/home/[id]/page.tsx` (MODIFY):
  - `<PollsSection moimId={moim.id} polls={polls} currentUserId={session.user.id} accessToken={session.access_token} />` — accessToken 한 줄 추가. 헤더 startsAt 렌더·polls/moim fetch·가드 무변경.
- 게이트: web tsc 0(accessToken prop + 구독 훅 + router.refresh), web lint 0, `nx run web:build` 0.

### M3 — LIVE 종단 증명 스크립트 (poll-realtime.live.mts) (Priority: High, depends: M1, M2)

- `apps/backend/test/poll-realtime.live.mts` (ADD — chat.live.mts 미러, 수동/라이브 실행 CI 게이트 아님):
  - 멤버 2명(member A/B) + 비멤버 1명(stranger)을 `auth.admin.createUser` + `signInWithPassword` 로 생성(chat.live.mts `makeUser` 미러).
  - service_role 로 moim + moim_member(A, B) 시드(stranger 는 비멤버), profile upsert.
  - `waitForPollChange(token, moimId, timeoutMs)` — `createClient(SUPABASE_URL, ANON)` → `setAuth(token)` → `.channel('moim:'+moimId, {config:{private:true}}).on('broadcast', { event: 'poll_change' }, ({payload}) => resolve(payload)).subscribe()` → timeout 후 null(chat.live.mts `waitForBroadcast` 미러, 이벤트명만 poll_change).
  - 시나리오: (a) A,B,stranger 구독 → member A 가 NestJS 앱으로 `POST /moims/:id/polls`(생성) → A,B 수신·stranger 미수신; (b) A 가 `POST .../vote`(poll_vote INSERT) → A,B 수신·stranger 미수신; (c) A(생성자) `POST .../close`(poll UPDATE) → A,B 수신·stranger 미수신. 각 케이스 PASS/FAIL 로그.
  - (선택) 채팅 collision-avoidance: 채팅 `'INSERT'` 구독자가 poll_change 미수신 / poll `'poll_change'` 구독자가 채팅 INSERT 미수신 관찰.
- 실행 전제(chat.live.mts 동일): `pnpm exec nest build`(또는 nx run backend:build) 후 `node --experimental-strip-types test/poll-realtime.live.mts`. 실 Supabase 스택(:54321/:54322) + 본 SPEC 트리거 마이그레이션 적용 완료 + SUPABASE_URL/ANON/SERVICE_ROLE + DATABASE_URL env.
- 게이트: LIVE PASS — 두 멤버 수신 + 비멤버 미수신(RLS) + (선택) collision-avoidance.

### M4 — 회귀 + 디바이스 종단 검증 (Priority: High, depends: M1~M3)

- 기존 backend jest 회귀(poll/chat — 트리거 추가가 핸들러/응답/인가에 영향 없음, GREEN 유지). backend/api-client tsc 무변경 회귀 0.
- mobile tsc/vitest/expo export 회귀 0(무변경 — REQ-MOIM9-006).
- 디바이스 종단 검증(device-gated): 두 클라이언트(브라우저 탭 2개 또는 브라우저 + iOS WebView)가 같은 모임 상세에서 — 한쪽 투표/생성/마감 → 다른 쪽 투표 섹션 리로드 없이 라이브 갱신(새 표/새 투표/마감), 날짜 투표 finalize 면 다른 쪽 헤더 일정도 라이브 확정, 각 멤버 myVotes 올바름 확인.
- 게이트: 위 모든 자동 게이트 GREEN + LIVE PASS → status in-progress. 디바이스 라이브 검증 통과 → completed.

## 4. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] broadcast 트리거가 add_chat 의 메커니즘(realtime API·토픽 포맷·private 플래그·SECURITY DEFINER·search_path=''·realtime 스키마 가드)을 정확히 미러하는가?
- [ ] 이벤트명이 **`'poll_change'`**(채팅 `'INSERT'` 와 구별)이고, 페이로드가 경량 시그널(`{type,moimId,pollId}` — 집계/myVotes 미포함)인가?
- [ ] poll 트리거가 AFTER INSERT OR UPDATE, poll_vote 트리거가 AFTER INSERT OR DELETE 인가? poll_vote 가 poll_id → poll.moim_id 조회로 moimId 를 해소하는가(DELETE 시 OLD.poll_id)?
- [ ] 채널 `moim:{id}` 와 `realtime.messages` RLS 가 그대로 재사용되고(새 채널/새 RLS 0), 비멤버가 RLS 로 차단되는가?
- [ ] 마이그레이션이 테이블/컬럼/PK/FK/인덱스를 한 줄도 안 바꾸고(트리거만 추가), hand-authored 비파괴 패턴(db execute/resolve/status clean)으로 적용되는가? migrate status clean(shadow DB 가드)?
- [ ] 백엔드 NestJS 코드가 무변경인가(broadcast 는 순수 트리거 — 기존 create/vote/close 가 row 변경으로 발화)?
- [ ] PollsSection 이 accessToken 으로 구독하고(setAuth + private + 'poll_change'), 수신 시 router.refresh() 로 Server Component 재실행해 집계 + 자신의 myVotes + 헤더 startsAt 을 재조회하는가? 언마운트 시 removeChannel?
- [ ] accessToken 없으면 구독 안 하는가(토큰 가드)? self-broadcast 가 멱등 refresh 로 무해(루프 없음)인가?
- [ ] page.tsx 가 `accessToken={session.access_token}` 를 전달하고 기존 props(moimId/polls/currentUserId)·fetch·가드를 보존하는가?
- [ ] 모바일이 무변경이고 WebView 가 구독하는 웹 클라이언트를 그대로 실행하는가?
- [ ] LIVE 스크립트(poll-realtime.live.mts)가 두 멤버 수신 + 비멤버 미수신(RLS) + (선택) 채팅/투표 교차 수신 0 을 증명하는가?
- [ ] 디바이스에서 한쪽 투표/생성/마감 → 다른 쪽 리로드 없이 라이브 갱신(+날짜 finalize 면 헤더 일정 라이브) + myVotes 올바름인가?

## 5. 검증 게이트 (요약)

spec.md §7 참조. 핵심: prisma migrate clean(트리거 함수 + 트리거 2개 추가, 테이블/PK/FK 변경 0, 기존 row 보존, realtime 가드) → 백엔드 NestJS 무변경(신규 jest 불필요, 기존 poll/chat jest GREEN 회귀) → web tsc 0(accessToken prop + 구독 + router.refresh) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → **LIVE 종단 증명(poll-realtime.live.mts — 두 멤버 수신 + 비멤버 미수신 RLS + collision-avoidance)** → 디바이스 종단 검증(다중 클라이언트 라이브 갱신 + myVotes 올바름 + 날짜 finalize 헤더 라이브).

## 6. 위임/협의 권장

- 백엔드 broadcast 트리거(add_chat 메커니즘 미러·poll_vote moimId 조회·이벤트명 collision-avoidance·hand-authored 비파괴 마이그레이션·realtime 스키마 가드)·LIVE 스크립트(poll-realtime.live.mts): expert-backend 협의 가능(Postgres 트리거 + Supabase Realtime broadcast + RLS 재사용 + chat.live.mts 미러). 보안 SECURITY DEFINER/search_path 검토는 expert-security 협의 가능.
- 웹 poll 구독 훅(useChatChannel 미러)·PollsSection 구독/router.refresh·page.tsx 토큰 전달: expert-frontend 협의 가능(supabase Realtime setAuth/private 구독 + Next.js router.refresh Server Component 재실행 + 토큰 prop 전달 패턴).
