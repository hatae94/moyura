---
id: SPEC-MOIM-009
version: 0.1.0
status: draft
created: 2026-06-22
updated: 2026-06-22
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-009: 투표 결과 실시간 갱신 — Supabase Realtime broadcast (CHAT-001 인프라 재사용)

## HISTORY

- 2026-06-22 (v0.1.0): 최초 draft. SPEC-MOIM-005(단일 선택)→006(다중 선택)→007(마감)→008(일정 투표 자동 확정 — 모두 구현 완료)이 키운 poll 시리즈의 직속 후속. 현재 투표 결과는 **행위자 자신의 액션(`revalidatePath`)이나 페이지 리로드에서만** 갱신되어, 같은 모임의 다른 멤버는 새 표/새 투표/마감을 실시간으로 보지 못한다. 본 SPEC은 poll 변경을 그 모임 모든 멤버에게 실시간 전파하되, **검증된 SPEC-CHAT-001 Realtime 스택을 그대로 재사용**한다(새 메커니즘을 발명하지 않는다 — 아키텍처 베이스라인). **핵심 결정**: (1) **이벤트 범위 = 투표 + poll 라이프사이클** — `poll_vote` INSERT/DELETE(표 수 변동 — 단일 교체·다중 토글이 모두 poll_vote 를 건드림) AND `poll` INSERT/UPDATE(새 투표 생성·closesAt/finalize on close)에 broadcast. 멤버가 실시간으로 보는 것: 새 득표 수, 새 투표 등장, 마감됨/일정 확정(MOIM-007/008). (2) **채널 + RLS 재사용** — CHAT-001 이 이미 만든 **같은 private 채널 `moim:{id}`** 와 **같은 `realtime.messages` 멤버십 RLS**(멤버만 수신, 비멤버는 RLS 차단)를 그대로 쓴다 — 새 RLS 없음. poll broadcast 는 **구별되는 이벤트명 `'poll_change'`**(`'INSERT'` 아님)를 쓴다 — 채팅 페이지가 같은 채널에서 `'INSERT'` 이벤트를 필터링하므로, 구별 이벤트명으로 채팅/투표 구독자의 교차 수신을 막는다(collision-avoidance). (3) **경량 시그널 페이로드** — broadcast 는 집계 결과가 아니라 최소 시그널 `{ type: 'poll_change', moimId, pollId }` 만 운반한다. 근거(Design Note): 투표 집계(옵션별 voteCount)와 특히 `myVotes` 는 구독자별(per-subscriber)이라 트리거 broadcast 에서 미리 계산할 수 없다 — 시그널은 "모임 X 의 poll 이 바뀌었다" 만 말하고, 각 클라이언트가 재조회로 자신의 올바른 집계 뷰를 얻는다(서버가 단일 진실 출처 — CHAT-001 + revalidatePath 철학 동일). poll_vote 트리거는 변경된 vote 의 `poll_id` 로 `poll.moim_id` 를 조회해 `moimId` 를 해소한다(chat_message 는 moim_id 직접 보유, poll_vote 는 미보유 — 트리거가 poll 조회). (4) **클라이언트 갱신 = router.refresh()** — PollsSection(Client Component)이 `moim:{id}`(private, `setAuth(token)`)를 구독하고 `'poll_change'` 이벤트 수신 시 Next.js `router.refresh()`(`next/navigation`)를 호출한다. 이는 Server Component(page.tsx → listPolls + getMoim)를 재실행해 집계된 poll 결과 AND 모임 헤더 startsAt(다른 멤버의 날짜 투표 finalize 가 모두의 헤더를 실시간 갱신)을 새로 가져온다. 각 멤버의 재조회가 자신의 myVotes 를 산출한다. 토큰 + NEXT_PUBLIC_SUPABASE_URL/ANON 은 채팅 클라이언트가 얻는 방식 그대로 미러한다(page.tsx 가 session.access_token 전달, public supabase 설정은 NEXT_PUBLIC_* 로 client-side 가용). 언마운트 시 removeChannel 정리(채팅 미러). **백엔드** = 순수 DB 트리거(NestJS 코드 변경 없음 — 기존 POST vote/close/create 가 이미 트리거를 발화시키는 row 를 변경한다). **모바일** = 무변경(상세 페이지는 in-WebView 렌더, WebView 가 이미 구독하는 웹 클라이언트를 실행). **제외**: presence/typing·optimistic UI·per-poll 부분 패칭·새 채널/RLS·채팅 변경·모바일 네이티브·debounce 보장(optional)·기본 supabase-js 이상의 offline/reconnect. **device-gated**: 자동 게이트 단독으로 completed 전환 불가(프로젝트 메모리 규칙: mobile WebView SPEC device-gated). LIVE 검증(핵심 게이트, chat.live.mts 미러): 두 멤버 클라이언트가 한 명의 투표/생성/마감에 `'poll_change'` broadcast 를 둘 다 수신 + 비멤버는 RLS 차단(미수신).

---

## 1. 개요 (Overview)

SPEC-MOIM-005(단일 선택)→006(다중 선택)→007(마감)→008(일정 투표 자동 확정)이 모임 투표를 단계적으로 키웠다. 그러나 투표 결과는 여전히 **행위자 자신의 액션에서만** 갱신된다 — 멤버가 투표/생성/마감하면 그 멤버의 Server Action 이 `revalidatePath` 로 그 사람의 화면만 새로 그리고, **같은 모임의 다른 멤버는 페이지를 리로드하기 전까지** 새 표·새 투표·마감/일정 확정을 보지 못한다. 본 SPEC은 그 마지막 한 걸음 — **poll 변경의 실시간 전파** — 를 채운다: 한 멤버가 투표/생성/마감하면 그 모임 모든 멤버의 투표 섹션이 라이브로 갱신된다.

본 SPEC의 가장 중요한 결정은 **새 실시간 메커니즘을 발명하지 않는다**는 것이다. SPEC-CHAT-001 이 이미 만들고 라이브 검증한 Realtime 스택 — Postgres broadcast 트리거 + `realtime.messages` 멤버십 RLS + private 채널 `moim:{id}` + 웹 `setAuth`/`config:{private:true}` 구독 — 을 그대로 재사용한다(REQ-CHAT-002 실시간 전파 / REQ-CHAT-004 비멤버 구독 차단 / REQ-CHAT-006 웹 구독 UI 가 베이스라인).

