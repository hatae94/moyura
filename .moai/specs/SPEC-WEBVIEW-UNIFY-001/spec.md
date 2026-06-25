---
id: SPEC-WEBVIEW-UNIFY-001
version: 0.1.0
status: draft
created: 2026-06-25
updated: 2026-06-25
author: hatae
priority: high
issue_number: null
---

# SPEC-WEBVIEW-UNIFY-001 — 공유 단일 WebView + 웹 SPA 라우팅 일원화

## HISTORY

- 2026-06-25 (v0.1.0): 최초 작성 (draft). **근거 리포트: `.moai/reports/webview-rn-rendering-performance.md` [높음 1]** — "화면별 독립 WebView → 매 진입 풀 로드 + hydration 반복"이 체감 지연의 #1 레버로 진단됐고, 그 리포트가 직접 지목한 아키텍처 방향("멀티 WebView → 공유 WebView + 웹 SPA 라우팅 전환")을 구현 가능한 SPEC 으로 옮긴다. **depends-on / supersedes-behavior: SPEC-WEBVIEW-SHELL-001 (in-progress), SPEC-MOBILE-003 (네비게이션 계약), SPEC-MOIM-003 (detail push)** — SHELL-001 이 추출한 `WebViewShell`/`BridgedWebView`/훅을 재사용하되, "화면마다 `BridgedWebView` 인스턴스를 마운트"하는 호스팅 모델(SHELL-001 OD-1 의 "화면별 인스턴스 전제")을 **단일 공유 인스턴스**로 전환한다. 이 SPEC 은 순수 행위 보존이 아니다 — 호스팅/네비게이션 모델이 바뀌므로 **back 거동·탭 전환 메커니즘이 의도적으로 변경**된다(렌더링 비용 회귀 0 이 목표, 사용자 흐름 회귀 0 이 제약).
  - **[경쟁안 분리]**: 이 SPEC 은 **웹 UI 를 그대로 재사용**한다(호스팅/네비게이션 모델만 네이티브에서 교체). UI 를 네이티브로 다시 쓰는 대안은 **별도 경쟁 SPEC `SPEC-MOBILE-NATIVE-UI-001`** 이며 이 SPEC 의 비목표다 — 두 접근을 한 SPEC 에 섞지 않는다. Option A(이 SPEC) = "웹 SPA 를 단일 WebView 로 일원화", Option B(`SPEC-MOBILE-NATIVE-UI-001`) = "화면을 네이티브 RN 으로 재구현".
  - **device-gated**: WebView 비리마운트·탭/back 거동·OAuth 왕복·푸시 탭 라우팅은 정적/계측 게이트로 구조만 검증하고, 실제 거동은 iOS 시뮬레이터/실기기 종단 검증 전까지 미확정이다(moyura WebView SPEC 관행 — SHELL-001 AC-S3 동일). status 는 자동 게이트 통과 후 in-progress, 디바이스 종단 검증 통과 시 completed.

---

## Background (배경)

`moyura` 모노레포는 웹(`apps/web`, Next.js 16 App Router)을 UI surface 로 삼고, 모바일 앱(`apps/mobile`, Expo ~56 / RN 0.85.3 / react-native-webview 13.16.1 / expo-router)이 그 웹을 WebView 로 호스팅하는 하이브리드 셸이다.

