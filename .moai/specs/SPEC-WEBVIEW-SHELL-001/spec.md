---
id: SPEC-WEBVIEW-SHELL-001
version: 0.1.0
status: in-progress
created: 2026-06-09
updated: 2026-06-09
author: hatae
priority: high
issue_number: null
---

# SPEC-WEBVIEW-SHELL-001 — WebViewShell 컴포넌트화 (행위 보존 추출)

## HISTORY

- 2026-06-09 (v0.1.0): 최초 작성 (draft). **depends-on: SPEC-MOBILE-001 (in-progress)** — MOBILE-001 이 만든 모놀리식 `apps/mobile/App.tsx`(풀스크린 WebView + Google OAuth 시스템 브라우저 브리지)를 리팩토링한다. 이 SPEC 은 **순수 행위 보존(behavior-preserving) 리팩토링**이다(brownfield): 신규 동작 0, 회귀 0. 모놀리식 `App.tsx` 를 재사용 가능한 `WebViewShell` 컴포넌트 + 분리된 loading/error 오버레이 컴포넌트로 추출하고, 라이프사이클/브리지 로직을 합성 가능한 훅(`useAppLifecycle`/`useAuthBridge`)으로 분리한다. **이 SPEC 에서 추출된 훅은 SPEC-MOBILE-001 의 기존 동작만 담는다**(`useAppLifecycle` = Android 백/네비 히스토리; `useAuthBridge` = OAuth 인터셉트→시스템 브라우저 브리지). 이 훅들은 **이후 SPEC-MOBILE-002 가 토큰 동기화 로직을 얹을 확장 지점(seam)**이다 — 여기서는 토큰 로직을 넣지 않는다.
  - **[SPEC-MOBILE-002 split]**: 원래 SPEC-MOBILE-002 의 M1(WebViewShell 추출, R-S1~R-S5)을 별도 선행 SPEC 으로 분리했다(MOBILE-002 의 M1 = 이 SPEC). 근거: WebViewShell 추출은 토큰 동기화와 독립적인 순수 구조 리팩토링이며, 선행 추출이 끝나야 MOBILE-002 의 토큰 로직이 인라인 비대화 없이 훅/컴포넌트에 얹힌다. 실행 순서: 이 SPEC 먼저 → SPEC-MOBILE-002.
- 2026-06-09 (v0.1.0) **[audit remediation applied]**: plan-auditor 독립 감사(audit.md, PASS-WITH-FIXES) 반영. H-1(DoD 의 "이메일 로그인" 무회귀 항목 제거 — R-S3/AC-S3 에 없고 추출과 무관), H-2(추출 훅 분기에 대한 자동 특성화 테스트 AC-S6 신설 + 자동 불가 항목을 수동 전용으로 DoD 격리), M-1(AC-S3 수동 검증에 웹/supabase/호스트 일관 환경 전제 + 추출 전 baseline 추가), M-2(AC-S2 파일명 과구속 완화 — 행위 기준), M-3(AC-S4 seam 게이트를 import-부재 + package.json 부재로 구체화), M-4(MOBILE-001 R-P2 baseline 진입 게이트를 DoD/plan 에 추가), L-2(AC-S5 index.ts 불변 구체화)·L-3(HISTORY 평면 이력 정리). 신규 요구 R-S6 추가로 모듈 M1 의 요구 5→6, AC 5→6.
- 2026-06-09 (v0.1.0) **[implementation complete — automated gates pass]**: 구현 완료. `WebViewShell` 컴포넌트(`components/WebViewShell.tsx`) + `LoadingOverlay`/`WebViewErrorOverlay` 오버레이 + 훅(`hooks/useAppLifecycle.ts`, `hooks/useAuthBridge.ts`) 추출 완료. 자동 게이트 통과: typecheck 0 에러, vitest 21/21 pass (훅 특성화 테스트 포함), expo export 번들 OK. 디바이스 종단 검증(AC-S3) 은 미완료 — 실기기/에뮬레이터 수동 검증 대기로 status `in-progress` 유지.

---

## Background (배경)

