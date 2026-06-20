# SPEC-MOIM-007 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-007: 투표 마감(deadline + 수동 마감) — 마감 후 투표 차단
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 iOS 시뮬레이터 확인. 백엔드는 jest(마감 신규 + 열린 poll 회귀). api-client 는 tsc.

## 수용 기준 (AC)

### AC-1: 마감 데이터 모델 + 비파괴 마이그레이션 (← REQ-MOIM7-001)

`Poll.closesAt`(nullable, `@default` 없음, additive)가 추가되고, `PollVote` PK(`(pollId,optionId,userId)`)·FK·인덱스가 유지되며, 기존 poll/option/vote row 가 보존된다.

- **Given** 기존 스키마(poll/poll_option/poll_vote, MOIM-006 PK)와 poll/투표 데이터가 있고
- **When** 비파괴 마이그레이션(`poll.closes_at` nullable 컬럼 ADD)을 적용하면
- **Then** `poll.closes_at` 가 nullable 로 추가되고(기존 poll 모두 `null` = 마감 없음), `poll_vote` PK·FK(cascade)·`@@index` 가 무변경이며, **기존 poll/option/vote row 가 한 row 도 손실되지 않고**(row count 불변), `prisma migrate status` 가 clean 이고, 기존 테이블/동작(모임·멤버·채팅·초대·단일/다중 투표)에 회귀가 없다.

### AC-2: 투표 생성 — closesAt 옵트인 (← REQ-MOIM7-002)

`POST /moims/:id/polls` 가 optional `closesAt`(ISO 문자열)을 받아 poll 을 생성한다. 생략 시 null(마감 없음), 무효 ISO 는 400, 비멤버는 403.

- **Given** 모임 멤버가
- **When** `{ question, options: ["A","B"], closesAt: "2026-06-25T12:00:00.000Z" }` 로 생성하면 **Then** 201 + 그 시각이 `closesAt` 로 설정된 poll 이 생성된다(미래 시각 → isClosed false).
- **And When** `closesAt` 를 생략하고 생성하면 **Then** `closesAt: null`(마감 없음, isClosed false) poll 이 생성된다(MOIM-005/006 동작 동일). `multiSelect` 옵트인도 그대로 동작한다.
- **And When** `closesAt` 가 유효한 날짜로 파싱되지 않는 무효 문자열이면 **Then** 400 을 반환한다.
- **And When** question 이 비었거나 유효 옵션이 2개 미만이면 **Then** 400 을 반환한다(closesAt 추가가 이 검증을 바꾸지 않음).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 모임도 403)을 반환한다.

### AC-3: 수동 마감 — 생성자 전용 (← REQ-MOIM7-003)

`POST /moims/:id/polls/:pollId/close` 가 생성자만 호출 가능하며 `closesAt = now` 를 설정한다. 비생성자 멤버 403, 비멤버 403, 없는 poll 404, 멱등.

- **Given** 멤버 U 가 만든 열린 poll(`createdBy = U`)이 있고
- **When** U(생성자)가 `POST .../close` 를 호출하면 **Then** 200 + 그 poll 의 `closesAt` 가 now 로 설정되고 `isClosed: true` 가 반환된다(즉시 마감).
- **And When** 다른 멤버 V(비생성자)가 같은 poll 에 close 를 호출하면 **Then** 403(마감은 생성자 전용)이고 poll 은 변경되지 않는다.
- **And When** 비멤버가 close 를 호출하면 **Then** 403(assertMember — 생성자 비교에 도달하지 않음).
- **And When** path 모임에 속하지 않는(또는 없는) pollId 로 close 하면 **Then** 404.
- **And When** 이미 마감된 poll 에 U 가 다시 close 하면 **Then** 200 + 여전히 `isClosed: true`(멱등 — 오류 아님).
- **And** 마감 시각이 미래였던 poll 을 U 가 일찍 close 하면 **Then** `closesAt` 가 now 로 덮어써져 즉시 마감된다(앞당김).

### AC-4: 투표 차단 — 마감 시 409 (← REQ-MOIM7-004)

마감(`closesAt != null && closesAt <= now`) poll 에 투표하면 409("마감된 투표입니다")로 거부되고 표가 변경되지 않는다(단일·다중 공통). 열린 poll 투표는 MOIM-005/006 그대로.