본 SPEC의 실시간 갱신은 네 가지 결정 위에 세운다:

1. **이벤트 범위 = 투표 + poll 라이프사이클** — broadcast 시그널은 (a) `poll_vote` INSERT/DELETE(표 수 변동 — MOIM-005 단일 교체와 MOIM-006 다중 토글이 모두 poll_vote 를 INSERT/DELETE 한다), AND (b) `poll` INSERT/UPDATE(새 투표 생성·MOIM-007 마감 closesAt·MOIM-008 finalize on close)에서 발화한다. 멤버가 실시간으로 보는 것: 새 득표 수, 새 투표가 목록에 등장, 마감됨/일정 확정.
2. **채널 + RLS 재사용** — CHAT-001 이 만든 **같은 private 채널 `moim:{id}`** 와 **같은 `realtime.messages` 멤버십 RLS**(`moim_member` 조회로 게이트 — 멤버만 수신, 비멤버는 RLS 차단)를 그대로 쓴다. **새 RLS 정책을 추가하지 않는다** — poll broadcast 도 `realtime.messages` 를 거치므로 같은 멤버십 게이트의 보호를 자동으로 받는다.
3. **경량 시그널 페이로드 + 구별 이벤트명** — broadcast 는 집계 결과가 아니라 최소 시그널 `{ type: 'poll_change', moimId, pollId }` 만 운반하고, 이벤트명은 **`'poll_change'`**(채팅의 `'INSERT'` 아님)를 쓴다. 채팅 페이지가 같은 채널 `moim:{id}` 에서 `'INSERT'` 이벤트를 필터링하므로, poll 이 구별 이벤트명을 쓰면 채팅 구독자와 poll 구독자가 서로의 broadcast 를 교차 수신하지 않는다(collision-avoidance).
4. **클라이언트 갱신 = router.refresh()** — PollsSection(Client Component)이 구독하고, `'poll_change'` 수신 시 `router.refresh()` 로 Server Component(page.tsx)를 재실행한다 — 집계된 poll 결과 AND 모임 헤더 startsAt 을 서버에서 새로 가져오므로, 각 멤버는 자신의 myVotes 가 포함된 올바른 뷰를, 그리고 다른 멤버가 일으킨 일정 확정(MOIM-008)을 라이브로 받는다(서버 = 단일 진실 출처).

**시그널이 집계가 아닌 이유**(핵심 Design Note): 옵션별 voteCount 는 트리거에서 집계할 수도 있지만 `myVotes`(호출자 자신의 표)는 **구독자마다 다르다** — 한 broadcast 페이로드에 모든 구독자의 myVotes 를 담을 수 없다. 그래서 broadcast 는 "모임 X 의 poll 이 바뀌었다" 라는 시그널만 보내고, 각 클라이언트가 `router.refresh()` 로 재조회해 **자신의** 올바른 집계 뷰(voteCount + 자신의 myVotes)를 얻는다. 이는 CHAT-001 의 thin-trigger 철학(트리거는 시그널만, 해석은 클라이언트) + MOIM-005~008 의 revalidatePath 철학(서버가 진실 출처)과 정확히 일치한다.

`moimId` 해소: `poll` 테이블은 `moim_id` 컬럼을 직접 가지므로 poll 트리거는 `NEW.moim_id`/`OLD.moim_id` 를 그대로 쓴다. 그러나 `poll_vote` 테이블은 `moim_id` 가 없고 `poll_id` 만 가지므로, poll_vote 트리거는 변경된 vote 의 `poll_id` 로 `poll.moim_id` 를 **조회**해 토픽 `moim:{moimId}` 를 만든다(chat_message 는 moim_id 직접 보유 — 그 차이를 트리거가 흡수한다).

데이터는 **테이블 변경이 전혀 없다** — `poll`/`poll_option`/`poll_vote`/`moim` 의 컬럼·관계·PK 를 한 줄도 건드리지 않고, **plpgsql broadcast 트리거 함수 + 트리거 2개(poll_vote, poll)만 additive 추가**한다(realtime 트리거는 SQL 에만 살고 Prisma schema 모델 변경 없음 — add_chat 선례). **백엔드 NestJS 코드 변경도 없다** — broadcast 는 순수 DB 트리거이고, 기존 POST vote/close/create 핸들러가 이미 트리거를 발화시키는 row 를 변경하므로 백엔드 코드는 그대로다(SQL 마이그레이션 1개만 추가).

마이그레이션은 MOIM-005~008 과 동일한 **비파괴 패턴**으로 적용하되, raw 트리거 SQL 은 `prisma migrate diff` 로 표현되지 않으므로 add_chat 처럼 **hand-author** 한다(`migration.sql` 수동 작성 → `prisma db execute` → `prisma migrate resolve --applied` → `migrate status` clean). `prisma migrate dev` 의 파괴적 reset 은 hand-edited add_chat/poll 트리거 때문에 쓰지 않는다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 실시간 구독은 모임 상세(`/home/[id]`)의 PollsSection(Client) 안에서 일어나고, 모바일 WebView 가 이미 그 웹 클라이언트를 실행하므로 **모바일 신규 코드는 없다**.

