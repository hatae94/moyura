# SPEC-MOIM-006 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-006: 투표 다중 선택(multi-select) — 가능한 항목 모두 선택
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 iOS 시뮬레이터 확인. 백엔드는 jest(다중 신규 + 단일 회귀). api-client 는 tsc.

## 수용 기준 (AC)

### AC-1: 다중 선택 데이터 모델 + 비파괴 PK 마이그레이션 (← REQ-MOIM6-001)

`Poll.multiSelect`(기본 false, additive)가 추가되고, `PollVote` PK 가 `(pollId,userId)` → `(pollId,optionId,userId)` 로 비파괴 변경되며(기존 단일 선택 표 보존), Cascade FK 가 유지된다.

- **Given** 기존 스키마(poll/poll_option/poll_vote 단일 선택 PK)와 단일 선택 표 데이터가 있고
- **When** 비파괴 마이그레이션(multi_select 컬럼 ADD + poll_vote PK DROP/ADD)을 적용하면
- **Then** `poll.multi_select` 가 기본 false 로 추가되고(기존 poll 모두 false), `poll_vote` PK 가 `(poll_id, option_id, user_id)` 로 바뀌며, **기존 단일 선택 표가 한 row 도 손실되지 않고**(row count 불변), FK(cascade)·`@@index([optionId])` 가 유지되고, `prisma migrate status` 가 clean 이며, 기존 테이블/동작(모임·멤버·채팅·초대·단일 투표)에 회귀가 없다.

### AC-2: 투표 생성 — multiSelect 옵트인 (← REQ-MOIM6-002)

`POST /moims/:id/polls` 가 optional `multiSelect`(기본 false)를 받아 poll 을 생성한다. 단일 선택 생성은 무변경, 빈 question·옵션<2 는 400, 비멤버는 403.

- **Given** 모임 멤버가
- **When** `{ question, options: ["A","B","C"], multiSelect: true }` 로 생성하면 **Then** 201 + `multiSelect: true` poll 이 세 옵션과 함께 생성된다.
- **And When** `multiSelect` 를 생략하고 생성하면 **Then** `multiSelect: false`(단일 선택) poll 이 생성된다(MOIM-005 동작 동일).
- **And When** question 이 비었거나 유효 옵션이 2개 미만이면 **Then** 400 을 반환한다.
- **And When** 비멤버가 호출하면 **Then** 403(미존재 모임도 403)을 반환한다.

### AC-3: 단일 교체 / 다중 토글 (← REQ-MOIM6-003)

`POST /moims/:id/polls/:pollId/vote` 가 `poll.multiSelect` 로 분기한다 — 단일(false)은 교체(MOIM-005 보존), 다중(true)은 토글. 잘못된 optionId 400, 다른 모임 pollId 404, 비멤버 403(단일/다중 공통).

- **Given** `multiSelect: false` poll(옵션 A/B)이 있고
- **When** 멤버가 `{ optionId: A }` 로 투표하면 **Then** 그 멤버 표가 A(총 1표)다.
- **And When** 같은 멤버가 `{ optionId: B }` 로 다시 투표하면 **Then** 표가 B 로 **교체**된다(여전히 총 1표 — A 0 / B 1, 합산 아님). [MOIM-005 회귀 0]
- **Given** `multiSelect: true` poll(옵션 A/B/C)이 있고
- **And When** 멤버가 A 에 투표하면 **Then** A 표가 추가된다(멤버 표 = {A}).
- **And When** 같은 멤버가 B 에 투표하면 **Then** B 표가 추가된다(멤버 표 = {A, B} 동시 보유 — 교체 아님).
- **And When** 같은 멤버가 A 에 다시 투표하면 **Then** A 표가 **제거**된다(토글 off, 멤버 표 = {B}).
- **And When** 그 poll 에 속하지 않는 optionId 로 투표하면 **Then** 400(단일/다중 공통).
- **And When** 다른 모임의 pollId 로 투표하면 **Then** 404.
- **And When** 비멤버가 투표하면 **Then** 403.

### AC-4: 투표 목록 + 결과 — multiSelect + myVotes 목록 (← REQ-MOIM6-004)

`GET /moims/:id/polls` 가 각 poll 의 `multiSelect`, 옵션별 voteCount(표 0 포함), 호출자 `myVotes: string[]`(목록, 미투표 빈 배열)를 반환한다. 비멤버 403, poll 없으면 빈 배열.

- **Given** 멤버이고 `multiSelect: true` poll(옵션 A/B/C)에서 호출자가 A,C 를 고른 상태에서
- **When** `GET /moims/:id/polls` 를 호출하면 **Then** 그 poll 에 `multiSelect: true`, A `voteCount`(A 를 고른 멤버 수)·B·C 의 voteCount(표 0 옵션은 0), `myVotes: [A, C]`(순서 무관)가 포함된다.
- **And Given** 단일 선택 poll 에서 호출자가 한 옵션을 골랐으면 **Then** `multiSelect: false`, `myVotes`(1요소)다.
- **And When** 호출자가 아직 투표하지 않았으면 **Then** 그 poll 의 `myVotes: []`(빈 배열).
- **And When** 모임에 poll 이 없으면 **Then** 빈 배열을 반환한다(에러 아님).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 404→403)이고 투표 내용을 노출하지 않는다.

