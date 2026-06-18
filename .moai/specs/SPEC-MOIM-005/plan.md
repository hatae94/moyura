# SPEC-MOIM-005 구현 계획 (Plan)

> SPEC-MOIM-005: 모임 투표(poll) — 생성·단일 투표·결과 집계
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 신규 도메인(brownfield 컨텍스트). 백엔드는 jest(신규 케이스), 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 검증. 백엔드 변경 → OpenAPI → api-client 재생성 → web 소비의 단방향 데이터 흐름.
- **데이터 흐름(순서 의존)**: (1) Prisma 스키마 + 비파괴 마이그레이션 → (2) poll 도메인(service + controller + DTO + module) → (3) backend jest → (4) `nx run api-client:generate`(재생성) + poll 타입 별칭 → (5) web 헬퍼 + 상세 화면 Client 섬/Server Action. 백엔드가 먼저 OpenAPI 를 바꿔야 api-client 타입에 poll DTO 가 생긴다.
- **additive 원칙**: 모든 백엔드 변경은 신규 테이블/모듈 추가다 — 기존 테이블·서비스·컨트롤러는 무변경(`Moim` 에 `polls Poll[]` 역참조 1줄만 추가, `invites`/`messages` 선례 동일).
- **멤버 스코핑 재사용**: poll service 의 모든 진입(create/vote/list)은 첫 줄에서 `MoimService.assertMember(sub, moimId)` 를 호출한다 — 인가 단일 출처 불변. 새 인가 정책을 만들지 않는다.
- **엔드포인트 shape**: `@Controller('moims/:id/polls')` — ChatController(`moims/:id/messages`) 미러. moimId 가 항상 path 에 있어 `assertMember` 직접 호출, poll→moim 역방향 lookup 불필요.
- **디자인 시스템**: Meetup 오렌지 시맨틱 토큰 — `(main)/home/[id]` 의 토큰을 따른다(login/onboarding blue 아님).

## 2. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M5). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 스키마 + 비파괴 마이그레이션 (Priority: High)

- `apps/backend/prisma/schema.prisma`:
  - `Moim` 에 `polls Poll[]` 역참조 1줄 추가(관계 선언 — moim 컬럼·기존 관계 무변경).
  - `model Poll { id @id @default(uuid); moimId @map("moim_id"); question; createdBy @map("created_by"); createdAt @default(now) @map("created_at"); moim @relation(...onDelete: Cascade); options PollOption[]; votes PollVote[] }` → `@@map("poll")`.
  - `model PollOption { id @id @default(uuid); pollId @map("poll_id"); label; poll @relation(...onDelete: Cascade); votes PollVote[] }` → `@@map("poll_option")`.
  - `model PollVote { pollId @map("poll_id"); optionId @map("option_id"); userId @map("user_id"); createdAt @default(now) @map("created_at"); poll @relation(...onDelete: Cascade); option @relation(...onDelete: Cascade); @@id([pollId, userId]) }` → `@@map("poll_vote")`. (복합 PK = 멤버당 한 투표 불변식.)
- 마이그레이션(비파괴 패턴 — `prisma migrate dev` 의 파괴적 reset 회피):
  - `apps/backend/prisma/migrations/{TS}_add_poll/migration.sql` 를 수동 작성 — 신규 3 테이블 CREATE + FK(cascade) + `poll_vote` 복합 PK `(poll_id, user_id)`. moim 테이블 무변경.
  - `prisma migrate diff` 로 스키마↔DB 차이 확인 → `prisma db execute` 로 SQL 적용 → `prisma migrate resolve --applied {TS}_add_poll` → `prisma migrate status` clean 확인(`add_moim_event_fields`/`add_profile_name` 선례).
- 게이트: `prisma migrate status` clean, 기존 모임/멤버/채팅/초대 조회 회귀 0(신규 테이블만 추가).

### M2 — 백엔드 poll 도메인 (Priority: High, depends: M1)

> 신규 모듈은 `apps/backend/src/poll/` 에 둔다(moim 모듈 비대화 방지, ~500 LOC 규칙). `MoimService`(assertMember) 의존 주입을 위해 `MoimModule` 을 import 한다.

- `apps/backend/src/poll/dto/create-poll.dto.ts` (NEW) — `{ question: string; options: string[] }`, `@ApiProperty`. class-validator 미사용.
- `apps/backend/src/poll/dto/vote.dto.ts` (NEW) — `{ optionId: string }`, `@ApiProperty`.
- `apps/backend/src/poll/dto/poll-response.dto.ts` (NEW) — `{ id; question; createdBy; createdAt; options: { id; label; voteCount }[]; myVote: string | null }`, `@ApiProperty`(nullable myVote).
- `apps/backend/src/poll/poll.service.ts` (NEW):
  - `createPoll(sub, moimId, question, options[])` — `assertMember` → 트랜잭션으로 `poll.create` + `pollOption.createMany`(또는 nested create). `createdBy = sub`(가드-검증). question/options 정규화는 컨트롤러가 선처리(빈/<2 400).
  - `vote(sub, moimId, pollId, optionId)` — `assertMember` → poll 이 moimId 에 속하는지 확인(아니면 404/NotFound) → optionId 가 그 poll 의 옵션인지 확인(아니면 400/BadRequest) → `pollVote.upsert({ where: { pollId_userId }, create, update: { optionId } })`(재투표 교체).
  - `listPolls(sub, moimId)` — `assertMember` → 모임 poll 들을 options 와 함께 조회 → 각 옵션 voteCount 집계(`pollVote.groupBy` by optionId count, 또는 `_count`) → 호출자 `(pollId,userId)` 표 조회로 myVote 매핑(표 0 옵션도 voteCount:0 포함).
