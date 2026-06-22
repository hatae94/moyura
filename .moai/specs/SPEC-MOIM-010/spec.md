---
id: SPEC-MOIM-010
version: 0.1.0
status: draft
created: 2026-06-22
updated: 2026-06-22
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-010: 장소 투표 자동 확정 — 장소 투표 마감 시 승자 → Moim.location

## HISTORY

- 2026-06-22 (v0.1.0): 최초 draft. SPEC-MOIM-008(일정 투표 자동 확정 — 날짜 투표 마감 시 승자 → `Moim.startsAt`, 구현 완료·라이브 검증)의 직속 형제(sibling). MOIM-008 §4 가 명시적으로 카브아웃한 **장소(location) auto-finalize** 한 항목만 채워 이벤트 트라이어드 자동화(일정 + 장소)를 완성한다. MOIM-008 이 만든 투표 종류(`Poll.kind`, 현재 `"general"|"date"`) + finalize 마감(`POST .../close` 생성자 전용 + 단일 최다 득표 승자 + 동점/무표 스킵 + 덮어쓰기 + close 응답 finalize 필드)을 verified 기준으로 확장한다. **WHY**: 모임 투표의 두 번째로 흔한 실무는 "어디서 모일까"를 장소 후보로 올려 투표하는 것이고(MOIM-004 가 추가한 `Moim.location` 이 그 목적지다), 마감 시 최다 득표 장소는 곧 모임 장소여야 한다 — 그런데 MOIM-008 의 finalize 는 날짜 투표만 `startsAt` 으로 확정하고 장소는 손대지 않아, 생성자가 승자를 보고 `Moim.location` 을 손으로 다시 맞춰야 했다. 본 SPEC은 그 마지막 한 걸음을 자동화한다: **장소 투표**를 마감하면 단일 최다 득표 옵션의 장소명이 그 모임의 `Moim.location` 으로 자동 확정된다. **핵심 결정(MOIM-008 의 확정 결정을 유추로 승계 — 동점/덮어쓰기/생성자/수동마감 재논의 없음)**: (1) **kind 에 "place" 추가** — `Poll.kind` 가 이제 `"general"|"date"|"place"`. **신규 컬럼 없음.** MOIM-008 대비 **핵심 단순화**: 장소 투표의 옵션은 그냥 **자유 텍스트**(장소명)다 — 기존 `PollOption.label` 이 곧 장소다. optionDate-등가 컬럼이 **필요 없다**(`Moim.location` 이 String 이라 승자 옵션의 label 이 그대로 매핑됨). 따라서 장소 투표 옵션은 일반 투표 옵션과 **정확히 동일하게** 검증한다(`normalizeOptions` — trim, 비지 않은 label ≥2). `optionDate` 는 장소 투표에서 null 그대로. (2) **생성** — `POST /moims/:id/polls` 가 `kind="place"` 수용. `kind="place"` 면 옵션은 자유 텍스트 label(일반과 동일 — `normalizeOptions`, 날짜로 파싱하지 **않음**). `parseKind` 검증이 `"place"` 도 허용하도록 확장(미지 값은 여전히 → 400). general/date 경로 무변경. (3) **finalize** — 생성자가 장소 투표를 수동 마감하면: 단일 최다 득표 승자 → `Moim.location = winner.label`(기존 location 덮어씀). 동점 → 스킵(`finalizeSkippedReason "tie"`); 무표 → `"no_votes"`; general/date 투표 → location finalize 없음(date 는 MOIM-008 대로 여전히 startsAt 확정). 생성자 전용(close 가 이미 게이트). 신규 `MoimService.setLocation(moimId, location)` — 생성 후 location 쓰기의 단일 출처(`setStartsAt` 미러). closePoll 의 finalize 분기: `kind="date"` → `setStartsAt(winner.optionDate)`[MOIM-008, 무변경]; `kind="place"` → `setLocation(winner.label)`[신규]; 그 외 finalize 없음. (4) **close 응답** — `PollResponseDto` 에 `finalizedLocation: string | null` 을 기존 `finalizedStartsAt`(MOIM-008) + 공유 `finalizeSkippedReason`("tie"|"no_votes"|null) 옆에 추가. 장소 투표 close 는 `finalizedLocation` 을 채우고(date/general/동점/무표면 null), 날짜 투표 close 는 `finalizedStartsAt` 을 채운다(무변경). 둘 다 create/vote/list 응답에선 null. 순수 추가(제거 없음 — 기존 소비처 무파손). **스코프 결정 기록**: (a) `Poll.kind` 에 `"place"` 는 새 **VALUE** 추가일 뿐(string 컬럼, 마이그레이션/DDL 없음 — MOIM-008 의 enum 회피가 그대로 이득); (b) `Moim.location` 은 이미 존재(MOIM-004) — 신규 컬럼 없음; (c) 장소 옵션 = 자유 텍스트(optionDate 안 씀 — date 와의 결정적 차이); (d) finalize 트리거는 생성자 manual close 만(passive deadline-pass·크론 제외 — MOIM-008 승계); (e) 승자 = 단일 최다 득표(동점·무표 → 스킵, location 불변 — MOIM-008 승계); (f) location 쓰기는 `MoimService.setLocation` 신규 메서드 1곳으로 모음(createMoim 외 유일 location 쓰기 경로 — `setStartsAt` 패턴 미러); (g) date+place 한 투표 결합·지도/지오코딩/장소 피커·reopen·un-finalize·edit-after-finalize·realtime(MOIM-009 가 이미 처리)·모바일 코드·크론은 모두 **제외**(§4).

---

## 1. 개요 (Overview)

SPEC-MOIM-005(단일 선택) → 006(다중 선택) → 007(마감) → 008(날짜 투표 자동 확정)이 모임 투표를 단계적으로 키웠다. MOIM-008 은 finalize 자동화를 더해 "날짜 투표를 마감하면 최다 득표 날짜가 모임 일정(`Moim.startsAt`)으로 확정"되게 했지만, **finalize 대상은 일정 한 가지뿐이고 장소는 명시적으로 카브아웃**됐다(MOIM-008 §4 "장소(location) auto-finalize 는 제외 — 향후"). 모임 투표의 또 다른 흔한 형태 — "어디서 모일까?" — 에서, 마감 후 최다 득표 장소는 곧 모임 장소다. 본 SPEC은 그 자동화를 채워 이벤트 트라이어드(일정 + 장소) 자동화를 완성한다: **장소 투표**를 생성자가 마감하면 단일 최다 득표 장소명이 그 모임의 `Moim.location`(MOIM-004 가 추가한 이벤트 장소)으로 자동 확정된다.

본 SPEC의 자동 확정은 **MOIM-008 이 만든 투표 종류·finalize 골격을 그대로 승계**하고, 장소를 위한 **세 번째 kind 값**만 추가한다:

