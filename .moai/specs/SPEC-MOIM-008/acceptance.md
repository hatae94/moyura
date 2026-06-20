# SPEC-MOIM-008 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-008: 일정 투표 자동 확정 — 날짜 투표 마감 시 승자 → Moim.startsAt
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 iOS 시뮬레이터 확인. 백엔드는 jest(날짜 투표 + finalize 신규 + 일반/마감 회귀). api-client 는 tsc.

## 수용 기준 (AC)

### AC-1: 날짜 투표 데이터 모델 + 비파괴 마이그레이션 (← REQ-MOIM8-001)

`Poll.kind`(string `@default("general")`, additive) + `PollOption.optionDate`(nullable, additive)가 추가되고, `PollVote` PK(`(pollId,optionId,userId)`)·FK·인덱스가 유지되며, 기존 poll/option/vote row 가 보존된다.

- **Given** 기존 스키마(poll/poll_option/poll_vote, MOIM-006 PK + MOIM-007 closesAt)와 poll/투표 데이터가 있고
- **When** 비파괴 마이그레이션(`poll.kind` NOT NULL DEFAULT 'general' + `poll_option.option_date` nullable ADD)을 적용하면
- **Then** `poll.kind` 가 기본 'general' 로(기존 poll 모두 일반 투표), `poll_option.option_date` 가 nullable 로(기존 옵션 모두 null) 추가되고, `poll_vote` PK·FK(cascade)·`@@index` 가 무변경이며, **기존 poll/option/vote row 가 한 row 도 손실되지 않고**(row count 불변), `prisma migrate status` 가 clean(enum 회피 — CREATE TYPE 없음)이고, 기존 테이블/동작(모임·멤버·채팅·초대·단일/다중 투표·마감)에 회귀가 없다.

### AC-2: 날짜 투표 생성 — kind + optionDate (← REQ-MOIM8-002)

`POST /moims/:id/polls` 가 `kind: "date"` + ISO 날짜 옵션을 받아 날짜 투표를 생성한다. 미지 kind 400, 무효 날짜 옵션 400, 일반 투표는 무변경, 비멤버 403.

- **Given** 모임 멤버가
- **When** `{ question, options: ["2026-06-27T12:00:00.000Z","2026-06-28T12:00:00.000Z"], kind: "date" }` 로 생성하면 **Then** 201 + `kind="date"` poll 이 생성되고, 각 옵션의 `optionDate` 가 그 시각, `label` 이 ISO 문자열로 저장된다.
- **And When** `kind` 를 생략하거나 `"general"` 로 생성하면 **Then** 자유 텍스트 옵션 + `optionDate: null` + `kind="general"` poll 이 생성된다(MOIM-005/006/007 동작 동일). `multiSelect`/`closesAt` 옵트인도 그대로 동작한다.
- **And When** `kind` 가 `"general"`/`"date"` 외의 값이면 **Then** 400 을 반환한다.
- **And When** `kind: "date"` 인데 어느 옵션이 무효 ISO 문자열이면 **Then** 400 을 반환한다.
- **And When** question 이 비었거나 유효 옵션이 2개 미만이면 **Then** 400 을 반환한다(날짜 투표도 ≥2 — kind 추가가 이 검증을 바꾸지 않음).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 모임도 403)을 반환한다.

### AC-3: 날짜 투표 마감 시 자동 확정 — 단일 승자 → startsAt (← REQ-MOIM8-003)

날짜 투표 생성자가 close 하면 단일 최다 득표 옵션의 optionDate 가 `Moim.startsAt` 으로 확정된다. 동점·무표·일반 투표는 finalize 스킵. startsAt 쓰기는 setStartsAt 단일 출처.

