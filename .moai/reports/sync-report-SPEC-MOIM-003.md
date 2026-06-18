# Sync Report — SPEC-MOIM-003

생성일: 2026-06-18
브랜치: feature/SPEC-MOBILE-004
커밋: 74fd7fe
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-003/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0, updated: 2026-06-18), HISTORY v0.2.0 항목 추가(구현 요약 + 게이트 검증 결과 + 설계 결정 + in-progress 유지 이유) |
| `.moai/specs/SPEC-MOIM-003/acceptance.md` | 수정 | DoD 체크박스 업데이트 — 게이트 통과/라이브 검증 항목 ✓ 처리; AC-3 인앱 탭 E2E 항목 미체크 + "device-gated — 라이브 인앱 탭 대기" 주석 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-003 항목 추가(홈 mock→real, 상세 SC, 모바일 push 로직, 디렉터리화, 라이브 검증 결과, AC-3 미완료 명시) |
| `.moai/project/structure.md` | 수정 | 모바일 `(tabs)/home/` 디렉터리화(_layout+index+[id]) 반영, `route-map-core.ts`·`auth-bridge-core.ts`·`useAuthBridge.ts`·`BridgedWebView.tsx` 주석 SPEC-MOIM-003 추가, 웹 `home/[id]/page.tsx` 신규 파일 + `moim/api.ts` 신규 파일 반영, api-client `listMoims()` 추가 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-003 요약 추가(in-progress, 게이트 결과, 라이브 검증, AC-3 device-gated), 구현됨 vs 계획됨 표에 SPEC-MOIM-003 in-progress 행 신규 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-003.md` | 신규 | 본 문서 |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft`
- **신규 status**: `in-progress`
- **이전 버전**: `0.1.0`
- **신규 버전**: `0.2.0`

**전환 근거**: 구현이 완료되어 자동 게이트 전부 GREEN이고 백엔드 라이브 데이터 패스까지 검증되었으나, AC-3(모바일 인앱 카드 탭 E2E)가 device-gated로 미완료 상태이므로 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 `in-progress` 유지.

`completed` 전환 조건: iOS 시뮬레이터 dev build에서 홈 실 목록 → 카드 탭 → 네이티브 `(tabs)/home/[id]` push → 웹 상세 렌더 → 네이티브 back → 목록 복귀 → "채팅 입장" 진입 라이브 인앱 확인 완료 시.

---

## 3. 구현 범위 및 설계 결정

### 홈 mock→real 배선

홈 탭(`apps/web/app/(main)/home/page.tsx`)이 서버 컴포넌트로서 Supabase 세션 access_token으로 `GET /moims`를 호출하고 실 모임 목록을 `HomeTab`에 prop으로 전달한다. `HomeTab.tsx`에서 `MOCK_MEETUPS` import를 제거하고 실 데이터 바인딩으로 전환했다.

**설계 결정 — honest-fields-only**: 실 `Moim` 스키마가 `{ id, name, createdBy, createdAt }`만 제공하므로 카드는 모임 이름 + 생성일만 표시한다. mock의 date/time/location/status/memberCount/emoji/coverColor는 데이터 출처가 없어 **제거**했다(fabricated 필드 미노출). `_mock.ts` 삭제.

### 모임 상세 화면 (Server Component)

`apps/web/app/(main)/home/[id]/page.tsx`를 Server Component로 신규 구현했다. 서버에서 access_token을 얻어 `GET /moims/:id`(모임 이름) + `GET /moims/:id/members`(멤버 목록)를 호출하고 모임 이름 · 멤버 목록(nickname + role) · "채팅 입장" 링크(`/moims/{id}/chat`)를 렌더한다.

**설계 결정 — Server Component 선택**: 상세 화면에 클라이언트 인터랙션이 없다(링크만 있음). 채팅 페이지는 Client Component였으나 상세는 Server가 단순하고 guard 상속도 자연스럽다.

**설계 결정 — (main) 가드 상속**: `app/(main)/home/[id]/`는 `(main)` 라우트 그룹 하위이므로 `(main)/layout.tsx`의 `requireNamedSession()` 가드를 자동 상속한다. 별도 layout 파일 불필요(SPEC-WEB-GUARD-001 정책 일관).

**설계 결정 — 비멤버/404 처리**: 서버 조회에서 `GET /moims/:id`가 403(비멤버) 또는 404(미존재)를 반환하면 `notFound()`를 호출해 모임 콘텐츠를 노출하지 않는다. 토큰이나 오류 상세는 노출하지 않는다.

### 웹 상세/멤버 헬퍼

`apps/web/lib/moim/api.ts`를 신규 생성했다. `getMoim(id, token)`과 `getMoimMembers(id, token)` 두 헬퍼를 제공한다. 구체 경로를 직접 조립하고 `request(path as never, "get")` 캐스팅을 사용하는 `chat/api.ts` 패턴을 미러했다. `request()`가 URL 템플릿(`/moims/{id}`) 치환을 하지 않음을 사전 확인(verified)했기 때문이다.