- `apps/backend/src/poll/poll.controller.ts` (NEW) — `@Controller('moims/:id/polls')` + `@UseGuards(SupabaseAuthGuard)` + `@ApiBearerAuth('bearer')`:
  - `POST /` → question `requireNonEmpty` 400, options 정규화(trim 후 비지 않은 것 ≥2 else 400) → `createPoll` → 201 + PollResponseDto.
  - `GET /` → `listPolls` → 200 + PollResponseDto[].
  - `POST /:pollId/vote` → optionId `requireNonEmpty` → `vote` → 200(또는 201) + 갱신된 PollResponseDto(또는 204; 구현 단계에서 일관 선택 — 본 계획은 갱신된 단건 poll 반환 권장으로 web 이 재조회 없이 즉시 반영 가능).
  - 헬퍼: `requireNonEmpty`(moim/chat 선례), `normalizeOptions`(trim + 빈 제거 + ≥2 검사), `toPollDto`(집계 → DTO).
- `apps/backend/src/poll/poll.module.ts` (NEW) — `imports: [MoimModule]`(또는 PrismaModule + MoimService provider), `controllers: [PollController]`, `providers: [PollService]`.
- `apps/backend/src/app.module.ts` (MODIFY) — `PollModule` 등록.
- 게이트: tsc 0, OpenAPI 가 poll DTO 노출.

### M3 — backend jest (Priority: High, depends: M2)

- `apps/backend/src/poll/poll.controller.spec.ts` (NEW) — 신규 케이스:
  - 생성: question + options[≥2] → service 호출 + 201 DTO.
  - question 빈 → 400. 유효 옵션 <2 → 400.
  - 투표: optionId → service 호출. optionId `requireNonEmpty` 빈 → 400.
- `apps/backend/src/poll/poll.service.spec.ts` (NEW) — fake/mock prisma:
  - createPoll 이 assertMember 호출 + poll+options 트랜잭션 생성.
  - vote 가 `(pollId,userId)` upsert(없으면 생성, 있으면 optionId 교체).
  - vote 가 다른 poll 의 optionId → 400; 다른 모임의 pollId → 404.
  - listPolls 가 voteCount 집계 + myVote 매핑(투표 전 null, 투표 후 해당 optionId, 표 0 옵션 voteCount:0).
  - 모든 진입(create/vote/list)이 비멤버 → assertMember 가 403(ForbiddenException) 전파.
- `apps/backend/src/poll/poll.integration.spec.ts` (NEW) — fake store(moim/member/chat integration 선례 미러):
  - 멤버 생성·투표·목록 end-to-end(get token mint → POST/GET) — 401(토큰 없음)/403(비멤버)/400(빈 question·옵션<2·잘못 optionId) 케이스.
  - 재투표가 표 수를 늘리지 않고 교체하는지(같은 사용자 두 번 투표 → 한 표, optionId 변경).
- 게이트: backend jest 전체 통과(신규 포함), branch coverage floor 유지(NestJS DI/decorator phantom branch 는 `collectCoverageFrom` 제외 정책 — backend-nestjs-coverage 메모리).

### M4 — api-client 재생성 + poll 타입 (Priority: High, depends: M2)

- `nx run api-client:generate` — 백엔드 OpenAPI(신규 CreatePollDto/VoteDto/PollResponseDto)를 반영해 `packages/api-client/src/schema.d.ts` 재생성. 수동 편집 금지.
- `packages/api-client/src/index.ts` (MODIFY):
  - poll DTO 타입 별칭 추가: `CreatePollRequest = components['schemas']['CreatePollDto']`, `VoteRequest = components['schemas']['VoteDto']`, `PollResponse = components['schemas']['PollResponseDto']`(`CreateMoimRequest`/`MoimResponse` 선례).
  - **편의 메서드는 추가하지 않는다** — poll 라우트는 path-param(`/moims/:id/polls`, `/moims/:id/polls/:pollId/vote`)이라 web 구체-경로 헬퍼로 호출(getMoim/getMoimMembers 와 동일 — api-client 편의 메서드 표면은 리터럴 경로 전용 유지).
- 게이트: api-client tsc 0.

### M5 — 웹 헬퍼 + 상세 화면 투표 UI (Priority: High, depends: M4)

