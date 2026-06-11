---
id: SPEC-MOBILE-003
version: 0.1.1
status: draft
created: 2026-06-11
updated: 2026-06-11
created_at: 2026-06-11
updated_at: 2026-06-11
author: hatae
priority: high
issue_number: 0
labels: [mobile, navigation, expo-router, webview, hybrid]
---

# SPEC-MOBILE-003 — expo-router 네비게이션 골격 + 라우트별 WebView 하이브리드 (로그인 후 `/home` 전환)

> **depends-on**: SPEC-WEBVIEW-SHELL-001 (WebViewShell/훅 추출 — seam 제공), SPEC-MOBILE-002 (SecureStore 토큰 + bridge `session:synced/none` 신호 — 네이티브 인증 상태 단일 소스)
> **lifecycle**: spec-anchored (라우트 트리 + 네비게이션 계약은 이후 화면 SPEC들이 참조하는 코어 계약)
> `issue_number: 0` — GitHub Issue 생성은 로컬 전용 git 정책에 따라 생략(0 = no-issue 표기).

## HISTORY

- 2026-06-11 (v0.1.1): plan-audit review-2(PASS 0.90)의 비차단 권고 중 2건 정리. **D10**: R-WB4 의 If 조건에 셸 모드 스코핑을 명시("If shell-mode determination is unresolved before content hydration ... NOT a desktop browser")하여 데스크톱 브라우저(마커 자연 부재)에서 웹 탭바가 숨겨지는 literal 오독 가능성 제거(AC-5(a) 데스크톱 탭바 표시와 일관). spec-compact.md 동기화. **D12**: acceptance.md 추적 매트릭스의 R-AS2→AC-2 인용과 AC-2 헤더 불일치 해소 — AC-2 헤더에 R-AS2 추가(본문 L19 의 session 신호→isSignedIn 전이 단언이 이미 실질 커버). D11(OD-1 확정 시 R-NC1 동반 개정)·D13(created/created_at 중복)은 의도적으로 보류(D11=런 진입 OD 결정, D13=감사 스키마 호환 유지).
- 2026-06-11 (v0.1.0): 최초 작성 (draft). 사전 조사 `research.md`(§1·6·8 사용자 align 2라운드 반영) 기반. **메이저 아키텍처 확정(초기 "네이티브 RN /home"에서 피벗)**: 모바일은 expo-router(SDK 56)로 **네이티브 네비게이션 골격(Tabs/Stack)**만 만들고, 각 라우트의 **화면 콘텐츠는 대응 웹 페이지를 WebView로 렌더링**한다. 웹(`apps/web`)과 앱은 **동일 라우트 트리**(`/home`,`/explore`,`/notifications`,`/profile`)를 공유하며 URL↔네이티브-라우트 1:1 매핑이 네비게이션 계약이다. 화면 UI는 **웹 측(Next.js 16 + Tailwind v4 + lucide-react)** 에 신설하는 `(main)` 라우트 그룹으로 구현(Figma Make 코드와 스택 호환). 모바일 네이티브 구현 대상은 **네비게이션 크롬(Figma BottomTabBar 의 RN 재해석 탭바)뿐**. 모바일의 모든 화면 전환(탭/push/back/로그인 후)은 expo-router 가 담당하며 WebView 의 교차 라우트 자체 이동은 금지(기존 `decideWebViewLoad` 인터셉트 자산 확장으로 차단 후 네이티브 디스패치). 로그인/회원가입은 기존 WebView 흐름을 `(auth)/login` 라우트로 보존. 로그인 완료 후 bridge `session:synced` → `router.replace("/(tabs)/home")`; 웹 단독 사용자는 `redirect("/home")`(`actions.ts` 3곳 + mobile `oauth-bridge` `DEFAULT_NEXT` + 관련 테스트 변경). `/me` 페이지 자체는 유지. **단일 SPEC(M1~M5)**. MeetupDetail 은 본 SPEC 제외 — 네비게이션 계약을 따르는 후속 SPEC(SPEC-MOBILE-004 후보)로 명시. 본 SPEC 의 expo-router 토대를 지금 만드는 이유는 라우트별 WebView 래퍼가 **향후 화면 단위로 WebView→RN UI 독립 교체**를 가능케 하기 때문(네비게이션 골격 불변).

