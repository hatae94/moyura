# SPEC-MOIM-010 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-010: 장소 투표 자동 확정 — 장소 투표 마감 시 승자 → Moim.location
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 iOS 시뮬레이터 확인. 백엔드는 jest(장소 투표 + location finalize 신규 + 일반/날짜/마감 회귀). api-client 는 tsc.

## 수용 기준 (AC)

### AC-1: 장소 투표 데이터 모델 — 마이그레이션 없음 (← REQ-MOIM10-001)

`Poll.kind`(string, MOIM-008)가 `"place"` 를 새 VALUE 로 받고, `Moim.location`(MOIM-004)·`PollOption.optionDate`(MOIM-008)·`PollVote` PK 를 그대로 재사용하며, **신규 컬럼/마이그레이션이 없다**.

- **Given** 기존 스키마(poll.kind string `@default("general")`, MOIM-008 / poll_option.option_date nullable, MOIM-008 / moim.location String?, MOIM-004 / poll_vote PK, MOIM-006)와 poll/투표 데이터가 있고
- **When** 장소 투표 기능을 추가하면
- **Then** `Poll.kind` 가 `"place"` 를 추가 VALUE 로 받고(string 컬럼의 값 도메인 확장 — 컬럼 추가/변경 아님), 장소 옵션의 장소명은 기존 `PollOption.label` 에 담기며 `optionDate=null`, finalize 대상은 기존 `Moim.location`(이미 존재)이고, `poll_vote` PK·FK(cascade)·`@@index` 가 무변경이며, **스키마 파일이 한 줄도 바뀌지 않고**(신규 migration 디렉터리 없음), `prisma migrate status` 가 변경 없이 clean(DDL 불필요 — enum 회피가 "place" 추가를 무비용으로 만듦)이고, 기존 테이블/동작(모임·멤버·채팅·초대·단일/다중 투표·마감·날짜 투표 finalize)에 회귀가 없다.

### AC-2: 장소 투표 생성 — kind="place" + 자유 텍스트 옵션 (← REQ-MOIM10-002)

`POST /moims/:id/polls` 가 `kind: "place"` + 자유 텍스트 장소 옵션을 받아 장소 투표를 생성한다(일반 투표와 동일 정규화 — 날짜 파싱 안 함). 미지 kind 400, 일반/날짜 투표는 무변경, 비멤버 403.

- **Given** 모임 멤버가
- **When** `{ question, options: ["강남역", "홍대입구"], kind: "place" }` 로 생성하면 **Then** 201 + `kind="place"` poll 이 생성되고, 각 옵션의 `label` 이 그 장소명, `optionDate` 가 null 로 저장된다(normalizeOptions — 일반 투표와 동일 경로, 날짜로 파싱하지 않음).
- **And When** `kind` 를 생략하거나 `"general"`/`"date"` 로 생성하면 **Then** MOIM-005/006/007/008 동작 동일(`"general"`=자유 텍스트+optionDate null, `"date"`=ISO 날짜 파싱+optionDate 시각). `multiSelect`/`closesAt` 옵트인도 그대로 동작한다.
- **And When** `kind` 가 `"general"`/`"date"`/`"place"` 외의 값이면 **Then** 400 을 반환한다(parseKind 가 "place" 허용하되 그 외 거부).
- **And When** question 이 비었거나 유효 옵션이 2개 미만이면 **Then** 400 을 반환한다(장소 투표도 자유 텍스트 옵션 ≥2 — normalizeOptions, kind 추가가 이 검증을 바꾸지 않음).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 모임도 403)을 반환한다.

### AC-3: 장소 투표 마감 시 자동 확정 — 단일 승자 → location (← REQ-MOIM10-003)

장소 투표 생성자가 close 하면 단일 최다 득표 옵션의 label 이 `Moim.location` 으로 확정된다. 동점·무표·일반/날짜 투표는 location finalize 스킵. location 쓰기는 setLocation 단일 출처.

