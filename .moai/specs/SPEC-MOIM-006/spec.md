---
id: SPEC-MOIM-006
version: 0.2.0
status: in-progress
created: 2026-06-20
updated: 2026-06-20
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-006: 투표 다중 선택(multi-select) — 가능한 항목 모두 선택

## HISTORY

- 2026-06-20 (v0.2.0): 구현 완료 + 라이브 검증(AC-1~7 자동 게이트 + 데스크톱·API 라이브) → status in-progress(device-gated). **구현 요약**: (1) 백엔드 — `Poll.multiSelect Boolean @default(false)` additive 추가, `PollVote` 복합 PK `(pollId,userId)` → `(pollId,optionId,userId)` 비파괴 마이그레이션(`add_poll_multi_select` — 기존 단일 선택 표 row 손실 0 검증, 1 row 보존 / PK 위반 0). `PollService.vote` 단일(deleteMany+create 교체)/다중(findUnique→토글) 분기, `aggregatePolls` myVote→myVotes 목록 변환. `PollResponseDto`(`multiSelect`+`myVotes[]`, `myVote` 제거), `CreatePollDto.multiSelect?`. jest 269/269(+11, 단일 선택 회귀: 재투표 교체·총 1표 불변 케이스 포함). tsc 0(backend/web/api-client). (2) api-client — `PollResponse`(`multiSelect`+`myVotes[]`) + `CreatePollRequest`(`multiSelect`) 타입 갱신, `schema.d.ts` 재생성. (3) 웹 — 생성 폼 "여러 개 선택 허용" 토글, 다중 선택 poll 체크박스형 렌더(토글·여러 선택지 동시 강조·myVotes.includes), 단일 선택 무변경(버튼·교체). myVote 전 소비처 → myVotes 마이그레이션(api-client 타입·lib/moim/polls.ts·polls-section.tsx). Server Component + Client 섬 + Server Action 구조 보존. web lint/build 0. **라이브 검증(2026-06-20)**: 데스크톱 브라우저 + API 실 세션, 모임 "주말 등산 모임". 다중 선택 poll "가능한 날짜 모두 선택"(토요일/일요일/월요일) 생성 → 토요일+월요일 토글(BOTH 강조, 50%/50%, 총 2표) → 토글 off 동작 확인. 단일 선택 poll "다음 산행 어디로 갈까요?" 버튼 렌더·교체 동작(총 1표 불변) 회귀 0 확인. API: myVotes 목록 증가(2)/감소(1) 토글 확인. AC-2~7(자동 게이트)·AC-3(단일 회귀)·AC-4(다중 토글)·AC-5(myVotes)·AC-6(웹 체크박스 UI) 라이브 PASS. AC-1(모델+비파괴 PK 마이그레이션) backend jest + migrate clean PASS. **미완료 device-gated**: 모바일 WebView poll 인터랙션(Server Action + revalidatePath WebView 컨텍스트)이 iOS 시뮬레이터에서 미검증. 자동 게이트 단독으로 completed 전환 불가(프로젝트 메모리 규칙: mobile-spec-device-gated). mobile vitest 215/215(회귀 0 — 모바일 무변경).
- 2026-06-20 (v0.1.0): 최초 draft. SPEC-MOIM-005(단일 선택 투표)의 직속 후속. MOIM-005 가 만든 poll 도메인(`Poll`/`PollOption`/`PollVote`, `@Controller('moims/:id/polls')`, 단일 투표 = 교체, 웹 Server Component + Client 섬 + Server Action)을 verified 기준으로 확장한다. **WHY**: 모임에서 가장 자주 쓰이는 투표는 날짜/가용성 투표("가능한 날짜 모두 선택")이며, 이는 멤버당 **다수 선택**을 필요로 한다 — 단일 선택(현재)으로는 표현할 수 없다. 본 SPEC은 **poll 별 opt-in 다중 선택**을 추가한다. 핵심 결정: (1) **모델** — `Poll.multiSelect Boolean @default(false)` additive 추가(기존 row 는 모두 false 로 단일 선택 보존), `PollVote` 복합 PK 를 `(pollId, userId)` → `(pollId, optionId, userId)` 로 변경해 한 멤버가 한 poll 에 옵션당 한 표씩 0..N 표를 보유 가능하게 한다. **데이터 안전성**: 기존 단일 선택 표는 (pollId,userId) 당 정확히 한 row 이므로 그 (pollId,optionId,userId) 조합이 이미 유일하다 → 새 PK 를 NO data loss 로 만족한다(비파괴: migrate diff/db execute/migrate resolve/verify clean 로 정확 SQL 생성·적용). (2) **투표 의미론** — `PollService.vote` 가 `poll.multiSelect` 로 분기한다. 단일(false)은 **변경 없음**(표 교체, 최대 1). 다중(true)은 **토글**(없으면 추가/있으면 제거, 0..N). 엔드포인트는 `POST .../vote {optionId}` 그대로(단일→교체, 다중→토글). (3) **읽기 모델 변경(genuine break)** — 호출자 자신의 선택이 단일 `myVote: string | null` 에서 **목록 `myVotes: string[]`** 로 바뀐다. 이는 PollResponseDto·api-client `PollResponse`·web `PollWithResults`·web `OptionRow` 강조 비교(`myVote === option.id` → `myVotes.includes(option.id)`)를 모두 깨는 변경이며, 마이그레이션 게이트로 고정한다. (4) **생성** — `POST /moims/:id/polls` 가 optional `multiSelect`(기본 false)를 받는다. 단일 선택 생성은 무변경. (5) **웹** — 생성 폼에 "여러 개 선택 허용" 토글 추가, 다중 선택 poll 은 체크박스형(토글, 다중 강조) 렌더, 단일 선택 poll 은 무변경(교체). 모두 Meetup 오렌지 토큰 + Server Component/Client 섬/Server Action 구조 보존. (6) **api-client** — 백엔드 OpenAPI 변경 반영해 `schema.d.ts` 재생성. **스코프 결정 기록**: (a) multiSelect 는 **poll 별 opt-in** 플래그(전역 모드 아님); (b) PK 변경은 데이터 안전(기존 표 보존, 비파괴); (c) 단일=교체 / 다중=토글, 엔드포인트 동일; (d) 마감/종료·수정/삭제·익명·실시간·날짜 특수화·모바일 코드는 모두 **제외**(§4) — 마감·실시간은 향후 후속.