---

## Background (배경)

`moyura` 모노레포는 웹(`apps/web`, Next.js 16.2.6 App Router)을 단일 UI surface 로 삼고, 모바일 앱(`apps/mobile`, Expo ~56.0.6 / RN 0.85.3 / React 19.2.3)이 그 웹을 풀스크린 WebView 로 호스팅한다.

선행 SPEC 이 만든 현 상태 (live source-of-truth):
- `apps/mobile/index.ts:1,12` — `"main": "index.ts"`(package.json:4) → `registerRootComponent(App)`. `index.ts:5` `import './lib/env'` 가 env 가드 side-effect(R-E4 미설정 throw)를 첫 렌더 전에 실행.
- `apps/mobile/App.tsx` (1-192) — 단일 화면 셸 오케스트레이션: `SplashScreen.preventAutoHideAsync`(:35)/`hideAsync`(:82,108,169,174), 콜드스타트 토큰 핸드셰이크(`useAppLifecycle`), OAuth 인터셉트+토큰 동기화(`useAuthBridge`), `WebViewShell` 합성.
- `apps/mobile/components/WebViewShell.tsx` — source URL prop + 이벤트 핸들러 prop 을 받는 재사용 가능 WebView(SPEC-WEBVIEW-SHELL-001 추출). `LoadingOverlay`/`WebViewErrorOverlay` 오버레이.
- `apps/mobile/hooks/useAppLifecycle.ts:77-90` + `app-lifecycle-core.ts:19` — Android 하드웨어 백을 `decideBackPress(canGoBack)` 로 분기(`"goBack"` = `webView.goBack()` / `"exit"` = 기본 종료). 현재는 **WebView 네비게이션 히스토리**에 위임.
- `apps/mobile/hooks/useAuthBridge.ts:136-138` + `auth-bridge-core.ts:187` `decideWebViewLoad(url, ctx)` — `onShouldStartLoadWithRequest` 의 3분기 결정(`"trusted-load"`/`"oauth-intercept"`/`"deny"`, R-T9 WebView origin 잠금). 신뢰 origin in-WebView 로드 허용, OAuth authorize→system-browser 인터셉트, 비신뢰 거부.
- `apps/mobile/lib/auth/token-store.ts` / `bridge-protocol.ts` — SecureStore 토큰 캐시 + 버전드 메시지 스키마 v1(`session:restore/synced/none/cleared`, `resume:revalidate`).
- `apps/mobile/lib/auth/oauth-bridge.ts:29` — `const DEFAULT_NEXT = "/me"`; `buildWebCallbackUrl(..., next=DEFAULT_NEXT)`.
- `apps/mobile/package.json` — `react-native-webview` 13.16.1, `expo-secure-store`, `expo-splash-screen`, `expo-web-browser`, `expo-linking`. **`expo-router`/`react-native-safe-area-context`/`react-native-screens` 누락.**
- `apps/mobile/app.json:7` — `scheme: "moyura"`; `:27` `plugins` 배열 존재.

웹 측 (live source-of-truth):
- `apps/web/app/` — `auth/`, `login/`, `me/`, `layout.tsx`, `page.tsx`, `globals.css`. **`(main)` 라우트 그룹·공유 BottomTabBar 없음.**
- `apps/web/lib/auth/actions.ts:46,65` — 이메일 로그인/가입 완료 `redirect("/me")`; `:89` OAuth `redirectTo: ${CALLBACK_URL}?next=/me`.
- `apps/web/app/me/page.tsx` — 현 post-login 랜딩(세션 없으면 `/login`).
- `apps/web/package.json` — `lucide-react ^1.17.0`, `tailwindcss ^4`, `@tailwindcss/postcss ^4`(Figma Make 코드 스택과 호환).
- `apps/web/lib/native-bridge/` — `NativeBridgeProvider.tsx` 등(SPEC-MOBILE-002). `window.ReactNativeWebView` 컨텍스트 신호 자산.