`moyura` 모노레포는 웹(`apps/web`, Next.js)을 UI surface 로 삼고, 모바일 앱(`apps/mobile`, Expo ~56.0.6 / RN 0.85.3 / React 19.2.3)은 그 웹을 풀스크린 WebView 로 호스팅하는 씬 셸이다.

SPEC-MOBILE-001 이 만든 현 상태 (live source-of-truth):
- `apps/mobile/App.tsx` — **모놀리식 단일 파일**. 다음 관심사가 모두 한 컴포넌트 안에 인라인되어 있다:
  - WebView 렌더(`source` = `WEB_URL`, `sharedCookiesEnabled`(iOS), `thirdPartyCookiesEnabled`(Android), `style`).
  - `onShouldStartLoadWithRequest` → `shouldBridgeOAuth` 인터셉트 → `runOAuthBridge`(시스템 브라우저 OAuth).
  - `onNavigationStateChange` → `canGoBackRef`(Android 하드웨어 백 분기).
  - `BackHandler` `useEffect`(Android `hardwareBackPress` → `webView.goBack()` vs 기본 종료).
  - `onLoadStart`/`onLoadEnd`(로딩 state), `onError`/`onHttpError`(에러 state).
  - 로딩 인디케이터 오버레이 + 복구 가능 에러/재시도 오버레이(인라인 JSX + `StyleSheet`).
  - `runOAuthBridge`(`bridgeGoogleOAuth` 호출 + `resolveWebCallbackUrl` → `setSourceUri`).
- `apps/mobile/lib/auth/oauth.ts` / `oauth-bridge.ts` — Google 시스템 브라우저 OAuth 브리지(순수 함수 + `launchSocialOAuth`). **이 SPEC 은 변경하지 않는다**(추출된 `useAuthBridge` 가 호출만 한다).
- `apps/mobile/lib/web-url.ts` — `WEB_URL`(`@MX:ANCHOR`). `apps/mobile/lib/env.ts` — `resolve*` 가드 패턴.
- `apps/mobile/app.json` — `scheme: "moyura"`. `apps/mobile/index.ts` — `main`/`registerRootComponent`.

현재의 한계 (이 SPEC 이 해소하는 것): 모든 관심사가 `App.tsx` 한 파일에 인라인되어 있어 (a) 재사용 불가(단일 컴포넌트), (b) 라이프사이클/브리지 로직이 컴포넌트 본문에 묶여 향후 expo-router 마이그레이션이나 토큰 동기화 추가(SPEC-MOBILE-002) 시 파일이 비대해진다. 이 SPEC 은 **동작을 한 줄도 바꾸지 않고** 구조만 재사용 가능한 컴포넌트 + 합성 가능한 훅으로 분리한다.

---

## Goal (목표)

모놀리식 `apps/mobile/App.tsx` 를 행위 보존 방식으로 다음으로 추출한다: (1) source URL prop + 이벤트 핸들러 prop 을 받아 임의의 웹 라우트를 호스팅할 수 있는 재사용 가능한 `WebViewShell` 컴포넌트(forward-compat 가드레일 4), (2) 분리된 loading/error 오버레이 presentational 컴포넌트, (3) 라이프사이클·브리지 로직을 담은 합성 가능한 훅 `useAppLifecycle`(Android 백/네비 히스토리)·`useAuthBridge`(OAuth 인터셉트→시스템 브라우저 브리지) — 향후 expo-router 마이그레이션이 기계적이도록(forward-compat 가드레일 1). `App.tsx` 는 이들을 합성만 하며 SPEC-MOBILE-001 의 모든 동작을 회귀 없이 보존한다. 단일 화면 아키텍처를 유지하고 `expo-router` 를 도입하지 않는다. 추출된 훅은 SPEC-MOBILE-002 가 토큰 동기화를 얹을 확장 지점이다(여기서는 기존 동작만).

---