---

## 1. 개요 (Overview)

SPEC-MOIM-005 는 **단일 선택 투표**를 만들었다 — 한 멤버는 한 poll 에서 정확히 한 선택지에 투표하고, 다시 투표하면 표가 교체된다(`PollVote` 의 `(pollId, userId)` PK 가 강제). 그러나 모임에서 가장 흔한 투표는 **"가능한 날짜/시간을 모두 골라 주세요"** 형태의 가용성 투표이며, 이는 멤버당 **여러 선택**을 필요로 한다. 본 SPEC은 그 한 걸음을 채운다.

본 SPEC의 다중 선택은 **poll 단위 opt-in** 이다:

1. **생성 시 선택** — 투표를 만들 때 "여러 개 선택 허용"(`multiSelect`)을 켜면 그 poll 은 다중 선택, 끄면(기본) 단일 선택이다. 전역 모드가 아니라 **poll 마다** 결정한다.
2. **다중 토글** — 다중 선택 poll 에서 멤버는 한 선택지를 탭하면 자기 표를 **추가**하고, 이미 고른 선택지를 다시 탭하면 **제거**한다(토글). 멤버는 0..N 개를 보유할 수 있다.
3. **단일 보존** — 단일 선택 poll 의 동작은 **그대로**다(MOIM-005 회귀 0). 한 선택지를 탭하면 멤버의 표가 그 선택지로 교체된다(최대 1).

데이터는 `moim`·`poll`·`poll_option` 테이블을 건드리지 않고 **`Poll.multiSelect` 컬럼 1개 additive 추가 + `PollVote` 복합 PK 변경**만 한다. PK 변경(`(pollId, userId)` → `(pollId, optionId, userId)`)은 기존 단일 선택 표를 한 row 도 잃지 않는다 — 단일 선택 표는 (pollId,userId) 당 한 row 라 그 (pollId,optionId,userId) 가 이미 유일하기 때문이다(§5 데이터 안전성 논증). 마이그레이션은 MOIM-005 와 동일한 **비파괴 패턴**(migrate diff → db execute → migrate resolve --applied → migrate status clean)으로 적용한다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 다중 선택 UI 는 모임 상세(`/home/[id]`) 안에서 in-WebView 로 렌더되므로 **모바일 신규 코드는 없다**.