- **Given** 멤버 U 가 만든 열린 장소 투표(`kind="place"`, 옵션 A=강남역/B=홍대입구)에 A 가 최다(예: A 3표, B 1표)이고
- **When** U(생성자)가 `POST .../close` 를 호출하면 **Then** 200 + 그 poll 의 `closesAt` 가 now(마감) + `Moim.location` 가 A 의 label("강남역")로 설정되고, 응답에 `finalizedLocation = "강남역"`, `finalizeSkippedReason = null`, `finalizedStartsAt = null` 이 담긴다.
- **And Given** top voteCount 를 A/B 가 공유(동점, 예: 각 2표)인 장소 투표를 U 가 close 하면 **Then** finalize 가 스킵되어 `Moim.location` 는 변경되지 않고, 응답에 `finalizedLocation = null`, `finalizeSkippedReason = "tie"` 가 담긴다(마감 자체는 정상 — closesAt=now).
- **And Given** 표가 하나도 없는 장소 투표를 U 가 close 하면 **Then** finalize 가 스킵되어 `Moim.location` 불변 + `finalizedLocation = null`, `finalizeSkippedReason = "no_votes"`.
- **And Given** 일반 투표(`kind="general"`)를 U 가 close 하면 **Then** location finalize 가 수행되지 않으며 `Moim.location` 불변 + `finalizedLocation = null`, `finalizeSkippedReason = null`.
- **And Given** 날짜 투표(`kind="date"`)를 U 가 close 하면 **Then** location finalize 가 수행되지 않으며(`finalizedLocation = null`) MOIM-008 대로 `Moim.startsAt` 이 단일 승자 날짜로 확정되고 `finalizedStartsAt` 가 채워진다(date→startsAt 회귀 보존 — finalize 대상이 kind 로 갈림).
- **And Given** 이미 `location` 가 있는 모임의 장소 투표를 단일 승자로 finalize 하면 **Then** 기존 `location` 가 승자 label 로 **덮어써진다**(확정 시점 — 데이터 손실 아님).
- **And** `Moim.location` 쓰기는 `MoimService.setLocation` 메서드를 통해서만 일어난다(closePoll 이 직접 prisma.moim.update 안 함 — createMoim 외 유일 location 쓰기 경로, setStartsAt 미러).
- **And When** 비생성자 멤버 V 또는 비멤버가 close 하면 **Then** 403(MOIM-007 생성자 전용)이고 finalize 가 실행되지 않으며 `Moim.location` 불변이다.

### AC-4: 투표 목록 + 결과 — kind="place" 노출 (← REQ-MOIM10-004)

`GET /moims/:id/polls` 가 각 poll 의 `kind`(="place" 포함) + 각 옵션의 `label`/`optionDate`(장소 투표는 null)를 반환한다. 마감/finalize 된 장소 투표도 결과 조회 가능, 비멤버 403, poll 없으면 빈 배열.

- **Given** 멤버이고 장소 투표(`kind="place"`)·날짜 투표(`kind="date"`)·일반 투표(`kind="general"`)가 있는 상태에서
- **When** `GET /moims/:id/polls` 를 호출하면 **Then** 장소 투표는 `kind="place"` + 각 옵션 `label`(장소명) + `optionDate: null`, 날짜 투표는 `kind="date"` + 옵션 `optionDate`(ISO), 일반 투표는 `kind="general"` + `optionDate: null` 이고, 옵션별 voteCount(표 0 포함)·myVotes(목록)가 함께 반환된다(신규 읽기 필드 없음 — finalizedLocation 은 close 응답 전용).
- **And When** 마감·finalize 된 장소 투표를 조회하면 **Then** 승자 옵션 voteCount 와 closesAt/isClosed 가 정확히 조회된다(마감돼도 결과 조회 가능).
- **And When** 모임에 poll 이 없으면 **Then** 빈 배열을 반환한다(에러 아님).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 404→403)이고 투표 내용을 노출하지 않는다.

### AC-5: close 응답 — finalizedLocation 노출 (← REQ-MOIM10-005)

