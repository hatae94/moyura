# Sync Report — SPEC-MOIM-006

생성일: 2026-06-20
브랜치: feature/SPEC-MOBILE-004
커밋: 71544c4
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-006/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 라이브 검증 결과 + 자동 게이트 + device-gated 이유) |
| `.moai/specs/SPEC-MOIM-006/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 자동 게이트/라이브 검증 항목 ✓ 처리 + "라이브 검증 2026-06-20" 주석; 디바이스 종단 검증 항목 미체크 + "iOS 시뮬레이터에서 모바일 WebView poll 인터랙션(Server Action + revalidatePath) 검증 대기" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-006 항목 추가(비파괴 PK 마이그레이션, 투표 의미론 분기, 읽기 모델 myVote→myVotes, api-client 갱신, 웹 다중 선택 UI, 라이브 검증, device-gated 미완료, SPEC-MOIM-005 후속 명시) |
| `.moai/project/structure.md` | 수정 | backend `src/poll/` 설명에 multiSelect 분기·PK 변경·myVotes·jest 269/269 반영; prisma schema+migrations에 add_poll_multi_select 추가; web `polls-section.tsx`·`poll-actions.ts` 설명에 다중 선택 UI 반영; api-client poll 타입 별칭 갱신; `moim/polls.ts` PollWithResults 갱신 주석 추가 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-006 요약 추가(in-progress, 커밋, 게이트 결과, 라이브 검증, device-gated); 구현됨 vs 계획됨 표에 SPEC-MOIM-006 in-progress 행 신규 추가 |
| `.moai/project/db/schema.md` | 수정 | last_synced_at 갱신; Tables에 poll/poll_vote 설명 갱신(multiSelect 컬럼 추가, PK 변경); poll 테이블 상세에 multi_select 컬럼 행 추가; poll_vote 테이블 상세에 복합 PK `(poll_id,option_id,user_id)` 변경 반영 + 비파괴 논증 + @@index([optionId]) 보존 주석; Indexes에 poll_vote PK 갱신 + @@index([optionId]) 행 추가; Constraints에 poll_vote_pkey 변경 반영 |
| `.moai/project/db/erd.mmd` | 수정 | 최종 갱신 주석 업데이트(SPEC-MOIM-006); POLL 엔티티에 `boolean multi_select` 필드 추가; POLL_VOTE 엔티티 PK `(poll_id, option_id, user_id)` 변경(option_id를 PK 필드로 승격) |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `add_poll_multi_select` 행 추가; Pending Migrations에 동일 항목 추가; Rollback Notes에 add_poll_multi_select 롤백 절차 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-006.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 데스크톱 브라우저 + API 라이브 검증(AC-1~6)까지 완료되었으나, 모바일 WebView 셸에서 투표/생성 Server Action + `revalidatePath`가 동작해 다중 선택 결과가 갱신되는지 iOS 시뮬레이터 검증이 미완료 상태이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: iOS 시뮬레이터 dev build에서 모임 상세(`/home/{id}`) 진입 → "여러 개 선택 허용" 켜고 투표 생성 → 다중 선택 poll에서 여러 선택지 토글(추가/제거, 여러 강조 동시) → 득표/퍼센트 갱신 → 단일 선택 poll 회귀(한 강조, 교체)를 WebView 안에서 라이브 확인 시.

---

## 3. 구현 범위 및 설계 결정

### multiSelect — poll별 opt-in 플래그

`Poll.multiSelect Boolean @default(false)`를 poll 테이블에 additive하게 추가했다. 기존 모든 poll row는 `false`(단일 선택 보존). 전역 모드가 아니라 **poll 생성 시 결정**하는 per-poll 플래그다. 이는 SPEC 작성 당시(§5)에서 확정된 설계 결정으로, 모임 전체나 앱 전역 설정을 두지 않는다.

### PollVote PK 비파괴 변경 — 데이터 안전성 논증

SPEC-MOIM-005의 PK `(pollId,userId)`는 멤버당 한 투표(단일 선택) 불변식을 DB 레벨에서 강제했다. 다중 선택에서는 한 멤버가 한 poll에서 옵션당 한 표씩 0..N개를 보유해야 하므로 `(pollId,optionId,userId)` PK가 필요하다.

**데이터 손실 0 논증**:
- 기존의 모든 PollVote row는 `(pollId,userId)` 기준으로 정확히 1 row
- → 같은 `(pollId,userId)` 쌍에 두 개의 row가 없음
- → 그들의 `(pollId,optionId,userId)` 조합도 자동으로 모두 유일
- → 기존 데이터 집합이 신규 PK 제약을 이미 위반 없이 만족
- → "기존 PK DROP → 신규 PK ADD"는 어떤 row도 충돌·삭제하지 않음(순수 제약 재정의)

검증 결과: 마이그레이션 적용 후 기존 단일 선택 표 1 row 보존 확인, PK 위반 0.

### vote 분기 재작성 — upsert 제거

PK가 `(pollId,optionId,userId)`로 바뀌면 Prisma의 upsert `where: { pollId_userId }` 식별자가 더 이상 유효하지 않다(`pollId_userId`가 unique constraint로 존재하지 않음). 따라서 명시적 find/delete/create 패턴으로 재작성했다:

- **단일(`multiSelect=false`)**: assertMember → poll 일관성(404) → optionId 소속(400) 검증 후, `deleteMany({ where: { pollId, userId } })`로 그 poll의 호출자 표를 모두 삭제하고 새 표를 `create`. 결과는 멤버당 정확히 한 표 — MOIM-005 교체 동작 보존.
- **다중(`multiSelect=true`)**: 같은 검증 후, `findUnique({ where: { pollId_optionId_userId } })` → 있으면 `delete`(토글 off), 없으면 `create`(토글 on). 멤버는 0..N 표 보유.

### 읽기 모델 myVote → myVotes (genuine break)

MOIM-005의 `myVote: string | null`은 다중 선택의 0..N 선택을 표현할 수 없다. `myVotes: string[]`로 교체하고, 단일 선택 poll도 동일 포맷(0 또는 1 요소)으로 통일했다. 클라이언트는 `multiSelect` 플래그 없이 `myVotes.includes(optionId)`로 강조를 판정 — 분기 코드 최소화.

영향 소비처(모두 동시 갱신, tsc 게이트로 누락 차단):
1. `PollResponseDto` — `myVote: string | null` 제거, `myVotes: string[]` 추가
2. `api-client schema.d.ts` — 재생성(수동 편집 없음)
3. `api-client index.ts` — `PollResponse` 타입 별칭 주석 갱신
4. `web lib/moim/polls.ts` — `PollWithResults` 타입 갱신
5. `web polls-section.tsx` — `OptionRow` `isMine` 비교 갱신

### 웹 — 단일/다중 렌더 분기 보존

`page.tsx`(Server Component)는 무변경 — 이미 `listPolls` fetch + `<PollsSection/>` 마운트. `PollWithResults` 타입이 갱신되어 그대로 흐른다.

`PollCard`(Client)가 `poll.multiSelect`로 분기:
- **다중**: 체크박스형 어포던스(여러 선택지 동시 강조 + "여러 개 선택 가능" 안내 + 탭=토글)
- **단일**: MOIM-005 그대로(한 강조 + 탭=교체)

`OptionRow.isMine = myVotes.includes(option.id)`로 통일(단일은 최대 1 요소라 동작 동일).

`CreatePollForm`에 "여러 개 선택 허용" 체크박스(`name="multiSelect"`) 추가. `createPollAction`이 `formData.get("multiSelect")`로 읽어 boolean으로 전달. 기본 꺼짐. Meetup 오렌지 토큰.

### 실시간/마감 제외

`revalidatePath` 기반 재조회(MOIM-005 동일). 실시간 Realtime 갱신 및 투표 마감/잠금은 SPEC-MOIM-006 Exclusions(§4).

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트 (재실행 없이 인용)

| 게이트 | 결과 |
|--------|------|
| backend jest | 269/269 (+11 다중 선택 신규 + 단일 선택 회귀 포함) |
| backend tsc | 0 error |
| web tsc | 0 error (myVote→myVotes 전 소비처 갱신 확인) |
| api-client tsc | 0 error |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| prisma migrate | clean (`add_poll_multi_select` — Poll.multiSelect 추가 + PollVote PK 비파괴 변경, 기존 단일 선택 표 보존) |
| expo export | OK (회귀 0) |

### 라이브 검증 (데스크톱 브라우저 + API 실 세션, 2026-06-20)

모임 "주말 등산 모임" 상세(`/home/{id}`) 기준:

| 시나리오 | 결과 |
|----------|------|
| "여러 개 선택 허용" 토글 켜고 "가능한 날짜 모두 선택"(토요일/일요일/월요일) 생성 | multiSelect:true poll 생성 확인 |
| 토요일 토글(추가) | 토요일 강조, myVotes:[토요일], 총 1표 |
| 월요일 토글(추가) | 토요일+월요일 동시 강조, myVotes:[토요일,월요일], 50%/50%, 총 2표 |
| 토요일 토글(제거) | 토요일 강조 해제, myVotes:[월요일], 총 1표 |
| API myVotes 검증 | GET /moims/:id/polls → myVotes 목록 증가(2)/감소(1) 토글 확인 |
| 단일 선택 poll "다음 산행 어디로 갈까요?" | 버튼 렌더·표 교체(총 1표 불변) 회귀 0 확인 |
| Meetup 오렌지 디자인 토큰 | 다중 선택 체크박스형 강조도 orange primary 토큰 확인 |

**다중 토글 동시 강조 증명**: 토요일+월요일 두 선택지가 동시에 강조되고 각 50% 표시. myVotes 목록이 2 요소로 반환됨을 API 응답으로 직접 확인.

**단일 선택 회귀 증명**: 기존 단일 선택 poll에서 재투표 시 총 1표 불변. deleteMany+create 분기가 MOIM-005 교체 의미론을 올바르게 보존함.

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 다중 선택 데이터 모델 + 비파괴 PK 마이그레이션 | Poll.multiSelect additive 추가, PollVote PK (pollId,optionId,userId) 비파괴 변경, 기존 표 보존, Cascade 보존 | prisma migrate clean + jest 269/269 + 기존 표 row 손실 0 검증 | **PASS** |
| AC-2: 투표 생성 — multiSelect 옵트인 | POST /moims/:id/polls optional multiSelect(기본 false), 단일 선택 생성 무변경, 빈 question 400, 비멤버 403 | jest poll 케이스 + 라이브 다중 poll 생성 확인 | **PASS** |
| AC-3: 단일 교체 / 다중 토글 | POST .../vote poll.multiSelect 분기 — 단일=교체(총 1표 불변, MOIM-005 회귀 0)/다중=토글(추가/제거, 0..N) + 잘못된 optionId 400 + 404 + 403 | jest poll 케이스 + 라이브 단일 교체 회귀 + 다중 토글 추가/제거 확인 | **PASS** |
| AC-4: 투표 목록 + 결과 — multiSelect + myVotes 목록 | GET /moims/:id/polls multiSelect, 옵션별 voteCount(멤버 수, 0 포함), myVotes:string[], 비멤버 403 | jest poll 케이스 + 라이브 API myVotes 증가/감소 확인 | **PASS** |
| AC-5: api-client 갱신 | PollResponse(multiSelect+myVotes, myVote 제거) + CreatePollRequest(multiSelect?) + 별칭 유지, tsc 0 | tsc 0(all) + 재생성 확인 | **PASS** |
| AC-6: 웹 다중 선택 UI | 다중=체크박스형(여러 강조+토글), 단일=MOIM-005 그대로, 생성 폼 "여러 개 선택 허용" 토글, Meetup 오렌지 | 라이브 브라우저 전 플로우 확인 | **PASS** |
| AC-7: 품질 게이트 (자동 부분) | jest/tsc/lint/build/vitest/migrate 전부 GREEN | 자동 게이트 결과 인용 | **PASS (자동 부분)** |
| AC-7: 품질 게이트 (device-gated 부분) | 모바일 WebView poll 인터랙션(Server Action+revalidatePath) 다중 결과 갱신 라이브 확인 | iOS 시뮬레이터 검증 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 모바일 WebView poll 인터랙션 검증

**검증이 필요한 플로우 (in-app, iOS 시뮬레이터):**

1. 앱 시작 → 로그인 → 홈 탭 → 모임 카드 탭 → 상세(`/home/{id}`) in-WebView 로드
2. 기존 poll 표시 확인(단일/다중 구분 렌더)
3. 다중 선택 poll에서 여러 선택지 토글(추가/제거, 여러 강조 동시)
4. `voteAction` Server Action 실행 → `revalidatePath` 후 득표 수/myVotes 갱신 확인
5. "여러 개 선택 허용" 켜고 투표 생성 → `createPollAction` 실행 → `revalidatePath` 후 목록 갱신
6. 단일 선택 poll 교체 동작 회귀 0 확인

**핵심 불확실성**: SPEC-MOIM-005와 동일 — Server Action + `revalidatePath`가 WebView 내 네비게이션 컨텍스트에서 올바르게 동작하는지 확인이 필요하다. 데스크톱에서는 검증됨. WebView 안에서 `revalidatePath` 후 페이지 재로드가 발생하는지, 그 과정에서 SPEC-MOIM-003 `detailRouteForUrl`이 재방문 URL을 오분류하지 않는지 확인 필요. 다중 선택 특이 사항: 여러 옵션을 빠르게 토글할 때 재조회 타이밍이 올바른지도 확인 대상.

---

## 7. DB 스키마 변경 (기존 테이블 수정)

### 수정된 테이블

| 테이블 | 변경 내용 | SPEC |
|--------|----------|------|
| `poll` | `multi_select BOOLEAN NOT NULL DEFAULT false` 컬럼 additive 추가(기존 row 모두 false) | SPEC-MOIM-006 |
| `poll_vote` | 복합 PK `(poll_id, user_id)` → `(poll_id, option_id, user_id)` 비파괴 변경 + `@@index([optionId])` 보존 | SPEC-MOIM-006 |

### 신규 마이그레이션

| 파일명 | 적용일 | 내용 |
|--------|--------|------|
| `add_poll_multi_select` | 2026-06-20 | poll.multi_select 컬럼 추가 + poll_vote PK 비파괴 변경(DROP+ADD). 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean). |

변경된 DB 문서: `.moai/project/db/schema.md`, `.moai/project/db/erd.mmd`, `.moai/project/db/migrations.md`

---

## 8. SPEC-MOIM-005 후속 관계

SPEC-MOIM-005 sync 리포트(섹션 8)가 투표를 "이벤트 트라이어드(일정·장소·투표)"의 세 번째 조각으로 기록했다. 본 SPEC-MOIM-006은 그 단일 선택 투표 인프라를 기반으로 다중 선택 의미론을 추가한다. 설계 결정(additive PK + per-poll opt-in + upsert→분기 + 읽기 모델 교체)은 SPEC 작성 시 모두 확정되어 spec.md §5에 기록되어 있다.

| 도메인 | SPEC | status |
|--------|------|--------|
| 단일 선택 투표 인프라 | SPEC-MOIM-005 | in-progress (device-gated) |
| 다중 선택(multi-select) 확장 | **SPEC-MOIM-006** | **in-progress (device-gated)** |