이는 **컬럼 1개 + PK 1개 변경 + vote 분기 + 읽기 모델 myVote→myVotes + 생성 토글 + 다중 렌더**이지 대형 기능이 아니다. 마감·실시간·날짜 특수화·익명·수정/삭제는 모두 제외한다(§4).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 6개로 제한한다. 각 모듈은 `REQ-MOIM6-XXX`로 번호를 부여하며(기존 `REQ-MOIM5-XXX` 등과 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM6-001: 다중 선택 데이터 모델 + 비파괴 마이그레이션 (Ubiquitous)

- **The backend shall** `Poll` 에 `multiSelect Boolean @default(false)` 컬럼을 **additive**(기존 컬럼·관계 무변경)로 추가한다 — 기존 poll row 는 모두 `multiSelect = false`(단일 선택 보존).
- **The backend shall** `PollVote` 의 복합 PK 를 `(pollId, userId)` 에서 `(pollId, optionId, userId)` 로 변경해 한 멤버가 한 poll 에서 옵션당 한 표씩 **0..N 개의 표**를 보유할 수 있게 한다(다중 선택 불변식).
- **The backend shall** 이 변경을 **비파괴(데이터 보존) 마이그레이션**으로 적용한다 — 기존 단일 선택 표는 (pollId,userId) 당 정확히 한 row 이므로 그 `(pollId, optionId, userId)` 가 이미 유일하여 새 PK 를 위반 없이 만족한다(드롭/추가 시 row 손실 0). `moim`/`moim_member`/`moim_invite`/`chat_message`/`poll`(컬럼 추가 외)/`poll_option` 과 그 동작(생성·목록·상세·멤버·채팅·초대·단일 투표)은 어떤 회귀도 없이 보존된다.
- **The backend shall** poll/option/moim 삭제 시 그 표가 Cascade 로 정리되도록 기존 FK(cascade)를 보존한다(PK 변경이 FK cascade 동작을 약화하지 않는다).
- **The backend shall** 비파괴 패턴(`prisma migrate diff` → `prisma db execute` → `prisma migrate resolve --applied` → `prisma migrate status` clean)으로 적용한다 — hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 `prisma migrate dev` 의 파괴적 reset 을 피한다(MOIM-005 선례).

### REQ-MOIM6-002: 투표 생성 — multiSelect 옵트인 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 멤버가 `{ question, options[], multiSelect? }` 로 `POST /moims/:id/polls` 를 호출하면, **the backend shall** poll + 옵션을 하나의 트랜잭션으로 생성하고 `Poll.multiSelect` 를 요청 값(미지정/falsy 면 `false`)으로 설정한다.
- (Ubiquitous) **The backend shall** `multiSelect` 가 생략된 요청을 단일 선택(`false`) poll 로 생성한다 — 단일 선택 생성 경로는 MOIM-005 와 동작이 동일하다(회귀 0).
- (Unwanted behavior) **IF** `question` 이 (trim 후) 비어 있거나 (trim 후) 비어 있지 않은 옵션이 **2개 미만**이면, **then the backend shall** `400 Bad Request` 를 반환한다(MOIM-005 와 동일한 no-ValidationPipe 명시 검사 — multiSelect 추가가 이 검증을 바꾸지 않는다).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` 단일 출처 — 약화 금지).

### REQ-MOIM6-003: 투표 — 단일 교체 / 다중 토글 (Event-driven / State-driven / Unwanted behavior 혼합)

- (State-driven, 단일) **WHILE** 대상 poll 의 `multiSelect` 가 `false` 인 동안, **WHEN** 멤버가 `{ optionId }` 로 `POST /moims/:id/polls/:pollId/vote` 를 호출하면, **the backend shall** 그 멤버의 표를 **교체**한다 — 그 poll 의 다른 표를 제거하고 `optionId` 한 표만 남긴다(멤버당 정확히 한 표, MOIM-005 동작 보존).
- (State-driven, 다중) **WHILE** 대상 poll 의 `multiSelect` 가 `true` 인 동안, **WHEN** 멤버가 `{ optionId }` 로 같은 라우트를 호출하면, **the backend shall** 그 `(pollId, optionId, userId)` 표를 **토글**한다 — 없으면 추가하고, 이미 있으면 제거한다(멤버는 0..N 표 보유).
- (Unwanted behavior) **IF** `optionId` 가 해당 poll 에 속한 옵션이 아니면(다른 poll 의 옵션이거나 미존재이면), **then the backend shall** `400 Bad Request` 를 반환한다(교차-poll 집계 오염 차단 — 단일/다중 공통).
- (Unwanted behavior) **IF** `pollId` 가 path 의 모임에 속한 poll 이 아니면(또는 미존재이면), **then the backend shall** `404 Not Found` 를 반환한다(poll-모임 일관성 — MOIM-005 동일).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면, **then the backend shall** `403 Forbidden` 을 반환한다(`assertMember`).

### REQ-MOIM6-004: 투표 목록 + 결과 조회 — multiSelect + myVotes 목록 (Ubiquitous / Unwanted behavior 혼합)

- (Ubiquitous) **The `GET /moims/:id/polls` response shall** 각 poll 에 대해 `id`/`question`/`createdBy`/`createdAt`, **`multiSelect`(boolean)**, 옵션 배열(각 옵션의 `id`/`label`/`voteCount`), 그리고 **호출자 자신이 고른 선택지들의 목록**(`myVotes: string[]` — 미투표면 빈 배열 `[]`)을 포함한다.
- (Ubiquitous, 읽기 모델 변경) **The backend shall** 단일 `myVote: string | null` 을 **목록 `myVotes: string[]`** 으로 대체한다 — 단일 선택 poll 은 0개 또는 1개 요소, 다중 선택 poll 은 0..N 개 요소. 이는 MOIM-005 의 읽기 표면을 의도적으로 깨는 변경이며(아래 §3 [BREAK]), api-client/web 의 모든 소비처가 함께 갱신된다.
- (Ubiquitous) **The backend shall** 각 옵션의 `voteCount` 를 `PollVote` 집계로 정확히 계산한다 — 다중 선택 poll 에서는 한 옵션의 `voteCount` 가 그 옵션을 고른 **서로 다른 멤버 수**와 같다(멤버당 옵션당 한 표). 표 0 인 옵션은 `voteCount = 0`.
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember`).
- (Ubiquitous) **The backend shall** poll 이 하나도 없는 모임에 대해 **빈 배열**을 반환한다(에러 아님).