## Non-Goals (제외 — What NOT to Build)

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **새 동작 없음.** 순수 행위 보존 리팩토링이다. 토큰 캐시/세션 동기화/스플래시/resume 등 SPEC-MOBILE-002 의 기능은 일절 추가하지 않는다 — 추출된 훅은 SPEC-MOBILE-001 의 기존 동작만 담는다.
- **`oauth.ts` / `oauth-bridge.ts` 변경 없음.** OAuth 순수 함수와 `launchSocialOAuth` 는 그대로 두고, `useAuthBridge` 가 기존과 동일하게 호출만 한다.
- **`expo-router` 도입 없음.** 단일 화면 유지(`App.tsx` 단일 진입, `main: index.ts`, `scheme: "moyura"` 불변). 단, 훅 분리로 향후 마이그레이션이 기계적이게 만든다.
- **웹(`apps/web`) 변경 없음.** 이 SPEC 은 `apps/mobile` 내부 구조만 다룬다.
- **새 의존성 없음.** `react-native-webview` 13.16.1(MOBILE-001 보유)만 사용. `expo-secure-store` 등은 SPEC-MOBILE-002 범위.

---

## EARS Requirements

> 모듈 ≤5. 각 요구사항은 acceptance.md 의 AC 와 1:1 대응. `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 의존.

### M1. WebViewShell 추출 (행위 보존 컴포넌트화 + 훅 분리)

- **R-S1 (Ubiquitous)** `[NEW] apps/mobile/components/WebViewShell.tsx`: The app SHALL provide a reusable `WebViewShell` component that accepts a source URL prop and event handler props (loading/error/navigation/shouldStartLoad), encapsulating the `react-native-webview` configuration currently inline in `App.tsx` (incl. `sharedCookiesEnabled` for iOS and `thirdPartyCookiesEnabled` for Android). The component SHALL be generic enough to host any web route (forward-compat guardrail 4).
- **R-S2 (Ubiquitous)** `[NEW] apps/mobile/components/`: Loading indicator and recoverable error/retry overlays SHALL be extracted into separate presentational components, replacing the inline overlay JSX (and `StyleSheet`) in `App.tsx`.
- **R-S3 (Ubiquitous)** `[MODIFY] apps/mobile/App.tsx`: After extraction, `App.tsx` SHALL compose `WebViewShell` + overlays + hooks and SHALL preserve every existing behavior from SPEC-MOBILE-001 (Android hardware back via history, SafeArea, loading state, recoverable error+retry, OAuth intercept→system browser bridge, web callback navigation on auth success) with no functional regression.
- **R-S4 (Ubiquitous)** `[NEW] apps/mobile/hooks/`: WebView lifecycle and bridge logic SHALL be extracted as composable hooks (`useAppLifecycle` = Android back / nav-history tracking; `useAuthBridge` = OAuth intercept→system-browser bridge) rather than remaining inline in `App.tsx`, so a future `expo-router` migration is mechanical (forward-compat guardrail 1). These hooks SHALL contain ONLY the existing SPEC-MOBILE-001 behavior and SHALL serve as the extension points that SPEC-MOBILE-002 will later build token-sync into.
- **R-S5 (Unwanted)** `[MODIFY] App.tsx`: This SPEC SHALL NOT change the single-screen architecture — it SHALL NOT introduce `expo-router` or a second navigatable route; the app entry SHALL remain `App.tsx` (`main: index.ts`) and the scheme SHALL remain `moyura`.
- **R-S6 (Ubiquitous)** `[NEW] apps/mobile/hooks/*.test.ts`: As a behavior-preserving (characterization) gate for the extraction, the extracted hooks SHALL be covered by at least one AUTOMATED unit test per branch — `useAuthBridge` (`shouldBridgeOAuth` true/false intercept decision; `runOAuthBridge` callback path — authenticated → `setSourceUri`, cancelled/error → no-op) and `useAppLifecycle` (Android back handler `canGoBack` true → `goBack()`/false → default exit) — written as pure units following the `oauth-bridge.test.ts` pattern (no expo/RN import; pure logic / dependency-injected callbacks). Genuinely unautomatable parts (WebView non-remount, full OAuth round-trip) remain manual-only (R-S3) and SHALL be labeled as such in the DoD so the no-regression promise does not rest solely on a single manual run.

---

## Open Decisions / Risks

| ID | 주제 | 결정/상태 | 영향 |
|----|------|-----------|------|
| **OD-1** | WebView 인스턴스 리마운트 회피 (핵심 리스크) | **확정: 추출은 순수 구조 변경에 한정, WebView 인스턴스를 리마운트하지 않는다.** MOBILE-001 `App.tsx` 주석(line 114): WebView 에 `key` 를 부여하면 리마운트로 쿠키/PKCE 컨텍스트가 초기화돼 OAuth 흐름이 깨진다. 따라서 `WebViewShell` 추출 후에도 `ref`/`sourceUri` state 위치를 보존하고, OAuth 복귀 시 `setSourceUri` 만으로 네비게이트(리마운트 아님)하는 기존 패턴을 그대로 유지한다. | 리마운트 발생 시 OAuth/쿠키 컨텍스트 초기화로 MOBILE-001 의 핵심 흐름이 회귀. 가장 취약한 추출 지점. |
| **OD-2** | 훅 분리 시 ref/state 소유 위치 | **권장: WebView `ref` 와 `sourceUri` state 는 `App.tsx`(또는 `WebViewShell`)가 소유하고, 훅은 콜백/이벤트 핸들러와 부수효과(`BackHandler`/나중에 `AppState`)만 캡슐화.** `useAppLifecycle` 은 `webViewRef` + `canGoBack` 를 인자/리턴으로 다루고, `useAuthBridge` 는 인터셉트 판별 + `runOAuthBridge` + 콜백 URL 세팅 콜백을 제공한다. 정확한 훅 시그니처는 구현 시 확정하되, 동작 보존이 우선. | 잘못된 소유 분리 시 stale closure / 리마운트 / 핸들러 누락으로 회귀. |
| **OD-3** | SPEC-MOBILE-002 seam 명확성 | **확정: 추출 훅은 기존 동작만, 토큰 로직 0.** `useAppLifecycle` 은 향후 `AppState`/스플래시/토큰 로드를, `useAuthBridge` 는 향후 `session:restore` 주입/`onMessage`/SecureStore 갱신을 얹을 자리다. 이 SPEC 에서는 그 자리만 만들고 채우지 않는다 — MOBILE-002 가 채운다. | seam 이 불명확하면 MOBILE-002 가 다시 App.tsx 를 비대화시키거나 재추출 필요. |

---

## Sources (출처)

- `apps/mobile/App.tsx` — 모놀리식 WebView 셸(WebView config, `onShouldStartLoadWithRequest`/`shouldBridgeOAuth`, `onNavigationStateChange`/`canGoBackRef`, `BackHandler` `useEffect`, 로딩/에러 오버레이 + `StyleSheet`, `runOAuthBridge`/`setSourceUri`). 추출 대상. WebView `key` 미부여 주석(리마운트 회피, OD-1). (코드 직접 확인 2026-06-09)
- `apps/mobile/lib/auth/oauth.ts` / `oauth-bridge.ts` — `shouldBridgeOAuth`/`bridgeGoogleOAuth`/`resolveWebCallbackUrl` + 순수 헬퍼. 변경하지 않고 `useAuthBridge` 가 호출만 함. (코드 직접 확인)
- `apps/mobile/lib/web-url.ts` / `lib/env.ts` — `WEB_URL` `@MX:ANCHOR`, `resolve*` 가드. (코드 직접 확인)
- `apps/mobile/package.json` — `react-native-webview` 13.16.1 보유(신규 의존성 0). (코드 직접 확인)
- `apps/mobile/app.json` / `index.ts` — `scheme: "moyura"`, `main`/`registerRootComponent`(불변, R-S5). (코드 직접 확인)
- SPEC-MOBILE-001 spec.md — depends-on, 추출 대상 동작(R-S1~R-U4, R-O1~R-O6)의 원천. (.moai/specs/ 직접 확인)
- SPEC-MOBILE-002 spec.md — 이 SPEC 이 split 되어 나온 부모, 추출 훅을 확장하는 후행 SPEC. (.moai/specs/ 직접 확인)