1. **투표 종류(kind)에 "place" 추가** — `Poll.kind`(string, 기본 `"general"`)가 이제 일반 투표(`"general"`, 자유 텍스트 옵션) / 날짜 투표(`"date"`, 각 옵션이 날짜/시각 — MOIM-008) / **장소 투표**(`"place"`, 각 옵션이 장소명)를 구분한다. enum 이 아니라 string `@default` 컬럼이므로 `"place"` 는 **새 VALUE 추가일 뿐**이고 DB 스키마/마이그레이션은 전혀 바뀌지 않는다(허용 값이 하나 늘어날 뿐 — 컨트롤러 `parseKind` 가 `"place"` 를 허용하고 미지 값은 여전히 400). MOIM-008 대비 **핵심 단순화**: 장소 옵션은 **자유 텍스트**(장소명)라 날짜 같은 별도 시각 컬럼이 필요 없다 — 기존 `PollOption.label` 이 곧 장소다.
2. **장소 옵션 = 자유 텍스트 라벨** — 장소 투표 옵션은 일반 투표 옵션과 **정확히 동일하게** 처리한다(`normalizeOptions` — trim 후 비지 않은 label ≥2). 날짜로 파싱하지 않으며 `optionDate` 는 null 이다(date 와의 결정적 차이). `Moim.location` 이 String 이라 승자 옵션의 `label` 이 그대로 location 으로 매핑된다 — optionDate-등가 컬럼이 필요 없다.
3. **자동 확정(finalize)** — 생성자가 **장소 투표**를 수동 마감(MOIM-007/008 `POST .../close`)하면, closesAt=now 설정 후 승자(단일 최다 득표 옵션)의 `label` 이 `Moim.location` 으로 자동 설정된다(기존 location 덮어씀 — 확정 시점). 트리거는 **생성자 수동 마감뿐**이다(MOIM-008 승계) — 크론/스케줄러 없고, passive deadline-pass 는 finalize 하지 않는다.
4. **동점/무표 — 스킵** — top voteCount 를 ≥2 옵션이 공유(동점)하거나 0표면 승자가 없어 finalize 를 건너뛴다(`Moim.location` 불변). close 응답이 스킵 이유(`"tie"`/`"no_votes"`)를 담아 웹이 안내한다. 단일 승자일 때만 location 을 설정한다. **날짜 투표(date)는 MOIM-008 대로 여전히 startsAt 을 확정**하고, 장소 투표(place)는 location 을 확정한다 — finalize 대상이 kind 로 갈린다.

데이터는 **스키마/마이그레이션 변경이 전혀 없다**. `Poll.kind` 는 이미 존재하는 string 컬럼이고(`"place"` 는 새 VALUE 일 뿐 — DDL 불필요), `Moim.location` 도 이미 존재한다(MOIM-004). `PollOption.optionDate`(MOIM-008)는 장소 투표에서 null 그대로다. 따라서 본 SPEC에는 **마이그레이션이 없다**(MOIM-008 이 컬럼 2개를 additive 추가한 것보다 단순하다).

`Moim.location` 쓰기는 신규 `MoimService.setLocation` 메서드 **한 곳**으로 모은다(현재 `createMoim` 이 유일한 location 쓰기 경로 — MOIM-008 의 `setStartsAt` 단일 출처 패턴을 location 에 미러). `PollService.closePoll` 이 장소 투표 finalize 시 이 메서드를 호출한다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 장소 투표 UI(투표 종류 3-way 선택·텍스트 옵션 입력·확정 힌트·동점 notice)는 모임 상세(`/home/[id]`) 안에서 in-WebView 로 렌더되므로 **모바일 신규 코드는 없다**. realtime 도 신규 배선이 없다 — MOIM-009 의 poll/poll_vote 트리거가 kind 와 무관하게 모든 poll close/vote 에 `'poll_change'` 를 이미 브로드캐스트하므로 장소 투표 마감도 다른 멤버에게 그대로 전파된다.