현재의 한계 (이 SPEC 이 해소): (a) 모바일이 단일 화면이라 화면 전환·탭 네비게이션 개념이 없다. (b) 로그인 후 목적지가 WebView `/me` 에 고정되어 있어 네이티브 네비게이션 골격을 통해 화면을 전환할 수 없다. (c) 화면을 향후 WebView→RN 으로 단위 교체할 seam 이 없다. 본 SPEC 은 expo-router 골격 + 라우트별 WebView 래퍼 + 동일 라우트 트리 계약으로 이 세 한계의 토대를 만든다.

---

## Goal (목표)

`apps/mobile` 에 expo-router(SDK 56 호환) 네비게이션 골격(Root Stack + `(auth)`/`(tabs)` 그룹 + 네이티브 Tabs)을 도입하고, 각 탭 라우트가 대응 웹 페이지(`${WEB_URL}/home` 등)를 호스팅하는 얇은 WebView 래퍼가 되게 한다. `App.tsx` 의 스플래시/브리지/콜드스타트 핸드셰이크 오케스트레이션을 `app/_layout.tsx` 로 **행위 보존 이전**하고, SecureStore + bridge 신호 기반 네이티브 `AuthContext` + `Stack.Protected`/`Tabs.Protected` 가드를 추가한다. 모바일의 모든 화면 전환은 expo-router 가 담당하며, WebView 의 교차 라우트 이동은 `decideWebViewLoad` 확장으로 차단 후 네이티브 라우트로 디스패치한다(인증 플로우 내부 기존 허용 규칙만 예외). 웹(`apps/web`)에 `(main)` 라우트 그룹(공유 BottomTabBar + `/home` Figma HomeTab + 플레이스홀더 3개)을 신설하되, 셸 모드(모바일 WebView 내부)에서는 웹 탭바를 숨겨 이중 탭바를 방지한다. 로그인 완료 후 네이티브는 `router.replace("/(tabs)/home")`, 웹 단독 사용자는 `redirect("/home")` 로 전환하고 `/me` 페이지 자체는 유지한다.

---

## Exclusions (What NOT to Build) — 제외

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **MeetupDetail 화면 제외 — 후속 SPEC 으로 명시.** 모임 카드 탭 시 상세 화면은 본 SPEC 범위 밖이다. 후속 SPEC(예: **SPEC-MOBILE-004**)가 **본 SPEC 의 네비게이션 계약을 그대로 따라** 구현한다 — 모바일은 `(tabs)/home/[id]` 같은 네이티브 push 라우트가 대응 웹 상세 페이지(`${WEB_URL}/home/[id]`)를 WebView 로 호스팅(또는 그 시점에 RN UI 로 단위 교체)하는 방식. M4 의 HomeTab 모임 카드는 본 SPEC 에서 비탭(또는 시각적 표시만) 처리하고 상세 네비게이션은 만들지 않는다.
- **실제 모임 데이터/API 연동 없음.** `/home` 의 인사말/CTA/필터 칩/모임 카드/빈 상태는 **mock 데이터**(Figma 기준)로 구현한다. NestJS 신규 백엔드 호출(`/me` 외)이나 모임 도메인 모델·DB 스키마는 만들지 않는다.
- **explore/notifications/profile 기능 구현 없음.** 웹 `(main)/explore|notifications|profile/page.tsx` 는 **플레이스홀더(이모지+타이틀+설명)** 만. 알림 배지는 mock 카운트(실데이터 아님). 네이티브 탭의 notifications 배지도 mock.
- **웹 `/me` 페이지 제거/변경 금지.** `apps/web/app/me/page.tsx` 는 유지한다. 변경 범위는 post-login **리다이렉트 목적지**(`actions.ts:46,65,89`)와 mobile `oauth-bridge` `DEFAULT_NEXT` + 관련 테스트뿐.
- **`/home` 을 WebView 로 구현 금지(웹 측).** `/home` 화면 UI 는 Next.js 페이지로 구현한다 — 단, 이는 "웹 페이지를 만든다"는 의미이고, **모바일 측**에서 `(tabs)/home.tsx` 가 그 웹 페이지를 WebView 로 호스팅하는 것은 본 아키텍처의 의도(래퍼)다. Figma Make 코드는 React 웹(Tailwind/lucide-react)이므로 **그대로 RN 으로 이식하지 않고 웹 Next.js 페이지로 적응**한다.
- **WebView 의 교차 라우트 자체 네비게이션 금지.** 셸 모드 WebView 는 화면당 1개 콘텐츠 렌더러일 뿐, 다른 라우트 URL 로 스스로 이동하지 않는다(차단→네이티브 디스패치). 인증 플로우 내부의 기존 허용 규칙(SPEC-MOBILE-001/002)만 예외로 보존.
- **이중 탭바 금지.** 셸 모드에서 웹 BottomTabBar 는 숨긴다(네이티브 탭바만 표시).
- **디자인 토큰 파이프라인 없음.** Figma 토큰(색/타이포/radius)은 웹 `globals.css`(Tailwind v4 테마) + 네이티브 탭바 RN 상수로 **수동 추출**한다. 빌드 파이프라인/토큰 생성 도구는 도입하지 않는다.
- **세션 권위 구조 변경 없음.** 세션 권위(검증/갱신)는 웹(`@supabase/ssr`)이 유지하고 네이티브는 토큰 캐시일 뿐(SPEC-MOBILE-002 불변). 본 SPEC 은 라우팅 골격만 추가한다.
- **prod URL/HTTPS/앱스토어 배포 없음.** 로컬/dev 우선(MOBILE-001/002 일관). `EXPO_PUBLIC_WEB_URL`/`WEB_URL` env 기반 유지(하드코딩 금지).
- **deprecated expo-router API 사용 금지.** `@react-navigation/*` 직접 import, `expo-router/babel` 플러그인, `useRootNavigation()` 미사용(SDK 56 — research §5).

