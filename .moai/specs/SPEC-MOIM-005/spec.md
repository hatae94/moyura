---
id: SPEC-MOIM-005
version: 0.3.0
status: completed
created: 2026-06-19
updated: 2026-06-22
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-005: 모임 투표(poll) — 생성·단일 투표·결과 집계

## HISTORY

- 2026-06-22 (v0.3.0): device-gated 검증 완료 → status in-progress → completed. 모바일 WebView 셸에서 poll 생성/투표 Server Action + revalidatePath 결과 렌더 검증 완료. 근거: (1) Maestro iOS 시뮬레이터(iPhone 16) hands-free in-WebView 검증(2026-06-22) — 네이티브 셸 부팅 + 로그인(하태용) + 모임 상세 네이티브 push + 전 poll WebView 렌더 + invite-accept + CHAT-001 채팅 렌더. (2) 데스크톱 멀티탭 워크스루(chrome-devtools, alice/bob 격리 세션) — 투표 생성·단일 투표·재투표 교체(총 1표 불변)·결과 집계·per-user myVote. (3) 라이브 통합(poll-finalize.live.mts 15/15 + poll-place-finalize.live.mts 13/13, 실 Supabase) + backend jest 308 그린. 참고: Maestro poll-option 직접 탭은 a11y resolution + Next dev badge overlay로 불안정(도구 한계, 앱 결함 아님) — 투표 자체는 데스크톱 멀티탭 + live.mts로 실증.
- 2026-06-19 (v0.2.0): 구현 완료 + 라이브 검증 기록. 백엔드: Poll/PollOption/PollVote 신규 3 테이블 additive 추가(마이그레이션 `add_poll`), `PollVote(pollId, userId)` 복합 PK로 단일 투표 불변식 DB 강제. `PollController(@Controller('moims/:id/polls'))` + `PollService`(assertMember 재사용) 신규 도메인 모듈(`apps/backend/src/poll/`). POST 생성(멤버 전용, question+옵션≥2, 빈 question/옵션<2→400, 비멤버→403), POST `:pollId/vote`(단일 투표 upsert, 재투표=교체, 잘못된 optionId→400), GET(옵션별 voteCount+myVote+비멤버 403). jest 258/258(poll 36 케이스), branch 85.14%. api-client: `CreatePollRequest`/`VoteRequest`/`PollResponse` 타입 별칭. 웹(Meetup 오렌지): `lib/moim/polls.ts` 구체-경로 헬퍼; `app/(main)/home/[id]/poll-actions.ts` Server Action(`createPollAction`/`voteAction` + `revalidatePath`); `polls-section.tsx` Client 하위 컴포넌트(투표 막대+득표 수/퍼센트+내 표 강조+생성 폼+빈 상태); `page.tsx` Server Component 유지(poll fetch + Client 섬 마운트). 라이브 검증(2026-06-19, 데스크톱 브라우저, 실 세션, 모임 "주말 등산 모임"): 빈 상태 "아직 투표가 없어요" 확인 → "투표 만들기" → "다음 산행 어디로 갈까요?"/북한산·관악산 생성(poll count 1, 0표) → 북한산 투표(1표/100%, 내 표 강조, "총 1표 · 내 선택이 반영됐어요") → 관악산 재투표(표 교체 — 관악산 1표/100%, 북한산 0표, 총 1표 불변 = 추가 아닌 교체 확인). AC-1~5 라이브 PASS. 자동 게이트: jest 258/258, tsc 0(all), web lint/build 0, mobile vitest 215/215(회귀 0), prisma migrate clean. **미완료(device-gated)**: poll 생성/투표 Server Action + `revalidatePath`가 iOS 시뮬레이터 모바일 WebView 셸 안에서 동작하여 결과가 갱신되는지 검증 대기. status in-progress 유지. **소소한 UX 메모**: 투표 생성 성공 후 생성 폼이 자동 닫힘/초기화되지 않고 열린 상태로 남음 — 코스메틱, 별도 후속 수정 대상.
- 2026-06-19 (v0.1.0): 최초 draft. 이벤트 트라이어드(일정·장소·투표)의 마지막 조각. SPEC-MOIM-004 가 일정/장소를 추가하며 투표를 명시적으로 카브아웃("poll 엔티티 + options + per-user votes + 결과 집계 UI 가 필요한 별도·대형 후속 SPEC", MOIM-004 spec.md:124)했고, 제품 로그인 태그라인("일정, 장소, 투표를 한곳에서")이 가리키는 세 번째 기능이다 — 본 SPEC이 그 후속이다. **MVP 단일 선택 투표**로 범위를 한정한다. 핵심 결정: (1) 데이터 모델 — `moim` 테이블 무변경, **신규 3 테이블만 additive CREATE**(`Poll`/`PollOption`/`PollVote`). `PollVote` 의 복합 PK `(pollId, userId)` 가 "멤버당 한 투표(변경 가능)" 불변식을 DB 레벨에서 강제한다(MoimMember 의 `(moimId, userId)` 복합 PK 패턴 동일). (2) 멤버 스코핑 — 채팅과 동일하게 모임 멤버만 생성/투표/조회 가능(비멤버 403). 어느 멤버나 투표 생성(질문 + 옵션 ≥2), 어느 멤버나 투표당 1표(재투표 = 선택 변경, upsert on `(pollId,userId)`). (3) 엔드포인트 shape — **모든 투표 라우트를 `/moims/:id/polls` 하위에 중첩**한다(ChatController 의 `@Controller('moims/:id/messages')` 패턴 미러 — moimId 가 항상 path 에 있어 `assertMember(sub, moimId)` 직접 호출, poll→moim 역방향 lookup 불필요). (4) 웹 — `/home/[id]` 상세(현재 읽기 전용 Server Component)에 투표 섹션 추가. **투표/생성은 인터랙티브하므로 Server Component 본체는 데이터 fetch + 가드를 유지하고, 투표 컨트롤·생성 폼은 Client 하위 컴포넌트 + Server Action**(MOIM-004 `createMoimAction`/온보딩 패턴)으로 분리한다. 결과는 액션/페이지 로드 시 `revalidatePath` 로 갱신(Supabase Realtime 라이브 갱신은 제외 — 채팅 미러는 향후). (5) api-client — 백엔드 OpenAPI 변경 반영해 `schema.d.ts` 재생성 + poll DTO 타입 별칭. path-param 투표 라우트는 web 의 `lib/moim/*` 구체-경로 헬퍼로 호출(getMoim/getMoimMembers 와 동일 — api-client 의 편의 메서드 표면은 리터럴 경로 전용 유지). 디자인은 Meetup 오렌지 시맨틱 토큰(`(main)/*` 동일 — login/onboarding blue 아님). **스코프 결정 기록**: (a) 단일 선택만(다중/순위/가중 제외); (b) 일반 투표(질문 + 텍스트 옵션) — 날짜 후보 투표(`Moim.startsAt` 설정용)는 향후 특수화; (c) 마감/잠금/수정/삭제/익명 투표 제외; (d) 실시간 라이브 갱신 제외(결과는 투표·새로고침 시 반영); (e) 모바일 신규 코드 없음(웹 상세가 WebView 안에서 렌더).

