# SPEC-MOIM-EXPENSE-001 — Research (codebase grounding)

본 문서는 SPEC-MOIM-EXPENSE-001(모임 경비 기록 + 시각화 MVP) 작성에 앞서 moyura 코드베이스를
조사해 **재사용할 패턴**과 **참조 file:line**을 고정한 자료다. 모든 위치는 조사 시점(2026-06-24) verified.

---

## 1. 도메인 / 인가 (이미 존재 — 재사용)

- `Moim` 모델(`apps/backend/prisma/schema.prisma:36-59`): `id`/`name`/`startsAt?`(MOIM-004)/`location?`(MOIM-004)/
  `createdBy`/`maxMembers @default(15)`(MOIM-012)/`createdAt` + 역참조(`members`/`invites`/`messages`/`polls`).
  **소유권 = `MoimMember.role === "owner"`** 이고 `Moim.createdBy` 는 불변(위임 후에도). 경비 owner 판정은 role 기준.
- `MoimMember`(`schema.prisma:87-100`): 복합 PK `(moimId, userId)`, `nickname`(필수), `role` "owner"|"member".
- **인가 단일 출처** `MoimService`(`apps/backend/src/moim/moim.service.ts`):
  - `assertMember(sub, moimId)`(:69-77) — 모임 없음 404 → 비멤버 403. 멤버 한정 조회의 게이트.
  - `assertOwner(sub, moimId)`(:83-90) — 모임 없음 404 → 비-owner 403. owner 전용 작업의 게이트.
  - **결론**: 경비 **기록/수정/삭제 + 예산 설정 = `assertOwner`**(owner 전용), **목록/정산 조회 = `assertMember`**(전 멤버).
- 쓰기 단일 출처 패턴: `setStartsAt`(:139-144), `setLocation`(:149-154) — finalize 가 직접 prisma 를 건드리지 않고
  도메인 메서드를 호출. 예산 쓰기도 동일 패턴(`setBudget` 또는 기존 `updateMaxMembers` 확장)을 따른다.

## 2. 중첩 라우트 + 컨트롤러 관례 (PollController 미러)

- `PollController`(`apps/backend/src/poll/poll.controller.ts`): `@Controller('moims/:id/polls')` + per-route
  `@UseGuards(SupabaseAuthGuard)`(401 선처리). `@CurrentUser() user` 로 검증된 `sub` 만 수신(mass-assignment 차단).
  **ValidationPipe 부재** → `requireNonEmpty`(:177)/`normalizeOptions`(:238)/`parseClosesAt`(:187)/`parseKind`(:203)
  같은 헬퍼로 컨트롤러가 명시 400 을 던진다. 경비도 amount/category/payer/split 검증을 컨트롤러 헬퍼로 한다.
- 상태 코드 관례: 401(가드)·403(비멤버/비-owner)·404(없는 모임 / 다른 모임 소속 자원)·400(검증)·409(충돌).
- `moims/:id/messages`(Chat)·`moims/:id/polls`(Poll) 모두 moimId-in-path → `assertMember/assertOwner` 직접 호출
  (역방향 lookup 불필요). 경비도 `moims/:id/expenses` 로 같은 형태.
- 서비스 패턴 `PollService`(`apps/backend/src/poll/poll.service.ts`): create 첫 줄 `assertMember`(:71),
  `$transaction` 으로 poll+options 원자 생성(:74-94), `aggregatePolls`(:250-310) 가 집계(voteCount 0 포함)+
  호출자별 myVotes 를 서버에서 계산해 반환(서버 = 단일 진실 출처). **경비 정산(balances + minimal-transaction)도
  이 aggregate 패턴을 미러해 서버에서 계산**한다(클라 계산 금지).

## 3. additive 컬럼/테이블 마이그레이션 관례 (비파괴)

- 마이그레이션 디렉터리: `apps/backend/prisma/migrations/`(2026-06-24 기준 13개). 명명 `YYYYMMDDHHMMSS_<name>` 또는
  `YYYYMMDD000000_<name>`. `migration_lock.toml` 존재.
