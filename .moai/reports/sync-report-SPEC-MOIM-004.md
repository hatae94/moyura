# Sync Report — SPEC-MOIM-004

생성일: 2026-06-19
브랜치: feature/SPEC-MOBILE-004
커밋: 3145ad1
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-004/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0, updated: 2026-06-19), HISTORY v0.2.0 항목 추가(구현 요약 + 라이브 검증 결과 + 자동 게이트 + device-gated 이유 + stale 프로세스 아티팩트 메모) |
| `.moai/specs/SPEC-MOIM-004/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 자동 게이트/라이브 검증 항목 ✓ 처리 + "라이브 검증 2026-06-19" 주석; 디바이스 종단 검증 항목 미체크 + "iOS 시뮬레이터에서 server-action redirect → push 트리거 검증 대기" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-004 항목 추가(백엔드 확장, api-client, 웹 생성 UI, CTA 기능화, 정직 표시, 디자인 결정, 라이브 검증, device-gated 미완료 명시) |
| `.moai/project/structure.md` | 수정 | backend moim/ 모듈 주석에 SPEC-MOIM-004 스키마 확장 반영, prisma/migrations에 새 마이그레이션 추가, web lib/moim/api.ts MoimDetail 변경 반영, home/HomeTab.tsx·[id]/page.tsx 표시 변경 반영, moims/new/ 라우트 트리 신규 추가, api-client createMoim()/CreateMoimRequest 반영 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-004 요약 추가(in-progress, 커밋, 게이트 결과, 라이브 검증, device-gated), 구현됨 vs 계획됨 표에 SPEC-MOIM-004 in-progress 행 신규 추가 |
| `.moai/project/db/schema.md` | 수정 | last_synced_at 2026-06-19, moim 테이블 설명에 SPEC-MOIM-004 언급, moim 컬럼 표에 starts_at/location nullable 행 추가, 마이그레이션 헤더에 이벤트 필드 마이그레이션 추가 |
| `.moai/project/db/erd.mmd` | 수정 | 최종 갱신 주석 업데이트, MOIM 엔티티에 starts_at + location nullable 필드 추가 |
| `.moai/project/db/migrations.md` | 수정 | Applied Migrations에 `20260619000000_add_moim_event_fields` 행 추가, Pending Migrations에 동일 항목 추가, Rollback Notes에 롤백 절차 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-004.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 데스크톱 브라우저 라이브 검증(AC-1~5)까지 완료되었으나, 모바일 WebView 셸에서 `createMoimAction` server-action redirect 후 `/home/{id}` 로드 시 SPEC-MOIM-003 기존 `detailRouteForUrl` push가 트리거되는지 iOS 시뮬레이터 검증이 미완료 상태이므로, 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: iOS 시뮬레이터 dev build에서 홈 CTA → 생성 폼 → 제출 → server-action redirect → 네이티브 `(tabs)/home/[id]` push → 상세 렌더(일정/장소 표시) 라이브 확인 완료 시.

---

## 3. 구현 범위 및 설계 결정

### 백엔드 스키마 확장 (additive)

`Moim` 모델에 `startsAt DateTime?` + `location String?` 두 필드를 additive nullable로 추가했다. 마이그레이션 `20260619000000_add_moim_event_fields`는 기존 row를 두 필드 모두 NULL로 유지하므로 무중단이다.

**설계 결정 — additive nullable**: 기존 모임 행이 깨지지 않아야 하고, 일정/장소 없는 모임도 유효해야 한다. 두 필드 모두 optional이므로 nullable이 자연스럽다. startsAt 존재 시에만 ISO 파싱 유효성을 검증(최소 형식 검증)하고, 부재/빈 값은 null로 저장한다. location은 자유 텍스트라 형식 검증 없이 trim 후 저장한다.

**설계 결정 — no-ValidationPipe 패턴 보존**: 프로젝트는 `ValidationPipe` 없이 컨트롤러가 명시적으로 검증한다. `name`/`nickname` 누락 400 로직을 그대로 유지하면서 `startsAt` 무효 ISO 400을 동일 패턴으로 추가했다.

### api-client 확장

`packages/api-client/src/index.ts`에 `createMoim()` 편의 메서드와 `CreateMoimRequest` 타입 별칭을 추가했다. 기존 `listMoims`/`patchMe` 패턴과 일관된다. `schema.d.ts` 재생성으로 `CreateMoimDto`/`MoimResponseDto`의 두 필드가 타입에 반영되었다.

### 웹 생성 UI 기능화

`app/moims/new/` 라우트를 신규 생성했다. 기존 `app/moims/` 그룹(SPEC-WEB-GUARD-001 — `requireNamedSession()` 가드)을 상속해 별도 가드 설정 없이 보호된다.

**설계 결정 — `app/moims/new` 위치**: `(main)` 그룹에 moims 디렉터리가 없고, 기존 `moims/` 그룹(채팅 페이지와 동일)이 가드를 이미 보유한다. 최소 변경 · 일관성 · 모바일 in-WebView 처리(`moims/*`는 APP_ROUTES에 없어 네이티브 라우트 변경 없음) 세 가지 이유로 이 위치를 선택했다. 대안 `app/(main)/home/new`는 `detailRouteForUrl`이 "new"를 모임 id로 오분류할 위험이 있어 기각.

**설계 결정 — Server Action + useActionState 패턴**: `app/onboarding/actions.ts` + `onboarding-form.tsx`의 `useActionState` + Server Action 패턴을 구조적으로 미러했다. 성공 시 `redirect("/home/{id}")`, 실패 시 폼 머무름 + 일반화 오류(토큰/오류 상세 비노출).

**설계 결정 — Meetup 오렌지 토큰**: 생성 폼은 `(main)/home/[id]` 및 `(main)/*`와 동일한 오렌지 시맨틱 토큰(`bg-primary` 등)을 사용한다. login/onboarding의 blue 흐름을 미러하지 않는다(REQ-MOIM4-006 명시).

### 홈 CTA 기능화

`HomeTab.tsx`의 비기능 "새 모임 만들기" 버튼을 `/moims/new` Link로 전환했다. SPEC-MOIM-003에서 명시적으로 제외된 항목(Exclusions: "실 모임 생성 없음")을 이번 SPEC에서 해소했다.

### 일정/장소 정직 표시 (SPEC-MOIM-003 honest-fields-only 연장)

SPEC-MOIM-003은 데이터 출처 없는 mock 필드를 카드에서 제거했다. 이번 SPEC에서 `startsAt`/`location`이 실 데이터 출처를 가지므로 정직하게 복원했다:

- `startsAt` 있으면 한국어 포맷 표시, null이면 "일정 미정"
- `location` 있으면 표시, null이면 장소 라인 생략

허위/플레이스홀더 값은 표시하지 않는다(REQ-MOIM4-006). `HomeTab` 카드와 `/home/[id]` 상세 모두 동일 정책을 적용했다.

### 투표(poll) 명시적 제외

로그인 태그라인의 "투표"는 본 SPEC에서 명시적으로 제외했다. poll 엔티티 + options + per-user votes + 결과 집계 UI가 필요한 별도·대형 후속 SPEC이다. `Moim`에 vote/poll 관련 필드나 테이블을 추가하지 않았다.

---

## 4. 자동 게이트 + 라이브 검증 결과

### 자동 게이트 (재실행 없이 인용)

| 게이트 | 결과 |
|--------|------|
| backend jest | 222/222 (branch 85.9%) |
| backend tsc | 0 error |
| web tsc | 0 error |
| api-client tsc | 0 error |
| mobile tsc | 0 error |
| mobile vitest | 215/215 (회귀 0 — 모바일 무변경) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error (`/moims/new` 라우트 등록 포함) |
| prisma migrate | clean (additive nullable, 기존 row null) |
| expo export | OK (회귀 0) |

### 라이브 검증 (데스크톱 브라우저, 실 세션, 2026-06-19)

| 시나리오 | 결과 |
|----------|------|
| 폼 제출(이름/닉네임/일정 2026-06-27 09:30/장소 "북한산 우이역 집결") | 201 + 모임 startsAt+location 영속 확인 |
| `/home/{id}` 이동 + 일정 표시(📅 2026년 6월 27일 오전 9:30) | 상세 렌더 정상 |
| `/home/{id}` 이동 + 장소 표시(📍 북한산 우이역 집결) | 상세 렌더 정상 |
| 홈 카드에 일정/장소 표시 | 값 있는 모임 포맷 표시, 없는 모임 "일정 미정"/장소 생략 |
| 채팅 입장 + owner member 표시 | 기존 동작 회귀 없음 |
| backend 직접 POST `startsAt`+`location` | 두 필드 포함 응답 확인 |
| backend 직접 POST 무효 startsAt | 400 반환 확인 |
| 홈 CTA → `/moims/new` | 생성 폼 이동 확인 |

**참고**: 초기 검증 시 stale 장기 실행 백엔드 프로세스(이전 session에서 시작된 프로세스가 포트 3001 EADDRINUSE로 인해 재시작을 차단)가 이전 코드를 서빙해 "필드 미영속" 오증상이 발생했다. 프로세스 kill 후 재시작하여 정상 동작을 확인했다. 코드 결함이 아닌 로컬 dev-env 프로세스 아티팩트다.

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: Moim 이벤트 필드 + additive 마이그레이션 | `startsAt`/`location` nullable 추가, 기존 row null, jest 포함/미포함 생성 케이스 | prisma migrate clean + jest 222/222 + 라이브 POST 확인 | **PASS** |
| AC-2: 생성 엔드포인트 — optional 영속 + 400 보존 | 두 필드 optional 영속, owner 트랜잭션 불변, name/nickname 빈 값 400, startsAt 무효 400 | 라이브 POST(필드 영속 확인) + jest 신규 케이스(400 검증) | **PASS** |
| AC-3: 조회 응답에 일정/장소 포함 | `GET /moims`·`GET /moims/:id` 두 필드 반환, 멤버 스코핑 약화 0 | 라이브 GET 응답 확인 + jest 케이스 | **PASS** |
| AC-4: 기능형 생성 플로우 | 홈 CTA → `/moims/new` 폼 → 제출 → 실 모임 생성 → `/home/{id}` 이동 | 라이브 브라우저 종단 플로우 확인 | **PASS** |
| AC-5: 일정/장소 정직 표시 + Meetup 디자인 | 홈 카드·상세 값 있으면 표시 / null이면 "일정 미정"/생략, 오렌지 토큰 | 라이브 브라우저 홈·상세 렌더 확인 | **PASS** |
| AC-6: 품질 게이트 (자동 부분) | jest/tsc/lint/build/vitest/migrate 전부 GREEN | 자동 게이트 결과 인용 | **PASS (자동 부분)** |
| AC-6: 품질 게이트 (device-gated 부분) | 모바일 server-action redirect → 네이티브 push 라이브 확인 | iOS 시뮬레이터 검증 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 모바일 server-action redirect → push 검증

**검증이 필요한 플로우 (in-app, iOS 시뮬레이터):**

1. 앱 시작 → 로그인 → 홈 탭 진입
2. 홈 탭 "새 모임 만들기" 탭 → `/moims/new` in-WebView 로드 확인(네이티브 push 없음, moims/* 비-앱-라우트)
3. 폼 입력(이름/닉네임/일정/장소) 후 제출
4. `createMoimAction` Server Action이 실행되어 모임 생성 + `redirect("/home/{id}")` 발생
5. 모바일 WebView 셸이 `/home/{id}` 로드 요청을 받을 때 SPEC-MOIM-003 기존 `decideWebViewLoad` + `detailRouteForUrl`이 이를 detail push 분기로 처리함을 확인 (`{ action: "push", route: "home", id: "{id}" }`)
6. 네이티브 `(tabs)/home/[id]` push → 상세 화면(일정/장소 표시) 렌더 확인
7. 네이티브 back → 홈 목록 복귀 확인

**이 플로우의 핵심 불확실성**: `createMoimAction`은 서버에서 실행되는 Next.js Server Action으로, 그 redirect가 WebView 내에서 일어난다. 일반 클라이언트 링크 클릭(SPEC-MOIM-003에서 검증된 경로)과 다르게, server-action redirect가 WebView의 `onShouldStartLoadWithRequest`(또는 이에 상응하는 navigation event)를 동일하게 트리거하는지 확인이 필요하다. 트리거된다면 기존 `detailRouteForUrl` 분기가 그대로 동작한다.

**미수행 이유**: 현 세션에서 iOS 시뮬레이터 dev build 환경에서의 검증을 수행하지 않았다.

---

## 7. DB 스키마 변경

### 신규 컬럼 (moim 테이블)

| 컬럼 | 타입 | 제약 | SPEC |
|------|------|------|------|
| `starts_at` | TIMESTAMP(3) | NULLABLE | SPEC-MOIM-004 |
| `location` | TEXT | NULLABLE | SPEC-MOIM-004 |

### 신규 마이그레이션

| 파일명 | 적용일 | 내용 |
|--------|--------|------|
| `20260619000000_add_moim_event_fields` | 2026-06-19 | moim 테이블에 starts_at(nullable) + location(nullable) 추가. additive — 기존 row null, 무중단. |

변경된 DB 문서: `.moai/project/db/schema.md`, `.moai/project/db/erd.mmd`, `.moai/project/db/migrations.md`

---

## 8. 다음 후속 SPEC 메모

투표(poll) 기능은 본 SPEC에서 명시적으로 제외한 별도 후속 SPEC이다. 구현 범위: poll 엔티티 + vote options + per-user votes + 집계 결과 UI. 로그인 태그라인의 "투표"를 완성하는 마지막 핵심 기능.
