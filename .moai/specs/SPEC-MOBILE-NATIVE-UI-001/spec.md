---
id: SPEC-MOBILE-NATIVE-UI-001
version: 0.1.0
status: draft
created: 2026-06-25
updated: 2026-06-25
author: hatae
priority: high
issue_number: null
---

# SPEC-MOBILE-NATIVE-UI-001 — 모바일/웹 UI 완전 분리 (네이티브 RN UI · WebView 폐기 · 도메인/API 공유)

## HISTORY

- 2026-06-25 (v0.1.0): 최초 작성 (draft). 성능 진단 리포트(`webview-rn-rendering-performance.md`)의 **가장 급진적 레버(Option B)**를 SPEC 화한다. 리포트 §3 [높음 1] 근본 원인 = "화면별 독립 WebView 인스턴스 × 인스턴스마다 Next 부팅·hydration". Option B 는 그 원인을 **WebView 자체를 제거**해 소거한다 — 모바일은 더 이상 `${WEB_URL}/*` 를 WebView 로 호스팅하지 않고, 각 화면이 네이티브 RN 화면(expo-router)이 되어 **공유 `@moyura/api-client` 를 직접 호출**하고 네이티브 컴포넌트로 렌더한다. 인증은 기존 네이티브 Supabase 경로(`supabase-mobile.ts` + `oauth.ts`)를, 실시간은 네이티브 Supabase realtime 을 사용한다.
  - **[경합 관계]** 본 SPEC 은 **SPEC-WEBVIEW-UNIFY-001**(공유 WebView + 웹 SPA 라우팅 일원화 — WebView 를 **유지**하는 경쟁 접근)과 **상호 배타적 대안**이다. 둘 중 하나만 채택한다. Option B(본 SPEC) = 가장 큰 효과 + 가장 큰 변경폭/회귀 위험. UNIFY-001 = 작은 변경 + WebView 잔존. 채택 결정은 plan/이해관계자 게이트로 미룬다(OD-1).
  - **[scope 확정]** 사용자 hard 제약: **UI 만 분리**한다. 도메인 로직 / API 클라이언트(`@moyura/api-client`) / 타입은 웹과 **공유**한다 — 플랫폼별 비즈니스 로직 포크 금지(anti-duplication). 본 SPEC 은 무엇이 공유 패키지로 들어가고 무엇이 플랫폼 네이티브(UI·내비·네이티브 인증/푸시/실시간 클라이언트)인지 경계를 규정한다.
  - **[효과 규모 정직성]** 이것은 **가장 큰 노력의 옵션**이다: 약 11개 웹 기능 화면의 네이티브 재구축 + 4개 실시간 채널 재구현 + 인증 모델 교체(WebView 쿠키 핸드셰이크 → 네이티브 세션 권위) + 웹 비즈니스 로직의 공유 패키지 추출. 빅뱅 재작성은 **명시적 비목표**이며, 화면 단위 점진 컷오버(플래그)로 수행한다(R-N18).

---

## Background (배경)

`moyura` 모노레포 구조:
- `apps/mobile` (Expo ~56 / RN 0.85.3 / expo-router ~56) — 현재 **WebView 하이브리드 셸**. native 탭/스택 chrome + 라우트마다 `${WEB_URL}/{route}` 를 호스팅하는 별도 `<WebView>`(`BridgedWebView.tsx`→`WebViewShell.tsx`). 인증은 시스템 브라우저 OAuth + WebView 세션 핸드셰이크(`useAuthBridge`·`bridge-protocol`·SecureStore 토큰 주입).
- `apps/web` (Next.js 16, App Router, React 19) — UI surface. 견고한 SPA 설계지만, **WebView 멀티 인스턴스 모델이 SPA 이점을 무력화**한다(진단 리포트 §2~3).
- `packages/api-client` (`@moyura/api-client`) — 백엔드 OpenAPI 스펙 기반 타입드 fetch 래퍼(`ApiClient`·`request`·`getHealth`/`getMe`/`patchMe`/`listMoims`/`createMoim` + `schema.d.ts` 타입). **런타임 번들 0 의 순수 공유 계층**. `getToken` 공급자 주입형이라 웹(쿠키 세션)·모바일(네이티브 세션) 양쪽에서 그대로 쓸 수 있다.
- 백엔드 = NestJS(Render, Singapore). 인증 = Supabase. **본 SPEC 은 백엔드 API 계약을 변경하지 않는다.**