### REQ-MOIM6-005: api-client 투표 표면 갱신 (Ubiquitous)

- **The api-client shall** 백엔드 OpenAPI 변경(`CreatePollDto.multiSelect`, `PollResponseDto.multiSelect` + `myVotes`)을 반영해 생성 `schema.d.ts` 를 재생성한다(수동 편집 없음).
- **The api-client shall** 기존 poll 타입 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`)을 유지하되, 재생성으로 `PollResponse` 에 `multiSelect` 와 `myVotes` 가 반영되고 `myVote` 가 제거되도록 한다.
- **The web app shall** path-param 투표 라우트를 web 의 **구체-경로 헬퍼**(`lib/moim/polls.ts`)로 호출하는 기존 패턴을 유지하고, `PollWithResults`(web 미러 타입)를 `multiSelect: boolean` + `myVotes: string[]` 로 갱신한다(`myVote: string | null` 제거).
- **The api-client/web shall** 토큰을 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).

### REQ-MOIM6-006: 웹 다중 선택 UI (Event-driven / State-driven / Ubiquitous 혼합)

- (Event-driven) **WHEN** 멤버가 "투표 만들기" 폼에서 "여러 개 선택 허용" 토글을 켜고 제출하면, **the web app shall** 생성 엔드포인트에 `multiSelect: true` 를 전달해 다중 선택 poll 을 만든다(토글 끄면 단일 선택, 기본 끔).
- (State-driven, 다중) **WHILE** 한 poll 의 `multiSelect` 가 `true` 인 동안, **the web app shall** 그 poll 을 **다중 선택형(체크박스 스타일)**으로 렌더한다 — 멤버가 고른 모든 선택지가 동시에 강조되고, 한 선택지를 탭하면 그 선택지가 토글(추가/제거)되며, 결과(득표 수/퍼센트)가 갱신된다.
- (State-driven, 단일) **WHILE** 한 poll 의 `multiSelect` 가 `false` 인 동안, **the web app shall** MOIM-005 의 단일 선택 렌더·동작을 **그대로** 유지한다(한 선택지만 강조, 탭 시 교체) — 단일 선택 UX 회귀 0.
- (Ubiquitous) **The web app shall** 각 poll 의 옵션별 라벨·득표 수·총표 대비 퍼센트 시각화(막대 등)를 단일/다중 모두에 대해 렌더한다.
- (Unwanted behavior) **IF** 투표/생성이 백엔드 오류(400/403/404/네트워크)를 반환하면, **then the web app shall** 폼/화면에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 재시도할 수 있게 한다.
- (Ubiquitous) **The web app shall** 투표 섹션·생성 폼·토글을 Meetup 디자인 시스템(`(main)/home/[id]` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 MOIM-005 가 만든 poll 도메인을 확장한다. 파일·라인은 작성 시점(2026-06-20) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/moim/moim.service.ts` `assertMember` — 멤버십 인가 단일 출처. **재사용만** — poll 서비스가 호출해 멤버 스코핑을 강제한다. 변경 없음.
- `apps/backend/prisma/schema.prisma` `Moim`/`MoimMember`/`MoimInvite`/`ChatMessage`/`PollOption`(:36~148) — **무변경**. `Poll` 은 컬럼 1개 추가([MODIFY]), `PollVote` 는 PK 변경([MODIFY]).
- `apps/backend/src/poll/poll.controller.ts` 의 라우트 형태·가드·`requireNonEmpty`/`normalizeOptions` 헬퍼·400/403/404 정책 — 보존. `create` 가 `multiSelect` 를 추가로 전달하고, `vote` 의 응답 매핑(myVote→myVotes)만 바뀐다([MODIFY] 내부).
- `apps/web/app/(main)/home/[id]/poll-actions.ts` 의 `voteAction` 시그니처(`moimId, pollId, optionId`)·세션·`revalidatePath` 흐름 — 보존(다중 토글도 동일 라우트·동일 시그니처로 동작). `createPollAction` 은 `multiSelect` 읽기만 추가([MODIFY] 내부).
- `apps/web/lib/moim/polls.ts` 의 `listPolls`/`createPoll`/`votePoll` 구체-경로 헬퍼 시그니처 — 보존(타입만 갱신).
- `apps/mobile/**` — **모바일 무변경**. 다중 선택 UI 는 `/home/[id]` 안에서 in-WebView 로 렌더되고, 상세 라우트 네이티브 push 는 SPEC-MOIM-003 계약이 처리한다. 신규 네이티브 코드 없음.

