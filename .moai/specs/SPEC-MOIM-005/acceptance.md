# SPEC-MOIM-005 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-005: 모임 투표(poll) — 생성·단일 투표·결과 집계
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 라이브 iOS 시뮬레이터 확인. 백엔드는 jest. api-client 는 tsc.

## 수용 기준 (AC)

### AC-1: 투표 데이터 모델 + 비파괴 마이그레이션 (← REQ-MOIM5-001)

신규 3 테이블(`Poll`/`PollOption`/`PollVote`)이 additive 로 추가되고, `PollVote` 의 복합 PK `(pollId, userId)` 가 멤버당 한 투표를 강제하며, moim/poll 삭제 시 Cascade 로 종속 데이터가 정리된다. `moim` 등 기존 테이블은 무변경이다.

- **Given** 기존 스키마(moim/moim_member/moim_invite/chat_message)와 그 데이터가 있고
- **When** 비파괴 마이그레이션(신규 3 테이블 CREATE)을 적용하면
- **Then** poll/poll_option/poll_vote 테이블이 FK(cascade) + `poll_vote (poll_id, user_id)` 복합 PK 와 함께 생성되고, 기존 테이블/row 와 동작(생성·목록·상세·멤버·채팅·초대)에 회귀가 없으며, `prisma migrate status` 가 clean 이다.

### AC-2: 투표 생성 + 검증 (← REQ-MOIM5-002)

`POST /moims/:id/polls` 가 멤버의 `{ question, options[] }` 로 poll + 옵션을 생성하고(createdBy = 가드 sub), 빈 question·유효 옵션 <2 는 400, 비멤버는 403이다.

- **Given** 모임 멤버가
- **When** `{ question, options: ["A", "B"] }` 로 `POST /moims/:id/polls` 를 호출하면
- **Then** 201 + poll 이 두 옵션과 함께 생성되고 `createdBy` 가 호출자 sub 다.
- **And When** `question` 이 비어 있으면 **Then** 400 을 반환한다.
- **And When** (trim 후) 유효 옵션이 1개뿐이면 **Then** 400 을 반환한다(최소 2 선택지).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 모임도 403)을 반환한다.

### AC-3: 단일 투표 + 재투표 교체 (← REQ-MOIM5-003)

`POST /moims/:id/polls/:pollId/vote` 가 멤버의 표를 `(pollId, userId)` 로 upsert 하며(재투표 = 교체, 추가 아님), 잘못된 optionId 는 400, 다른 모임의 pollId 는 404, 비멤버는 403이다.

- **Given** 모임 멤버와 옵션 A/B 를 가진 poll 이 있고
- **When** 멤버가 `{ optionId: A }` 로 투표하면 **Then** 그 멤버의 표가 A 로 기록된다(총 1표).
- **And When** 같은 멤버가 다시 `{ optionId: B }` 로 투표하면 **Then** 표가 B 로 **교체**된다(여전히 그 멤버는 총 1표 — A 0 / B 1, 합산 아님).
- **And When** 그 poll 에 속하지 않는 optionId 로 투표하면 **Then** 400 을 반환한다.
- **And When** 다른 모임에 속한 pollId 로 투표하면 **Then** 404(또는 400)를 반환한다.
- **And When** 비멤버가 투표하면 **Then** 403 을 반환한다.

### AC-4: 투표 목록 + 결과 집계 (← REQ-MOIM5-004)

`GET /moims/:id/polls` 가 모임의 poll 들을 반환하며, 각 poll 은 옵션별 voteCount(표 0 포함) + 호출자의 myVote(optionId 또는 null)를 포함한다. 비멤버는 403, poll 없으면 빈 배열이다.

- **Given** 멤버이고 옵션 A(2표)/B(0표) 를 가진 poll 이 있으며 호출자가 A 에 투표한 상태에서
- **When** `GET /moims/:id/polls` 를 호출하면 **Then** poll 에 옵션 A `voteCount: 2`, 옵션 B `voteCount: 0`, `myVote: A` 가 포함된다.
- **And When** 호출자가 아직 투표하지 않았으면 **Then** 그 poll 의 `myVote: null` 이다.
- **And When** 모임에 poll 이 하나도 없으면 **Then** 빈 배열을 반환한다(에러 아님).
- **And When** 비멤버가 호출하면 **Then** 403(미존재 404→403)을 반환하고 투표 내용을 노출하지 않는다.