- additive 컬럼 선례: `20260619000000_add_moim_event_fields`(startsAt/location), `20260624000000_..._max_members_..`
  (`ALTER TABLE "moim" ADD COLUMN "max_members" integer NOT NULL DEFAULT 15`). **`Moim.budget` 도 동일 형태**
  (`integer` nullable — 예산 미설정 모임 허용).
- additive 신규 테이블 선례: `20260619100000_add_poll`(poll/poll_option/poll_vote CREATE, moim 무변경, FK cascade).
  **`expense`/`expense_share` 신규 테이블도 동일**(moim 무변경 — 역참조만 추가, FK onDelete: Cascade).
- Prisma 7 관례: `@map` snake_case, 복합 PK `@@id([...])`(PollVote `(pollId,optionId,userId)`:186, MoimMember
  `(moimId,userId)`:98), `@@index` 로 조회 경로 커버. `id String @id @default(uuid())`.

## 4. Realtime — 같은 private 채널 `moim:{id}` 재사용 (CHAT-001 스택)

- 트리거 선례 3개(모두 SECURITY DEFINER + `search_path=''` + `realtime.send(payload, event, 'moim:'||id, true)`):
  - `20260622000000_add_poll_realtime_broadcast/migration.sql` — `broadcast_poll_change()`, 이벤트 `'poll_change'`,
    poll(AFTER INSERT OR UPDATE) + poll_vote(AFTER INSERT OR DELETE). 경량 신호 `{moimId, pollId}`.
    **poll_vote 에 moim_id 컬럼이 없어 poll_id→public.poll 조회로 해소**(:40) — 경비도 expense_share 트리거를
    쓸 경우 같은 해소가 필요하나, **expense 행만 트리거하면 moim_id 직접 보유라 조회 불필요**(아래 결정 참조).
  - `20260624000000_..._member_realtime` — `broadcast_member_change()`, 이벤트 `'member_change'`,
    moim_member(AFTER INSERT OR UPDATE OR DELETE). 경량 신호 `{op, userId}`.
- **RLS 재사용**: `realtime.messages` 멤버십 SELECT RLS("members can receive moim broadcasts")는
  `add_chat` 마이그레이션이 이미 생성 → 경비 트리거는 **신규 RLS 0**(멤버만 수신, 비멤버 RLS 차단).
- **collision-avoidance**: 같은 채널을 채팅('INSERT')·poll('poll_change')·member('member_change')가 공유하므로
  경비는 **구별 이벤트명 `'expense_change'`** 를 써야 한다(교차 수신 방지 — 선례 일관).
- 트리거 SQL 은 Prisma 스키마로 표현 불가 → **hand-authored 마이그레이션**(migrate diff 금지, db execute/resolve/status).
- 웹 구독 훅 선례: `apps/web/lib/poll/usePollChannel.ts`(:20-49), `apps/web/lib/moim/useMemberChannel.ts`(:26-56) —
  `supabase.realtime.setAuth(token)` → `supabase.channel('moim:'+id,{config:{private:true}}).on('broadcast',{event},cb)`
  → `subscribe()`, 언마운트 시 `removeChannel`. token 없으면 구독 안 함. **`useExpenseChannel` 신규(이 패턴 미러,
  event `'expense_change'`)** → 수신 시 `router.refresh()`(서버 재조회로 자기 뷰 재계산 — poll/member 동일).
- 백엔드 NestJS 코드는 realtime 에 **0 변경**(순수 DB 트리거 — create/delete/edit 가 row 변경으로 AFTER ROW 발화).

## 5. 웹 — Server Component + Client 섬 + Server Action (PollsSection 미러)

- 상세 페이지 `apps/web/app/(main)/home/[id]/page.tsx`(Server Component): `(main)/layout.tsx`
  `requireNamedSession()` 가드 상속. `createApiClient({getToken: ()=>session.access_token})` 로 서버에서 fetch.
  헤더가 `moim.name`/`startsAt`(`formatMoimSchedule`)/`location`/멤버/`<PollsSection>`/`<MembersSection>` 렌더.
  비멤버 403→리다이렉트, 미존재 404→`notFound()`(토큰/오류 상세 비노출). **경비 섹션 `<ExpenseSection>` 을
  여기에 plain object(직렬화 가능)로 전달**(함수/인스턴스 금지 — Server→Client 경계). `isOwner` 판정(:93,
  `members.some(m => m.userId === session.user.id && m.role === "owner")`) 을 그대로 재사용해 FAB/삭제 노출.
