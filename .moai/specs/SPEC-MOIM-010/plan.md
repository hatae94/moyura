# SPEC-MOIM-010 구현 계획 (Plan)

> SPEC-MOIM-010: 장소 투표 자동 확정 — 장소 투표 마감 시 승자 → Moim.location
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 기존 도메인 확장(brownfield). MOIM-008(날짜 투표 자동 확정)의 직속 형제 — finalize 골격을 그대로 승계하고 장소를 위한 kind 값 하나만 더한다. 백엔드는 jest(장소 투표 + location finalize 신규 + 일반/날짜/마감 회귀), 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 검증. 백엔드 변경 → OpenAPI → api-client 재생성 → web 소비의 단방향 데이터 흐름(MOIM-005~008 동일).
- **데이터 흐름(순서 의존)**: (1) MoimService.setLocation(location 쓰기 단일 출처) → (2) poll 도메인(parseKind 에 "place" + create 분기 place→normalizeOptions + closePoll 의 place→setLocation finalize 분기 + DTO finalizedLocation + aggregate finalizedLocation null) → (3) backend jest(장소 투표 + location finalize 신규 + 일반/날짜/마감 회귀) → (4) `nx run api-client:generate`(재생성) + 별칭 주석 갱신 → (5) web 헬퍼/타입 + 투표 종류 3-way 선택 + 텍스트 옵션 + 장소 텍스트 렌더 + 확정 힌트/동점 notice. 백엔드가 먼저 OpenAPI(kind "place"/finalizedLocation)를 바꿔야 api-client 타입에 반영된다.
- **마이그레이션 없음(핵심)**: `Poll.kind` 는 이미 존재하는 string `@default("general")` 컬럼이라 `"place"` 는 새 VALUE 일 뿐 — DDL/마이그레이션 없음. `Moim.location`(MOIM-004)도 이미 존재. MOIM-008 의 enum 회피가 이 확장을 무비용으로 만든다. prisma migrate status 는 변경 없이 clean.
- **승계(MOIM-008 재논의 없음)**: finalize 트리거(생성자 manual close)·승자 판정(단일 최다 득표)·동점/무표 스킵·덮어쓰기·close 응답 finalizeSkippedReason 은 MOIM-008 의 확정 결정을 그대로 승계한다. 본 SPEC은 "확정 대상"만 startsAt 에서 location 으로 바꾼 평행 케이스(date→startsAt 무변경, place→location 신규).
- **멤버 스코핑 + 생성자 인가**: poll service 의 모든 진입(create/vote/list/close)은 첫 줄 `MoimService.assertMember(sub, moimId)` 호출 유지(MOIM-005~008 불변). finalize 는 close 핸들러 안에서만 — close 는 MOIM-007 생성자 전용. 비생성자/비멤버는 finalize 에 도달하지 못한다.
- **location 쓰기 단일 출처**: `MoimService.setLocation(moimId, location)` 신규 메서드 1곳(createMoim 외 유일 location 쓰기 경로 — setStartsAt 미러). closePoll 이 장소 투표 finalize 시 호출(직접 prisma.moim.update 금지).
- **realtime 무변경**: MOIM-009 의 poll/poll_vote 트리거가 kind 무관하게 모든 close/vote 에 'poll_change' 를 발화하므로 장소 투표 추가에 realtime 코드 변경 없음(확인만).
- **디자인 시스템**: Meetup 오렌지 시맨틱 토큰 — `(main)/home/[id]` 토큰을 따른다(login/onboarding blue 아님). 투표 종류 3-way 선택/확정 힌트/동점 notice 모두 일관.

## 2. 데이터 모델 — kind "place" 추가 (마이그레이션 없음)

- `Poll.kind String @default("general")`(MOIM-008) 가 받는 값이 `"general"|"date"` → `"general"|"date"|"place"` 로 확장(string 컬럼의 값 도메인 확장 — 컬럼 추가/변경 아님).
- 종류 도출: `"general"`(자유 텍스트 옵션, optionDate null) / `"date"`(옵션이 날짜, optionDate=시각, MOIM-008) / `"place"`(옵션이 장소명, optionDate null — 일반과 동일 검증).
- 허용 값 검증은 컨트롤러(`parseKind`: 생략→"general", "general"/"date"/"place" 허용, 그 외 400). DB enum/CHECK 제약 없음(MOIM-008 그대로).
- 장소 옵션 저장: `normalizeOptions` 로 label(장소명) 정규화(≥2), `optionDate=null`. `Moim.location`(String?, MOIM-004) 이 finalize 대상.
- **마이그레이션**: **없음.** 스키마 파일 무변경, 신규 migration 디렉터리 없음. `prisma migrate status` 는 변경 없이 clean(MOIM-008 이 컬럼 2개 추가한 것보다 단순 — DDL 불필요).