- **Given** 멤버 U 가 만든 열린 날짜 투표(`kind="date"`, 옵션 A=27일/B=28일)에 A 가 최다(예: A 3표, B 1표)이고
- **When** U(생성자)가 `POST .../close` 를 호출하면 **Then** 200 + 그 poll 의 `closesAt` 가 now(마감) + `Moim.startsAt` 가 A 의 optionDate(27일)로 설정되고, 응답에 `finalizedStartsAt = 27일 ISO`, `finalizeSkippedReason = null` 이 담긴다.
- **And Given** top voteCount 를 A/B 가 공유(동점, 예: 각 2표)인 날짜 투표를 U 가 close 하면 **Then** finalize 가 스킵되어 `Moim.startsAt` 는 변경되지 않고, 응답에 `finalizedStartsAt = null`, `finalizeSkippedReason = "tie"` 가 담긴다(마감 자체는 정상 — closesAt=now).
- **And Given** 표가 하나도 없는 날짜 투표를 U 가 close 하면 **Then** finalize 가 스킵되어 `Moim.startsAt` 불변 + `finalizedStartsAt = null`, `finalizeSkippedReason = "no_votes"`.
- **And Given** 일반 투표(`kind="general"`)를 U 가 close 하면 **Then** 마감만 되고(MOIM-007 그대로) finalize 가 수행되지 않으며 `Moim.startsAt` 불변 + `finalizedStartsAt = null`, `finalizeSkippedReason = null`.
- **And Given** 이미 `startsAt` 가 있는 모임의 날짜 투표를 단일 승자로 finalize 하면 **Then** 기존 `startsAt` 가 승자 optionDate 로 **덮어써진다**(확정 시점 — 데이터 손실 아님).
- **And** `Moim.startsAt` 쓰기는 `MoimService.setStartsAt` 메서드를 통해서만 일어난다(closePoll 이 직접 prisma.moim.update 안 함 — createMoim 외 유일 쓰기 경로).
- **And When** 비생성자 멤버 V 또는 비멤버가 close 하면 **Then** 403(MOIM-007 생성자 전용)이고 finalize 가 실행되지 않으며 `Moim.startsAt` 불변이다.

### AC-4: 투표 목록 + 결과 — kind + optionDate 노출 (← REQ-MOIM8-004)

`GET /moims/:id/polls` 가 각 poll 의 `kind` + 각 옵션의 `optionDate`(ISO|null)를 반환한다. 마감/finalize 된 날짜 투표도 결과 조회 가능, 비멤버 403, poll 없으면 빈 배열.

- **Given** 멤버이고 날짜 투표(`kind="date"`)와 일반 투표(`kind="general"`)가 있는 상태에서
- **When** `GET /moims/:id/polls` 를 호출하면 **Then** 날짜 투표는 `kind="date"` + 각 옵션 `optionDate`(그 ISO 문자열), 일반 투표는 `kind="general"` + 각 옵션 `optionDate: null` 이고, 옵션별 voteCount(표 0 포함)·myVotes(목록)가 함께 반환된다.
- **And When** 마감·finalize 된 날짜 투표를 조회하면 **Then** 승자 옵션 voteCount 와 closesAt/isClosed 가 정확히 조회된다(마감돼도 결과 조회 가능).
- **And When** 모임에 poll 이 없으면 **Then** 빈 배열을 반환한다(에러 아님).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 404→403)이고 투표 내용을 노출하지 않는다.

### AC-5: close 응답 — finalize 결과 노출 (← REQ-MOIM8-005)

`POST .../close` 응답이 기존 단건 poll 결과(MOIM-007)에 더해 `finalizedStartsAt`(ISO|null) + `finalizeSkippedReason`("tie"|"no_votes"|null)를 포함한다. vote/list 응답에선 둘 다 null.

- **Given** 단일 승자 날짜 투표를 생성자가 close 하면 **Then** 응답에 마감된 단건 poll(집계 + closesAt + isClosed:true) + `finalizedStartsAt = 승자 ISO` + `finalizeSkippedReason = null` 이 있다.
- **And Given** 동점 날짜 투표 close → **Then** `finalizedStartsAt = null` + `finalizeSkippedReason = "tie"`.
- **And Given** 무표 날짜 투표 close → **Then** `finalizedStartsAt = null` + `finalizeSkippedReason = "no_votes"`.
- **And Given** 일반 투표 close → **Then** `finalizedStartsAt = null` + `finalizeSkippedReason = null`(finalize 대상 아님).
- **And When** `POST .../vote` 또는 `GET .../polls` 응답을 보면 **Then** `finalizedStartsAt` 과 `finalizeSkippedReason` 가 항상 `null` 이다(finalize 는 close 에서만 — 별도 wrapper 없이 같은 DTO 재사용).