이는 **kind 에 "place" 값 추가 + 장소 투표 생성/검증(일반과 동일) + close 시 단일 승자 finalize → location + close 응답 1필드(finalizedLocation) + 웹 투표 종류 3-way 선택 UI** 이지 대형 기능이 아니다. date+place 결합·지도/지오코딩/장소 피커·reopen·un-finalize·edit-after-finalize·realtime 신규 배선·모바일 코드·크론은 모두 제외한다(§4).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 7개로 제한한다. 각 모듈은 `REQ-MOIM10-XXX`로 번호를 부여하며(기존 `REQ-MOIM7-XXX`/`REQ-MOIM8-XXX` 등과 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM10-001: 장소 투표 데이터 모델 — 마이그레이션 없음 (Ubiquitous)

- **The backend shall** 장소 투표를 위해 **신규 컬럼이나 마이그레이션 없이** 기존 스키마를 재사용한다 — `Poll.kind`(string `@default("general")`, MOIM-008)는 이미 존재하며 `"place"` 는 **허용 VALUE 가 하나 늘어나는 것일 뿐**이라 DB 스키마/DDL 변경이 없다(`"general"|"date"` → `"general"|"date"|"place"` 는 string 컬럼의 값 도메인 확장이지 컬럼 추가가 아님).
- **The backend shall** 장소 투표 옵션의 장소명을 기존 `PollOption.label`(MOIM-005 자유 텍스트 라벨)에 담고, `PollOption.optionDate`(MOIM-008, nullable)는 장소 투표 옵션에서 `null` 로 둔다 — `Moim.location` 이 String 이라 승자 옵션의 `label` 이 그대로 location 으로 매핑되므로 optionDate-등가 컬럼이 필요 없다.
- **The backend shall** `Moim.location`(String?, MOIM-004 가 추가)을 finalize 대상으로 재사용한다 — 신규 컬럼 추가 없음(이미 존재).
- **The backend shall** `PollVote` 의 복합 PK `(pollId, optionId, userId)`(MOIM-006)와 모든 FK(cascade)·인덱스·`Poll`/`PollOption`/`Moim` 의 기존 컬럼을 **그대로 보존**한다(장소 투표 추가가 어떤 스키마도 건드리지 않음 — 순수 동작 추가).
- **The backend shall** 본 SPEC에 **마이그레이션을 추가하지 않는다** — `prisma migrate status` 는 변경 없이 clean 이어야 한다(스키마 파일 무변경, 신규 migration 디렉터리 없음). MOIM-008 의 비파괴 패턴조차 불필요하다(컬럼 추가가 없으므로).

### REQ-MOIM10-002: 장소 투표 생성 — kind="place" + 자유 텍스트 옵션 (Event-driven / Unwanted behavior 혼합)

- (Event-driven, 장소) **WHEN** 모임 멤버가 `{ question, options[], kind: "place", multiSelect?, closesAt? }` 로 `POST /moims/:id/polls` 를 호출하면(`options[]` 는 자유 텍스트 장소명들), **the backend shall** 각 옵션을 일반 투표와 **정확히 동일하게** 정규화해(`normalizeOptions` — trim 후 비지 않은 항목 ≥2) `PollOption.label = 장소명`, `optionDate = null` 로 저장하고 `Poll.kind = "place"` 로 생성한다(트랜잭션). 날짜로 파싱하지 않는다.
- (Event-driven, 일반/날짜) **WHEN** `kind` 가 생략되거나 `"general"`/`"date"` 면, **the backend shall** MOIM-005/006/007/008 그대로 생성한다(회귀 0) — `"general"` 은 자유 텍스트(optionDate null), `"date"` 는 ISO 날짜 파싱(optionDate=파싱 시각, MOIM-008). `multiSelect`/`closesAt` 옵트인도 그대로 동작한다.
- (Unwanted behavior) **IF** `kind` 가 `"general"`/`"date"`/`"place"` 외의 값이면, **then the backend shall** `400 Bad Request` 를 반환한다(`parseKind` 가 `"place"` 를 허용하도록 확장하되 미지 값은 여전히 400 — MOIM-008 의 명시 검사 정책 그대로).
- (Unwanted behavior) **IF** question 이 비었거나 유효 옵션이 2개 미만이면, **then the backend shall** `400 Bad Request` 를 반환한다(kind="place" 도 자유 텍스트 옵션 ≥2 — 일반 투표와 동일 검증, `normalizeOptions`).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` 단일 출처 — 약화 금지).

### REQ-MOIM10-003: 장소 투표 마감 시 자동 확정 — 단일 승자 → location (Event-driven / State-driven 혼합)

- (Event-driven, finalize) **WHEN** **장소 투표**(`poll.kind = "place"`)의 **생성자**가 `POST /moims/:id/polls/:pollId/close` 를 호출하면, **the backend shall** (MOIM-007/008 그대로) `closesAt = now` 로 마감한 **뒤**, 그 poll 의 옵션 중 **단일 최다 득표**(strictly-highest voteCount) 옵션이 존재하면 그 옵션의 `label` 을 `Moim.location` 으로 설정(기존 location 덮어씀)하고, close 응답에 `finalizedLocation = 그 label`, `finalizeSkippedReason = null` 을 담는다.
- (State-driven, 동점) **WHILE** 마감하는 장소 투표의 top voteCount 를 2개 이상의 옵션이 공유(동점)하는 동안, **WHEN** 생성자가 close 하면, **the backend shall** finalize 를 **건너뛰고**(`Moim.location` 불변), close 응답에 `finalizedLocation = null`, `finalizeSkippedReason = "tie"` 를 담는다(마감 자체는 정상 — closesAt=now 설정됨).
- (State-driven, 무표) **WHILE** 마감하는 장소 투표에 표가 하나도 없는 동안(모든 옵션 voteCount=0), **WHEN** 생성자가 close 하면, **the backend shall** finalize 를 **건너뛰고**(`Moim.location` 불변), close 응답에 `finalizedLocation = null`, `finalizeSkippedReason = "no_votes"` 를 담는다.
- (Event-driven, 일반/날짜 투표) **WHEN** **일반 투표**(`poll.kind = "general"`) 또는 **날짜 투표**(`poll.kind = "date"`)의 생성자가 close 하면, **the backend shall** location finalize 를 수행하지 않는다 — close 응답의 `finalizedLocation = null`. (날짜 투표는 MOIM-008 대로 `Moim.startsAt` 을 여전히 확정하고 `finalizedStartsAt` 를 채운다 — finalize 대상이 kind 로 갈린다: date→startsAt, place→location, general→없음.)
- (Ubiquitous, 쓰기 단일 출처) **The backend shall** `Moim.location` 쓰기를 신규 `MoimService.setLocation(moimId, location)` 메서드 **한 곳**에서만 수행한다(현재 `createMoim` 이 유일한 location 쓰기 경로 — finalize 가 직접 prisma 로 moim 을 갱신하지 않고 이 메서드를 호출한다, MOIM-008 의 `setStartsAt` 단일 출처 패턴 미러).
- (Unwanted behavior) **IF** 요청 사용자가 생성자가 아니거나(403) 비멤버이거나(403) pollId 가 path 모임에 속하지 않으면(404), **then the backend shall** MOIM-007/008 의 인가/일관성 판정을 그대로 반환하며 finalize 에 도달하지 않는다(비생성자 finalize 차단 — close 가 이미 생성자 전용).

### REQ-MOIM10-004: 투표 목록 + 결과 조회 — kind="place" 노출 (Ubiquitous / Unwanted behavior 혼합)

- (Ubiquitous) **The `GET /moims/:id/polls` response shall** 각 poll 에 기존 필드(`id`/`question`/`createdBy`/`createdAt`/`multiSelect`/`closesAt`/`isClosed`/`kind`/옵션 배열(`optionDate` 포함)/`myVotes`)를 그대로 포함하며, 장소 투표는 `kind = "place"` + 옵션 `label`(장소명) + `optionDate = null` 로 실린다(MOIM-008 의 읽기 모델에서 kind 값만 늘어난다 — 신규 읽기 필드 없음, finalizedLocation 은 close 응답 전용).
- (Ubiquitous) **The backend shall** 장소 투표 옵션에 `optionDate = null` 을 반환한다(날짜 투표 옵션만 ISO 시각). 웹은 장소 투표 옵션을 `label`(장소명) 그대로 텍스트로 렌더한다(날짜 포맷 없음 — 날짜 포맷은 kind="date" 옵션에만 적용).
- (Ubiquitous) **The backend shall** 마감/finalize 여부와 무관하게 옵션별 `voteCount`(표 0 포함)와 호출자 `myVotes`(목록)를 정확히 반환한다 — 마감된 장소 투표도 결과(승자 포함)는 항상 조회 가능하다.
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember`).
- (Ubiquitous) **The backend shall** poll 이 하나도 없는 모임에 대해 **빈 배열**을 반환한다(에러 아님).

### REQ-MOIM10-005: close 응답 — finalizedLocation 노출 (Ubiquitous)

- **The `POST /moims/:id/polls/:pollId/close` response shall** 기존 단건 poll 결과(MOIM-007 — 집계 + closesAt + isClosed=true) + MOIM-008 의 `finalizedStartsAt`(ISO|null) + `finalizeSkippedReason`("tie"|"no_votes"|null)에 더해 **`finalizedLocation`(string 또는 `null`)** 를 포함한다.
- **The backend shall** `finalizedLocation` 을 장소 투표(`kind="place"`)의 단일 승자 finalize 가 일어났을 때만 그 승자 label 로, 그 외(동점·무표·일반·날짜 투표)에는 `null` 로 채운다. `finalizeSkippedReason` 은 장소/날짜 투표가 동점이면 `"tie"`, 무표면 `"no_votes"`, finalize 가 일어났거나 일반 투표면 `null` 로 채운다(MOIM-008 과 공유 — date/place 공통).
- **The backend shall** `finalizedStartsAt`/`finalizedLocation`/`finalizeSkippedReason` 세 필드를 PollResponseDto 에 두되(finalizedLocation 은 본 SPEC 순수 추가, 나머지는 MOIM-008), `POST .../vote` 와 `GET .../polls` 응답에서는 셋 다 항상 `null` 로 채운다(finalize 는 close 에서만). 별도 wrapper 타입을 만들지 않는다(기존 단건 poll DTO 재사용 — MOIM-008 동일).
- **The backend shall** 한 close 응답에서 `finalizedStartsAt` 과 `finalizedLocation` 을 **상호 배타적**으로 채운다 — 날짜 투표 close 는 finalizedStartsAt(있으면)을 채우고 finalizedLocation=null, 장소 투표 close 는 finalizedLocation(있으면)을 채우고 finalizedStartsAt=null(한 poll 은 한 kind 이므로 둘이 동시에 채워지지 않는다).

