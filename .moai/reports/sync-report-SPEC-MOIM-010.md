# Sync Report — SPEC-MOIM-010

생성일: 2026-06-22
브랜치: feature/SPEC-MOBILE-004
커밋: 2b25a70
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-010/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 자동 게이트 + 장소 finalize 라이브 E2E + device-gated 이유) |
| `.moai/specs/SPEC-MOIM-010/acceptance.md` | 수정 | DoD 체크박스 — 자동 게이트 + LIVE 스크립트 검증 항목 ✓ 처리; 웹 UI 브라우저 워크스루 + 디바이스 종단 검증 미체크 + PENDING 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-010 항목 추가(마이그레이션 없음, place finalize, setLocation, finalizedLocation, 3-way kind 선택, 백엔드 라이브 E2E, device-gated, MOIM-008 형제 명시) |
| `.moai/project/db/schema.md` | 수정 | poll.kind 컬럼 설명에 "place" 값 추가(마이그레이션 없음 — 기존 string 컬럼의 새 값); 장소 자동 확정이 기존 Moim.location 을 재사용함을 명시 |
| `.moai/project/db/migrations.md` | 수정 | SPEC-MOIM-010 은 신규 DDL 불필요(kind 는 이미 string 컬럼) 명시 — 신규 마이그레이션 행 없음 |
| `.moai/project/structure.md` | 수정 | closePoll place-finalize 분기 + MoimService.setLocation + 웹 3-way kind 선택(일반/날짜/장소) + poll-place-finalize.live.mts 반영 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-010 요약 추가; 구현됨 vs 계획됨 표에 SPEC-MOIM-010 in-progress 행 신규 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-010.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft` / **신규 status**: `in-progress`
- **이전 버전**: `0.1.0` / **신규 버전**: `0.2.0`

**전환 근거**: 구현 완료로 자동 게이트 전부 GREEN(backend jest 308/308 — 장소 finalize 신규 + MOIM-005..009 회귀 포함)이고 장소 finalize 라이브 E2E(poll-place-finalize.live.mts, 실 Supabase 스택) 13/13 PASS가 확인되었으나, (1) 웹 UI 브라우저 워크스루(3-way 종류 선택 → 장소 투표 생성 → 마감 → 모임 헤더 장소 라이브 확정)가 moyura-verify 세션 만료로 미완료이고, (2) 모바일 WebView 셸 검증이 iOS 시뮬레이터에서 미수행이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: (a) 재로그인 후 모임 상세에서 "장소" 종류 투표 생성 → 투표 → "마감하기" → "마감됨" 배지 + 모임 헤더 장소(location) 확정 갱신 + 동점/무표 시 안내 확인. (b) iOS 시뮬레이터 dev build 에서 동일 플로우가 WebView 안에서 라이브 검증. 두 조건 충족 시 `completed`.

---

## 3. 구현 범위 및 설계 결정

### 마이그레이션 없음 (핵심 — MOIM-008 대비 단순화)

SPEC-MOIM-010 은 DDL 이 전혀 필요 없다:
- `Poll.kind String @default("general")` 는 이미 존재(MOIM-008) — `"place"` 는 string 컬럼이 받는 **새 값일 뿐**(Prisma enum 아님 → `ALTER TYPE` 불필요).
- `Moim.location String?` 는 이미 존재(MOIM-004) — 장소 finalize 의 쓰기 대상.
- `PollOption.optionDate` 는 장소 투표에서 null 그대로(장소 옵션은 자유 텍스트 label).
- → `prisma migrate status` 는 신규 마이그레이션 없이 clean. MOIM-008(컬럼 2개 additive)·MOIM-009(트리거)보다 단순.

### location = winner.label (날짜 대비 단순화)

날짜 투표는 startsAt(DateTime) 때문에 optionDate 컬럼이 필요했지만, location 은 String 이라 **승자 옵션의 label(장소명)이 곧 Moim.location** 이다. 별도 컬럼/파싱 없이 close finalize 에서 `setLocation(winner.label)` 한 줄로 확정된다.

### closePoll finalize 분기 (date | place 공통 승자 판정)

단일 최다 득표 판정(정렬 → topCount → 동점/무표 검사)은 date·place 공통이고, 그 뒤 kind 로 분기한다:
- `kind="date"` → `MoimService.setStartsAt(winner.optionDate)` + `finalizedStartsAt`(MOIM-008, 무변경)
- `kind="place"` → `MoimService.setLocation(winner.label)` + `finalizedLocation`(신규)
- 그 외(general) → finalize 없음. 동점 → `finalizeSkippedReason="tie"`, 무표 → `"no_votes"`. 생성자 전용(비생성자 403)·기존 값 덮어쓰기는 MOIM-008 결정 그대로 적용.

### MoimService.setLocation — 단일 출처

createMoim 외의 유일한 location 쓰기 경로(setStartsAt 미러). 장소 finalize 가 직접 prisma.moim.update 하지 않고 이 메서드를 호출한다. 인가는 closePoll 이 이미 통과시킨 상태.

### close 응답 finalizedLocation — finalizedStartsAt 과 상호 배타

`PollResponseDto` 에 `finalizedLocation: string | null` 순수 추가. date close → finalizedStartsAt, place close → finalizedLocation 으로 상호 배타 채움. vote/list 응답·general·동점·무표는 셋 다 null(기존 소비처 무파손).

### 웹 3-way kind 선택 + 텍스트 장소 옵션

MOIM-008 의 이진 "일정 투표" 토글을 일반/날짜/장소 3-way segmented selector 로 교체(기능 제거 아님 — 날짜 경로 보존). date → datetime-local 옵션, place/general → 텍스트 옵션. place 안내("마감하면 최다 득표 장소가 모임 장소로 확정돼요") + PollCard place 안내(MapPin). 모임 헤더 location 은 revalidatePath 로 갱신(+ MOIM-009 realtime 가 다른 멤버에게 전파).

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트

| 게이트 | 결과 |
|--------|------|
| backend jest | 308/308 (장소 finalize 5 + 컨트롤러 place/무효kind 2 신규 + MOIM-005..009 회귀) |
| backend tsc | 0 error |
| web tsc | 0 error (PollWithResults kind "place"/finalizedLocation + 3-way 선택 타입) |
| api-client tsc | 0 error (kind enum "place" + finalizedLocation 재생성) |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| prisma migrate status | clean — **신규 마이그레이션 없음**(kind 는 기존 string 컬럼의 새 값) |

### 장소 finalize 라이브 E2E (poll-place-finalize.live.mts, 실 Supabase 스택, 2026-06-22)

`apps/backend/test/poll-place-finalize.live.mts` — poll-finalize.live.mts(날짜) 패턴 미러, 실 Supabase + DB + 가드 대상:

| 시나리오 | 결과 |
|----------|------|
| 장소 투표 생성(kind="place", optionDate=null) | PASS |
| 단일 최다 득표 → Moim.location = 승자 label + finalizedLocation | PASS (location="강남역 2번 출구") |
| finalizedStartsAt null(장소 투표) | PASS |
| 동점 → finalizeSkippedReason="tie" + location 불변 | PASS |
| 무표 → finalizeSkippedReason="no_votes" | PASS |
| 일반 투표 close → finalizedLocation null | PASS |
| 비생성자 close → 403 | PASS |
| 무효 kind → 400 | PASS |
| 총계 | **13/13 PASS** |

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 장소 투표 데이터 모델 — 마이그레이션 없음 | kind="place"(기존 string 컬럼 새 값), Moim.location 재사용, optionDate null, DDL 0 | migrate status clean + 라이브 | **PASS** |
| AC-2: 장소 투표 생성 — kind="place" + 자유 텍스트 옵션 | parseKind place 수용, normalizeOptions 텍스트 옵션, 무효 kind 400 | jest + poll-place-finalize.live.mts | **PASS** |
| AC-3: 마감 시 자동 확정 — 단일 승자 → location | setLocation 단일 출처, 단독 승자 덮어쓰기, 동점/무표 스킵, 생성자 전용 403 | jest(서비스 5) + 라이브 13/13 | **PASS** |
| AC-4: 투표 목록 + 결과 조회 — kind="place" 노출 | listPolls kind 노출, place 옵션 label 텍스트 | jest + 라이브 | **PASS** |
| AC-5: close 응답 — finalizedLocation 노출 | finalizedLocation(place) / finalizedStartsAt(date) 상호 배타, vote/list null | jest + 라이브 | **PASS** |
| AC-6: api-client 표면 갱신 | kind enum "place" + finalizedLocation 재생성, web PollWithResults 미러 | api-client tsc 0 + web tsc 0 | **PASS** |
| AC-7: 웹 장소 투표 UI + 장소 확정 갱신 | 3-way kind 선택, place 텍스트 옵션, place 안내, 헤더 location 갱신 | web tsc/lint/build 0 (브라우저 워크스루 미완료) | **PASS (자동 부분) / PENDING — 브라우저 재로그인 대기** |
| AC-8: 품질 게이트 + LIVE 종단 증명 | 자동 게이트 전부 GREEN + poll-place-finalize.live.mts 13/13 | 자동 게이트 + 라이브 E2E | **PASS (자동 + LIVE)** |
| 디바이스 종단 검증 | 웹 UI 브라우저 워크스루 + 모바일 WebView | 재로그인 + iOS 시뮬레이터 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 웹 UI 브라우저 워크스루 + 모바일 WebView 검증

### 웹 UI 브라우저 워크스루 (재로그인 후)

moyura-verify 세션 access_token 만료. 재로그인 후: 모임 상세에서 "투표 종류=장소" 선택 → 장소 후보 2개 이상 입력 → 생성 → 투표 → "마감하기" → "마감됨" 배지 + 모임 헤더 장소(location) 확정 갱신 + 동점/무표 시 안내 표시 확인.

### 모바일 iOS WebView 검증

iOS 시뮬레이터 dev build 에서 동일 장소 투표 생성/투표/마감 플로우가 WebView 안에서 동작하고, 마감 시 모임 헤더 장소가 확정 갱신되는지 확인(MOIM-005..009 와 동일 WebView+Server Action 관점).

---

## 7. DB 변경 내역 (없음 — 기존 컬럼 재사용)

| 항목 | 내용 |
|------|------|
| **신규 마이그레이션** | 없음 |
| **Poll.kind** | 기존 string 컬럼(`@default("general")`)이 "place" 값을 추가로 수용(DDL 무변경 — 컨트롤러 parseKind 검증) |
| **Moim.location** | 기존 컬럼(MOIM-004) 재사용 — 장소 finalize 의 쓰기 대상 |
| **기타 테이블/컬럼/PK/FK** | 무변경 |

변경된 DB 문서: `.moai/project/db/schema.md`(poll.kind place 값), `.moai/project/db/migrations.md`(마이그레이션 없음 명시)

---

## 8. SPEC-MOIM-008 형제 관계 — 이벤트 트라이어드 완성

SPEC-MOIM-010 은 SPEC-MOIM-008(날짜 투표 → startsAt)의 직속 형제로, MOIM-008 §4 가 카브아웃한 장소 finalize 를 채워 **이벤트 트라이어드(일정 + 장소) 자동화를 완성**한다. closePoll 의 finalize 분기가 date(startsAt)·place(location)를 대칭으로 처리하며, 두 경로 모두 MOIM-009 의 'poll_change' realtime 트리거로 다른 멤버에게 실시간 전파된다(트리거는 kind 무관).

| 도메인 | SPEC | status |
|--------|------|--------|
| 단일 선택 투표 인프라 | SPEC-MOIM-005 | in-progress (device-gated) |
| 다중 선택 확장 | SPEC-MOIM-006 | in-progress (device-gated) |
| 마감 + 투표 차단 | SPEC-MOIM-007 | in-progress (device-gated) |
| 날짜 투표 자동 확정 → startsAt | SPEC-MOIM-008 | in-progress (device-gated) |
| 투표 결과 실시간 갱신 | SPEC-MOIM-009 | in-progress (device-gated) |
| **장소 투표 자동 확정 → location** | **SPEC-MOIM-010** | **in-progress (device-gated)** |