`POST .../close` 응답이 기존 단건 poll 결과(MOIM-007) + finalizedStartsAt/finalizeSkippedReason(MOIM-008)에 더해 `finalizedLocation`(string|null)를 포함한다. finalizedStartsAt 과 상호 배타적. vote/list 응답에선 셋 다 null.

- **Given** 단일 승자 장소 투표를 생성자가 close 하면 **Then** 응답에 마감된 단건 poll(집계 + closesAt + isClosed:true) + `finalizedLocation = 승자 label` + `finalizeSkippedReason = null` + `finalizedStartsAt = null` 이 있다.
- **And Given** 동점 장소 투표 close → **Then** `finalizedLocation = null` + `finalizeSkippedReason = "tie"`.
- **And Given** 무표 장소 투표 close → **Then** `finalizedLocation = null` + `finalizeSkippedReason = "no_votes"`.
- **And Given** 일반 투표 close → **Then** `finalizedLocation = null` + `finalizedStartsAt = null` + `finalizeSkippedReason = null`(finalize 대상 아님).
- **And Given** 날짜 투표 close → **Then** `finalizedLocation = null` + `finalizedStartsAt = 승자 ISO(또는 null)`(date→startsAt — finalizedStartsAt 과 finalizedLocation 상호 배타).
- **And When** `POST .../vote` 또는 `GET .../polls` 응답을 보면 **Then** `finalizedLocation`/`finalizedStartsAt`/`finalizeSkippedReason` 가 항상 `null` 이다(finalize 는 close 에서만 — 별도 wrapper 없이 같은 DTO 재사용).

### AC-6: api-client 갱신 (← REQ-MOIM10-006)

api-client 재생성으로 `CreatePollRequest.kind` 가 `"place"` 를 받고, `PollResponse` 에 `finalizedLocation`가 반영된다. 기존 필드 보존, 별칭 유지, web 헬퍼/타입 갱신.

- **Given** 백엔드 OpenAPI 가 kind enum "place" + finalizedLocation 을 노출하고
- **When** `nx run api-client:generate` 후 tsc 를 실행하면
- **Then** `CreatePollRequest` 의 `kind` 가 `"place"` 를 포함하고, `PollResponse`(= `components['schemas']['PollResponseDto']`)에 `finalizedLocation: string | null` 이 있으며 `kind`(="place" 포함)/옵션 `optionDate`/`finalizedStartsAt`/`finalizeSkippedReason`/`multiSelect`/`myVotes`/`closesAt`/`isClosed` 가 보존되고, web `PollWithResults`(`kind` union 확장)와 close 결과 타입(finalizedLocation)이 추가되어 backend/web/api-client tsc 가 0 error 다(수동 schema 편집 없음).

### AC-7: 웹 장소 투표 UI + 장소 확정 갱신 (← REQ-MOIM10-007)

모임 상세가 장소 투표를 텍스트 옵션 + 확정 힌트로 렌더하고, 생성 폼에 투표 종류 3-way 선택(일반/날짜/장소, "장소" 선택 시 텍스트 옵션), close 후 모임 헤더 장소(location) 갱신 + 동점 notice. Meetup 오렌지.

