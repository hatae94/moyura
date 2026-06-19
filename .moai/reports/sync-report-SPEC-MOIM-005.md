# Sync Report — SPEC-MOIM-005

생성일: 2026-06-19
브랜치: feature/SPEC-MOBILE-004
커밋: 9231700
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-005/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 라이브 검증 결과 + 자동 게이트 + device-gated 이유 + 생성 폼 미닫힘 UX 메모) |
| `.moai/specs/SPEC-MOIM-005/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 자동 게이트/라이브 검증 항목 ✓ 처리 + "라이브 검증 2026-06-19" 주석; 디바이스 종단 검증 항목 미체크 + "iOS 시뮬레이터에서 Server Action+revalidatePath가 WebView 안에서 결과를 갱신하는지 검증 대기" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-005 항목 추가(신규 3 테이블, poll 도메인 모듈, api-client 타입, 웹 투표 UI, 라이브 검증, device-gated 미완료, 이벤트 트라이어드 완성 명시) |
| `.moai/project/structure.md` | 수정 | backend `src/poll/` 신규 도메인 모듈 추가, prisma schema+migrations에 poll 3 테이블 반영, web `lib/moim/polls.ts`·`[id]/polls-section.tsx`·`[id]/poll-actions.ts` 추가, api-client poll 타입 별칭 반영 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-005 요약 추가(in-progress, 커밋, 게이트 결과, 라이브 검증, device-gated, 이벤트 트라이어드 완성), 구현됨 vs 계획됨 표에 SPEC-MOIM-005 in-progress 행 신규 추가 |
| `.moai/project/db/schema.md` | 수정 | last_synced_at 갱신, Tables에 poll/poll_option/poll_vote 3 테이블 추가, 각 테이블 상세 정의(컬럼 표), Relationships에 poll 관계 4개 추가, Indexes에 poll PK 행 추가, Constraints에 poll FK/PK 행 추가 |
| `.moai/project/db/erd.mmd` | 수정 | 최종 갱신 주석 업데이트(SPEC-MOIM-005), POLL/POLL_OPTION/POLL_VOTE 엔티티 3개 추가, 관계선(MOIM→POLL, POLL→POLL_OPTION, POLL→POLL_VOTE, POLL_OPTION→POLL_VOTE) 추가 |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `20260619100000_add_poll` 행 추가, Pending Migrations에 동일 항목 추가, Rollback Notes에 poll 테이블 드롭 절차 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-005.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 데스크톱 브라우저 라이브 검증(AC-1~5)까지 완료되었으나, 모바일 WebView 셸에서 `createPollAction`/`voteAction` Server Action + `revalidatePath`가 동작해 결과가 갱신되는지 iOS 시뮬레이터 검증이 미완료 상태이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: iOS 시뮬레이터 dev build에서 모임 상세(`/home/{id}`) 진입 → "투표 만들기" → 생성된 투표 표시 → 투표 → 득표/내 표 갱신 → 재투표 교체를 WebView 안에서 라이브 확인 시.

---

## 3. 구현 범위 및 설계 결정

### 신규 3 테이블 additive (moim 무변경)

`Poll`/`PollOption`/`PollVote` 세 테이블을 additive하게 추가했다. 기존 `moim` 테이블에는 컬럼 변경 없음(Prisma 관계 역참조 `polls Poll[]` 한 줄만 선언 추가). 이는 `add_moim_invite`·`add_chat`·`add_moim_event_fields`가 기존 테이블을 무변경으로 신규 테이블만 CREATE한 선례와 동일하다.

**설계 결정 — PollVote 복합 PK `(pollId, userId)`**: 멤버당 한 투표 불변식을 DB 레벨에서 강제한다. `MoimMember(moimId, userId)` 복합 PK 패턴을 그대로 미러했다. 재투표는 upsert로 `optionId`를 교체한다 — 추가 표가 아니라 교체.

**설계 결정 — 일반 투표(단일 선택만)**: 다중 선택/순위/가중/날짜 후보 투표는 제외. `PollVote(pollId,userId)` 복합 PK 구조가 이미 단일 선택을 DB에서 강제하므로 애플리케이션 레벨 검증 없이도 불변식이 유지된다.

**설계 결정 — position 컬럼 없음**: `PollOption`은 `{id, pollId, label}`만 둔다. 옵션 표시 순서는 결정적 키(`id`)로 정렬해 안정 표시. 생성 순서 보장이 필요해지면 `position` 추가는 향후 작업.

### 엔드포인트 shape — `/moims/:id/polls` 중첩

ChatController(`@Controller('moims/:id/messages')`) 패턴을 정확히 미러했다. moimId가 항상 path에 있어 `assertMember(sub, moimId)` 직접 호출 가능 — 평평한 `/polls/:id` shape는 poll→moim 역방향 lookup이 추가로 필요하다.

최종 라우트: `POST /moims/:id/polls`(생성) · `GET /moims/:id/polls`(목록+결과) · `POST /moims/:id/polls/:pollId/vote`(투표).

### 웹 — Server Component + Client 섬 + Server Action

`/home/[id]/page.tsx`는 읽기 전용 Server Component였다. 투표(버튼 클릭)와 생성(동적 옵션 입력)은 본질적으로 인터랙티브해 Client 하위 컴포넌트 도입이 필요한 진정한 갭이었다.

- **Server Component(`page.tsx`)**: 기존 가드+모임/멤버 fetch 유지. 서버에서 `GET /moims/:id/polls`(호출자 myVote 포함) 추가 조회 후 `<PollsSection>` Client 섬에 데이터+moimId prop으로 전달.
- **Client 섬(`polls-section.tsx`)**: 투표 목록(질문·옵션·득표 막대·내 표 강조)·단일 선택 투표 컨트롤·생성 폼(`useActionState`)·빈 상태. Meetup 오렌지 토큰(`bg-primary` 등).
- **Server Action(`poll-actions.ts`)**: `createPollAction`/`voteAction` — 세션 읽기 → web 헬퍼 호출 → 성공 시 `revalidatePath`로 상세 재검증.

결과 갱신은 액션/페이지 로드 시 재조회(`revalidatePath`). 실시간 Realtime 갱신은 SPEC-MOIM-005 Exclusions.

### no-ValidationPipe 보존

프로젝트는 `ValidationPipe` 없음(C-1). 컨트롤러가 명시적 400을 던진다:
- `question`: trim 후 빈 값 → 400
- `options`: trim 후 비지 않은 항목 <2개 → 400
- `optionId`(투표): 해당 poll 소속 옵션인지 service 검증, 불일치 → 400

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트 (재실행 없이 인용)

| 게이트 | 결과 |
|--------|------|
| backend jest | 258/258 (poll 36 케이스, branch 85.14%) |
| backend tsc | 0 error |
| web tsc | 0 error |
| api-client tsc | 0 error |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| prisma migrate | clean (additive 신규 3 테이블, 기존 테이블 무변경) |
| expo export | OK (회귀 0) |

### 라이브 검증 (데스크톱 브라우저, 실 세션, 2026-06-19)

모임 "주말 등산 모임" 상세(`/home/{id}`) 기준:

| 시나리오 | 결과 |
|----------|------|
| 투표 없는 상태 → "아직 투표가 없어요" 빈 상태 표시 | PASS |
| "투표 만들기" 폼 → 질문/옵션(북한산·관악산) 입력 제출 | poll count 1, 0표 표시 확인 |
| 북한산 옵션 투표 | 1표/100%, 내 표 강조(orange), "총 1표 · 내 선택이 반영됐어요" 확인 |
| 관악산 재투표(표 교체) | 관악산 1표/100%, 북한산 0표, 총 1표 불변 — 표 추가 아닌 교체 확인 |
| Meetup 오렌지 디자인 토큰 적용 | 투표 섹션·생성 폼 orange primary 토큰 확인 |
| 기존 채팅 입장·멤버 목록 | 회귀 없음 확인 |

**재투표-총표수 불변 증명**: 북한산에 1표 → 관악산으로 재투표 후 총 표수가 1 유지됨을 라이브 확인. `PollVote(pollId,userId)` upsert가 올바르게 동작함.

### 소소한 UX 메모 (기록, 수정 대상)

투표 생성 성공 후 "투표 만들기" 생성 폼이 자동으로 닫히거나 초기화되지 않고 열린 상태로 남는다. 기능 동작에는 영향 없는 코스메틱 이슈. 별도 후속 수정 대상.

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 투표 데이터 모델 + 비파괴 마이그레이션 | Poll/PollOption/PollVote 3 테이블, PollVote 복합 PK, Cascade, moim 무변경 | prisma migrate clean + jest 258/258 | **PASS** |
| AC-2: 투표 생성 + 검증 | POST /moims/:id/polls 멤버 생성 + question 빈 400 + 옵션<2 400 + 비멤버 403 | jest poll 케이스 + 라이브 브라우저 생성 확인 | **PASS** |
| AC-3: 단일 투표 + 재투표 교체 | POST /:pollId/vote upsert 재투표=교체, 잘못된 optionId 400, 비멤버 403 | jest poll 케이스 + 라이브 재투표 총 1표 불변 확인 | **PASS** |
| AC-4: 투표 목록 + 결과 집계 | GET /moims/:id/polls 옵션별 voteCount+myVote+비멤버 403+빈 배열 | jest poll 케이스 + 라이브 결과 갱신 확인 | **PASS** |
| AC-5: 웹 투표 UI | 투표 섹션(질문/막대/퍼센트/내 표 강조)+투표 컨트롤+생성 폼+빈 상태, Meetup 오렌지 | 라이브 브라우저 전 플로우 확인 | **PASS** |
| AC-6: 품질 게이트 (자동 부분) | jest/tsc/lint/build/vitest/migrate 전부 GREEN | 자동 게이트 결과 인용 | **PASS (자동 부분)** |
| AC-6: 품질 게이트 (device-gated 부분) | 모바일 WebView Server Action+revalidatePath 결과 갱신 라이브 확인 | iOS 시뮬레이터 검증 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 모바일 WebView Server Action 검증

**검증이 필요한 플로우 (in-app, iOS 시뮬레이터):**

1. 앱 시작 → 로그인 → 홈 탭 → 모임 카드 탭 → 상세(`/home/{id}`) in-WebView 로드
2. 투표 섹션 표시 확인(빈 상태 또는 기존 투표)
3. "투표 만들기" 폼 → 질문+옵션 입력 → 제출
4. `createPollAction` Server Action 실행 → `revalidatePath` 후 상세 페이지 재조회
5. 새 투표가 목록에 나타나는지 확인(WebView 안에서 결과 갱신)
6. 투표 컨트롤 탭 → `voteAction` 실행 → `revalidatePath` 후 득표 수/내 표 강조 갱신 확인

**핵심 불확실성**: Server Action + `revalidatePath`가 WebView 내 네비게이션 컨텍스트에서 올바르게 동작하는지 확인이 필요하다. 데스크톱에서는 검증됨. WebView 안에서 `revalidatePath` 후 페이지 재로드가 발생하는지, 그 과정에서 SPEC-MOIM-003 `detailRouteForUrl`이 재방문 URL을 오분류하지 않는지 확인 필요.

---

## 7. DB 스키마 변경 (신규 3 테이블)

### 신규 테이블

| 테이블 | PK | 주요 FK | SPEC |
|--------|-----|---------|------|
| `poll` | `id` (uuid) | `moim_id → moim(id) Cascade` | SPEC-MOIM-005 |
| `poll_option` | `id` (uuid) | `poll_id → poll(id) Cascade` | SPEC-MOIM-005 |
| `poll_vote` | `(poll_id, user_id)` 복합 | `poll_id → poll(id) Cascade`, `option_id → poll_option(id) Cascade` | SPEC-MOIM-005 |

### 신규 마이그레이션

| 파일명 | 적용일 | 내용 |
|--------|--------|------|
| `20260619100000_add_poll` | 2026-06-19 | poll/poll_option/poll_vote 신규 3 테이블 CREATE + FK(cascade). 비파괴 additive(기존 테이블 무변경). |

변경된 DB 문서: `.moai/project/db/schema.md`, `.moai/project/db/erd.mmd`, `.moai/project/db/migrations.md`

---

## 8. 이벤트 트라이어드 완성

SPEC-MOIM-004 sync 리포트(섹션 8)가 "투표(poll) 기능은 본 SPEC에서 명시적으로 제외한 별도 후속 SPEC"이라고 기록했다. 본 SPEC-MOIM-005가 그 후속으로, 제품 태그라인 "일정, 장소, 투표를 한곳에서"의 세 번째 조각을 채운다:

| 도메인 | SPEC | status |
|--------|------|--------|
| 일정 (`startsAt`) | SPEC-MOIM-004 | in-progress (device-gated) |
| 장소 (`location`) | SPEC-MOIM-004 | in-progress (device-gated) |
| 투표 (`Poll`) | **SPEC-MOIM-005** | **in-progress (device-gated)** |

세 기능 모두 자동 게이트 GREEN + 데스크톱 라이브 검증 완료. iOS 시뮬레이터 device-gated 완료 시 세 SPEC 모두 `completed` 전환 대상.