---

## EARS Requirements

> 요구사항 ID prefix(관심사 기반): **R-RT**(router foundation), **R-AS**(auth-state + guards), **R-NC**(navigation contract), **R-WB**(web (main) UI + shell-mode), **R-PR**(preservation/regression).
> 패턴 표기: [U]biquitous / [E]vent-driven / [S]tate-driven / [Un]wanted / [O]ptional. 델타: [NEW]/[MODIFY]/[REMOVE]/[PRESERVE].

### M1 — expo-router 파운데이션 (엔트리 + 라우트 트리 + 행위 보존 이전)

- **R-RT1** [U][NEW]: The mobile app **shall** use `expo-router` SDK 56-compatible APIs only — `"main": "expo-router/entry"` (or a custom entry re-exporting it), and **shall not** use the `expo-router/babel` plugin, **shall not** import from `@react-navigation/*` directly, and **shall not** call `useRootNavigation()`. (research §5)
- **R-RT2** [U][NEW]: The mobile app **shall** add the expo-router navigation dependencies resolved to SDK 56-compatible versions (no manual version pins), scoped to `apps/mobile`: `expo-router`, `react-native-safe-area-context`, `react-native-screens`, `expo-constants`. (설치 메커니즘 `npx expo install` 은 plan.md 단계 E 참조. research §5, §7.6/7.7)
- **R-RT3** [E][MODIFY]: **When** the app cold-starts, the root `app/_layout.tsx` **shall** perform the splash/bridge/cold-start-token-handshake orchestration currently in `App.tsx` (`SplashScreen.preventAutoHideAsync`/`hideAsync`, nonce, `loadTokens` handshake, `useAppLifecycle`/`useAuthBridge` 합성) with no behavioral change. (App.tsx:35,82,108,169,174 보존)
- **R-RT4** [U][MODIFY]: The entry-point env-guard side effect (`import './lib/env'`, R-E4 throw on missing `EXPO_PUBLIC_*`) **shall** be preserved and executed before the first render after the entry switch. (index.ts:5)
- **R-RT5** [U][REMOVE]: After migration, the app **shall not** retain a top-level `App.tsx` default-export render path that bypasses the router; the `app/` tree **shall** be the single render entry. (Ubiquitous 부정 불변 — research §7.1 단방향 이전)
- **R-RT6** [O][NEW]: **Where** the SDK 56 typecheck/build is not broken, the app **shall** enable `app.json` `experiments.typedRoutes: true`. (research §5 권장)