- **Given** 인증·이름 보유 멤버가 모임 상세(`/home/{id}`)에 있고
- **When** "투표 만들기" 에서 투표 종류를 "장소" 로 고르면 **Then** 동적 옵션 입력이 텍스트(장소명)로 두어지고, 장소 ≥2 + 질문을 제출하면 `kind: "place"` + 각 옵션 텍스트 그대로(ISO 변환 없음 — 일반과 동일) 생성된다. "날짜" 면 datetime-local 옵션(MOIM-008 회귀 보존), "일반" 이면 텍스트. 기존 이진 "일정 투표" 토글은 3-way 선택으로 대체된다. `multiSelect` 토글과 공존한다.
- **And When** `kind="place"` poll 이 있으면 **Then** 각 옵션이 `label`(장소명) 텍스트로 렌더되고(날짜 포맷 없음 — date 옵션만 포맷), 열려 있으면 "마감하면 최다 득표 장소가 모임 장소로 확정돼요" 힌트가 표시된다. 일반 투표는 힌트 없음, 날짜 투표는 일정 확정 힌트(MOIM-008).
- **And When** 생성자가 장소 poll 을 "마감하기" 로 닫고 단일 승자가 있으면 **Then** `POST .../close` 후 그 poll 이 "마감됨"으로 갱신되고, 모임 헤더 장소(`location`)가 승자 장소로 확정 갱신된다(revalidatePath — 헤더 location 반영). 다른 멤버에게는 MOIM-009 realtime 이 poll 변경을 전파한다(본 SPEC 추가 배선 없음).
- **And When** close 응답이 `finalizeSkippedReason = "tie"` 면 **Then** 동점으로 장소가 자동 확정되지 않았음을 안내한다("동점이라 장소가 자동 확정되지 않았어요" 류), `"no_votes"` 면 그에 맞는 안내(또는 일반화). 모임 헤더 장소는 변경되지 않는다.
- **And When** 생성/마감이 백엔드 오류(400/403/404/네트워크)를 반환하면 **Then** 폼/화면에 머무르며 일반화 오류를 표시한다(토큰/상세 비노출 — 미지 kind 400, 비생성자 마감 403 포함).
- **And** 투표 종류 3-way 선택·텍스트 옵션·확정 힌트·동점 notice 가 모두 Meetup 오렌지 토큰을 쓴다(login/onboarding blue 아님).

### AC-8: 품질 게이트 (← spec.md §7)