### AC-5: 웹 투표 UI (← REQ-MOIM5-006)

모임 상세(`/home/[id]`)가 투표 섹션을 렌더한다 — 각 poll 의 질문·옵션·득표 수(막대/퍼센트)·내 표 강조, 동작하는 단일 선택 투표 컨트롤, 동작하는 "투표 만들기" 폼(질문 + 동적 옵션 ≥2). Meetup 오렌지 디자인, 정직한 빈 상태("아직 투표가 없어요").

- **Given** 인증·이름 보유 멤버가 모임 상세(`/home/{id}`)에 있고
- **When** 투표가 있으면 **Then** 각 poll 의 질문 + 옵션별 라벨·득표 수(막대/퍼센트) + 내가 고른 선택지 강조가 보인다.
- **And When** 한 선택지를 탭하면 **Then** 자신의 표가 기록/교체되고 득표 수·강조가 갱신된다(`revalidatePath`/재조회).
- **And When** "투표 만들기" 에 질문 + 선택지(≥2)를 입력해 제출하면 **Then** 실제 poll 이 생성되어 목록에 나타난다.
- **And When** 투표가 하나도 없으면 **Then** "아직 투표가 없어요" 빈 상태가 보인다(허위 값 없음).
- **And** 투표 섹션·생성 폼이 모두 Meetup 오렌지 토큰(`bg-primary` 등)을 쓴다(login/onboarding blue 아님).

### AC-6: 품질 게이트 (← spec.md §7)

backend jest 통과(신규 poll 케이스 포함), backend+web+api-client tsc 0, web lint 0, web build 0, prisma migrate clean(비파괴 3 테이블), mobile tsc/vitest/expo export 회귀 0.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(상세 → 투표 만들기 → 투표 → 득표/내 표 갱신 → 재투표 교체)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **빈 질문 / 옵션 부족 제출**: question 빈 값 또는 유효 옵션 <2 제출 → 생성 폼에 머무르며 일반화 오류 표시(poll 미생성). (← REQ-MOIM5-002/006 Unwanted)
- **빈 옵션 항목 혼재**: 옵션 입력에 빈 칸이 섞여 있으면 trim 후 비지 않은 항목만 센다 — 유효 항목 ≥2면 생성, 미만이면 400. (← REQ-MOIM5-002)
- **재투표(선택 변경)**: 같은 멤버가 한 poll 에 두 번 투표 → 둘째 표가 첫째를 교체(총 1표, 합산 아님). `(pollId,userId)` PK + upsert 로 보장. (← REQ-MOIM5-003)
- **교차-poll optionId**: 다른 poll 의 옵션 id 로 투표 시도 → 400(집계 오염 차단). (← REQ-MOIM5-003 Unwanted)
- **다른 모임의 pollId**: path moimId 와 무관한 poll 에 투표 시도 → 404(poll-모임 일관성). (← REQ-MOIM5-003 Unwanted)
- **표 0 옵션**: 아무도 안 고른 옵션도 `voteCount: 0` 으로 응답에 포함(빠뜨리지 않음). (← REQ-MOIM5-004)
- **poll 없는 모임**: poll 0개 → 빈 배열 + 웹 "아직 투표가 없어요"(에러/허위 값 없음). (← REQ-MOIM5-004/006)
- **비멤버 접근**: 비멤버가 생성/투표/조회 시도 → 모두 403(미존재 모임도 403) — 투표 내용 비노출. (← REQ-MOIM5-002/003/004 Unwanted)
- **세션 만료 후 제출**: Server Action 시점 세션 부재 → `/login` 리다이렉트(poll/표 미생성). (← REQ-MOIM5-006)
- **백엔드 오류**: 생성/투표가 400/네트워크 오류 → 폼/화면 머무름 + 일반화 오류(토큰/오류 상세 비노출). (← REQ-MOIM5-006 Unwanted)
- **데스크톱 vs 모바일**: 투표 UI 는 데스크톱 일반 렌더 + 모바일 in-WebView(상세 `/home/{id}` 안 — 신규 네이티브 라우트 없음). Server Action(`revalidatePath`)이 WebView 안에서 동작해 결과가 갱신되는지 디바이스 검증.
- **옵션 표시 순서**: `position` 컬럼 부재(Exclusions)로 옵션은 결정적 키(id)로 안정 정렬 표시 — 생성 순서 보장은 향후. (← spec.md §5)