### api-client 확장

`packages/api-client/src/index.ts`에 `listMoims()` 타입드 편의 메서드와 `MoimResponse` 타입 별칭을 추가했다. `getMe`/`patchMe` 패턴과 일관된다.

### 모바일 detail-push 로직 (additive)

기존 `routeForUrl`은 단일 세그먼트 URL만 매핑하고 `/home/123` 같은 2-세그먼트 URL에 대해 `null`을 반환한다. 이 상태에서는 `decideWebViewLoad`가 `/home/[id]` 이동을 `trusted-load`로 처리해 WebView가 자체 이동하므로 MOBILE-003 계약 위반이다.

이를 해소하기 위해 다음 변경을 **additive**(기존 동작 보존)로 적용했다:

- `apps/mobile/lib/route-map-core.ts`: `detailRouteForUrl(url)` + `urlForDetailRoute(route, id)` 순수 함수 추가. 기존 `routeForUrl` 동작 불변.
- `apps/mobile/hooks/auth-bridge-core.ts` `decideWebViewLoad`: 같은 탭 내 detail 타깃에 대해 `{ action: "push", route, id }` 변형을 additive로 반환. 기존 3분기 + tab-switch dispatch 변형 + 타입 하위호환 보존. `currentUrl` 부재 시 비활성(회귀 0).
- `apps/mobile/hooks/useAuthBridge.ts`: `onDetailPush` 콜백 추가.
- `apps/mobile/components/BridgedWebView.tsx`: `router.push`로 `(tabs)/home/[id]` 디스패치.

### 홈 탭 디렉터리화

expo-router에서 flat 파일(`(tabs)/home.tsx`)과 중첩 디렉터리(`(tabs)/home/[id].tsx`)는 공존할 수 없다. 홈 탭을 디렉터리 구조로 전환했다:

- `(tabs)/home/_layout.tsx`: expo-router Stack (네이티브 back → 목록 복귀 보장)
- `(tabs)/home/index.tsx`: 기존 `home.tsx`의 `TabWebView route="home"` 이전
- `(tabs)/home/[id].tsx`: 상세 네이티브 라우트, `${WEB_URL}/home/{id}` BridgedWebView
- `(tabs)/home.tsx`: 제거

iOS 시뮬레이터에서 디렉터리화 이후 앱이 정상 렌더됨을 확인했다(로그인 화면, 크래시 없음).

---

## 4. 게이트 + 라이브 데이터 패스 검증 결과

### 자동 게이트 (재실행 없이 인용)

| 게이트 | 결과 |
|--------|------|
| mobile tsc | 0 error |
| mobile vitest | 215/215 (+24 route-map detail-push 케이스) |
| expo export (iOS) | OK |
| web build (`nx run web:build`) | 0 error, route `/home/[id]` 등록 확인 |
| web lint | 0 error |
| web tsc | 0 error |
| api-client tsc | 0 error |

### 라이브 데이터 패스 검증 (실 password-grant 토큰, 로컬 Supabase)

| 엔드포인트 | 결과 | 비고 |
|------------|------|------|
| `GET /moims` | 200, `[{id,name,createdBy,createdAt}]` | 실 형상 확인, fabricated 필드 없음 |
| `GET /moims/:id` | 200 | 단건 조회 정상 |
| `GET /moims/:id/members` | 200, `[{userId,nickname,role:"owner",joinedAt}]` | 멤버 형상 확인 |
| `GET /moims/<missing>` | 404 | notFound() 경로 확인 |
| 미인증 요청 | 401 | JWKS 가드 유지 확인 |
| 위조 HS256 토큰 | 401 | 백엔드 인가 약화 없음 확인 |

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 홈 탭 실 모임 목록 | `GET /moims` 실 데이터 렌더, 카드 `/home/{id}` 링크 | 라이브 데이터 패스(실 토큰) + web build 등록 | **PASS** |
| AC-2: 모임 상세 렌더 + 채팅 진입 | `/home/{id}` — 이름+멤버 렌더, "채팅 입장" 링크 | 라이브 데이터 패스(GET /moims/:id+/members 200) + 코드 검사 | **PASS** |
| AC-3: 모바일 네이티브 상세 push | 카드 탭 → WebView 차단 → 네이티브 push → 상세 렌더 → back → 목록 | vitest 24건(로직) PASS; 인앱 E2E 미수행(Supabase 세션 만료) | **PENDING — device-gated** |
| AC-4: 데스크톱 일반 라우팅 | 브라우저 `/home/{id}` 일반 Next 라우팅, 동일 콘텐츠 렌더 | web build OK (route 등록) + 동일 코드 경로(WebView 분기 없음) | **PASS** |
| AC-5: 보호 라우트 + 백엔드 인가 보존 | 미인증 → /login 리다이렉트; 비멤버 403 → notFound(); 인가 약화 없음 | 라이브 HTTP 검증(미인증 401, 위조 401) + 코드 검사(requireNamedSession 상속, notFound 처리) | **PASS** |
| AC-6: 품질 게이트 | 자동 게이트 전부 0 error | mobile vitest 215/215, tsc 0, web build 0, expo export OK | **PASS** |