진단 리포트가 입증한 구조적 사실(§3 [높음 1]·§6): 가장 빈번한 동선인 **목록→상세 진입마다** WebView 컨텍스트 생성 → HTTP GET → 번들 파싱 → hydration 전체가 반복된다. soft-nav 였다면 ~600ms 로 끝날 전환이 WebView full boot 로 치환된다. **본 SPEC 은 WebView 를 없애 이 비용을 구조적으로 0 으로 만든다.**

현재의 한계 (이 SPEC 이 해소하는 것): WebView 호스팅은 (a) 화면 진입마다 풀 로드/hydration 반복, (b) WebView 의 느린 JS 엔진·적은 메모리·콜드 캐시로 hydration 비용 증폭, (c) 콜드스타트 토큰 핸드셰이크가 first paint 를 직렬로 가로막음(§3 [중간 4])이라는 비용을 안는다. 네이티브 화면 + 네이티브 세션 + 직접 API 호출은 이 비용 구조 전체를 제거한다.

**중요(anti-duplication 근거):** 현재 도메인 로직 상당량이 `apps/web/lib/` 안에 있다 — `moim/api.ts`(`getMoim`/`getMoimMembers`/`moimErrorStatus`/`formatMoimSchedule`), `chat/api.ts`(`loadHistory`/`sendMessage`/`chatErrorMessage`), `invite/validity.ts`(fail-closed 유효성), `invite/accept.ts`, `moim/expenses.ts`·`polls.ts`·`members.ts`·`invites.ts`, 실시간 채널 디스크립터(topic/event/payload). 이들은 **`api: ApiClient` 를 받아 타입드 데이터 + 에러 분류기 + 포매터를 돌려주는 순수 TS**(React/Next 비의존)다. 모바일이 같은 행위를 가지려면 이 로직을 **포크 없이 공유 패키지로 추출**해야 한다 — 이것이 본 SPEC 의 핵심 anti-duplication 요구다(M5).

---

## Goal (목표)

모바일이 `${WEB_URL}/*` 를 WebView 로 호스팅하는 것을 중단하고, 모든 사용자 화면을 **네이티브 RN 화면(expo-router)**으로 재구축한다. 각 화면은 **공유 `@moyura/api-client`(+ 공유 도메인 패키지)**를 직접 호출해 네이티브 컴포넌트로 렌더하며, 인증은 **네이티브 Supabase 세션**(WebView 쿠키 핸드셰이크 대체), 실시간은 **네이티브 Supabase realtime** 으로 수행한다. 도메인 로직·API·타입은 웹과 공유하고(포크 0), 플랫폼별로 분리되는 것은 **UI 컴포넌트·내비게이션·네이티브 인증/푸시/실시간 클라이언트뿐**이다. WebView/브리지 스택은 네이티브 패리티 확보 후 **게이트된 폐기** 대상이다. 컷오버는 빅뱅이 아니라 **화면 단위 점진 전환(플래그)**으로 수행한다.

---

