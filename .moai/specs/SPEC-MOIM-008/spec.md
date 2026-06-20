---
id: SPEC-MOIM-008
version: 0.1.0
status: draft
created: 2026-06-21
updated: 2026-06-21
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-008: 일정 투표 자동 확정 — 날짜 투표 마감 시 승자 → Moim.startsAt

## HISTORY

- 2026-06-21 (v0.1.0): 최초 draft. SPEC-MOIM-007(투표 마감 — deadline + 수동 마감, 구현 완료·라이브 검증)의 직속 후속. MOIM-007 가 만든 마감(`Poll.closesAt` + 생성자 전용 `POST .../close` + vote 409)을 verified 기준으로 확장한다. MOIM-007 §4 가 명시적으로 카브아웃한 **auto-finalize(승자 자동 반영 → `Moim.startsAt`)** 한 항목만 채워 이벤트 트라이어드(투표 → 일정 자동화) 루프를 닫는다. **WHY**: 모임 투표의 가장 흔한 실무는 "언제 모일까"를 날짜 후보로 올려 투표하는 것이고(MOIM-006 다중 선택 안내가 이미 "가능한 날짜" 를 가리킨다), 마감 시 최다 득표 날짜는 곧 모임 일정이어야 한다 — 그런데 MOIM-007 의 마감은 투표를 닫기만 할 뿐 결과를 일정에 반영하지 않아, 생성자가 승자를 보고 `Moim.startsAt` 을 손으로 다시 맞춰야 했다. 본 SPEC은 그 마지막 한 걸음을 자동화한다: **날짜 투표**를 마감하면 단일 최다 득표 옵션의 날짜가 그 모임의 `startsAt` 으로 자동 확정된다. **핵심 결정**: (1) **전용 날짜-투표 타입** — `Poll.kind String @default("general")`(string 컬럼, Prisma enum 아님 — `CREATE TYPE` 마이그레이션 마찰 회피, 컨트롤러가 `"general"|"date"` 검증·미지 값 400)로 일반 투표와 날짜 투표를 구분하고, `PollOption.optionDate DateTime? @map("option_date")`(nullable additive)로 날짜 옵션이 시각을 담는다. kind="date" 생성 시 `options: string[]` 는 ISO-8601 datetime 문자열을 싣고(웹 datetime-local → ISO), 백엔드가 각각 파싱(무효 ISO → 400)해 `optionDate = parsed`, `label = parsed.toISOString()`(정규 — 웹이 optionDate 를 포맷해 표시); kind="general"(또는 생략) 은 무변경(자유 텍스트 라벨, optionDate=null). 날짜 투표도 유효 옵션 ≥2 가 필요하다. (2) **finalize 대상 = `Moim.startsAt` 만**(MVP) — location auto-finalize 는 제외(§4, 향후). (3) **트리거 = 생성자 수동 마감만** — MOIM-007 의 `POST /moims/:id/polls/:pollId/close`(생성자 전용)를 확장: closesAt=now 설정 후 `poll.kind="date"` 면 승자 계산·finalize. **크론/스케줄러 없음.** passive deadline-pass(closesAt 시각 도달)는 finalize 하지 않는다 — closesAt<=now 는 read 시 isClosed true 로만 보이고, finalize 는 오직 명시적 생성자 close 핸들러에서만 일어난다. (4) **동점/덮어쓰기/무표** — 승자 = 단일 **최다 득표**(strictly-highest voteCount) 옵션. top voteCount 를 ≥2 옵션이 공유(동점)하면 → finalize 안 함(startsAt 불변), close 응답이 동점 스킵을 알린다. 0표면 → 승자 없음 → 스킵. 단일 승자가 있으면 → `Moim.startsAt = winner.optionDate` 로 **기존 startsAt 덮어쓰며** 설정(finalize = 확정 시점). finalize 는 생성자 전용(close 가 이미 생성자 전용 — 비생성자/비멤버는 403 으로 finalize 에 도달 못 함). (5) **close 응답 shape** — close 가 (기존 단건 poll 결과에 더해) `finalizedStartsAt: string|null`(확정된 ISO 또는 null) + `finalizeSkippedReason: "tie"|"no_votes"|null` 두 필드를 담아, 웹이 동점 notice 와 모임 헤더 startsAt 갱신을 처리한다(별도 wrapper 안 둠 — 기존 PollResponseDto 에 순수 추가, vote/list 응답에선 항상 null). **스코프 결정 기록**: (a) kind 는 string `@default` 컬럼(enum 아님 — 비파괴, 컨트롤러 검증); (b) optionDate nullable additive(날짜 옵션만 채움); (c) finalize 트리거는 생성자 manual close 만(passive deadline-pass·크론 제외); (d) 승자 = 단일 최다 득표(동점·무표 → 스킵, startsAt 불변); (e) startsAt 쓰기는 `MoimService.setStartsAt` 신규 메서드 1곳으로 모음(createMoim 외 유일 startsAt 쓰기 경로 — assertMember 단일 출처 패턴 미러); (f) location finalize·deadline-pass finalize·reopen·un-finalize·edit-after-finalize·realtime·모바일 코드·크론·타임존 정교화는 모두 **제외**(§4) — 향후.

---

## 1. 개요 (Overview)

SPEC-MOIM-005(단일 선택) → 006(다중 선택) → 007(마감)이 모임 투표를 단계적으로 키웠다. MOIM-007 은 마감(deadline + 수동 마감)을 더해 "언제까지 투표하세요" 와 "충분히 모였으니 일찍 닫자" 를 가능하게 했지만, **마감은 투표를 닫기만 할 뿐 결과를 일정에 반영하지 않는다**(MOIM-007 §4 가 auto-finalize 를 명시적으로 카브아웃). 모임 투표의 가장 흔한 형태 — "이번 주말 중 언제 모일까?" — 에서, 마감 후 최다 득표 날짜는 곧 모임 일정이다. 본 SPEC은 그 자동화를 채운다: **날짜 투표**를 생성자가 마감하면 단일 최다 득표 날짜가 그 모임의 `Moim.startsAt`(MOIM-004 가 추가한 이벤트 일정)으로 자동 확정된다.

본 SPEC의 자동 확정은 **전용 날짜-투표 타입** 위에 세운다:

1. **투표 종류(kind)** — `Poll.kind`(string, 기본 `"general"`)가 일반 투표(자유 텍스트 옵션, MOIM-005/006/007 그대로)와 **날짜 투표**(`"date"`, 각 옵션이 날짜/시각)를 구분한다. enum 이 아니라 string `@default` 컬럼이므로 기존 row 는 모두 `"general"` 로 비파괴 보존되고(별도 `CREATE TYPE` 마이그레이션 불필요), 컨트롤러가 허용 값(`"general"|"date"`)을 검증해 미지 값을 400 으로 거른다.
2. **옵션 날짜(optionDate)** — `PollOption.optionDate`(nullable)가 날짜 옵션의 시각을 담는다. 날짜 투표 생성 시 `options[]` 는 ISO-8601 datetime 문자열을 싣고(웹 datetime-local → ISO), 백엔드가 각각 파싱(무효 ISO → 400)해 `optionDate = parsed`, `label = parsed.toISOString()`(정규 — 웹이 optionDate 를 사람이 읽을 수 있게 포맷)로 저장한다. 일반 투표 옵션은 `optionDate = null`(MOIM-005/006/007 동작 그대로).
3. **자동 확정(finalize)** — 생성자가 **날짜 투표**를 수동 마감(MOIM-007 `POST .../close`)하면, closesAt=now 설정 후 승자(단일 최다 득표 옵션)의 `optionDate` 가 `Moim.startsAt` 으로 자동 설정된다(기존 startsAt 덮어씀 — 확정 시점). 트리거는 **생성자 수동 마감뿐**이다 — 크론/스케줄러 없고, passive deadline-pass(closesAt 시각이 그냥 지나는 것)는 finalize 하지 않는다(read 시 isClosed true 로만 보인다).
4. **동점/무표 — 스킵** — top voteCount 를 ≥2 옵션이 공유(동점)하거나 0표면 승자가 없어 finalize 를 건너뛴다(`Moim.startsAt` 불변). close 응답이 스킵 이유(`"tie"`/`"no_votes"`)를 담아 웹이 안내한다. 단일 승자일 때만 startsAt 을 설정한다.

데이터는 `moim`·`poll`·`poll_vote` 테이블의 기존 컬럼·관계·PK 를 건드리지 않고 **`Poll.kind`(string `@default("general")`) + `PollOption.optionDate`(nullable) 컬럼 2개 additive 추가**만 한다(기존 poll row 는 kind="general", 기존 option row 는 optionDate=null 로 보존). PK 변경 없음(MOIM-006 의 `(pollId,optionId,userId)` 그대로). 마이그레이션은 MOIM-005/006/007 과 동일한 **비파괴 패턴**(migrate diff → db execute → migrate resolve --applied → migrate status clean)으로 적용한다 — hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 `prisma migrate dev` 의 파괴적 reset 을 피한다.

`Moim.startsAt` 쓰기는 신규 `MoimService.setStartsAt` 메서드 **한 곳**으로 모은다(현재 `createMoim` 이 유일한 startsAt 쓰기 경로 — assertMember 단일 출처 패턴 미러). `PollService.closePoll` 이 finalize 시 이 메서드를 호출한다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 날짜 투표 UI(일정 투표 토글·datetime 옵션 입력·확정 힌트·동점 notice)는 모임 상세(`/home/[id]`) 안에서 in-WebView 로 렌더되므로 **모바일 신규 코드는 없다**.