## 3. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M5). 우선순위는 모두 본 SPEC 완료에 필수(High). MOIM-008 대비 마이그레이션 마일스톤이 없어 단계가 하나 적다.

### M1 — 백엔드 MoimService.setLocation (location 쓰기 단일 출처) (Priority: High)

- `apps/backend/src/moim/moim.service.ts` (ADD):
  - `setLocation(moimId: string, location: string): Promise<void>` (신규) — `prisma.moim.update({ where: { id: moimId }, data: { location } })`. 인가 재검증 안 함(호출자 closePoll 이 이미 assertMember + 생성자 검사 통과 — 순수 도메인 쓰기, setStartsAt 과 동일 계약). moim 존재는 poll.moimId 가 보장(close 가 poll-moim 일관성 검증). @MX:ANCHOR — createMoim 외 유일한 location 쓰기 경로(finalize 가 호출, setStartsAt 미러).
- 게이트: tsc 0. createMoim/setStartsAt 무변경(location/startsAt 쓰기가 한 서비스에 모임).

### M2 — 백엔드 poll 도메인 kind "place" + location finalize + DTO (Priority: High, depends: M1)

- `apps/backend/src/poll/dto/create-poll.dto.ts` (MODIFY) — `kind?: string` 의 `@ApiProperty` enum 을 `['general','date','place']` 로 확장 + description 갱신("place" 면 옵션이 자유 텍스트 장소명). class-validator 미사용 — 컨트롤러가 검증/400.
- `apps/backend/src/poll/dto/poll-response.dto.ts` (MODIFY):
  - `PollResponseDto` — `finalizedLocation: string | null`(`@ApiProperty({ nullable: true, type: String, description: 'close 시 장소 투표 단일 승자 확정된 모임 장소(그 외 null)' })`) 추가. `kind` enum 을 `['general','date','place']` 로 확장. 기존 finalizedStartsAt/finalizeSkippedReason/optionDate/multiSelect/myVotes/closesAt/isClosed/options 보존.
- `apps/backend/src/poll/poll.service.ts` (MODIFY):
  - `PollWithResults` 인터페이스 — `finalizedLocation: string | null` 추가(목록/투표 응답에선 null). 기존 kind/옵션 optionDate/finalizedStartsAt/finalizeSkippedReason 보존.
  - `closePoll(sub, moimId, pollId)` — MOIM-007/008 그대로(assertMember → poll 일관성 404 → 생성자 403 → closesAt=now) 후 finalize 분기: `if (poll.kind === 'date')` → setStartsAt(winner.optionDate)[MOIM-008, 무변경, finalizedLocation=null]; `else if (poll.kind === 'place')` → 그 poll 옵션 voteCount 집계 → top count 계산 → 단일 승자면 `await this.moim.setLocation(moimId, winner.label)` + finalizedLocation=label / 공유 ≥2 면 finalizeSkippedReason='tie' / top==0(무표)면 'no_votes'[신규]; 그 외(general) → finalize 없음(둘 다 null). `aggregatePolls` 결과에 finalizedLocation 실어 반환.
  - `aggregatePolls` — 각 poll map 에 `finalizedLocation: null` 추가(목록/투표 — finalize 는 close 에서만). kind/optionDate/voteCount/myVotes/closesAt/isClosed/finalizedStartsAt/finalizeSkippedReason 무변경.
  - `createPoll` — **무변경**(장소 옵션은 일반 투표와 동일 경로 — 컨트롤러가 normalizeOptions 로 label 전달, optionDates 빈 배열, kind="place" 저장). 시그니처/본문 그대로.
- `apps/backend/src/poll/poll.controller.ts` (MODIFY):
  - `parseKind` — 허용 값에 `"place"` 추가(`value === 'general' || value === 'date' || value === 'place'`). 미지 값 여전히 400.
  - `create` — kind 분기에 place 추가: `kind === 'date'` → parseOptionDates(MOIM-008 그대로); `else`(general 또는 place) → `normalizeOptions(body?.options)` + optionDates 빈 배열. kind 를 service 에 그대로 전달(place 저장). question requireNonEmpty 보존.
  - `close` — `closePoll` 결과를 `closeResultToDto`(finalizedLocation 포함) 매핑.
  - `newPollToDto`/`resultToDto`/`closeResultToDto` — `finalizedLocation`(closeResultToDto 는 service 값, newPoll/vote/list 는 null) 매핑. 기존 finalizedStartsAt/finalizeSkippedReason 매핑 보존.
  - `requireNonEmpty`/`normalizeOptions`/`parseClosesAt`/`parseOptionDates` 헬퍼 무변경(parseOptionDates 는 date 전용 — place 는 안 부름).
