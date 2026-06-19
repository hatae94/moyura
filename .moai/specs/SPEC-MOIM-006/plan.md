# SPEC-MOIM-006 구현 계획 (Plan)

> SPEC-MOIM-006: 투표 다중 선택(multi-select) — 가능한 항목 모두 선택
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 기존 도메인 확장(brownfield). 백엔드는 jest(신규 다중 + 단일 회귀), 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 검증. 백엔드 변경 → OpenAPI → api-client 재생성 → web 소비의 단방향 데이터 흐름(MOIM-005 동일).
- **데이터 흐름(순서 의존)**: (1) Prisma 스키마(multiSelect 컬럼 + PollVote PK) + 비파괴 마이그레이션 → (2) poll 도메인(service vote 분기 + createPoll multiSelect + aggregate myVotes + DTO) → (3) backend jest(다중 신규 + 단일 회귀) → (4) `nx run api-client:generate`(재생성) + 별칭 주석 갱신 → (5) web 헬퍼/타입 + polls-section 분기 + 생성 토글. 백엔드가 먼저 OpenAPI(multiSelect/myVotes)를 바꿔야 api-client 타입에 반영된다.
- **additive + 제약 재정의 원칙**: `Poll.multiSelect` 는 순수 컬럼 추가(`@default(false)` → 기존 row 무영향). `PollVote` PK 변경은 컬럼은 그대로(pollId/optionId/userId 이미 존재)이고 PK *구성*만 확장 — 기존 데이터가 신규 제약을 이미 만족(§데이터 안전성).
- **멤버 스코핑 보존**: poll service 의 모든 진입(create/vote/list)은 첫 줄 `MoimService.assertMember(sub, moimId)` 호출을 유지(MOIM-005 불변). PK/multiSelect 변경이 인가에 영향 없다.
- **엔드포인트 shape 보존**: `@Controller('moims/:id/polls')` 라우트 3개(POST 생성 / GET 목록 / POST :pollId/vote) 그대로. vote 요청 바디 `{ optionId }` 그대로(단일→교체, 다중→토글은 service 가 poll.multiSelect 로 분기).
- **디자인 시스템**: Meetup 오렌지 시맨틱 토큰 — `(main)/home/[id]` 토큰을 따른다(login/onboarding blue 아님).

## 2. 데이터 안전성 — PK 변경 논증 (핵심)

- 현재: `PollVote @@id([pollId, userId])` → (pollId,userId) 당 1 row.
- 신규: `@@id([pollId, optionId, userId])` → (pollId,optionId,userId) 당 1 row.
- **손실 0**: 기존 모든 row 는 (pollId,userId) 가 유일하므로 (pollId,optionId,userId) 도 자동 유일 → 신규 PK 를 위반 없이 만족 → 기존 PK DROP + 신규 PK ADD 가 어떤 row 도 충돌·삭제하지 않는다(순수 제약 재정의).
- **마이그레이션 SQL(비파괴)**:
  ```sql
  ALTER TABLE "poll" ADD COLUMN "multi_select" BOOLEAN NOT NULL DEFAULT false;
  ALTER TABLE "poll_vote" DROP CONSTRAINT "poll_vote_pkey";
  ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_pkey" PRIMARY KEY ("poll_id", "option_id", "user_id");
  ```
  (정확한 제약명은 `prisma migrate diff` 출력으로 확인 — 위는 예시. 기존 FK/`@@index([optionId])` 는 보존.)
- 적용: `prisma migrate diff`(스키마↔DB)로 SQL 생성·검토 → `prisma db execute --file` 로 적용 → `prisma migrate resolve --applied {TS}_add_poll_multi_select` → `prisma migrate status` clean(MOIM-005 add_poll 선례). `prisma migrate dev` 의 파괴적 reset 회피.

## 3. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M5). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 스키마 + 비파괴 PK 마이그레이션 (Priority: High)

