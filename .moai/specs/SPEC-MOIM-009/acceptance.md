# SPEC-MOIM-009 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-009: 투표 결과 실시간 갱신 — Supabase Realtime broadcast (CHAT-001 인프라 재사용)
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + LIVE 다중 클라이언트 확인. 백엔드는 NestJS 코드 변경이 없어 신규 jest 가 불필요하다(기존 poll/chat jest 회귀만). 핵심 게이트는 LIVE 종단 증명(poll-realtime.live.mts — chat.live.mts 미러).

## 수용 기준 (AC)

### AC-1: poll broadcast 트리거 + 비파괴 마이그레이션 (← REQ-MOIM9-001)

`poll`(AFTER INSERT OR UPDATE) + `poll_vote`(AFTER INSERT OR DELETE) broadcast 트리거가 add_chat 메커니즘을 미러해 `'poll_change'` 이벤트로 private 채널 `moim:{id}` 에 경량 시그널을 전파하고, 테이블/컬럼/PK/FK/인덱스는 무변경이며 기존 row 가 보존된다.

- **Given** 기존 스키마(poll/poll_option/poll_vote/moim, MOIM-005~008 + add_chat realtime 트리거/RLS)와 poll/투표 데이터가 있고
- **When** hand-authored 비파괴 마이그레이션(broadcast 함수 `broadcast_poll_change` + 트리거 2개 ADD)을 적용하면
- **Then** broadcast 함수가 `SECURITY DEFINER`/`SET search_path=''` 로 정의되고 `realtime` API(add_chat 호출 형태)로 토픽 `'moim:'||moimId`·이벤트 `'poll_change'`·페이로드 `{type,moimId,pollId}` 를 전파하며, **테이블/컬럼/PK(`poll_vote (pollId,optionId,userId)`)/FK/인덱스가 한 줄도 변경되지 않고**(기존 poll/option/vote/moim row 손실 0), `realtime` 스키마 가드(to_regnamespace)로 shadow DB 검증이 통과하고, `prisma migrate status` 가 clean 이며, 기존 동작(모임·멤버·채팅·단일/다중 투표·마감·finalize)에 회귀가 없다.
- **And** broadcast 이벤트명이 `'poll_change'`(채팅 `'INSERT'` 와 구별)이고, poll_vote 트리거가 `poll_id`(NEW/OLD) → `poll.moim_id` 조회로 moimId 를 해소하며, poll 트리거가 NEW/OLD.moim_id 를 직접 쓴다.

### AC-2: 채널 + RLS 재사용 — 멤버 수신 / 비멤버 차단 (← REQ-MOIM9-002)

poll broadcast 가 CHAT-001 의 같은 private 채널 `moim:{id}` + 같은 `realtime.messages` 멤버십 RLS 를 재사용한다(새 채널/새 RLS 0). 멤버는 수신, 비멤버는 RLS 차단.

- **Given** 멤버 A,B 와 비멤버 S 가 각각 `moim:{id}` private 채널(`setAuth(token)` + `config:{private:true}` + `on('broadcast',{event:'poll_change'})`)을 구독한 상태에서
- **When** 그 모임의 poll 이 바뀌어(투표/생성/마감) `'poll_change'` broadcast 가 발화하면 **Then** 멤버 A,B 는 시그널을 수신하고(`realtime.messages` RLS 가 `moim_member` 멤버십을 확인해 허용), 비멤버 S 는 수신하지 않는다(RLS 가 멤버십 부재로 select 거부 — REQ-CHAT-004 와 같은 게이트).
- **And** poll 용 새 RLS 정책이 추가되지 않았다(같은 `realtime.messages` 정책이 poll 시그널도 게이트 — 누출 표면 0).
- **And** 채널 토픽이 채팅과 동일한 `moim:{id}` 이고, 구별 이벤트명으로 채팅/투표가 공존한다(새 토픽 네임스페이스 없음).

### AC-3: 백엔드 NestJS 무변경 — 트리거가 발화 (← REQ-MOIM9-003)

실시간 갱신을 위해 NestJS 애플리케이션 코드를 변경하지 않으며, 기존 create/vote/close 핸들러가 트리거를 발화시키는 row 를 변경한다.

- **Given** 기존 poll 도메인(poll.service.ts/poll.controller.ts/DTO)과 인가(assertMember/생성자 전용 close)가 있고
- **When** 본 SPEC 의 트리거 마이그레이션을 적용하면 **Then** NestJS 코드는 한 줄도 변경되지 않고(broadcast 는 순수 DB 트리거), `POST /moims/:id/polls`(생성 → poll INSERT)·`POST .../vote`(투표 → poll_vote INSERT/DELETE)·`POST .../close`(마감 → poll UPDATE, MOIM-008 finalize 포함)가 이미 변경하는 row 가 트리거를 동기적으로(AFTER ROW) 발화시킨다.
- **And** poll 도메인의 응답 shape·DTO·api-client·인가가 모두 보존된다(MOIM-005~008 jest 회귀 GREEN — 트리거 추가가 핸들러 로직에 영향 없음).
- **And** 별도 백그라운드 잡·크론·메시지 큐·NestJS Realtime publish 코드가 없다(트리거 단일 출처).