- **Given** 마감된 단일 선택 poll(closesAt <= now, 옵션 A/B)이 있고
- **When** 멤버가 `{ optionId: A }` 로 투표하면 **Then** 409("마감된 투표입니다")이고 표가 변경되지 않는다.
- **Given** 마감된 다중 선택 poll(closesAt <= now)이 있고
- **And When** 멤버가 투표하면 **Then** 409(단일/다중 공통 차단)이고 표가 변경되지 않는다.
- **Given** 열린 단일 선택 poll(closesAt > now 또는 null)이 있고
- **And When** 멤버가 투표하면 **Then** 표가 교체된다(총 1표, MOIM-005 회귀 0).
- **Given** 열린 다중 선택 poll 이 있고
- **And When** 멤버가 투표하면 **Then** 토글된다(추가/제거, MOIM-006 회귀 0).
- **And When** 마감 poll 에 그 poll 에 속하지 않는 optionId 로 투표하면 **Then** (마감 검사가 우선이므로) 409 로 차단된다(어떤 optionId 든 마감 poll 투표 불가).
- **And When** 다른 모임의 pollId 로 투표하면 **Then** 404.
- **And When** 비멤버가 투표하면 **Then** 403(마감 검사에 도달하지 않음).

### AC-5: 투표 목록 + 결과 — closesAt + 서버 계산 isClosed (← REQ-MOIM7-005)

`GET /moims/:id/polls` 가 각 poll 의 `closesAt`(ISO|null) + 서버 계산 `isClosed`(boolean)를 반환한다. 마감 poll 도 결과 조회 가능, 비멤버 403, poll 없으면 빈 배열.

- **Given** 멤버이고 `closesAt = 과거 시각` poll 이 있는 상태에서
- **When** `GET /moims/:id/polls` 를 호출하면 **Then** 그 poll 에 `closesAt`(그 ISO 문자열) + `isClosed: true`(서버가 closesAt <= now 로 계산), 그리고 옵션별 voteCount(표 0 포함)·myVotes(목록)가 포함된다(마감돼도 결과 조회 가능).
- **And Given** `closesAt = 미래 시각` poll 이면 **Then** `isClosed: false`(아직 열림).
- **And Given** `closesAt = null` poll 이면 **Then** `closesAt: null` + `isClosed: false`(마감 없음).
- **And When** 호출자가 마감 poll 에 이전에 투표했으면 **Then** 그 poll 의 `myVotes` 가 그대로 반환된다(마감이 내 표 조회를 가리지 않음).
- **And When** 모임에 poll 이 없으면 **Then** 빈 배열을 반환한다(에러 아님).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 404→403)이고 투표 내용을 노출하지 않는다.

### AC-6: api-client 갱신 (← REQ-MOIM7-006)

api-client 재생성으로 `CreatePollRequest` 에 optional `closesAt`, `PollResponse` 에 `closesAt`(string|null) + `isClosed`(boolean)가 반영된다. multiSelect/myVotes 보존, 별칭 유지, web 헬퍼/타입 갱신(+`closePoll`).

- **Given** 백엔드 OpenAPI 가 closesAt/isClosed 와 close 라우트를 노출하고
- **When** `nx run api-client:generate` 후 tsc 를 실행하면
- **Then** `CreatePollRequest` 에 optional `closesAt: string`, `PollResponse`(= `components['schemas']['PollResponseDto']`)에 `closesAt: string | null` + `isClosed: boolean` 이 있고 `multiSelect`/`myVotes` 가 보존되며, web `PollWithResults`(`closesAt`/`isClosed`)와 신규 `closePoll` 헬퍼가 추가되어 backend/web/api-client tsc 가 0 error 다(수동 schema 편집 없음).

### AC-7: 웹 마감 UI (← REQ-MOIM7-007)

모임 상세가 마감 poll 을 "마감됨" 배지 + 비활성 컨트롤 + 결과 표시로, 열린 poll 을 MOIM-005/006 그대로 렌더한다. 생성 폼에 "마감 시각"(datetime-local), 열린 poll 에 생성자 전용 "마감하기" 버튼. Meetup 오렌지.

