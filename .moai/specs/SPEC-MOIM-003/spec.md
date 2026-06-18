---
id: SPEC-MOIM-003
version: 0.3.0
status: completed
created: 2026-06-17
updated: 2026-06-18
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-003: 모임 상세 화면 (MeetupDetail) — 홈 카드 탭 → 상세, 멤버/채팅 진입

## HISTORY

- 2026-06-18 (v0.3.0): AC-3 인앱 E2E (홈 실 카드 탭 → 네이티브 (tabs)/home/[id] push → 웹 상세 렌더 → 네이티브 back → 목록 복귀) 사용자 디바이스 검증 완료(2026-06-18) → status completed. 전 AC 충족.
- 2026-06-18 (v0.2.0): sync 단계 — status `draft` → `in-progress` 전환. 구현 완료(HEAD = 74fd7fe). **자동 게이트 전부 GREEN**: mobile tsc 0, mobile vitest 215/215(+24 route-map detail-push 케이스), expo export(iOS) OK, web build 0(route /home/[id] 등록), web lint 0, web tsc 0, api-client tsc 0. **라이브 데이터 패스 검증(실 password-grant 토큰, 로컬 Supabase)**: `GET /moims` → 200 `[{id,name,createdBy,createdAt}]`(실 형상, fabricated 필드 없음); `GET /moims/:id` → 200; `GET /moims/:id/members` → 200 `[{userId,nickname,role:"owner",joinedAt}]`; `GET /moims/<missing>` → 404; 토큰 없음/위조 HS256 → 401(JWKS 가드 유지). **AC별 검증 상태**: AC-1(홈 실 데이터 배선) 라이브 PASS; AC-2(상세 콘텐츠) 라이브 PASS; AC-5(가드 + 404/인가) 라이브 PASS; AC-4(데스크톱 일반 라우팅) web build 등록 + 동일 코드 PASS; AC-6(품질 게이트) 전부 GREEN. **AC-3(모바일 인앱 카드 탭 E2E) 미완료**: push 로직은 vitest 24건으로 검증되고 번들도 빌드되었으나, Supabase 세션 만료(앞서 진행된 Google 로그인 토큰 유효 기간 경과)로 인해 이번 세션 중 실제 카드 탭 인앱 E2E를 수행하지 못함. 프로젝트 메모리 규칙(mobile-spec-device-gated)에 따라 라이브 인앱 탭 검증 완료 전까지 status = `in-progress`.
  - **주요 구현 내용**: 웹 홈 탭 mock→real 배선(`MOCK_MEETUPS` 제거, `GET /moims` 실 데이터), 카드 `/home/{id}` 링크 전환, 웹 상세 Server Component(`app/(main)/home/[id]/page.tsx`) 신규(`GET /moims/:id` + `GET /moims/:id/members`, `(main)` 가드 상속, 403/404 → `notFound()`), 웹 상세/멤버 헬퍼(`apps/web/lib/moim/api.ts` — `getMoim`/`getMoimMembers`, `chat/api.ts` 패턴), api-client `listMoims()` + `MoimResponse` 추가, 모바일 `detailRouteForUrl`/`urlForDetailRoute` 순수 함수 + `decideWebViewLoad` push 변형(additive), `useAuthBridge.ts` `onDetailPush` 콜백, `BridgedWebView.tsx` `router.push`(tabs)/home/[id], 홈 탭 디렉터리화(`(tabs)/home/` — `_layout.tsx`(Stack) + `index.tsx` + `[id].tsx`), `home.tsx` 플랫 파일 제거, `_mock.ts` 제거, 신규 vitest 2파일 +24 테스트.
  - **설계 결정 기록**: (1) 홈 카드 honest-fields-only — `{name, createdAt}`만 표시, fabricated 필드(date/time/location/status/memberCount) 제거; (2) 상세 = Server Component(클라이언트 인터랙션 불필요 — 링크만 있음); (3) 가드 = `(main)` 그룹 상속(별도 layout 불필요); (4) 비멤버 403 → `notFound()`(모임 존재 여부 비노출); (5) api-client `request()` 템플릿 미치환 확인 → `chat/api.ts` 패턴 미러; (6) 모바일 디렉터리화 — flat `home.tsx`와 `home/[id].tsx` 공존 불가로 `home/` 디렉터리 + Stack.
  - **in-progress 유지 이유**: AC-3(모바일: 홈 카드 탭 → 네이티브 `(tabs)/home/[id]` push → 웹 상세 렌더 → 네이티브 back → 목록 복귀)는 실 인증 세션 하에서 iOS 시뮬레이터 인앱 탭으로만 검증 가능. push 로직은 vitest 24건 GREEN이나 live in-app E2E가 pending.