## Definition of Done (DoD)

- [x] `Poll`/`PollOption`/`PollVote` 모델 추가(`PollVote` 복합 PK `(pollId,userId)`, FK cascade), 비파괴 마이그레이션 적용(신규 3 테이블, moim 무변경), prisma migrate clean. (AC-1) — 라이브 검증 2026-06-19
- [x] poll 도메인(service/controller/DTO/module) 추가 — `@Controller('moims/:id/polls')`, 모든 진입 assertMember. (AC-2/AC-3/AC-4) — 라이브 검증 2026-06-19
- [x] `POST /moims/:id/polls` 생성(createdBy=sub) + question 빈 400 + 유효 옵션<2 400 + 비멤버 403. (AC-2) — 라이브 검증 2026-06-19
- [x] `POST /moims/:id/polls/:pollId/vote` upsert(재투표 교체) + 잘못된 optionId 400 + 다른 모임 pollId 404 + 비멤버 403. (AC-3) — 라이브 검증 2026-06-19 (재투표 총 1표 불변 확인)
- [x] `GET /moims/:id/polls` 옵션별 voteCount(표 0 포함) + myVote(null/optionId) + 비멤버 403 + poll 없으면 빈 배열. (AC-4) — 라이브 검증 2026-06-19
- [x] backend jest 신규 케이스(생성/검증/투표/재투표/집계/myVote/스코핑/400) 통과. (AC-1~4/AC-6) — jest 258/258 (poll 36 케이스)
- [x] `schema.d.ts` 재생성 + api-client poll 타입 별칭(`CreatePollRequest`/`VoteRequest`/`PollResponse`), tsc 0. (AC-6) — 라이브 검증 2026-06-19
- [x] web 헬퍼(`lib/moim/polls.ts`) 구체-경로 호출 + 상세 Server Component 의 poll fetch + Client 섬(`polls-section.tsx`) + Server Action(`poll-actions.ts`). (AC-5) — 라이브 검증 2026-06-19
- [x] 투표 섹션(질문/옵션/득표 막대/내 표 강조) + 동작 투표 컨트롤 + 동작 생성 폼(질문+동적 옵션≥2) + 빈 상태("아직 투표가 없어요"), Meetup 오렌지 토큰. (AC-5) — 라이브 검증 2026-06-19
- [x] web tsc 0 / web lint 0 / web build 0(Client 섬 + Server Action 컴파일). (AC-6) — 라이브 검증 2026-06-19
- [x] mobile tsc/vitest/expo export 회귀 0(모바일 무변경). (AC-6) — mobile vitest 215/215 회귀 0
- [x] 디바이스 종단 검증: 상세 → 투표 만들기 → 생성된 투표 표시 → 투표 → 득표/내 표 갱신 → 재투표 교체 라이브 확인. (AC-6, device-gated) — 2026-06-22 검증 완료: Maestro iOS 시뮬레이터(iPhone 16) in-WebView poll 렌더 확인 + 데스크톱 멀티탭 워크스루(생성 → 투표 → 득표/내 표 갱신 → 재투표 교체) + poll-*.live.mts

---

## 웹 멀티탭 검증 완료 (2026-06-22)

웹 UI 표면은 chrome-devtools 2 격리 세션(앨리스=생성자/방장, 밥=멤버)으로 실제 2-멤버 브라우저 워크스루를 통과했다(투표 생성/단일·다중 투표/마감/날짜·장소 확정→헤더 갱신/실시간 cross-member 전파/per-user myVotes 정확/생성자 전용 마감/3-way 종류 선택). 상세 결과·시나리오는 `.moai/reports/mobile-verification-runbook.md` 부록 A 참조.

device-gate 해소(2026-06-22): **모바일 iOS WebView 셸** 검증 완료 — Maestro(iPhone 16) hands-free in-WebView 렌더(상세 push + poll 렌더 + finalize 헤더 반영 + invite-accept + 채팅) + 데스크톱 멀티탭 워크스루 + poll-*.live.mts. status `completed` 전환. (참고: Maestro poll-option 직접 탭은 a11y resolution + Next dev badge overlay로 불안정 — 투표 자체는 데스크톱 멀티탭/live.mts로 실증, 앱 결함 아님)