### REQ-MOIM10-006: api-client 투표 표면 갱신 (Ubiquitous)

- **The api-client shall** 백엔드 OpenAPI 변경(`CreatePollDto.kind` 의 enum 에 `"place"` 추가, `PollResponseDto.finalizedLocation` 추가)을 반영해 생성 `schema.d.ts` 를 재생성한다(수동 편집 없음).
- **The api-client shall** 기존 poll 타입 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`)을 유지하되, 재생성으로 `CreatePollRequest.kind` 가 `"place"` 를 받고 `PollResponse` 에 `finalizedLocation` 이 반영되도록 한다(`multiSelect`/`myVotes`/`closesAt`/`isClosed`/`kind`/옵션 `optionDate`/`finalizedStartsAt`/`finalizeSkippedReason` 은 MOIM-006/007/008 그대로 보존).
- **The web app shall** path-param 투표 라우트를 web 의 **구체-경로 헬퍼**(`lib/moim/polls.ts`)로 호출하는 기존 패턴(`listPolls`/`createPoll`/`votePoll`/`closePoll`)을 유지하고, `PollWithResults`(web 미러 타입)의 `kind` 를 `"general" | "date" | "place"` 로 확장 + close 결과에 `finalizedLocation: string | null` 추가(`finalizedStartsAt`/`finalizeSkippedReason` 은 MOIM-008 그대로).
- **The api-client/web shall** 토큰을 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).

### REQ-MOIM10-007: 웹 장소 투표 UI + 장소 확정 갱신 (Event-driven / State-driven / Ubiquitous 혼합)

- (Event-driven, 생성) **WHEN** 멤버가 "투표 만들기" 폼에서 투표 종류를 **3-way 선택(일반 / 날짜 / 장소)** 중 "장소" 로 고르고 동적 옵션 입력(이때 각 옵션은 텍스트 = 장소명)을 채워 제출하면, **the web app shall** `kind: "place"` 로 표시하고 각 옵션 텍스트를 그대로 `options[]` 에 담아 생성 엔드포인트에 전달한다(ISO 변환 없음 — 일반 투표와 동일). "날짜" 면 datetime-local 옵션(MOIM-008), "일반"/"장소" 면 텍스트 옵션이다. 기존 이진 "일정 투표" 토글(MOIM-008)을 3-way 선택(segmented control / radio group, `name="kind"` → `"general"|"date"|"place"`)으로 대체한다. `multiSelect` 토글은 날짜/장소 투표와 공존 가능하다("가능한 장소" 다중 선택 — finalize 는 여전히 단일 최다 득표).
- (State-driven, 장소 표시) **WHILE** 한 poll 의 `kind` 가 `"place"` 인 동안, **the web app shall** 각 옵션을 그 옵션의 `label`(장소명) 텍스트로 렌더한다(날짜 포맷 없음 — 날짜 포맷은 `kind="date"` 옵션에만 적용) — `closesAt`/마감됨/내 표 강조/득표 막대는 MOIM-005/006/007/008 그대로.
- (State-driven, 확정 힌트) **WHILE** 한 장소 poll 이 열려 있는 동안, **the web app shall** "마감하면 최다 득표 장소가 모임 장소로 확정돼요" 안내를 표시해, 마감이 장소 확정을 일으킴을 알린다(날짜 투표는 일정 확정 힌트(MOIM-008), 일반 투표는 힌트 없음).
- (Event-driven, finalize 갱신) **WHEN** 생성자가 장소 poll 을 "마감하기" 로 닫으면, **the web app shall** `POST .../close` 를 Server Action 으로 호출하고 성공 시 상세를 재검증(`revalidatePath`)해 **그 poll(마감됨)** 과 **모임 헤더의 장소(`location`)** 가 둘 다 갱신되게 한다(close 가 finalize 한 location 이 다음 fetch 에 반영). 모임 헤더는 이미 MOIM-004 가 `moim.location` 을 렌더하므로, 추가 렌더 코드 없이 재검증으로 갱신됨을 확인한다. (다른 멤버에게는 MOIM-009 realtime 트리거가 poll 변경을 전파한다 — 본 SPEC 추가 배선 없음.)
- (State-driven, 동점 notice) **WHILE** close 응답이 `finalizeSkippedReason = "tie"` 인 동안, **the web app shall** 장소가 확정되지 않았음을(동점) 안내한다("동점이라 장소가 자동 확정되지 않았어요" 류). `"no_votes"` 면 그에 맞는 안내를 표시할 수 있다(또는 일반화). 단일 승자(`finalizedLocation != null`)면 장소가 확정됐음이 헤더 갱신으로 드러난다.
- (Unwanted behavior) **IF** 생성/마감이 백엔드 오류(400/403/404/네트워크)를 반환하면, **then the web app shall** 폼/화면에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 재시도할 수 있게 한다(미지 kind 400, 비생성자 마감 403 포함).
- (Ubiquitous) **The web app shall** 장소 투표 UI(투표 종류 3-way 선택·텍스트 옵션 입력·확정 힌트·동점 notice)를 Meetup 디자인 시스템(`(main)/home/[id]` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 MOIM-005/006/007/008 이 만든 poll 도메인을 확장한다. 파일·라인은 작성 시점(2026-06-22) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/prisma/schema.prisma` 전체 — **무변경**. `Poll.kind`(string `@default("general")`, MOIM-008)에 `"place"` 는 새 VALUE 일 뿐이라 스키마 파일을 건드리지 않는다. `Moim.location`(String?, MOIM-004)·`PollOption.optionDate`(MOIM-008)·`PollVote` PK 모두 그대로 재사용. **신규 컬럼/마이그레이션 없음.**
- `apps/backend/src/moim/moim.service.ts` `assertMember`/`createMoim`(location 쓰기 경로)/`getMoim`/`setStartsAt`(MOIM-008) — 보존. 신규 `setLocation` 메서드만 추가([ADD]) — finalize 가 호출하는 location 쓰기 단일 출처.
- `apps/backend/src/poll/poll.service.ts` 의 `createPoll`(트랜잭션 + kind/optionDate)·`vote`(마감 검사 409 + multiSelect 분기)·`aggregatePolls`(voteCount/myVotes/closesAt/isClosed/kind/optionDate) — **보존**. closePoll 의 finalize 분기에 `kind="place"` 케이스만 추가([MODIFY] 내부). create/vote/aggregate 무변경(장소 옵션은 일반과 동일 경로).
- `apps/backend/src/poll/poll.controller.ts` 의 기존 라우트(POST 생성 / GET 목록 / POST :pollId/vote / POST :pollId/close)·가드·`requireNonEmpty`/`normalizeOptions`/`parseClosesAt`/`parseOptionDates` 헬퍼·400/403/404/409 정책 — 보존. `parseKind` 가 `"place"` 허용, create 의 kind 분기가 place→normalizeOptions 경로, close 응답이 finalizedLocation 만 추가([MODIFY]).
- `apps/backend/src/poll/poll.service.ts` 의 `closePoll` 의 `kind="date"` → setStartsAt 분기(MOIM-008) — **보존**(무변경). `kind="place"` → setLocation 분기만 추가.
- `apps/web/app/(main)/home/[id]/poll-actions.ts` 의 `voteAction`/`closePollAction`(세션·revalidatePath)·`toIsoOrUndefined`·`requireToken` — 보존. `createPollAction` 이 kind="place" 읽기(텍스트 옵션, ISO 변환 없음)만 추가하고, `closePollAction` 이 close 결과의 finalizedLocation 을 상태로 전달([MODIFY] 내부).
- `apps/web/app/(main)/home/[id]/page.tsx` 의 헤더 location 렌더(`moim.location`, MOIM-004)·polls fetch·`currentUserId`/`accessToken` 전달 — **무변경**. finalize 된 location 은 close 후 revalidatePath 가 page 를 재렌더하면서 자동 반영된다(추가 렌더 코드 없음 — 확인만).
- `apps/mobile/**` — **모바일 무변경**. 장소 투표 UI 는 `/home/[id]` 안에서 in-WebView 로 렌더되고, 상세 라우트 네이티브 push 는 SPEC-MOIM-003 계약이 처리한다. 신규 네이티브 코드 없음.
- **realtime(SPEC-MOIM-009)** — **무변경**. poll/poll_vote 트리거가 kind 와 무관하게 모든 poll close/vote 에 `'poll_change'` 를 이미 브로드캐스트하므로 장소 투표 마감도 그대로 전파된다. 트리거/구독/payload 변경 없음(확인만).

