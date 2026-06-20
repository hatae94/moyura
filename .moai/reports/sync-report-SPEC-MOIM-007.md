# Sync Report — SPEC-MOIM-007

생성일: 2026-06-20
브랜치: feature/SPEC-MOBILE-004
커밋: 8e37d33
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-007/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 라이브 검증 결과 + 자동 게이트 + device-gated 이유) |
| `.moai/specs/SPEC-MOIM-007/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 자동 게이트/라이브 검증 항목 ✓ 처리 + "라이브 검증 2026-06-20" 주석; 디바이스 종단 검증 항목 미체크 + "iOS 시뮬레이터에서 모바일 WebView poll 마감 인터랙션(Server Action + revalidatePath) 검증 대기" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-007 항목 추가(비파괴 마이그레이션, 투표 차단 409, 수동 마감 엔드포인트, 읽기 모델 확장, api-client 갱신, 웹 마감 UI, 라이브 검증, device-gated 미완료, SPEC-MOIM-006 후속 명시) |
| `.moai/project/structure.md` | 수정 | backend `src/poll/` 설명에 closesAt/close 라우트·마감 검사·isClosed·closePoll 반영; prisma schema+migrations에 20260620200000_add_poll_closes_at 추가; web `polls-section.tsx`·`poll-actions.ts`·`page.tsx` 설명에 마감 UI/closePollAction/currentUserId 반영; api-client poll 타입 별칭 갱신 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-007 요약 추가(in-progress, 커밋, 게이트 결과, 라이브 검증, device-gated); 구현됨 vs 계획됨 표에 SPEC-MOIM-007 in-progress 행 신규 추가 |
| `.moai/project/db/schema.md` | 수정 | last_synced_at + spec 헤더 갱신; Tables에 poll 설명 갱신(closesAt 컬럼 추가); poll 테이블 상세에 closes_at 컬럼 행 추가 |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `20260620200000_add_poll_closes_at` 행 추가; Pending Migrations에 동일 항목 추가; Rollback Notes에 20260620200000_add_poll_closes_at 롤백 절차 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-007.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 데스크톱 브라우저 + API 라이브 검증(AC-1~7)까지 완료되었으나, 모바일 WebView 셸에서 마감 poll 흐름(마감 시각 생성 → 투표 → 생성자 "마감하기" → "마감됨" 배지+비활성 컨트롤+결과 유지 → 마감 후 투표 409 차단 → 비생성자/마감 poll "마감하기" 미노출)이 iOS 시뮬레이터에서 미검증 상태이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: iOS 시뮬레이터 dev build에서 모임 상세(`/home/{id}`) 진입 → 마감 시각 정해 투표 생성 → 마감 전 투표(단일/다중) 정상 → 생성자 "마감하기" 탭 → "마감됨" 배지 + 투표 컨트롤 비활성 + 결과 계속 표시 확인 → 마감된 poll 투표 시도 차단(409) → 비생성자/마감 poll "마감하기" 미노출 확인이 WebView 안에서 라이브 검증되어야 시.

---

## 3. 구현 범위 및 설계 결정

### closesAt 단일 컬럼 — 마감 시각 + 수동 마감 통합

`Poll.closesAt DateTime? @map("closes_at")` 하나가 (a) 생성 시 정한 마감 deadline(미래 시각)과 (b) 수동 마감 시각(now로 설정)을 모두 표현한다. 별도 `closedAt`/`closed` boolean 컬럼을 두지 않는다 — `closesAt != null AND closesAt <= now` 하나로 CLOSED 판정이 충분하기 때문(최소 모델). null = 마감 없음(영구 열림, MOIM-005/006 기본 동작 보존).

### 비파괴 마이그레이션 — 단순 nullable 컬럼 추가

SPEC-MOIM-005/006과 동일한 비파괴 패턴이지만 더 단순하다. closesAt는 순수 nullable 추가이므로 SQL이 `ALTER TABLE poll ADD COLUMN closes_at TIMESTAMP(3);` 단 한 줄이다. MOIM-006의 PK DROP+ADD와 달리 기존 제약/인덱스를 건드리지 않는다. 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean) 동일 적용.

**데이터 안전성**: 기존 poll row가 모두 null(마감 없음)로 보존됨. PollVote 복합 PK `(pollId,optionId,userId)`(SPEC-MOIM-006) 무변경.

### 서버 계산 isClosed — 클라이언트 시계 오차 차단

마감 판정은 서버가 한다. 응답에 `isClosed`(서버 시각 기준 `closesAt <= now`)를 담아 클라이언트는 그것만 신뢰한다. 클라이언트가 `closesAt`를 자기 시계로 비교하면 마감 직전/직후를 서버와 다르게 판정할 수 있다. `closesAt`(ISO|null)는 표시("마감: {시각}")용으로 함께 노출하되, **차단/배지 판정은 `isClosed`**가 권위다.

### 투표 차단(409) 위치 — 분기 앞

현재 `vote`(MOIM-006): assertMember → poll 일관성(404) → optionId 소속(400) → multiSelect 분기(단일 교체/다중 토글).

마감 검사를 **poll 일관성(404) 이후, optionId/분기 이전**에 삽입: `if (poll.closesAt && poll.closesAt <= new Date()) throw ConflictException('마감된 투표입니다')`. 이렇게 하면 마감된 poll에서는 표를 절대 건드리지 않는다(단일·다중 공통). 마감 검사가 optionId 검사보다 앞이므로, 마감 poll에 그 poll에 없는 optionId로 투표해도 409(어떤 optionId든 마감 poll 투표 불가)로 차단된다.

### 수동 마감 — 생성자 전용 신규 인가

MOIM-005/006의 poll 라우트는 모두 `assertMember`(멤버면 누구나) 스코핑이었다. close는 **poll 생성자만** 할 수 있다. 구현: assertMember(비멤버 403/없는 모임 404→403) → poll 일관성(404) → `poll.createdBy !== sub` → ForbiddenException(403) 순서. 비멤버는 (1)에서, 멤버지만 비생성자는 (3)에서 403. 이미 마감이면 closesAt = now 재설정으로 멱등(now <= now → 여전히 마감, 무해).

### 웹 — Server Component + Client 섬 + Server Action 구조 보존

`page.tsx`(Server Component)가 세션 user.id(sub)를 읽어 `currentUserId`로 `<PollsSection/>`에 추가 전달(직렬화 가능 string). polls fetch 흐름 무변경.

`PollCard`(Client)가 `poll.isClosed`로 분기: 마감이면 옵션 버튼 `disabled` + "마감됨" 배지 + closesAt 표시, 결과 막대/강조는 계속 렌더. 열림이면 MOIM-005/006 그대로. 추가로 `poll.createdBy === currentUserId && !poll.isClosed`이면 "마감하기" 버튼 렌더 → `closePollAction(moimId, poll.id)` 호출.

`CreatePollForm`에 "마감 시각" `datetime-local`(name="closesAt", optional) 추가. `createPollAction`이 `formData.get("closesAt")`를 toIsoOrUndefined로 변환해 body에 담는다(빈 값 → 미전송 → null). moims/new 일정 필드 미러. Meetup 오렌지 토큰.

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트 (재실행 없이 인용)

| 게이트 | 결과 |
|--------|------|
| backend jest | 290/290 (마감 신규 + 열린 poll 회귀 포함) |
| backend tsc | 0 error |
| web tsc | 0 error (closesAt/isClosed/currentUserId 전 소비처 갱신 확인) |
| api-client tsc | 0 error |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| prisma migrate | clean (`20260620200000_add_poll_closes_at` — Poll.closesAt nullable 추가, PollVote PK 무변경, 기존 row 보존) |

### 라이브 검증 (데스크톱 브라우저, 2026-06-20)

moyura-verify 계정, 모임 상세(`/home/{id}`) 기준:

| 시나리오 | 결과 |
|----------|------|
| 미래 마감 시각 정해 poll 생성 | closesAt 설정, isClosed:false, "마감 예정" 표시 확인 |
| 열린 poll 투표(단일) | 1표·100% 정상. MOIM-005/006 회귀 0 |
| 생성자 "마감하기" 탭 | closesAt = now, isClosed:true, "마감됨" 배지 + 투표 컨트롤 비활성 + 결과 유지 + 버튼 사라짐 |
| 마감 poll 투표 시도 | backend 409 "마감된 투표입니다" 반환 확인 |
| 이미 마감 poll 재-close | 200, isClosed:true 유지(멱등 확인) |
| closesAt: null poll | closesAt null, isClosed false, 마감 안내 미표시 |

**마감 판정 정확성 증명**: 서버가 `closesAt <= now`를 계산해 `isClosed: true`를 반환하고, 클라이언트는 그것을 신뢰해 배지/비활성 렌더. 클라이언트가 closesAt를 자기 시계로 비교하지 않음.

**단일/다중 공통 차단 증명**: 마감된 단일 선택 poll에 투표 → 409. 마감된 다중 선택 poll에 투표 → 409. multiSelect 값과 무관하게 마감 검사가 우선 적용됨.

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 마감 데이터 모델 + 비파괴 마이그레이션 | Poll.closesAt nullable additive 추가, PollVote PK 무변경, 기존 row 보존, migrate clean | prisma migrate clean + jest 290/290 | **PASS** |
| AC-2: 투표 생성 — closesAt 옵트인 | POST /moims/:id/polls optional closesAt(생략 시 null), 무효 ISO 400, 마감 없는 생성 무변경, 비멤버 403 | jest poll 케이스 + 라이브 poll 생성 확인 | **PASS** |
| AC-3: 수동 마감 — 생성자 전용 | POST .../close 생성자 200(closesAt=now/isClosed true), 비생성자 멤버 403, 비멤버 403, 없는 poll 404, 멱등 | jest poll 케이스 + 라이브 생성자 마감 확인 | **PASS** |
| AC-4: 투표 차단 — 마감 시 409 | 마감 poll 투표 409(단일/다중 공통, 표 불변), 열린 poll 투표 정상(회귀 0) | jest poll 케이스 + 라이브 마감 poll 투표 차단 확인 | **PASS** |
| AC-5: 투표 목록 + 결과 — closesAt + 서버 계산 isClosed | GET /moims/:id/polls closesAt(ISO|null) + isClosed(서버 계산), 마감 poll 결과 조회 가능, 비멤버 403 | jest poll 케이스 + 라이브 API closesAt/isClosed 확인 | **PASS** |
| AC-6: api-client 갱신 | CreatePollRequest(closesAt?), PollResponse(closesAt/isClosed), closePoll 헬퍼, tsc 0 | tsc 0(all) + 재생성 확인 | **PASS** |
| AC-7: 웹 마감 UI | 마감 poll "마감됨" 배지+비활성+결과유지, 열린 poll MOIM-005/006 그대로, 생성 폼 마감 시각, 생성자 "마감하기", Meetup 오렌지 | 라이브 브라우저 전 플로우 확인 | **PASS** |
| AC-8: 품질 게이트 (자동 부분) | jest/tsc/lint/build/vitest/migrate 전부 GREEN | 자동 게이트 결과 인용 | **PASS (자동 부분)** |
| AC-8: 품질 게이트 (device-gated 부분) | 모바일 WebView 마감 poll 흐름(마감 시각 생성 → 투표 → 생성자 "마감하기" → 배지+비활성+결과 → 마감 후 409 차단 → 비생성자/마감 "마감하기" 미노출) 라이브 확인 | iOS 시뮬레이터 검증 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 모바일 WebView 마감 poll 인터랙션 검증

**검증이 필요한 플로우 (in-app, iOS 시뮬레이터):**

1. 앱 시작 → 로그인 → 홈 탭 → 모임 카드 탭 → 상세(`/home/{id}`) in-WebView 로드
2. 마감 시각 설정해 poll 생성 → closesAt/isClosed 표시 확인
3. 마감 전 투표(단일/다중) → `voteAction` Server Action 실행 → 정상 결과 갱신 확인
4. 생성자 "마감하기" 탭 → `closePollAction` Server Action 실행 → `revalidatePath` 후 "마감됨" 배지 + 비활성 컨트롤 + 결과 유지 갱신 확인
5. 마감된 poll 투표 시도 → 409 차단 확인 (WebView 내 revalidatePath 재로드로 마감 상태 동기화)
6. 비생성자 계정에서 "마감하기" 버튼 미노출 확인

**핵심 불확실성**: SPEC-MOIM-005/006과 동일 — Server Action + `revalidatePath`가 WebView 내 네비게이션 컨텍스트에서 올바르게 동작하는지 확인이 필요하다. 데스크톱에서는 검증됨. WebView 안에서 `revalidatePath` 후 마감 상태가 반영되는지, `closePollAction` 성공 후 재조회 타이밍이 올바른지가 확인 대상.

---

## 7. DB 스키마 변경 (기존 테이블 수정)

### 수정된 테이블

| 테이블 | 변경 내용 | SPEC |
|--------|----------|------|
| `poll` | `closes_at TIMESTAMP(3)` nullable 컬럼 additive 추가(@default 없음 — 기존 row 모두 null) | SPEC-MOIM-007 |

### 신규 마이그레이션

| 파일명 | 적용일 | 내용 |
|--------|--------|------|
| `20260620200000_add_poll_closes_at` | 2026-06-20 | poll.closes_at 컬럼 nullable 추가(`ALTER TABLE poll ADD COLUMN closes_at TIMESTAMP(3);`). 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean). PollVote PK/FK/인덱스 무변경. |

변경된 DB 문서: `.moai/project/db/schema.md`, `.moai/project/db/migrations.md`

---

## 8. SPEC-MOIM-006 후속 관계

SPEC-MOIM-007은 SPEC-MOIM-006(다중 선택 투표)의 직속 후속이다. MOIM-006이 만든 `PollVote` 복합 PK `(pollId,optionId,userId)`를 보존하면서 `Poll.closesAt` 한 컬럼을 additive하게 추가한다. vote 서비스의 단일/다중 분기(MOIM-006) 앞에 마감 검사(409)를 삽입해 마감 poll의 투표를 분기 진입 전에 차단한다. 설계 결정(단일 컬럼·서버 계산 isClosed·생성자 전용 인가·멱등 마감)은 SPEC 작성 시 spec.md §5에 확정되어 있다.

| 도메인 | SPEC | status |
|--------|------|--------|
| 단일 선택 투표 인프라 | SPEC-MOIM-005 | in-progress (device-gated) |
| 다중 선택(multi-select) 확장 | SPEC-MOIM-006 | in-progress (device-gated) |
| 마감(deadline + 수동 마감) + 투표 차단 | **SPEC-MOIM-007** | **in-progress (device-gated)** |