### AC-4: 웹 PollsSection 실시간 구독 + router.refresh (← REQ-MOIM9-004)

PollsSection 이 accessToken 으로 `moim:{id}` 를 구독하고(useChatChannel 미러, 이벤트 `'poll_change'`), 수신 시 `router.refresh()` 로 Server Component 를 재실행해 집계 결과 + 자신의 myVotes + 헤더 startsAt 을 새로 렌더한다.

- **Given** 멤버가 모임 상세(`/home/{id}`)에 있고 accessToken 이 있으면
- **When** PollsSection 이 마운트되면 **Then** `createClient()` → `supabase.realtime.setAuth(accessToken)` → `.channel('moim:'+id, { config: { private: true } }).on('broadcast', { event: 'poll_change' }, ...).subscribe()` 로 구독한다(useChatChannel 패턴 미러, 이벤트명만 poll_change).
- **And When** `'poll_change'` broadcast 를 수신하면 **Then** `router.refresh()`(next/navigation)를 호출해 Server Component(page.tsx → `listPolls` + `getMoim`)를 재실행하고, 투표 섹션(집계 + 호출자 자신의 myVotes)과 모임 헤더 일정(`startsAt`)이 둘 다 새로 렌더된다(각 멤버는 자신의 myVotes 만 강조, 다른 멤버의 날짜 투표 finalize 가 일으킨 일정 확정도 라이브 반영).
- **And When** accessToken 이 없으면 **Then** 구독하지 않는다(토큰 가드 — private 채널은 토큰 없이 RLS 거부).
- **And When** 컴포넌트가 언마운트되면 **Then** `removeChannel` 로 채널을 정리한다(중복 구독·누수 방지).
- **And** (optional) rapid 연속 시그널은 짧은 타이머로 refresh 를 coalesce 할 수 있으나 보장 대상이 아니다(MVP 단순 우선).

### AC-5: page.tsx accessToken 전달 (← REQ-MOIM9-005)

모임 상세 Server Component 가 세션 access_token 을 PollsSection 에 prop 으로 전달하며(채팅 미러), 기존 props·fetch·가드를 보존한다.

- **Given** page.tsx 가 `requireNamedSession()` 으로 session 을 얻고(MOIM-007/008) `session.user.id` 를 currentUserId 로 전달하는 상태에서
- **When** PollsSection 렌더를 보면 **Then** `accessToken={session.access_token}` 가 추가 전달되고(채팅 페이지가 토큰을 클라이언트에 넘기는 방식 미러), 기존 `moimId`/`polls`/`currentUserId` 전달 + polls/moim fetch + 가드가 무변경이며, poll fetch/render 로직이 변경되지 않는다(`router.refresh()` 가 기존 `listPolls` + `getMoim` 을 재실행).
- **And** public supabase 설정(NEXT_PUBLIC_SUPABASE_URL/ANON)은 이미 client-side 가용(env.ts SUPABASE_CONFIG)이라 추가 전달이 불필요하다.

### AC-6: 모바일 무변경 — WebView 가 구독 (← REQ-MOIM9-006)

모바일은 신규 네이티브 코드 없이, WebView 가 이미 실행하는 PollsSection(구독하는 웹 클라이언트)을 통해 실시간 갱신을 받는다.

- **Given** 모바일 앱이 모임 상세를 `/home/[id]` in-WebView 로 렌더하고(SPEC-MOIM-003 계약)
- **When** 본 SPEC 변경을 적용하면 **Then** 모바일 네이티브 코드는 추가되지 않고(expo-router 라우트/컴포넌트/실시간 코드 0), WebView 안의 PollsSection 이 구독해 실시간 갱신이 WebView 안에서 자동 동작한다(브라우저와 동일).
- **And** mobile tsc/vitest/expo export 가 회귀 0 으로 통과한다(모바일 무변경).

### AC-7: 품질 게이트 + LIVE 종단 증명 (← spec.md §7)

