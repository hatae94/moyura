---
id: SPEC-MOIM-007
version: 0.2.0
status: in-progress
created: 2026-06-20
updated: 2026-06-20
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-007: 투표 마감(deadline + 수동 마감) — 마감 후 투표 차단

## HISTORY

- 2026-06-20 (v0.2.0): 구현 완료 + 라이브 검증(AC-1~7 자동 게이트 + 데스크톱·API 라이브) → status in-progress(device-gated). **구현 요약**: (1) 백엔드 — `Poll.closesAt DateTime? @map("closes_at")` nullable additive 추가. 마이그레이션 `20260620200000_add_poll_closes_at`(순수 nullable 컬럼 ADD — 비파괴: `ALTER TABLE poll ADD COLUMN closes_at TIMESTAMP(3);`, 기존 poll row 모두 null = 마감 없음, PollVote 복합 PK 무변경, row 손실 0). `PollService.vote` — assertMember → poll 일관성(404) → **마감 검사**(closesAt <= now → 409 "마감된 투표입니다") → optionId 소속(400) → multiSelect 분기(단일 교체/다중 토글) 순서. 신규 `closePoll(sub, moimId, pollId)` — assertMember(403) → poll 일관성(404) → 비생성자(createdBy !== sub → 403) → closesAt=now 설정(이미 마감이면 멱등). `aggregatePolls` — closesAt + 서버 계산 isClosed(closesAt != null && closesAt <= now) 추가 매핑. `PollController` — create에 closesAt 파싱(무효 ISO → 400, `parseClosesAt` 헬퍼), 신규 `POST :pollId/close`(@HttpCode(200)) 라우트. DTO — `CreatePollDto.closesAt?: string`(optional ISO), `PollResponseDto.closesAt: string|null` + `isClosed: boolean` 추가. jest 290 pass. tsc 0(backend/web/api-client). (2) api-client — `CreatePollRequest`(closesAt?: string) + `PollResponse`(closesAt: string|null, isClosed: boolean) + 신규 `closePoll` 헬퍼. `schema.d.ts` 재생성(수동 편집 없음). (3) 웹 — `PollWithResults`(closesAt/isClosed 추가). 신규 `closePoll` 구체-경로 헬퍼(`lib/moim/polls.ts`). `closePollAction` Server Action 추가 + `createPollAction` closesAt 읽기(`datetime-local` → toIsoOrUndefined). `PollCard` — isClosed 분기: "마감됨" 배지 + 투표 컨트롤 disabled(결과 계속 표시) / 열린 poll — MOIM-005/006 그대로. 열린 poll 생성자 전용 "마감하기" 버튼(createdBy === currentUserId). `CreatePollForm` — "마감 시각"(datetime-local, optional). `page.tsx` — currentUserId(sub) prop 전달. Meetup 오렌지 토큰. web lint + nx build 0. **라이브 검증(2026-06-20)**: 데스크톱 브라우저(moyura-verify), 모임 상세. 미래 마감 시각 poll 생성 → "마감 예정" 표시. 열린 poll 투표 정상(1표·100%). 생성자 "마감하기" → "마감됨" 배지 + 비활성 컨트롤 + 결과 유지 + 버튼 사라짐. 마감 poll 투표 → backend 409 "마감된 투표입니다". 이미 마감 poll 재-close → 200(isClosed true 유지, 멱등). AC-1~6 PASS, AC-7/AC-8 자동 게이트 PASS. **미완료 device-gated**: 모바일 WebView 셸에서 마감 poll 흐름(마감 시각 생성 → 투표 → 생성자 "마감하기" → 배지+비활성+결과 → 마감 후 409 차단 → 비생성자/마감 "마감하기" 미노출)이 iOS 시뮬레이터에서 미검증. 자동 게이트 단독으로 completed 전환 불가(프로젝트 메모리 규칙: mobile-spec-device-gated). mobile vitest 215/215(회귀 0 — 모바일 무변경).
- 2026-06-20 (v0.1.0): 최초 draft. SPEC-MOIM-005(단일 선택 투표) + SPEC-MOIM-006(다중 선택 투표)의 직속 후속. MOIM-005/006 이 만든 poll 도메인(`Poll`/`PollOption`/`PollVote`, `@Controller('moims/:id/polls')`, 단일=교체·다중=토글, 웹 Server Component + Client 섬 + Server Action)을 verified 기준으로 확장한다. **WHY**: 모임 투표는 "언제까지 투표하세요"의 마감이 필요하고("이번 주 금요일까지 가능한 날짜를 골라 주세요"), 생성자는 결정이 나면 마감 전이라도 일찍 닫을 수 있어야 한다 — 현재 poll 은 무기한 열려 있어(MOIM-005/006 명시 제외) 두 가지 모두 불가능하다. 본 SPEC은 그 한 걸음을 채운다. **핵심 결정**: (1) **모델** — `Poll.closesAt DateTime? @map("closes_at")`(nullable, additive) **한 컬럼**이 마감 시각(생성 시 설정)과 수동 마감(마감 액션이 `closesAt = now` 설정)을 **모두** 담당한다. 한 poll 은 `closesAt != null AND closesAt <= now` 일 때 **CLOSED** 다. `null` 은 "마감 없음 — 영구히 열림"(MOIM-005/006 기본 동작 보존). (2) **생성** — `POST /moims/:id/polls` 가 optional `closesAt`(ISO 문자열; 있으면 파싱 가능해야 함, 무효 시 400)을 받는다. 생략 시 무변경(null = 마감 없음). (3) **수동 마감(신규 엔드포인트)** — `POST /moims/:id/polls/:pollId/close` 는 **생성자 전용**(`sub === poll.createdBy` 아니면 403; 멤버이지만 비생성자도 403)이며 `closesAt = now` 를 설정한다(이미 마감이면 멱등). 이는 멤버 스코핑을 넘어서는 **신규 생성자-전용 인가**다(아래 §5에 명시). (4) **투표 차단** — poll 이 CLOSED(`closesAt <= now`)면 vote 가 `409 Conflict`("마감된 투표입니다")로 거부된다(단일·다중 공통). 열린 poll 의 투표는 무변경(MOIM-005/006 회귀 0). (5) **읽기 모델 확장** — `GET /moims/:id/polls` 가 `closesAt`(ISO|null) + **서버 계산 `isClosed`(boolean)** 를 반환한다(클라이언트 시계 오차 회피 — 마감 판정은 서버 권위). (6) **웹** — 생성 폼에 optional "마감 시각"(`datetime-local`, moims/new 일정 필드 미러), poll 카드에 마감 시각 표시(설정 시) + "마감됨" 배지 + 마감 시 투표 컨트롤 **비활성화**(결과는 계속 표시), 열린 poll 에 생성자 전용 "마감하기" 버튼. Meetup 오렌지 토큰 + Server Component/Client 섬/Server Action 구조 보존. (7) **api-client** — 백엔드 OpenAPI 변경(`CreatePollDto.closesAt`, `PollResponseDto.closesAt`+`isClosed`) 반영해 `schema.d.ts` 재생성. **스코프 결정 기록**: (a) `closesAt` 단일 컬럼이 마감 시각과 수동 마감을 동시에 표현(별도 `closedAt`/`closed` 컬럼 두지 않음 — 최소); (b) 마감 판정은 **서버 계산 `isClosed`** 로 노출(클라이언트가 `closesAt` 으로 직접 비교하지 않음 — 시계 오차 차단); (c) 수동 마감은 **생성자 전용**(멤버 스코핑보다 강한 신규 인가); (d) CLOSED 시 투표 409; (e) reopen·마감 시각 사후 수정·리마인더/알림·auto-finalize(승자 → `Moim.startsAt`)·실시간·모바일 코드는 모두 **제외**(§4) — 향후.