- `apps/backend/prisma/schema.prisma` (MODIFY):
  - `model Poll` — `multiSelect Boolean @default(false) @map("multi_select")` 1줄 추가(기존 컬럼·관계·`@@index([moimId])` 무변경).
  - `model PollVote` — `@@id([pollId, userId])` → `@@id([pollId, optionId, userId])`. 컬럼·FK·`@@index([optionId])` 보존. 주석 갱신(멤버당 옵션당 한 표 = 0..N 표).
- 마이그레이션(비파괴 패턴 — §2):
  - `apps/backend/prisma/migrations/{TS}_add_poll_multi_select/migration.sql` 수동 작성 — multi_select 컬럼 ADD + poll_vote PK DROP/ADD(§2 SQL). 다른 테이블 무변경.
  - `prisma migrate diff` 로 스키마↔DB 차이 확인(생성 SQL 과 일치하는지) → `prisma db execute` 적용 → `prisma migrate resolve --applied {TS}_add_poll_multi_select` → `prisma migrate status` clean.
- 게이트: migrate status clean, 기존 단일 선택 표 보존(row count 불변 확인), 기존 모임/멤버/채팅/초대/단일 투표 조회 회귀 0.

### M2 — 백엔드 poll 도메인 multiSelect + vote 분기 + myVotes (Priority: High, depends: M1)

- `apps/backend/src/poll/dto/create-poll.dto.ts` (MODIFY) — `multiSelect?: boolean` 추가(`@ApiProperty({ description: '여러 개 선택 허용', required: false, default: false, example: false })`). class-validator 미사용.
- `apps/backend/src/poll/dto/poll-response.dto.ts` (MODIFY) — `multiSelect: boolean`(`@ApiProperty`) 추가, `myVote: string | null` 제거 → `myVotes: string[]`(`@ApiProperty({ type: [String], description: '호출자가 고른 선택지 id 목록(미투표 시 빈 배열)' })`).
- `apps/backend/src/poll/poll.service.ts` (MODIFY):
  - `PollWithResults` 인터페이스 — `multiSelect: boolean` 추가, `myVote: string | null` 제거 → `myVotes: string[]`.
  - `createPoll(sub, moimId, question, options, multiSelect: boolean)` — multiSelect 파라미터 추가 → `poll.create` data 에 `multiSelect`. (반환 `PollWithOptions` 는 multiSelect 포함 — Poll 타입에 컬럼이 생기므로 자동.)
  - `vote(sub, moimId, pollId, optionId)` — assertMember → poll 일관성(404) → optionId 소속(400) 검증(보존) 후 `poll.multiSelect` 분기:
    - false(단일): 트랜잭션 — `pollVote.deleteMany({ where: { pollId, userId: sub } })` → `pollVote.create({ data: { pollId, optionId, userId: sub } })`(교체, 멤버당 1표 — MOIM-005 동작 보존). (기존 `upsert({ where: { pollId_userId }})` 는 PK 변경으로 무효 → 재작성.)
    - true(다중): `pollVote.findUnique({ where: { pollId_optionId_userId: { pollId, optionId, userId: sub } } })` → 있으면 `delete`(토글 off), 없으면 `create`(토글 on).
    - 끝에 `aggregatePolls(sub, [poll])` 반환(갱신 단건 — myVotes 포함).
  - `listPolls` — 무변경(aggregatePolls 위임).
  - `aggregatePolls` — 각 poll map 에 `multiSelect: poll.multiSelect` 추가. 호출자 표 매핑을 단일(`myVoteByPoll: Map<pollId, optionId>`)에서 **목록**(`myVotesByPoll: Map<pollId, string[]>` — 같은 pollId 의 optionId 들을 push)으로 변경 → `myVotes: myVotesByPoll.get(poll.id) ?? []`. voteCount groupBy 로직은 그대로(멤버당 옵션당 1표 → count = 멤버 수).