- 게이트: tsc 0, OpenAPI 가 kind "place"/finalizedLocation 노출.

### M3 — backend jest (장소 투표 + location finalize 신규 + 일반/날짜/마감 회귀) (Priority: High, depends: M2)

- `apps/backend/src/poll/poll.controller.spec.ts` (MODIFY) — 신규/갱신:
  - 생성: kind="place" + 텍스트 옵션 → service 가 normalizeOptions label[]/kind="place" 로 호출(optionDates 빈 배열); 미지 kind → 400(parseKind 가 place 허용하되 그 외 거부); kind="date" 는 parseOptionDates 그대로(회귀); kind 생략 → "general".
  - close 라우트: 컨트롤러가 `closePoll` 호출 + `closeResultToDto`(finalizedLocation) 매핑.
  - DTO 매핑: 응답에 finalizedLocation; vote/list 응답 finalizedLocation null; close 응답 finalizedLocation service 값. 기존 question 빈/옵션<2 400 회귀.
- `apps/backend/src/poll/poll.service.spec.ts` (MODIFY) — fake/mock prisma + moim.setLocation mock(setStartsAt 옆에 추가):
  - **장소 생성**: kind="place" → 옵션 label(장소명)/optionDate null 저장.
  - **location finalize 단일 승자**: 장소 투표 close + 한 옵션 최다 → `moim.setLocation(moimId, winner.label)` 호출 + finalizedLocation=그 label + finalizeSkippedReason null + finalizedStartsAt null.
  - **location finalize 동점**: top voteCount 공유 ≥2 → setLocation 미호출 + finalizedLocation null + finalizeSkippedReason 'tie'.
  - **location finalize 무표**: 모든 옵션 0표 → setLocation 미호출 + finalizedLocation null + finalizeSkippedReason 'no_votes'.
  - **일반 투표 close**: kind="general" close → setLocation 미호출 + finalize 필드 null(마감만, MOIM-007).
  - **날짜 투표 close 회귀(MOIM-008)**: kind="date" close → setStartsAt 여전히 호출 + finalizedStartsAt 채움 + finalizedLocation null(location 분기 추가가 startsAt 분기 안 깸).
  - **덮어쓰기**: 기존 location 있는 모임 장소 투표 finalize → setLocation 가 새 label 로 호출(덮어씀).
  - **비생성자 close**: 멤버지만 비생성자 → 403, finalize/setLocation 미실행, location 불변. 비멤버 → assertMember 403.
  - **다중 선택 장소 투표**: multiSelect=true 장소 투표도 finalize 는 단일 최다 득표(동점이면 스킵).
  - 회귀: 일반 단일 교체/다중 토글(MOIM-005/006) + 날짜 생성·finalize(MOIM-008) + 마감 vote 409(MOIM-007) + closesAt 옵트인 + 잘못된 optionId 400 + 다른 모임 pollId 404 + 비멤버 403.
- `apps/backend/src/poll/poll.integration.spec.ts` (MODIFY) — fake store(moim location 포함):
  - 장소 투표 생성 → 멤버 투표 → 생성자 close → 단일 승자면 moim.location 갱신 end-to-end. 동점/무표 → location 불변 + skip 이유. 일반/날짜 투표 close → location 불변(날짜는 startsAt 확정). 401/403/400/404/409 케이스. finalize 후 GET 결과/승자 조회 가능 확인.
- `apps/backend/src/moim/moim.service.spec.ts` (MODIFY) — `setLocation` 가 moim.update 로 location 갱신(인가 재검증 없음 — 호출자 책임, setStartsAt 옆 미러 테스트).
- 게이트: backend jest 전체 통과(장소 투표 + location finalize 신규 + 일반/날짜/마감 회귀), branch coverage floor 유지(NestJS DI/decorator phantom branch `collectCoverageFrom` 제외 정책 — backend-nestjs-coverage 메모리).

### M4 — api-client 재생성 + poll 타입 (Priority: High, depends: M2)