이는 **컬럼 2개 additive + 날짜 투표 생성/검증 + close 시 단일 승자 finalize → startsAt + close 응답 2필드 + 웹 날짜 투표 UI** 이지 대형 기능이 아니다. location finalize·passive deadline finalize·reopen·un-finalize·edit-after-finalize·실시간·모바일 코드·크론·타임존 정교화는 모두 제외한다(§4).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 7개로 제한한다. 각 모듈은 `REQ-MOIM8-XXX`로 번호를 부여하며(기존 `REQ-MOIM5-XXX`/`REQ-MOIM6-XXX`/`REQ-MOIM7-XXX` 등과 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM8-001: 날짜 투표 데이터 모델 + 비파괴 마이그레이션 (Ubiquitous)

- **The backend shall** `Poll` 에 `kind String @default("general") @map("kind")` 컬럼을, `PollOption` 에 `optionDate DateTime? @map("option_date")` 컬럼을 **additive**(기존 컬럼·관계·인덱스·PK 무변경)로 추가한다 — `kind` 는 `@default("general")` 이라 기존 poll row 는 모두 `"general"`(일반 투표), `optionDate` 는 nullable 이라 기존 option row 는 모두 `null`(날짜 없음). MOIM-005/006/007 동작 보존.
- **The backend shall** `kind` 를 **string 컬럼**으로 두고 **Prisma enum 으로 두지 않는다** — `CREATE TYPE` 을 동반하는 enum 마이그레이션 마찰을 피하기 위함이다. 허용 값(`"general"|"date"`)의 검증은 컨트롤러가 명시적으로 하며(미지 값 → 400) DB 제약으로 강제하지 않는다(§5 표현 선택).
- **The backend shall** 이 변경을 **비파괴(데이터 보존) 마이그레이션**으로 적용한다 — `kind` 는 `@default` 가 있는 추가, `optionDate` 는 nullable 추가이므로 기존 row 갱신·재작성이 없고(`poll`/`poll_option`/`poll_vote` row 손실 0), `moim`/`moim_member`/`moim_invite`/`chat_message`/`poll_vote` 와 그 동작(생성·목록·상세·멤버·채팅·초대·단일/다중 투표·마감)은 어떤 회귀도 없이 보존된다.
- **The backend shall** `PollVote` 의 복합 PK `(pollId, optionId, userId)`(MOIM-006)와 모든 FK(cascade)·인덱스를 **그대로 보존**한다(날짜 투표 추가가 투표 표/Cascade/PK 에 영향 없음).
- **The backend shall** 비파괴 패턴(`prisma migrate diff` → `prisma db execute` → `prisma migrate resolve --applied` → `prisma migrate status` clean)으로 적용한다 — hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 `prisma migrate dev` 의 파괴적 reset 을 피한다(MOIM-005/006/007 선례).

### REQ-MOIM8-002: 날짜 투표 생성 — kind + optionDate (Event-driven / Unwanted behavior 혼합)

- (Event-driven, 날짜) **WHEN** 모임 멤버가 `{ question, options[], kind: "date", multiSelect?, closesAt? }` 로 `POST /moims/:id/polls` 를 호출하면(`options[]` 는 ISO-8601 datetime 문자열들), **the backend shall** 각 옵션을 날짜/시각으로 파싱해 `PollOption.optionDate = 파싱된 시각`, `PollOption.label = 파싱된 시각.toISOString()`(정규)로 저장하고 `Poll.kind = "date"` 로 생성한다(트랜잭션). 유효 옵션 ≥2 가 필요하다(일반 투표와 동일).
- (Event-driven, 일반) **WHEN** `kind` 가 생략되거나 `"general"` 이면, **the backend shall** MOIM-005/006/007 그대로 생성한다 — 옵션은 자유 텍스트 라벨, `optionDate = null`, `Poll.kind = "general"`(회귀 0). `multiSelect`/`closesAt` 옵트인도 그대로 동작한다.
- (Unwanted behavior) **IF** `kind` 가 `"general"`/`"date"` 외의 값이면, **then the backend shall** `400 Bad Request` 를 반환한다(허용 값 명시 검사 — DB enum 제약 부재 보완, MOIM-001/005 의 no-ValidationPipe 명시 검사 정책).
- (Unwanted behavior) **IF** `kind: "date"` 인데 어느 옵션이 유효한 날짜/시각으로 파싱되지 않으면(무효 ISO 문자열), **then the backend shall** `400 Bad Request` 를 반환한다(closesAt 무효 ISO 400 정책과 동일 — 날짜 옵션도 거른다).
- (Unwanted behavior) **IF** question 이 비었거나 유효 옵션이 2개 미만이면, **then the backend shall** `400 Bad Request` 를 반환한다(kind 추가가 question 빈/옵션<2 검증을 바꾸지 않는다 — 날짜 투표도 ≥2).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` 단일 출처 — 약화 금지).

### REQ-MOIM8-003: 날짜 투표 마감 시 자동 확정 — 단일 승자 → startsAt (Event-driven / State-driven 혼합)

- (Event-driven, finalize) **WHEN** **날짜 투표**(`poll.kind = "date"`)의 **생성자**가 `POST /moims/:id/polls/:pollId/close` 를 호출하면, **the backend shall** (MOIM-007 그대로) `closesAt = now` 로 마감한 **뒤**, 그 poll 의 옵션 중 **단일 최다 득표**(strictly-highest voteCount) 옵션이 존재하면 그 옵션의 `optionDate` 를 `Moim.startsAt` 으로 설정(기존 startsAt 덮어씀)하고, close 응답에 `finalizedStartsAt = 그 ISO`, `finalizeSkippedReason = null` 을 담는다.
- (State-driven, 동점) **WHILE** 마감하는 날짜 투표의 top voteCount 를 2개 이상의 옵션이 공유(동점)하는 동안, **WHEN** 생성자가 close 하면, **the backend shall** finalize 를 **건너뛰고**(`Moim.startsAt` 불변), close 응답에 `finalizedStartsAt = null`, `finalizeSkippedReason = "tie"` 를 담는다(마감 자체는 정상 — closesAt=now 설정됨).
- (State-driven, 무표) **WHILE** 마감하는 날짜 투표에 표가 하나도 없는 동안(모든 옵션 voteCount=0), **WHEN** 생성자가 close 하면, **the backend shall** finalize 를 **건너뛰고**(`Moim.startsAt` 불변), close 응답에 `finalizedStartsAt = null`, `finalizeSkippedReason = "no_votes"` 를 담는다.
- (Event-driven, 일반 투표) **WHEN** **일반 투표**(`poll.kind = "general"`)의 생성자가 close 하면, **the backend shall** MOIM-007 그대로 마감만 하고 finalize 를 수행하지 않는다 — close 응답에 `finalizedStartsAt = null`, `finalizeSkippedReason = null`(일반 투표는 finalize 대상이 아니므로 skip 이유도 없음).
- (Ubiquitous, 쓰기 단일 출처) **The backend shall** `Moim.startsAt` 쓰기를 신규 `MoimService.setStartsAt(moimId, startsAt)` 메서드 **한 곳**에서만 수행한다(현재 `createMoim` 이 유일한 startsAt 쓰기 경로 — finalize 가 직접 prisma 로 moim 을 갱신하지 않고 이 메서드를 호출한다, assertMember 단일 출처 패턴 미러).
- (Unwanted behavior) **IF** 요청 사용자가 생성자가 아니거나(403) 비멤버이거나(403) pollId 가 path 모임에 속하지 않으면(404), **then the backend shall** MOIM-007 의 인가/일관성 판정을 그대로 반환하며 finalize 에 도달하지 않는다(비생성자 finalize 차단 — close 가 이미 생성자 전용).

### REQ-MOIM8-004: 투표 목록 + 결과 조회 — kind + optionDate 노출 (Ubiquitous / Unwanted behavior 혼합)

- (Ubiquitous) **The `GET /moims/:id/polls` response shall** 각 poll 에 기존 필드(`id`/`question`/`createdBy`/`createdAt`/`multiSelect`/`closesAt`/`isClosed`/옵션 배열/`myVotes`)에 더해 **`kind`(`"general"|"date"`)** 를 포함하고, 각 옵션에 **`optionDate`(ISO-8601 문자열 또는 `null`)** 를 포함한다.
- (Ubiquitous) **The backend shall** 일반 투표 옵션에는 `optionDate = null` 을, 날짜 투표 옵션에는 그 옵션의 ISO 시각을 반환한다 — 웹이 날짜 투표 옵션을 사람이 읽을 수 있게 포맷하는 출처다(raw ISO 직접 노출 대신).
- (Ubiquitous) **The backend shall** 마감/finalize 여부와 무관하게 옵션별 `voteCount`(표 0 포함)와 호출자 `myVotes`(목록)를 정확히 반환한다 — 마감된 날짜 투표도 결과(승자 포함)는 항상 조회 가능하다.
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember`).
- (Ubiquitous) **The backend shall** poll 이 하나도 없는 모임에 대해 **빈 배열**을 반환한다(에러 아님).

### REQ-MOIM8-005: close 응답 — finalize 결과 노출 (Ubiquitous)

- **The `POST /moims/:id/polls/:pollId/close` response shall** 기존 단건 poll 결과(MOIM-007 — 집계 + closesAt + isClosed=true)에 더해 **`finalizedStartsAt`(ISO-8601 문자열 또는 `null`)** 와 **`finalizeSkippedReason`(`"tie"|"no_votes"|null`)** 를 포함한다.
- **The backend shall** `finalizedStartsAt` 를 단일 승자 finalize 가 일어났을 때만 그 확정 ISO 로, 그 외(동점·무표·일반 투표)에는 `null` 로 채운다. `finalizeSkippedReason` 은 날짜 투표가 동점이면 `"tie"`, 무표면 `"no_votes"`, finalize 가 일어났거나 일반 투표면 `null` 로 채운다.
- **The backend shall** 이 두 필드를 PollResponseDto 에 **순수 추가**하되, `POST .../vote` 와 `GET .../polls` 응답에서는 항상 `null` 로 채운다(finalize 는 close 에서만 일어나므로 — 다른 응답은 finalize 정보를 싣지 않는다). 별도 wrapper 타입을 만들지 않는다(기존 단건 poll DTO 재사용).

