# SPEC-MOIM-008 구현 계획 (Plan)

> SPEC-MOIM-008: 일정 투표 자동 확정 — 날짜 투표 마감 시 승자 → Moim.startsAt
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 기존 도메인 확장(brownfield). 백엔드는 jest(날짜 투표 + finalize 신규 + 일반 투표/마감 회귀), 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 검증. 백엔드 변경 → OpenAPI → api-client 재생성 → web 소비의 단방향 데이터 흐름(MOIM-005/006/007 동일).
- **데이터 흐름(순서 의존)**: (1) Prisma 스키마(Poll.kind + PollOption.optionDate) + 비파괴 마이그레이션 → (2) MoimService.setStartsAt(startsAt 쓰기 단일 출처) → (3) poll 도메인(createPoll optionDate/kind + closePoll finalize + aggregate kind/optionDate + DTO finalize 2필드 + 컨트롤러 parseKind/parseOptionDates) → (4) backend jest(날짜 투표 + finalize 신규 + 일반/마감 회귀) → (5) `nx run api-client:generate`(재생성) + 별칭 주석 갱신 → (6) web 헬퍼/타입 + 일정 투표 토글 + datetime 옵션 + 날짜 포맷 렌더 + 확정 힌트/동점 notice. 백엔드가 먼저 OpenAPI(kind/optionDate/finalize)를 바꿔야 api-client 타입에 반영된다.
- **additive 원칙**: `Poll.kind` 는 string `@default("general")` 추가(enum 아님 — CREATE TYPE 마찰 회피). `PollOption.optionDate` 는 nullable 추가. PK·FK·인덱스 변경 없음(MOIM-006 의 `(pollId,optionId,userId)` PK 그대로). 읽기 모델은 필드 4개 추가(제거 아님 — break 아님).
- **멤버 스코핑 + 생성자 인가**: poll service 의 모든 진입(create/vote/list/close)은 첫 줄 `MoimService.assertMember(sub, moimId)` 호출 유지(MOIM-005/006/007 불변). finalize 는 close 핸들러 안에서만 — close 는 MOIM-007 생성자 전용(assertMember 403 → poll 404 → 생성자 403). 비생성자/비멤버는 finalize 에 도달하지 못한다.
- **finalize 트리거**: 생성자 수동 마감(`POST .../close`)뿐. passive deadline-pass·크론 없음. closePoll 이 closesAt=now 설정 후 `poll.kind === 'date'` 면 단일 최다 득표 승자를 계산해 setStartsAt 호출(또는 동점/무표 스킵).
- **startsAt 쓰기 단일 출처**: `MoimService.setStartsAt(moimId, startsAt)` 신규 메서드 1곳(createMoim 외 유일 startsAt 쓰기 경로). closePoll 이 finalize 시 호출(직접 prisma.moim.update 금지).
- **디자인 시스템**: Meetup 오렌지 시맨틱 토큰 — `(main)/home/[id]` 토큰을 따른다(login/onboarding blue 아님). 일정 투표 토글/확정 힌트/동점 notice 모두 일관.

## 2. 데이터 모델 — kind + optionDate (핵심)

- 추가: `Poll.kind String @default("general") @map("kind")`(string, enum 아님) + `PollOption.optionDate DateTime? @map("option_date")`(nullable).
- 종류 도출: `kind = "general"`(자유 텍스트 옵션, optionDate=null — MOIM-005/006/007 그대로) / `kind = "date"`(옵션이 날짜, optionDate=시각, label=ISO).
- 허용 값 검증은 컨트롤러(`parseKind`: 생략→"general", "general"/"date" 허용, 그 외 400). DB enum/CHECK 제약 없음.
- **마이그레이션 SQL(비파괴)**:
  ```sql
  ALTER TABLE "poll" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'general';
  ALTER TABLE "poll_option" ADD COLUMN "option_date" TIMESTAMP(3);
  ```
  (정확한 타입/제약은 `prisma migrate diff` 출력으로 확인 — 위는 예시. kind 는 NOT NULL DEFAULT 'general'(기존 row 채움), option_date 는 nullable. poll_vote PK·FK·`@@index` 무변경.)