prisma migrate clean(트리거만 추가, 테이블/PK/FK 무변경), 백엔드 NestJS 무변경(기존 jest GREEN 회귀), web tsc 0, web lint 0, web build 0, mobile 회귀 0, 그리고 LIVE 종단 증명(두 멤버 수신 + 비멤버 미수신 RLS + collision-avoidance).

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면 **Then** prisma migrate status clean(트리거 함수 + 트리거 2개 추가, 테이블/컬럼/PK/FK/인덱스 변경 0, 기존 row 보존, realtime 가드) + 백엔드 NestJS 무변경(기존 poll/chat jest GREEN, backend/api-client tsc 0) + web tsc 0 + web lint 0 + `nx run web:build` 0 + mobile tsc/vitest/expo export 회귀 0 이 모두 GREEN 이다.
- **And When** LIVE 스크립트(`poll-realtime.live.mts` — 실 Supabase 스택)를 실행하면 **Then** 멤버 A,B 가 한 멤버의 투표(poll_vote INSERT)/생성(poll INSERT)/마감(poll UPDATE)에 `'poll_change'` 를 둘 다 수신하고, 비멤버는 미수신(RLS 차단)하며, (선택) 채팅 `'INSERT'` 구독자가 poll_change 를 받지 않고 poll 구독자가 채팅 INSERT 를 받지 않는다(collision-avoidance).
- **And** 디바이스 종단 검증(두 클라이언트 라이브 갱신 + myVotes 올바름 + 날짜 finalize 헤더 라이브)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **단일 교체 투표(MOIM-005)**: 멤버가 다른 옵션으로 바꾸면 기존 표 DELETE + 새 표 INSERT → poll_vote 트리거가 둘 다(또는 트랜잭션 내 발화) `'poll_change'` 를 발화 → 타 멤버 수신·refresh. (← REQ-MOIM9-001/004)
- **다중 토글 투표(MOIM-006)**: 멤버가 옵션을 추가(INSERT)/제거(DELETE)하면 각각 poll_vote 트리거 발화 → 타 멤버 수신. DELETE 도 잡으므로 "표 취소" 가 전파된다. (← REQ-MOIM9-001/004)
- **새 투표 생성**: `POST .../polls` 가 poll INSERT → poll 트리거 발화 → 타 멤버 화면에 새 투표가 리로드 없이 등장(router.refresh → listPolls). (← REQ-MOIM9-001/004)
- **마감(MOIM-007)**: 생성자 close 가 poll UPDATE(closesAt=now) → poll 트리거 발화 → 타 멤버 화면에 마감됨 라이브 반영. (← REQ-MOIM9-001/004)
- **날짜 투표 finalize(MOIM-008)**: close 가 poll UPDATE(시그널 발화) + moim.startsAt UPDATE(트리거 없음) → 시그널 받은 클라이언트의 router.refresh 가 getMoim 도 재조회 → 헤더 일정(startsAt)이 타 멤버 화면에 라이브 확정 갱신(moim 트리거 없이 poll 트리거 하나로 충분). (← REQ-MOIM9-004)
- **비멤버 미수신(RLS)**: 비멤버가 `moim:{id}` 를 구독해도 `realtime.messages` RLS 가 멤버십 부재로 select 거부 → poll_change(및 채팅 INSERT) 미수신. 새 RLS 없이 CHAT-001 게이트 재사용. (← REQ-MOIM9-002)
- **채팅/투표 교차 수신 0(collision-avoidance)**: 같은 채널 `moim:{id}` 를 공유하지만 채팅은 `'INSERT'`, poll 은 `'poll_change'` → supabase event 필터가 분리 → 채팅 구독자가 poll_change 미수신, poll 구독자가 채팅 INSERT 미수신. (← REQ-MOIM9-001)
- **경량 시그널(집계 아님)**: broadcast 페이로드는 `{type,moimId,pollId}` 만 — voteCount/myVotes/옵션 미포함. myVotes 는 구독자별이라 트리거 계산 불가 → 각 클라이언트가 router.refresh 로 자신의 뷰 재조회. (← REQ-MOIM9-001/004)
- **poll_vote moimId 조회(DELETE)**: poll_vote 에 moim_id 없음 → 트리거가 poll_id → poll.moim_id 조회. DELETE 는 OLD.poll_id 사용(NEW 없음). (← REQ-MOIM9-001)
- **self-broadcast 멱등**: 행위자도 자신의 변경에 broadcast 수신 → router.refresh. 행위자는 기존 revalidatePath 로 이미 갱신됐으나 추가 refresh 는 같은 서버 상태 재조회(멱등) — 무해(채팅 self-broadcast dedupe 와 같은 무해성). refresh 는 읽기라 추가 broadcast 없음(루프 없음). (← REQ-MOIM9-004)
- **백엔드 NestJS 무변경**: broadcast 가 DB 트리거라 NestJS 코드 0 변경 — 기존 핸들러 row 변경이 발화. NestJS Realtime publish/게이트웨이 코드 없음. (← REQ-MOIM9-003)
- **accessToken null(토큰 가드)**: 토큰 없으면 구독 안 함(private 채널 RLS 거부) — 무의미 연결 방지. (← REQ-MOIM9-004)
- **언마운트 정리**: 상세 이탈/의존성 변경 시 removeChannel — 중복 구독·누수 방지(useChatChannel 미러). (← REQ-MOIM9-004)
- **모바일 WebView 구독**: 상세가 in-WebView 라 WebView 안의 PollsSection 이 구독 — 신규 네이티브 없음. WebView WebSocket 이 막히면 실시간만 손실, 다음 진입 서버 fetch 로 graceful(데이터 정합 유지). (← REQ-MOIM9-006)
- **토큰 만료 후 수신 중단**: 장수 화면에서 access_token 만료 시 RLS 거부로 수신 중단 — MVP 는 supabase-js 기본 + 다음 진입 서버 fetch 의존(offline/reconnect resilience 제외). (← REQ-MOIM9-004)
- **rapid 시그널**: 짧은 시간 다수 변경 시 refresh 다발 가능 — optional debounce 로 완화 가능하나 보장 아님(MVP 는 시그널마다 refresh 허용). (← REQ-MOIM9-004)
- **마이그레이션 shadow DB**: realtime 스키마 없는 Prisma shadow DB 에서 to_regnamespace 가드로 함수/트리거 생성 생략 → 검증 통과(실 DB 만 동작 — add_chat 선례). (← REQ-MOIM9-001)
- **데스크톱 vs 모바일**: 실시간 구독은 데스크톱 브라우저 + 모바일 in-WebView(상세 `/home/{id}`) 모두 PollsSection 에서 동작 — 다중 클라이언트(브라우저 탭 2개 또는 브라우저 + iOS WebView) 라이브 갱신을 디바이스 검증한다.