- `apps/backend/src/poll/poll.controller.ts` (MODIFY):
  - `create` — `body.multiSelect` 를 boolean 으로 정규화(`body?.multiSelect === true`)해 `createPoll(..., multiSelect)` 전달.
  - `newPollToDto(poll)` — `multiSelect: poll.multiSelect`, `myVotes: []`(신규 poll 은 투표 0).
  - `resultToDto(poll)` — `multiSelect: poll.multiSelect`, `myVotes: poll.myVotes`. (`myVote` 매핑 제거.)
  - `requireNonEmpty`/`normalizeOptions` 헬퍼·400/403/404 정책 무변경.
- 게이트: tsc 0, OpenAPI 가 multiSelect/myVotes 노출.

### M3 — backend jest (다중 신규 + 단일 회귀) (Priority: High, depends: M2)

- `apps/backend/src/poll/poll.controller.spec.ts` (MODIFY) — 신규/갱신:
  - 생성: `multiSelect: true` 전달 시 service 가 그 값으로 호출. multiSelect 생략 시 false 전달(기본).
  - DTO 매핑: 신규 poll 응답에 `multiSelect` + `myVotes: []`. 기존 question 빈/옵션<2 400 회귀.
- `apps/backend/src/poll/poll.service.spec.ts` (MODIFY) — fake/mock prisma:
  - **단일 회귀**: multiSelect=false poll 에서 vote → deleteMany+create(교체); 재투표 → 한 표 유지(optionId 변경, 총 1표 불변).
  - **다중 신규**: multiSelect=true poll 에서 vote(A) → 표 추가; vote(B) → A,B 둘 다 보유; vote(A) 다시 → A 제거(토글 off, B 만 남음).
  - vote 가 다른 poll 의 optionId → 400; 다른 모임 pollId → 404(단일/다중 공통).
  - listPolls/aggregate: 다중 poll 에서 한 멤버가 A,B 고름 → A,B voteCount 각 1, myVotes=[A,B]. 단일 poll → myVotes 0 또는 1요소. 표 0 옵션 voteCount:0.
  - 모든 진입(create/vote/list) 비멤버 → assertMember 403 전파(보존).
- `apps/backend/src/poll/poll.integration.spec.ts` (MODIFY) — fake store:
  - 다중 선택 생성→토글(추가/제거)→목록 end-to-end. 단일 선택 생성→투표→재투표 교체 회귀.
  - 401/403/400/404 케이스 보존. 다중 토글 off 후 voteCount 감소 확인.
- 게이트: backend jest 전체 통과(다중 신규 + 단일 회귀), branch coverage floor 유지(NestJS DI/decorator phantom branch `collectCoverageFrom` 제외 정책 — backend-nestjs-coverage 메모리).

### M4 — api-client 재생성 + poll 타입 (Priority: High, depends: M2)

- `nx run api-client:generate` — 백엔드 OpenAPI(CreatePollDto.multiSelect, PollResponseDto.multiSelect + myVotes, myVote 제거)를 반영해 `packages/api-client/src/schema.d.ts` 재생성. 수동 편집 금지.
- `packages/api-client/src/index.ts` (MODIFY) — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지, 주석 갱신(`myVote` → `myVotes`/`multiSelect`). 편의 메서드는 추가하지 않음(path-param → web 구체-경로 헬퍼 유지).
- 게이트: api-client tsc 0(재생성된 schema 와 별칭 일치).

### M5 — 웹 헬퍼/타입 + 다중 렌더 + 생성 토글 (Priority: High, depends: M4)