- 적용: `prisma migrate diff`(스키마↔DB)로 SQL 생성·검토 → `prisma db execute --file` 로 적용 → `prisma migrate resolve --applied {TS}_add_poll_kind_option_date` → `prisma migrate status` clean(MOIM-005/006/007 add_poll/add_poll_multi_select/add_poll_closes_at 선례). `prisma migrate dev` 의 파괴적 reset 회피(hand-edited add_chat 트리거 보존). enum 회피로 CREATE TYPE 없음.

## 3. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M6). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 스키마 + 비파괴 마이그레이션 (Priority: High)

- `apps/backend/prisma/schema.prisma` (MODIFY):
  - `model Poll` — `kind String @default("general") @map("kind")` 1줄 추가(기존 컬럼·관계·`@@index([moimId])`·multiSelect·closesAt 무변경). 주석 1줄("general"=자유 텍스트 / "date"=날짜 옵션, enum 아님).
  - `model PollOption` — `optionDate DateTime? @map("option_date")` 1줄 추가(nullable; 날짜 옵션만 채움). 주석 1줄.
- 마이그레이션(비파괴 패턴 — §2):
  - `apps/backend/prisma/migrations/{TS}_add_poll_kind_option_date/migration.sql` 수동 작성 — `poll.kind`(NOT NULL DEFAULT 'general') + `poll_option.option_date`(nullable) ADD 만. 다른 테이블/PK/FK 무변경.
  - `prisma migrate diff` 로 스키마↔DB 차이 확인 → `prisma db execute` 적용 → `prisma migrate resolve --applied {TS}_add_poll_kind_option_date` → `prisma migrate status` clean.
- 게이트: migrate status clean, 기존 poll(kind 'general')/option(option_date null)/vote row 보존(row count 불변), 기존 모임/멤버/채팅/초대/단일·다중 투표/마감 조회 회귀 0.

### M2 — 백엔드 MoimService.setStartsAt (startsAt 쓰기 단일 출처) (Priority: High, depends: M1)

- `apps/backend/src/moim/moim.service.ts` (ADD):
  - `setStartsAt(moimId: string, startsAt: Date): Promise<void>` (신규) — `prisma.moim.update({ where: { id: moimId }, data: { startsAt } })`. 인가 재검증 안 함(호출자 closePoll 이 이미 assertMember + 생성자 검사 통과 — 순수 도메인 쓰기). moim 존재는 poll.moimId 가 보장(close 가 poll-moim 일관성 검증). @MX:NOTE — createMoim 외 유일한 startsAt 쓰기 경로(finalize 가 호출).
- 게이트: tsc 0. createMoim 무변경(startsAt 쓰기 두 경로가 한 서비스에 모임).

### M3 — 백엔드 poll 도메인 kind/optionDate + finalize + DTO (Priority: High, depends: M2)

- `apps/backend/src/poll/dto/create-poll.dto.ts` (MODIFY) — `kind?: string` 추가(`@ApiProperty({ required: false, enum: ['general','date'], default: 'general', description: '투표 종류. "date" 면 options 가 ISO-8601 날짜 문자열.', example: 'general' })`). class-validator 미사용 — 컨트롤러가 검증/400.
- `apps/backend/src/poll/dto/poll-response.dto.ts` (MODIFY):
  - `PollOptionResponseDto` — `optionDate: string | null`(`@ApiProperty({ nullable: true, type: String, description: '날짜 옵션의 ISO-8601 시각(일반 투표 옵션은 null)' })`) 추가.
  - `PollResponseDto` — `kind: string`(`@ApiProperty({ enum: ['general','date'] })`) + `finalizedStartsAt: string | null`(`@ApiProperty({ nullable: true, type: String, description: 'close 시 단일 승자 확정된 ISO 일정(그 외 null)' })`) + `finalizeSkippedReason: string | null`(`@ApiProperty({ nullable: true, enum: ['tie','no_votes'], description: 'finalize 스킵 이유(단일 승자/일반 투표면 null)' })`) 추가. 기존 multiSelect/myVotes/closesAt/isClosed/options 보존.