### M2 — 네이티브 인증 상태 소스 + 라우트 가드

- **R-AS1** [U][NEW]: The app **shall** expose a native `AuthContext` whose `isSignedIn` state derives solely from SecureStore tokens (`loadTokens`) and bridge signals `session:synced`/`session:none`/`session:cleared`. (SPEC-MOBILE-002 자산 재사용)
- **R-AS2** [E][NEW]: **When** the bridge emits `session:synced`, the `AuthContext` **shall** set `isSignedIn = true`; **when** it emits `session:none` or `session:cleared` (or tokens are cleared), the `AuthContext` **shall** set `isSignedIn = false`.
- **R-AS3** [S][NEW]: **While** `isSignedIn` is false, the router **shall** guard the `(tabs)` group (redirect/Protected → `(auth)/login`); **while** `isSignedIn` is true, the router **shall** guard the `(auth)` group (redirect/Protected → `(tabs)/home`). Guards **shall** use `Stack.Protected`/`Tabs.Protected` (SDK 56 표준), not `@react-navigation` APIs.
- **R-AS4** [U][NEW]: The signed-in decision logic **shall** be extracted into a pure `-core.ts` module (`auth-state-core.ts`) testable under vitest node-env with zero expo/RN imports. (research §7.5)
- **R-AS5** [U][NEW]: The router **shall not** read the web `/me` page session state as the native auth source; native routing decisions **shall** be derived from bridge/SecureStore only. (Ubiquitous 부정 불변 — research §7.2)

### M3 — 네비게이션 계약 (라우트 매핑 + 인터셉트→네이티브 디스패치 + Android back 일원화)