### [MODIFY] (수정)

- `apps/backend/src/poll/dto/create-poll.dto.ts` — `kind?: string` 의 `@ApiProperty` enum 을 `['general','date','place']` 로 확장 + description 갱신("place" 면 옵션이 자유 텍스트 장소명).
- `apps/backend/src/poll/dto/poll-response.dto.ts`:
  - `PollResponseDto` — `finalizedLocation: string | null`(`@ApiProperty({ nullable: true, type: String, description: 'close 시 단일 승자 확정된 모임 장소(그 외 null)' })`) 추가. `kind` 의 enum 을 `['general','date','place']` 로 확장. 기존 `finalizedStartsAt`/`finalizeSkippedReason`/`optionDate`/multiSelect/myVotes/closesAt/isClosed/options 보존.
- `apps/backend/src/poll/poll.service.ts`:
  - `PollWithResults` 인터페이스 — (close 결과용) `finalizedLocation: string | null` 추가(목록/투표 응답에선 null). 기존 `kind`/옵션 `optionDate`/`finalizedStartsAt`/`finalizeSkippedReason` 보존.
  - `closePoll(sub, moimId, pollId)` — MOIM-007/008 그대로 마감(assertMember → poll 일관성 404 → 생성자 403 → closesAt=now) 후 finalize 분기에 케이스 추가: `kind="date"` → setStartsAt(winner.optionDate)[MOIM-008, 무변경]; **`kind="place"` → 단일 최다 득표 옵션 판정 → 단일 승자면 `moim.setLocation(moimId, winner.label)` 호출 + finalizedLocation 설정 / 동점 → 'tie' / 무표 → 'no_votes'**[신규]; 그 외(general) → finalize 없음. 집계 결과에 finalizedLocation 실어 반환(date/general 은 null).
  - `aggregatePolls` — 각 poll/옵션 map 에 `finalizedLocation: null` 추가(목록/투표 응답 — finalize 는 close 에서만). kind/optionDate/voteCount/myVotes/closesAt/isClosed/finalizedStartsAt/finalizeSkippedReason 무변경.
  - `createPoll` — **무변경**(장소 옵션은 일반 투표와 동일 경로 — 컨트롤러가 normalizeOptions 로 label 만 전달, optionDate 빈 배열).
- `apps/backend/src/poll/poll.controller.ts`:
  - `parseKind` — `"place"` 를 허용 값에 추가(`value === 'general' || value === 'date' || value === 'place'`). 미지 값은 여전히 400.
  - `create` — kind="place" 면 `normalizeOptions(body?.options)`(일반과 동일 — 날짜 파싱 안 함), optionDates 빈 배열. kind="date" 는 MOIM-008 그대로, kind="general" 도 그대로.
  - `close` — `closePoll` 결과를 `closeResultToDto` + finalizedLocation 매핑.
  - `newPollToDto`/`resultToDto`/`closeResultToDto` — `finalizedLocation`(closeResultToDto 는 service 값, newPoll/vote/list 는 null) 매핑.