- `apps/backend/src/poll/poll.service.ts` (MODIFY):
  - `PollWithResults` 인터페이스 — `kind: string` + 옵션에 `optionDate: Date | null` + `finalizedStartsAt: Date | null` + `finalizeSkippedReason: 'tie' | 'no_votes' | null` 추가(목록/투표 응답에선 finalize 필드 null).
  - `createPoll(sub, moimId, question, options, multiSelect, closesAt, kind, optionDates?)` — kind/optionDates 파라미터 추가. kind="date" 면 옵션 create 를 `options.map((label, i) => ({ label, optionDate: optionDates[i] }))`(label=ISO, optionDate=Date), kind="general" 이면 `{ label, optionDate: null }`. poll.create data 에 `kind`. 컨트롤러가 파싱·검증 선처리(서비스는 저장만). 기존 assertMember + 트랜잭션 보존.
  - `closePoll(sub, moimId, pollId)` — MOIM-007 그대로(assertMember → poll 일관성 404 → 생성자 403 → closesAt=now) 후 finalize 분기: `if (poll.kind === 'date')` → 그 poll 옵션 voteCount 집계 → top count 계산 → top 공유 옵션 수 == 1 면 winner(그 optionDate) → `await this.moim.setStartsAt(moimId, winner.optionDate)` + finalizedStartsAt=optionDate / 공유 ≥2 면 finalizeSkippedReason='tie' / top==0(무표)면 'no_votes'. 일반 투표는 둘 다 null. `aggregatePolls(sub, [updated])` 결과에 finalize 필드 실어 반환.
  - `aggregatePolls` — 각 poll map 에 `kind: poll.kind`, 옵션 map 에 `optionDate: o.optionDate`, finalize 필드는 null(목록/투표 — finalize 는 close 에서만). voteCount/myVotes/closesAt/isClosed 무변경. (옵션 조회에 optionDate 포함 — findMany 가 이미 전체 컬럼.)
- `apps/backend/src/poll/poll.controller.ts` (MODIFY):
  - `create` — `parseKind(body?.kind)`(생략→"general", "general"/"date" 허용, 그 외 400). kind="date" 면 `parseOptionDates(body?.options)`(각 옵션 `new Date(v)` 무효 → 400, 유효 Date[] + ISO label[] 반환, ≥2 검사), service 에 Date[]/label[]/kind 전달. kind="general" 이면 `normalizeOptions` 그대로 + kind 전달. question requireNonEmpty 보존.
  - `close` — `closePoll` 결과를 `resultToDto`(finalize 필드 포함) 매핑.
  - `newPollToDto`/`resultToDto` — `kind`, 옵션 `optionDate`(ISO|null), `finalizedStartsAt`/`finalizeSkippedReason`(resultToDto 는 service 값, newPoll/vote/list 는 null) 매핑.
  - `requireNonEmpty`/`normalizeOptions`/`parseClosesAt` 헬퍼 무변경. 신규 `parseKind`/`parseOptionDates` 헬퍼 추가.
- 게이트: tsc 0, OpenAPI 가 kind/optionDate/finalizedStartsAt/finalizeSkippedReason 노출.

### M4 — backend jest (날짜 투표 + finalize 신규 + 일반/마감 회귀) (Priority: High, depends: M3)