### AC-5: api-client 갱신 (← REQ-MOIM6-005)

api-client 재생성으로 `PollResponse` 에 `multiSelect`·`myVotes` 가 반영되고 `myVote` 가 제거된다. 별칭 유지, web 헬퍼/타입 갱신.

- **Given** 백엔드 OpenAPI 가 multiSelect/myVotes 를 노출하고
- **When** `nx run api-client:generate` 후 tsc 를 실행하면
- **Then** `PollResponse`(= `components['schemas']['PollResponseDto']`)에 `multiSelect: boolean` + `myVotes: string[]` 이 있고 `myVote` 가 없으며, web `PollWithResults`(`multiSelect`/`myVotes`)와 모든 소비처가 일치해 backend/web/api-client tsc 가 0 error 다(수동 schema 편집 없음).

### AC-6: 웹 다중 선택 UI (← REQ-MOIM6-006)

모임 상세가 다중 선택 poll 을 체크박스형(여러 강조 + 토글)으로, 단일 선택 poll 을 MOIM-005 그대로 렌더한다. 생성 폼에 "여러 개 선택 허용" 토글. Meetup 오렌지.

- **Given** 인증·이름 보유 멤버가 모임 상세(`/home/{id}`)에 있고
- **When** `multiSelect: true` poll 이 있으면 **Then** 각 선택지가 체크박스형으로 보이고, 멤버가 고른 **여러 선택지가 동시에 강조**되며, 한 선택지를 탭하면 그 선택지가 토글(추가/제거)되고 득표 수/퍼센트가 갱신된다.
- **And When** `multiSelect: false` poll 이 있으면 **Then** MOIM-005 단일 선택 렌더(한 강조, 탭=교체)가 그대로 동작한다(회귀 0).
- **And When** "투표 만들기" 에서 "여러 개 선택 허용" 토글을 켜고 질문+선택지(≥2)를 제출하면 **Then** `multiSelect: true` poll 이 생성되어 다중 선택형으로 나타난다.
- **And When** 토글을 끄고(기본) 제출하면 **Then** 단일 선택 poll 이 생성된다.
- **And When** 투표/생성이 백엔드 오류를 반환하면 **Then** 폼/화면에 머무르며 일반화 오류를 표시한다(토큰/상세 비노출).
- **And** 투표 섹션·생성 폼·토글이 모두 Meetup 오렌지 토큰(`bg-primary` 등)을 쓴다(login/onboarding blue 아님).

### AC-7: 품질 게이트 (← spec.md §7)

backend jest 통과(다중 신규 + 단일 회귀), backend+web+api-client tsc 0, web lint 0, web build 0, prisma migrate clean(multiSelect 컬럼 + PK 비파괴, 기존 표 보존), mobile tsc/vitest/expo export 회귀 0.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(다중 생성 → 다중 토글 추가/제거/여러 강조 → 단일 회귀)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **다중 토글 0 표**: 다중 선택 poll 에서 멤버가 자기 표를 모두 토글 off → `myVotes: []`, 그 멤버 기여 voteCount 모두 감소. 멤버는 0표 보유 가능(유효 — 강제 1표 아님). (← REQ-MOIM6-003/004)
- **다중 voteCount 의미**: 다중에서 한 옵션 voteCount = 그 옵션을 고른 **서로 다른 멤버 수**(멤버당 옵션당 1표). 총표(sum)가 멤버 수보다 클 수 있고 퍼센트 합이 100% 아닐 수 있다(총표 대비 표시). (← REQ-MOIM6-004)
- **단일 회귀(재투표 교체)**: multiSelect=false poll 에서 같은 멤버가 두 번 투표 → 교체(총 1표 불변). PK 변경 후에도 deleteMany+create 로 동작 보존. (← REQ-MOIM6-003)
- **PK 변경 데이터 안전**: 기존 단일 선택 표는 (pollId,userId) 유일 → (pollId,optionId,userId) 자동 유일 → 신규 PK 위반 0 → 마이그레이션 후 row 손실 0. (← REQ-MOIM6-001)
- **교차-poll optionId**: 다른 poll 의 옵션 id 로 투표 → 400(단일/다중 공통, 집계 오염 차단). (← REQ-MOIM6-003)
- **다른 모임의 pollId**: path moimId 무관 poll 투표 → 404. (← REQ-MOIM6-003)
- **표 0 옵션**: 아무도 안 고른 옵션도 voteCount:0 으로 응답 포함. (← REQ-MOIM6-004)
- **myVote→myVotes 누락 소비처**: 갱신 안 된 소비처는 tsc 가 컴파일 타임에 차단(런타임 도달 불가). (← REQ-MOIM6-005)
- **multiSelect 생략 생성**: 생성 요청에 multiSelect 없으면 false(단일) — 기존 클라이언트/MOIM-005 호출 호환. (← REQ-MOIM6-002)
- **비멤버 접근**: 비멤버가 생성/투표/조회 → 모두 403(미존재 모임도 403). PK/multiSelect 변경이 인가에 영향 없음. (← REQ-MOIM6-002/003/004)
- **세션 만료 후 제출**: Server Action 시점 세션 부재 → `/login` 리다이렉트(poll/표 미생성). (← REQ-MOIM6-006)
- **데스크톱 vs 모바일**: 다중 선택 UI 는 데스크톱 일반 렌더 + 모바일 in-WebView(상세 `/home/{id}` 안 — 신규 네이티브 라우트 없음). Server Action(`revalidatePath`)이 WebView 안에서 다중 토글 결과를 갱신하는지 디바이스 검증.