### AC-6: api-client 갱신 (← REQ-MOIM8-006)

api-client 재생성으로 `CreatePollRequest` 에 optional `kind`, `PollResponse` 에 `kind`/옵션 `optionDate`/`finalizedStartsAt`/`finalizeSkippedReason`가 반영된다. multiSelect/myVotes/closesAt/isClosed 보존, 별칭 유지, web 헬퍼/타입 갱신.

- **Given** 백엔드 OpenAPI 가 kind/optionDate/finalize 2필드를 노출하고
- **When** `nx run api-client:generate` 후 tsc 를 실행하면
- **Then** `CreatePollRequest` 에 optional `kind: string`, `PollResponse`(= `components['schemas']['PollResponseDto']`)에 `kind`, 각 옵션 `optionDate: string | null`, `finalizedStartsAt: string | null`, `finalizeSkippedReason: string | null` 이 있고 `multiSelect`/`myVotes`/`closesAt`/`isClosed` 가 보존되며, web `PollWithResults`(`kind`/옵션 `optionDate`)와 close 결과 타입(finalize 필드)이 추가되어 backend/web/api-client tsc 가 0 error 다(수동 schema 편집 없음).

### AC-7: 웹 날짜 투표 UI + 일정 확정 갱신 (← REQ-MOIM8-007)

모임 상세가 날짜 투표를 포맷 날짜 옵션 + 확정 힌트로 렌더하고, 생성 폼에 "일정 투표" 토글(켜면 datetime 옵션), close 후 모임 헤더 일정(startsAt) 갱신 + 동점 notice. Meetup 오렌지.

- **Given** 인증·이름 보유 멤버가 모임 상세(`/home/{id}`)에 있고
- **When** "투표 만들기" 에서 "일정 투표" 토글을 켜면 **Then** 동적 옵션 입력이 `datetime-local` 로 전환되고, 날짜 ≥2 + 질문을 제출하면 `kind: "date"` + 각 옵션 ISO 로 변환되어 생성된다(토글 OFF 면 기존 자유 텍스트 옵션 흐름 — 회귀 0). `multiSelect` 토글과 공존한다.
- **And When** `kind="date"` poll 이 있으면 **Then** 각 옵션이 `optionDate` 포맷 날짜(사람이 읽을 수 있게)로 렌더되고(raw ISO 노출 금지), 열려 있으면 "마감 시 최다 득표 날짜가 모임 일정으로 확정돼요" 힌트가 표시된다. 일반 투표는 힌트 없음.
- **And When** 생성자가 날짜 poll 을 "마감하기" 로 닫고 단일 승자가 있으면 **Then** `POST .../close` 후 그 poll 이 "마감됨"으로 갱신되고, 모임 헤더 일정(`startsAt`)이 승자 날짜로 확정 갱신된다(revalidatePath — `formatMoimSchedule` 반영).
- **And When** close 응답이 `finalizeSkippedReason = "tie"` 면 **Then** 동점으로 일정이 자동 확정되지 않았음을 안내한다("동점이라 일정이 자동 확정되지 않았어요" 류), `"no_votes"` 면 그에 맞는 안내(또는 일반화). 모임 헤더 일정은 변경되지 않는다.
- **And When** 생성/마감이 백엔드 오류(400/403/404/네트워크)를 반환하면 **Then** 폼/화면에 머무르며 일반화 오류를 표시한다(토큰/상세 비노출 — 무효 날짜 옵션 400, 비생성자 마감 403 포함).
- **And** 일정 투표 토글·datetime 옵션·확정 힌트·동점 notice 가 모두 Meetup 오렌지 토큰을 쓴다(login/onboarding blue 아님).

### AC-8: 품질 게이트 (← spec.md §7)