## Non-Goals (제외 — What NOT to Build)

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **WebView 유지 안 함(경쟁 접근 배제).** 본 SPEC 은 WebView 를 **제거**하는 방향이다. WebView 를 살려 공유 WebView + 웹 SPA 라우팅으로 일원화하는 접근은 **별개의 경쟁 SPEC `SPEC-WEBVIEW-UNIFY-001`** 이며, 둘은 상호 배타적이다 — 동시에 구현하지 않는다.
- **비즈니스 로직 포크 안 함.** 도메인 로직/API/타입은 웹과 **단일 출처로 공유**한다. `apps/mobile` 에 `moim`/`chat`/`invite`/`expense`/`poll` 도메인 로직을 **복제(별도 구현)하지 않는다** — 공유 패키지에서 import 한다(M5). 모바일 전용 구현은 UI·내비·네이티브 클라이언트 어댑터에 한정한다.
- **백엔드 API 계약 변경 없음.** NestJS 엔드포인트·DTO·인가 규칙·RLS 정책을 변경하지 않는다. 모바일은 웹과 **동일한 REST 엔드포인트**를 호출한다.
- **빅뱅 재작성 안 함.** 11개 화면을 한 번에 교체하지 않는다 — 화면 단위 플래그 컷오버로 점진 전환하고, 각 화면은 네이티브 패리티 확인 후에만 WebView 경로를 끈다(R-N18). WebView 스택 파일 삭제는 M1~M4 패리티 AC 통과 후에만 수행한다(게이트).
- **웹 UI/UX 변경 없음.** 본 SPEC 은 모바일 UI 를 분리할 뿐 웹 화면의 동작/레이아웃을 바꾸지 않는다. M5 의 공유 추출은 **웹에 대해 행위 보존(behavior-preserving)**이어야 하며 웹 동작을 회귀시키지 않는다.
- **픽셀 단위 시각 패리티 보장 안 함.** 패리티는 **데이터·동작 패리티**(같은 백엔드 응답에 대해 같은 필드/상태를 노출, 같은 에러 분기, 같은 fail-closed 거동)로 정의한다. 네이티브 디자인이 웹과 픽셀 단위로 동일할 필요는 없다.
- **신규 백엔드 기능/화면 추가 없음.** 현재 웹에 존재하는 기능 화면의 네이티브 재현만 다룬다. placeholder(알림 탭 등)는 현 상태(placeholder)를 그대로 네이티브로 재현한다 — 기능을 새로 만들지 않는다.

---

## EARS Requirements