- `apps/backend/src/poll/poll.controller.spec.ts` (MODIFY) — 신규/갱신:
  - 생성: kind="date" + datetime 옵션 → service 가 Date[]/label[] 로 호출; 무효 날짜 옵션 → 400(parseOptionDates); 미지 kind → 400(parseKind); kind 생략 → "general" 로 normalizeOptions.
  - close 라우트: 컨트롤러가 `closePoll` 호출 + `resultToDto`(finalize 필드) 매핑.
  - DTO 매핑: 응답에 kind/옵션 optionDate; vote/list 응답 finalize 필드 null; close 응답 finalize 필드 service 값. 기존 question 빈/옵션<2 400 회귀.
- `apps/backend/src/poll/poll.service.spec.ts` (MODIFY) — fake/mock prisma + moim.setStartsAt mock:
  - **날짜 생성**: kind="date" → 옵션 optionDate/label(ISO) 저장; kind="general" → optionDate null/자유 텍스트 label.
  - **finalize 단일 승자**: 날짜 투표 close + 한 옵션 최다 → `moim.setStartsAt(moimId, winner.optionDate)` 호출 + finalizedStartsAt=그 ISO + finalizeSkippedReason null.
  - **finalize 동점**: top voteCount 공유 ≥2 → setStartsAt 미호출 + finalizedStartsAt null + finalizeSkippedReason 'tie'.
  - **finalize 무표**: 모든 옵션 0표 → setStartsAt 미호출 + finalizedStartsAt null + finalizeSkippedReason 'no_votes'.
  - **일반 투표 close**: kind="general" close → setStartsAt 미호출 + finalize 둘 다 null(마감만, MOIM-007 그대로).
  - **덮어쓰기**: 기존 startsAt 있는 모임 날짜 투표 finalize → setStartsAt 가 새 optionDate 로 호출(덮어씀).
  - **비생성자 close**: 멤버지만 비생성자 → 403, finalize/setStartsAt 미실행, startsAt 불변. 비멤버 → assertMember 403.
  - **다중 선택 날짜 투표**: multiSelect=true 날짜 투표도 finalize 는 단일 최다 득표(동점이면 스킵).
  - 회귀: 일반 투표 단일 교체/다중 토글(MOIM-005/006) + 마감 vote 409(MOIM-007) + closesAt 옵트인 + 잘못된 optionId 400 + 다른 모임 pollId 404 + 비멤버 403.
- `apps/backend/src/poll/poll.integration.spec.ts` (MODIFY) — fake store(moim startsAt 포함):
  - 날짜 투표 생성 → 멤버 투표 → 생성자 close → 단일 승자면 moim.startsAt 갱신 end-to-end. 동점/무표 → startsAt 불변 + skip 이유. 일반 투표 close → startsAt 불변.
  - 401/403/400/404/409 케이스. finalize 후 GET 결과/승자 조회 가능 확인.
- `apps/backend/src/moim/moim.service.spec.ts` (MODIFY) — `setStartsAt` 가 moim.update 로 startsAt 갱신(인가 재검증 없음 — 호출자 책임).
- 게이트: backend jest 전체 통과(날짜 투표 + finalize 신규 + 일반/마감 회귀), branch coverage floor 유지(NestJS DI/decorator phantom branch `collectCoverageFrom` 제외 정책 — backend-nestjs-coverage 메모리).

### M5 — api-client 재생성 + poll 타입 (Priority: High, depends: M3)

- `nx run api-client:generate` — 백엔드 OpenAPI(CreatePollDto.kind, PollResponseDto.kind + PollOptionResponseDto.optionDate + PollResponseDto.finalizedStartsAt/finalizeSkippedReason)를 반영해 `packages/api-client/src/schema.d.ts` 재생성. 수동 편집 금지.
- `packages/api-client/src/index.ts` (MODIFY) — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지, 주석 갱신(kind/optionDate/finalize 추가, multiSelect/myVotes/closesAt/isClosed 보존). 편의 메서드 추가 없음(path-param close → web 구체-경로 헬퍼 유지).
- 게이트: api-client tsc 0(재생성된 schema 와 별칭 일치).