---

## 1. 개요 (Overview)

SPEC-MOIM-005 는 **단일 선택 투표**를, SPEC-MOIM-006 은 **다중 선택 투표**를 만들었다. 두 SPEC 모두 poll 은 **무기한 열려 있다**고 명시적으로 제외했다(close/lock 향후). 그러나 모임 투표의 실무는 마감을 전제로 한다 — "이번 주 금요일까지 가능한 날짜를 골라 주세요" 처럼 **마감 시각**이 있고, 호스트는 충분히 모이면 마감 전이라도 **일찍 닫을** 수 있어야 한다. 본 SPEC은 그 한 걸음을 채운다: poll 에 **마감(deadline) + 수동 마감(manual close)** 을 더하고, 마감된 poll 의 투표를 차단한다.

본 SPEC의 마감은 **단일 컬럼 `Poll.closesAt`(nullable)** 위에 세운다:

1. **마감 시각(deadline)** — 투표를 만들 때 마감 시각을 정하면(`closesAt` = 그 시각) 그 시각이 지나면 poll 은 자동으로 마감된다. 정하지 않으면(`closesAt = null`) 마감 없음 — 영구히 열린다(MOIM-005/006 동작 그대로).
2. **수동 마감(manual close)** — poll 생성자가 "마감하기"를 누르면 `closesAt = now` 가 설정되어 즉시 마감된다. 마감 시각을 따로 두지 않았어도(`null` 이었어도) 수동 마감이 가능하다. 마감 시각이 미래였어도 수동 마감으로 앞당길 수 있다(`closesAt` 를 now 로 덮어쓴다).
3. **마감 판정(CLOSED)** — 한 poll 은 `closesAt != null AND closesAt <= now` 일 때 **CLOSED** 다. 이 판정은 **서버**가 한다(`isClosed` 로 응답에 담는다) — 클라이언트가 `closesAt` 를 자기 시계로 비교하면 시계 오차로 마감 직전/직후가 어긋날 수 있기 때문이다.
4. **투표 차단** — CLOSED poll 에 투표하면 `409 Conflict`("마감된 투표입니다")다(단일·다중 공통). 열린 poll 의 투표는 무변경(MOIM-005=교체 / MOIM-006=토글 회귀 0). 결과 조회(`GET`)는 마감 여부와 무관하게 항상 가능하다 — 마감 후에도 결과는 본다.

데이터는 `moim`·`poll_option`·`poll_vote` 테이블을 건드리지 않고 **`Poll.closesAt` 컬럼 1개 additive 추가**만 한다(`@default` 없는 nullable → 기존 poll row 는 모두 `null` = 마감 없음으로 보존). PK 변경도 없다(MOIM-006 의 `(pollId, optionId, userId)` PK 그대로). 마이그레이션은 MOIM-005/006 과 동일한 **비파괴 패턴**(migrate diff → db execute → migrate resolve --applied → migrate status clean)으로 적용한다 — hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 `prisma migrate dev` 의 파괴적 reset 을 피한다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 마감 UI(마감 시각 입력·"마감됨" 배지·비활성 컨트롤·"마감하기" 버튼)는 모임 상세(`/home/[id]`) 안에서 in-WebView 로 렌더되므로 **모바일 신규 코드는 없다**.