backend jest 통과(날짜 투표 + finalize 신규 + 일반/마감 회귀), backend+web+api-client tsc 0, web lint 0, web build 0, prisma migrate clean(kind/optionDate 추가, PK/FK 무변경, 기존 row 보존, enum 회피), mobile tsc/vitest/expo export 회귀 0.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(일정 투표 생성 → 날짜 투표 → 멤버 투표 → 생성자 마감 → 단일 승자 일정 확정 갱신 / 동점 notice + 일정 불변)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **kind 생략(일반 투표)**: kind 미전송 → "general" → 자유 텍스트 옵션 + optionDate null → finalize 대상 아님(MOIM-005/006/007 동작 보존). (← REQ-MOIM8-002/003)
- **미지 kind**: "general"/"date" 외 값 → 400(parseKind). (← REQ-MOIM8-002)
- **날짜 옵션 무효 ISO**: kind="date" 인데 무효 날짜 문자열 → 400(parseOptionDates, getTime NaN — closesAt 정책 미러). 웹 datetime-local 무효는 toIsoOrUndefined 가 떨어뜨려 ≥2 미만이면 폼 일반화 오류. (← REQ-MOIM8-002)
- **단일 승자 finalize**: 단일 최다 득표 → Moim.startsAt = 그 optionDate(기존 덮어씀) + finalizedStartsAt 반영. (← REQ-MOIM8-003)
- **동점 스킵**: top voteCount 공유 ≥2 → finalize 안 함, startsAt 불변, finalizeSkippedReason "tie"(자의적 tie-break 금지 — 사람이 결정). (← REQ-MOIM8-003)
- **무표 스킵**: 모든 옵션 0표 → 승자 없음 → finalize 안 함, startsAt 불변, "no_votes". (← REQ-MOIM8-003)
- **일반 투표 close = finalize 안 함**: kind="general" close 는 마감만(MOIM-007), startsAt 불변, finalize 둘 다 null. (← REQ-MOIM8-003)
- **기존 startsAt 덮어쓰기**: 모임에 이미 startsAt(생성 시 값/이전 finalize)이 있어도 단일 승자 finalize 가 덮어씀(확정 시점 — 의도된 동작). (← REQ-MOIM8-003)
- **다중 선택 날짜 투표**: multiSelect=true 날짜 투표도 finalize 는 옵션별 voteCount 의 단일 최다만 본다(동점이면 스킵). 다중 선택은 후보 확장 도구, finalize 규칙 불변. (← REQ-MOIM8-003/007)
- **passive deadline-pass ≠ finalize**: closesAt 시각이 그냥 지난 날짜 투표를 GET 해도 startsAt 이 저절로 안 바뀐다 — finalize 는 명시적 생성자 close 핸들러에서만(크론 없음, isClosed 표시만). (← REQ-MOIM8-003)
- **비생성자/비멤버 finalize 차단**: close 가 MOIM-007 생성자 전용이라 비생성자/비멤버는 403 으로 finalize 에 도달 못 함, startsAt 불변. (← REQ-MOIM8-003)
- **finalize 후 결과 조회**: 마감·finalize 된 날짜 투표도 GET 으로 승자 voteCount/optionDate/closesAt/isClosed 조회 가능. (← REQ-MOIM8-004)
- **close 응답 vs vote/list 응답**: finalize 2필드는 close 응답에서만 값을 가지며 vote/list 에선 항상 null(같은 DTO 재사용, 값 의미는 라우트가 정함). (← REQ-MOIM8-005)
- **startsAt 쓰기 단일 출처**: finalize 가 직접 prisma.moim.update 안 하고 MoimService.setStartsAt 호출(createMoim 외 유일 startsAt 쓰기 — 드리프트 차단). (← REQ-MOIM8-003)
- **kind/optionDate/finalize 추가 소비처**: 순수 추가(제거 아님)라 기존 소비처는 안 깨지나, web PollWithResults 미러·close 결과 타입이 새 필드를 채워야 함 → tsc 차단. (← REQ-MOIM8-006)
- **날짜 옵션 표시**: 웹은 optionDate 를 사람이 읽을 수 있게 포맷해 렌더한다(raw ISO label 노출 금지 — label 은 정규 ISO 라 표시용으로 부적합). (← REQ-MOIM8-007)
- **세션 만료 후 생성/마감**: Server Action 시점 세션 부재 → `/login` 리다이렉트(poll/일정 미변경). (← REQ-MOIM8-007)
- **비멤버 접근**: 비멤버가 생성/투표/조회/마감 → 모두 403(미존재 모임도 403). kind/optionDate 추가가 인가에 영향 없음. (← REQ-MOIM8-002/003/004)
- **데스크톱 vs 모바일**: 날짜 투표 UI 는 데스크톱 일반 렌더 + 모바일 in-WebView(상세 `/home/{id}` 안 — 신규 네이티브 라우트 없음). Server Action(`revalidatePath`)이 WebView 안에서 poll 마감 AND 모임 헤더 startsAt(일정 확정)을 둘 다 갱신하는지 디바이스 검증.

