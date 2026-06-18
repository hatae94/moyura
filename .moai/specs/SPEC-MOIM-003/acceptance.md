# SPEC-MOIM-003 수용 기준 (acceptance.md)

> 모임 상세 화면(MeetupDetail). spec.md v0.1.0 / REQ-MOIM3-001~006 추적.
> 웹은 테스트 하니스 없음 — 웹 AC 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터. 모바일 순수 코어는 vitest.

## 수용 기준 (Acceptance Criteria)

### AC-1: 홈 탭 실 모임 목록 [REQ-MOIM3-001]

`GET /moims` 가 현재 사용자의 모임을 반환하고, 홈 탭이 mock 이 아닌 실 데이터로 렌더하며 각 카드가 `/home/{id}` 로 이동한다.

- **Given** 사용자가 모임 2개에 속해 있고 인증된 세션을 보유한다
- **When** `/home` 을 요청한다
- **Then** `GET /moims` 응답의 실 모임 2개가 카드로 렌더되고, 각 카드는 해당 모임의 `id` 로 구성된 `/home/{id}` 링크다(mock `MOCK_MEETUPS` 미사용).
- **And** 모임이 0개이면 기존 빈 상태 UI("모임이 없어요")가 표시된다.

### AC-2: 모임 상세 렌더 + 채팅 진입 [REQ-MOIM3-002]

`/home/{id}` 가 모임 이름 + 멤버 목록(nickname + role)을 `GET /moims/:id` + `GET /moims/:id/members` 로 렌더하고 "채팅 입장" 이 `/moims/{id}/chat` 으로 이동한다.

- **Given** 사용자가 모임 `{id}` 의 멤버다
- **When** `/home/{id}` 를 요청한다
- **Then** 모임 이름이 헤더로, 멤버 목록이 각 멤버의 `nickname` + `role`(owner/member 구분)로 렌더된다.
- **And** "채팅 입장" 액션이 `/moims/{id}/chat` 으로 이동하는 링크로 존재한다.

### AC-3: 모바일 네이티브 상세 push [REQ-MOIM3-003] (디바이스 게이트)

모바일 WebView 셸에서 홈 카드 탭 시 WebView 자체 이동이 아니라 네이티브 push `(tabs)/home/[id]` 가 디스패치되고, 그 화면이 웹 `/home/[id]` 를 호스팅하며, 네이티브 back 이 목록으로 복귀한다(MOBILE-003 R-NC2/R-NC3 준수).

- **Given** 모바일 앱(WebView 셸)이 홈 탭 `/home` 에 있고 모임 카드가 표시된다
- **When** 사용자가 모임 카드를 탭한다(웹이 `/home/{id}` 로 네비게이션 시도)
- **Then** `decideWebViewLoad` 가 in-WebView 교차 라우트 이동을 차단하고 `{ action: "push", route: "home", id }` 를 디스패치한다(WebView 자체 이동 안 함).
- **And** 네이티브 `(tabs)/home/[id]` 화면이 push 되어 `${WEB_URL}/home/{id}` 를 BridgedWebView 로 호스팅한다.
- **And** 네이티브 back 수행 시 `(tabs)/home` 목록으로 복귀한다(expo-router Stack).
- **순수 단위(vitest)**: `detailRouteForUrl('${WEB_URL}/home/123')` → `{ route: "home", id: "123" }`; 같은 탭 detail → push; 인증 URL(`/login`)·다른 origin → push 아님; `currentUrl` 부재 시 기존 동작(회귀 0).

### AC-4: 데스크톱 일반 라우팅 [REQ-MOIM3-004]

데스크톱 브라우저에서 `/home` 과 `/home/{id}` 가 일반 Next 라우팅으로 동작하고 네이티브 디스패치가 없으며, 상세가 모바일과 동일하게 렌더된다.

- **Given** 데스크톱 브라우저(`window.ReactNativeWebView` 부재)에서 인증된 사용자
- **When** `/home` 에서 모임 카드를 클릭한다
- **Then** 브라우저가 일반 Next 라우팅으로 `/home/{id}` 로 이동한다(네이티브 디스패치 트리거 없음).
- **And** 상세 화면이 모바일 WebView 와 동일한 콘텐츠(이름/멤버/채팅 입장)로 렌더된다.

### AC-5: 보호 라우트 + 백엔드 인가 보존 [REQ-MOIM3-005]

`/home/{id}` 는 `(main)` 가드를 상속해 보호되고, 비멤버의 모임 접근은 백엔드 403 을 약화 없이 안전 처리한다.