backend jest 통과(장소 투표 + location finalize 신규 + 일반/날짜/마감 회귀), backend+web+api-client tsc 0, web lint 0, web build 0, **마이그레이션 없음**(kind "place" 는 새 VALUE — DDL 불필요, Moim.location 이미 존재, migrate status 변경 없이 clean), mobile tsc/vitest/expo export 회귀 0.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(장소 투표 생성 → 멤버 투표 → 생성자 마감 → 단일 승자 장소 확정 갱신 / 동점 notice + 장소 불변)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **kind 생략(일반 투표)**: kind 미전송 → "general" → 자유 텍스트 옵션 + optionDate null → location finalize 대상 아님(MOIM-005~008 동작 보존). (← REQ-MOIM10-002/003)
- **미지 kind**: "general"/"date"/"place" 외 값 → 400(parseKind). (← REQ-MOIM10-002)
- **장소 옵션 = 자유 텍스트**: kind="place" 옵션은 날짜로 파싱하지 않고 normalizeOptions(trim, ≥2)로 처리 → label=장소명, optionDate null(date 와의 결정적 차이 — date 만 parseOptionDates). (← REQ-MOIM10-002)
- **단일 승자 location finalize**: 단일 최다 득표 → Moim.location = 그 label(기존 덮어씀) + finalizedLocation 반영. (← REQ-MOIM10-003)
- **동점 스킵**: top voteCount 공유 ≥2 → finalize 안 함, location 불변, finalizeSkippedReason "tie"(자의적 tie-break 금지 — 사람이 결정, MOIM-008 승계). (← REQ-MOIM10-003)
- **무표 스킵**: 모든 옵션 0표 → 승자 없음 → finalize 안 함, location 불변, "no_votes". (← REQ-MOIM10-003)
- **일반 투표 close = location finalize 안 함**: kind="general" close 는 마감만(MOIM-007), location 불변, finalize 필드 null. (← REQ-MOIM10-003)
- **날짜 투표 close = startsAt 확정(location 안 건드림)**: kind="date" close 는 MOIM-008 대로 startsAt 을 확정(finalizedStartsAt) 하고 location 은 불변(finalizedLocation null) — finalize 대상이 kind 로 갈림. date 분기 회귀 보존. (← REQ-MOIM10-003/005)
- **기존 location 덮어쓰기**: 모임에 이미 location(생성 시 값/이전 finalize)이 있어도 단일 승자 finalize 가 덮어씀(확정 시점 — 의도된 동작). (← REQ-MOIM10-003)
- **다중 선택 장소 투표**: multiSelect=true 장소 투표도 finalize 는 옵션별 voteCount 의 단일 최다만 본다(동점이면 스킵). 다중 선택은 후보 확장 도구, finalize 규칙 불변. (← REQ-MOIM10-003/007)
- **passive deadline-pass ≠ finalize**: closesAt 시각이 그냥 지난 장소 투표를 GET 해도 location 이 저절로 안 바뀐다 — finalize 는 명시적 생성자 close 핸들러에서만(크론 없음, isClosed 표시만, MOIM-008 승계). (← REQ-MOIM10-003)
- **비생성자/비멤버 finalize 차단**: close 가 MOIM-007 생성자 전용이라 비생성자/비멤버는 403 으로 finalize 에 도달 못 함, location 불변. (← REQ-MOIM10-003)
- **finalize 후 결과 조회**: 마감·finalize 된 장소 투표도 GET 으로 승자 voteCount/label/closesAt/isClosed 조회 가능. (← REQ-MOIM10-004)
- **close 응답 vs vote/list 응답**: finalize 3필드(finalizedStartsAt/finalizedLocation/finalizeSkippedReason)는 close 응답에서만 값을 가지며 vote/list 에선 항상 null(같은 DTO 재사용, 값 의미는 라우트가 정함). (← REQ-MOIM10-005)
- **finalizedStartsAt vs finalizedLocation 상호 배타**: 한 poll 은 한 kind 이므로 한 close 응답에서 둘이 동시에 비-null 이 되지 않는다(date close → startsAt, place close → location). (← REQ-MOIM10-005)
- **location 쓰기 단일 출처**: finalize 가 직접 prisma.moim.update 안 하고 MoimService.setLocation 호출(createMoim 외 유일 location 쓰기 — 드리프트 차단, setStartsAt 미러). (← REQ-MOIM10-003)
- **finalizedLocation/kind "place" 추가 소비처**: 순수 추가(제거 아님)라 기존 소비처는 안 깨지나, web PollWithResults 미러·close 결과 타입·kind 분기가 새 필드/값을 채워야 함 → tsc 차단. (← REQ-MOIM10-006)
- **장소 옵션 표시**: 웹은 label(장소명)을 텍스트 그대로 렌더한다(날짜 포맷 없음 — 날짜 포맷은 kind="date" 옵션 전용). (← REQ-MOIM10-007)
- **3-way 선택의 날짜 투표 회귀**: 이진 토글 → 3-way 선택 교체 후에도 "날짜" 선택이 datetime-local 옵션 + ISO 변환을 유지(MOIM-008 흐름 보존). (← REQ-MOIM10-007)
- **realtime 무변경**: MOIM-009 트리거가 kind 무관하게 모든 close/vote 에 'poll_change' 발화 → 장소 투표 마감도 다른 멤버에게 전파됨(본 SPEC realtime 코드 없음 — 트리거/구독/payload 무변경 확인). (← REQ-MOIM10-007 / spec §4)
- **세션 만료 후 생성/마감**: Server Action 시점 세션 부재 → `/login` 리다이렉트(poll/장소 미변경). (← REQ-MOIM10-007)
- **비멤버 접근**: 비멤버가 생성/투표/조회/마감 → 모두 403(미존재 모임도 403). kind "place" 추가가 인가에 영향 없음. (← REQ-MOIM10-002/003/004)
- **데스크톱 vs 모바일**: 장소 투표 UI 는 데스크톱 일반 렌더 + 모바일 in-WebView(상세 `/home/{id}` 안 — 신규 네이티브 라우트 없음). Server Action(`revalidatePath`)이 WebView 안에서 poll 마감 AND 모임 헤더 location(장소 확정)을 둘 다 갱신하는지 디바이스 검증.

## Definition of Done (DoD)