- **Given** 인증·이름 보유 멤버가 모임 상세(`/home/{id}`)에 있고
- **When** `isClosed: true` poll 이 있으면 **Then** "마감됨" 배지가 보이고, 투표 컨트롤(선택지 버튼)이 비활성화되며(클릭 불가), 결과(득표 수/퍼센트/내 표 강조)는 계속 표시되고, `closesAt` 가 사람이 읽을 수 있게 표시된다.
- **And When** `isClosed: false` poll 이 있으면 **Then** MOIM-005/006 투표 렌더(단일=탭 교체 / 다중=탭 토글)가 그대로 동작한다(회귀 0).
- **And When** `closesAt` 가 설정된 열린 poll 이면 **Then** "마감: {시각}" 안내가 표시되고, `closesAt: null` 이면 마감 안내가 없다.
- **And When** "투표 만들기" 에서 "마감 시각"(datetime-local)을 입력하고 질문+선택지(≥2)를 제출하면 **Then** 그 시각이 `closesAt` 로 전달된 poll 이 생성된다(미입력 시 마감 없음).
- **And When** 현재 사용자가 그 poll 의 **생성자**이고 poll 이 **열려 있으면** **Then** "마감하기" 버튼이 보이고, 누르면 `POST .../close` 후 그 poll 이 "마감됨"(비활성 컨트롤)으로 갱신된다(revalidatePath).
- **And When** 현재 사용자가 생성자가 아니거나 poll 이 이미 마감이면 **Then** "마감하기" 버튼이 보이지 않는다.
- **And When** 투표/생성/마감이 백엔드 오류(400/403/404/409/네트워크)를 반환하면 **Then** 폼/화면에 머무르며 일반화 오류를 표시한다(토큰/상세 비노출). 마감 poll 투표 409 시 마감 상태로 갱신된다.
- **And** 마감 시각 입력·"마감됨" 배지·"마감하기" 버튼이 모두 Meetup 오렌지 토큰을 쓴다(login/onboarding blue 아님).

### AC-8: 품질 게이트 (← spec.md §7)

backend jest 통과(마감 신규 + 열린 poll 회귀), backend+web+api-client tsc 0, web lint 0, web build 0, prisma migrate clean(closesAt nullable 추가, PK/FK 무변경, 기존 row 보존), mobile tsc/vitest/expo export 회귀 0.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(마감 시각 생성 → 마감 전 투표 → "마감하기" → 배지+비활성+결과표시 → 마감 후 투표 409 차단 → 비생성자/마감 poll 마감하기 미노출)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **closesAt null(마감 없음)**: 생성 시 마감 미설정 → closesAt null → isClosed 항상 false → 영구히 투표 가능(MOIM-005/006 기본 동작 보존). (← REQ-MOIM7-002/005)
- **마감 시각 미래(아직 열림)**: closesAt > now → isClosed false → 투표 가능. 시각 경과 후 다음 GET 부터 isClosed true(실시간 푸시 아님 — 다음 fetch 에 반영). (← REQ-MOIM7-005)
- **수동 마감이 미래 deadline 앞당김**: closesAt 가 미래였던 poll 을 생성자가 일찍 close → closesAt = now 로 덮어써 즉시 마감(데이터 손실 아님 — 의도된 앞당김). (← REQ-MOIM7-003)
- **마감 멱등**: 이미 마감된 poll 에 다시 close → 200 + 마감 유지(now 재설정 무해, 이미 <= now). 오류 아님. (← REQ-MOIM7-003)
- **단일/다중 공통 차단**: 마감 poll 에서 단일(교체 의도)·다중(토글 의도) 둘 다 409 로 차단 — multiSelect 와 무관하게 마감이 우선. (← REQ-MOIM7-004)
- **마감 + 잘못된 optionId**: 마감 poll 에 그 poll 에 없는 optionId 로 투표 → 마감 검사가 분기/optionId 검사 앞이므로 409(어떤 optionId 든 마감 poll 투표 불가). (← REQ-MOIM7-004)
- **마감 후 읽기 비차단**: 마감 poll 도 GET 으로 voteCount/myVotes/closesAt/isClosed 조회 가능 — 마감은 쓰기(투표)만 막고 읽기는 막지 않는다. (← REQ-MOIM7-005)
- **생성자 vs 모임 owner**: 마감은 poll **생성자**(`Poll.createdBy`) 기준 — 모임 owner 가 아니어도 자기 poll 은 마감 가능, 모임 owner 라도 남의 poll 은 마감 불가(403). (← REQ-MOIM7-003)
- **비멤버 우선 차단**: 비멤버는 close 의 생성자 비교(403)에 도달하기 전 assertMember(403/없는 모임 404→403)에서 차단된다. (← REQ-MOIM7-003)
- **클라이언트 시계 오차**: 클라이언트가 closesAt 를 자기 시계로 비교하지 않고 서버 isClosed 만 신뢰 → 마감 직전/직후 오판 방지. 어긋나도 vote 409 가 최종 차단. (← REQ-MOIM7-005)
- **closesAt/isClosed 추가 소비처**: 순수 추가(제거 아님)라 기존 소비처는 안 깨지나, web PollWithResults 미러·page→PollsSection 은 새 필드/currentUserId 를 채워야 함 → tsc 차단. (← REQ-MOIM7-006)
- **마감 시각 무효 입력**: API 직접 호출로 무효 closesAt → 400(parseClosesAt). 웹 datetime-local 무효는 toIsoOrUndefined 가 undefined 로 떨어뜨려 미전송(moims/new 선례). (← REQ-MOIM7-002)
- **세션 만료 후 마감/생성/투표**: Server Action 시점 세션 부재 → `/login` 리다이렉트(마감/poll/표 미변경). (← REQ-MOIM7-007)
- **비멤버 접근**: 비멤버가 생성/투표/조회/마감 → 모두 403(미존재 모임도 403). closesAt 추가가 인가에 영향 없음. (← REQ-MOIM7-002/003/004/005)
- **데스크톱 vs 모바일**: 마감 UI 는 데스크톱 일반 렌더 + 모바일 in-WebView(상세 `/home/{id}` 안 — 신규 네이티브 라우트 없음). Server Action(`revalidatePath`)이 WebView 안에서 마감 상태/배지/비활성을 갱신하는지 디바이스 검증.

