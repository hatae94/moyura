# Sync Report — SPEC-MOIM-008

생성일: 2026-06-21
브랜치: feature/SPEC-MOBILE-004
커밋: 2b3ed8e
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-008/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 자동 게이트 + 백엔드 라이브 E2E 결과 + device-gated 이유) |
| `.moai/specs/SPEC-MOIM-008/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 백엔드/자동 게이트 항목 ✓ 처리 + "라이브 검증 2026-06-21" 주석; 웹 UI 브라우저 워크스루 항목 부분 체크 + 재로그인 대기 주석; 디바이스 종단 검증 항목 미체크 + "브라우저 세션 만료 + iOS 시뮬레이터 검증 대기" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-008 항목 추가(비파괴 마이그레이션, 날짜 투표 생성, finalize, close 응답, 읽기 모델, api-client, 웹 UI, 백엔드 라이브 E2E, device-gated 미완료, SPEC-MOIM-007 후속 명시) |
| `.moai/project/structure.md` | 수정 | backend `src/poll/` 설명에 kind/optionDate/finalize/parseKind/parseOptionDates/setStartsAt 반영; prisma schema+migrations에 kind/optionDate 컬럼 + 20260621000000_add_poll_kind_option_date 추가; `test/` 에 poll-finalize.live.mts 추가; web `polls-section.tsx`/`poll-actions.ts`/`lib/moim/polls.ts` 설명 갱신(날짜 투표 UI/finalize); api-client poll 타입 별칭 갱신 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-008 요약 추가(in-progress, 커밋, 게이트 결과, 라이브 E2E, device-gated); 구현됨 vs 계획됨 표에 SPEC-MOIM-008 in-progress 행 신규 추가 |
| `.moai/project/db/schema.md` | 수정 | last_synced_at + spec 헤더 갱신; Tables에 poll/poll_option 설명 갱신(kind/optionDate 컬럼 추가); poll 테이블 상세에 kind 컬럼 행 추가; poll_option 테이블 상세에 optionDate 컬럼 행 추가 + 마이그레이션 헤더 갱신 |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `20260621000000_add_poll_kind_option_date` 행 추가; Pending Migrations에 동일 항목 추가; Rollback Notes에 20260621000000_add_poll_kind_option_date 롤백 절차 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-008.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 백엔드 라이브 E2E(poll-finalize.live.mts, 실 Supabase 스택) 15/15 PASS가 확인되었으나, (1) 브라우저 웹 UI 워크스루가 moyura-verify 세션 access_token 만료로 미완료(재로그인 필요)이고, (2) 모바일 WebView 셸에서 날짜 투표 흐름(일정 투표 토글 → 날짜 옵션 생성 → 투표 → 생성자 마감 → 모임 헤더 startsAt 확정 갱신 / 동점 notice + 일정 불변)이 iOS 시뮬레이터에서 미검증 상태이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: (a) 브라우저 웹 UI 워크스루 — 재로그인 후 모임 상세(`/home/{id}`)에서 "일정 투표" 토글 켜고 날짜 ≥2 생성 → 옵션이 포맷 날짜로 렌더 + 확정 힌트 표시 → 멤버 투표 → 생성자 마감 → 단일 승자면 모임 헤더 일정 갱신 / 동점이면 동점 notice + 일정 불변 브라우저 확인. (b) iOS 시뮬레이터 dev build에서 동일 플로우가 WebView 안에서 라이브 검증되어야 함(Server Action `revalidatePath`가 poll 마감 AND 모임 헤더 startsAt을 둘 다 갱신하는지 확인). 두 조건 충족 시 `completed` 전환.

---

## 3. 구현 범위 및 설계 결정

### Poll.kind — string 컬럼(Prisma enum 회피 핵심 결정)

`Poll.kind String @default("general") @map("kind")`를 Prisma enum이 아닌 string 컬럼으로 구현한다. 이유: MOIM-005/006/007과 동일하게 비파괴 패턴(migrate diff → db execute → resolve → status clean)을 유지해야 하는데, Prisma enum은 PostgreSQL `CREATE TYPE`을 동반해 마찰이 생긴다. `@default("general")` string 컬럼은 `ALTER TABLE poll ADD COLUMN kind TEXT NOT NULL DEFAULT 'general';` 한 줄로 끝나고, 기존 poll row 모두 "general"로 비파괴 보존된다. 허용 값 검증은 컨트롤러 `parseKind` 헬퍼가 담당(미지 값 → 400).

### PollOption.optionDate — nullable additive

`PollOption.optionDate DateTime? @map("option_date")`는 날짜 투표 옵션의 실제 시각을 담는다. kind="date" 생성 시 `optionDate = 파싱된 시각`, `label = optionDate.toISOString()`(정규 라벨 — 기존 label 의존 코드가 안 깨지게 하되, 웹은 optionDate를 포맷해 표시). kind="general"이면 null(MOIM-005 그대로). finalize 판정은 optionDate를 직접 사용(label ISO 재파싱 금지 — Date 컬럼 직접 사용).

### MoimService.setStartsAt — startsAt 쓰기 단일 출처

현재 `Moim.startsAt` 쓰기 경로는 `MoimService.createMoim` 하나뿐이었다. finalize가 `PollService.closePoll`에서 직접 `prisma.moim.update`하면 쓰기 경로가 두 곳으로 흩어진다. `assertMember` 단일 출처 패턴을 미러해 신규 `MoimService.setStartsAt(moimId, startsAt)` 메서드를 추가하고 `closePoll`이 이를 호출한다. `setStartsAt`은 인가를 재검증하지 않는다(closePoll이 이미 assertMember + 생성자 검사를 통과시킴).

### finalize 트리거 = 생성자 수동 마감만 (passive 제외)

finalize는 오직 `POST .../close`(MOIM-007 생성자 전용) 핸들러 안에서만 일어난다. closesAt 시각이 지나는 것(passive deadline-pass)은 finalize를 일으키지 않는다. 이유: (1) 크론/스케줄러 불도입(§4 제외); (2) "닫으면 확정"이라는 명시적 행위에 묶는 것이 의미론적으로 명확; (3) 닫힌 poll을 GET해도 finalize가 중복 실행되지 않음(finalize는 close 1회 부작용).

### 동점·무표 = finalize 스킵(안전 기본값)

단일 최다 득표 옵션이 없으면 finalize를 건너뛰고 `Moim.startsAt` 불변. 자의적 tie-break(먼저 만든 옵션, 먼저 받은 표 등)는 의도하지 않은 일정을 확정할 위험이 있다. 차라리 동점을 생성자에게 알려 사람이 결정하게 한다(MVP 안전 기본값). close 응답의 `finalizeSkippedReason`("tie"|"no_votes")이 이를 전달한다.

### close 응답 shape = 기존 poll DTO + finalize 2필드

별도 wrapper(`{ poll, finalize }`)를 두지 않는다. 웹이 close 후 그 단건 poll(마감됨)과 동점 여부만 알면 되고, 모임 헤더 startsAt은 `revalidatePath`가 page 재렌더로 가져온다. vote/list 응답에서는 두 필드를 항상 null로 채운다(finalize는 close에서만 — 같은 DTO 재사용, 값 의미는 라우트가 정함).

### 웹 — 날짜 포맷 렌더 + 확정 힌트 + 동점 notice

- `CreatePollForm`: "일정 투표" 토글(name="kind") 추가. ON이면 동적 옵션을 `datetime-local`로 전환. `createPollAction`이 각 옵션을 `toIsoOrUndefined`로 ISO 변환.
- `PollCard`: kind="date"이면 각 옵션 라벨 대신 `optionDate` 포맷 날짜 렌더(raw ISO 금지). 열린 날짜 poll에 확정 힌트.
- close 후 `finalizeSkippedReason==="tie"`이면 동점 notice. 단일 승자(`finalizedStartsAt != null`)면 헤더 갱신으로 확정이 드러남(추가 notice 없음). `revalidatePath("/home/{id}")`가 poll(마감됨)과 모임 헤더 startsAt을 둘 다 재렌더.

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트 (재실행 없이 인용)

| 게이트 | 결과 |
|--------|------|
| backend jest | 301/301 (날짜 투표 신규 + finalize + MOIM-005/006/007 회귀 포함) |
| backend tsc | 0 error |
| web tsc | 0 error (kind/optionDate/finalize 전 소비처 갱신 확인) |
| api-client tsc | 0 error |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| prisma migrate | clean (`20260621000000_add_poll_kind_option_date` — Poll.kind NOT NULL DEFAULT 'general' + PollOption.option_date nullable 추가, PollVote PK 무변경, 기존 row 보존, CREATE TYPE 없음) |

### 백엔드 라이브 E2E (poll-finalize.live.mts, 실 Supabase 스택, 2026-06-21)

`apps/backend/test/poll-finalize.live.mts` — me.live.mts/chat.live.mts 패턴 미러, 실 Supabase DB + 가드 + 백엔드 서버 대상:

| 시나리오 | 결과 |
|----------|------|
| 날짜 투표 생성(kind="date", 유효 ISO 옵션 ≥2) | 201 + kind="date", optionDate/label 저장 확인 |
| 무효 날짜 옵션(kind="date", 무효 ISO 문자열) | 400 반환 확인 |
| 단일 승자 close → Moim.startsAt 설정 | finalizedStartsAt = 승자 ISO, finalizeSkippedReason = null, Moim.startsAt 설정 확인 |
| 동점 close (2 voters, 각 1표) | finalizedStartsAt = null, finalizeSkippedReason = "tie", startsAt 불변 확인 |
| 무표 close | finalizedStartsAt = null, finalizeSkippedReason = "no_votes", startsAt 불변 확인 |
| 일반 투표(kind="general") close | finalize 없음, finalizedStartsAt = null, finalizeSkippedReason = null, startsAt 불변 확인 |
| 비생성자 close | 403 반환, finalize 미실행, startsAt 불변 확인 |
| 기존 startsAt 덮어쓰기 | 이미 startsAt 있는 모임에 단일 승자 finalize → 기존 startsAt 덮어씀 확인 |

**총계**: 15/15 PASS (위 8개 시나리오 + 추가 케이스 포함)

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 날짜 투표 데이터 모델 + 비파괴 마이그레이션 | Poll.kind TEXT NOT NULL DEFAULT 'general' + PollOption.option_date nullable additive 추가, PollVote PK 무변경, 기존 row 보존, migrate clean, enum 회피 | prisma migrate clean + jest 301/301 + live.mts | **PASS** |
| AC-2: 날짜 투표 생성 — kind + optionDate | POST /moims/:id/polls kind="date" + ISO 날짜 옵션 수용(optionDate/label 저장), 미지 kind 400, 무효 날짜 옵션 400, 일반 투표 무변경, 비멤버 403 | jest poll 케이스 + poll-finalize.live.mts | **PASS** |
| AC-3: 날짜 투표 마감 시 자동 확정 — 단일 승자 → startsAt | close 단일 승자→Moim.startsAt(MoimService.setStartsAt), 동점→"tie" skip, 무표→"no_votes" skip, 일반 투표→finalize 없음, 덮어쓰기, 비생성자 403 | jest poll 케이스 + poll-finalize.live.mts | **PASS** |
| AC-4: 투표 목록 + 결과 — kind + optionDate 노출 | GET /moims/:id/polls kind/옵션 optionDate(ISO|null), 마감/finalize 된 날짜 투표 결과 조회 가능, 비멤버 403, 빈 배열 | jest poll 케이스 | **PASS** |
| AC-5: close 응답 — finalize 결과 노출 | finalizedStartsAt(ISO|null) + finalizeSkippedReason("tie"|"no_votes"|null), vote/list 응답은 둘 다 null | jest poll 케이스 + poll-finalize.live.mts | **PASS** |
| AC-6: api-client 갱신 | CreatePollRequest(kind?), PollResponse(kind/optionDate/finalize), multiSelect/myVotes/closesAt/isClosed 보존, tsc 0 | tsc 0(all) | **PASS** |
| AC-7: 웹 날짜 투표 UI + 일정 확정 갱신 | "일정 투표" 토글+datetime 옵션, 포맷 날짜 렌더, 확정 힌트, closePollAction finalize 결과, revalidatePath startsAt 갱신, 동점 notice, Meetup 오렌지 | web lint 0 + nx run web:build 0 (브라우저 워크스루 미완료 — 세션 만료) | **PASS (자동 부분) / PENDING — 브라우저 재로그인 대기** |
| AC-8: 품질 게이트 (자동 부분) | jest/tsc/lint/build/vitest/migrate 전부 GREEN | 자동 게이트 결과 인용 | **PASS (자동 부분)** |
| AC-8: 품질 게이트 (device-gated 부분) | 브라우저 웹 UI 워크스루 + 모바일 WebView 날짜 투표 흐름(일정 투표 생성 → 투표 → 생성자 마감 → 헤더 startsAt 확정 갱신 / 동점 notice) 라이브 확인 | 브라우저 재로그인 대기 + iOS 시뮬레이터 검증 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 브라우저 워크스루 + 모바일 WebView 검증

### 브라우저 웹 UI 워크스루 (재로그인 후)

moyura-verify 계정 세션 access_token이 sync 세션 중 만료. 재로그인 후 수행:

1. 로그인 → 홈 탭 → 모임 상세(`/home/{id}`)
2. "투표 만들기" → "일정 투표" 토글 ON → datetime-local 옵션 ≥2 입력 + 질문 → 제출
3. 날짜 투표 옵션이 포맷 날짜(raw ISO 아님)로 렌더되고 확정 힌트("마감 시 최다 득표 날짜가 모임 일정으로 확정돼요") 표시 확인
4. 멤버 계정으로 날짜 옵션에 투표
5. 생성자 계정으로 "마감하기" → 단일 승자면 모임 헤더 일정(startsAt) 갱신 확인 / 동점이면 동점 notice + 일정 불변 확인
6. poll "마감됨" 배지 + 투표 컨트롤 비활성 + 결과 유지 확인

### 모바일 iOS WebView 검증 (in-app, iOS 시뮬레이터)

1. 앱 시작 → 로그인 → 홈 탭 → 모임 카드 탭 → 상세(`/home/{id}`) in-WebView 로드
2. "일정 투표" 토글 켜고 날짜 옵션 ≥2로 투표 생성 → 포맷 날짜 + 확정 힌트 표시 확인
3. 멤버 투표 → `voteAction` Server Action 실행 → 정상 결과 갱신 확인
4. 생성자 "마감하기" 탭 → `closePollAction` → `revalidatePath` 후 poll 마감 + 모임 헤더 startsAt 둘 다 갱신 확인
5. 동점 시나리오 → 동점 notice + startsAt 불변 확인
6. 비생성자 계정에서 "마감하기" 버튼 미노출 확인

**핵심 불확실성**: SPEC-MOIM-005/006/007과 동일 — Server Action + `revalidatePath`가 WebView 내 네비게이션 컨텍스트에서 올바르게 동작하는지(poll 마감 AND 모임 헤더 startsAt 갱신이 WebView 안에서 동기화되는지) 확인 필요.

---

## 7. DB 스키마 변경 (기존 테이블 수정)

### 수정된 테이블

| 테이블 | 변경 내용 | SPEC |
|--------|----------|------|
| `poll` | `kind TEXT NOT NULL DEFAULT 'general'` 컬럼 additive 추가(@default → 기존 row 모두 "general") | SPEC-MOIM-008 |
| `poll_option` | `option_date TIMESTAMP(3)` nullable 컬럼 additive 추가(기존 option row 모두 null) | SPEC-MOIM-008 |

### 신규 마이그레이션

| 파일명 | 적용일 | 내용 |
|--------|--------|------|
| `20260621000000_add_poll_kind_option_date` | 2026-06-21 | poll.kind TEXT NOT NULL DEFAULT 'general' + poll_option.option_date nullable 추가. SQL: `ALTER TABLE poll ADD COLUMN kind TEXT NOT NULL DEFAULT 'general'; ALTER TABLE poll_option ADD COLUMN option_date TIMESTAMP(3);`. 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean). PollVote PK/FK/인덱스 무변경. CREATE TYPE 없음(Prisma enum 아님). |

변경된 DB 문서: `.moai/project/db/schema.md`, `.moai/project/db/migrations.md`

---

## 8. SPEC-MOIM-007 후속 관계

SPEC-MOIM-008은 SPEC-MOIM-007(투표 마감)의 직속 후속이다. MOIM-007이 만든 `POST .../close`(생성자 전용, closesAt=now)를 확장해 날짜 투표(`kind="date"`) 마감 시 finalize 로직을 추가한다. MOIM-007의 `PollVote` 복합 PK `(pollId,optionId,userId)` + `Poll.closesAt` + isClosed + vote 409 차단은 모두 보존된다. 새 컬럼 2개(kind/optionDate)만 additive하게 추가한다.

| 도메인 | SPEC | status |
|--------|------|--------|
| 단일 선택 투표 인프라 | SPEC-MOIM-005 | in-progress (device-gated) |
| 다중 선택(multi-select) 확장 | SPEC-MOIM-006 | in-progress (device-gated) |
| 마감(deadline + 수동 마감) + 투표 차단 | SPEC-MOIM-007 | in-progress (device-gated) |
| **날짜 투표 자동 확정(kind + optionDate + finalize)** | **SPEC-MOIM-008** | **in-progress (device-gated)** |