## Definition of Done (DoD)

- [ ] `Poll.kind`(string `@default("general")`) + `PollOption.optionDate`(nullable) additive 추가 + PK/FK/인덱스 무변경(기존 row 보존, row 손실 0), prisma migrate clean(enum 회피). (AC-1)
- [ ] `POST /moims/:id/polls` 가 kind="date" + ISO 날짜 옵션 수용(optionDate/label 저장) + 미지 kind 400 + 무효 날짜 옵션 400 + 일반 투표 무변경 + question 빈/옵션<2 400 + 비멤버 403. (AC-2)
- [ ] `POST .../close` 가 날짜 투표 단일 승자 → Moim.startsAt 확정(finalizedStartsAt) / 동점 → "tie" 스킵 / 무표 → "no_votes" 스킵 / 일반 투표 → finalize 안 함 + 기존 startsAt 덮어쓰기 + 비생성자 403(finalize 미실행). (AC-3)
- [ ] `Moim.startsAt` 쓰기가 `MoimService.setStartsAt` 단일 메서드를 통한다(closePoll 호출, createMoim 외 유일 쓰기 경로). (AC-3)
- [ ] `GET /moims/:id/polls` 가 각 poll 의 kind + 각 옵션 optionDate(ISO|null) + 마감/finalize 된 날짜 투표 결과 조회 가능 + 비멤버 403 + poll 없으면 빈 배열. (AC-4)
- [ ] close 응답이 finalizedStartsAt(ISO|null) + finalizeSkippedReason("tie"|"no_votes"|null) + vote/list 응답은 둘 다 null. (AC-5)
- [ ] DTO(`CreatePollDto.kind`, `PollResponseDto.kind`/`finalizedStartsAt`/`finalizeSkippedReason`, `PollOptionResponseDto.optionDate`) + service createPoll optionDate/closePoll finalize/aggregate kind·optionDate + 컨트롤러 parseKind/parseOptionDates + setStartsAt. (AC-2/3/4/5)
- [ ] backend jest 신규(날짜 생성/무효 날짜 400/미지 kind 400/finalize 단일 승자→startsAt/동점 tie/무표 no_votes/일반 투표 finalize 안 함/덮어쓰기/비생성자 403/setStartsAt 단일 출처) + 회귀(일반 단일 교체/다중 토글/마감 409/closesAt 옵트인) + 400/403/404/409 통과. (AC-1~5/AC-8)
- [ ] `schema.d.ts` 재생성 + api-client `CreatePollRequest`(kind) / `PollResponse`(kind/옵션 optionDate/finalize, multiSelect·myVotes·closesAt·isClosed 보존) + 별칭 유지, tsc 0. (AC-6)
- [ ] web `PollWithResults`(kind/옵션 optionDate) + close 결과 타입(finalize) + `createPollAction` kind/날짜 옵션 읽기 + `closePollAction` finalize 결과 전달 + `PollCard` 날짜 포맷/확정 힌트/동점 notice + `CreatePollForm` 일정 투표 토글(datetime 옵션 전환), Meetup 오렌지. page.tsx 헤더 startsAt 갱신 확인. (AC-7)
- [ ] web tsc 0(kind/optionDate/finalize 전 소비처) / web lint 0 / web build 0. (AC-8)
- [ ] mobile tsc/vitest/expo export 회귀 0(모바일 무변경). (AC-8)
- [ ] 디바이스 종단 검증: 상세 → "일정 투표" 토글 켜고 날짜 옵션 ≥2 생성 → 포맷 날짜 + 확정 힌트 → 멤버 투표 → 생성자 "마감하기" → 단일 승자 모임 헤더 일정 확정 갱신 / 동점 notice + 일정 불변 라이브 확인. (AC-8, device-gated) — iOS 시뮬레이터에서 모바일 WebView poll 마감(Server Action + revalidatePath)이 poll 마감 AND 모임 헤더 startsAt 을 둘 다 갱신하는지 검증 대기