**현 상태 (live source-of-truth — 코드 직접 확인 2026-06-25):**
- 각 expo-router 화면이 **자기 `<WebView>` 인스턴스**를 마운트한다. `BridgedWebView.tsx:269-271`(`TabWebView`)이 탭별로, `home/[id].tsx:28`(`HomeDetail`)이 상세별로 각각 `BridgedWebView` 를 마운트하고, 그 안의 `WebViewShell.tsx:105`(`<WebView source={{ uri }}/>`)가 `${WEB_URL}/{route}` 를 **풀 페이지로 GET 로드**한다(`route-map-core.ts:78` `urlForRoute`, `:146` `urlForDetailRoute`).
- 탭은 `lazy:true`(`(tabs)/_layout.tsx:44`)로 첫 포커스에 마운트되고 expo-router 가 keep-mounted → 재방문은 완화되지만, **목록→상세(`router.push` → 새 `BridgedWebView`)** 는 매번 새 WebView 컨텍스트를 생성한다(`BridgedWebView.tsx:122-127` `onDetailPush`).
- 결과(리포트 [높음 1]): 가장 빈번한 동선인 목록→상세마다 **WebView 컨텍스트 생성 → HTTP GET → 번들 파싱 → React hydration** 전체가 반복된다. 웹은 이미 SPA soft-nav(`next/link`+`usePathname`)를 지원해 브라우저 단독이면 전환이 ~600ms 로 끝나지만(리포트 §2), **멀티 WebView 모델이 이 SPA 이점을 무력화**한다.
- 네이티브 탭바: `(tabs)/_layout.tsx` 의 expo-router `Tabs` 가 4개 탭을 네이티브 탭바로 렌더한다. 웹의 `BottomTabBar`(`(main)/_components/BottomTabBar.tsx`)는 셸 모드(`window.__MOYURA_NATIVE_SHELL__===true`)에서 `html[data-shell="native"]` CSS 로 **숨겨진다**(`(main)/layout.tsx:25`) — 이중 탭바를 이미 회피 중.
- 인증/세션: 콜드스타트 토큰 로드·`session:restore` 주입·핸드셰이크 8s 타임아웃이 **화면(`BridgedWebView`)마다** 동작한다(`BridgedWebView.tsx:182-208`, `useAppLifecycle.ts:62`). OAuth 는 네이티브 Google Sign-In 인터셉트(`useAuthBridge.ts:221-227`), 무효 초대는 `invite:invalid` Alert(`BridgedWebView.tsx:134-145`), 푸시 탭은 `?target=chat`→`buildChatUrl`(`home/[id].tsx:23-27`)로 라우팅된다.

**현재의 한계 (이 SPEC 이 해소하는 것):** 화면별 WebView 인스턴스가 곧 화면별 풀 부팅이다. 웹이 제공하는 빠른 SPA soft-nav 를 단일 장수명 WebView 안에서 쓰면, 탭/상세 전환이 hard load 가 아니라 in-WebView SPA 네비게이션이 되어 WebView 콜드 부팅 비용의 반복을 제거한다. 단, 단일 인스턴스로 일원화하면 **세션 연속성(OD-1)·네이티브 탭↔웹 라우트 동기화·back 거동·콜드스타트 핸드셰이크**의 소유 모델이 전부 화면당에서 앱당으로 바뀌므로, 그 전환을 정확히 정의해야 한다.

---

## Goal (목표)

화면별 `<WebView>` 인스턴스를 **셸 레벨에 1회 마운트되어 앱 세션 동안 지속되는 단일 공유 WebView** 로 일원화한다. 탭/상세 전환은 새 WebView 마운트가 아니라 그 단일 WebView 안의 **웹 SPA soft-nav**(웹이 이미 지원하는 `next/link`/`router.push`)로 수행되며, 네이티브 탭바가 그 단일 WebView 의 웹 라우트를 구동한다. 콜드스타트 인증 핸드셰이크는 단일 WebView 에서 **1회만** 실행되고, 공유 WebView 에 캐시/하드웨어 가속 perf 프롭을 적용한다. 웹의 UI/페이지는 **그대로 재사용**하며, 웹에는 브리지 구동 네비게이션 진입점 정도의 **최소 추가**만 허용한다. OD-1 세션 연속성(쿠키/PKCE)·OAuth/초대/푸시 라우팅은 단일 WebView 를 통해 보존한다.

---