- `packages/api-client/src/index.ts` — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지(주석 갱신 — kind "place" + finalizedLocation 추가). 재생성으로 underlying schema 가 바뀐다.
- `packages/api-client/src/schema.d.ts` — `nx run api-client:generate` 재생성(kind "place" + finalizedLocation 반영). 수동 편집 없음.
- `apps/web/lib/moim/polls.ts` — `PollWithResults` 타입의 `kind` 를 `"general" | "date" | "place"` 로 확장 + close 결과 타입(또는 PollWithResults 확장)에 `finalizedLocation: string | null` 추가(`finalizedStartsAt`/`finalizeSkippedReason` 은 MOIM-008 그대로). `createPoll`/`closePoll` 헬퍼 시그니처 무변경(CreatePollRequest 가 kind 포함, closePoll 반환에 finalizedLocation 포함).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` — `createPollAction` 이 FormData 에서 `kind`(3-way 선택)를 읽고, kind="place" 면 옵션(`option[]`)을 텍스트 그대로 전달(ISO 변환 없음 — kind="date" 만 toIsoOrUndefined). `closePollAction` 이 close 결과의 `finalizedLocation` 을 상태로 돌려줘 동점/확정 notice 를 띄울 수 있게 한다(`finalizedStartsAt`/`finalizeSkippedReason` 은 MOIM-008 그대로, `voteAction` 무변경).
- `apps/web/app/(main)/home/[id]/polls-section.tsx`:
  - `OptionRow`/`PollCard` — `kind` 분기 확장: 장소 투표면 옵션 라벨을 `label`(장소명) 텍스트로 렌더(날짜 포맷 없음 — date 만 포맷). 열린 장소 투표에 "마감하면 최다 득표 장소가 모임 장소로 확정돼요" 힌트. 마감/내 표/득표 막대는 MOIM-005/006/007/008 그대로.
  - `PollCard` close 핸들러 — `closePollAction` 결과의 `finalizeSkippedReason` 으로 동점/무표 notice 표시(date/place 공통 — notice 문구는 일반화하거나 place-specific).
  - `CreatePollForm` — 기존 이진 "일정 투표"(name="kind") 토글을 **3-way 선택**(일반 / 날짜 / 장소, segmented control 또는 radio group, `name="kind"` → `"general"|"date"|"place"`)으로 대체. "날짜" 면 옵션 입력 `datetime-local`(MOIM-008), "장소"/"일반" 이면 text. multiSelect 토글과 공존.

### [ADD] (신규)

- `apps/backend/src/moim/moim.service.ts` — `setLocation(moimId, location: string)` 메서드(location 쓰기 단일 출처 — finalize 가 호출, MOIM-008 의 `setStartsAt` 미러).
- `apps/web/lib/moim/polls.ts` — close 결과의 `finalizedLocation` 필드(PollWithResults 확장 또는 별도 close 결과 타입 — MOIM-008 의 finalize 필드에 합류).

### [BREAK] (의도적 호환성 단절)

- **읽기 모델에 `finalizedLocation` 추가 + `kind` enum 에 "place" 추가**: PollResponseDto·api-client `PollResponse`·web `PollWithResults` 가 새 필드(finalizedLocation)와 새 kind 값("place")을 얻는다. 이는 기존 필드를 제거하지 않는 **순수 추가**라 기존 소비처는 컴파일을 깨지 않는다(읽기 측 호환 — MOIM-008 의 finalize 필드 추가와 동일 형태). 다만 web `PollWithResults` 미러 타입과 그 매핑은 새 필드를 함께 채워야 하며 tsc 게이트로 누락을 차단한다. kind union 확장(`"general"|"date"` → `"general"|"date"|"place"`)은 narrowing 분기를 가진 코드(switch/if)가 새 값을 처리하도록 요구하나, 기존 분기는 그대로 동작한다(추가형 break).

### [REMOVE]

- 없음(kind VALUE/필드 추가 — 테이블·라우트·파일·필드·컬럼 삭제 없음, 마이그레이션 없음). 웹의 이진 "일정 투표" 토글은 3-way 선택으로 **대체**되지만 이는 UI 위젯 교체이지 기능 제거가 아니다(날짜 투표 경로 보존).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **일정(startsAt) auto-finalize 재구현** — 일정 자동 확정은 MOIM-008 이 이미 구현했다(날짜 투표 → `Moim.startsAt`). 본 SPEC은 장소(location) 자동 확정만 추가한다(date→startsAt 경로 무변경 — 회귀 보존만).
- **date + place 한 투표 결합** — 한 poll 은 한 kind 다(`"general"|"date"|"place"` 중 하나). 한 투표에서 날짜와 장소를 동시에 결정하는 복합 투표는 범위 밖. 일정 투표와 장소 투표는 별개 poll 로 만든다.
- **지도 / 지오코딩 / 장소 피커** — `Moim.location` 은 자유 텍스트(MOIM-004 의 location 필드와 동일)이고 장소 옵션도 자유 텍스트 장소명이다. 지도 좌표, 주소 검색, 장소 자동완성, 지오코딩은 범위 밖. 승자 label 이 그대로 location 문자열이 된다.
- **passive deadline-pass auto-finalize** — finalize 트리거는 **생성자 수동 마감(`POST .../close`)** 뿐이다(MOIM-008 승계). closesAt 시각이 그냥 지나는 것(passive)은 finalize 를 일으키지 않는다 — read 시 `isClosed: true` 로만 보이고, 장소 확정은 일어나지 않는다(생성자가 명시적으로 close 해야 함). 크론/스케줄러로 closesAt 도달을 감지해 finalize 하는 배선은 범위 밖.
- **크론 / 스케줄러** — 마감 시각 도달을 백그라운드로 감지해 자동 마감·자동 finalize 하는 잡(NestJS @Cron 등)은 범위 밖. finalize 는 동기 close 핸들러 안에서만.
- **reopen / un-finalize / 장소 확정 취소** — finalize 후 `Moim.location` 을 되돌리거나 마감을 해제하는 기능은 범위 밖. finalize 는 일방향이다(MOIM-007/008 reopen 제외와 일관). 향후.
- **finalize 후 수정(edit-after-finalize)** — 확정된 location 을 장소 투표 재마감으로 다른 장소로 다시 덮는 시나리오는 동작상 가능하지만(생성자가 reopen 없이 새 투표를 만들어야 함), 같은 닫힌 poll 을 다시 열어 재확정하는 UI/경로는 범위 밖.
- **realtime 신규 배선** — finalize·장소 확정의 실시간 전파는 **SPEC-MOIM-009 가 이미 처리한다**. poll/poll_vote 트리거가 kind 와 무관하게 모든 poll close/vote 에 `'poll_change'` 를 브로드캐스트하므로 장소 투표 마감도 다른 멤버에게 그대로 전파된다 — 본 SPEC은 트리거/구독/payload 를 변경하지 않는다(확인만). 모임 헤더 location 자체의 실시간 갱신은 MOIM-009 가 poll 변경 신호로 상세를 재조회하게 하는 기존 경로에 의존한다.
- **비생성자 finalize** — finalize 는 close 핸들러 안에서만 일어나고 close 는 생성자 전용(MOIM-007)이므로, 비생성자/비멤버는 finalize 에 도달하지 못한다(403). owner-도-finalize 같은 확장은 향후.
- **모바일 신규 코드** — 장소 투표 UI 는 웹 상세가 소유하고 모바일 WebView 안에서 렌더된다. expo-router 네이티브 라우트/컴포넌트를 추가하지 않는다(SPEC-MOIM-003 계약 재사용).
- **kind 의 DB enum 제약** — `kind` 는 string `@default` 컬럼이며 허용 값 검증("general"/"date"/"place")은 컨트롤러가 한다(미지 값 400). Prisma enum / DB CHECK 제약으로 강제하지 않는다(MOIM-008 의 enum 회피 그대로 — `"place"` 추가에 DDL 불필요).
- **마이그레이션 / 스키마 변경** — 본 SPEC은 DB 스키마를 전혀 바꾸지 않는다. `Poll.kind` 는 기존 string 컬럼이고 `"place"` 는 새 값일 뿐이며 `Moim.location` 은 이미 존재한다(MOIM-004). 신규 컬럼·테이블·인덱스·migration 디렉터리 없음.

---

## 5. 설계 노트 (Design Notes)

### kind 에 "place" 값 추가 (마이그레이션 없음 — 핵심 단순화)

- `Poll.kind` 는 `String @default("general")` 컬럼이다(MOIM-008 — Prisma enum 아님). `"place"` 는 이 string 컬럼이 받는 **허용 값이 하나 늘어나는 것일 뿐**이라 DB 스키마/마이그레이션이 전혀 바뀌지 않는다 — MOIM-008 이 enum 을 피하고 string `@default` 를 택한 결정이 정확히 이 확장을 무비용으로 만든다(enum 이었다면 `ALTER TYPE ... ADD VALUE` 마이그레이션이 필요했을 것). 허용 값 검증은 컨트롤러 `parseKind` 가 `"place"` 를 받아들이도록 한 줄 확장하는 것으로 끝난다(미지 값은 여전히 400).
- 본 SPEC은 MOIM-008 보다 단순하다: MOIM-008 은 `Poll.kind` + `PollOption.optionDate` 두 컬럼을 additive 추가했지만, 본 SPEC은 **컬럼을 하나도 추가하지 않는다**(`Moim.location` 도 이미 존재).

### 장소 옵션 = 자유 텍스트 label (optionDate 안 씀 — date 와의 결정적 차이)

- 날짜 투표(date)는 옵션이 시각이라 `PollOption.optionDate`(Date) 컬럼이 필요했지만(label=ISO 정규, optionDate=Date 출처), 장소 투표(place)는 옵션이 **장소명**이라 `Moim.location`(String)에 그대로 매핑된다 — 별도 시각/구조 컬럼이 필요 없다. 따라서 장소 옵션은 일반 투표 옵션과 **정확히 동일하게** `normalizeOptions`(trim, 비지 않은 항목 ≥2)로 검증·저장하고 `optionDate=null` 이다.
- 승자 판정·finalize 는 `PollOption.label`(장소명)을 출처로 쓴다 — date 가 optionDate(Date 컬럼)를 쓰는 것과 대칭. label 은 이미 사람이 읽을 수 있는 장소명이므로 웹이 포맷 없이 그대로 렌더한다(date 옵션만 날짜 포맷이 필요).

### finalize 분기 = kind 로 갈림 (date→startsAt, place→location, general→없음)

- `closePoll` 의 finalize 블록은 MOIM-008 이 `if (poll.kind === 'date')` 로 startsAt 을 확정하게 만들었다. 본 SPEC은 이 블록에 `kind === 'place'` 케이스를 더해 location 을 확정한다 — date 분기는 무변경, place 분기는 `winner.label` 을 `setLocation` 으로 쓴다. general 은 어느 분기에도 안 들어가 finalize 없음.
- finalize 트리거(생성자 manual close)·승자 판정(단일 최다 득표)·동점/무표 스킵·기존 값 덮어쓰기·close 응답 finalizeSkippedReason 은 모두 MOIM-008 의 확정 결정을 **그대로 승계**한다(재논의 없음) — 본 SPEC은 "확정 대상"만 startsAt 에서 location 으로 바꾼 평행 케이스다.

### 승자 = 단일 최다 득표 (동점·무표 스킵 — MOIM-008 승계)

- 승자 판정: 옵션별 voteCount 를 집계해 최대값(top)을 구한다. top voteCount 를 가진 옵션이 **정확히 1개**면 그 옵션이 승자 → `Moim.location = winner.label`. top 을 **2개 이상**이 공유하면 동점 → finalize 스킵(`"tie"`). 모든 옵션이 0표면(top=0) 무표 → 스킵(`"no_votes"`).
- 동점·무표에서 finalize 를 강제로 하지 않는 이유: 자의적 tie-break 는 사용자가 의도하지 않은 장소를 확정시킬 위험이 있다 — 차라리 location 을 그대로 두고 생성자에게 동점을 알려 사람이 결정하게 한다(MVP 안전 기본값 — MOIM-008 과 동일 논리).
- 다중 선택(multiSelect=true) 장소 투표도 동일하다 — 멤버가 여러 장소를 골라도 finalize 는 옵션별 voteCount 의 단일 최다만 본다(동점이면 스킵).
- **덮어쓰기**: 단일 승자면 기존 `Moim.location`(MOIM-004 생성 시 정했거나 이전 finalize 값)을 덮어쓴다 — finalize 가 확정 시점이기 때문이다. 의도된 동작이지 데이터 손실이 아니다.

### location 쓰기 단일 출처 = MoimService.setLocation (신규)

- 현재 `Moim.location` 쓰기 경로는 `MoimService.createMoim`(생성 시 optional location) 하나뿐이다. finalize 가 PollService 에서 직접 `prisma.moim.update` 하면 location 쓰기가 두 곳으로 흩어진다 — MOIM-008 이 `setStartsAt` 을 추가해 startsAt 쓰기를 모은 패턴을 location 에 미러해, 신규 `MoimService.setLocation(moimId, location)` 를 추가하고 PollService.closePoll 이 이를 호출한다.
- `setLocation` 은 인가를 다시 하지 않는다(closePoll 이 이미 assertMember + 생성자 검사를 통과시킴) — 순수하게 location 만 갱신하는 도메인 쓰기다(setStartsAt 과 동일 계약). moim 존재는 poll.moimId 가 보장한다(close 가 이미 poll-moim 일관성 검증).

### close 응답 shape = 단건 poll + finalize 3필드

- close 응답은 기존 단건 poll 결과(MOIM-007) + MOIM-008 의 `finalizedStartsAt` + `finalizeSkippedReason` 에 `finalizedLocation: string|null` 한 필드를 더한 **확장 PollResponseDto** 다. `finalizedStartsAt` 과 `finalizedLocation` 은 상호 배타적으로 채워진다(한 poll 은 한 kind — date close 는 startsAt, place close 는 location, 둘이 동시에 비-null 이 되지 않는다). 별도 wrapper 를 만들지 않는 이유는 MOIM-008 과 동일하다 — 웹이 close 후 그 단건 poll(마감됨)과 확정/동점 여부만 알면 되고, 모임 헤더 location 은 revalidatePath 가 page 재렌더로 가져온다.
- vote/list 응답에서는 finalize 3필드를 항상 `null` 로 채운다(finalize 는 close 에서만) — DTO 는 공유하되 값 의미는 라우트가 정한다(MOIM-008 동일).

### 웹 — 장소 투표 렌더 + 장소 확정 갱신 + 3-way 선택

- `CreatePollForm` 의 기존 이진 "일정 투표" 토글(MOIM-008 — on=date)을 **3-way 선택**(일반 / 날짜 / 장소, `name="kind"`)으로 대체한다. segmented control 또는 radio group 으로 "일반"|"날짜"|"장소" 중 하나를 고른다. "날짜" 면 옵션 입력을 `datetime-local`(MOIM-008), "장소"/"일반" 이면 text 로 둔다. `createPollAction` 이 kind="date" 만 ISO 변환하고 place/general 은 텍스트 그대로 전달. multiSelect 토글과 공존.
- `PollCard` 가 `poll.kind === "place"` 면 옵션 라벨을 `label`(장소명) 텍스트로 렌더(날짜 포맷 없음 — date 만 포맷), 열린 장소 투표에 확정 힌트("마감하면 최다 득표 장소가 모임 장소로 확정돼요") 표시. date 투표는 MOIM-008 의 날짜 포맷 + 일정 확정 힌트를 그대로 쓴다.
- close 후: `closePollAction` 이 close 결과의 `finalizedLocation`/`finalizeSkippedReason` 를 돌려준다 — `finalizeSkippedReason === "tie"` 면 동점 notice, 단일 승자(`finalizedLocation != null`)면 별도 notice 없이 헤더 갱신으로 확정이 드러난다. `revalidatePath("/home/{id}")` 가 poll(마감됨)과 모임 헤더 location 을 둘 다 재렌더한다(page.tsx 가 이미 location fetch + 헤더 렌더 — 추가 코드 없음). 다른 멤버에게는 MOIM-009 realtime 이 poll 변경을 전파한다.

### realtime — MOIM-009 가 이미 처리 (신규 배선 없음)

- MOIM-009 의 poll/poll_vote DB 트리거는 kind 를 보지 않고 모든 poll close/vote 에 `'poll_change'` 를 브로드캐스트한다 — 장소 투표 마감도 트리거를 그대로 발화하므로 다른 멤버의 화면이 갱신된다. 본 SPEC은 트리거 함수·구독·payload 를 변경하지 않는다(확인만). 따라서 장소 투표 추가는 realtime 측에 어떤 코드 변경도 요구하지 않는다.

### 디자인

- 장소 투표 UI 모두 `(main)/home/[id]` Meetup 오렌지 토큰 사용. 투표 종류 3-way 선택은 segmented control/radio group(`border-border`/`bg-background` + `accent-primary`/`bg-primary text-primary-foreground` 선택 상태), 확정 힌트는 `text-primary` 강조 한 줄, 동점 notice 는 `text-muted-foreground`/절제된 alert. login/onboarding blue 미사용.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 장소 투표를 date 로 오인 파싱 | HIGH | kind="place" 옵션을 날짜로 파싱하면(parseOptionDates) 자유 텍스트 장소명이 무효 ISO 400 으로 거부됨. create 분기를 `kind === 'date'` 만 parseOptionDates, place/general 은 normalizeOptions 로 엄격히 가른다. jest: place 텍스트 옵션 → normalizeOptions 저장(label, optionDate null)으로 고정. |
| 일반/날짜 투표를 location finalize | HIGH | kind="general"/"date" close 가 location 을 건드리면 오염. closePoll 의 location finalize 분기를 `poll.kind === 'place'` 로 엄격히 가드(date 는 startsAt 분기 그대로). jest: 일반/날짜 투표 close → location 불변 + finalizedLocation null 회귀로 고정. |
| date finalize 회귀 | HIGH | place 분기 추가가 기존 date→startsAt finalize(MOIM-008)를 깨면 일정 자동화 회귀. date 분기 무변경 보존 + jest: 날짜 투표 close → startsAt 여전히 확정(finalizedStartsAt) + finalizedLocation null 회귀로 고정. |
| 동점/무표 finalize 오작동 | HIGH | 동점인데 자의적 옵션을 location 으로 확정하면 잘못된 장소. 승자 판정을 strictly-highest 단일로 고정(MOIM-008 승계) — top 공유 ≥2 → tie 스킵, 모두 0 → no_votes 스킵, 단일만 finalize. jest: 단일→location 설정 / 동점→불변+tie / 무표→불변+no_votes. |
| 비생성자 finalize | MEDIUM | finalize 가 close 밖으로 새면 아무 멤버나 장소를 확정. finalize 는 closePoll 핸들러 안에서만(close 는 MOIM-007 생성자 전용 — assertMember 403 → poll 404 → 생성자 403). jest: 비생성자 close 403 → finalize 미실행 + location 불변으로 고정. |
| location 쓰기 경로 분산 | MEDIUM | finalize 가 직접 prisma.moim.update 하면 createMoim 외 두 번째 location 쓰기로 드리프트. `MoimService.setLocation` 단일 메서드로 모으고 closePoll 이 호출(setStartsAt 미러). tsc/jest 로 경로 확인. |
| 기존 location 덮어쓰기 | LOW | finalize 가 기존 location(생성 시 값/이전 finalize)을 덮음. 의도된 동작(확정 시점) — 데이터 손실 아님. AC/jest 로 덮어쓰기 명시 고정. |
| 읽기 모델 추가 누락 소비처 | LOW | finalizedLocation/kind "place" 는 순수 추가(제거 아님)라 기존 소비처는 안 깨진다. 다만 web PollWithResults 미러·close 결과 타입·kind 분기가 새 필드/값을 처리해야 함 — tsc 게이트로 누락 차단. |
| 멤버 스코핑 약화 | MEDIUM | poll service 진입(create/vote/list/close)이 첫 줄 assertMember 호출 보존(MOIM-005~008). 통합 테스트 403 케이스로 고정. kind "place" 추가가 인가에 영향 없음. |
| 3-way 선택 회귀(날짜 토글 대체) | MEDIUM | 이진 토글 → 3-way 선택 교체가 기존 날짜 투표 생성 흐름을 깨면 MOIM-008 회귀. "날짜" 선택이 datetime-local 옵션 + ISO 변환을 그대로 유지하는지 확인(웹 빌드/추론 + 디바이스). |
| 디자인 토큰 혼선(blue vs orange) | LOW | 3-way 선택·텍스트 옵션·확정 힌트 추가 시 blue 복사 위험. REQ-MOIM10-007 로 오렌지 강제, 코드 리뷰. |
| realtime 영향 오인 | LOW | 장소 투표가 realtime 변경을 요구한다고 오해하면 불필요 배선. MOIM-009 트리거가 kind 무관 발화함을 확인(트리거 무변경) — 본 SPEC realtime 코드 없음. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 jest(장소 투표 신규 + location finalize + 일반/날짜/마감 회귀). api-client 는 tsc. 모바일은 본 SPEC에서 무변경(회귀 0 확인용 tsc/vitest/expo export).

- **마이그레이션 없음** — 본 SPEC은 DB 스키마를 변경하지 않는다. `Poll.kind`(string `@default("general")`, MOIM-008)는 `"place"` 를 새 VALUE 로 받을 뿐이고, `Moim.location`(MOIM-004)·`PollOption.optionDate`(MOIM-008)·`PollVote` PK 는 모두 기존 그대로다. `prisma migrate status` 는 신규 migration 없이 clean(스키마 파일 무변경 — DDL 불필요). enum 회피(MOIM-008)가 `"place"` 추가를 무비용으로 만든다.
- backend jest 통과 — 신규: 장소 투표 생성(kind="place" + 텍스트 옵션 → label 저장, optionDate null) + 미지 kind 400 + close finalize 단일 승자 → Moim.location 설정(finalizedLocation 반영) + 동점 → 스킵(location 불변 + finalizeSkippedReason "tie") + 무표 → 스킵(불변 + "no_votes") + 일반 투표 close → location finalize 안 함(location 불변 + finalizedLocation null) + **날짜 투표 close → startsAt 여전히 확정(MOIM-008 회귀, finalizedStartsAt) + finalizedLocation null** + 기존 location 덮어쓰기 + 비생성자 close 403(finalize 미실행) + setLocation 단일 출처 호출; 회귀: 일반 투표 생성/투표(MOIM-005/006) + 날짜 투표 생성·finalize(MOIM-008) + 마감 vote 409(MOIM-007) + closesAt 옵트인 + question 빈/옵션<2 400 + 비멤버 403 + 다른 모임 pollId 404.
- `tsc` 통과 (0 error — backend + web + api-client; finalizedLocation 추가 + kind "place" union 확장 + PollWithResults 미러 + close 결과 타입 확인).
- web lint 통과 (0 error).
- `nx run web:build` 통과 (0 error — 투표 종류 3-way 선택 + 텍스트/날짜 옵션 분기 + 장소 옵션 텍스트 렌더 + 확정 힌트/동점 notice 컴파일).
- mobile tsc / vitest / `expo export` 통과 (무변경 회귀 0).
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 모임 상세 진입 → 투표 종류 "장소" 선택 후 장소 옵션 ≥2 로 투표 생성 → 옵션이 장소명 텍스트로 보이고 확정 힌트 표시 → 멤버들이 장소에 투표 → 생성자가 "마감하기" → 단일 승자면 모임 헤더 장소(location)가 그 장소로 확정 갱신, 동점이면 동점 notice + 장소 불변 확인이 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated — Server Action `revalidatePath` 가 WebView 안에서 poll 마감 AND 모임 헤더 location 을 둘 다 갱신하는지, MOIM-009 realtime 이 다른 멤버에게 전파되는지 확인). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