- `apps/web/lib/moim/polls.ts` (MODIFY) — `PollWithResults` 타입을 `multiSelect: boolean` + `myVotes: string[]`(myVote 제거)로 갱신. `listPolls`/`createPoll`/`votePoll` 시그니처·구현 무변경(타입만 흐름).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` (MODIFY) — `createPollAction` 이 `formData.get("multiSelect")`(체크박스 "on"/null)를 boolean(`=== "on"` 또는 truthy)으로 읽어 `createPoll(api, moimId, { question, options, multiSelect })` 에 전달. `voteAction` 무변경(다중 토글도 동일 라우트·시그니처).
- `apps/web/app/(main)/home/[id]/polls-section.tsx` (MODIFY):
  - `OptionRow` — `isMine` prop 비교를 `myVotes.includes(option.id)` 로(상위에서 전달). 다중 시 체크박스형 아이콘/`aria-pressed` 적절화.
  - `PollCard` — `poll.multiSelect` 분기: 다중이면 여러 선택지 동시 강조 + 안내 문구("가능한 항목 모두 선택")+ 탭=토글; 단일이면 MOIM-005 그대로(한 강조 + 탭=교체). `isMine={poll.myVotes.includes(option.id)}` 전달. 총표/퍼센트는 다중에서 합 100% 아닐 수 있음(주석).
  - `CreatePollForm` — "여러 개 선택 허용" 체크박스(`name="multiSelect"`) 추가(Meetup 오렌지, 기본 꺼짐). 라벨·도움말 한 줄.
- `apps/web/app/(main)/home/[id]/page.tsx` — **무변경**(이미 listPolls fetch + PollsSection 마운트). 타입 갱신이 그대로 흐른다.
- 게이트: web tsc 0(myVote→myVotes 전 소비처 갱신), web lint 0, `nx run web:build` 0(다중 분기 + 토글 컴파일).

## 4. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] `Poll.multiSelect` 가 additive(기본 false)이고 기존 poll row 가 모두 단일 선택(false)을 유지하는가?
- [ ] `PollVote` PK 가 `(pollId,optionId,userId)` 로 비파괴 변경되고 기존 단일 선택 표가 한 row 도 손실되지 않았는가(row count 불변)? migrate status clean 인가?
- [ ] vote 가 `poll.multiSelect` 로 분기하는가 — false=교체(총 1표 불변, MOIM-005 회귀 0), true=토글(추가/제거, 0..N)?
- [ ] vote 가 잘못된 optionId(교차-poll/미존재) → 400, 다른 모임 pollId → 404, 비멤버 → 403 을 단일/다중 공통으로 유지하는가?
- [ ] create 가 multiSelect 옵트인(생략 시 false)을 받고, 단일 선택 생성 경로가 무변경인가?
- [ ] listPolls/aggregate 가 각 poll 의 multiSelect + 옵션 voteCount(다중=멤버 수, 표 0 포함) + myVotes(목록, 미투표 빈 배열)를 반환하는가?
- [ ] myVote→myVotes 변경의 모든 소비처(DTO/OpenAPI/api-client PollResponse/web PollWithResults/web OptionRow)가 갱신되어 tsc 0 인가?
- [ ] api-client 재생성 후 PollResponse 에 multiSelect/myVotes 가 있고 myVote 가 없는가?
- [ ] web 의 다중 poll 이 여러 선택지 동시 강조 + 토글로 렌더되고, 단일 poll 은 MOIM-005 그대로(한 강조, 교체)인가?
- [ ] 생성 폼 "여러 개 선택 허용" 토글이 Meetup 오렌지이고 기본 꺼짐인가? 토글 켜면 multiSelect:true 가 전달되는가?
- [ ] 투표/생성 후 `revalidatePath` 로 결과가 갱신되는가(디바이스 검증)?

## 5. 검증 게이트 (요약)

spec.md §7 참조. 핵심: prisma migrate clean(multiSelect 컬럼 + PK 비파괴 변경, 기존 표 보존) → backend jest(다중 신규 + 단일 회귀) → tsc 0(backend/web/api-client, myVote→myVotes 전파) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → 디바이스 종단 검증(다중 생성 → 다중 토글 → 단일 회귀 확인).

## 6. 위임/협의 권장

- 백엔드 PK 비파괴 마이그레이션·vote 분기 재작성(upsert→find/delete/create)·myVotes 집계·jest 회귀: expert-backend 협의 가능(데이터 안전 SQL + 단일/다중 분기 + groupBy 집계).
- 웹 단일/다중 렌더 분기·생성 토글·myVotes 강조·디자인 토큰: expert-frontend 협의 가능(Client 섬 보존 + 체크박스형 토글 + Meetup 오렌지 일관).