---

## 1. 개요 (Overview)

모임을 "일정·장소를 가진 이벤트"에서 **구성원이 의사결정할 수 있는 이벤트**로 한 걸음 더 진전시킨다. 이벤트 트라이어드(일정·장소·투표) 중 SPEC-MOIM-004 가 일정/장소를 채웠고, 본 SPEC이 **투표**를 채운다.

본 SPEC의 투표는 **최소 viable poll** 이다:

1. **생성** — 모임의 어느 멤버나 질문 한 줄 + 선택지 2개 이상으로 투표를 만든다.
2. **단일 투표** — 멤버는 한 투표에서 한 선택지에 투표한다. 다시 투표하면 자신의 선택이 바뀐다(추가 표가 아니라 교체).
3. **결과 집계** — 각 선택지의 득표 수 + 내가 고른 선택지를 함께 보여준다.

데이터는 `moim` 테이블을 건드리지 않고 **신규 3 테이블만 additive 로 추가**한다(`Poll`/`PollOption`/`PollVote`) — `add_moim_invite`·`add_chat` 가 `moim` 무변경으로 새 테이블만 CREATE 한 선례와 동일하다. 멤버 스코핑은 채팅과 같은 단일 출처(`MoimService.assertMember`)를 재사용한다 — 본 SPEC은 인가 정책을 새로 만들지 않는다.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 투표 UI 는 모임 상세(`/home/[id]`) 안에 in-WebView 로 렌더되므로 **모바일 신규 코드는 없다**. 투표/생성은 인터랙티브하므로 읽기 전용이던 상세 Server Component 에 **Client 하위 컴포넌트 + Server Action** 을 추가한다(MOIM-004 생성 폼과 동일한 패턴).