### M6 — 웹 헬퍼/타입 + 일정 투표 토글 + 날짜 옵션/포맷 + 확정 갱신 (Priority: High, depends: M5)

- `apps/web/lib/moim/polls.ts` (MODIFY) — `PollWithResults` 타입에 `kind: "general" | "date"` + 옵션 `optionDate: string | null` 추가. close 결과 타입(PollWithResults 확장 또는 별도 `ClosePollResult`)에 `finalizedStartsAt: string | null` + `finalizeSkippedReason: "tie" | "no_votes" | null`. `createPoll`/`closePoll` 헬퍼 시그니처 무변경(CreatePollRequest 가 kind 포함, closePoll 반환에 finalize 필드).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` (MODIFY):
  - `createPollAction` — `formData.get("kind")`(일정 투표 토글 — 체크 시 "date") 읽기. kind="date" 면 옵션(`option[]`)을 `toIsoOrUndefined` 로 ISO 변환(빈/무효 거름) → `options` 에 담아 `createPoll(api, moimId, { question, options, multiSelect, closesAt, kind })` 전달. kind="general"/생략이면 기존 자유 텍스트 옵션 그대로(회귀 0).
  - `closePollAction` — `closePoll` 결과의 `finalizedStartsAt`/`finalizeSkippedReason` 를 `ClosePollActionState` 로 돌려줘 클라이언트가 동점/무표 notice 를 띄우게 한다. 성공 시 `revalidatePath("/home/{moimId}")`(poll 마감 + 모임 헤더 startsAt 둘 다 재렌더). `voteAction` 무변경.
- `apps/web/app/(main)/home/[id]/polls-section.tsx` (MODIFY):
  - `OptionRow`/`PollCard` — `kind` 분기: 날짜 투표면 옵션 라벨을 `optionDate` 포맷 날짜(`formatClosesAt` 류 재사용/유사)로 렌더(raw ISO 아님). 열린 날짜 투표에 확정 힌트("마감 시 최다 득표 날짜가 모임 일정으로 확정돼요", `text-primary`). 마감/내 표/득표 막대는 MOIM-005/006/007 그대로.
  - `PollCard` close 핸들러 — `closePollAction` 결과의 `finalizeSkippedReason === "tie"` 면 동점 notice("동점이라 일정이 자동 확정되지 않았어요"), `"no_votes"` 면 무표 안내(또는 일반화), 단일 승자면 헤더 갱신으로 확정 드러남(별도 notice 불필요).
  - `CreatePollForm` — "일정 투표"(name="kind", 체크 시 "date") 토글 추가(Meetup 오렌지, multiSelect 토글과 같은 카드형). 토글 ON 이면 동적 옵션 입력을 `datetime-local`(각 옵션=날짜), OFF 면 기존 text. multiSelect 토글과 공존.
- `apps/web/app/(main)/home/[id]/page.tsx` (NO CHANGE — 확인만) — 헤더가 이미 `formatMoimSchedule(moim.startsAt)` 로 일정을 렌더하고 polls fetch + currentUserId 전달(MOIM-004/007). finalize 된 startsAt 은 close 후 revalidatePath 가 page 재렌더하면서 자동 반영(추가 렌더 코드 없음 — 갱신 확인).
- 게이트: web tsc 0(kind/optionDate/finalize 전 소비처), web lint 0, `nx run web:build` 0(일정 투표 토글 + datetime 옵션 분기 + 날짜 포맷 + 확정 힌트/동점 notice 컴파일).

## 4. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] `Poll.kind`(string `@default("general")`)/`PollOption.optionDate`(nullable)가 additive 이고 기존 poll(kind 'general')/option(optionDate null) row 를 유지하는가? PK/FK/인덱스 무변경인가? migrate status clean(enum 회피, CREATE TYPE 없음)인가?
- [ ] create 가 kind="date" 면 옵션을 날짜로 파싱(무효 → 400)해 optionDate/label(ISO) 저장하고, 미지 kind 는 400, kind 생략/"general" 은 자유 텍스트(MOIM-005/006/007 회귀 0)인가? 날짜 투표도 ≥2 강제인가?
- [ ] closePoll 이 kind="date" 일 때만 finalize 하고(일반 투표는 startsAt 불변 + finalize null), 단일 최다 득표 → setStartsAt(기존 덮어씀)/동점 → 'tie' 스킵/무표 → 'no_votes' 스킵인가?
- [ ] startsAt 쓰기가 `MoimService.setStartsAt` 단일 메서드를 통하는가(closePoll 이 직접 prisma.moim.update 안 함)?
- [ ] close 응답이 finalizedStartsAt(ISO|null) + finalizeSkippedReason("tie"|"no_votes"|null)를 담고, vote/list 응답은 둘 다 null 인가?
- [ ] finalize 가 close 핸들러 안에서만 일어나고(passive deadline-pass·GET 은 finalize 안 함), 비생성자/비멤버 close 는 403 으로 finalize 미도달인가?
- [ ] GET 이 각 poll 의 kind + 옵션 optionDate(ISO|null)를 반환하고, 마감/finalize 된 날짜 투표도 결과(승자 포함) 조회 가능한가?
- [ ] kind/optionDate/finalize 추가의 모든 소비처(DTO/OpenAPI/api-client PollResponse/web PollWithResults/close 결과 타입)가 갱신되어 tsc 0 인가?
- [ ] api-client 재생성 후 CreatePollRequest 에 optional kind, PollResponse 에 kind/옵션 optionDate/finalize 2필드가 있고 multiSelect/myVotes/closesAt/isClosed 가 보존되는가?
- [ ] web 일정 투표 토글이 옵션 입력을 datetime-local 로 전환하고(OFF 면 text), 날짜 투표 옵션이 포맷 날짜로 렌더(raw ISO 아님)되며 확정 힌트가 보이는가? Meetup 오렌지인가?
- [ ] 생성자가 날짜 투표 "마감하기" → 단일 승자면 모임 헤더 일정(startsAt)이 확정 갱신(revalidatePath), 동점이면 동점 notice + 일정 불변인가?
- [ ] 마감/생성 후 결과가 `revalidatePath` 로 갱신되는가(poll 마감 + 모임 헤더 startsAt 둘 다 — 디바이스 검증)?

## 5. 검증 게이트 (요약)

spec.md §7 참조. 핵심: prisma migrate clean(kind `@default` + optionDate nullable 추가, PK/FK 무변경, 기존 row 보존, enum 회피) → backend jest(날짜 투표 생성·무효 날짜 400·미지 kind 400·finalize 단일 승자→startsAt·동점 'tie'·무표 'no_votes'·일반 투표 close finalize 안 함·덮어쓰기·비생성자 403·setStartsAt 단일 출처 + 일반/다중/마감 회귀) → tsc 0(backend/web/api-client, kind/optionDate/finalize 전파) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → 디바이스 종단 검증(일정 투표 생성 → 날짜 투표 → 생성자 마감 → 단일 승자 일정 확정 갱신 / 동점 notice + 일정 불변).

## 6. 위임/협의 권장

- 백엔드 kind/optionDate nullable 마이그레이션(enum 회피)·날짜 옵션 파싱·closePoll finalize(단일 최다 득표/동점/무표)·setStartsAt 단일 출처·jest 회귀: expert-backend 협의 가능(비파괴 SQL + 승자 판정 + 일정 쓰기 단일 출처 + finalize 트리거 한정).
- 웹 일정 투표 토글(옵션 입력 datetime 전환)·날짜 포맷 렌더·확정 힌트·동점 notice·close 후 헤더 startsAt 갱신 확인·디자인 토큰: expert-frontend 협의 가능(동적 옵션 입력 타입 전환 + datetime-local 미러 + Meetup 오렌지 일관 + revalidatePath 가 poll+헤더 둘 다 갱신).