이는 **컬럼 1개 additive + 생성 closesAt 수용 + 수동 마감 엔드포인트(생성자 전용) + vote CLOSED 차단(409) + 읽기 모델 closesAt/isClosed + 웹 마감 UI** 이지 대형 기능이 아니다. reopen·마감 수정·리마인더·auto-finalize·실시간·모바일 코드는 모두 제외한다(§4).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 7개로 제한한다. 각 모듈은 `REQ-MOIM7-XXX`로 번호를 부여하며(기존 `REQ-MOIM5-XXX`/`REQ-MOIM6-XXX` 등과 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM7-001: 마감 데이터 모델 + 비파괴 마이그레이션 (Ubiquitous)

- **The backend shall** `Poll` 에 `closesAt DateTime? @map("closes_at")` 컬럼을 **additive**(기존 컬럼·관계·인덱스·PK 무변경, `@default` 없는 nullable)로 추가한다 — 기존 poll row 는 모두 `closesAt = null`(마감 없음 — 영구히 열림, MOIM-005/006 동작 보존).
- **The backend shall** 이 변경을 **비파괴(데이터 보존) 마이그레이션**으로 적용한다 — 순수 nullable 컬럼 추가이므로 기존 row 갱신·재작성이 없고(`poll`/`poll_option`/`poll_vote` row 손실 0), `moim`/`moim_member`/`moim_invite`/`chat_message`/`poll_option`/`poll_vote` 와 그 동작(생성·목록·상세·멤버·채팅·초대·단일/다중 투표)은 어떤 회귀도 없이 보존된다.
- **The backend shall** `PollVote` 의 복합 PK `(pollId, optionId, userId)`(MOIM-006)와 모든 FK(cascade)·인덱스를 **그대로 보존**한다(마감 추가가 투표 표/Cascade/PK 에 영향 없음).
- **The backend shall** 비파괴 패턴(`prisma migrate diff` → `prisma db execute` → `prisma migrate resolve --applied` → `prisma migrate status` clean)으로 적용한다 — hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 `prisma migrate dev` 의 파괴적 reset 을 피한다(MOIM-005/006 선례).

### REQ-MOIM7-002: 투표 생성 — closesAt 옵트인 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 멤버가 `{ question, options[], multiSelect?, closesAt? }` 로 `POST /moims/:id/polls` 를 호출하면, **the backend shall** poll + 옵션을 하나의 트랜잭션으로 생성하고 `Poll.closesAt` 를 (제공 시) 파싱된 시각으로, (생략 시) `null`(마감 없음)로 설정한다.
- (Ubiquitous) **The backend shall** `closesAt` 가 생략된 요청을 마감 없는(`null`) poll 로 생성한다 — 마감 없는 생성 경로는 MOIM-005/006 과 동작이 동일하다(회귀 0). `multiSelect` 옵트인(MOIM-006)도 그대로 동작한다.
- (Unwanted behavior) **IF** `closesAt` 가 제공되었으나 유효한 날짜/시각으로 파싱할 수 없으면(무효 ISO 문자열), **then the backend shall** `400 Bad Request` 를 반환한다(MOIM-001/005 와 동일한 no-ValidationPipe 명시 검사 — closesAt 추가가 question 빈/옵션<2 검증을 바꾸지 않는다).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` 단일 출처 — 약화 금지).

### REQ-MOIM7-003: 수동 마감 — 생성자 전용 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** poll 의 **생성자**(`sub === poll.createdBy`)가 `POST /moims/:id/polls/:pollId/close` 를 호출하면, **the backend shall** 그 poll 의 `closesAt` 를 **현재 시각(now)** 으로 설정해 즉시 마감하고, 갱신된 단건 poll 결과(집계 + `closesAt` + `isClosed: true`)를 반환한다.
- (State-driven, 멱등) **WHILE** 대상 poll 이 이미 마감(`closesAt != null AND closesAt <= now`)인 동안, **WHEN** 생성자가 다시 close 를 호출하면, **the backend shall** 추가 부작용 없이(또는 `closesAt` 를 now 로 재설정해도 무방하게) `200 OK` + 마감 상태를 반환한다(멱등 — 두 번 마감해도 오류 아님).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버이지만 그 poll 의 **생성자가 아니면**, **then the backend shall** `403 Forbidden` 을 반환한다(마감은 생성자 전용 — 멤버 스코핑보다 강한 신규 인가).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 **아니면**(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` — 비멤버는 생성자 비교에 도달하지 않는다).
- (Unwanted behavior) **IF** `pollId` 가 path 의 모임에 속한 poll 이 아니면(또는 미존재이면), **then the backend shall** `404 Not Found` 를 반환한다(poll-모임 일관성 — vote 라우트와 동일 정책).

### REQ-MOIM7-004: 투표 차단 — 마감 시 409 (State-driven / Unwanted behavior 혼합)

- (State-driven, 마감) **WHILE** 대상 poll 이 마감(`closesAt != null AND closesAt <= now`)인 동안, **WHEN** 멤버가 `{ optionId }` 로 `POST /moims/:id/polls/:pollId/vote` 를 호출하면, **the backend shall** 투표를 거부하고 `409 Conflict`("마감된 투표입니다")를 반환한다 — 표를 변경하지 않는다(단일 교체·다중 토글 **공통**으로 차단).
- (State-driven, 열림) **WHILE** 대상 poll 이 열림(`closesAt == null` 또는 `closesAt > now`)인 동안, **WHEN** 멤버가 투표하면, **the backend shall** MOIM-005/006 의 투표 동작을 그대로 수행한다 — 단일(`multiSelect=false`)은 교체, 다중(`multiSelect=true`)은 토글(회귀 0).
- (Unwanted behavior) **IF** `optionId` 가 해당 poll 에 속한 옵션이 아니면(다른 poll 의 옵션이거나 미존재이면), **then the backend shall** `400 Bad Request` 를 반환한다(MOIM-005/006 동일 — 마감 검사보다 우선순위는 구현이 정하되, 마감 검사를 우회하지 않는다).
- (Unwanted behavior) **IF** `pollId` 가 path 의 모임에 속한 poll 이 아니면(또는 미존재이면), **then the backend shall** `404 Not Found` 를 반환한다(poll-모임 일관성 — MOIM-005/006 동일).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면, **then the backend shall** `403 Forbidden` 을 반환한다(`assertMember`). 비멤버는 마감 검사에 도달하지 않는다.