## Non-Goals (제외 — What NOT to Build)

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **웹 UI 의 네이티브 재구현 없음.** 이 SPEC 은 웹 화면을 네이티브 RN 화면으로 다시 쓰지 않는다. 웹(`apps/web`)의 페이지·컴포넌트·스타일은 **그대로 재사용**한다. UI 네이티브 전환은 경쟁 SPEC **`SPEC-MOBILE-NATIVE-UI-001`** 의 범위다 — 두 접근을 섞지 않는다.
- **웹 UI/페이지 재작성 없음.** 웹에는 "브리지 구동 네비게이션 진입점"(네이티브→웹 navigate 명령 수신 + 웹 pathname→네이티브 보고)과 같은 **최소 추가**만 허용한다. 기존 페이지·라우트 트리·디자인은 변경하지 않는다. 셸 모드 탭바 숨김(`html[data-shell="native"]`) 계약은 그대로 보존한다.
- **per-탭 독립 히스토리 스택 시뮬레이션 없음.** 단일 WebView 는 단일 웹 히스토리를 가진다. 탭마다 독립 네이티브 스택을 흉내내는 멀티-히스토리 모델은 이 SPEC 의 비목표다(OD-3 에서 단일 공유 히스토리로 확정).
- **bridge-protocol v1 세션 메시지 의미 변경 없음.** `session:synced/none/cleared`·`google-signin`·`invite:invalid` 의 봉투/nonce 인증/의미는 변경하지 않는다(`bridge-protocol.ts`). 네비게이션 채널은 기존 보안 불변식(nonce·신뢰 origin)을 **재사용**하는 별도 메시지로 추가하되, 인증 메시지 타입을 건드리지 않는다.
- **OAuth/세션/푸시 백엔드 변경 없음.** 네이티브 Google Sign-In SDK 흐름(`useAuthBridge` `runNativeGoogleSignIn`), Supabase 세션, FCM 등록/해제, 백엔드 가드는 변경하지 않는다 — 이 SPEC 은 단일 WebView 가 그 흐름을 **통과시키도록** 보존만 한다.
- **새 의존성 없음.** `react-native-webview` 13.16.1 / `expo-router` (보유)만 사용한다. 새 네비게이션 라이브러리·상태 라이브러리를 도입하지 않는다.

---

## EARS Requirements