- Server Action 선례 `poll-actions.ts`/`member-actions.ts`: `"use server"`, `requireToken()`(:61 — 세션 부재
  /login 리다이렉트), `createApiClient`, 성공 시 `revalidatePath("/home/{id}")`, 실패 시 `ApiError.status` 로
  일반화 오류 반환(토큰/상세 비노출 — R-A9). FormData 파싱(`createPollAction`:76-133). **경비 record/delete/budget
  Server Action 도 동일 구조**.
- path-param 라우트 호출 헬퍼 `apps/web/lib/moim/polls.ts`(:41-101): `api.request(path as never, ...)`
  (api-client `request` 는 템플릿 치환 안 함 — 구체 경로 인코딩). `PollWithResults` web 미러 타입(:19-35).
  **경비도 `apps/web/lib/moim/expenses.ts` 신규(listExpenses/createExpense/deleteExpense/updateBudget,
  web 미러 타입 `ExpenseSummary`/`Settlement`)** — 편의 메서드 아닌 구체-경로 헬퍼.
- 디자인 토큰: Meetup 오렌지 시맨틱(`bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/
  `text-muted-foreground`/`bg-secondary`), lucide 아이콘. login/onboarding blue 미사용. 모바일-퍼스트
  (page.tsx `px-5`/카드 `rounded-xl border border-border bg-card`/FAB 후보 = 오렌지 원형 버튼 + lucide Plus).
  바텀시트 후보 = `fixed inset-x-0 bottom-0` 시트 + backdrop(members-section.tsx `ConfirmDialog`:51-103 의
  `fixed inset-0 z-50 bg-black/50` 오버레이 스타일 재사용 가능).

## 6. api-client (openapi-typescript 재생성)

- `packages/api-client/src/index.ts`: `export type XxxResponse = components['schemas']['XxxResponseDto']` 별칭만 두고
  (예 `CreatePollRequest`:29, `PollResponse`:36) `schema.d.ts` 는 `nx run api-client:generate` 로 백엔드 OpenAPI
  에서 재생성(수동 편집 없음). **경비 DTO(CreateExpenseDto/ExpenseResponseDto/...)도 백엔드에 정의 →
  api-client 재생성 → web 미러 타입은 web 쪽 헬퍼에 둔다**(path-param 라우트라 편의 메서드 미생성).

## 7. 모바일 (하이브리드 — 무변경 예상)

- 경비 UI 는 웹 상세(`/home/[id]`) 안에서 in-WebView 로 렌더 → expo-router 네이티브 라우트/컴포넌트 추가 없음
  (SPEC-MOIM-003 detail-push 계약 재사용). 새 deep-link 라우트 없음 → 모바일 회귀 확인(tsc/vitest/expo export)만.
- 검증은 iOS 시뮬레이터 전용(Android 제외 — auto-memory ios-simulator-only). mobile WebView SPEC 은 device-gated.

## 8. 핵심 설계 결정 근거(요약)

- **shares 를 항상 materialize**(equal 도 생성 시 분배 행 고정): 멤버십이 바뀌어도(강퇴/탈퇴) 기록 시점의 분담을
  보존하기 위함(PollVote 행이 그 시점 표를 고정하는 것과 동형). 정산은 항상 expense_share 를 읽어 균일 계산.
- **expense 행만 트리거**(expense_share 별도 트리거 불필요): create/delete/edit 는 같은 트랜잭션에서 expense 행을
  INSERT/DELETE/UPDATE 하므로 expense AFTER ROW 트리거 하나로 모든 변경이 발화된다. expense 는 moim_id 직접 보유
  → poll_vote 처럼 역조회할 필요 없음(트리거 단순). (share-only 갱신 경로가 생기면 그때 확장.)
- **정산 = 서버 계산**: balance(payer 합 − share 합) → 채권/채무 분리 → greedy 최소 거래 매칭. aggregatePolls 가
  myVotes 를 서버에서 계산하는 것과 동일 철학(클라는 표시만).

## 9. v0.2.0 확정 결정 추가 그라운딩 (6 resolutions)

§1~5 의 일부는 v0.1.0 의 잠정 가정(인라인 섹션 / setBudget / 경비 수정 optional / 정산 토글 보류)에 기반했다. v0.2.0 에서
6개 결정이 확정되며 아래로 보강한다(spec.md §1~8 이 권위, 본 절은 file:line 근거):

- **전용 라우트(결정 2)**: 채팅이 전용 라우트 선례다 — `apps/web/app/moims/[id]/chat/page.tsx`(존재 확인) + `moims` 그룹
  레이아웃 `apps/web/app/moims/layout.tsx`(`requireNamedSession()` 이름 가드, `(main)` 셸 밖 풀스크린). 경비 라우트
  `app/moims/[id]/expenses/page.tsx` 가 이를 미러한다. 모바일: `apps/mobile/lib/route-map-core.ts` 의
  `detailRouteForUrl`(:112) 가 3+세그먼트(`/moims/{id}/chat`, `/home/123/edit` 등)를 detail-push 대상에서 **명시적으로
  제외**(:108 주석 — "비-detail 경로(/moims/{id}/chat 등)까지 push 되어 MOBILE-003 인증/채팅 깨짐 방지")한다 →
  `/moims/{id}/expenses` 도 자동으로 in-WebView(신규 라우팅 로직 0, vitest 회귀만). 모임 상세 page.tsx 의 "채팅 입장"
  Link(:117-128)를 미러해 "경비" 버튼 추가. **§5 의 "경비 섹션을 page.tsx 에 전달" 그라운딩(§5 위)은 v0.1.0 가정이며
  v0.2.0 에서 전용 라우트로 대체됨** — 경비 데이터는 `home/[id]/page.tsx` 가 아니라 `expenses/page.tsx` 가 fetch 한다.
- **정산 토글 영속(결정 3)**: 신규 `Settlement` 테이블(additive, FK cascade — `add_poll` 선례) + owner 토글 라우트.
  surrogate id PK(복합 PK 아님 — stale/신규 마커 구별). 정산 거래는 항상 경비에서 재계산, settled 는 (from,to,amount)
  매칭 플래그(정보성). realtime: `settlement` 행 트리거(INSERT/DELETE)가 `broadcast_expense_change()` 같은 함수를 공유해
  `'expense_change'` 방송(settlement 도 moim_id 직접 보유 — 역조회 불필요). **§4/§8 의 "expense 행만 트리거" 그라운딩은
  v0.1.0 가정**이며 v0.2.0 에서 expense + settlement 두 트리거(같은 함수)로 확장됨.
- **경비 수정(결정 5)**: `PATCH /moims/:id/expenses/:expenseId`. ExpenseShare 재 materialize 는 PollService.vote 단일
  교체(`poll.service.ts`:151-154 `deleteMany`+`create` 트랜잭션) 패턴을 미러.
- **예산 PATCH 확장(결정 6)**: `apps/backend/src/moim/moim.controller.ts` `PATCH /moims/:id`(:171, 현재 maxMembers) +
  `MoimService.updateMaxMembers`(`moim.service.ts`:53-63, assertOwner 후 moim.update)를 budget 수용으로 확장. 검증 헬퍼는
  컨트롤러(:250 maxMembers 검증) 옆에 budget 검증 추가. **§3/§5 의 `setBudget` 신규 메서드 언급은 v0.1.0 대안**이며 결정
  6 에서 기각됨(전용 메서드/라우트 미신설 — 기존 PATCH 확장).
- **비율 분배(결정 1)**: ExpenseShare 에 ratio 컬럼 없음 — 비율은 생성/수정 시 금액 환산해 shareAmount 로만 저장(균등
  나머지 규칙 재사용). 정산 코드는 항상 금액만 읽음.
- **통화 KRW 정수(결정 4)**: amount/shareAmount/budget 모두 Int(소수점 없음). Prisma `Int` 컬럼.