- 2026-06-17 (v0.1.0): 최초 draft. SPEC-MOBILE-003(spec.md:206-208 "후속 SPEC 후보", :65)이 명시적으로 카브아웃한 MeetupDetail 후속 SPEC. MOBILE-003 네비게이션 계약(모바일 네이티브 push 라우트 `(tabs)/home/[id]` 가 웹 상세 `${WEB_URL}/home/[id]` 를 WebView 로 호스팅)을 **그대로 따른다**(다른 계약을 발명하지 않는다). 핵심 결정: (1) 백엔드 무변경 — `GET /moims`·`GET /moims/:id`·`GET /moims/:id/members` 가 이미 존재하고 멤버 스코핑(비멤버 403·미존재 404)이 MoimService에서 강제됨(verified, moim.controller.ts:61/73/90); (2) 홈 탭 mock→real 배선 포함 — `HomeTab` 의 `MOCK_MEETUPS` 를 `GET /moims` 실 데이터로 교체해 카드가 실 id 로 `/home/{id}` 로 이동; (3) 스키마 확장 제외 — 현재 `Moim { id, name, createdBy, createdAt }` 만 사용, date/time/location/RSVP/vote/status 미추가(향후 SPEC); (4) 상세 페이지는 `app/(main)/home/[id]/` 에 두어 `(main)/layout.tsx` 의 `requireNamedSession()` 가드를 상속(별도 가드 파일 불필요, SPEC-WEB-GUARD-001 정책 일관); (5) 모바일 라우트 분류 신규 로직(`/home/[id]` detail-push 인식)은 순수 `route-map-core.ts`/`auth-bridge-core.ts` 에 두어 vitest 커버. 디자인은 새 Figma 프레임 부재(MOBILE-003 figma-reference.md render-only)로 기존 `(main)` 페이지 디자인 시스템과 일관 설계.

---

## 1. 개요 (Overview)

홈 탭(`/home`)이 현재 mock 데이터(`MOCK_MEETUPS`)로 렌더하는 모임 카드를 **실 모임 데이터**(`GET /moims`)로 교체하고, 카드를 탭하면 **모임 상세 화면**(`/home/[id]`)으로 이동해 모임 이름·멤버 목록·"채팅 입장" 진입점을 제공하는 읽기 전용 상세 화면을 구현한다.

아키텍처는 하이브리드(불변)다: **웹이 화면 콘텐츠를 소유**(Next.js 16 App Router + Tailwind v4 + lucide-react)하고 **모바일이 네이티브 내비게이션 크롬을 소유**(expo-router)한다. 웹 상세 페이지는 모바일 WebView 셸 안에서 렌더되고, 데스크톱 브라우저는 그것을 직접 렌더한다.

본 SPEC은 SPEC-MOBILE-003 이 정의한 네비게이션 계약을 따른다: 모바일에서 `/home/[id]` 로의 이동은 WebView 자체 이동이 아니라 네이티브 push 라우트 `(tabs)/home/[id]` 디스패치로 처리되며(R-NC2 교차 라우트 차단의 nested 확장), 이 네이티브 화면이 웹 `${WEB_URL}/home/[id]` 를 BridgedWebView 로 호스팅한다(R-NC1 1:1 매핑). 데스크톱은 일반 Next 라우팅이다.