- **R-NC1** [U][NEW]: The web and mobile **shall** share an identical route tree (`/home`, `/explore`, `/notifications`, `/profile`) where each mobile native route ↔ web URL maps 1:1; a pure `route-map-core.ts` module **shall** define this mapping (URL ↔ native route) and be vitest-testable. (research §8 #2)
- **R-NC2** [E][MODIFY]: **When** a tab WebView attempts a cross-route URL load (a trusted-origin URL whose path maps to a different app route), the extended `decideWebViewLoad` logic **shall** deny the in-WebView load and return a native-route dispatch decision so expo-router performs the navigation. (extend `auth-bridge-core.ts:187`)
- **R-NC3** [U][NEW]: A tab WebView **shall not** perform cross-route navigation itself; only auth-flow-internal load rules from SPEC-MOBILE-001/002 (OAuth authorize→system-browser intercept, trusted in-flow loads) **shall** remain permitted. (Ubiquitous 부정 불변 — research §8 #3)
- **R-NC4** [E][MODIFY]: **When** the Android hardware back is pressed inside a `(tabs)` route, the app **shall** route the back action through expo-router native navigation (not WebView history); the `useAppLifecycle` WebView-history back delegation (`decideBackPress`, `useAppLifecycle.ts:77-90`) **shall** be modified so `(tabs)` back is native-first. Auth-flow `(auth)/login` WebView back behavior from SPEC-MOBILE-001 **shall** be preserved. (research §8 신규 기술 고려)
- **R-NC5** [E][MODIFY]: **When** login completes (bridge `session:synced` after the WebView auth flow), the app **shall** `router.replace("/(tabs)/home")` (native dispatch) instead of leaving the user on a WebView `/me` load, and **shall not** hardcode `/me` as a native navigation target. (mobile `oauth-bridge` `DEFAULT_NEXT` 변경)

### M4 — 웹 `(main)` 라우트 그룹 UI + 셸 모드 크롬 + 네이티브 탭바

- **R-WB1** [U][NEW]: The web app **shall** add a `(main)` route group (`apps/web/app/(main)/`) with a shared `layout.tsx` (BottomTabBar + auth guard) and pages `home`, `explore`, `notifications`, `profile`, implemented with Next.js 16 App Router + Tailwind v4 + lucide-react (Figma Make 코드 적응, not verbatim RN port). (research §6 구현 매핑)
- **R-WB2** [U][NEW]: The web `/home` page **shall** render the Figma HomeTab: time-of-day greeting header + avatar, create-meetup CTA card, filter chips (전체/예정/완료), meetup card list (emoji cover, date/place/count, status badge) with mock data, and an empty state. explore/notifications/profile **shall** render a placeholder (emoji + title + description) only. (research §6)
- **R-WB3** [S][NEW]: **While** the web page runs inside the native WebView (shell mode), the web **shall** hide its BottomTabBar so only the native tab bar is shown.
- **R-WB4** [Un][NEW]: **If** shell-mode determination is unresolved before content hydration (i.e. inside the native WebView but the shell marker has not yet arrived — NOT a desktop browser where shell mode is definitively absent), **then** the web **shall** default to hiding its BottomTabBar (fail-safe) so that no double tab bar or hydration flash of the web tab bar occurs; the shell marker **shall** be made available before content hydration (e.g. `injectedJavaScriptBeforeContentLoaded` marker or `window.ReactNativeWebView` detection pre-hydration). (research §8 신규 기술 고려)
- **R-WB5** [U][NEW]: The mobile native `(tabs)/_layout.tsx` **shall** implement an expo-router `Tabs` bar styled per the Figma BottomTabBar (RN reinterpretation using `react-native-safe-area-context` + RN-compatible icons), with a notifications tab badge (mock count); each tab screen (`home`/`explore`/`notifications`/`profile`) **shall** be a thin WebView wrapper hosting `${WEB_URL}/<route>`.

### M5 — 보존 / 회귀 + post-login 목적지 전환 종단

- **R-PR1** [U][PRESERVE]: The existing `apps/mobile/lib/auth/` and `apps/mobile/hooks/` vitest suites (bridge-protocol, nonce-core, token-store-core, auth-bridge-core, app-lifecycle-core including security suites) **shall** continue to pass (89/89 baseline 이상 유지) after the `decideWebViewLoad`/`decideBackPress` extensions.
- **R-PR2** [S][PRESERVE]: **While** a user performs email/password login inside the `(auth)/login` WebView, the existing in-WebView flow (no native interception of email login) **shall** be preserved.
- **R-PR3** [E][MODIFY]: **When** login completes for a web-only (desktop browser) user, the web **shall** `redirect("/home")` instead of `redirect("/me")`; the three redirect sites (`actions.ts:46,65` and OAuth `?next=` at `:89`) and the mobile `oauth-bridge` `DEFAULT_NEXT` (`oauth-bridge.ts:29`) and their affected tests **shall** be updated consistently to `/home`.
- **R-PR4** [U][PRESERVE]: The OAuth deep link (`moyura://auth-callback`) **shall** coexist with expo-router auto deep-link routing without conflict; the callback path **shall not** be captured as an app route file. (research §7.4)
- **R-PR5** [E][PRESERVE]: **When** logout occurs (`session:cleared`, incl. SPEC-MOBILE-002 R-R4 cookie-clear), the app **shall** clear to the `(auth)/login` route via native navigation; the Google system-browser OAuth bridge behavior (intercept → system browser → deep-link return) **shall** be preserved.

---

## Delta Markers (브라운필드 변경 요약)

| 마커 | 대상 | 요구 |
|---|---|---|
| [NEW] | `apps/mobile/app/` 트리(`_layout.tsx`, `index.tsx`, `(auth)/_layout.tsx`+`login.tsx`, `(tabs)/_layout.tsx`+`home/explore/notifications/profile.tsx`, `+not-found.tsx`), `AuthContext`, `auth-state-core.ts`, `route-map-core.ts`; `apps/web/app/(main)/`(layout + 4 pages) + 공유 BottomTabBar + shell-mode 감지 | R-RT*(NEW), R-AS1/3/4, R-NC1, R-WB* |
| [MODIFY] | `apps/mobile/package.json`(main + deps), `app.json`(experiments), `App.tsx`→`_layout.tsx` 로직 이전, `auth-bridge-core.ts` `decideWebViewLoad`(교차 라우트 차단), `app-lifecycle-core.ts`/`useAppLifecycle.ts` back 일원화, `oauth-bridge.ts:29` `DEFAULT_NEXT`, `apps/web/lib/auth/actions.ts:46,65,89`, 관련 테스트(`oauth-bridge.test.ts`/`auth-bridge-core.*test.ts`) | R-RT2/3/4, R-NC2/4/5, R-PR3 |
| [REMOVE] | `App.tsx` 라우터 우회 default-export 렌더 경로(엔트리 전환 후) | R-RT5 |
| [PRESERVE] | bridge/nonce/token-store/auth-bridge/app-lifecycle 테스트, 이메일 로그인 WebView 흐름, OAuth 시스템 브라우저 브리지, `moyura://` 딥링크, `scheme: "moyura"`, 웹 `/me` 페이지 | R-PR1/2/4/5, Exclusions |

---

## Open Decision Points (런 단계 진입 전 확인)

- **OD-1 (route-map 구현 위치)**: URL↔라우트 매핑 + 교차 라우트 판별을 `apps/mobile/hooks/auth-bridge-core.ts` 내 `decideWebViewLoad` 확장에 둘지(권장 — 기존 자산 재사용, R-T9 잠금 로직과 동일 모듈), 별도 `route-map-core.ts` 신규 모듈로 분리할지. 권장: 매핑 데이터는 `route-map-core.ts`(순수), 결정 통합은 `decideWebViewLoad` 확장.
- **OD-2 (Android back 일원화 범위)**: `(tabs)` 라우트는 네이티브 back, `(auth)/login` WebView 는 기존 WebView-history back 보존 — 이 분기를 `decideBackPress` 시그니처 확장(라우트 컨텍스트 인자 추가)으로 할지, 라우트별 훅 사용 분리로 할지. 권장: 컨텍스트 인자 추가(순수성 유지).
- **OD-3 (셸 모드 감지 메커니즘)**: 웹 탭바 숨김 신호를 `injectedJavaScriptBeforeContentLoaded` 마커(권장 — 하이드레이션 전 보장)로 할지, 기존 `window.ReactNativeWebView` 존재 감지로 할지. flash 방지 검증은 디바이스 게이트.
- **OD-4 (탭 WebView 인스턴스 수명)**: 4개 탭 WebView 를 lazy 마운트(권장 — 메모리)할지 eager 유지할지. 쿠키 공유는 기존 `sharedCookiesEnabled` 자산 재사용.

---

## Definition of Done (요약)

- 자동 게이트: `nx test mobile`(vitest, 89/89 baseline 이상 + 신규 `auth-state-core`/`route-map-core`/확장 `decideWebViewLoad`/`decideBackPress` 테스트) 통과, `tsc --noEmit`(mobile/web) 0 에러, `next build`(web) 통과, `expo export` 번들 OK.
- 정적 검사: `(tabs)/*.tsx` 가 WebView 래퍼임(웹 페이지 호스팅), 웹 `(main)` 페이지에 `react-native-webview` import 0, deprecated expo-router API(`@react-navigation/*`/`expo-router/babel`/`useRootNavigation`) 0.
- **디바이스 검증 게이트(메모리 `mobile-spec-device-gated` 일관)**: 실기기/에뮬레이터에서 로그인→`/(tabs)/home` 전환, 탭 전환=네이티브, 교차 라우트 차단→네이티브 디스패치, Android 네이티브 back, 셸 모드 웹 탭바 미표시(flash 없음), `moyura://` 딥링크 공존 종단 검증 완료 전까지 **status `in-progress` 유지**.

---

## Sources

- `.moai/specs/SPEC-MOBILE-003/research.md` (§1·5·6·8 — 확정 아키텍처, expo-router SDK 56 검증, Figma 구조)
- live source: `apps/mobile/{index.ts,App.tsx,package.json,app.json}`, `apps/mobile/hooks/{useAppLifecycle.ts,app-lifecycle-core.ts,useAuthBridge.ts,auth-bridge-core.ts}`, `apps/mobile/lib/auth/{oauth-bridge.ts,token-store.ts,bridge-protocol.ts}`, `apps/web/lib/auth/actions.ts`, `apps/web/app/me/page.tsx`, `apps/web/package.json`
- depends-on: `.moai/specs/SPEC-WEBVIEW-SHELL-001/spec.md`, `.moai/specs/SPEC-MOBILE-002/spec.md`