이는 **broadcast 트리거 함수 1개 + 트리거 2개 SQL 마이그레이션 + 웹 PollsSection 구독(router.refresh) + page.tsx accessToken 전달**이지 대형 기능이 아니다. presence·typing·optimistic UI·per-poll 부분 패칭·새 채널/RLS·채팅 변경·모바일 코드·debounce 보장은 모두 제외한다(§4).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 6개로 제한한다. 각 모듈은 `REQ-MOIM9-XXX`로 번호를 부여하며(기존 `REQ-MOIM5/6/7/8-XXX`·`REQ-CHAT-XXX` 등과 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM9-001: poll broadcast 트리거 + 비파괴 마이그레이션 (Ubiquitous) — AC-1

- **The backend shall** `poll_vote`(AFTER INSERT OR DELETE)와 `poll`(AFTER INSERT OR UPDATE)에 broadcast 트리거를 **additive**(기존 테이블·컬럼·관계·인덱스·PK 무변경)로 추가한다 — 이 변경은 plpgsql 트리거 함수 + 트리거 2개만 더할 뿐 어떤 테이블·컬럼도 만들거나 바꾸지 않는다(MOIM-005~008 데이터 동작 보존).
- **The backend shall** 이 broadcast 를 SPEC-CHAT-001 이 검증한 **같은 메커니즘**으로 발행한다 — `realtime.broadcast_changes`(또는 add_chat 이 호출하는 동일 API 형태)를 `SECURITY DEFINER` + `SET search_path = ''` 트리거 함수에서 호출하고, 토픽 `'moim:' || moimId` 로 private 채널에 전파한다(add_chat 의 broadcast 호출 형태·토픽 포맷·private 플래그를 그대로 미러).
- **The backend shall** broadcast 이벤트명을 **`'poll_change'`** 로 둔다 — 채팅이 같은 채널 `moim:{id}` 에서 쓰는 `'INSERT'` 와 **구별되는 이벤트명**으로, 채팅 구독자와 poll 구독자의 교차 수신을 방지한다(collision-avoidance).
- **The backend shall** broadcast 페이로드를 최소 시그널(`{ type: 'poll_change', moimId, pollId }` 형태)로 운반한다 — 집계(voteCount)·myVotes·옵션 등 결과 데이터를 싣지 않는다(트리거 thin 유지, 클라이언트 재조회로 해석 — §5).
- **The backend shall** `poll_vote` 트리거에서 `moimId` 를 변경된 vote 의 `poll_id` 로 `poll.moim_id` 를 **조회**해 해소한다(poll_vote 에 moim_id 컬럼이 없으므로 — chat_message 와의 차이를 트리거가 흡수). `poll` 트리거에서는 `NEW.moim_id`/`OLD.moim_id` 를 직접 쓴다.
- **The backend shall** `realtime` 스키마가 없는 환경(Prisma shadow DB)에서 트리거 함수 정의가 에러 없이 검증되도록 add_chat 과 같은 가드를 둔다(realtime 스키마 존재 여부 가드 — 실 DB 에서만 완전 동작).
- **The backend shall** 이 변경을 add_chat 선례대로 **hand-authored 비파괴 마이그레이션**으로 적용한다 — raw 트리거 SQL 은 `prisma migrate diff` 로 표현되지 않으므로 `migration.sql` 을 직접 작성하고(`prisma db execute` → `prisma migrate resolve --applied` → `prisma migrate status` clean), `prisma migrate dev` 의 파괴적 reset 을 피한다. 마이그레이션 타임스탬프는 `20260621000000`(add_poll_kind_option_date) 이후로 둔다(예: `20260622xxxxxx_add_poll_realtime_broadcast`).

### REQ-MOIM9-002: 채널 + RLS 재사용 — 새 RLS 없음 (Ubiquitous / State-driven 혼합) — AC-2

- (Ubiquitous) **The backend shall** poll broadcast 를 SPEC-CHAT-001 이 만든 **같은 private 채널 `moim:{id}`** 로 전파한다 — 새 채널/토픽 네임스페이스를 만들지 않는다(채팅과 같은 토픽, 구별 이벤트명으로 분리).
- (Ubiquitous) **The backend shall** poll broadcast 의 수신 인가를 SPEC-CHAT-001 이 만든 **같은 `realtime.messages` 멤버십 RLS**(`moim_member` 조회 게이트, REQ-CHAT-004)로 처리한다 — poll 용 **새 RLS 정책을 추가하지 않는다**. poll broadcast 도 `realtime.messages` 를 거치므로 같은 멤버십 게이트가 자동 적용된다.
- (State-driven, 멤버 수신) **WHILE** 한 사용자가 그 모임의 멤버인 동안, **WHEN** 그 모임의 poll 이 바뀌어(투표/생성/마감) broadcast 가 발화하면, **the backend shall** 그 멤버의 `moim:{id}` private 채널 구독에 `'poll_change'` 시그널을 전달한다(`realtime.messages` RLS 가 멤버십을 확인해 허용).
- (Unwanted behavior, 비멤버 차단) **IF** 한 사용자가 그 모임의 멤버가 아니면, **then the backend shall** 그 사용자의 `moim:{id}` 구독에 `'poll_change'`(및 채팅 `'INSERT'`) broadcast 를 전달하지 **않는다** — `realtime.messages` RLS 가 멤버십 부재로 select 를 거부한다(REQ-CHAT-004 와 동일 게이트 — 비멤버는 투표 변동을 실시간으로도 보지 못한다).

### REQ-MOIM9-003: 백엔드 NestJS 무변경 — 트리거가 발화 (Ubiquitous) — AC-3

- **The backend shall** 본 실시간 갱신을 위해 **NestJS 애플리케이션 코드를 변경하지 않는다** — broadcast 는 순수 DB 트리거이고, 기존 `POST /moims/:id/polls`(생성), `POST .../vote`(투표 — INSERT/DELETE poll_vote), `POST .../close`(마감 — UPDATE poll, MOIM-008 finalize 포함)가 이미 트리거를 발화시키는 row 를 변경한다.
- **The backend shall** poll 도메인의 기존 동작(생성·투표·목록·마감·finalize)과 인가(assertMember/생성자 전용 close)를 모두 보존한다 — 트리거 추가는 핸들러 로직·응답 shape·인가에 영향을 주지 않는다(MOIM-005~008 회귀 0).
- **The backend shall** 트리거가 단일 트랜잭션 안에서 row 변경 직후 동기적으로 발화하도록 보장한다(AFTER ROW 트리거) — 별도 백그라운드 잡·크론·메시지 큐 없이 기존 핸들러의 DB 쓰기가 곧 broadcast 를 일으킨다.

### REQ-MOIM9-004: 웹 PollsSection 실시간 구독 + router.refresh (Event-driven / State-driven / Ubiquitous 혼합) — AC-4

- (Ubiquitous, 구독) **The web app shall** PollsSection(Client Component)에서 모임 상세 진입 시 access_token 으로 `moim:{id}` private 채널을 구독한다(`createClient()` → `supabase.realtime.setAuth(accessToken)` → `.channel('moim:'+id, { config: { private: true } }).on('broadcast', { event: 'poll_change' }, ...).subscribe()`) — SPEC-CHAT-001 의 `useChatChannel` 구독/setAuth 패턴을 그대로 미러하되 이벤트명만 `'poll_change'` 로 한다.
- (Event-driven, 갱신) **WHEN** PollsSection 이 `'poll_change'` broadcast 를 수신하면, **the web app shall** Next.js `router.refresh()`(`next/navigation`)를 호출해 Server Component(page.tsx → `listPolls` + `getMoim`)를 재실행하고, 그 결과로 투표 섹션(집계 결과 + 호출자 자신의 myVotes)과 모임 헤더 일정(`startsAt`)을 둘 다 새로 렌더한다(각 멤버는 자신의 myVotes 를, 그리고 다른 멤버의 날짜 투표 finalize 가 일으킨 일정 확정을 라이브로 받는다).
- (State-driven, 토큰 가드) **WHILE** access_token 이 없는 동안, **the web app shall** 구독하지 않는다(private 채널은 토큰 없이는 RLS 가 거부 — useChatChannel 의 토큰 가드와 동일).
- (Ubiquitous, 정리) **The web app shall** 언마운트/의존성 변경 시 채널을 정리한다(`removeChannel`) — 중복 구독·메모리 누수 방지(useChatChannel 미러).
- (Optional, debounce) **Where** rapid 한 연속 시그널(짧은 시간 다수 표/변경)이 발생하는 경우, **the web app may** 짧은 타이머로 `router.refresh()` 호출을 coalesce 할 수 있다 — 단 MVP 는 단순 유지가 우선이며 debounce 는 **optional**(보장하지 않음).

### REQ-MOIM9-005: page.tsx accessToken 전달 (Ubiquitous) — AC-5

- **The web app shall** 모임 상세 Server Component(`page.tsx`)에서 세션 `access_token` 을 PollsSection 에 prop 으로 전달한다(`accessToken={session.access_token}`) — 채팅 페이지가 토큰을 클라이언트에 넘기는 방식을 미러한다. public supabase 설정(NEXT_PUBLIC_SUPABASE_URL/ANON)은 이미 client-side 가용(NEXT_PUBLIC_* 인라인)이므로 추가 전달이 필요 없다.
- **The web app shall** 기존 `currentUserId`(세션 user.id) prop 전달(MOIM-007/008)과 polls/moim fetch·가드를 그대로 보존한다 — accessToken 추가는 순수 prop 추가다(기존 props 무변경).
- **The web app shall** poll fetch/render 로직을 변경하지 않는다 — `router.refresh()` 가 기존 서버 fetch(`listPolls` + `getMoim`)를 재실행하므로, 실시간 갱신은 추가 fetch 코드 없이 기존 Server Component 재실행만으로 이뤄진다.

### REQ-MOIM9-006: 모바일 무변경 — WebView 가 구독 (Ubiquitous) — AC-6

- **The mobile app shall** 본 실시간 갱신을 위해 **신규 네이티브 코드를 추가하지 않는다** — 모임 상세는 `/home/[id]` 안에서 in-WebView 로 렌더되고, WebView 가 이미 PollsSection(구독하는 웹 클라이언트)을 실행하므로 실시간 구독은 WebView 안에서 자동으로 동작한다.
- **The mobile app shall** 기존 동작(상세 라우트 네이티브 push 는 SPEC-MOIM-003 계약, WebView 호스팅)을 모두 보존한다(회귀 0).

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 MOIM-005~008 이 만든 poll 도메인 + CHAT-001 이 만든 Realtime 스택을 확장한다. 파일·라인은 작성 시점(2026-06-22) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/prisma/migrations/20260613175232_add_chat/migration.sql` 의 broadcast 트리거 함수(`broadcast_chat_message`, `realtime.broadcast_changes` 7-arg, `SECURITY DEFINER`/`SET search_path=''`) + `realtime.messages` SELECT 정책("members can receive moim broadcasts", `moim_member` 게이트) + `to_regnamespace('realtime')` 가드 — **무변경, 재사용 대상**(미러할 호출 형태·토픽 포맷·private 플래그·realtime 스키마 가드의 원본). poll 트리거가 이 형태를 복제한다.
- `apps/backend/prisma/schema.prisma` 의 `Poll`/`PollOption`/`PollVote`/`Moim`/`ChatMessage` 모델 — **무변경**(realtime 트리거는 SQL 에만 살고 Prisma 모델 변경 없음 — add_chat 선례).
- `apps/backend/src/poll/**`(poll.service.ts·poll.controller.ts·DTO) — **무변경**. broadcast 는 순수 DB 트리거이고, 기존 create/vote/close 핸들러가 이미 트리거를 발화시키는 row 를 변경한다(NestJS 코드 변경 없음 — REQ-MOIM9-003).
- `apps/backend/src/moim/**`·`apps/backend/src/chat/**` — **무변경**.
- `apps/web/lib/chat/useChatChannel.ts` — **무변경, 미러 대상**(구독/setAuth/private 채널/removeChannel 패턴의 원본). poll 구독 훅이 이 패턴을 복제하되 이벤트명만 `'poll_change'` 로 한다.
- `apps/web/app/moims/[id]/chat/page.tsx` 의 `'INSERT'` 이벤트 구독 — **무변경**. poll 이 구별 이벤트명 `'poll_change'` 를 쓰므로 채팅의 `'INSERT'` 필터와 교차 수신하지 않는다(collision-avoidance — 채팅은 그대로 INSERT 만 받는다).
- `apps/web/lib/supabase/client.ts`(`createClient`)·`apps/web/lib/env.ts`(`SUPABASE_CONFIG`) — **무변경, 재사용**(브라우저 supabase 클라이언트 + 검증된 NEXT_PUBLIC_* 설정).
- `apps/web/lib/moim/polls.ts`(`listPolls`/`PollWithResults`)·`apps/web/lib/moim/api.ts`(`getMoim`/`formatMoimSchedule`) — **무변경**. `router.refresh()` 가 기존 fetch 를 재실행하므로 fetch/타입 변경 없음.
- `apps/web/app/(main)/home/[id]/poll-actions.ts`(create/vote/close Server Action + revalidatePath) — **무변경**. 실시간 갱신은 broadcast → router.refresh 경로로 추가되며, 행위자 자신의 revalidatePath 는 그대로(이중 갱신이 아니라 보완 — 행위자는 revalidatePath, 타 멤버는 broadcast).
- `apps/mobile/**` — **모바일 무변경**(REQ-MOIM9-006). WebView 가 구독하는 웹 클라이언트를 이미 실행한다.

### [MODIFY] (수정)

- `apps/web/app/(main)/home/[id]/polls-section.tsx`:
  - 실시간 구독(useEffect 또는 신규 훅 호출) 추가 — `accessToken` prop 으로 `moim:{id}` private 채널을 구독(`setAuth` + `config:{private:true}` + `on('broadcast', { event: 'poll_change' })`), 수신 시 `router.refresh()`(`useRouter` from `next/navigation`) 호출, 언마운트 시 `removeChannel`. useChatChannel 의 구독/정리 패턴 미러.
  - `PollsSection` props 에 `accessToken: string | null` 추가(기존 `moimId`/`polls`/`currentUserId` 보존).
- `apps/web/app/(main)/home/[id]/page.tsx`:
  - `<PollsSection ... accessToken={session.access_token} />` 로 토큰 전달 추가(기존 `moimId`/`polls`/`currentUserId` 전달 보존). 헤더 startsAt 렌더·polls/moim fetch·가드 무변경.

### [ADD] (신규)

- `apps/backend/prisma/migrations/{TS}_add_poll_realtime_broadcast/migration.sql`(신규) — hand-authored 비파괴 트리거 마이그레이션: plpgsql broadcast 함수(`SECURITY DEFINER`/`SET search_path=''`, `realtime.broadcast_changes` 또는 add_chat 동일 API, 토픽 `'moim:'||moimId`, 이벤트 `'poll_change'`, 페이로드 `{type,moimId,pollId}`) + `to_regnamespace('realtime')` 가드 + 트리거 2개(AFTER INSERT OR DELETE ON poll_vote / AFTER INSERT OR UPDATE ON poll). poll_vote 트리거는 `poll_id` → `poll.moim_id` 조회로 moimId 해소, poll 트리거는 NEW/OLD.moim_id 직접 사용. 테이블/컬럼 변경 없음.
- `apps/web/app/(main)/home/[id]/use-poll-channel.ts`(신규, 선택) — poll 실시간 구독 훅(`usePollChannel(moimId, accessToken, onChange)`). useChatChannel 미러(이벤트명 `'poll_change'`, 페이로드는 시그널만 — record 해석 없이 onChange 콜백). PollsSection 인라인 useEffect 로 대체 가능하나 채팅과 대칭을 위해 훅 권장.
- `apps/backend/test/poll-realtime.live.mts`(신규) — LIVE 종단 증명 스크립트(chat.live.mts 미러). 멤버 2명 + 비멤버 1명을 시드하고, 한 멤버가 투표/생성/마감할 때 두 멤버 클라이언트가 `'poll_change'` broadcast 를 둘 다 수신 + 비멤버 미수신(RLS)을 관찰한다. 수동/라이브 실행(CI 게이트 아님).

### [BREAK] (의도적 호환성 단절)

- 없음. poll broadcast 는 **구별 이벤트명 `'poll_change'`** 를 쓰므로 채팅의 `'INSERT'` 구독을 깨지 않는다(collision-avoidance — 채팅은 그대로 INSERT 만 받고 poll 시그널을 받지 않는다). PollsSection props 의 `accessToken` 추가는 순수 추가(기존 props 보존 — tsc 가 누락 차단). 백엔드 응답 shape·DTO·api-client 변경 없음(읽기 모델 무변경).

### [REMOVE]

- 없음(트리거·훅·prop 추가 — 테이블·라우트·파일·필드·RLS 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **presence / typing 표시기** — 누가 온라인인지·누가 투표 중인지 같은 presence/typing 인디케이터는 범위 밖. broadcast 는 poll 변경 시그널만 운반한다(향후 별도).
- **optimistic UI** — 투표 결과는 서버 재조회(`router.refresh()`)에서 온다 — 클라이언트가 표를 낙관적으로 미리 그리지 않는다(서버 = 단일 진실 출처, MOIM-005~008 철학 일관). 행위자 자신의 즉시 반영은 기존 revalidatePath 가 담당.
- **per-poll 부분 패칭** — `router.refresh()` 의 전체 페이지 재조회가 MVP 다. 바뀐 특정 poll/옵션만 골라 부분 패치(payload 의 pollId 로 그 poll 만 갱신)하는 것은 범위 밖(시그널에 pollId 는 담지만 MVP 는 전체 refresh).
- **새 채널 / 새 RLS** — `moim:{id}` private 채널과 `realtime.messages` 멤버십 RLS 를 그대로 재사용한다(REQ-CHAT-002/004). poll 전용 채널·poll 전용 RLS 정책을 만들지 않는다.
- **채팅 변경** — 채팅의 `'INSERT'` 구독·트리거·페이지는 무변경. poll 은 구별 이벤트명으로 공존한다(채팅과 교차 수신 없음).
- **모바일 네이티브 코드** — 상세는 in-WebView 렌더, WebView 가 이미 구독하는 웹 클라이언트를 실행한다(REQ-MOIM9-006). expo-router 네이티브 라우트/컴포넌트/실시간 코드를 추가하지 않는다.
- **poll 외 모임 필드의 실시간** — `router.refresh()` 가 부수적으로 재렌더하는 범위(헤더 startsAt 등 page.tsx 가 이미 fetch 하는 것) 이상으로, 모임 이름·장소·멤버 목록을 별도 실시간 채널로 푸시하지 않는다. 멤버 합류 등은 본 SPEC 범위 밖(poll_change 시그널은 poll 변경에만 발화).
- **debounce / coalesce 보장** — rapid 시그널 coalesce 는 optional(REQ-MOIM9-004) — 구현하면 좋지만 보장 대상이 아니다(MVP 는 시그널마다 refresh 도 허용 — 단순 우선).
- **기본 supabase-js 이상의 offline / reconnect resilience** — supabase-js 가 기본 제공하는 재연결 이상의 오프라인 큐잉·재구독 재시도 로직은 범위 밖. 연결 끊김 후 복구는 supabase-js 기본 동작 + 다음 page 진입의 서버 fetch 에 맡긴다.
- **백엔드 broadcast 코드(애플리케이션 레이어)** — broadcast 는 DB 트리거다. NestJS 서비스/게이트웨이에서 supabase Realtime 클라이언트로 명시 publish 하는 경로는 만들지 않는다(트리거가 단일 출처 — add_chat 선례).
- **집계/myVotes 를 페이로드에 싣기** — broadcast 는 경량 시그널만(§5). myVotes 는 구독자별이라 트리거에서 계산 불가 — 클라이언트 재조회가 해석한다.

---

## 5. 설계 노트 (Design Notes)

### CHAT-001 broadcast 메커니즘 그대로 미러 (핵심 결정)

- poll broadcast 트리거 함수는 add_chat 의 `broadcast_chat_message` 형태를 그대로 복제한다 — `LANGUAGE plpgsql` + `SECURITY DEFINER` + `SET search_path = ''`(search_path 하이재킹 차단 — 보안 필수) 트리거 함수에서 `realtime.broadcast_changes(topic, event, operation, table, schema, NEW, OLD)`(또는 동등한 `realtime.send`)를 호출한다. 토픽은 `'moim:' || moimId::text`(private channel), 이벤트는 `'poll_change'`, schema 는 `'public'`.
- add_chat 과 동일하게 `realtime.broadcast_changes` 가 내부적으로 `realtime.send(private=true)` 로 `realtime.messages` 에 넣어 멤버십 RLS 게이트를 거치게 한다 — 그래서 **새 RLS 가 필요 없다**(같은 `realtime.messages` 정책이 poll 시그널도 멤버십으로 게이트한다).
- `to_regnamespace('realtime') IS NOT NULL` 가드를 둬, realtime 스키마가 없는 Prisma shadow DB 에서 마이그레이션 검증이 에러 없이 통과하게 한다(add_chat §5 선례 — 실 DB 에서만 완전 동작).

### 구별 이벤트명 `'poll_change'` (collision-avoidance)

- poll 과 채팅은 **같은 private 채널 `moim:{id}`** 를 공유한다(채널/RLS 재사용 — REQ-MOIM9-002). 채팅 구독은 `on('broadcast', { event: 'INSERT' })` 로 INSERT 이벤트만 필터링한다. poll 이 같은 `'INSERT'` 를 쓰면 채팅 페이지가 poll 시그널을 메시지로 오인하고, poll 섹션이 채팅 INSERT 를 poll 변경으로 오인한다.
- 그래서 poll 은 **`'poll_change'`** 라는 구별 이벤트명을 쓴다 — supabase Realtime 의 broadcast 이벤트 필터(`{ event: 'poll_change' }` vs `{ event: 'INSERT' }`)가 둘을 분리해, 같은 채널을 공유하면서도 채팅 구독자와 poll 구독자가 서로의 broadcast 를 받지 않는다(교차 수신 0).

### 경량 시그널 페이로드 (집계가 아닌 이유)

- broadcast 페이로드는 `{ type: 'poll_change', moimId, pollId }` 형태의 최소 시그널이다 — 옵션별 voteCount·myVotes·옵션 라벨 등 결과를 싣지 않는다.
- **왜 집계가 아닌가**: voteCount 는 트리거에서 집계할 여지가 있지만 `myVotes`(호출자 자신의 표)는 **구독자마다 다르다** — 한 broadcast 가 모든 구독자의 myVotes 를 담는 것은 불가능하다. 그래서 시그널은 "모임 X 의 poll(pollId)이 바뀌었다" 만 알리고, 각 클라이언트가 `router.refresh()` → Server Component 재실행으로 **자신의** 토큰으로 `listPolls`(myVotes 포함)를 재조회한다.
- 이는 CHAT-001 의 thin-trigger 철학(트리거는 시그널/레코드만, 해석은 클라이언트) + MOIM-005~008 의 서버-진실-출처 철학(revalidatePath 가 서버 fetch 재실행)과 정확히 일치한다 — 서버가 단일 진실 출처를 유지한다.

### moimId 해소 — poll_vote 는 poll 조회 (chat_message 와의 차이)

- chat_message 트리거는 `NEW.moim_id` 를 직접 썼다(chat_message 가 moim_id 컬럼을 가짐). poll 도메인은 다르다:
  - `poll` 트리거(INSERT/UPDATE): `poll` 테이블이 `moim_id` 를 직접 가지므로 `NEW.moim_id`(INSERT/UPDATE) 또는 `OLD.moim_id`(필요 시)를 그대로 쓴다.
  - `poll_vote` 트리거(INSERT/DELETE): `poll_vote` 테이블은 `moim_id` 가 없고 `poll_id` 만 가진다. 그래서 트리거 함수가 변경된 vote 의 `poll_id`(NEW.poll_id on INSERT / OLD.poll_id on DELETE)로 `SELECT moim_id FROM public.poll WHERE id = ...` 를 조회해 moimId 를 해소한 뒤 토픽 `'moim:'||moimId` 를 만든다.
- pollId 도 같은 방식으로 NEW/OLD 에서 얻는다(poll 트리거는 NEW.id/OLD.id, poll_vote 트리거는 NEW.poll_id/OLD.poll_id). 페이로드의 pollId 는 향후 부분 패칭용 힌트지만 MVP 는 전체 refresh.

### 이벤트 범위 = poll_vote INSERT/DELETE + poll INSERT/UPDATE

- **poll_vote AFTER INSERT OR DELETE**: 표 수가 바뀌는 모든 경로를 잡는다 — MOIM-005 단일 교체(기존 표 DELETE + 새 표 INSERT), MOIM-006 다중 토글(추가 INSERT / 제거 DELETE)이 모두 poll_vote 를 INSERT/DELETE 한다. 그래서 어떤 투표 액션이든 broadcast 가 발화한다.
- **poll AFTER INSERT OR UPDATE**: 새 투표 생성(INSERT) → 다른 멤버 화면에 새 투표 등장 / 마감(MOIM-007 closesAt UPDATE) → 마감됨 표시 / finalize(MOIM-008 close 가 poll 을 UPDATE — closesAt 등) → 일정 확정. (참고: MOIM-008 finalize 는 `moim.startsAt` 도 UPDATE 하지만 본 SPEC 은 moim 테이블에 트리거를 걸지 않는다 — close 가 일으키는 `poll` UPDATE 가 시그널을 발화시키고, 그 시그널을 받은 클라이언트의 `router.refresh()` 가 `getMoim` 도 재조회해 헤더 startsAt 을 가져오므로 poll 트리거 하나로 충분하다 — §moim 헤더 갱신).
- DELETE 를 잡는 이유: 단일 교체·다중 제거가 DELETE 를 일으키므로, INSERT 만 잡으면 "표 취소" 가 타 멤버에게 전파되지 않는다.

### 모임 헤더 startsAt 갱신 (poll 트리거 하나로 충분)

- MOIM-008 의 날짜 투표 finalize 는 생성자가 close 할 때 `moim.startsAt` 을 설정하고 동시에 그 `poll` 을 UPDATE 한다(closesAt=now). 본 SPEC 은 `moim` 테이블에 트리거를 추가하지 않는다 — 대신 그 close 가 일으키는 **`poll` UPDATE 가 `'poll_change'` 를 발화**시키고, 시그널을 받은 모든 멤버의 `router.refresh()` 가 page.tsx 를 재실행해 `getMoim`(헤더 startsAt) AND `listPolls`(마감된 poll)를 둘 다 재조회한다.
- 그래서 다른 멤버가 일으킨 일정 확정이 모두의 헤더에 라이브로 반영된다(추가 moim 트리거 없이 — page.tsx 가 이미 startsAt 을 fetch + formatMoimSchedule 렌더하므로 refresh 만으로 갱신).

### 웹 — router.refresh 구독 (행위자 vs 타 멤버)

- PollsSection 이 `accessToken` 으로 `moim:{id}` 를 구독(useChatChannel 미러: `createClient()` → `realtime.setAuth(token)` → `.channel(..., {config:{private:true}}).on('broadcast', { event: 'poll_change' }, () => router.refresh()).subscribe()`)하고, 언마운트 시 `removeChannel`.
- **행위자 vs 타 멤버**: 행위자(투표/생성/마감한 멤버)는 기존 Server Action 의 `revalidatePath` 로 즉시 자신의 화면을 갱신한다(MOIM-005~008 그대로). 타 멤버는 broadcast → `router.refresh()` 로 갱신한다. 행위자도 자신의 broadcast 를 받아 추가 refresh 가 일어날 수 있으나(self-broadcast), 멱등(같은 서버 상태 재조회)이라 무해하다(채팅 self-broadcast dedupe 와 같은 무해성 — 채팅은 id dedupe, 여기는 멱등 refresh).
- 토큰 가드: accessToken 이 null 이면 구독하지 않는다(useChatChannel 의 토큰 가드 — private 채널은 토큰 없이 RLS 거부).
- debounce(optional): rapid 시그널에 짧은 타이머로 refresh 를 coalesce 할 수 있으나 MVP 는 단순 유지가 우선(보장 아님).

### page.tsx accessToken 전달

- page.tsx 는 이미 `requireNamedSession()` 으로 session 을 얻고 `session.user.id` 를 currentUserId 로 전달한다(MOIM-007/008). accessToken 전달은 `session.access_token` 을 PollsSection 에 한 줄 더 넘기는 것뿐이다 — 채팅 페이지가 토큰을 클라이언트에 넘기는 방식 미러. public supabase 설정(NEXT_PUBLIC_*)은 이미 client-side 가용(env.ts SUPABASE_CONFIG)이므로 추가 전달 불필요.

### 디자인

- 본 SPEC 은 시각 변경이 거의 없다(실시간 갱신은 기존 PollsSection 렌더를 그대로 재실행). 새 UI 요소(예: "실시간 연결됨" 표시)는 추가하지 않는다 — 갱신은 조용히 일어난다(MVP). 향후 연결 상태 인디케이터를 둔다면 Meetup 오렌지 토큰을 따른다.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 채팅/투표 이벤트 교차 수신 | HIGH | poll 이 채팅과 같은 채널 `moim:{id}` 를 쓰는데 같은 `'INSERT'` 이벤트명을 쓰면 채팅이 poll 시그널을 메시지로, poll 이 채팅 INSERT 를 변경으로 오인. 구별 이벤트명 `'poll_change'` 강제(채팅은 INSERT, poll 은 poll_change — supabase event 필터가 분리). LIVE 스크립트로 채팅 구독자가 poll_change 미수신·poll 구독자가 INSERT 미수신 고정. |
| poll_vote moimId 해소 실패 | HIGH | poll_vote 에 moim_id 가 없어 토픽을 못 만들면 broadcast 미발화. 트리거가 `poll_id`(NEW/OLD)로 `poll.moim_id` 조회. DELETE 시 OLD.poll_id 사용(NEW 없음). LIVE: 투표 INSERT/DELETE 둘 다 멤버 수신 확인. |
| 비멤버 broadcast 누출 | HIGH | poll 시그널이 비멤버에게 새면 비공개 투표 변동 노출. `realtime.messages` 멤버십 RLS 재사용(REQ-CHAT-004) — poll broadcast 도 같은 게이트. 새 RLS 없음(누출 표면 0). LIVE: 비멤버 미수신(RLS) 고정. |
| 마이그레이션 파괴적 reset | MEDIUM | `prisma migrate dev` 가 hand-edited add_chat/poll 트리거 때문에 reset 시도 가능. hand-author migration.sql + 비파괴 패턴(db execute/resolve/status clean) 강제. 트리거만 추가(테이블 변경 0)라 SQL 단순. realtime 스키마 가드(to_regnamespace)로 shadow DB 검증 통과. |
| router.refresh 무한/과다 루프 | MEDIUM | self-broadcast 로 행위자가 자신의 변경에 refresh → 또 broadcast? broadcast 는 DB row 변경에서만 발화하고 refresh 는 읽기(재조회)일 뿐 row 변경 안 함 → 추가 broadcast 없음(루프 없음). 멱등 refresh(같은 상태 재조회) 무해. rapid 시그널 과다 refresh 는 optional debounce 로 완화 가능(보장 아님). |
| SECURITY DEFINER search_path 하이재킹 | MEDIUM | 트리거 함수가 정의자(postgres) 권한으로 realtime 호출 — search_path 미고정 시 하이재킹 위험. add_chat 처럼 `SET search_path = ''` + 스키마 정규화(public./realtime.) 강제. |
| 백엔드 코드 변경 유혹 | LOW | broadcast 를 NestJS 게이트웨이로 구현하려는 충동 — 이중 출처/복잡도 증가. 순수 DB 트리거 단일 출처 강제(REQ-MOIM9-003 — NestJS 무변경). 기존 핸들러가 이미 row 를 바꿔 트리거 발화. |
| 모바일 WebView 구독 미동작 | MEDIUM | WebView 안에서 supabase Realtime WebSocket 이 막히면 모바일 실시간 미동작. 웹 클라이언트가 그대로 실행되므로 브라우저와 동일 동작 기대 — device 검증에서 WebView 다중 클라이언트 실시간 확인(게이트). 실패 시에도 다음 진입 서버 fetch 로 graceful(실시간만 손실, 데이터 정합 유지). |
| accessToken prop 누락 소비처 | LOW | accessToken 은 순수 prop 추가(기존 props 보존). PollsSection 시그니처 변경을 page.tsx 가 채워야 함 — tsc 게이트로 누락 차단. |
| 토큰 만료 후 구독 | LOW | 장수 상세 화면에서 access_token 만료 시 RLS 거부로 수신 중단. MVP 는 supabase-js 기본 재인증/다음 진입 서버 fetch 에 의존(offline/reconnect resilience 제외 — §4). |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 다중 클라이언트(브라우저 + iOS WebView) 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 NestJS 코드 변경이 없으므로 신규 jest 가 불필요하다(기존 poll/chat jest 회귀만 — GREEN 유지). 핵심 게이트는 LIVE 종단 증명(chat.live.mts 미러)이다.

- `prisma migrate` clean — broadcast 트리거 함수 + 트리거 2개(poll_vote AFTER INSERT OR DELETE / poll AFTER INSERT OR UPDATE) additive 추가. **테이블/컬럼/PK/FK/인덱스 변경 0**(기존 row 보존, 손실 0). hand-authored migration.sql + 비파괴 패턴(db execute/resolve/status clean). realtime 스키마 가드(to_regnamespace)로 shadow DB 검증 통과. 타임스탬프 20260621000000 이후.
- backend — **NestJS 코드 변경 없음**(REQ-MOIM9-003) → 신규 jest 불필요. 기존 poll/chat jest 가 그대로 GREEN(회귀 0 — 트리거 추가가 핸들러/응답/인가에 영향 없음). 기존 backend tsc 0.
- `tsc` 통과 (0 error — web; PollsSection accessToken prop + poll 구독 훅/useEffect + router.refresh 타입 확인). 백엔드/api-client tsc 무변경 회귀 0(응답 shape 변경 없음).
- web lint 통과 (0 error).
- `nx run web:build` 통과 (0 error — PollsSection 실시간 구독 + router.refresh + page.tsx accessToken 전달 컴파일).
- mobile tsc / vitest / `expo export` 통과 (무변경 회귀 0 — REQ-MOIM9-006).
- **LIVE 종단 증명(핵심 게이트 — chat.live.mts 미러)**: `apps/backend/test/poll-realtime.live.mts`(수동/라이브 실행 — CI 게이트 아님)로 실 Supabase 스택(:54321 API, :54322 DB) + 실 Realtime 에서 다음을 증명한다 — (1) 멤버 2명이 `moim:{id}` private 채널(`setAuth` + `config:{private:true}` + `on('broadcast',{event:'poll_change'})`)을 구독한 상태에서 한 멤버가 투표(poll_vote INSERT)/생성(poll INSERT)/마감(poll UPDATE)하면 **두 멤버 클라이언트가 둘 다 `'poll_change'` broadcast 를 수신**(REQ-MOIM9-001/002 — 표 변동·새 투표·마감 각각); (2) **비멤버**는 같은 채널 구독 시 `realtime.messages` RLS 가 거부해 **미수신**(REQ-MOIM9-002 — 비멤버 차단); (3) 채팅 `'INSERT'` 구독자는 `'poll_change'` 를 받지 않고 poll 구독자는 채팅 `'INSERT'` 를 받지 않음(collision-avoidance — REQ-MOIM9-001).
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. 두 클라이언트(브라우저 탭 2개 또는 브라우저 + iOS 시뮬레이터 WebView)가 같은 모임 상세에 있을 때, 한쪽이 투표/생성/마감하면 다른 쪽 투표 섹션이 **리로드 없이** 라이브 갱신(새 표/새 투표/마감)되고, 날짜 투표 finalize(MOIM-008)면 다른 쪽 모임 헤더 일정(startsAt)도 라이브 확정 갱신되며, 각 멤버의 myVotes 가 올바르게 보이는지(자신의 표만 강조) 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated — 모바일 WebView + 브라우저 다중 클라이언트 라이브 검증 배치). 그 전까지 status 는 `in-progress`(자동 게이트 + LIVE 스크립트 통과 시).
- 상세 수용 기준은 `acceptance.md` 참조.