- [ ] 마이그레이션 없음(kind "place" 는 새 VALUE — DDL 불필요, Moim.location/PollOption.optionDate 이미 존재, PK/FK/인덱스 무변경, 스키마 파일 무변경), prisma migrate status 변경 없이 clean. (AC-1)
- [ ] `POST /moims/:id/polls` 가 kind="place" + 자유 텍스트 장소 옵션 수용(normalizeOptions label 저장, optionDate null — 일반과 동일 경로) + 미지 kind 400 + 일반/날짜 투표 무변경 + question 빈/옵션<2 400 + 비멤버 403. (AC-2)
- [ ] `POST .../close` 가 장소 투표 단일 승자 → Moim.location 확정(finalizedLocation) / 동점 → "tie" 스킵 / 무표 → "no_votes" 스킵 / 일반 투표 → location finalize 안 함 / 날짜 투표 → startsAt 확정(MOIM-008 회귀, finalizedLocation null) + 기존 location 덮어쓰기 + 비생성자 403(finalize 미실행). (AC-3)
- [ ] `Moim.location` 쓰기가 `MoimService.setLocation` 단일 메서드를 통한다(closePoll 호출, createMoim 외 유일 쓰기 경로, setStartsAt 미러). (AC-3)
- [ ] `GET /moims/:id/polls` 가 각 poll 의 kind(="place" 포함) + 각 옵션 label/optionDate(장소 투표 null) + 마감/finalize 된 장소 투표 결과 조회 가능 + 비멤버 403 + poll 없으면 빈 배열. (AC-4)
- [ ] close 응답이 finalizedLocation(string|null) + finalizedStartsAt 과 상호 배타 + finalizeSkippedReason + vote/list 응답은 셋 다 null. (AC-5)
- [ ] DTO(`CreatePollDto.kind` enum "place", `PollResponseDto.finalizedLocation`/kind enum "place") + service closePoll place→setLocation finalize 분기/aggregate finalizedLocation null + 컨트롤러 parseKind "place"/create place→normalizeOptions/closeResultToDto + setLocation. (AC-2/3/4/5)
- [ ] backend jest 신규(장소 생성/미지 kind 400/location finalize 단일 승자→location/동점 tie/무표 no_votes/일반 투표 location finalize 안 함/날짜 투표 startsAt 확정 회귀/덮어쓰기/비생성자 403/setLocation 단일 출처) + 회귀(일반 단일 교체/다중 토글/날짜 finalize/마감 409/closesAt 옵트인) + 400/403/404/409 통과. (AC-1~5/AC-8)
- [ ] `schema.d.ts` 재생성 + api-client `CreatePollRequest`(kind "place") / `PollResponse`(finalizedLocation, kind "place"/optionDate/finalizedStartsAt/finalizeSkippedReason/multiSelect·myVotes·closesAt·isClosed 보존) + 별칭 유지, tsc 0. (AC-6)
- [ ] web `PollWithResults`(kind union 확장) + close 결과 타입(finalizedLocation) + `createPollAction` kind="place"/텍스트 옵션 읽기(ISO 변환 없음) + `closePollAction` finalizedLocation 결과 전달 + `PollCard` 장소 텍스트 렌더/확정 힌트/동점 notice + `CreatePollForm` 투표 종류 3-way 선택(텍스트/날짜 옵션 전환), Meetup 오렌지. page.tsx 헤더 location 갱신 확인. (AC-7)
- [ ] web tsc 0(finalizedLocation/kind "place" 전 소비처) / web lint 0 / web build 0. (AC-8)
- [ ] mobile tsc/vitest/expo export 회귀 0(모바일 무변경). (AC-8)
- [ ] 디바이스 종단 검증: 상세 → 투표 종류 "장소" 선택 후 장소 옵션 ≥2 생성 → 장소명 텍스트 + 확정 힌트 → 멤버 투표 → 생성자 "마감하기" → 단일 승자 모임 헤더 장소 확정 갱신 / 동점 notice + 장소 불변 라이브 확인. (AC-8, device-gated) — iOS 시뮬레이터에서 모바일 WebView poll 마감(Server Action + revalidatePath)이 poll 마감 AND 모임 헤더 location 을 둘 다 갱신하는지 + MOIM-009 realtime 전파 검증 대기