## Definition of Done (DoD)

- [ ] `poll`(AFTER INSERT OR UPDATE) + `poll_vote`(AFTER INSERT OR DELETE) broadcast 트리거 함수(`SECURITY DEFINER`/`search_path=''`/이벤트 `'poll_change'`/토픽 `'moim:'||moimId`/페이로드 `{type,moimId,pollId}`) + realtime 가드 additive 추가 + 테이블/컬럼/PK/FK/인덱스 무변경(기존 row 보존, 손실 0), prisma migrate clean(hand-authored 비파괴). (AC-1)
- [ ] 채널 `moim:{id}` + `realtime.messages` 멤버십 RLS 재사용(새 채널/새 RLS 0), 멤버 수신·비멤버 RLS 차단, 구별 이벤트명 `'poll_change'` 로 채팅/투표 교차 수신 0. (AC-2)
- [ ] 백엔드 NestJS 코드 무변경(broadcast 순수 DB 트리거 — 기존 create/vote/close 가 row 변경으로 AFTER ROW 발화), poll 도메인 응답/DTO/인가 보존, 백그라운드 잡/크론/큐 없음. (AC-3)
- [ ] PollsSection 이 accessToken 으로 `moim:{id}` 구독(setAuth + private + `'poll_change'`) + 수신 시 router.refresh(Server Component 재실행 → 집계 + 자신의 myVotes + 헤더 startsAt) + 토큰 가드 + 언마운트 removeChannel(useChatChannel 미러). (AC-4)
- [ ] page.tsx 가 `accessToken={session.access_token}` 전달 + 기존 props(moimId/polls/currentUserId)·fetch·가드 보존 + poll fetch/render 로직 무변경. (AC-5)
- [ ] 모바일 무변경(WebView 가 구독하는 웹 클라이언트 실행 — 신규 네이티브 0), mobile tsc/vitest/expo export 회귀 0. (AC-6)
- [ ] backend NestJS 무변경 → 신규 jest 불필요 + 기존 poll/chat jest GREEN(회귀 0) + backend/api-client tsc 0. (AC-3/AC-7)
- [ ] web tsc 0(accessToken prop + 구독 훅 + router.refresh) / web lint 0 / `nx run web:build` 0. (AC-7)
- [ ] LIVE 종단 증명(`poll-realtime.live.mts` — chat.live.mts 미러): 멤버 2명이 투표(poll_vote INSERT)/생성(poll INSERT)/마감(poll UPDATE)에 `'poll_change'` 둘 다 수신 + 비멤버 미수신(RLS) + (선택) 채팅/투표 교차 수신 0. (AC-7)
- [ ] 디바이스 종단 검증: 두 클라이언트(브라우저 탭 2개 또는 브라우저 + iOS WebView)가 같은 상세에서 한쪽 투표/생성/마감 → 다른 쪽 리로드 없이 라이브 갱신(새 표/새 투표/마감) + 날짜 투표 finalize 면 다른 쪽 헤더 일정(startsAt) 라이브 확정 + 각 멤버 myVotes 올바름 라이브 확인. (AC-7, device-gated)