### [MODIFY] (수정)

- `apps/backend/prisma/schema.prisma`:
  - `model Poll` — `multiSelect Boolean @default(false) @map("multi_select")` 1줄 추가(컬럼 추가 — 기존 컬럼·관계·인덱스 무변경).
  - `model PollVote` — `@@id([pollId, userId])` → `@@id([pollId, optionId, userId])` 로 복합 PK 변경(컬럼은 그대로, PK 구성만 확장). 기존 `@@index([optionId])` 보존.
- `apps/backend/src/poll/dto/create-poll.dto.ts` — `multiSelect?: boolean`(`@ApiProperty({ required: false, default: false })`) 추가.
- `apps/backend/src/poll/dto/poll-response.dto.ts` — `multiSelect: boolean` 추가 + `myVote: string | null` 제거 → `myVotes: string[]`(`@ApiProperty({ type: [String] })`)로 대체.
- `apps/backend/src/poll/poll.service.ts`:
  - `createPoll(sub, moimId, question, options, multiSelect)` — multiSelect 파라미터 추가 → `poll.create` data 에 `multiSelect`.
  - `vote(sub, moimId, pollId, optionId)` — poll 일관성·optionId 검증(보존) 후 `poll.multiSelect` 로 분기: false → 기존 교체(그 poll 의 호출자 표 모두 delete 후 한 표 create, 또는 동등한 replace); true → `(pollId,optionId,userId)` 토글(존재하면 delete, 없으면 create). PK 변경으로 `pollVote.upsert({ where: { pollId_userId }})` 는 더 이상 유효하지 않다(복합 키 변경) → 명시적 find/delete/create 로 재작성.
  - `aggregatePolls` — 각 poll 의 `multiSelect` 포함, 호출자 표를 **pollId → optionId 목록**으로 모아 `myVotes: string[]` 매핑(기존 `myVote` 단일 매핑 대체). voteCount 집계 로직(groupBy by optionId)은 그대로 유효(멤버당 옵션당 한 표라 count 가 멤버 수).
  - `PollWithResults` 인터페이스 — `multiSelect: boolean` + `myVotes: string[]`(myVote 제거). `PollWithOptions` 의 신규 poll DTO 매핑도 myVotes:[] 로.