### REQ-MOIM7-005: 투표 목록 + 결과 조회 — closesAt + 서버 계산 isClosed (Ubiquitous / Unwanted behavior 혼합)

- (Ubiquitous) **The `GET /moims/:id/polls` response shall** 각 poll 에 대해 기존 필드(`id`/`question`/`createdBy`/`createdAt`/`multiSelect`/옵션 배열/`myVotes`)에 더해 **`closesAt`(ISO-8601 문자열 또는 `null`)** 와 **`isClosed`(boolean)** 를 포함한다.
- (Ubiquitous, 서버 권위) **The backend shall** `isClosed` 를 **서버 시각 기준으로 계산**해 채운다 — `isClosed = (closesAt != null AND closesAt <= now)`. 클라이언트가 `closesAt` 를 자기 시계로 비교하지 않게 하여 시계 오차(클라이언트가 마감 직전/직후를 잘못 판정)를 차단한다. `closesAt` 는 표시·정렬용으로 함께 노출하되, **마감 판정의 권위 있는 출처는 `isClosed`** 다.
- (Ubiquitous) **The backend shall** 마감 여부와 무관하게 옵션별 `voteCount`(표 0 포함)와 호출자 `myVotes`(목록)를 정확히 반환한다 — 마감된 poll 도 **결과는 항상 조회 가능**하다(읽기는 차단하지 않는다).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember`).
- (Ubiquitous) **The backend shall** poll 이 하나도 없는 모임에 대해 **빈 배열**을 반환한다(에러 아님).

### REQ-MOIM7-006: api-client 투표 표면 갱신 (Ubiquitous)

- **The api-client shall** 백엔드 OpenAPI 변경(`CreatePollDto.closesAt`, `PollResponseDto.closesAt` + `isClosed`)을 반영해 생성 `schema.d.ts` 를 재생성한다(수동 편집 없음).
- **The api-client shall** 기존 poll 타입 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`)을 유지하되, 재생성으로 `CreatePollRequest` 에 optional `closesAt`, `PollResponse` 에 `closesAt`(string|null) + `isClosed`(boolean) 가 반영되도록 한다(`multiSelect`/`myVotes` 는 MOIM-006 그대로 보존).
- **The web app shall** path-param 투표 라우트를 web 의 **구체-경로 헬퍼**(`lib/moim/polls.ts`)로 호출하는 기존 패턴을 유지하고, 신규 마감 라우트(`POST .../close`)용 구체-경로 헬퍼(`closePoll`)를 추가하며, `PollWithResults`(web 미러 타입)에 `closesAt: string | null` + `isClosed: boolean` 를 추가한다.
- **The api-client/web shall** 토큰을 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).

### REQ-MOIM7-007: 웹 마감 UI (Event-driven / State-driven / Ubiquitous 혼합)