## Definition of Done (DoD)

- [x] `Poll.multiSelect`(기본 false, additive) 추가 + `PollVote` PK `(pollId,optionId,userId)` 비파괴 변경(기존 표 보존, row 손실 0), prisma migrate clean. (AC-1) — 라이브 검증 2026-06-20
- [x] `POST /moims/:id/polls` 가 optional multiSelect(기본 false) 수용 + 단일 선택 생성 무변경 + question 빈/옵션<2 400 + 비멤버 403. (AC-2) — 라이브 검증 2026-06-20
- [x] `POST .../vote` 가 poll.multiSelect 분기 — 단일=교체(총 1표 불변, MOIM-005 회귀 0) / 다중=토글(추가/제거, 0..N) + 잘못된 optionId 400 + 다른 모임 pollId 404 + 비멤버 403. (AC-3) — 라이브 검증 2026-06-20
- [x] `GET /moims/:id/polls` 가 multiSelect + 옵션 voteCount(다중=멤버 수, 표 0 포함) + myVotes(목록, 미투표 빈 배열) + 비멤버 403 + poll 없으면 빈 배열. (AC-4) — 라이브 검증 2026-06-20
- [x] DTO(`CreatePollDto.multiSelect`, `PollResponseDto.multiSelect`+`myVotes`, myVote 제거) + service vote 분기/aggregate myVotes 갱신. (AC-2/3/4) — 라이브 검증 2026-06-20
- [x] backend jest 신규(다중 생성/토글/voteCount/myVotes) + 단일 회귀(생성/교체/총 1표 불변) + 400/403/404 통과. (AC-1~4/AC-7) — jest 269/269 (+11)
- [x] `schema.d.ts` 재생성 + api-client `PollResponse`(multiSelect/myVotes, myVote 제거) + 별칭 유지, tsc 0. (AC-5) — tsc 0(all)
- [x] web `PollWithResults`(multiSelect/myVotes) + `OptionRow` 강조(`myVotes.includes`) + `PollCard` 단일/다중 분기 + `CreatePollForm` "여러 개 선택 허용" 토글, Meetup 오렌지. (AC-6) — 라이브 검증 2026-06-20
- [x] web tsc 0(myVote→myVotes 전 소비처) / web lint 0 / web build 0. (AC-7) — tsc 0, lint 0, build 0
- [x] mobile tsc/vitest/expo export 회귀 0(모바일 무변경). (AC-7) — mobile vitest 215/215(회귀 0)
- [ ] 디바이스 종단 검증: 상세 → "여러 개 선택 허용" 켜고 생성 → 다중 토글(추가/제거/여러 강조) → 득표/퍼센트 갱신 → 단일 poll 회귀(한 강조, 교체) 라이브 확인. (AC-7, device-gated) — iOS 시뮬레이터에서 모바일 WebView poll 인터랙션(Server Action + revalidatePath)이 WebView 컨텍스트에서 다중 결과를 갱신하는지 검증 대기

---

## 웹 멀티탭 검증 완료 (2026-06-22)

웹 UI 표면은 chrome-devtools 2 격리 세션(앨리스=생성자/방장, 밥=멤버)으로 실제 2-멤버 브라우저 워크스루를 통과했다(투표 생성/단일·다중 투표/마감/날짜·장소 확정→헤더 갱신/실시간 cross-member 전파/per-user myVotes 정확/생성자 전용 마감/3-way 종류 선택). 상세 결과·시나리오는 `.moai/reports/mobile-verification-runbook.md` 부록 A 참조.

남은 device-gate: **모바일 iOS WebView 셸 + 네이티브 Google Sign-In** 검증(런북 §3~4). 그 전까지 status `in-progress` 유지(프로젝트 메모리 `mobile-spec-device-gated`).