- **Given** 미인증 사용자
- **When** `/home/{id}` 를 요청한다
- **Then** `(main)/layout.tsx` `requireNamedSession()` 에 의해 `/login` 으로 리다이렉트된다.
- **And (이름 미보유)** 인증되었으나 `Profile.name` 이 없는 사용자는 `/onboarding` 으로 리다이렉트된다(동일 가드 상속).
- **And (비멤버)** 멤버가 아닌 사용자가 자신이 속하지 않은 모임의 `/home/{id}` 를 요청하면, 서버 조회가 `GET /moims/:id` 403 을 받아 모임 콘텐츠를 노출하지 않는 안전 결과(notFound 또는 안내 + 홈 복귀)로 처리되며, 백엔드 인가는 약화되지 않는다(토큰/오류 상세 비노출).

### AC-6: 품질 게이트 [전 REQ]

전체 자동 게이트가 0 error 로 통과한다.

- **Given** 구현이 완료된 상태
- **When** `nx run web:build`, web lint, `tsc`(web + mobile + api-client), mobile vitest, `expo export` 를 실행한다
- **Then** 모두 0 error 로 통과한다(신규 route-map detail-push vitest 케이스 포함).

## 엣지 케이스 (Edge Cases)

- **존재하지 않는 모임 id**: `/home/{없는id}` → `GET /moims/:id` 404 → 상세 `notFound()`.
- **멤버 0명 모임**: 멤버 목록이 빈 경우에도 이름 + "채팅 입장" 은 렌더(빈 멤버 안내).
- **`/home/{id}` 직접 URL 진입(데스크톱)**: 가드 상속으로 미인증/이름 미보유는 리다이렉트, 멤버는 정상 렌더.
- **모바일 detail push 후 추가 in-WebView 네비게이션**: 상세 WebView 내 채팅 링크(`/moims/{id}/chat`)는 단일 세그먼트 탭 라우트가 아니므로 detail-push 분류 대상 아님 — 기존 origin 판정/허용 규칙 적용(채팅은 별도 SPEC-WEB-GUARD-001 가드 경로).
- **malformed URL**: `detailRouteForUrl`/`decideWebViewLoad` 는 throw 없이 safe(null/기존 분기)로 처리.
- **status 필터 부재**: 카드에 status 데이터가 없어 필터링이 무의미 — 필터 UI 단일화/제거로 빈 결과 혼란 방지.

## Definition of Done (DoD)

- [x] REQ-MOIM3-001~006 전부 구현 + AC-1~AC-6 충족. *(AC-3 인앱 E2E 제외 — 아래 참고)*
- [x] 백엔드 무변경(엔드포인트·인가 약화 없음) — 확인 체크포인트 통과. *(GET /moims·/moims/:id·/moims/:id/members 라이브 검증 PASS, 401/404 응답 확인)*
- [x] 홈 탭이 실 `GET /moims` 데이터로 렌더(mock 미사용), 카드가 `/home/{id}` 링크. *(AC-1 라이브 데이터 패스 PASS — 실 password-grant 토큰으로 검증)*
- [x] `/home/{id}` 상세가 이름 + 멤버(nickname+role) + 채팅 입장 렌더, `(main)` 가드 상속. *(AC-2 라이브 PASS, AC-5 가드+403/404 PASS)*
- [x] api-client `listMoims()` + 웹 상세/멤버 헬퍼(chat/api.ts 패턴) 추가. *(api-client tsc 0 PASS)*
- [x] 모바일 detail-push 순수 분류 + `decideWebViewLoad` push 변형(회귀 0) + vitest. *(mobile vitest 215/215 +24 route-map detail-push 케이스 GREEN)*
- [x] expo-router 홈 탭 디렉터리화(Stack + index + [id]), 네이티브 back 복귀. *(iOS 시뮬레이터에서 앱 리로드 후 렌더 정상, 디렉터리화 구조적 안전 확인)*
- [x] 자동 게이트(web build/lint, tsc 3패키지, mobile vitest, expo export) 0 error. *(AC-6 전부 GREEN)*
- [ ] **디바이스 종단 검증 — AC-3 인앱 탭 E2E** (완료 전환 필수): iOS 시뮬레이터 dev build 에서 홈 실 목록 → 카드 탭 → 네이티브 상세 push → 웹 상세 렌더 → 네이티브 back → 목록 복귀 → "채팅 입장" 진입 라이브 확인. **device-gated — 라이브 인앱 탭 대기** (이번 세션 중 Supabase 세션 만료로 카드 탭 미수행; push 로직 vitest 검증됨, 번들 빌드됨). 검증 완료 전까지 status = `in-progress`.
- [x] 스키마 확장 0(Moim 필드 미추가), 수정/삭제/생성 UI 미구현(Exclusions 준수).