---

## 6. 미완료 — AC-3 인앱 탭 E2E 검증 플로우

**검증이 필요한 플로우 (in-app, iOS 시뮬레이터):**

1. 앱 시작 → 로그인(Google 또는 이메일) → 홈 탭 진입
2. 홈 탭에 실 모임 카드가 표시됨을 확인
3. 모임 카드를 탭함 → WebView 자체 이동이 아닌 네이티브 `(tabs)/home/[id]` push가 발생함을 확인 (`decideWebViewLoad` push 분기 동작)
4. 네이티브 `(tabs)/home/[id]` 화면이 push되어 `${WEB_URL}/home/{id}`를 BridgedWebView로 호스팅함을 확인
5. 웹 상세 화면에 모임 이름 + 멤버 목록(nickname + role) + "채팅 입장" 링크가 렌더됨을 확인
6. 네이티브 back(스와이프 또는 버튼) → `(tabs)/home` 목록으로 복귀함을 확인
7. "채팅 입장" 링크 탭 → `/moims/{id}/chat` 진입함을 확인

**미수행 이유**: 이번 세션에서 앞서 진행된 Google 로그인 토큰이 유효 기간 경과로 만료되어 실 인증 세션 하에서 카드 탭을 수행하지 못했다.

**vitest 검증 상태**: `detailRouteForUrl('${WEB_URL}/home/123')` → `{ route: "home", id: "123" }`; 같은 탭 detail → push 변형 반환; 인증 URL(/login) · 다른 origin → push 아님; `currentUrl` 부재 시 기존 동작(회귀 0). 이 24건은 모두 GREEN이나 in-app E2E를 대체하지 않는다.

---

## 7. DB 스키마 변경 없음

본 SPEC에서 백엔드 및 DB 스키마 변경은 없다. `GET /moims`, `GET /moims/:id`, `GET /moims/:id/members` 엔드포인트가 이미 존재하고 정상 동작한다(검증 완료). `.moai/project/db/`는 수정하지 않았다.

---

## 8. 완료 전환 기록 (2026-06-18)

**status 전환**: `in-progress` → `completed` (v0.2.0 → v0.3.0)

**전환 근거**: AC-3 인앱 E2E(홈 실 카드 탭 → 네이티브 `(tabs)/home/[id]` push → 웹 상세 렌더 → 네이티브 back → 목록 복귀)를 사용자가 iOS 시뮬레이터에서 직접 확인(사용자 인앱 검증 2026-06-18). 프로젝트 메모리 규칙(mobile-spec-device-gated)에서 정의한 device-verification authority(사용자)가 검증 완료를 확인함.

**전 AC 충족 요약**:

| AC | 검증 방법 | 결과 |
|----|-----------|------|
| AC-1: 홈 탭 실 모임 목록 | 라이브 데이터 패스(실 토큰) + web build | PASS |
| AC-2: 모임 상세 렌더 + 채팅 진입 | 라이브 데이터 패스(GET /moims/:id+/members) + 코드 검사 | PASS |
| AC-3: 모바일 네이티브 상세 push | vitest 24건(로직) + 사용자 인앱 검증 2026-06-18 | PASS |
| AC-4: 데스크톱 일반 라우팅 | web build OK + 동일 코드 경로 | PASS |
| AC-5: 보호 라우트 + 백엔드 인가 보존 | 라이브 HTTP 검증(미인증 401, 위조 401) + 코드 검사 | PASS |
| AC-6: 품질 게이트 | mobile vitest 215/215, tsc 0, web build 0, expo export OK | PASS |

**수정된 파일 목록 (이번 완료 sync)**:

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-MOIM-003/spec.md` | status `in-progress`→`completed`, version `0.2.0`→`0.3.0`, HISTORY v0.3.0 항목 추가 |
| `.moai/specs/SPEC-MOIM-003/acceptance.md` | DoD AC-3 인앱 탭 E2E 항목 체크 처리 + "사용자 인앱 검증 2026-06-18" 주석 |
| `CHANGELOG.md` | SPEC-MOIM-003 항목 `in-progress`→`completed`, 인앱 네비게이션 검증 완료 명시 |
| `.moai/project/structure.md` | SPEC-MOIM-003 status completed 반영 |
| `.moai/project/tech.md` | SPEC-MOIM-003 status `in-progress`→`completed`, AC-3 검증 완료 기록 |
| `.moai/reports/sync-report-SPEC-MOIM-003.md` | 완료 전환 기록(본 섹션) 추가 |