## Definition of Done (DoD)

- [ ] `Poll.closesAt`(nullable, `@default` 없음, additive) 추가 + PK/FK/인덱스 무변경(기존 row 보존, row 손실 0), prisma migrate clean. (AC-1)
- [ ] `POST /moims/:id/polls` 가 optional closesAt(생략 시 null) 수용 + 무효 ISO 400 + 마감 없는 생성 무변경 + question 빈/옵션<2 400 + 비멤버 403. (AC-2)
- [ ] `POST .../close` 가 생성자 전용(createdBy === sub → closesAt=now/isClosed true) + 비생성자 멤버 403 + 비멤버 403 + 없는 poll 404 + 멱등(두 번 close 200). (AC-3)
- [ ] `POST .../vote` 가 마감 poll 에서 409("마감된 투표입니다", 표 불변, 단일/다중 공통 + optionId 무관) + 열린 poll 정상(단일 교체 총 1표 / 다중 토글, MOIM-005/006 회귀 0) + 다른 모임 pollId 404 + 비멤버 403. (AC-4)
- [ ] `GET /moims/:id/polls` 가 closesAt(ISO|null) + 서버 계산 isClosed(null/미래 false, 과거/now true) + 마감 poll 도 결과 조회 가능 + 비멤버 403 + poll 없으면 빈 배열. (AC-5)
- [ ] DTO(`CreatePollDto.closesAt`, `PollResponseDto.closesAt`+`isClosed`) + service vote 마감 검사(409)/closePoll 신규/aggregate isClosed 계산 + 컨트롤러 close 라우트/parseClosesAt. (AC-2/3/4/5)
- [ ] backend jest 신규(closesAt 생성/무효 ISO 400/vote 409 단일·다중/closePoll 생성자·비생성자·비멤버·멱등/isClosed 계산) + 열린 poll 회귀(closesAt 생략/단일 교체/다중 토글) + 400/403/404 통과. (AC-1~5/AC-8)
- [ ] `schema.d.ts` 재생성 + api-client `CreatePollRequest`(closesAt) / `PollResponse`(closesAt/isClosed, multiSelect·myVotes 보존) + 별칭 유지, tsc 0. (AC-6)
- [ ] web `PollWithResults`(closesAt/isClosed) + `closePoll` 헬퍼 + `closePollAction` + `createPollAction` closesAt 읽기 + `PollCard` 마감 분기(배지/비활성/결과/마감하기) + `CreatePollForm` 마감 시각 입력 + page currentUserId 전달, Meetup 오렌지. (AC-7)
- [ ] web tsc 0(closesAt/isClosed/currentUserId 전 소비처) / web lint 0 / web build 0. (AC-8)
- [ ] mobile tsc/vitest/expo export 회귀 0(모바일 무변경). (AC-8)
- [ ] 디바이스 종단 검증: 상세 → 마감 시각 정해 생성 → 마감 전 투표(단일/다중) → 생성자 "마감하기" → "마감됨" 배지 + 비활성 컨트롤 + 결과 표시 → 마감 poll 투표 차단(409) → 비생성자/마감 poll "마감하기" 미노출 라이브 확인. (AC-8, device-gated) — iOS 시뮬레이터에서 모바일 WebView poll 마감 인터랙션(Server Action + revalidatePath)이 WebView 컨텍스트에서 마감 상태를 갱신하는지 검증 대기.