이는 **읽기 전용 상세 화면 + 홈 배선 + 모바일 라우트 하나**이지 대형 기능이 아니다.

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 6개로 제한한다. 각 모듈은 `REQ-MOIM3-XXX`로 번호를 부여하며(기존 SPEC-MOIM-001 `REQ-MOIM-XXX` 와 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOIM3-001: 홈 탭 실 모임 목록 (Event-driven)

- **WHEN** 인증 사용자가 홈 탭(`/home`)을 요청하면, **the web app shall** mock 대신 `GET /moims`(자신이 속한 모임 목록)를 조회하여 실 모임 카드를 렌더한다.
- **The web app shall** 각 모임 카드를 `/home/{id}` 로 이동하는 링크로 렌더한다(`id` 는 `GET /moims` 응답의 `Moim.id`).
- **The web app shall** 모임이 0개이면 기존 빈 상태(empty state) UI를 유지한다.

### REQ-MOIM3-002: 모임 상세 화면 (Event-driven)

- **WHEN** 인증 사용자가 `/home/{id}` 를 요청하면, **the web app shall** `GET /moims/:id`(모임 이름)와 `GET /moims/:id/members`(멤버 목록)를 조회하여 모임 이름과 멤버 목록(멤버 `nickname` + `role` owner/member)을 렌더한다.
- **The web app shall** 상세 화면에 "채팅 입장" 기본 액션을 두고 `/moims/{id}/chat` 로 이동하는 링크로 렌더한다.
- **The detail page shall** WebView(모바일 셸)와 데스크톱 브라우저 양쪽에서 동일하게 렌더된다.

### REQ-MOIM3-003: 모바일 네이티브 상세 push (Event-driven — MOBILE-003 R-NC2/R-NC3 계약 준수)

- **WHEN** 모바일 WebView 셸의 홈 탭에서 `/home/{id}` 로의 네비게이션이 발생하면, **the mobile app shall** WebView 의 자체(in-WebView) 교차 라우트 이동을 차단하고 네이티브 push 라우트 `(tabs)/home/[id]` 를 디스패치한다(R-NC2 교차 라우트 차단의 nested 라우트 확장).
- **WHEN** 네이티브 `(tabs)/home/[id]` 라우트가 push 되면, **the mobile app shall** `${WEB_URL}/home/{id}` 를 BridgedWebView 로 호스팅한다(R-NC1 네이티브↔웹 1:1 매핑).
- **WHEN** 사용자가 네이티브 back 을 수행하면, **the mobile app shall** 홈 탭 목록(`(tabs)/home`)으로 복귀한다(expo-router Stack).
- **The mobile app shall** 인증 플로우 URL(`/login`, `/auth/callback`) 및 단일 세그먼트 탭 라우트 디스패치 동작을 변경하지 않는다(R-NC3 기존 허용 규칙 보존, 회귀 0).

### REQ-MOIM3-004: 데스크톱 일반 라우팅 (State-driven)

- **WHILE** 사용자가 데스크톱 브라우저(`window.ReactNativeWebView` 부재)에서 접속한 동안, **the web app shall** `/home` 과 `/home/{id}` 를 일반 Next 라우팅으로 처리하고 네이티브 디스패치를 트리거하지 않는다.
- **The web app shall** 데스크톱에서도 상세 화면을 모바일 WebView 와 동일하게 렌더한다(content parity).

### REQ-MOIM3-005: 보호 라우트 + 백엔드 인가 보존 (State-driven / Unwanted behavior 혼합)

- (State-driven) **WHILE** 사용자가 유효한 세션과 비어 있지 않은 `Profile.name` 을 보유한 동안, **the web app shall** `/home/{id}` 를 렌더한다.
- (Event-driven) **WHEN** 미인증 사용자가 `/home/{id}` 를 요청하면, **the web app shall** `/login` 으로 리다이렉트한다(`(main)/layout.tsx` 의 `requireNamedSession()` 상속).
- (Event-driven) **WHEN** `Profile.name` 미보유 인증 사용자가 `/home/{id}` 를 요청하면, **the web app shall** `/onboarding` 으로 리다이렉트한다(동일 가드 상속, SPEC-WEB-GUARD-001 정책 일관).
- (Unwanted behavior) **IF** 멤버가 아닌 사용자가 자신이 속하지 않은 모임의 `/home/{id}` 를 요청하면, **then the web app shall** 백엔드 `GET /moims/:id` 의 기존 인가(비멤버 403)를 약화시키지 않고, 모임 콘텐츠를 노출하지 않는 안전한 결과(상세 미렌더 + 안전 메시지/리다이렉트)로 처리한다.

### REQ-MOIM3-006: api-client 모임 조회 표면 (Ubiquitous)

- **The api-client shall** `GET /moims`(목록) 조회를 위한 타입드 편의 메서드를 노출한다(기존 `getMe`/`patchMe` 패턴과 일관, OpenAPI 생성 `schema.d.ts` 의 `MoimResponseDto` 활용).
- **The web app shall** path 파라미터가 있는 `GET /moims/:id`·`GET /moims/:id/members` 조회를 기존 `apps/web/lib/chat/api.ts` 패턴(구체 경로 조립 + `request(path as never, "get")`)과 동일한 방식으로 호출한다(`request()` 는 템플릿 치환을 하지 않으므로 — verified).
- **The api-client shall** 토큰을 URL/query 가 아닌 Authorization Bearer 헤더로만 전달한다(기존 `TokenProvider`/R-A9 보존).

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 기존 코드를 수정하는 brownfield 작업이다. 파일·라인은 작성 시점(2026-06-17) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/moim/moim.controller.ts` — `GET /moims`(:61), `GET /moims/:id`(:73, 비멤버 403·미존재 404), `GET /moims/:id/members`(:90). **백엔드 무변경** — 멤버 스코핑이 이미 MoimService에서 단일 출처로 강제됨.
- `apps/web/app/(main)/layout.tsx` — `requireNamedSession()`(:38) 가드. 변경 없음, 상속만(`/home/[id]` 가 `(main)` 그룹 하위이므로 자동 적용).
- `apps/web/lib/auth/require-named-session.ts` — 가드 정책 본체. 변경 없음, 재사용만.
- `apps/web/lib/chat/api.ts` — 구체 경로 조립 + `request(path as never)` 호출 패턴의 참조 원본(상세/멤버 조회가 동일 패턴을 따른다). 변경 없음.
- `apps/web/app/moims/[id]/chat/page.tsx` — 채팅 화면. 변경 없음("채팅 입장" 링크의 대상).
- `packages/api-client/src/schema.d.ts` — OpenAPI 생성 스펙(`/moims`·`/moims/{id}`·`/moims/{id}/members` 경로 + `MoimResponseDto`/`MemberResponseDto` 이미 포함, verified :55/:71/:87/:269/:291). 재생성 외 수동 변경 없음.
- `apps/mobile/components/BridgedWebView.tsx` — `BridgedWebView`(sourceUri/routeContext) 화면 프리미티브. 변경 없음, 상세 라우트가 재사용.
- `apps/mobile/hooks/auth-bridge-core.ts` `isTrustedOrigin`/`buildTargetOrigin` 등 — 보존(상세 push 분기만 추가, 아래 [MODIFY]).

### [MODIFY] (수정)

- `apps/mobile/lib/route-map-core.ts` — 중첩 detail 라우트(`/home/[id]`) 분류 순수 함수 추가(예: `detailRouteForUrl(url): { route: AppRoute; id: string } | null`). 기존 `routeForUrl`(단일 세그먼트만 매핑, 중첩 경로 null) 동작은 보존하고, detail 분류는 별도 함수로 추가한다(회귀 0). `urlForRoute` 와 round-trip 일관성 유지.
- `apps/mobile/hooks/auth-bridge-core.ts` `decideWebViewLoad` — 신뢰 origin 의 nested detail 라우트(같은 탭 내 `/home/[id]`)에 대해 신규 push 디스패치 변형(예: `{ action: "push", route, id }`)을 **additive** 로 반환하도록 확장한다. 기존 3분기 + tab-switch `dispatch` 변형 + 오버로드 타입 하위호환을 보존한다(currentUrl 부재 시 비활성, 회귀 0).
- `apps/web/app/(main)/home/HomeTab.tsx` — `MOCK_MEETUPS` import 제거, 실 모임(props 로 주입) 바인딩. 카드를 `/home/{id}` 링크로 전환. 실 데이터 출처가 없는 필드(date/time/location/status/memberCount)는 제거하거나 그레이스풀 degrade(아래 §5 설계 노트). 기존 Tailwind 카드 레이아웃·헤더(인사말/아바타)는 유지.
- `apps/web/app/(main)/home/page.tsx` — 서버에서 세션 access_token 으로 `GET /moims` 를 조회해 실 모임 목록을 `HomeTab` 에 prop 으로 전달(기존 displayName/avatar/greeting 도출 보존).

### [NEW] (신규)

- `apps/web/app/(main)/home/[id]/page.tsx` — 모임 상세 페이지(Server Component 권장). `GET /moims/:id` + `GET /moims/:id/members` 서버 조회 → 이름·멤버 목록·"채팅 입장" 링크 렌더. `(main)` 가드 상속.
- `apps/web/lib/moim/api.ts` — 상세/멤버 조회 헬퍼(`getMoim`, `getMoimMembers`) — `chat/api.ts` 패턴 미러(구체 경로 + `request(path as never, "get")` 캐스팅). 목록은 api-client 편의 메서드 사용.
- `packages/api-client/src/index.ts` — `listMoims()` 타입드 편의 메서드 추가(`getMe`/`patchMe` 패턴, path 키 `/moims` 는 리터럴이라 generic request 로 타입 안전). `MoimResponse` 타입 별칭 추가.
- `apps/mobile/app/(tabs)/home/_layout.tsx` — expo-router `Stack`(상세 push + 네이티브 back 복귀 지원).
- `apps/mobile/app/(tabs)/home/index.tsx` — 기존 `home.tsx` 의 `TabWebView route="home"` 이전(디렉터리화).
- `apps/mobile/app/(tabs)/home/[id].tsx` — 상세 네이티브 라우트. `${WEB_URL}/home/{id}` 를 `BridgedWebView`(routeContext `"(tabs)"`)로 호스팅. expo-router `id` 파라미터에서 URL 조립.

### [REMOVE]

- `apps/mobile/app/(tabs)/home.tsx` — `(tabs)/home/index.tsx` 로 대체(expo-router 디렉터리화 — 같은 이름의 flat 파일과 디렉터리 공존 불가).
- `apps/web/app/(main)/home/_mock.ts` — `MOCK_MEETUPS` 참조 제거 후 더 이상 참조되지 않으면 삭제(최소 churn — 다른 참조가 남으면 유지).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **Moim 스키마 필드 확장** — date/time/location/description/RSVP/vote/status 등 신규 필드 추가 금지. 현재 모델 `Moim { id, name, createdBy, createdAt }` + members + invites + chat 만 사용한다. 풍부한 이벤트 필드는 별도 후속 SPEC.
- **상세에서의 모임 수정/삭제 UI** — `DELETE /moims/:id`·`DELETE /moims/:id/membership` 엔드포인트는 존재하나 상세 화면 진입점/UI는 범위 밖(향후 SPEC).
- **모임 생성 기능 배선** — `CreateMeetupButton` 은 기존 비기능 CTA 유지. 실 모임 생성(`POST /moims`)은 본 SPEC 범위 아님.
- **상태(status) 필터 기능** — 실 `Moim` 에 status 필드가 없으므로 "예정/완료" 필터 칩은 동작 데이터 없음. 본 SPEC은 status 필터를 구현하지 않는다(필터 칩 제거 또는 "전체" 단일화 — §5 설계 노트).
- **백엔드 엔드포인트 추가/수정** — 읽기/상세에 필요한 엔드포인트가 모두 존재하므로 백엔드 무변경. 가드/인가 정책도 변경하지 않는다.
- **상세 화면 realtime** — 채팅 realtime 은 채팅 페이지(`/moims/[id]/chat`)에 유지. 상세 화면은 진입 시 1회 조회(읽기 전용)다.
- **신규 Figma 프레임 기반 디자인** — MeetupDetail 전용 Figma 프레임 부재(MOBILE-003 figma-reference.md render-only/excluded). 기존 `(main)` 페이지 디자인 시스템과 일관 설계하며 Figma 작업을 블로커로 두지 않는다.
- **per-card 멤버 수 조회** — 목록 카드에 멤버 수를 표시하려면 카드별 추가 호출이 필요하므로 범위 밖(목록 응답 `Moim` 에 memberCount 없음). 멤버 목록은 상세 화면에서만 표시.

---

## 5. 설계 노트 (Design Notes)

### 홈 카드 mock→real 그레이스풀 degrade

- 실 `Moim` 은 `{ id, name, createdBy, createdAt }` 만 제공한다. mock 카드의 date/time/location/status/memberCount/emoji/coverColor 는 실 데이터 출처가 없다.
- **결정(최소·정직)**: 카드는 모임 이름(필수) + 생성일(`createdAt`)을 표시하고, 데이터 출처 없는 필드(시간/장소/상태 배지/멤버 수)는 렌더에서 **제거**한다. 카드 레이아웃 셸(rounded-2xl border, ChevronRight 진입 어포던스)은 유지해 시각적 일관성을 보존한다.
- emoji/coverColor 같은 장식은 결정론적 폴백(예: 이름 해시 기반 또는 단일 기본 글리프)으로 대체 가능 — 신규 스키마 없이 클라이언트 파생만 허용.
- 필터 칩: status 데이터가 없으므로 "전체" 단일화하거나 칩 영역을 제거한다(둘 다 status 필터 미구현). 구현 단계에서 최소 churn 쪽을 택한다.

### 상세 페이지 (Server Component)

- `app/(main)/home/[id]/page.tsx` 는 Server Component 로, `page.tsx`(홈)와 동일하게 서버 supabase 세션에서 access_token 을 얻어 `GET /moims/:id` + `GET /moims/:id/members` 를 서버 조회한다(채팅 페이지는 Client 였으나 상세는 클라이언트 인터랙션이 불필요 — 링크만 있으므로 Server 가 단순).
- `(main)` 그룹 하위이므로 `(main)/layout.tsx` 의 `requireNamedSession()` 가드를 **상속**한다 — 별도 가드 파일 불필요(SPEC-WEB-GUARD-001 의 moims 가드와 정책 동일, 적용 메커니즘만 다름: moims 는 그룹 밖이라 전용 layout 필요, home/[id] 는 그룹 안이라 상속).
- 비멤버 접근: 서버 조회가 `GET /moims/:id` 403 을 받으면(`ApiError` status 403) 상세를 렌더하지 않고 안전 처리(예: `notFound()` 또는 안내 + 홈 복귀). 토큰/오류 상세를 노출하지 않는다.

### 모바일 detail-push 라우트 분류 (순수 코어)

- `routeForUrl` 은 단일 세그먼트만 매핑하고 `/home/123` 같은 2-세그먼트는 `null` 을 반환한다(route-map-core.ts:60-62). 따라서 현재 `isCrossRoute('/home', '/home/123')` 는 false → `decideWebViewLoad` 가 `trusted-load` 로 떨어져 WebView 가 자체 이동한다 — 이는 MOBILE-003 계약 위반이다.
- **결정**: 중첩 detail 분류를 `route-map-core.ts` 에 순수 함수로 추가하고(`detailRouteForUrl`), `decideWebViewLoad` 가 같은 탭 내 detail 타깃을 push 변형으로 디스패치하도록 확장한다. 신규 로직은 RN/expo import 없는 순수 코어에 두어 vitest 로 커버한다(기존 mobile-pure-core-test-seam 컨벤션).
- push 변형은 기존 tab-switch `dispatch` 변형과 구별된다(탭 전환 vs 같은 탭 내 상세 push). 오버로드 타입 하위호환을 보존해 기존 소비자(useAuthBridge exhaustive switch)가 회귀 없이 컴파일된다.

### expo-router 홈 탭 디렉터리화

- 현재 `(tabs)/home.tsx`(flat)와 `(tabs)/home/[id].tsx`(중첩)는 expo-router 에서 공존 불가. 홈 탭을 디렉터리(`(tabs)/home/`)로 전환하고 `_layout.tsx`(Stack) + `index.tsx`(탭 목록) + `[id].tsx`(상세)로 구성한다. `(tabs)/_layout.tsx` 의 `Tabs.Screen name="home"` 은 디렉터리 기반으로 그대로 동작한다(R-WB5 탭바 보존). Stack 으로 네이티브 back 이 목록 복귀를 보장한다.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| 홈 탭 디렉터리화 회귀 | MEDIUM | `(tabs)/home.tsx` → `home/index.tsx` + Stack 전환이 탭 lazy 마운트(OD-4)·셸 마커·콜드스타트 세션 핸드셰이크에 영향 가능. BridgedWebView 재사용으로 동작 보존, 디바이스 검증 필수. |
| WebView detail 자체 이동 누수 | MEDIUM | `/home/[id]` 가 detail-push 로 분류되지 않으면 WebView 가 자체 이동(계약 위반). `decideWebViewLoad` push 분기 + vitest 케이스로 보증. |
| 홈 카드 데이터 정직성 | LOW | mock 의 풍부한 필드가 실 데이터에 없음. degrade 설계(§5)로 빈/허위 필드 노출 방지. |
| api-client request 템플릿 미치환 | LOW | `request()` 가 `/moims/{id}` 템플릿을 치환하지 않음(verified). 상세/멤버는 `chat/api.ts` 패턴(구체 경로 + cast)으로 우회 — 신규 패턴 도입 없음. |
| 데스크톱/모바일 content parity | LOW | 동일 웹 페이지를 양쪽이 렌더하므로 구조적 parity 보장. WebView 셸 특이성은 BridgedWebView 가 흡수. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다. 모바일 순수 코어는 vitest, 백엔드는 (이번엔 무변경이나) 변경 시 jest.

- `nx run web:build` 통과 (0 error)
- web lint 통과 (0 error)
- `tsc` 통과 (0 error — web + mobile + api-client)
- mobile vitest 통과 (신규 route-map detail-push 케이스 포함)
- `expo export` 통과
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않는다. iOS 시뮬레이터(또는 실 기기) dev build 에서 홈 카드 탭 → 네이티브 상세 push → 웹 상세 렌더 → 네이티브 back 복귀 → "채팅 입장" 진입이 라이브 검증되어야 status 가 `completed` 로 전환된다(프로젝트 메모리 규칙: mobile WebView SPEC device-gated). 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