### REQ-MOIM8-006: api-client 투표 표면 갱신 (Ubiquitous)

- **The api-client shall** 백엔드 OpenAPI 변경(`CreatePollDto.kind`, `PollResponseDto.kind` + `PollOptionResponseDto.optionDate` + `PollResponseDto.finalizedStartsAt`/`finalizeSkippedReason`)을 반영해 생성 `schema.d.ts` 를 재생성한다(수동 편집 없음).
- **The api-client shall** 기존 poll 타입 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`)을 유지하되, 재생성으로 `CreatePollRequest` 에 optional `kind`, `PollResponse` 에 `kind`/옵션 `optionDate`/`finalizedStartsAt`/`finalizeSkippedReason` 가 반영되도록 한다(`multiSelect`/`myVotes`/`closesAt`/`isClosed` 는 MOIM-006/007 그대로 보존).
- **The web app shall** path-param 투표 라우트를 web 의 **구체-경로 헬퍼**(`lib/moim/polls.ts`)로 호출하는 기존 패턴(`listPolls`/`createPoll`/`votePoll`/`closePoll`)을 유지하고, `PollWithResults`(web 미러 타입)에 `kind: "general" | "date"` + 옵션 `optionDate: string | null` + `finalizedStartsAt`/`finalizeSkippedReason`(close 결과용)를 추가한다.
- **The api-client/web shall** 토큰을 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).

### REQ-MOIM8-007: 웹 날짜 투표 UI + 일정 확정 갱신 (Event-driven / State-driven / Ubiquitous 혼합)

- (Event-driven, 생성) **WHEN** 멤버가 "투표 만들기" 폼에서 **"일정 투표"** 토글을 켜고 동적 옵션 입력(이때 각 옵션은 `datetime-local`)을 채워 제출하면, **the web app shall** `kind: "date"` 로 표시하고 각 옵션 로컬 시각을 ISO-8601 로 변환해 `options[]` 에 담아 생성 엔드포인트에 전달한다. 토글이 꺼져 있으면(`kind` 생략/`"general"`) 기존 자유 텍스트 옵션 흐름 그대로다(회귀 0). `multiSelect` 토글은 날짜 투표와 공존 가능하다("가능한 날짜" 다중 선택 — finalize 는 여전히 단일 최다 득표).
- (State-driven, 날짜 표시) **WHILE** 한 poll 의 `kind` 가 `"date"` 인 동안, **the web app shall** 각 옵션을 그 옵션의 `optionDate` 를 사람이 읽을 수 있게 포맷한 날짜로 렌더한다(raw ISO 문자열 노출 금지) — `closesAt`/마감됨/내 표 강조/득표 막대는 MOIM-005/006/007 그대로.
- (State-driven, 확정 힌트) **WHILE** 한 날짜 poll 이 열려 있는 동안, **the web app shall** "마감 시 최다 득표 날짜가 모임 일정으로 확정돼요" 안내를 표시해, 마감이 일정 확정을 일으킴을 알린다(일반 투표는 표시 안 함).
- (Event-driven, finalize 갱신) **WHEN** 생성자가 날짜 poll 을 "마감하기" 로 닫으면, **the web app shall** `POST .../close` 를 Server Action 으로 호출하고 성공 시 상세를 재검증(`revalidatePath`)해 **그 poll(마감됨)** 과 **모임 헤더의 일정(`startsAt`)** 이 둘 다 갱신되게 한다(close 가 finalize 한 startsAt 이 다음 fetch 의 `formatMoimSchedule` 에 반영). 모임 헤더는 이미 MOIM-004 의 `formatMoimSchedule` 로 startsAt 을 렌더하므로, 추가 렌더 코드 없이 재검증으로 갱신됨을 확인한다.
- (State-driven, 동점 notice) **WHILE** close 응답이 `finalizeSkippedReason = "tie"` 인 동안, **the web app shall** 일정이 확정되지 않았음을(동점) 안내한다("동점이라 일정이 자동 확정되지 않았어요" 류). `"no_votes"` 면 그에 맞는 안내를 표시할 수 있다(또는 일반화). 단일 승자(`finalizedStartsAt != null`)면 일정이 확정됐음이 헤더 갱신으로 드러난다.
- (Unwanted behavior) **IF** 생성/마감이 백엔드 오류(400/403/404/네트워크)를 반환하면, **then the web app shall** 폼/화면에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 재시도할 수 있게 한다(날짜 옵션 무효 400, 비생성자 마감 403 포함).
- (Ubiquitous) **The web app shall** 날짜 투표 UI("일정 투표" 토글·datetime 옵션 입력·확정 힌트·동점 notice)를 Meetup 디자인 시스템(`(main)/home/[id]` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 MOIM-005/006/007 이 만든 poll 도메인을 확장한다. 파일·라인은 작성 시점(2026-06-21) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/moim/moim.service.ts` `assertMember`/`createMoim`(startsAt 쓰기 경로)/`getMoim` — 보존. 신규 `setStartsAt` 메서드만 추가([ADD]) — finalize 가 호출하는 startsAt 쓰기 단일 출처.
- `apps/backend/prisma/schema.prisma` `Moim`(startsAt 포함)/`MoimMember`/`MoimInvite`/`ChatMessage`/`PollVote`(PK 포함) — **무변경**. `Poll`(kind 1컬럼) + `PollOption`(optionDate 1컬럼)만 추가([MODIFY]).
- `apps/backend/src/poll/poll.service.ts` 의 `createPoll`(트랜잭션 + closesAt)·`vote`(마감 검사 409 + multiSelect 분기)·`aggregatePolls`(voteCount/myVotes/closesAt/isClosed) — **보존**. createPoll 에 optionDate, closePoll 에 finalize, aggregate 에 kind/optionDate 만 추가([MODIFY] 내부). vote 무변경.
- `apps/backend/src/poll/poll.controller.ts` 의 기존 라우트(POST 생성 / GET 목록 / POST :pollId/vote / POST :pollId/close)·가드·`requireNonEmpty`/`normalizeOptions`/`parseClosesAt` 헬퍼·400/403/404/409 정책 — 보존. create 가 kind/날짜 옵션 파싱을, close 응답이 finalize 2필드를, DTO 매핑이 kind/optionDate 만 추가([MODIFY]).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` 의 `voteAction`/`closePollAction`(세션·revalidatePath)·`toIsoOrUndefined`·`requireToken` — 보존. `createPollAction` 이 kind + 날짜 옵션 읽기만 추가하고, `closePollAction` 이 close 결과의 finalize 필드를 상태로 전달([MODIFY] 내부).
- `apps/web/app/(main)/home/[id]/page.tsx` 의 헤더 startsAt 렌더(`formatMoimSchedule(moim.startsAt)`, MOIM-004)·polls fetch·`currentUserId` 전달 — **무변경**. finalize 된 startsAt 은 close 후 revalidatePath 가 page 를 재렌더하면서 자동 반영된다(추가 렌더 코드 없음 — 확인만).
- `apps/web/app/moims/new/create-moim-form.tsx` 의 `datetime-local` 입력 블록 — **참조/미러 대상**(날짜 옵션 입력 패턴). 그 파일 자체는 무변경.
- `apps/mobile/**` — **모바일 무변경**. 날짜 투표 UI 는 `/home/[id]` 안에서 in-WebView 로 렌더되고, 상세 라우트 네이티브 push 는 SPEC-MOIM-003 계약이 처리한다. 신규 네이티브 코드 없음.

### [MODIFY] (수정)

- `apps/backend/prisma/schema.prisma`:
  - `model Poll` — `kind String @default("general") @map("kind")` 1줄 추가(string, enum 아님; 기존 컬럼·관계·`@@index([moimId])`·PK 무변경). 주석 1줄("general"=자유 텍스트 / "date"=날짜 옵션).
  - `model PollOption` — `optionDate DateTime? @map("option_date")` 1줄 추가(nullable; 날짜 투표 옵션만 채움, 일반은 null).
- `apps/backend/src/poll/dto/create-poll.dto.ts` — `kind?: string`(`@ApiProperty({ required: false, enum: ['general','date'], default: 'general', description: '투표 종류. "date" 면 옵션이 ISO-8601 날짜 문자열.' })`) 추가.
- `apps/backend/src/poll/dto/poll-response.dto.ts`:
  - `PollOptionResponseDto` — `optionDate: string | null`(`@ApiProperty({ nullable: true, type: String })`) 추가.
  - `PollResponseDto` — `kind: string`(`@ApiProperty({ enum: ['general','date'] })`) + `finalizedStartsAt: string | null`(`@ApiProperty({ nullable: true, type: String })`) + `finalizeSkippedReason: string | null`(`@ApiProperty({ nullable: true, enum: ['tie','no_votes'] })`) 추가(기존 multiSelect/myVotes/closesAt/isClosed/options 보존).
- `apps/backend/src/poll/poll.service.ts`:
  - `PollWithResults` 인터페이스 — `kind: string` + 옵션에 `optionDate: Date | null` + (close 결과용) `finalizedStartsAt: Date | null` + `finalizeSkippedReason: 'tie' | 'no_votes' | null` 추가(목록/투표 응답에선 finalize 필드 null).
  - `createPoll(sub, moimId, question, options, multiSelect, closesAt, kind, optionDates?)` — kind/optionDates 파라미터 추가 → `poll.create` data 에 `kind`, 옵션 create 에 `{ label, optionDate }`(날짜면 optionDate=파싱 시각·label=ISO, 일반이면 optionDate=null). 컨트롤러가 파싱·검증을 선처리(서비스는 저장만).
  - `closePoll(sub, moimId, pollId)` — MOIM-007 그대로 마감(assertMember → poll 일관성 404 → 생성자 403 → closesAt=now) 후, `poll.kind === 'date'` 면: 옵션 voteCount 집계 → 단일 최다 득표 옵션 판정(top count 공유 ≥2 → tie / 모두 0 → no_votes / 단일 → winner) → winner 면 `moim.setStartsAt(moimId, winner.optionDate)` 호출 + finalizedStartsAt 설정, 아니면 finalizeSkippedReason 설정. 일반 투표는 둘 다 null. 집계 결과에 finalize 필드 실어 반환.
  - `aggregatePolls` — 각 poll map 에 `kind: poll.kind`, 옵션 map 에 `optionDate: o.optionDate` 추가, finalize 필드는 null(목록/투표 응답). voteCount/myVotes/closesAt/isClosed 무변경.
- `apps/backend/src/poll/poll.controller.ts`:
  - `create` — `body.kind` 검증(`parseKind` 헬퍼: 생략→"general", "general"/"date" 허용, 그 외 400). kind="date" 면 `normalizeOptions` 대신/이후 각 옵션을 날짜로 파싱(`parseOptionDates` 헬퍼: 무효 ISO → 400, ≥2 유효), Date[] 와 ISO label[] 을 service 에 전달. kind="general" 이면 기존 normalizeOptions 그대로.
  - `close` — `closePoll` 결과를 `resultToDto` + finalize 필드 매핑.
  - `newPollToDto`/`resultToDto` — `kind`, 옵션 `optionDate`(ISO|null), `finalizedStartsAt`/`finalizeSkippedReason`(resultToDto 는 service 값, vote/list 는 null) 매핑.
- `packages/api-client/src/index.ts` — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지(주석 갱신 — kind/optionDate/finalize 추가). 재생성으로 underlying schema 가 바뀐다.
- `packages/api-client/src/schema.d.ts` — `nx run api-client:generate` 재생성(신규 kind/optionDate/finalize 반영). 수동 편집 없음.
- `apps/web/lib/moim/polls.ts` — `PollWithResults` 타입에 `kind: "general" | "date"` + 옵션 `optionDate: string | null` 추가. close 결과 타입(또는 PollWithResults 확장)에 `finalizedStartsAt: string | null` + `finalizeSkippedReason: "tie" | "no_votes" | null`. `createPoll` 헬퍼 시그니처는 CreatePollRequest(kind 포함) 그대로 — 헬퍼 무변경. `closePoll` 헬퍼 반환에 finalize 필드 포함.
- `apps/web/app/(main)/home/[id]/poll-actions.ts` — `createPollAction` 이 FormData 에서 `kind`(일정 투표 토글)를 읽고, kind="date" 면 옵션(`option[]`)을 `toIsoOrUndefined` 로 ISO 변환해 전달(빈/무효 옵션 거름 — ≥2 검사). `closePollAction` 이 close 결과의 `finalizedStartsAt`/`finalizeSkippedReason` 를 상태로 돌려줘 동점 notice 를 띄울 수 있게 한다(`voteAction` 무변경).
- `apps/web/app/(main)/home/[id]/polls-section.tsx`:
  - `OptionRow`/`PollCard` — `kind` prop 분기: 날짜 투표면 옵션 라벨을 `optionDate` 포맷 날짜로 렌더(raw ISO 아님). 열린 날짜 투표에 "마감 시 최다 득표 날짜가 모임 일정으로 확정돼요" 힌트. 마감/내 표/득표 막대는 MOIM-005/006/007 그대로.
  - `PollCard` close 핸들러 — `closePollAction` 결과의 `finalizeSkippedReason` 으로 동점/무표 notice 표시.
  - `CreatePollForm` — "일정 투표"(name="kind", 체크 시 "date") 토글 추가. 토글 ON 이면 동적 옵션 입력을 `datetime-local` 로 전환(OFF 면 text). multiSelect 토글과 공존.

### [ADD] (신규)

- `apps/backend/src/moim/moim.service.ts` — `setStartsAt(moimId, startsAt: Date)` 메서드(startsAt 쓰기 단일 출처 — finalize 가 호출).
- `apps/backend/src/poll/poll.controller.ts` — `parseKind`/`parseOptionDates` 헬퍼(kind 검증·날짜 옵션 파싱).
- `apps/web/lib/moim/polls.ts` — close 결과의 finalize 필드 타입(PollWithResults 확장 또는 별도 close 결과 타입).

### [BREAK] (의도적 호환성 단절)

- **읽기 모델에 `kind`/`optionDate`/`finalizedStartsAt`/`finalizeSkippedReason` 추가**: PollResponseDto·PollOptionResponseDto·api-client `PollResponse`·web `PollWithResults` 가 새 필드들을 얻는다. 이는 기존 필드를 제거하지 않는 **순수 추가**라 기존 소비처는 컴파일을 깨지 않는다(읽기 측 호환). 다만 web `PollWithResults` 미러 타입과 그 매핑은 새 필드를 함께 채워야 하며 tsc 게이트로 누락을 차단한다. (MOIM-006 myVote→myVotes 같은 제거형 break 는 아니다 — 추가형.)

### [REMOVE]

- 없음(컬럼/타입/필드 추가 — 테이블·라우트·파일·필드 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **장소(location) auto-finalize** — finalize 대상은 `Moim.startsAt`(일정) 한 가지다. 날짜 투표 승자를 `Moim.location` 에 반영하거나 장소 투표를 도입하는 것은 범위 밖(MVP). 장소 자동화는 향후 별도 후속.
- **passive deadline-pass auto-finalize** — finalize 트리거는 **생성자 수동 마감(`POST .../close`)** 뿐이다. closesAt 시각이 그냥 지나는 것(passive)은 finalize 를 일으키지 않는다 — read 시 `isClosed: true` 로만 보이고, 일정 확정은 일어나지 않는다(생성자가 명시적으로 close 해야 함). 크론/스케줄러로 closesAt 도달을 감지해 finalize 하는 배선은 범위 밖.
- **크론 / 스케줄러** — 마감 시각 도달을 백그라운드로 감지해 자동 마감·자동 finalize 하는 잡(NestJS @Cron 등)은 범위 밖. finalize 는 동기 close 핸들러 안에서만.
- **reopen / un-finalize / 일정 확정 취소** — finalize 후 `Moim.startsAt` 을 되돌리거나 마감을 해제하는 기능은 범위 밖. finalize 는 일방향이다(MOIM-007 reopen 제외와 일관). 향후.
- **finalize 후 수정(edit-after-finalize)** — 확정된 startsAt 을 날짜 투표 재마감으로 다른 날짜로 다시 덮는 시나리오는 동작상 가능하지만(생성자가 reopen 없이 새 투표를 만들어야 함), 같은 닫힌 poll 을 다시 열어 재확정하는 UI/경로는 범위 밖.
- **realtime 라이브 갱신(Supabase Realtime)** — finalize·일정 확정은 close/페이지 로드 시 재조회(`revalidatePath`)로 갱신한다(MOIM-005/006/007 동일). 승자 확정을 실시간으로 푸시하지 않는다(다음 fetch 에 반영).
- **비생성자 finalize** — finalize 는 close 핸들러 안에서만 일어나고 close 는 생성자 전용(MOIM-007)이므로, 비생성자/비멤버는 finalize 에 도달하지 못한다(403). owner-도-finalize 같은 확장은 향후.
- **모바일 신규 코드** — 날짜 투표 UI 는 웹 상세가 소유하고 모바일 WebView 안에서 렌더된다. expo-router 네이티브 라우트/컴포넌트를 추가하지 않는다(SPEC-MOIM-003 계약 재사용).
- **타임존 정교화** — `datetime-local`(타임존 없는 로컬 시각) → `new Date(value).toISOString()` 의 MVP 변환을 쓴다(moims/new 선례, MOIM-007 closesAt 동일). 타임존 선택 UI 나 서버측 타임존 정규화는 범위 밖.
- **kind 의 DB enum 제약** — `kind` 는 string `@default` 컬럼이며 허용 값 검증은 컨트롤러가 한다(미지 값 400). Prisma enum / DB CHECK 제약으로 강제하지 않는다(CREATE TYPE 마이그레이션 마찰 회피 — §5).

---

## 5. 설계 노트 (Design Notes)

### kind string 컬럼 (Prisma enum 회피 — 핵심 결정)

- `Poll.kind` 는 `String @default("general")` 컬럼이다 — Prisma enum 이 아니다. 이유: enum 은 PostgreSQL `CREATE TYPE` 마이그레이션을 동반하는데, 이 프로젝트는 hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 `prisma migrate dev` 의 파괴적 reset 을 피하고 비파괴 패턴(migrate diff/db execute/resolve)을 쓴다 — string `@default` 컬럼이면 순수 `ALTER TABLE ... ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';` 한 줄로 끝나 마찰이 없다.
- 허용 값(`"general"|"date"`)의 검증은 **컨트롤러**가 명시적으로 한다(미지 값 → 400, `parseKind` 헬퍼) — MOIM-001/005 의 no-ValidationPipe 명시 검사 정책과 일관(question 빈/옵션<2 검증도 컨트롤러). DB enum/CHECK 제약은 두지 않는다.
- `@default("general")` 이라 기존 poll row 는 모두 일반 투표로 비파괴 보존된다(마이그레이션이 기존 row 를 'general' 로 채움).

### optionDate nullable (날짜 옵션 시각의 출처)

- `PollOption.optionDate DateTime?` 는 날짜 투표 옵션의 실제 시각을 담는다. 날짜 투표 생성 시 `optionDate = 파싱된 시각`, `label = optionDate.toISOString()`(정규 라벨) — label 도 채워 기존 label 의존 코드(목록 표시)가 안 깨지게 하되, **웹은 optionDate 를 사람이 읽을 수 있게 포맷**해 보여준다(raw ISO label 노출 금지). 일반 투표 옵션은 optionDate=null, label=자유 텍스트(MOIM-005 그대로).
- 승자 판정·finalize 는 optionDate 를 출처로 쓴다(label 의 ISO 를 다시 파싱하지 않음 — Date 컬럼 직접 사용).

### finalize 트리거 = 생성자 수동 마감만 (passive 제외)

- finalize 는 오직 `POST .../close`(생성자 전용, MOIM-007) 핸들러 안에서만 일어난다. closesAt 시각이 그냥 지나는 것(passive deadline-pass)은 finalize 를 일으키지 않는다 — read 시 `isClosed: true` 로 마감으로 보이지만, `Moim.startsAt` 은 생성자가 명시적으로 close 하기 전까지 그대로다.
- 이유: (1) 크론/스케줄러를 도입하지 않는다(인프라 추가 없음 — §4); (2) 일정 확정은 생성자의 명시적 행위(닫기)에 묶는 게 의미론적으로 명확하다("닫으면 확정"); (3) passive 마감을 finalize 와 분리하면 닫힌 투표를 누구든 GET 으로 봐도 finalize 가 중복 실행되지 않는다(finalize 는 close 1회에서만).
- 그래서 닫힌(closesAt<=now) 날짜 투표를 누가 GET 해도 startsAt 이 저절로 바뀌지 않는다 — finalize 는 close 라우트의 부작용일 뿐이다.

### 승자 = 단일 최다 득표 (동점·무표 스킵)

- 승자 판정: 옵션별 voteCount 를 집계해 최대값(top)을 구한다. top voteCount 를 가진 옵션이 **정확히 1개**면 그 옵션이 승자 → `Moim.startsAt = winner.optionDate`. top 을 **2개 이상**이 공유하면 동점 → finalize 스킵(`"tie"`). 모든 옵션이 0표면(top=0) 무표 → 스킵(`"no_votes"`).
- 동점·무표에서 finalize 를 강제로 하지 않는 이유: 자의적 tie-break(먼저 만든 옵션·먼저 받은 표 등)는 사용자가 의도하지 않은 일정을 확정시킬 위험이 있다 — 차라리 startsAt 을 그대로 두고 생성자에게 동점을 알려 사람이 결정하게 한다(MVP 안전 기본값).
- 다중 선택(multiSelect=true) 날짜 투표도 동일하다 — 멤버가 여러 날짜를 골라도 finalize 는 옵션별 voteCount 의 단일 최다만 본다(동점이면 스킵). 다중 선택은 후보를 넓히는 도구이고 finalize 규칙은 불변이다.
- **덮어쓰기**: 단일 승자면 기존 `Moim.startsAt`(MOIM-004 생성 시 정했거나 이전 finalize 값)을 덮어쓴다 — finalize 가 확정 시점이기 때문이다. 이는 의도된 동작이지 데이터 손실이 아니다.

### startsAt 쓰기 단일 출처 = MoimService.setStartsAt (신규)

- 현재 `Moim.startsAt` 쓰기 경로는 `MoimService.createMoim`(생성 시 optional startsAt) 하나뿐이다. finalize 가 PollService 에서 직접 `prisma.moim.update` 하면 startsAt 쓰기가 두 곳으로 흩어진다 — `assertMember`/`createMoim` 가 모임 쓰기를 MoimService 단일 출처로 모은 패턴을 따라, 신규 `MoimService.setStartsAt(moimId, startsAt)` 를 추가해 PollService.closePoll 이 이를 호출한다.
- `setStartsAt` 은 인가를 다시 하지 않는다(closePoll 이 이미 assertMember + 생성자 검사를 통과시킴) — 순수하게 startsAt 만 갱신하는 도메인 쓰기다. moim 존재는 poll.moimId 가 보장한다(close 가 이미 poll-moim 일관성 검증).

### close 응답 shape = 단건 poll + finalize 2필드

- close 응답은 기존 단건 poll 결과(MOIM-007 — 집계 + closesAt + isClosed=true)에 `finalizedStartsAt: string|null` + `finalizeSkippedReason: "tie"|"no_votes"|null` 두 필드를 더한 **확장 PollResponseDto** 다. 별도 wrapper(`{ poll, finalize }`)를 만들지 않는 이유: 웹이 close 후 그 단건 poll(마감됨)과 동점 여부만 알면 되고, 모임 헤더 startsAt 은 revalidatePath 가 page 재렌더로 가져온다 — wrapper 없이 두 필드로 충분(최소).
- vote/list 응답에서는 두 필드를 항상 `null` 로 채운다(finalize 는 close 에서만) — DTO 는 공유하되 값 의미는 라우트가 정한다.

### 웹 — 날짜 투표 렌더 + 일정 확정 갱신

- `CreatePollForm` 에 "일정 투표" 토글(name="kind", 체크 시 "date") 추가 — 켜면 동적 옵션 입력을 `datetime-local` 로 전환(moims/new 의 datetime-local 입력 미러), `createPollAction` 이 각 옵션을 `toIsoOrUndefined` 로 ISO 변환해 전달. multiSelect 토글과 공존(둘 다 체크 가능 — "가능한 날짜 여러 개").
- `PollCard` 가 `poll.kind === "date"` 면 옵션 라벨을 `optionDate` 포맷 날짜로 렌더(`formatClosesAt` 류 — raw ISO 아님), 열린 날짜 투표에 확정 힌트("마감 시 최다 득표 날짜가 모임 일정으로 확정돼요") 표시.
- close 후: `closePollAction` 이 close 결과의 finalize 필드를 돌려준다 — `finalizeSkippedReason === "tie"` 면 동점 notice, 단일 승자(`finalizedStartsAt != null`)면 별도 notice 없이 헤더 갱신으로 확정이 드러난다. `revalidatePath("/home/{id}")` 가 poll(마감됨)과 모임 헤더 startsAt 을 둘 다 재렌더한다(page.tsx 가 이미 startsAt fetch + formatMoimSchedule — 추가 코드 없음).

### 디자인

- 날짜 투표 UI 모두 `(main)/home/[id]` Meetup 오렌지 토큰 사용. "일정 투표" 토글은 multiSelect 토글과 같은 카드형(`border-border`/`bg-background` + `accent-primary`), 확정 힌트는 `text-primary` 강조 한 줄, 동점 notice 는 `text-muted-foreground`/절제된 alert. login/onboarding blue 미사용.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 마이그레이션 파괴적 reset | MEDIUM | `prisma migrate dev` 가 hand-edited add_chat(realtime 트리거) 때문에 reset 시도 가능. 비파괴 패턴(migrate diff/db execute/resolve/status clean) 강제(MOIM-005/006/007 동일). kind 는 `@default('general')`, optionDate 는 nullable 추가라 SQL 단순(ADD COLUMN 2개). enum 회피로 CREATE TYPE 마찰 없음. |
| 동점/무표 finalize 오작동 | HIGH | 동점인데 자의적 옵션을 startsAt 으로 확정하면 잘못된 일정. 승자 판정을 strictly-highest 단일로 고정 — top 공유 ≥2 → tie 스킵, 모두 0 → no_votes 스킵, 단일만 finalize. jest: 단일 승자 → startsAt 설정 / 동점 → 불변+tie / 무표 → 불변+no_votes / 일반 투표 close → finalize 안 함 케이스로 고정. |
| 일반 투표를 finalize | HIGH | kind="general" close 가 startsAt 을 건드리면 일반 투표가 일정을 오염. closePoll 의 finalize 분기를 `poll.kind === 'date'` 로 엄격히 가드. jest: 일반 투표 close → startsAt 불변 + finalize 필드 null 회귀로 고정. |
| 비생성자 finalize | MEDIUM | finalize 가 close 밖으로 새면 아무 멤버나 일정을 확정. finalize 는 closePoll 핸들러 안에서만(close 는 MOIM-007 생성자 전용 — assertMember 403 → poll 404 → 생성자 403 순서 보존). jest: 비생성자 close 403 → finalize 미실행 + startsAt 불변으로 고정. |
| 날짜 옵션 무효 ISO 통과 | MEDIUM | kind="date" 인데 무효 ISO 옵션이 통과하면 optionDate=Invalid Date 가 저장돼 finalize 가 깨짐. 컨트롤러 `parseOptionDates` 가 각 옵션 파싱(무효 → 400, getTime NaN 검사 — closesAt 정책 미러). jest: 무효 날짜 옵션 → 400, 유효 ≥2 → 저장으로 고정. |
| startsAt 쓰기 경로 분산 | MEDIUM | finalize 가 직접 prisma.moim.update 하면 createMoim 외 두 번째 startsAt 쓰기로 드리프트. `MoimService.setStartsAt` 단일 메서드로 모으고 closePoll 이 호출. tsc/jest 로 경로 확인. |
| 기존 startsAt 덮어쓰기 | LOW | finalize 가 기존 startsAt(생성 시 값/이전 finalize)을 덮음. 의도된 동작(확정 시점) — 데이터 손실 아님. AC/jest 로 덮어쓰기 명시 고정. |
| 읽기 모델 추가 누락 소비처 | LOW | kind/optionDate/finalize 는 순수 추가(제거 아님)라 기존 소비처는 안 깨진다. 다만 web PollWithResults 미러·close 결과 타입이 새 필드를 채워야 함 — tsc 게이트로 누락 차단. |
| 멤버 스코핑 약화 | MEDIUM | poll service 진입(create/vote/list/close)이 첫 줄 assertMember 호출 보존(MOIM-005/006/007). 통합 테스트 403 케이스로 고정. kind/optionDate 추가가 인가에 영향 없음. |
| 디자인 토큰 혼선(blue vs orange) | LOW | 일정 투표 토글·datetime 옵션·확정 힌트 추가 시 blue 복사 위험. REQ-MOIM8-007 로 오렌지 강제, 코드 리뷰. |
| passive 마감을 finalize 로 오해 | LOW | closesAt 도달만으로 finalize 를 기대하면 일정 미확정. SPEC/UI 가 "마감하기 = 확정" 을 명시(확정 힌트 문구). finalize 는 close 핸들러에만 — passive 는 isClosed 표시만(테스트로 고정). |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 jest(날짜 투표 신규 + finalize + 일반 투표/마감 회귀). api-client 는 tsc. 모바일은 본 SPEC에서 무변경(회귀 0 확인용 tsc/vitest/expo export).

- `prisma migrate` clean — `Poll.kind`(string `@default("general")` 추가) + `PollOption.optionDate`(nullable 추가). 기존 poll/option/vote row 보존(row 손실 0, kind 기본 'general' / optionDate null). `PollVote` PK(`(pollId,optionId,userId)`)·FK·인덱스 무변경. 비파괴 패턴(migrate diff/db execute/resolve/status clean). enum 회피(CREATE TYPE 없음).
- backend jest 통과 — 신규: 날짜 투표 생성(kind="date" + datetime 옵션 → optionDate/label 저장) + 무효 날짜 옵션 400 + 미지 kind 400 + close finalize 단일 승자 → Moim.startsAt 설정(finalizedStartsAt 반영) + 동점 → 스킵(startsAt 불변 + finalizeSkippedReason "tie") + 무표 → 스킵(불변 + "no_votes") + 일반 투표 close → finalize 안 함(startsAt 불변 + 둘 다 null) + 기존 startsAt 덮어쓰기 + 비생성자 close 403(finalize 미실행) + setStartsAt 단일 출처 호출; 회귀: 일반 투표 생성/투표(MOIM-005/006 단일 교체·다중 토글) + 마감 vote 409(MOIM-007) + closesAt 옵트인 + question 빈/옵션<2 400 + 비멤버 403 + 다른 모임 pollId 404.
- `tsc` 통과 (0 error — backend + web + api-client; kind/optionDate/finalizedStartsAt/finalizeSkippedReason 추가 + PollWithResults 미러 + close 결과 타입 확인).
- web lint 통과 (0 error).
- `nx run web:build` 통과 (0 error — 일정 투표 토글 + datetime 옵션 분기 + 날짜 포맷 렌더 + 확정 힌트/동점 notice 컴파일).
- mobile tsc / vitest / `expo export` 통과 (무변경 회귀 0).
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 모임 상세 진입 → "일정 투표" 토글 켜고 날짜 옵션 ≥2 로 투표 생성 → 옵션이 포맷 날짜로 보이고 확정 힌트 표시 → 멤버들이 날짜에 투표 → 생성자가 "마감하기" → 단일 승자면 모임 헤더 일정(startsAt)이 그 날짜로 확정 갱신, 동점이면 동점 notice + 일정 불변 확인이 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated — Server Action `revalidatePath` 가 WebView 안에서 poll 마감 AND 모임 헤더 startsAt 을 둘 다 갱신하는지 확인). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