- (Event-driven, 생성) **WHEN** 멤버가 "투표 만들기" 폼에서 "마감 시각"(`datetime-local`, optional)을 입력하고 제출하면, **the web app shall** 그 로컬 시각을 ISO-8601 로 변환해 생성 엔드포인트에 `closesAt` 로 전달한다(미입력 시 미전송 → `null` = 마감 없음). moims/new 일정 필드의 `datetime-local` + `toIsoOrUndefined` 패턴을 미러한다.
- (State-driven, 마감) **WHILE** 한 poll 의 `isClosed` 가 `true` 인 동안, **the web app shall** 그 poll 에 **"마감됨" 배지**를 표시하고, 투표 컨트롤(선택지 버튼)을 **비활성화**(클릭 불가)하되 **결과(득표 수/퍼센트/내 표 강조)는 계속 표시**한다(마감 후에도 결과는 본다).
- (State-driven, 열림) **WHILE** 한 poll 의 `isClosed` 가 `false` 인 동안, **the web app shall** MOIM-005/006 의 투표 동작(단일=탭 교체 / 다중=탭 토글)을 그대로 유지한다(열린 poll 투표 UX 회귀 0).
- (State-driven, 마감 시각 표시) **WHERE** 한 poll 의 `closesAt` 가 설정되어 있으면(`null` 아님), **the web app shall** 그 마감 시각을 사람이 읽을 수 있게 표시한다("마감: {시각}" 또는 마감됨이면 "마감됨"). `closesAt` 가 `null` 이면 마감 안내를 표시하지 않는다.
- (Event-driven, 수동 마감) **WHILE** 한 poll 이 열려 있고(`isClosed=false`) 또한 **현재 사용자가 그 poll 의 생성자**(`poll.createdBy === 현재 사용자 sub`)인 동안, **the web app shall** "마감하기" 버튼을 표시한다. **WHEN** 그 버튼을 누르면, **the web app shall** `POST .../close` 를 Server Action 으로 호출하고 성공 시 상세를 재검증(`revalidatePath`)해 그 poll 이 마감 상태("마감됨" + 비활성 컨트롤)로 갱신되게 한다. 생성자가 아니거나 이미 마감이면 버튼을 표시하지 않는다.
- (Unwanted behavior) **IF** 투표/생성/마감이 백엔드 오류(400/403/404/409/네트워크)를 반환하면, **then the web app shall** 폼/화면에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 재시도할 수 있게 한다. 특히 마감된 poll 에 투표하여 409 가 나면 마감 상태로 갱신해(재검증) 다시 투표가 차단되게 한다.
- (Ubiquitous) **The web app shall** 마감 UI(마감 시각 입력·"마감됨" 배지·비활성 컨트롤·"마감하기" 버튼)를 Meetup 디자인 시스템(`(main)/home/[id]` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 MOIM-005/006 이 만든 poll 도메인을 확장한다. 파일·라인은 작성 시점(2026-06-20) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/moim/moim.service.ts` `assertMember` — 멤버십 인가 단일 출처. **재사용만** — poll 서비스가 호출해 멤버 스코핑을 강제한다. 변경 없음.
- `apps/backend/prisma/schema.prisma` `Moim`/`MoimMember`/`MoimInvite`/`ChatMessage`/`PollOption`/`PollVote`(PK 포함) — **무변경**. `Poll` 만 컬럼 1개 추가([MODIFY]).
- `apps/backend/src/poll/poll.controller.ts` 의 기존 라우트 형태(POST 생성 / GET 목록 / POST :pollId/vote)·가드·`requireNonEmpty`/`normalizeOptions` 헬퍼·400/403/404 정책 — 보존. `create` 가 `closesAt` 를 추가로 전달하고, `vote`/DTO 매핑이 `closesAt`/`isClosed` 만 추가되며, 신규 `close` 라우트가 추가된다([MODIFY] + 신규 메서드).
- `apps/backend/src/poll/poll.service.ts` 의 `multiSelect` 분기(단일 교체/다중 토글, MOIM-006)·`assertMember` 선처리·`aggregatePolls` 의 voteCount groupBy·myVotes 매핑 — **보존**. vote 에 마감 검사(409)가 더해지고, `closePoll` 메서드가 신규 추가되며, `aggregatePolls` 가 `closesAt`/`isClosed` 만 추가 매핑한다([MODIFY] 내부).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` 의 `createPollAction`(question/options/multiSelect 읽기)·`voteAction` 시그니처·세션·`revalidatePath` 흐름 — 보존. `createPollAction` 이 `closesAt` 읽기만 추가하고, 신규 `closePollAction` 이 추가된다([MODIFY] 내부 + 신규).
- `apps/web/lib/moim/polls.ts` 의 `listPolls`/`createPoll`/`votePoll` 구체-경로 헬퍼 시그니처 — 보존(타입만 갱신). 신규 `closePoll` 헬퍼 추가.
- `apps/web/app/moims/new/actions.ts` `toIsoOrUndefined`(datetime-local → ISO) + `apps/web/app/moims/new/create-moim-form.tsx` 의 `datetime-local` 입력 블록 — **참조/미러 대상**(복제 또는 공유 헬퍼). 그 파일 자체는 무변경.
- `apps/mobile/**` — **모바일 무변경**. 마감 UI 는 `/home/[id]` 안에서 in-WebView 로 렌더되고, 상세 라우트 네이티브 push 는 SPEC-MOIM-003 계약이 처리한다. 신규 네이티브 코드 없음.

### [MODIFY] (수정)

- `apps/backend/prisma/schema.prisma`:
  - `model Poll` — `closesAt DateTime? @map("closes_at")` 1줄 추가(nullable, `@default` 없음 — 기존 컬럼·관계·`@@index([moimId])`·PK 무변경). 주석 1줄(마감 시각 = deadline + 수동 마감 = now).
- `apps/backend/src/poll/dto/create-poll.dto.ts` — `closesAt?: string`(`@ApiProperty({ required: false, description: '마감 시각(ISO-8601). 생략 시 마감 없음.' })`) 추가.
- `apps/backend/src/poll/dto/poll-response.dto.ts` — `closesAt: string | null`(`@ApiProperty({ nullable: true, type: String })`) + `isClosed: boolean`(`@ApiProperty()`) 추가(기존 `multiSelect`/`myVotes`/options 보존).
- `apps/backend/src/poll/poll.service.ts`:
  - `createPoll(sub, moimId, question, options, multiSelect, closesAt)` — `closesAt: Date | null` 파라미터 추가 → `poll.create` data 에 `closesAt`(null 이면 미설정 = null).
  - `vote(sub, moimId, pollId, optionId)` — assertMember → poll 일관성(404) → **마감 검사**(poll.closesAt != null && poll.closesAt <= now → `ConflictException`("마감된 투표입니다") 409) → optionId 소속(400) → multiSelect 분기(단일 교체/다중 토글) 순서. 열린 poll 동작 보존.
  - `closePoll(sub, moimId, pollId)` (신규) — assertMember(403) → poll 일관성(404) → **생성자 검사**(`poll.createdBy !== sub` → `ForbiddenException` 403) → `poll.update({ data: { closesAt: now } })`(이미 마감이면 멱등 — now 재설정 무해). 끝에 `aggregatePolls(sub, [updated])` 반환.
  - `PollWithResults` 인터페이스 — `closesAt: Date | null` + `isClosed: boolean` 추가.
  - `aggregatePolls` — 각 poll map 에 `closesAt: poll.closesAt` + `isClosed: poll.closesAt != null && poll.closesAt <= now` 추가(서버 계산). voteCount/myVotes 로직 무변경.
- `apps/backend/src/poll/poll.controller.ts`:
  - `create` — `body.closesAt`(있으면) 파싱(무효 ISO → 400, `parseClosesAt` 헬퍼)해 `createPoll(..., closesAt)` 전달.
  - 신규 `@Post(':pollId/close')` `@HttpCode(200)` — `closePoll` 호출, `resultToDto` 매핑. ApiOk/Forbidden/NotFound 데코.
  - `newPollToDto`/`resultToDto` — `closesAt`(ISO|null) + `isClosed` 매핑(신규 poll: closesAt 미설정 시 null/isClosed false, 설정 시 그대로). vote/list 응답도 함께.
- `packages/api-client/src/index.ts` — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지(주석 갱신 — `closesAt`/`isClosed` 추가). 재생성으로 underlying schema 가 바뀐다. close 라우트는 path-param → 편의 메서드 추가 없음(web 구체-경로 헬퍼).
- `packages/api-client/src/schema.d.ts` — `nx run api-client:generate` 재생성(신규 closesAt/isClosed 반영). 수동 편집 없음.
- `apps/web/lib/moim/polls.ts` — `PollWithResults` 타입에 `closesAt: string | null` + `isClosed: boolean` 추가. 신규 `closePoll(api, moimId, pollId)` 구체-경로 헬퍼(`POST .../close`). 기존 헬퍼 시그니처 무변경.
- `apps/web/app/(main)/home/[id]/poll-actions.ts` — `createPollAction` 이 FormData 에서 `closesAt`(datetime-local)를 읽어 `toIsoOrUndefined` 로 변환해 body 에 전달. 신규 `closePollAction(moimId, pollId)` Server Action(세션 → `closePoll` → `revalidatePath`). `voteAction` 무변경.
- `apps/web/app/(main)/home/[id]/polls-section.tsx`:
  - `OptionRow`/`PollCard` — `isClosed` prop 분기: 마감이면 옵션 버튼 `disabled`(투표 차단), "마감됨" 배지, `closesAt` 표시. 결과 막대/강조는 계속 표시. 열림이면 MOIM-005/006 그대로.
  - `PollCard` — 생성자 + 열림이면 "마감하기" 버튼(생성자 sub 비교용 `currentUserId` prop 추가 필요 — page 에서 전달). 클릭 시 `closePollAction`.
  - `CreatePollForm` — "마감 시각"(`datetime-local`, optional, name="closesAt") 입력 추가(Meetup 오렌지). moims/new 일정 미러.
  - `PollsSection`/page — 현재 사용자 sub(`currentUserId`)를 props 로 받아 생성자 버튼 노출 판정(아래 page 변경).
- `apps/web/app/(main)/home/[id]/page.tsx` — Server Component 에서 세션 user.id(sub)를 읽어(`listPolls` 와 함께) `<PollsSection currentUserId={sub} .../>` 로 전달([MODIFY] — 현재 sub 전달 추가). polls fetch 흐름은 그대로.

### [ADD] (신규)

- `apps/backend/src/poll/poll.controller.ts` — `POST /moims/:id/polls/:pollId/close` 라우트(생성자 전용 마감) 추가.
- `apps/backend/src/poll/poll.service.ts` — `closePoll(sub, moimId, pollId)` 메서드(생성자 전용 인가 + closesAt=now) 추가.
- `apps/web/lib/moim/polls.ts` — `closePoll` 구체-경로 헬퍼 추가.
- `apps/web/app/(main)/home/[id]/poll-actions.ts` — `closePollAction` Server Action 추가.

### [BREAK] (의도적 호환성 단절)

- **읽기 모델에 `closesAt`/`isClosed` 추가**: PollResponseDto·api-client `PollResponse`·web `PollWithResults` 가 새 필드 두 개를 얻는다. 이는 기존 필드를 제거하지 않는 **순수 추가**라 기존 소비처는 컴파일을 깨지 않는다(읽기 측 호환). 다만 web `PollWithResults` 미러 타입과 그 매핑(`page`→`PollsSection`)은 새 필드를 함께 채워야 하며 tsc 게이트로 누락을 차단한다. (MOIM-006 의 myVote→myVotes 같은 제거형 break 는 아니다 — 추가형.)

### [REMOVE]

- 없음(컬럼/타입/라우트/메서드/필드 추가 — 테이블·라우트·파일·필드 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **재오픈(reopen) / 마감 해제** — 마감된 poll 을 다시 여는 기능은 범위 밖. 마감은 일방향이다(`closesAt` 를 null 로 되돌리거나 미래로 미는 reopen UI 없음). 향후 별도 후속.
- **마감 시각 사후 수정(edit deadline)** — 생성 후 `closesAt` 를 다른 미래 시각으로 변경하는 기능은 범위 밖. 수동 마감(now 로 앞당김)만 제공한다. 마감 시각 연장/변경은 향후.
- **리마인더 / 마감 알림(push/notification)** — "마감 1시간 전" 같은 리마인더나 마감 시 FCM 푸시는 범위 밖(SPEC-CHAT-002 인프라 무변경).
- **auto-finalize(승자 자동 반영)** — 마감 후 최다 득표 옵션을 `Moim.startsAt`/장소에 자동 반영하거나 결과를 "확정"으로 잠그는 배선은 범위 밖. 본 SPEC은 마감 = 투표 차단까지만. 날짜 후보 → 일정 자동화는 향후.
- **마감 시각 기반 자동 정렬/배지 외 표시** — 마감 임박 정렬, 카운트다운 타이머, 자동 새로고침은 범위 밖. `isClosed`/`closesAt` 표시(정적)만 한다.
- **실시간 라이브 갱신(Supabase Realtime)** — 마감 상태 변동은 투표/마감/페이지 로드 시 재조회(`revalidatePath`)로 갱신한다(MOIM-005/006 동일). 마감 시각 도달을 실시간으로 푸시하지 않는다(다음 fetch 에 반영).
- **투표 수정 / 삭제(edit/delete poll)** — 질문·옵션 편집이나 poll 삭제 UI 는 MOIM-005/006 과 동일하게 범위 밖. moim/poll/option 삭제 시 Cascade 정리는 FK 로 보장(데이터 무결성 — 제약이지 UI 아님).
- **모바일 신규 코드** — 마감 UI 는 웹 상세가 소유하고 모바일 WebView 안에서 렌더된다. expo-router 네이티브 라우트/컴포넌트를 추가하지 않는다(SPEC-MOIM-003 계약 재사용).
- **마감 시각 타임존 정교화** — `datetime-local`(타임존 없는 로컬 시각) → `new Date(value).toISOString()` 의 MVP 변환을 쓴다(moims/new 선례). 타임존 선택 UI 나 서버측 타임존 정규화는 범위 밖.

---

## 5. 설계 노트 (Design Notes)

### closesAt 단일 컬럼 = 마감 시각 + 수동 마감 (핵심 결정)

- **한 컬럼이 두 역할**: `Poll.closesAt`(nullable)은 (a) 생성 시 정한 마감 **deadline**(미래 시각)과 (b) 수동 **마감 시각**(now 로 설정)을 모두 표현한다. 별도 `closedAt`/`closed` boolean 컬럼을 두지 않는다 — `closesAt != null AND closesAt <= now` 하나로 CLOSED 판정이 충분하기 때문(최소 모델).
- **상태 도출**: `null` = 마감 없음(영구 열림). `closesAt > now` = 마감 예정(아직 열림). `closesAt <= now` = 마감됨(CLOSED). 수동 마감은 `closesAt = now` 로 만들어 즉시 세 번째 상태로 보낸다.
- **수동 마감이 deadline 을 덮어쓴다**: 마감 시각이 미래(`closesAt = 2026-06-25`)였어도 생성자가 일찍 닫으면 `closesAt = now(2026-06-20)` 로 덮어써 즉시 마감한다(일찍 닫기 = 앞당김, 자연스러운 의미론). 이는 의도된 동작이지 데이터 손실이 아니다.

### 서버 계산 isClosed (시계 오차 차단)

- 마감 판정은 **서버**가 한다. 응답에 `isClosed`(서버 시각 기준 `closesAt <= now`)를 담아 클라이언트는 그것만 신뢰한다.
- 이유: 클라이언트가 `closesAt`(시각)를 받아 자기 시계로 `Date.now()` 와 비교하면, 클라이언트 시계가 빠르거나 느릴 때 마감 직전/직후를 서버와 다르게 판정한다(예: 클라이언트는 아직 열렸다고 보고 투표 시도 → 서버 409). `isClosed` 를 서버가 계산해 내려주면 표시·차단이 서버 권위와 일치한다.
- `closesAt`(ISO|null)도 함께 노출한다 — 표시("마감: {시각}"·"마감 예정")용. 단 **차단/배지 판정은 `isClosed`** 가 권위다. (스냅샷 시점 계산이라 클라이언트가 한참 머무르면 어긋날 수 있으나, 다음 vote/마감/재검증에서 서버가 409/갱신으로 바로잡는다 — 실시간 비범위, §4.)

### 수동 마감 = 생성자 전용 인가 (신규 — 멤버 스코핑보다 강함)

- MOIM-005/006 의 poll 라우트는 모두 `assertMember`(멤버면 누구나) 스코핑이었다. 마감은 **생성자만** 할 수 있어야 한다(아무 멤버나 남의 투표를 닫으면 안 됨) — 이는 poll 도메인에 처음 도입되는 **행위자-소유 인가**다.
- 구현: `closePoll` 은 (1) `assertMember`(비멤버 403/없는 모임 404→403) → (2) poll 일관성(404) → (3) `poll.createdBy !== sub` → `ForbiddenException`(403) 순서. 비멤버는 (1)에서, 멤버지만 비생성자는 (3)에서 403. 두 경우 모두 같은 403(생성자 여부를 외부에 굳이 구별 노출하지 않음 — 단, 비멤버는 모임 자체 접근 차단이 우선).
- `Moim` 의 owner 와는 별개다 — poll **생성자**(`Poll.createdBy`, 가드-검증 sub) 기준이다. 모임 owner 가 아니어도 자기가 만든 poll 은 마감할 수 있고, 모임 owner 라도 남이 만든 poll 은 마감할 수 없다(소유 = 생성자). 이는 MVP 결정이며 "owner 도 마감 가능" 같은 확장은 향후.

### vote 마감 검사 추가 (열린 동작 보존)

- 현재 `vote`(MOIM-006): assertMember → poll 일관성(404) → optionId 소속(400) → multiSelect 분기(단일 교체/다중 토글).
- 마감 검사를 **poll 일관성(404) 이후, optionId/분기 이전**에 삽입: `if (poll.closesAt && poll.closesAt <= new Date()) throw new ConflictException('마감된 투표입니다')`(409). 이렇게 하면 마감된 poll 에서는 표를 절대 건드리지 않는다(단일·다중 공통). 열린 poll 은 검사를 통과해 MOIM-005/006 동작 그대로(회귀 0).
- optionId 400 과 마감 409 의 우선순위: 둘 다 거부이므로 어느 쪽이 먼저든 표는 안 바뀐다. 명료성을 위해 **마감(409)을 optionId 검사(400) 앞**에 둔다 — 마감된 poll 은 어떤 optionId 든 투표 불가가 더 직관적이다(테스트로 고정).

### 웹 — 마감 렌더 + 생성자 버튼 (Server Component + Client 섬 보존)

- `page.tsx`(Server)는 세션 user.id(sub)를 읽어 `currentUserId` 로 `<PollsSection/>` 에 추가 전달한다(직렬화 가능한 string — 함수/인스턴스 아님). polls fetch 흐름 무변경.
- `PollCard`(Client)가 `poll.isClosed` 로 분기: 마감이면 옵션 버튼 `disabled`(투표 차단) + "마감됨" 배지 + `closesAt` 표시, 결과 막대/강조는 계속 렌더. 열림이면 MOIM-005/006 그대로. 추가로 `poll.createdBy === currentUserId && !poll.isClosed` 면 "마감하기" 버튼 렌더 → `closePollAction(moimId, poll.id)` 호출.
- `CreatePollForm` 에 "마감 시각" `datetime-local`(name="closesAt", optional) 추가 — moims/new 의 입력 블록 + `toIsoOrUndefined` 변환 미러. `createPollAction` 이 `formData.get("closesAt")` 를 ISO 로 변환해 body 에 담는다(빈 값 → 미전송 → null). Meetup 오렌지 토큰.

### 디자인

- 마감 UI 모두 `(main)/home/[id]` Meetup 오렌지 토큰 사용. "마감됨" 배지는 `bg-muted`/`text-muted-foreground` 계열(차분), "마감하기" 버튼은 절제된 secondary 스타일(`border-border` + `text-muted-foreground`, 파괴적 destructive 아님 — 마감은 정상 흐름). 마감 시각 표시는 `text-muted-foreground` 보조 텍스트. login/onboarding blue 미사용.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 마이그레이션 파괴적 reset | MEDIUM | `prisma migrate dev` 가 hand-edited add_chat(realtime 트리거) 때문에 reset 시도 가능. 비파괴 패턴(migrate diff/db execute/resolve/status clean) 강제(MOIM-005/006 동일). closesAt 는 순수 nullable 추가라 SQL 단순(`ALTER TABLE poll ADD COLUMN closes_at TIMESTAMP NULL;`). |
| 클라이언트 시계 오차 마감 오판 | MEDIUM | 클라이언트가 `closesAt` 를 자기 시계로 비교하면 마감 직전/직후를 서버와 다르게 판정. **서버 계산 `isClosed`** 노출로 권위 단일화 — 클라이언트는 isClosed 만 신뢰(배지/비활성). 어긋나도 vote 409 가 최종 차단(테스트로 고정). |
| 생성자-전용 인가 누락/약화 | MEDIUM | 마감이 멤버 누구나로 새면 남의 투표를 닫을 수 있다. `closePoll` 이 assertMember(403) → poll 일관성(404) → `createdBy !== sub`(403) 순서 강제. jest: 비생성자 멤버 403 / 비멤버 403 / 생성자 200 케이스로 고정. |
| 마감 후 투표 차단 누락 | MEDIUM | vote 에 마감 검사 추가가 단일/다중 한쪽만 막으면 회귀. 검사를 분기 **앞**(poll 일관성 후)에 두어 단일·다중 공통 차단. jest: 단일 마감 409 + 다중 마감 409 + 열린 poll 투표 정상(교체/토글) 회귀로 고정. |
| 읽기 모델 추가 누락 소비처 | LOW | closesAt/isClosed 는 순수 추가(제거 아님)라 기존 소비처는 안 깨진다. 다만 web `PollWithResults` 미러·page→PollsSection 매핑이 새 필드를 채워야 함 — tsc 게이트로 누락 차단. |
| 수동 마감 멱등성 | LOW | 이미 마감된 poll 에 다시 close → now 재설정이 마감 시각을 갱신(원래 마감 시각 덮음). 멱등 의미론상 마감 상태 불변이면 충분 — now 재설정 무해(이미 <= now). jest: 두 번 close → 200 + isClosed true 유지로 고정. |
| createdAt 표시 currentUserId 전달 | LOW | "마감하기" 버튼 노출에 현재 sub 필요 → page(Server)가 세션 sub 를 PollsSection 에 prop 전달. 직렬화 가능 string 만 전달(Server→Client 경계 준수). tsc/렌더로 확인. |
| 멤버 스코핑 약화 | MEDIUM | poll service 진입(create/vote/list/close)이 첫 줄 assertMember 호출 보존(MOIM-005/006). 통합 테스트 403 케이스로 고정. closesAt 추가가 인가에 영향 없음. |
| 디자인 토큰 혼선(blue vs orange) | LOW | 마감 시각 입력·배지·버튼 추가 시 blue 복사 위험. REQ-MOIM7-007 로 오렌지 강제, 코드 리뷰. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 jest(신규 마감 + 열린 poll 투표 회귀). api-client 는 tsc. 모바일은 본 SPEC에서 무변경(회귀 0 확인용 tsc/vitest/expo export).

- `prisma migrate` clean — `Poll.closesAt` 컬럼 additive(nullable, `@default` 없음). 기존 poll/option/vote row 보존(row 손실 0). `PollVote` PK(`(pollId,optionId,userId)`)·FK·인덱스 무변경. 비파괴 패턴(migrate diff/db execute/resolve/status clean).
- backend jest 통과 — 신규: 마감 시각 생성(closesAt 수용) + 무효 ISO 400 + 마감된 poll vote 409(단일 AND 다중) + 수동 마감(생성자 200, 비생성자 멤버 403, 비멤버 403, 멱등 두 번 close 200) + isClosed 서버 계산(closesAt<=now true / closesAt>now false / null false); 회귀: closesAt 생략 생성(MOIM-005/006 동작) + 열린 poll 단일 교체(총 1표 불변) + 열린 poll 다중 토글(추가/제거) + 잘못된 optionId 400 + 다른 모임 pollId 404 + 비멤버 403 + question 빈/옵션<2 400.
- `tsc` 통과 (0 error — backend + web + api-client; closesAt/isClosed 추가 + PollWithResults 미러 + page→PollsSection currentUserId 전달 확인).
- web lint 통과 (0 error).
- `nx run web:build` 통과 (0 error — 마감 렌더 분기 + 마감 시각 입력 + "마감하기" 버튼 컴파일).
- mobile tsc / vitest / `expo export` 통과 (무변경 회귀 0).
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 모임 상세 진입 → 마감 시각 정해 투표 생성 → 마감 전 정상 투표(단일/다중) → 생성자가 "마감하기" 탭 → "마감됨" 배지 + 투표 컨트롤 비활성화 + 결과 계속 표시 확인 → 마감된 poll 투표 시도 차단(409) → 비생성자/마감 poll 에 "마감하기" 미노출 확인이 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated — Server Action `revalidatePath` 가 WebView 안에서 마감 상태를 갱신하는지 확인). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