- `apps/backend/src/poll/poll.controller.ts` — `create` 가 `body.multiSelect` 를 `createPoll` 에 전달, `newPollToDto`/`resultToDto` 가 `multiSelect` + `myVotes`(신규 poll 은 `[]`)로 매핑.
- `packages/api-client/src/index.ts` — 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`) 유지(주석 갱신 — `myVote` → `myVotes`/`multiSelect`). 재생성으로 underlying schema 가 바뀐다.
- `packages/api-client/src/schema.d.ts` — `nx run api-client:generate` 재생성(신규 multiSelect/myVotes 반영). 수동 편집 없음.
- `apps/web/lib/moim/polls.ts` — `PollWithResults` 타입을 `multiSelect: boolean` + `myVotes: string[]`(myVote 제거)로 갱신. 헬퍼 시그니처 무변경.
- `apps/web/app/(main)/home/[id]/poll-actions.ts` — `createPollAction` 이 FormData 에서 `multiSelect`(체크박스) 를 읽어 `createPoll` body 에 전달. `voteAction` 무변경.
- `apps/web/app/(main)/home/[id]/polls-section.tsx`:
  - `OptionRow` — `isMine` 비교를 단일(`myVote === option.id`)에서 `myVotes.includes(option.id)` 로 변경(단일/다중 공통 — 단일은 최대 1개라 동작 동일).
  - `PollCard` — `poll.multiSelect` 로 분기: 다중이면 체크박스형 시각·문구("가능한 항목 모두 선택")·여러 강조 허용, 단일이면 기존 그대로. `aria-pressed`/`role` 적절화.
  - `CreatePollForm` — "여러 개 선택 허용" 토글(checkbox `name="multiSelect"`) 추가(Meetup 오렌지). 기본 꺼짐.
- `apps/web/app/(main)/home/[id]/page.tsx` — **로직 무변경**(이미 `listPolls` fetch + `<PollsSection/>` 마운트). 타입(`PollWithResults`)이 갱신되며 그대로 흐른다.

### [BREAK] (의도적 호환성 단절)

- **읽기 모델 `myVote: string | null` → `myVotes: string[]`**: PollResponseDto·api-client `PollResponse`·web `PollWithResults`·web `OptionRow` 강조 비교가 모두 깨진다. 이는 다중 선택을 표현하려면 불가피하다(단일 값으로 0..N 선택을 담을 수 없다). 단일 선택 poll 도 `myVotes`(0 또는 1 요소)로 통일해 분기 코드를 줄인다. 마이그레이션·tsc 게이트로 누락 소비처를 차단한다.

### [REMOVE]

- 없음(컬럼/타입 추가 + PK 확장 + 읽기 모델 교체 — 테이블·라우트·파일 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **전역 다중 선택 모드** — multiSelect 는 **poll 별 플래그**다. 모임 전체나 앱 전역의 다중 선택 설정은 두지 않는다(각 poll 이 생성 시 독립적으로 결정).
- **선택 개수 상한(min/max selections)** — 다중 선택 poll 에서 "최소 1개 / 최대 3개" 같은 선택 수 제약은 범위 밖. 멤버는 0..N(전체) 개를 자유롭게 토글한다. 상한 정책은 향후 후속(별도 컬럼 + 검증 필요).
- **투표 마감 / 종료 시각 / 잠금(close/lock)** — MOIM-005 와 동일하게 poll 은 무기한 열려 있다(향후).
- **투표 수정 / 삭제(edit/delete poll)** — 질문·옵션 편집이나 poll 삭제 UI 는 범위 밖. 단, moim/poll/option 삭제 시 Cascade 정리는 FK 로 보장(데이터 무결성 — 제약이지 UI 아님).
- **익명 투표(anonymous voting)** — 본 SPEC은 득표 **수**(`voteCount`)와 **내 선택 목록**(`myVotes`)만 노출한다. "누가 무엇에 투표했는지"의 타인별 표 공개는 다루지 않는다. 다중 선택이 이를 바꾸지 않는다(여전히 집계 + 자기 표만).
- **실시간 라이브 갱신(Supabase Realtime)** — 결과는 투표/페이지 로드 시 재조회(`revalidatePath`)로 갱신한다(MOIM-005 동일). 채팅 Realtime 미러는 향후.
- **날짜 후보 투표(date-candidate poll) 특수화** — 다중 선택은 날짜 투표의 *기반*이지만, 본 SPEC은 **일반 다중 선택**(자유 텍스트 옵션)만 다룬다. 날짜 피커·`Moim.startsAt` 자동 반영 등 특수 배선은 향후.
- **모바일 신규 코드** — 다중 선택 UI 는 웹 상세가 소유하고 모바일 WebView 안에서 렌더된다. expo-router 네이티브 라우트/컴포넌트를 추가하지 않는다(SPEC-MOIM-003 계약 재사용).
- **투표 알림 / 푸시** — 새 투표·결과 변동 FCM 푸시는 범위 밖(SPEC-CHAT-002 인프라 무변경).
- **선택지 표시 순서 보장 컬럼(position)** — MOIM-005 와 동일하게 `PollOption` 에 `position` 을 두지 않고 결정적 키(`id`)로 안정 정렬한다(향후 작업).

---

## 5. 설계 노트 (Design Notes)

### PK 변경의 데이터 안전성 논증 (핵심 결정)

- 현재 PK: `PollVote @@id([pollId, userId])` — (pollId,userId) 당 정확히 한 row(단일 투표 강제).
- 신규 PK: `@@id([pollId, optionId, userId])` — (pollId,optionId,userId) 당 한 row(멤버가 옵션당 한 표, 옵션 여러 개 가능).
- **데이터 손실 0 논증**: 기존의 모든 PollVote row 는 (pollId,userId) 가 유일하다 → 같은 (pollId,userId) 에 두 row 가 없으므로 그들의 (pollId,optionId,userId) 도 자동으로 모두 유일하다. 즉 기존 데이터 집합은 **신규 PK 제약을 이미 위반 없이 만족**한다. 따라서 "기존 PK DROP → 신규 PK ADD" 는 어떤 row 도 충돌·삭제하지 않는다(순수 제약 재정의). 단일 선택 poll 의 표는 그대로 살아 있고, 그 poll 들의 `multiSelect=false` 가 vote 분기에서 계속 교체 동작을 유지한다.
- **마이그레이션 SQL 형태**(비파괴): `ALTER TABLE poll ADD COLUMN multi_select BOOLEAN NOT NULL DEFAULT false;` + `ALTER TABLE poll_vote DROP CONSTRAINT poll_vote_pkey;` + `ALTER TABLE poll_vote ADD PRIMARY KEY (poll_id, option_id, user_id);`. 정확 SQL 은 `prisma migrate diff`(스키마↔DB)로 생성·검토 → `prisma db execute` 로 적용 → `prisma migrate resolve --applied {TS}_add_poll_multi_select` → `prisma migrate status` clean(MOIM-005 add_poll 선례). `prisma migrate dev` 의 파괴적 reset 회피(hand-edited add_chat 트리거 보존).

### vote 분기 재작성 (upsert → find/delete/create)

- 현재 `vote` 는 `pollVote.upsert({ where: { pollId_userId }, create, update: { optionId } })` 로 교체한다. PK 가 `(pollId,optionId,userId)` 로 바뀌면 Prisma 의 복합-키 `where` 식별자가 `pollId_userId` → `pollId_optionId_userId` 로 바뀌어 기존 upsert 형태는 그대로 쓸 수 없다.
- 결정(분기):
  - **단일(multiSelect=false)**: assertMember → poll 일관성(404) → optionId 소속(400) 검증 후, **그 poll 의 호출자 표를 모두 삭제하고**(`deleteMany({ where: { pollId, userId: sub } })`) 선택한 한 표를 `create` 한다(트랜잭션). 결과는 멤버당 정확히 한 표 — MOIM-005 동작 보존(교체).
  - **다중(multiSelect=true)**: 같은 검증 후, `(pollId,optionId,userId)` 표를 `findUnique` → 있으면 `delete`(토글 off), 없으면 `create`(토글 on). 결과는 멤버 0..N 표.
- 두 분기 모두 끝에 `aggregatePolls(sub, [poll])` 로 갱신된 단건 poll(집계 + myVotes)을 반환해 web 이 재조회 없이 즉시 반영할 수 있게 한다(MOIM-005 반환 형태 보존, myVote→myVotes 만 변경).

### 읽기 모델 myVote → myVotes (genuine break)

- MOIM-005 응답: `myVote: string | null`(단일 선택 id). 다중 선택은 0..N 선택을 담아야 하므로 단일 값으로 표현 불가 → **`myVotes: string[]`** 로 교체한다.
- 단일 선택 poll 도 `myVotes`(빈 배열 또는 1요소)로 통일 — 클라이언트가 `multiSelect` 와 무관하게 `myVotes.includes(optionId)` 로 강조를 판정해 분기 코드를 최소화한다.
- 영향 소비처(모두 갱신, tsc 게이트로 고정): PollResponseDto → OpenAPI → api-client `PollResponse` → web `PollWithResults` → web `OptionRow`(`isMine`). MOIM-005 의 `myVote === option.id` 단일 비교는 제거된다.

### 웹 — 단일/다중 렌더 분기 (Server Component + Client 섬 보존)

- `page.tsx`(Server)는 무변경 — 이미 `listPolls` fetch + `<PollsSection/>` 마운트. 타입 갱신이 그대로 흐른다.
- `PollCard`(Client)가 `poll.multiSelect` 로 분기: 다중이면 체크박스형 어포던스(여러 강조 동시 표시 + "가능한 항목 모두 선택" 안내 + 탭=토글), 단일이면 MOIM-005 그대로(한 강조 + 탭=교체). `OptionRow` 의 `isMine` 은 `myVotes.includes(option.id)` 로 통일.
- `CreatePollForm` 에 "여러 개 선택 허용" 체크박스(`name="multiSelect"`) 추가 — `createPollAction` 이 `formData.get("multiSelect")` 로 읽어 body 에 boolean 으로 전달. 기본 꺼짐(단일 선택). Meetup 오렌지 토큰.

### 디자인

- 단일/다중 공통으로 `(main)/home/[id]` Meetup 오렌지 토큰 사용(`bg-primary` 막대/강조, `border-border`/`bg-card`/`text-muted-foreground` 등). 다중 강조도 단일과 같은 `ring-primary`/`bg-primary/5` 계열을 여러 행에 적용한다. login/onboarding blue 미사용.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| PK 변경 마이그레이션 데이터 손실 | MEDIUM | 기존 PK DROP + 신규 PK ADD 시 row 손실 우려. **데이터 안전 논증**(§5): 기존 (pollId,userId) 유일 → (pollId,optionId,userId) 자동 유일 → 신규 PK 위반 0 → row 손실 0. 비파괴 패턴(migrate diff/db execute/resolve)으로 SQL 검토 후 적용, migrate status clean + 기존 단일 표 보존 확인. |
| 마이그레이션 파괴적 reset | MEDIUM | `prisma migrate dev` 가 hand-edited add_chat(realtime 트리거) 때문에 reset 시도 가능. 비파괴 패턴 강제(MOIM-005 동일). |
| 읽기 모델 break 누락 소비처 | MEDIUM | myVote→myVotes 변경 시 갱신 안 된 소비처가 런타임 오류를 낸다. tsc(backend/web/api-client)가 타입 불일치를 컴파일 타임에 차단 — 모든 소비처(DTO/api-client/web 헬퍼/OptionRow) 동시 갱신. web build 게이트로 추가 확인. |
| upsert→분기 재작성 회귀 | MEDIUM | upsert 제거 후 단일 분기(deleteMany+create)가 교체 의미론을 깨면 MOIM-005 회귀. jest 단일 선택 회귀 케이스(투표→재투표 교체, 총 1표 불변)로 고정. |
| 다중 토글 경쟁 조건 | LOW | 같은 멤버가 같은 옵션을 동시에 두 번 토글하면 race 가능. (pollId,optionId,userId) PK 가 중복 create 를 충돌시키고, delete 는 멱등 — MVP 허용(단일 사용자 동시 클릭 드묾). |
| voteCount 의미 혼동(다중) | LOW | 다중에서 voteCount = 그 옵션을 고른 멤버 수(멤버당 옵션당 한 표). 총표(sum)는 멤버 수보다 클 수 있음 — 퍼센트는 총표 대비로 표시(합 100% 아님). 설계 노트·테스트로 명확화. |
| 멤버 스코핑 약화 | MEDIUM | poll service 진입(create/vote/list)이 첫 줄 assertMember 호출 보존(MOIM-005) — 통합 테스트 403 케이스로 고정. PK 변경이 인가에 영향 없음. |
| 디자인 토큰 혼선(blue vs orange) | LOW | 토글 추가 시 blue 복사 위험. REQ-MOIM6-006 으로 오렌지 강제, 코드 리뷰. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 jest(신규 다중 선택 + 단일 선택 회귀). api-client 는 tsc. 모바일은 본 SPEC에서 무변경(회귀 0 확인용 tsc/vitest/expo export).

- `prisma migrate` clean — `Poll.multiSelect` 컬럼 additive + `PollVote` PK `(pollId,optionId,userId)` 비파괴 마이그레이션. 기존 단일 선택 표 보존(row 손실 0). 비파괴 패턴(migrate diff/db execute/resolve/status clean).
- backend jest 통과 — 신규: 다중 선택 생성(multiSelect:true) + 다중 토글(추가/제거) + 다중 voteCount(멤버 수) + myVotes 목록; 회귀: 단일 선택 생성(multiSelect 생략/false) + 단일 교체(재투표 총 1표 불변) + 잘못된 optionId 400 + 다른 모임 pollId 404 + 비멤버 403 + question 빈/옵션<2 400.
- `tsc` 통과 (0 error — backend + web + api-client; myVote→myVotes 모든 소비처 갱신 확인).
- web lint 통과 (0 error).
- `nx run web:build` 통과 (0 error — 다중 렌더 분기 + 생성 토글 컴파일).
- mobile tsc / vitest / `expo export` 통과 (무변경 회귀 0).
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 모임 상세 진입 → "여러 개 선택 허용" 켜고 투표 생성 → 다중 선택 poll 에서 여러 선택지 토글(추가/제거, 여러 강조 동시) → 득표 수/퍼센트 갱신 → 단일 선택 poll 회귀(한 강조, 탭=교체) 확인이 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated — Server Action `revalidatePath` 가 WebView 안에서 결과를 갱신하는지 확인). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