이는 **신규 3 테이블 + 멤버-가드 엔드포인트 3개 + 상세 화면 투표 섹션**이지 대형 기능이 아니다. 다중 선택·마감·수정·익명·실시간은 모두 제외한다(§4).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 6개로 제한한다. 각 모듈은 `REQ-MOIM5-XXX`로 번호를 부여하며(기존 `REQ-MOIM-XXX`/`REQ-MOIM3-XXX`/`REQ-MOIM4-XXX` 와 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM5-001: 투표 데이터 모델 (Ubiquitous)

- **The backend shall** 세 개의 신규 모델을 **additive**(기존 테이블 무변경)로 추가한다:
  - `Poll { id, moimId, question, createdBy, createdAt }` — `moimId` 는 `Moim` FK(`onDelete: Cascade`).
  - `PollOption { id, pollId, label }` — `pollId` 는 `Poll` FK(`onDelete: Cascade`).
  - `PollVote { pollId, optionId, userId, createdAt }` — 복합 PK `(pollId, userId)`(멤버당 한 투표 불변식), `pollId`/`optionId` 는 각각 `Poll`/`PollOption` FK(`onDelete: Cascade`).
- **The backend shall** 이 추가를 **무중단(additive) 마이그레이션**으로 적용한다 — `moim`/`moim_member`/`moim_invite`/`chat_message` 등 기존 테이블과 그 동작(생성·목록·상세·멤버·채팅·초대)은 어떤 회귀도 없이 보존된다.
- **The backend shall** `(pollId, userId)` 유일성으로 한 사용자가 한 투표에 둘 이상의 표를 가질 수 없도록 DB 레벨에서 강제한다(재투표는 추가가 아니라 교체).
- **The backend shall** poll 삭제 시 그 옵션·표가, moim 삭제 시 그 poll·옵션·표가 Cascade 로 함께 정리되도록 FK 를 구성한다.

### REQ-MOIM5-002: 투표 생성 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 멤버가 `{ question, options[] }` 로 `POST /moims/:id/polls` 를 호출하면, **the backend shall** poll + 그 옵션들을 하나의 트랜잭션으로 생성하고(`createMoim` 의 원자 트랜잭션 선례), `Poll.createdBy` 를 가드-검증된 sub 로 설정한다.
- (Unwanted behavior) **IF** `question` 이 (trim 후) 비어 있으면, **then the backend shall** `400 Bad Request` 를 반환한다(no-ValidationPipe 패턴 — 컨트롤러의 명시적 검사, `requireNonEmpty` 선례).
- (Unwanted behavior) **IF** (trim 후) 비어 있지 않은 옵션이 **2개 미만**이면, **then the backend shall** `400 Bad Request` 를 반환한다(투표에는 최소 2 선택지 필요).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 존재하지 않으면), **then the backend shall** `403 Forbidden` 을 반환한다(`assertMember` 단일 출처 — 미존재 404→403 변환은 채팅과 동일 처리).

### REQ-MOIM5-003: 단일 투표 + 재투표 (Event-driven / Unwanted behavior 혼합)

- (Event-driven) **WHEN** 모임 멤버가 `{ optionId }` 로 `POST /moims/:id/polls/:pollId/vote` 를 호출하면, **the backend shall** `(pollId, userId)` 에 대해 표를 **upsert** 한다 — 표가 없으면 생성, 이미 있으면 `optionId` 를 교체한다(멤버당 항상 정확히 한 표).
- (Unwanted behavior) **IF** `optionId` 가 해당 poll 에 속한 옵션이 아니면(다른 poll 의 옵션이거나 존재하지 않으면), **then the backend shall** `400 Bad Request` 를 반환한다.
- (Unwanted behavior) **IF** `pollId` 가 해당 모임에 속한 poll 이 아니면(또는 존재하지 않으면), **then the backend shall** `404 Not Found`(또는 `400`)를 반환한다(투표 대상이 모임-poll 일관성을 만족하지 않음 — 구현 단계에서 일관된 코드 선택).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면, **then the backend shall** `403 Forbidden` 을 반환한다(`assertMember`).

### REQ-MOIM5-004: 투표 목록 + 결과 조회 (Ubiquitous / Unwanted behavior 혼합)