> 모듈 ≤5. 각 요구사항은 acceptance.md 의 AC 와 1:1 대응(R-U1~U5 ↔ AC-U1~U5). `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 의존.

### M1. 공유 단일 WebView 수명 + perf 프롭 (호스팅 모델 전환)

- **R-U1 (Ubiquitous + Unwanted 혼합)** `[MODIFY] apps/mobile` 셸: The app SHALL mount exactly ONE `WebView` instance at the shell level that persists for the entire app session, and SHALL NOT mount a new `WebView` instance on tab switch or detail navigation. **WHEN** the user switches tabs or opens a detail, the app SHALL navigate the existing single WebView via in-WebView web SPA soft-nav (web `router.push`/href) rather than mounting a second WebView. The single WebView SHALL preserve OD-1 session continuity (쿠키/PKCE/세션) by never being remounted — `ref`/현재 라우트 상태는 셸이 소유하고 `key` 를 부여하지 않으며, 라우트 이동은 in-WebView SPA 네비게이션으로만 수행한다(`source` URI 교체로 인한 hard reload 금지). The shared WebView SHALL set performance props — `cacheEnabled`, Android `cacheMode` (캐시 우선), `androidLayerType="hardware"`, `domStorageEnabled` — without weakening the existing security props (`originWhitelist`, `sharedCookiesEnabled`/`thirdPartyCookiesEnabled`, `setSupportMultipleWindows={false}`, `injectedJavaScriptBeforeContentLoaded`).

### M2. 네이티브 탭 ↔ 웹 라우트 양방향 동기화 (단일 탭바 소유)

- **R-U2 (Event-driven + Unwanted 혼합)** `[MODIFY] (tabs)/_layout.tsx`, `[NEW]` 브리지 네비게이션 채널: **WHEN** the user taps a native tab, the app SHALL drive the single WebView to the corresponding web route via in-WebView SPA navigation (네이티브→웹 navigate 명령 — 새 WebView 마운트 금지). **WHEN** the web pathname changes inside the single WebView (탭 전환 결과 또는 웹 내부 링크 이동), the web SHALL report the new pathname to native and the native tab bar highlight SHALL reflect the matching root tab (양방향 동기화). The app SHALL render exactly ONE visible bottom tab bar — the **native** tab bar wins, and the web `BottomTabBar` SHALL remain hidden via the existing `html[data-shell="native"]` shell-mode contract (이중 탭바 금지, R-WB3/R-WB4 보존). The native→web navigate command and web→native pathname report SHALL travel as a navigation-channel bridge message that reuses the existing nonce + trusted-origin security invariants and SHALL NOT alter the v1 session message types.

### M3. 단일 WebView 내 히스토리 네비게이션 (back/상세 push·pop)

- **R-U3 (Event-driven + State-driven 혼합)** `[MODIFY] useAppLifecycle.ts` back 분기, detail 호스팅: **WHEN** a detail (`/home/{id}` 등) is opened, the app SHALL grow the single WebView's web history depth by one via in-WebView SPA navigation rather than pushing a native stack route that mounts a new WebView. **WHILE** the single WebView's web history is non-empty, **WHEN** Android hardware back is pressed, the app SHALL consume `WebView.goBack()` to walk the in-WebView SPA history (상세→목록 복귀가 같은 WebView 안에서 일어난다). **IF** the web history is at a tab root (더 돌아갈 곳 없음), **THEN** the app SHALL fall through to default behavior (앱 종료/백그라운드) instead of remounting. 탭 전환은 단일 공유 웹 히스토리에 `push` 의미로 기록한다(per-탭 독립 스택 비목표 — OD-3).

### M4. 단일 콜드스타트 인증 핸드셰이크 (앱당 1회)

- **R-U4 (Ubiquitous + Unwanted 혼합)** `[MODIFY] BridgedWebView.tsx:182-208` 콜드스타트 경로: The cold-start auth handshake — SecureStore 토큰 로드(`loadTokens`), `session:restore` 주입(`injectRestore`), 핸드셰이크 8s 타임아웃 폴백(`startHandshakeTimeout`), 스플래시 해제(`SplashScreen.hideAsync`) — SHALL run EXACTLY ONCE per app session on the single shared WebView, and SHALL NOT re-run per tab or per detail entry. The single WebView SHALL hide the splash exactly once (synced/none 수신 또는 8s 타임아웃 폴백 중 먼저 오는 것). resume(AppState active) 재검증(`injectRevalidate`)은 기존대로 동작하되 단일 WebView 의 현재 web 라우트에 대해 1회씩 수행한다. 콜드스타트 토큰의 이중 로드(`AuthContext.tsx:80` + `BridgedWebView.tsx:182`)는 단일 진입으로 정리하되 인증 도출(`AuthContext` `isSignedIn`) 의미는 보존한다.

### M5. 회귀 경계 — OAuth / 초대 / 푸시 라우팅 보존 (단일 WebView 통과)

- **R-U5 (Event-driven 혼합)** `[EXISTING] useAuthBridge.ts`, `notification-core.ts` 보존: **WHEN** the in-WebView Google authorize navigation is intercepted, the app SHALL run native Google Sign-In through the single WebView's `onShouldStartLoadWithRequest` exactly as today (`oauth-intercept` 분기 — 세션은 `injectRestore` 로 단일 WebView 에 주입). **WHEN** the web invite-accept page signals an invalid invite (`invite:invalid`), the app SHALL show the native Alert and route to `(tabs)/home` 또는 `(auth)/login` as today. **WHEN** a notification tap targets chat (`?target=chat`), the app SHALL resolve the chat URL (`buildChatUrl`) and navigate the single WebView to it via in-WebView navigation (새 WebView 마운트 없이). 위 세 흐름의 목적지·인증 의미는 회귀 없이 보존되며, 단일 WebView 일원화가 이들을 깨뜨리지 않는다.

---

## 델타 마커 (변경 분류)

| 마커 | 대상 | 내용 |
|------|------|------|
| `[MODIFY]` | 셸 호스팅 모델 (`(tabs)/_layout.tsx`, `BridgedWebView`/`WebViewShell` 사용처) | 화면별 인스턴스 → 셸 레벨 단일 인스턴스. expo-router `Tabs`(화면별 WebView 마운트) 대신 단일 WebView + 네이티브 탭바 chrome + in-WebView SPA 구동. |
| `[MODIFY]` | `WebViewShell.tsx` props | perf 프롭(`cacheEnabled`/`cacheMode`/`androidLayerType`/`domStorageEnabled`) 추가. 보안/쿠키/브리지 프롭 무변경. |
| `[MODIFY]` | `useAppLifecycle.ts` `decideBackPress` | "(tabs)" back 위임 → 단일 WebView 의 in-WebView 히스토리 `goBack()` 소비로 전환(루트에서 fall-through). |
| `[MODIFY]` | `BridgedWebView.tsx:182-208` 콜드스타트 | 화면당 핸드셰이크 → 앱당 1회 핸드셰이크. |
| `[NEW]` | 브리지 네비게이션 채널 (네이티브↔웹) | 네이티브→웹 navigate 명령 + 웹→네이티브 pathname 보고. nonce·신뢰 origin 재사용, v1 세션 타입 무변경. 웹 최소 추가(진입점). |
| `[EXISTING]` | `useAuthBridge` OAuth/초대 분기, `notification-core` 푸시 URL | 변경 없이 단일 WebView 통과 보존. |
| `[EXISTING]` | `(main)/layout.tsx` 셸 모드 탭바 숨김, `BottomTabBar` | 변경 없이 이중 탭바 회피 계약 보존(네이티브 탭바가 승). |

---

## 설계 노트

- **OD-1 보존이 더 중요해진다.** SHELL-001 에서 OD-1 은 화면별 인스턴스 안에서의 비리마운트였지만, 일원화 후에는 **앱 전체 세션의 쿠키/PKCE/SPA 위치**가 단일 WebView 하나에 실린다. 단일 WebView 가 강제 리로드(에러 재시도, Android 메모리 압박 시 WebView 재활용)되면 앱 전체의 웹 라우트 위치가 초기화된다 — 에러 재시도는 현재 라우트 복원/홈 폴백을 정의해야 한다(R-U1 + OD-2).
- **양방향 동기화의 권위.** 웹 pathname 이 네이티브 탭 하이라이트의 단일 진실이다(`usePathname` ↔ `routeForUrl`). 네이티브 탭 탭은 명령일 뿐이고, 실제 상태는 웹 SPA 네비게이션이 완료된 뒤 웹→네이티브 보고로 확정된다 — 즉시 하이라이트는 낙관적 UI 다(OD-4).
- **웹 SPA 라우팅은 이미 존재한다.** 웹은 `next/link`/`usePathname` 기반 soft-nav 와 `BottomTabBar`(`<Link href>`)를 이미 구현했다(리포트 §2 "웹 측 자체는 견고"). 따라서 네이티브→웹 navigate 는 웹의 기존 라우터를 호출하는 얇은 진입점만 추가하면 된다 — 웹 UI 재작성 0(범위 제약).
- **재사용 자산.** `route-map-core.ts`(`routeForUrl`/`urlForRoute`/`detailRouteForUrl`)는 네이티브↔웹 라우트 매핑의 순수 소스로 그대로 쓴다 — 양방향 동기화의 라우트 분류에 재사용한다.
- **perf 프롭은 보안과 무충돌**(리포트 [높음 2]). `cacheEnabled`/`cacheMode`/`androidLayerType`/`domStorageEnabled` 는 `originWhitelist`/쿠키/`setSupportMultipleWindows` 와 독립이다.

---

## 리스크

| 리스크 | 심각도 | 내용 · 대응 |
|--------|--------|-------------|
| **단일 탭바 소유 + 히스토리 모델 결정** | High | 네이티브 탭바(승) vs 웹 `BottomTabBar` 노출, 그리고 단일 공유 웹 히스토리 vs per-탭 스택. **권장 확정: 네이티브 탭바 승 + 단일 공유 웹 히스토리(탭=push)** — 기존 `data-shell="native"` 숨김 계약·웹 `<Link>` push 의미를 그대로 쓰는 최소 변경. 대안(웹 탭바 노출 / per-탭 스택)은 OD-3 에서 비목표로 분리. 잘못된 선택 시 이중 탭바 또는 cross-탭 back 혼란. |
| **양방향 동기화 레이스(하이라이트 desync)** | High | 네이티브 즉시 하이라이트 vs 웹 pathname 지연. 웹 내부 링크 이동(탭 탭 아닌 경로 변화)이 네이티브로 보고되지 않으면 하이라이트가 어긋난다. **대응: 웹 pathname 을 단일 진실로 삼고(OD-4), 네비게이션 채널(R-U2)로 웹→네이티브 보고를 의무화**. 새 브리지 메시지는 nonce·신뢰 origin 재사용. |
| **OD-1 단일 WebView 취약성 증폭** | High | 앱 전체 세션 상태가 WebView 하나에 집중 → 강제 리로드/메모리 재활용 시 전 앱 웹 위치 초기화. **대응: 비리마운트 불변(R-U1), 에러 재시도 시 현재 라우트 복원/홈 폴백 정의(OD-2), Android `androidLayerType`/캐시로 재활용 빈도 완화.** 디바이스 종단으로만 실제 빈도 확정. |
| **back 거동 변경** | Medium | "(tabs)" back 이 네이티브 스택 pop → in-WebView `goBack()` 으로 의미 전환. 사용자 체감 back 동선이 바뀐다(상세→목록이 같은 WebView 안에서). **대응: R-U3 명시 + 디바이스 종단 검증(Android back 게이트).** |
| **measure 한계** | Medium | 리포트 §6 — 모든 정량치는 데스크톱 Chrome 근사이고 실 WebView 측정 미수행. 일원화 효과(onLoadStart 0 회)는 계측 게이트로 구조 검증하되, 체감 개선 폭은 디바이스 trace 로만 확정. |

---

## Open Decisions / Risks

| ID | 주제 | 결정/상태 | 영향 |
|----|------|-----------|------|
| **OD-1** | 단일 WebView 비리마운트 (핵심 리스크) | **확정: 셸 레벨 단일 인스턴스를 리마운트하지 않는다(`key` 없음, ref/라우트 상태 셸 소유).** 탭/상세/back 전부 in-WebView SPA 네비게이션. 쿠키/PKCE/세션은 단일 WebView 수명 동안 보존(SHELL-001 OD-1 을 앱 스코프로 확대). | 리마운트 발생 시 앱 전체 세션/SPA 위치 초기화 — 가장 취약한 지점. |
| **OD-2** | 에러 재시도/강제 리로드 시 복원 | **권장: 에러 재시도는 현재 web 라우트를 복원(또는 홈 탭 폴백)한다 — 초기 URL 하드 리셋 금지.** 단일 WebView 라 `handleRetry`(현 `BridgedWebView.tsx:220` 초기 URL 재로드)를 현재 라우트 기준으로 바꿔야 한다. 정확한 복원 정책은 구현 시 확정. | 잘못 복원 시 에러 후 사용자가 앱 첫 화면으로 튕긴다. |
| **OD-3** | 탭 히스토리 모델 | **확정: 단일 공유 웹 히스토리(탭 전환 = push). per-탭 독립 스택 시뮬레이션은 비목표.** 웹 `BottomTabBar` 의 기존 `<Link>` push 의미와 일치 — 웹 변경 최소화. | per-탭 스택을 원하면 별도 SPEC. 단일 히스토리는 cross-탭 back 이 발생(수용). |
| **OD-4** | 탭 하이라이트 권위 | **확정: 웹 pathname 이 네이티브 탭 하이라이트의 단일 진실(`routeForUrl`).** 네이티브 탭 탭의 즉시 하이라이트는 낙관적 UI 이고, 웹→네이티브 pathname 보고가 최종 상태를 확정한다. | 보고 누락 시 하이라이트 desync(웹 내부 이동에서 특히). |
| **OD-5** | 탭바 chrome 소유 | **확정: 네이티브 탭바 승.** 웹 `BottomTabBar` 는 `html[data-shell="native"]` 로 계속 숨긴다(이중 탭바 금지). 네이티브 탭바가 navigate 명령을 보낸다. | 웹 탭바 노출로 바꾸면 네이티브 chrome 이점(safe-area/배지/즉시 하이라이트) 상실. |

---

## Sources (출처)

- `.moai/reports/webview-rn-rendering-performance.md` — [높음 1] 화면별 독립 WebView → 풀 로드/hydration 반복(이 SPEC 의 #1 레버), [높음 2] perf 프롭 전무, §2 웹 SPA soft-nav 견고, §6 measure 한계. (리포트 직접 확인 2026-06-25)
- `apps/mobile/components/BridgedWebView.tsx` — 화면별 인스턴스 마운트(`:269-271` `TabWebView`, `:122-127` `onDetailPush`), 콜드스타트 핸드셰이크(`:182-208`), OD-1 비리마운트 주석(`:8-9`), 에러 재시도(`:220` `handleRetry`). (코드 직접 확인)
- `apps/mobile/components/WebViewShell.tsx` — `<WebView>` 호스트(`:105`), 보안/쿠키 프롭만 설정·perf 프롭 부재(`:105-133`), 비리마운트(`:108` `key` 없음). (코드 직접 확인)
- `apps/mobile/app/(tabs)/_layout.tsx` — expo-router `Tabs` 네이티브 탭바 4종 + `lazy:true`(`:44`) + 가드. (코드 직접 확인)
- `apps/mobile/app/(tabs)/home/[id].tsx` — 상세 native 라우트 → 새 `BridgedWebView`(`:28`), 푸시 `?target=chat`→`buildChatUrl`(`:23-27`). (코드 직접 확인)
- `apps/mobile/lib/route-map-core.ts` — `routeForUrl`/`urlForRoute`(`:78`)/`detailRouteForUrl`/`isCrossRoute` 순수 매핑(양방향 동기화 재사용). (코드 직접 확인)
- `apps/mobile/hooks/useAuthBridge.ts` — OAuth 인터셉트(`:221-227`), `onMessage` 5종(`:248-314`), `injectRestore`(`:316`), invite-invalid(`:305`). (코드 직접 확인)
- `apps/mobile/hooks/useAppLifecycle.ts` — `decideBackPress`(`:91-99`), 핸드셰이크 8s 타임아웃(`:62`), resume 재검증(`:107-125`). (코드 직접 확인)
- `apps/mobile/lib/auth/AuthContext.tsx` — `isSignedIn` 도출 단일 소스(`:118`), 콜드스타트 토큰 로드 중복(`:80-99`), nonce 1회 생성(`:66-70`). (코드 직접 확인)
- `apps/web/app/(main)/layout.tsx` — 셸 모드 감지 + 탭바 숨김 계약(`:25`, `:64-65`). (코드 직접 확인)
- `apps/web/app/(main)/_components/BottomTabBar.tsx` — 웹 탭바(`<Link href>` push, `usePathname` active), 셸 모드 숨김. (코드 직접 확인)
- SPEC-WEBVIEW-SHELL-001 spec.md/acceptance.md — `WebViewShell`/`BridgedWebView`/훅 추출·OD-1·device-gated AC 패턴. (.moai/specs/ 직접 확인)
- `SPEC-MOBILE-NATIVE-UI-001` — 경쟁 SPEC ID(웹 UI 네이티브 재구현). 이 SPEC 의 비목표로 참조만. (ID 참조)