> 모듈 ≤5. 각 요구사항은 acceptance.md 의 AC 와 1:1 대응. `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 재사용 / `[RETIRE]` 패리티 게이트 후 폐기.

### M1. 네이티브 셸 + 네이티브 인증 (WebView 호스트 → 네이티브 세션 권위)

- **R-N1 (Ubiquitous)** `[MODIFY] apps/mobile/app/`: The app SHALL render every user screen as a native React Native screen via `expo-router`, and SHALL NOT host any `${WEB_URL}/*` route in a `react-native-webview` instance. 각 화면은 공유 `@moyura/api-client`(+ 공유 도메인 패키지)를 직접 호출해 데이터를 얻고 네이티브 컴포넌트로 렌더한다.
- **R-N2 (Event-Driven)** `[MODIFY] apps/mobile/lib/api.ts`: WHEN a native screen issues an authenticated API call, the app SHALL inject the Bearer token from the **native Supabase session** (`@moyura/api-client` `getToken` 공급자가 네이티브 세션 access_token 을 반환) — WebView 쿠키/핸드셰이크 세션이 아니라. 토큰은 Authorization 헤더로만 전달한다(`@moyura/api-client` R-A9 보존).
- **R-N3 (Event-Driven)** `[MODIFY] apps/mobile/app/(auth)/login.tsx`: WHEN an unauthenticated user opens the login screen, the app SHALL present a **native** login screen offering Google OAuth (via existing `lib/auth/oauth.ts` + `lib/auth/google-signin.ts` system-browser/native flow → `supabase-mobile.ts` `signInWithIdToken`) and email sign-in, establishing a native Supabase session — WebView 로그인 페이지를 호스팅하지 않는다.
- **R-N4 (State-Driven)** `[MODIFY] apps/mobile/lib/auth/AuthContext.tsx`: WHILE a native session exists, `AuthContext` SHALL be the single session authority for the app (gating protected screens, exposing access_token to `getToken` and realtime `setAuth`). The WebView token-injection bridge (`session:restore`) SHALL NOT be the session source for native screens.
- **R-N5 (State-Driven)** `[NEW] apps/mobile/app/.../onboarding`: WHILE an authenticated session lacks a display name (`GET /me` `name == null`), the app SHALL natively gate the user to a name-onboarding screen before protected screens (reproducing web `requireNamedSession` behavior via shared logic) and SHALL persist the name via shared `@moyura/api-client` `patchMe`.
- **R-N6 (Unwanted)** `[NEW] apps/mobile`: IF a native screen requires a session and none exists, THEN the app SHALL route to the native login screen and SHALL NOT render protected content, mirroring web auth-guard behavior (no protected data leak pre-auth).

### M2. 모임 목록 + 상세 + 생성 + 탐색 (최다 동선: 목록→상세 렌더 패리티)

- **R-N7 (Event-Driven)** `[NEW] apps/mobile/app/(tabs)/home/index.tsx`: WHEN the home tab is focused, the app SHALL fetch the moim list via shared `@moyura/api-client` `listMoims()` and render each moim natively with behavior parity to `apps/web/app/(main)/home` (same DTO fields surfaced: name, schedule, member context). 빈 목록/로딩/에러 상태도 웹과 동일하게 처리한다.
- **R-N8 (Event-Driven)** `[NEW] apps/mobile/app/(tabs)/home/[id].tsx`: WHEN a moim is opened, the app SHALL fetch detail + members via **shared** moim domain logic (`getMoim`/`getMoimMembers`/`formatMoimSchedule` — M5 공유 추출) and render detail, members section, polls section, and invite affordance natively with behavior parity to web `home/[id]`. 일정 표시는 `formatMoimSchedule`(null → "일정 미정") 거동을 그대로 따른다.
- **R-N9 (Event-Driven)** `[NEW] apps/mobile/app/.../moims/new`: WHEN the user creates a moim, the app SHALL submit via shared `@moyura/api-client` `createMoim()` (name/nickname 필수 + startsAt/location optional) and SHALL surface backend validation errors (400 → ApiError) with the same classification web uses.
- **R-N10 (Event-Driven)** `[NEW] apps/mobile/app/(tabs)/explore.tsx`: WHEN the explore tab is used, the app SHALL provide a native "join by invite link/token" entry point with behavior parity to web `explore` (token 입력 → 초대 수락 흐름 진입, M4 의 초대 수락과 연결).
- **R-N11 (Unwanted)** `[NEW] apps/mobile/app/(tabs)/home/[id].tsx`: IF moim detail fetch fails, THEN the app SHALL classify by status via shared `moimErrorStatus` (403 비멤버 / 404 미존재) and SHALL NOT expose token or error internals — 웹과 동일한 안전 처리(인가 약화 금지).

### M3. 네이티브 실시간 섹션 (member / poll / chat / expense 채널 재구현)

- **R-N12 (Event-Driven)** `[NEW] apps/mobile/.../realtime`: WHEN a moim screen with live data mounts AND a native session access_token exists, the app SHALL subscribe to the corresponding Supabase realtime channel using the **native** `@supabase/supabase-js` client with `realtime.setAuth(access_token)`, reusing the **shared channel descriptors** (topic `moim:{id}`, event names, payload types — M5 공유 추출) so native and web subscribe identically.
- **R-N13 (State-Driven)** `[NEW] apps/mobile/.../realtime`: WHILE subscribed, the app SHALL reimplement member/poll/chat/expense channel handling natively with behavior parity to web hooks (`useMemberChannel`/`usePollChannel`/`useChatChannel`/`useExpenseChannel`): `member_change`(목록 갱신), poll 이벤트(투표 집계 갱신), chat(신규 메시지 append), expense(`expense_change` 정산 갱신).
- **R-N14 (Unwanted)** `[NEW] apps/mobile/.../realtime`: IF no native session access_token is available, THEN the app SHALL NOT open a private realtime channel (RLS 가 거부하므로 무의미 — 웹 훅의 fail-closed `if (!accessToken) return` 거동 동일), and SHALL clean up channels on unmount/dependency change (중복 구독·누수 방지).
- **R-N15 (Event-Driven)** `[NEW] apps/mobile/app/.../moims/[id]/chat`: WHEN the chat screen is used, the app SHALL load keyset history + send messages via **shared** chat domain logic (`loadHistory`/`sendMessage`/`chatErrorMessage` — M5) and render natively with the same error classification (400/401/403) web uses.

### M4. 알림 + 프로필 + 네이티브 푸시 + 초대 수락

- **R-N16 (Event-Driven)** `[NEW] apps/mobile/app/(tabs)/profile.tsx`: WHEN the profile tab is opened, the app SHALL render account info (email from native session, display name from `GET /me`) and SHALL allow name edit via shared `patchMe` and native sign-out — behavior parity to web `profile`. 알림 탭(`notifications`)은 현재 웹의 **placeholder** 상태를 네이티브 placeholder 로 재현한다(기능 신설 안 함 — Non-Goals).
- **R-N17 (Event-Driven)** `[MODIFY] apps/mobile/lib/push/`: WHEN the app registers for push, device registration (`notification-core.ts`/`register-device.ts`, EXISTING) SHALL be wired to the **native session** (Bearer via native `getToken`) instead of the WebView bridge — 푸시 등록은 네이티브 세션을 권위로 한다.
- **R-N18 (Event-Driven)** `[NEW] apps/mobile/app/invite/[token].tsx`: WHEN an invite link is opened, the app SHALL resolve invite validity via **shared** `fetchInviteValidity` (M5) with the same **fail-closed** behavior (only show the join/nickname form when validity is confirmed `valid`; any non-200/transient → invalid 안내) and accept membership via shared accept logic.

### M5. 공유 패키지 추출 (anti-duplication) + WebView 스택 게이트 폐기 + 점진 컷오버

- **R-N19 (Ubiquitous)** `[NEW] packages/` (예: `@moyura/domain`): Platform-agnostic domain logic currently in `apps/web/lib/` SHALL be extracted into shared package(s) so that **both** `apps/web` and `apps/mobile` import the same single-source implementation: moim(`getMoim`/`getMoimMembers`/`moimErrorStatus`/`formatMoimSchedule`), chat(`loadHistory`/`sendMessage`/`chatErrorMessage`), invite(`fetchInviteValidity`/accept/token), expenses/polls/members helpers, and realtime channel descriptors(topic/event/payload types). 추출 코드는 `api: ApiClient` 주입형 순수 TS 로 유지한다(React/Next/RN 비의존).
- **R-N20 (Unwanted)** `[MODIFY] apps/mobile` & `apps/web`: The codebase SHALL NOT contain duplicate (forked) implementations of the extracted domain logic — `apps/mobile` SHALL import it from the shared package, and `apps/web` SHALL be refactored to import the **same** shared module (behavior-preserving — 웹 동작 회귀 0). 동일 함수 본문이 mobile/web 양쪽에 존재해서는 안 된다.
- **R-N21 (Event-Driven)** `[NEW] apps/mobile` (feature flag): WHEN cutover proceeds, each screen group SHALL migrate **screen-by-screen behind a flag** (native vs WebView per route), and a WebView route SHALL be disabled only after its native counterpart passes parity AC — 빅뱅 전환을 하지 않는다.
- **R-N22 (Unwanted)** `[RETIRE] apps/mobile` (WebView stack) & `apps/web/lib/native-bridge/`: IF and only IF all M1–M4 parity ACs pass, THEN the WebView/bridge stack SHALL be decommissioned — mobile: `BridgedWebView.tsx`/`WebViewShell.tsx`/overlays/`useAuthBridge`/`useAppLifecycle`/`auth-bridge-core`/`route-map-core`/`web-url`/`bridge-protocol`/cookie seed·clear, web: `lib/native-bridge/*`(`bridge-client`/`NativeBridgeProvider`/`ShellSessionAnnouncer`/`LogoutBridgeNotifier`) — and `react-native-webview` SHALL be removed from `apps/mobile/package.json`. 폐기는 패리티 게이트를 통과하기 전에는 수행하지 않는다(Non-Goals).

---

## Open Decisions / Risks

| ID | 주제 | 결정/상태 | 영향 |
|----|------|-----------|------|
| **OD-1** | Option B 채택 여부 (대규모 노력 vs 경쟁 SPEC) | **미결 — plan/이해관계자 게이트.** 본 SPEC 은 **가장 큰 노력의 옵션**(11화면 재구축 + 4채널 + 인증 모델 교체 + 공유 추출)이고, `SPEC-WEBVIEW-UNIFY-001`(공유 WebView 유지, 변경폭 작음)과 상호 배타다. 진단 리포트는 "구조적으로 비싸다"까지 입증했으나 "얼마나 비싼지"는 디바이스 측정 미수행(§6). 컷오버 비용 대비 성능 이득의 타당성 검증이 채택 전제. | 잘못된 채택 시 막대한 재작업. **둘 중 하나만** 진행한다. |
| **OD-2** | 공유 추출 패키지 위치 (`@moyura/api-client` 확장 vs 신규 `@moyura/domain`) | **권장: 신규 `packages/domain`(`@moyura/domain`) 신설** — `api-client` 는 thin transport 로 유지(런타임 번들 0 원칙 보존)하고, `api: ApiClient` 를 받는 도메인 헬퍼·에러 분류기·포매터·채널 디스크립터를 `@moyura/domain` 에 모은다. 정확한 패키지명/경계는 구현 시 확정. | api-client 에 도메인 로직을 섞으면 thin transport 원칙이 깨지고 웹 번들 증가 위험. |
| **OD-3** | 실시간 RLS 인가 패리티 (web 쿠키 세션 vs native SecureStore 세션) | **확정 방향: 네이티브 `setAuth(access_token)` 은 네이티브 Supabase 세션 토큰을 주입한다 — 웹 쿠키 세션과 토큰 출처가 다르므로, 동일 RLS private-channel 정책에 대해 네이티브 토큰이 인가되는지 디바이스 검증 필요.** 채널 디스크립터(topic/event/payload)는 공유하되 supabase 클라이언트는 플랫폼별(web `@supabase/ssr` / mobile `@supabase/supabase-js`). | native 토큰이 RLS 에서 거부되면 실시간 전 기능 회귀. 디바이스 게이트 필수. |
| **OD-4** | 공유 추출의 웹 회귀 위험 (테스트 하베스 부재) | **확정: M5 추출은 웹에 대해 행위 보존이어야 한다.** `apps/web` 은 테스트 프레임워크가 없어(빌드/lint 검증) 추출 후 웹 회귀를 자동 falsify 하기 어렵다 — `next build` + typecheck + import 그래프 검사로 1차 게이트, 웹 종단 회귀는 수동/디바이스 게이트. 추출은 함수 본문 이동(re-export)에 한정해 diff 를 최소화한다. | 웹(운영 중 앱)이 추출 과정에서 회귀하면 양 플랫폼 동시 장애. |
| **OD-5** | 인증 모델 교체 범위 (온보딩/named-session 가드) | **확정: 네이티브 세션이 권위가 되면 web `requireNamedSession` 가드(이름 온보딩 강제)를 네이티브로 재현해야 한다(R-N5).** 가드 로직의 판정 규칙(`GET /me` name null → onboarding)은 공유 가능하나, redirect/네비게이션은 네이티브(expo-router). | 가드 누락 시 이름 없는 세션이 보호 화면에 진입 — 웹과 동작 불일치. |
| **OD-6** | 패리티 정의 (데이터·동작 vs 픽셀) | **확정: 데이터·동작 패리티**(같은 백엔드 응답에 같은 필드/상태/에러 분기/fail-closed 거동). 픽셀 패리티 비보장(Non-Goals). 네이티브 디자인 소스는 본 SPEC 범위 밖 — 별도 디자인 작업 필요할 수 있음. | 패리티를 픽셀로 오해하면 범위 폭발. AC 는 동작 기준으로만 판정. |

---

## Sources (출처)

- `.moai/reports/webview-rn-rendering-performance.md` — Option B 근거(§3 [높음 1] 근본 원인, §5 "아키텍처급 별도 SPEC 권장", §6 디바이스 측정 한계). (직접 확인 2026-06-25)
- `packages/api-client/src/index.ts` — 공유 `ApiClient`(`request`/`getHealth`/`getMe`/`patchMe`/`listMoims`/`createMoim`), `getToken` 공급자 주입, `ApiError`. 웹·모바일 공유 transport(재사용, 변경 없음). (코드 직접 확인)
- `packages/api-client/src/schema.d.ts` (`package.json` exports) — 백엔드 OpenAPI 타입(런타임 번들 0). 공유 타입 출처. (구조 확인)
- `apps/web/lib/moim/api.ts`·`chat/api.ts`·`invite/validity.ts` — `api: ApiClient` 주입 순수 도메인 로직 + 에러 분류기 + fail-closed 유효성 + 포매터. **M5 공유 추출 대상**(현재 web-local). (코드 직접 확인)
- `apps/web/lib/moim/useMemberChannel.ts`(+ `usePollChannel`/`useChatChannel`/`useExpenseChannel`) — 채널 토픽 `moim:{id}` + event + payload + `setAuth` 패턴. **채널 디스크립터 공유 + 네이티브 훅 재구현 대상**(M3). web supabase 클라이언트는 `@supabase/ssr`(플랫폼별). (코드 직접 확인)
- `apps/web/app/(main)/home/`·`home/[id]/`(members-section/polls-section/invite-button)·`explore/`·`notifications/`(placeholder)·`profile/`·`login/`·`invite/[token]/`·`moims/new`·`moims/[id]/chat`·`moims/[id]/expenses`·`onboarding/` — 네이티브 재현 대상 화면 인벤토리. (구조·헤더 직접 확인)
- `apps/web/lib/auth/require-named-session.ts` — 이름 온보딩 가드(네이티브 재현 대상, R-N5/OD-5). (구조 확인)
- `apps/mobile/lib/auth/supabase-mobile.ts`·`oauth.ts`·`google-signin.ts`·`AuthContext.tsx`·`token-store.ts` — 네이티브 인증 1차 요소(재사용/역할 확대, M1). `signInWithIdToken` 경계 확인. (코드 직접 확인)
- `apps/mobile/lib/push/notification-core.ts`·`register-device.ts` — 네이티브 푸시(재사용, 세션 배선만 변경, R-N17). (구조 확인)
- `apps/mobile/app/(tabs)/_layout.tsx`·`(auth)/login.tsx`·`(tabs)/home/[id].tsx`·`invite/[token].tsx` — expo-router 구조(네이티브 화면 재구축 위치). (구조 확인)
- `apps/mobile/components/BridgedWebView.tsx`·`WebViewShell.tsx` + `hooks/useAuthBridge.ts`·`useAppLifecycle.ts` + `lib/route-map-core.ts`·`web-url.ts`·`auth/bridge-protocol.ts` & `apps/web/lib/native-bridge/*` — **WebView/브리지 스택**(R-N22 게이트 폐기 대상). (구조 확인)
- `apps/mobile/package.json` — `react-native-webview` 13.16.1(폐기 대상), `@supabase/supabase-js` 2.106.2 + `expo-router` ~56.2.10(네이티브 실시간/내비 보유). (코드 직접 확인)
- **경쟁 SPEC** `SPEC-WEBVIEW-UNIFY-001` — WebView 유지(공유 WebView + 웹 SPA 라우팅) 접근. 본 SPEC 과 상호 배타. (동일 세션에 병렬 작성됨 — ID 참조, OD-1)