- (Ubiquitous) **The `GET /moims/:id/polls` response shall** 모임의 모든 poll 을 반환하며, 각 poll 에 대해: `id`/`question`/`createdBy`/`createdAt`, **옵션 배열**(각 옵션의 `id`/`label`/**득표 수** `voteCount`), 그리고 **호출자 자신의 현재 선택**(`myVote` — 투표한 `optionId` 또는 `null`)을 포함한다.
- (Ubiquitous) **The backend shall** 각 옵션의 `voteCount` 를 `PollVote` 집계로 정확히 계산한다(표 0 인 옵션은 `voteCount = 0`).
- (Unwanted behavior) **IF** 요청 사용자가 대상 모임의 멤버가 아니면(또는 모임이 미존재이면), **then the backend shall** `403 Forbidden`(미존재 404→403)을 반환한다(`assertMember` — 비멤버에게 투표 내용을 노출하지 않는다).
- (Ubiquitous) **The backend shall** poll 이 하나도 없는 모임에 대해 **빈 배열**을 반환한다(에러 아님).

### REQ-MOIM5-005: api-client 투표 표면 (Ubiquitous)

- **The api-client shall** 백엔드 OpenAPI 변경(신규 poll DTO)을 반영해 생성 `schema.d.ts` 를 재생성하여, poll 요청/응답 DTO 타입이 `components['schemas']` 에 존재하게 한다(수동 편집 없음).
- **The api-client shall** poll DTO 에 대한 타입 별칭(예: `CreatePollRequest`/`PollResponse`)을 노출한다(`CreateMoimRequest`/`MoimResponse` 선례).
- **The web app shall** path-param 투표 라우트(`/moims/:id/polls`, `/moims/:id/polls/:pollId/vote`)를 web 의 **구체-경로 헬퍼**(`lib/moim/*`)로 호출한다 — `getMoim`/`getMoimMembers` 와 동일 패턴(템플릿 미치환 때문에 `path as never` 캐스팅). api-client 의 편의 메서드 표면은 리터럴 경로(`/moims`, `/me` 등) 전용으로 유지한다.
- **The api-client/web shall** 토큰을 URL/query 가 아닌 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).

### REQ-MOIM5-006: 웹 투표 UI (Event-driven / State-driven / Ubiquitous 혼합)

- (Ubiquitous) **The web app shall** 모임 상세(`/home/[id]`)에 투표 섹션을 렌더하며, 각 poll 에 대해 질문 + 각 선택지의 라벨·득표 수(막대/퍼센트 등 시각적 집계) + **내가 고른 선택지의 강조**를 보여준다.
- (Event-driven) **WHEN** 멤버가 한 선택지를 선택하면(단일 선택), **the web app shall** 세션 토큰으로 투표 엔드포인트를 호출해 자신의 표를 기록/교체하고, 성공 시 갱신된 결과를 반영한다(`revalidatePath`/재조회 — 라이브 푸시 아님).
- (Event-driven) **WHEN** 멤버가 "투표 만들기" 폼에 질문 + 선택지(동적 입력, ≥2)를 입력해 제출하면, **the web app shall** 생성 엔드포인트를 호출해 실제 poll 을 만들고, 성공 시 새 poll 이 목록에 나타나게 한다.
- (Unwanted behavior) **IF** 생성 폼의 질문이 비었거나 유효 선택지가 2개 미만이거나 백엔드가 오류(400 등)를 반환하면, **then the web app shall** 폼에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 재제출할 수 있게 한다.
- (State-driven) **WHILE** 모임에 poll 이 하나도 없는 동안, **the web app shall** 정직한 빈 상태("아직 투표가 없어요")를 표시한다(허위/플레이스홀더 값 금지).
- (Ubiquitous) **The web app shall** 투표 섹션·생성 폼을 Meetup 디자인 시스템(`(main)/home/[id]` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 신규 테이블 + 신규 도메인 모듈을 추가하고 기존 웹 상세 화면을 확장하는 작업이다. 파일·라인은 작성 시점(2026-06-19) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/moim/moim.service.ts` `assertMember`(:51, @MX:ANCHOR) — 멤버십 인가 단일 출처. **재사용만** — poll 서비스가 이 계약을 호출해 멤버 스코핑을 강제한다(채팅 선례 동일). 변경 없음.
- `apps/backend/src/moim/moim.service.ts` `createMoim`(:22, @MX:ANCHOR) — 원자 트랜잭션 선례(poll+옵션 트랜잭션이 구조를 미러). 변경 없음.
- `apps/backend/src/chat/chat.controller.ts` `@Controller('moims/:id/messages')`(:41) — moimId-in-path + per-route 가드 + ValidationPipe-부재 명시 400 패턴의 참조 원본. poll 컨트롤러가 이 패턴을 미러. 변경 없음.
- `apps/backend/prisma/schema.prisma` `Moim`/`MoimMember`/`MoimInvite`/`ChatMessage`(:36~112) — **무변경**. poll 모델은 신규 추가만(아래 [NEW]). `Moim` 에 `polls Poll[]` 역참조 한 줄 추가는 [MODIFY](관계 선언 — 컬럼 변경 아님).
- `apps/web/app/(main)/home/[id]/page.tsx`(:67) — 상세 Server Component. **본체(가드 + 모임/멤버 fetch + 채팅 입장 + 멤버 목록) 보존**, 투표 섹션 fetch + 하위 컴포넌트 마운트만 추가(아래 [MODIFY]).
- `apps/web/lib/moim/api.ts`(:32) — `getMoim`/`getMoimMembers` 구체-경로 헬퍼 패턴의 참조 원본. poll 헬퍼가 동일 패턴(아래 [NEW]). 변경 없음.
- `apps/web/app/moims/new/{actions.ts,create-moim-form.tsx}` — `useActionState` + Server Action 패턴(빈 값/오류 → 폼 머무름 + 일반화 오류, 성공 → 갱신)의 참조 원본. 투표 생성 폼이 동일 패턴. 변경 없음. **단, 디자인 토큰은 이미 Meetup 오렌지라 일관**.
- `apps/mobile/**` — **모바일 무변경**. 투표 UI 는 `/home/[id]` 안에서 in-WebView 로 렌더되고, 상세 라우트의 네이티브 push 는 SPEC-MOIM-003 계약이 이미 처리한다. 신규 네이티브 라우트·코드 없음.

### [MODIFY] (수정)

- `apps/backend/prisma/schema.prisma` `Moim` — `polls Poll[]` 역참조 1줄 추가(관계 선언 — `moim` 테이블 컬럼·기존 관계 무변경, `invites`/`messages` 역참조 선례 동일).
- `apps/web/app/(main)/home/[id]/page.tsx` — 서버에서 `GET /moims/:id/polls`(호출자 vote 포함) 조회 → `<PollsSection moimId={id} polls={polls} />`(Client) 마운트. 기존 헤더(이름·일정·장소)·채팅 입장·멤버 목록 섹션 보존, 투표 섹션을 추가한다.
- `apps/web/lib/moim/api.ts` — poll 조회/생성/투표 구체-경로 헬퍼 추가(또는 신규 `lib/moim/polls.ts` 로 분리 — 구현 단계 판단, ~500 LOC 규칙). `listPolls(api, moimId)`/`createPoll(api, moimId, body)`/`votePoll(api, moimId, pollId, optionId)` + poll 결과 타입(`PollWithResults` 등). `moimErrorStatus` 재사용.
- `packages/api-client/src/index.ts` — poll DTO 타입 별칭(`CreatePollRequest`/`PollResponse` 등) 추가(`CreateMoimRequest`/`MoimResponse` 선례). 편의 메서드는 추가하지 않음(path-param 라우트 → web 구체-경로 헬퍼).
- `packages/api-client/src/schema.d.ts` — `nx run api-client:generate` 재생성(백엔드 OpenAPI 의 신규 poll DTO 반영). 수동 편집 없음.

### [NEW] (신규)

- 백엔드 poll 도메인 모듈(`apps/backend/src/poll/` 권장 — moim 모듈 비대화 방지, ~500 LOC 규칙; 또는 moim 모듈 내 분할 — 구현 단계 판단):
  - `poll.service.ts` — `createPoll(sub, moimId, question, options[])`(assertMember → 트랜잭션으로 poll+options 생성), `vote(sub, moimId, pollId, optionId)`(assertMember → optionId 가 poll 소속인지 검증 → `(pollId,userId)` upsert), `listPolls(sub, moimId)`(assertMember → polls + options + voteCount 집계 + 호출자 myVote).
  - `poll.controller.ts` — `@Controller('moims/:id/polls')` + `@UseGuards(SupabaseAuthGuard)`. `POST /` (생성, 201), `GET /` (목록+결과, 200), `POST /:pollId/vote` (투표, 200/201). ValidationPipe 부재 → question 빈/옵션<2/잘못된 optionId 명시 400(채팅 `requireContent` 선례).
  - `poll.module.ts` — `MoimModule`(또는 `MoimService`) 의존성 주입(assertMember 재사용), `AppModule` 등록.
  - DTO: `create-poll.dto.ts`(`{ question: string; options: string[] }`, `@ApiProperty`), `vote.dto.ts`(`{ optionId: string }`), `poll-response.dto.ts`(poll + options[{id,label,voteCount}] + myVote, `@ApiProperty`).
- 백엔드 jest 스펙: `poll.controller.spec.ts` / `poll.service.spec.ts` / `poll.integration.spec.ts`(아래 plan.md M3) — 생성/투표/재투표/집계/멤버 스코핑/400 케이스.
- `apps/backend/prisma/migrations/{TS}_add_poll/migration.sql` — 신규 3 테이블 CREATE + FK(cascade) + `(poll_id, user_id)` PK. 비파괴 패턴(migrate diff/db execute/resolve --applied).
- 웹 Client 컴포넌트 + Server Action(상세 화면 안):
  - `apps/web/app/(main)/home/[id]/polls-section.tsx` (Client) — 투표 목록 렌더(질문·옵션·득표 막대/퍼센트·내 표 강조), 단일 선택 투표 컨트롤, "투표 만들기" 폼(질문 + 동적 옵션 입력 ≥2, `useActionState`). Meetup 오렌지 토큰. 빈 상태("아직 투표가 없어요").
  - `apps/web/app/(main)/home/[id]/poll-actions.ts` (`"use server"`) — `createPollAction`(질문/옵션 검증 → 세션 → web 헬퍼 `createPoll` → 성공 시 `revalidatePath`, 실패 → 일반화 오류) + `voteAction`(optionId → 세션 → `votePoll` → `revalidatePath`).

### [REMOVE]

- 없음(순수 additive — 기존 코드 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **다중 선택 / 순위 / 가중 투표** — 본 SPEC은 **단일 선택만** 다룬다(MVP). 한 멤버는 한 투표에서 정확히 한 선택지에만 투표한다. `PollVote` 의 `(pollId, userId)` PK 가 이를 강제한다 — 다중 선택은 PK 구조 변경이 필요한 별도 SPEC.
- **투표 마감 / 종료 시각 / 잠금(close/lock)** — poll 은 생성 후 무기한 열려 있다. 마감 일시·자동 종료·잠금 상태는 범위 밖(향후).
- **투표 수정 / 삭제(edit/delete poll)** — 생성된 poll 의 질문·옵션 편집이나 poll 삭제 UI 는 범위 밖. 본 SPEC은 생성·투표·조회만 다룬다(향후). 단, moim/poll 삭제 시 Cascade 정리는 FK 로 보장한다(데이터 무결성 — 삭제 *UI* 가 아니라 *제약*).
- **익명 투표(anonymous voting)** — 본 SPEC은 득표 **수**(`voteCount`)와 **내 표**(`myVote`)만 노출한다. "누가 무엇에 투표했는지"의 멤버별 표 공개는 다루지 않는다(현 응답은 집계 + 자기 표만 — 타인 식별 노출 없음). 익명/공개 토글은 범위 밖.
- **실시간 라이브 투표 갱신(Supabase Realtime)** — 결과는 투표 액션·페이지 로드 시 재조회(`revalidatePath`)로 갱신한다. 채팅(SPEC-CHAT-001)의 Realtime 트리거 미러는 본 SPEC에 포함하지 않는다(향후 필요 시 동일 메커니즘으로 확장 가능 — 설계 노트 §5).
- **날짜 후보 투표(date-candidate poll)** — `Moim.startsAt` 을 정하기 위해 날짜 후보에 투표하는 특수 투표는 범위 밖. 본 SPEC은 **일반 투표**(질문 한 줄 + 자유 텍스트 선택지)만 다룬다. 날짜 투표는 일반 투표의 향후 특수화다(투표 결과 → `startsAt` 반영 등 추가 배선 필요).
- **모바일 신규 코드** — 투표 UI 는 웹 상세(`/home/[id]`)가 소유하고 모바일 WebView 안에서 렌더된다. expo-router 네이티브 라우트·컴포넌트·detail-push 분류를 추가하지 않는다(SPEC-MOIM-003 계약 재사용).
- **투표 알림 / 푸시** — 새 투표 생성·결과 변동에 대한 FCM 푸시나 인앱 알림은 범위 밖(SPEC-CHAT-002 푸시 인프라 무변경).
- **선택지 개수 상한 / 옵션 길이 정교한 검증** — 최소 2개만 강제한다. 옵션 최대 개수·라벨 길이 상한 등 풍부한 검증은 범위 밖(질문/옵션 빈 값만 거른다 — 채팅 content 길이 검증보다 단순).
- **선택지 표시 순서 보장 컬럼** — `PollOption` 은 `{ id, pollId, label }` 만 둔다(브리프 스키마 준수). 명시적 `position` 컬럼은 두지 않으며, 옵션은 결정적 키(예: `id`)로 정렬해 안정적으로 표시한다. 생성 순서 보장 표시가 필요해지면 `position` 추가는 향후 작업이다(§5 트레이드오프 기록).

---

## 5. 설계 노트 (Design Notes)

### 엔드포인트 shape — `/moims/:id/polls` 중첩 (스코프 결정)

- 브리프는 두 가지 후보를 제시했다: `POST /polls/:id/vote`(평평) 또는 `POST /moims/:id/polls/:pollId/vote`(중첩). **결정: 모든 투표 라우트를 `/moims/:id/polls` 하위에 중첩**한다.
- 근거: ChatController 가 `@Controller('moims/:id/messages')` 로 moimId 를 항상 path 에 두고 `assertMember(sub, moimId)` 를 **직접** 호출한다. 평평한 `/polls/:id/vote` 는 컨트롤러가 먼저 poll → moimId 역방향 lookup 을 한 뒤에야 멤버십을 검사할 수 있어 추가 조회 + 새 패턴이 생긴다. 중첩 shape 는 채팅과 **완전히 일관**되고 멤버 스코핑이 path moimId 로 직접 가능하다.
- 결과 라우트: `POST /moims/:id/polls`(생성) · `GET /moims/:id/polls`(목록+결과) · `POST /moims/:id/polls/:pollId/vote`(투표). `pollId` 가 path 의 `id`(moim) 에 속하는지는 service 가 일관성 검증(다른 모임의 poll → 404/400).

### 웹 — Server Component + Client 섬 + Server Action (genuine gap 해소)

- 현재 `/home/[id]/page.tsx` 는 **읽기 전용 Server Component**("클라이언트 인터랙션 없음 — 링크만", 파일 헤더 주석). 투표(투표 버튼 클릭)와 생성(동적 옵션 입력 폼)은 본질적으로 인터랙티브하다 — **이 SPEC은 상세 페이지에 Client 하위 컴포넌트를 도입해야 한다**. 이것이 브리프가 묻는 "genuine gap" 이다.
- 결정(MOIM-004 `createMoimAction`/온보딩 선례 미러):
  - **Server Component**(`page.tsx`)는 가드 + 모임/멤버 fetch 를 유지하고, 추가로 서버에서 `GET /moims/:id/polls`(호출자 myVote 포함)를 조회해 데이터 + `moimId` 를 하위로 내린다.
  - **Client 섬**(`polls-section.tsx`)이 투표 목록·득표 막대·내 표 강조·단일 선택 투표 컨트롤·생성 폼(`useActionState`)을 렌더한다.
  - **Server Action**(`poll-actions.ts`)이 `createPollAction`/`voteAction` 으로 세션을 읽어 web 헬퍼를 호출하고, 성공 시 `revalidatePath` 로 상세를 재검증해 결과가 갱신되게 한다.
- 결과 갱신은 **액션/페이지 로드 시 재조회**다(`revalidatePath`). 실시간 라이브 갱신(Realtime)은 §4 제외 — 향후 채팅과 동일 메커니즘으로 확장 가능하나 본 SPEC 범위 밖.

### 데이터 모델 (additive 신규 3 테이블)

- `Poll`: `id`(uuid PK), `moim_id`(FK→moim, cascade), `question`(text), `created_by`(가드-검증 sub), `created_at`. `Moim` 에 `polls Poll[]` 역참조(관계 선언 — moim 컬럼 무변경, `invites`/`messages` 선례 동일).
- `PollOption`: `id`(uuid PK), `poll_id`(FK→poll, cascade), `label`(text). 브리프 스키마 그대로 — `position` 컬럼 없음(§4 제외, 안정 정렬은 `id`/저장 순서 결정적 키).
- `PollVote`: 복합 PK `(poll_id, user_id)`(= 멤버당 한 투표 불변식, `MoimMember(moimId,userId)` 선례), `option_id`(FK→poll_option, cascade), `created_at`. 재투표 = `(pollId,userId)` 기준 upsert 로 `option_id` 교체. `poll_id`/`option_id` 모두 cascade(poll/option 삭제 시 표 정리).
- 비파괴 마이그레이션: `add_moim_invite`·`add_chat` 처럼 **신규 테이블 CREATE 만** — `prisma migrate dev` 의 파괴적 reset 을 피해 마이그레이션 SQL 수동 작성 → `prisma migrate diff`/`db execute` → `migrate resolve --applied` → `migrate status` clean 확인(`add_profile_name`/`add_moim_event_fields` 선례).

### 백엔드 검증 (no-ValidationPipe 보존)

- 이 프로젝트는 `ValidationPipe` 가 없다(C-1). 컨트롤러가 명시적으로 400 을 던진다(채팅 `requireContent`/모임 `requireNonEmpty` 선례):
  - `question`: trim 후 빈 값이면 400.
  - `options`: 배열에서 trim 후 비지 않은 항목을 모아 2개 미만이면 400(빈 옵션 항목은 무시).
  - `optionId`(투표): service 가 해당 poll 에 속한 옵션인지 검증 — 불일치/미존재면 400.
- 멤버 스코핑(403)·poll-모임 일관성(404/400)은 service 가 `assertMember` + 조회로 판정(인가 단일 출처 불변 — 약화 금지).

### 결과 집계

- `listPolls(sub, moimId)`: `assertMember` 후 모임의 poll 들을 옵션과 함께 조회하고, 각 옵션의 `voteCount` 를 `PollVote` 집계(`groupBy`/`count`)로 계산하며, 호출자의 `(pollId,userId)` 표를 조회해 `myVote`(optionId 또는 null)를 채운다. 표 0 인 옵션도 `voteCount: 0` 로 포함(빠뜨리지 않음).

### 디자인

- 투표 섹션·막대·생성 폼은 `(main)/home/[id]` 가 쓰는 Meetup 오렌지 시맨틱 토큰(`bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`/`bg-secondary`)을 사용한다. 내 표 강조는 `bg-primary`/`ring-primary` 등으로, 득표 막대는 `bg-primary`(채움) + `bg-muted`(배경) 등으로 표현한다. login/onboarding blue 토큰 미사용.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 마이그레이션 파괴적 reset | MEDIUM | `prisma migrate dev` 가 hand-edited add_chat 마이그레이션(realtime 트리거) 때문에 reset 을 시도할 수 있다. 비파괴 패턴(SQL 수동 작성 → migrate diff/db execute → resolve --applied → migrate status clean) 강제. 신규 테이블 CREATE 만이라 기존 row 영향 0. |
| upsert 경쟁 조건(동시 재투표) | LOW | 같은 사용자가 동시에 두 번 투표하면 `(pollId,userId)` PK 가 둘째를 충돌시킨다 — Prisma `upsert` 가 PK 충돌을 멱등 교체로 흡수(단일 사용자 동시 클릭은 드묾, MVP 허용). |
| optionId 교차-poll 누수 | MEDIUM | 다른 poll 의 옵션 id 로 투표하면 잘못된 집계가 생긴다. service 가 `optionId` 가 `pollId` 에 속하는지 명시 검증(불일치 400) — 테스트 케이스로 고정. |
| 상세 페이지 Server→Client 경계 회귀 | MEDIUM | 읽기 전용이던 Server Component 에 Client 섬을 넣을 때 직렬화 가능한 props 만 전달해야 한다(함수/클래스 인스턴스 금지). polls 데이터는 plain object, 액션은 `"use server"` 모듈에서 import. 회귀는 web build/tsc 게이트로 차단. |
| 멤버 스코핑 약화 | MEDIUM | poll service 가 `assertMember` 를 빠뜨리면 비멤버가 투표 내용을 본다. 모든 poll service 진입(create/vote/list)이 첫 줄에서 `assertMember` 호출 — 통합 테스트의 403 케이스로 고정. |
| 디자인 토큰 혼선(blue vs orange) | LOW | onboarding 폼 참조 시 blue 토큰 복사 위험. REQ-MOIM5-006 으로 Meetup 오렌지 강제, 코드 리뷰 확인. |
| 옵션 표시 순서 비결정 | LOW | `position` 컬럼 부재(§4)로 옵션 순서가 비결정적일 수 있다. service 가 결정적 키(`id`)로 정렬해 안정 표시 — 사용자가 생성 순서를 요구하면 `position` 추가는 향후. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 백엔드는 jest(신규 poll 케이스 포함), api-client 는 tsc. 모바일은 본 SPEC에서 무변경(검증은 회귀 0 확인용 tsc/vitest/expo export).

- `prisma migrate` clean (신규 3 테이블 additive 마이그레이션, 기존 row 영향 0, 비파괴 패턴)
- backend jest 통과 (신규: poll 생성 + 옵션<2 400 + question 빈 400 + 투표 기록 + 재투표 교체 + 잘못된 optionId 400 + 목록 결과 집계/myVote + 비멤버 403)
- `tsc` 통과 (0 error — backend + web + api-client)
- web lint 통과 (0 error)
- `nx run web:build` 통과 (0 error — 상세 페이지 Client 섬 + Server Action 컴파일)
- mobile tsc / vitest 통과 (무변경 회귀 0)
- `expo export` 통과 (모바일 셸 회귀 0)
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 모임 상세(`/home/{id}`) 진입 → "투표 만들기"(질문 + 옵션 ≥2) → 생성된 투표 표시 → 한 선택지 투표 → 득표 수/내 표 강조 갱신 → 재투표 시 선택 교체가 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated — 투표/생성 Server Action 이 WebView 안에서 동작하고 `revalidatePath` 후 결과가 갱신되는지 확인). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