- `nx run api-client:generate` — 백엔드 OpenAPI(CreatePollDto.kind enum 에 "place", PollResponseDto.finalizedLocation + kind enum "place")를 반영해 `packages/api-client/src/schema.d.ts` 재생성. 수동 편집 금지.
- `packages/api-client/src/index.ts` (MODIFY) — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지, 주석 갱신(kind "place" + finalizedLocation 추가, multiSelect/myVotes/closesAt/isClosed/optionDate/finalizedStartsAt/finalizeSkippedReason 보존). 편의 메서드 추가 없음(path-param close → web 구체-경로 헬퍼 유지).
- 게이트: api-client tsc 0(재생성된 schema 와 별칭 일치).

### M5 — 웹 헬퍼/타입 + 투표 종류 3-way 선택 + 텍스트 옵션 + 확정 갱신 (Priority: High, depends: M4)

- `apps/web/lib/moim/polls.ts` (MODIFY) — `PollWithResults` 타입의 `kind` 를 `"general" | "date" | "place"` 로 확장 + close 결과 타입(PollWithResults 확장 또는 별도 `ClosePollResult`)에 `finalizedLocation: string | null` 추가(finalizedStartsAt/finalizeSkippedReason 은 MOIM-008 그대로). `createPoll`/`closePoll` 헬퍼 시그니처 무변경(CreatePollRequest 가 kind 포함, closePoll 반환에 finalizedLocation).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` (MODIFY):
  - `createPollAction` — `formData.get("kind")`(3-way 선택 — "general"|"date"|"place") 읽기. kind="place" 면 옵션(`option[]`)을 텍스트 그대로(ISO 변환 없음 — 일반과 동일) → `createPoll(api, moimId, { question, options, multiSelect, closesAt, kind })` 전달. kind="date" 면 `toIsoOrUndefined` 로 ISO 변환(MOIM-008 그대로). kind="general"/생략이면 기존 텍스트 옵션 그대로(회귀 0).
  - `closePollAction` — `closePoll` 결과의 `finalizedLocation`(+ 기존 finalizedStartsAt/finalizeSkippedReason)을 `ClosePollActionState` 로 돌려줘 클라이언트가 동점/무표/확정 notice 를 띄우게 한다. 성공 시 `revalidatePath("/home/{moimId}")`(poll 마감 + 모임 헤더 location 둘 다 재렌더). `voteAction` 무변경.
- `apps/web/app/(main)/home/[id]/polls-section.tsx` (MODIFY):
  - `OptionRow`/`PollCard` — `kind` 분기 확장: 장소 투표면 옵션 라벨을 `label`(장소명) 텍스트로 렌더(날짜 포맷 없음 — date 만 포맷). 열린 장소 투표에 확정 힌트("마감하면 최다 득표 장소가 모임 장소로 확정돼요", `text-primary`). 마감/내 표/득표 막대는 MOIM-005/006/007/008 그대로.
  - `PollCard` close 핸들러 — `closePollAction` 결과의 `finalizeSkippedReason === "tie"` 면 동점 notice("동점이라 장소가 자동 확정되지 않았어요"), `"no_votes"` 면 무표 안내(또는 일반화), 단일 승자(`finalizedLocation != null`)면 헤더 갱신으로 확정 드러남(별도 notice 불필요). date/place 공통 notice 경로 재사용.
  - `CreatePollForm` — 기존 이진 "일정 투표"(name="kind") 토글을 **3-way 선택**(일반 / 날짜 / 장소, segmented control 또는 radio group, `name="kind"` → "general"|"date"|"place")으로 대체(Meetup 오렌지). "날짜" 면 동적 옵션 입력 `datetime-local`(MOIM-008), "장소"/"일반" 이면 text. multiSelect 토글과 공존.
- `apps/web/app/(main)/home/[id]/page.tsx` (NO CHANGE — 확인만) — 헤더가 이미 `moim.location` 을 렌더하고 polls fetch + currentUserId/accessToken 전달(MOIM-004/008/009). finalize 된 location 은 close 후 revalidatePath 가 page 재렌더하면서 자동 반영(추가 렌더 코드 없음 — 갱신 확인).
- 게이트: web tsc 0(finalizedLocation/kind "place" 전 소비처), web lint 0, `nx run web:build` 0(투표 종류 3-way 선택 + 텍스트/날짜 옵션 분기 + 장소 텍스트 렌더 + 확정 힌트/동점 notice 컴파일).

## 4. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] `Poll.kind` 가 `"place"` 를 새 VALUE 로 받고 스키마/마이그레이션 변경이 전혀 없는가(migrate status 변경 없이 clean)? `Moim.location`(MOIM-004)·`PollOption.optionDate`(MOIM-008)·`PollVote` PK 가 모두 그대로인가?
- [ ] create 가 kind="place" 면 옵션을 normalizeOptions(일반과 동일 — 날짜 파싱 안 함)로 label 저장하고 optionDate null 인가? 미지 kind 400, kind="date" 는 parseOptionDates 그대로(회귀)인가? 장소 투표도 ≥2 강제인가?
- [ ] closePoll 이 kind="place" 일 때만 location finalize 하고(일반은 finalize 없음, 날짜는 startsAt 확정 — MOIM-008 회귀), 단일 최다 득표 → setLocation(기존 덮어씀)/동점 → 'tie' 스킵/무표 → 'no_votes' 스킵인가?
- [ ] location 쓰기가 `MoimService.setLocation` 단일 메서드를 통하는가(closePoll 이 직접 prisma.moim.update 안 함, setStartsAt 미러)?
- [ ] close 응답이 finalizedLocation(string|null)를 담고 finalizedStartsAt 과 상호 배타적이며(date→startsAt, place→location), vote/list 응답은 셋 다 null 인가?
- [ ] finalize 가 close 핸들러 안에서만 일어나고(passive deadline-pass·GET 은 finalize 안 함), 비생성자/비멤버 close 는 403 으로 finalize 미도달인가?
- [ ] GET 이 각 poll 의 kind(="place" 포함) + 옵션 label/optionDate(null) 를 반환하고, 마감/finalize 된 장소 투표도 결과(승자 포함) 조회 가능한가?
- [ ] finalizedLocation/kind "place" 추가의 모든 소비처(DTO/OpenAPI/api-client PollResponse/web PollWithResults/close 결과 타입/kind 분기)가 갱신되어 tsc 0 인가?
- [ ] api-client 재생성 후 CreatePollRequest.kind 가 "place" 를 받고 PollResponse 에 finalizedLocation 이 있으며 multiSelect/myVotes/closesAt/isClosed/optionDate/finalizedStartsAt/finalizeSkippedReason 가 보존되는가?
- [ ] web 투표 종류 3-way 선택이 "날짜" 면 datetime-local, "장소"/"일반" 이면 text 옵션으로 전환하고, 장소 투표 옵션이 장소명 텍스트로 렌더되며 확정 힌트가 보이는가? Meetup 오렌지인가? 날짜 투표 생성 흐름(MOIM-008)이 회귀 없이 보존되는가?
- [ ] 생성자가 장소 투표 "마감하기" → 단일 승자면 모임 헤더 장소(location)가 확정 갱신(revalidatePath), 동점이면 동점 notice + 장소 불변인가?
- [ ] 마감/생성 후 결과가 `revalidatePath` 로 갱신되는가(poll 마감 + 모임 헤더 location 둘 다 — 디바이스 검증)? MOIM-009 realtime 이 다른 멤버에게 전파되는가(트리거 무변경 확인)?

## 5. 검증 게이트 (요약)

spec.md §7 참조. 핵심: 마이그레이션 없음(kind "place" 는 새 VALUE — DDL 불필요, Moim.location 이미 존재, migrate status 변경 없이 clean) → backend jest(장소 투표 생성·미지 kind 400·location finalize 단일 승자→location·동점 'tie'·무표 'no_votes'·일반 투표 location finalize 안 함·날짜 투표 startsAt 확정 회귀·덮어쓰기·비생성자 403·setLocation 단일 출처 + 일반/다중/날짜/마감 회귀) → tsc 0(backend/web/api-client, finalizedLocation/kind "place" 전파) → web lint 0 → web build 0 → mobile tsc/vitest/expo export 회귀 0 → 디바이스 종단 검증(장소 투표 생성 → 멤버 투표 → 생성자 마감 → 단일 승자 장소 확정 갱신 / 동점 notice + 장소 불변).

## 6. 위임/협의 권장

- 백엔드 kind "place" 추가(마이그레이션 없음)·장소 옵션 normalizeOptions 경로·closePoll location finalize(단일 최다 득표/동점/무표)·setLocation 단일 출처·날짜 finalize 회귀 보존·jest: expert-backend 협의 가능(kind 값 확장 + 승자 판정 재사용 + 장소 쓰기 단일 출처 + date/place 분기 분리).
- 웹 투표 종류 3-way 선택(이진 토글 대체)·텍스트/날짜 옵션 분기·장소 텍스트 렌더·확정 힌트·동점 notice·close 후 헤더 location 갱신 확인·디자인 토큰: expert-frontend 협의 가능(segmented control/radio group + 옵션 입력 타입 전환 + Meetup 오렌지 일관 + revalidatePath 가 poll+헤더 둘 다 갱신 + 날짜 투표 회귀).