- `apps/web/lib/moim/polls.ts` (NEW — 또는 `lib/moim/api.ts` 확장, ~500 LOC 규칙으로 분리 권장):
  - 타입: `PollWithResults { id; question; createdBy; createdAt; options: { id; label; voteCount }[]; myVote: string | null }`(PollResponse 미러).
  - `listPolls(api, moimId): Promise<PollWithResults[]>` — `api.request(\`/moims/${enc(moimId)}/polls\` as never, "get")`.
  - `createPoll(api, moimId, body): Promise<...>` — `api.request(path as never, "post", { headers, body: JSON.stringify(body) })`.
  - `votePoll(api, moimId, pollId, optionId)` — `api.request(\`/moims/${enc(moimId)}/polls/${enc(pollId)}/vote\` as never, "post", { headers, body })`.
  - `moimErrorStatus` 재사용(403/404 분류).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` (NEW — `"use server"`):
  - `createPollAction(prev, formData)` — question/options(동적 입력) 읽기 + 검증(빈 question·유효 옵션<2 → `{ error }` 폼 머무름) → 세션(없으면 `/login`) → web 헬퍼 `createPoll` → 성공 시 `revalidatePath('/home/{id}')`, 실패(ApiError) → `{ error: GENERIC }`.
  - `voteAction(moimId, pollId, optionId)` — 세션 → `votePoll` → `revalidatePath('/home/{id}')`(또는 반환된 갱신 poll 로 즉시 반영). 실패 시 일반화 오류.
- `apps/web/app/(main)/home/[id]/polls-section.tsx` (NEW — Client Component):
  - props: `moimId`, `polls: PollWithResults[]`(서버 fetch).
  - 각 poll: 질문 + 옵션 리스트(라벨 + voteCount + 막대/퍼센트, 총표 대비 비율) + 단일 선택 투표 컨트롤(클릭 → `voteAction`, 내 표 `myVote === option.id` 강조).
  - "투표 만들기" 폼: 질문 입력 + 동적 옵션 입력(추가/제거, 최소 2), `useActionState(createPollAction)`. 에러 박스 + pending 비활성.
  - 빈 상태: poll 0개면 "아직 투표가 없어요".
  - Meetup 오렌지 토큰(`bg-primary` 막대/버튼, `border-border`/`bg-card` 등).
- `apps/web/app/(main)/home/[id]/page.tsx` (MODIFY):
  - 기존 가드 + 모임/멤버 fetch 보존. 추가로 `listPolls(api, id)` 서버 조회(Promise.all 에 합류, 실패는 빈 배열 graceful — 투표 조회 실패가 상세 전체를 막지 않게; 단 403/404 는 기존 notFound 경로). `<PollsSection moimId={id} polls={polls} />` 마운트(채팅 입장/멤버 섹션 사이 또는 아래 — 구현 단계 배치).
- 게이트: web tsc 0, web lint 0, `nx run web:build` 0(Client 섬 + Server Action 컴파일).

## 3. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] 마이그레이션이 신규 3 테이블 CREATE 만(moim 무변경) — 기존 모임/멤버/채팅/초대 조회 회귀 0인가? 비파괴 패턴(migrate diff/db execute/resolve)으로 적용했는가?
- [ ] `PollVote` 복합 PK `(pollId, userId)` 가 멤버당 한 투표를 강제하는가? 재투표가 표를 늘리지 않고 optionId 만 교체하는가(upsert)?
- [ ] poll service 의 create/vote/list 모두 첫 줄에서 `assertMember` 를 호출해 비멤버 403인가?
- [ ] vote 가 잘못된 optionId(교차-poll/미존재) → 400, 다른 모임의 pollId → 404 로 차단되는가?
- [ ] question 빈 / 유효 옵션 <2 → 400인가? 빈 옵션 항목은 무시하고 유효 항목만 세는가?
- [ ] listPolls 가 각 옵션 voteCount(표 0 포함) + 호출자 myVote(null/optionId)를 정확히 반환하는가?
- [ ] api-client 재생성 후 PollResponse/CreatePollRequest/VoteRequest 타입이 있는가? web 헬퍼가 구체-경로 + `path as never` 로 호출하는가?
- [ ] 상세 Server Component 가 직렬화 가능한 props 만 Client 섬에 넘기는가(함수/인스턴스 금지)? Server Action 은 `"use server"` 모듈에서 import 하는가?
- [ ] 투표/생성 폼이 Meetup 오렌지 토큰을 쓰는가(onboarding blue 아님)? 빈 상태("아직 투표가 없어요")가 정직한가?
- [ ] 투표/생성 후 `revalidatePath` 로 결과가 갱신되는가(디바이스 검증)?

## 4. 검증 게이트 (요약)

spec.md §7 참조. 핵심: prisma migrate clean(비파괴 3 테이블) → backend jest(신규 poll) → tsc 0(backend/web/api-client) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → 디바이스 종단 검증(상세 → 투표 만들기 → 투표 → 득표/내 표 갱신 → 재투표 교체).

## 5. 위임/협의 권장

- 백엔드 스키마·poll service/controller·집계·jest: expert-backend 협의 가능(비파괴 마이그레이션 + no-ValidationPipe 검증 + groupBy 집계 + upsert 재투표).
- 웹 Client 섬·Server Action·득표 막대·디자인 토큰: expert-frontend 협의 가능(Server Component↔Client 경계 + useActionState 동적 옵션 폼 + Meetup 오렌지 일관).
