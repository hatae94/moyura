---
id: SPEC-WEBVIEW-NATIVE-FEEL-001
version: 0.1.0
status: draft
created: 2026-06-25
updated: 2026-06-25
author: hatae
priority: high
issue_number: null
---

# SPEC-WEBVIEW-NATIVE-FEEL-001 — WebView 네이티브 체감 강화 (best-practice 기법 통합)

## HISTORY

- 2026-06-25 (v0.1.0): 최초 작성 (draft). **근거 리포트: `.moai/reports/webview-native-feel-best-practices.md`** — 2축 웹 리서치(진입/로딩 체감 · 런타임 네이티브 감각)로 검증한 best practice 를, 우리 하이브리드(`apps/mobile` WebView ↔ `apps/web` Next.js)가 **네이티브 화면처럼 느껴지도록** 만드는 구현 가능한 SPEC 으로 옮긴다. **근본 진단: `.moai/reports/webview-rn-rendering-performance.md`** — 체감 지연이 "화면별 독립 WebView × 인스턴스마다 Next 부팅/hydration 반복"의 곱이라는 진단을 기법으로 직격한다. 리서치의 티어 1/2/3 기법을 5개 모듈(M1~M5)에 사상한다: 티어 1 → M1(호스트 perf 프롭)·M2(로딩 체감), 티어 2 → M3(워밍업·선인증)·M4(전환·제스처), 티어 3 → M5(콘텐츠 측 비용).
  - **[depends-on / 전제 — SPEC-WEBVIEW-UNIFY-001 (A안, draft)]**: 본 SPEC 의 기법 대부분(M3 워밍업, M4 전환, M2 splash 핸드오프)은 **공유 장수명 단일 WebView**(UNIFY-001 이 정의)를 전제한다. 본 SPEC 은 UNIFY-001 을 **재지정하지 않으며**(통합 모델은 UNIFY-001 의 책임), 그 위에 네이티브 체감 레이어를 **부가(additive)**한다. UNIFY-001 R-U1(공유 WebView + perf 프롭)·R-U4(앱당 1회 핸드셰이크)를 본 SPEC 이 **강화**한다(M1 = perf 프롭 확장, M3 = 핸드셰이크를 사전 워밍업으로 선행). UNIFY-001 미적용 환경에서도 M1·M2·M5 의 일부는 단독 적용 가능하나, M3·M4 의 완전 효과는 단일 WebView 일원화 후에만 나타난다.
  - **[경쟁 없음 — additive only]**: 본 SPEC 은 UNIFY-001(Option A, 웹 SPA 재사용)을 **대체·경쟁하지 않는다**. UNIFY-001 의 경쟁안인 `SPEC-MOBILE-NATIVE-UI-001`(Option B, 네이티브 재구현)과도 무관하다 — 본 SPEC 은 **A안 위에 얹는 체감 강화 전용**이며, B안이 채택되면 본 SPEC 의 WebView-측 기법(M1~M4)은 대부분 무의미해진다(그 경우 본 SPEC 은 A안과 함께 폐기). 즉 본 SPEC 은 "어떤 모델을 쓸지"를 결정하지 않고, "A안이라면 어떻게 네이티브처럼 느껴지게 할지"만 정의한다.
  - **device-gated**: WebView 내부 체감(실기기 콜드스타트 시간·스크롤 fps·전환 부드러움·제스처 충돌)은 iOS 시뮬레이터/실기기 종단 검증 전까지 미확정이다(moyura WebView SPEC 관행 — SHELL-001 AC-S3, UNIFY-001 동일). 웹 측 정적/번들/빌드 지표는 자동 게이트로, 디바이스 체감은 수동 게이트로 분리한다. status 는 자동 게이트 통과 후 in-progress, 디바이스 종단 검증 통과 시 completed.

---

## Background (배경)

`moyura` 모노레포는 웹(`apps/web`, Next.js 16 App Router / React 19)을 UI surface 로 삼고, 모바일 앱(`apps/mobile`, Expo ~56 / RN 0.85.3 / react-native-webview 13.16.1 / expo-router)이 그 웹을 WebView 로 호스팅하는 하이브리드 셸이다.

**현 상태 (live source-of-truth — 코드 직접 확인 2026-06-25):**
- WebView 호스트(`apps/mobile/components/WebViewShell.tsx:105-133`)는 **보안/쿠키/브리지 프롭만** 설정한다(`originWhitelist`, `sharedCookiesEnabled`/`thirdPartyCookiesEnabled`, `setSupportMultipleWindows={false}`, `injectedJavaScriptBeforeContentLoaded`, `onMessage`). 진단 리포트 [높음 2]가 확인한 대로 **perf 프롭이 전무**하다 — `androidLayerType`·`decelerationRate`·`overScrollMode`·`cacheMode`·`domStorageEnabled`·`startInLoadingState`·`renderLoading`·`onContentProcessDidTerminate`·텍스트선택/줌 비활성화가 하나도 없다.
- 로딩 체감은 `BridgedWebView.tsx:242-263`의 `isLoading`/`hasError` state + `LoadingOverlay`/`WebViewErrorOverlay`로만 처리된다 — `startInLoadingState`/`renderLoading` 미사용, `onLoadEnd` opacity 페이드인 없음(흰 플래시 노출). Expo splash 는 `_layout.tsx:28`에서 `preventAutoHideAsync()`로 유지되고 핸드셰이크 완료/8s 타임아웃 시 `hideAsync()` 되지만(`BridgedWebView.tsx:199-201`), **fade 옵션 미사용**이라 splash→콘텐츠 핸드오프에 끊김이 있다.
- 콜드스타트 인증 핸드셰이크(`BridgedWebView.tsx:182-208`)는 SecureStore 토큰 로드 → `injectRestore` → 8s 타임아웃 → splash 해제를 화면 진입 시점에 **직렬**로 수행한다 — 진단 리포트 [중간 4]가 지목한 "토큰 로드·핸드셰이크가 first paint 를 직렬로 가로막음".
- 전환: `_layout.tsx:87` `Stack` 의 `animation:"none"`(슬라이드 제거 — 요청), 웹은 `next/link` SPA soft-nav 지원. 그러나 라우트 전환 사이 빈화면/플래시를 가리는 의도된 시각요소(스냅샷/스켈레톤·View Transitions)가 없다.
- 콘텐츠 측: `apps/web/next.config.ts`는 `reactCompiler:true`만 활성, **PPR/`cacheComponents` 미사용**. 긴 리스트에 `content-visibility:auto` 미적용. 진단 baseline(`client-bundle-hydration-baseline.md`) — First Load JS 159KB 압축 / 520KB decoded, LCP render-delay 98%(=CPU/hydration 지배).

**현재의 한계 (이 SPEC 이 해소하는 것):** WebView 가 "웹페이지를 띄운 창"처럼 느껴진다 — 흰 플래시, GPU 미가속 스크롤 jank, 전환 시 빈화면, 직렬 콜드스타트 갭. best practice 는 마법 prop 하나가 아니라 **(1) 워밍업·선인증으로 진입 비용을 화면 밖으로 옮기고, (2) 단일 인스턴스를 유지하며, (3) 전환·로딩을 의도된 시각요소로 가리는** 3축 조합이다(리서치 §0). 이 SPEC 은 그 3축을 우리 코드에 사상한 perf 프롭·로딩 체감·워밍업·전환/제스처·콘텐츠 비용 5개 모듈로 정의한다.

---

## Goal (목표)

UNIFY-001 의 공유 단일 WebView 위에 **네이티브 화면 체감 레이어**를 부가한다: (M1) 공유 WebView 에 GPU 가속·감속·캐시·정적감(텍스트선택/줌 off) perf 프롭을 보안 약화 없이 추가하고, (M2) 흰 플래시를 브랜드 스켈레톤+페이드인+splash fade 핸드오프로 대체하며 iOS 콘텐츠 프로세스 종료를 복구하고, (M3) 앱 시작 시 백그라운드 숨김 WebView 를 미리 인스턴스화해 인증 핸드셰이크를 **선행 완료**(Shopify 패턴)함으로써 진입 즉시 콘텐츠가 보이게 하고, (M4) View Transitions API 로 SPA 전환을 네이티브 push/pop 슬라이드화하며 제스처 충돌(swipe-back vs 가로 스크롤·PTR·상태바 탭)을 정리하고, (M5) Next.js PPR+Suspense 스트리밍으로 hydration 비용을 제거하고 긴 리스트에 `content-visibility:auto`·INP 위생을 적용한다. 모든 변경은 **체감(perceived) 개선**이 목표이며, before→after 지표 델타로 판정한다.

---

## Non-Goals (제외 — What NOT to Build)

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **공유 WebView 일원화(UNIFY-001)를 재지정하지 않는다.** 본 SPEC 은 **SPEC-WEBVIEW-UNIFY-001 이 정의한 공유 장수명 단일 WebView 를 전제**로 그 위에 체감 레이어만 부가한다(additive). 단일 인스턴스 호스팅 모델·네이티브 탭↔웹 라우트 동기화·앱당 1회 핸드셰이크의 **소유·정의는 UNIFY-001 의 책임**이며 본 SPEC 은 그것을 강화(perf 프롭 확장·워밍업 선행)만 한다 — 통합 자체를 다시 명세하지 않는다.
- **A안 vs B안 모델 결정을 하지 않는다.** 본 SPEC 은 UNIFY-001(Option A) 채택을 가정한 **부가 SPEC**이고, 경쟁 SPEC `SPEC-MOBILE-NATIVE-UI-001`(Option B, 네이티브 재구현)과 경쟁하지 않는다. 어떤 모델을 쓸지는 UNIFY-001 의 결정 사항이고, 본 SPEC 은 "A안이라면 어떻게 네이티브처럼 느끼게 할지"만 정의한다(경쟁 아님 — additive only).
- **보안 프롭 약화 없음.** M1 perf 프롭 추가는 기존 보안 불변식(`originWhitelist`/쿠키/`setSupportMultipleWindows={false}`/`injectedJavaScriptBeforeContentLoaded`)을 **무변경** 보존한다. `touch-action:none` 전역(저시력 줌 차단)·FastClick(obsolete) 도입은 금지(리서치 §5 folklore 기각).
- **bridge-protocol v1 세션 메시지 의미 변경 없음.** `session:synced/none/cleared`·`google-signin`·`invite:invalid` 봉투/nonce/의미를 변경하지 않는다. M2/M3 의 splash·워밍업 신호는 기존 핸드셰이크 신호(또는 UNIFY-001 의 네비게이션 채널)를 **재사용**한다 — 새 인증 메시지 타입을 만들지 않는다.
- **OAuth/세션/푸시 백엔드 변경 없음.** 네이티브 Google Sign-In SDK 흐름·Supabase 세션·FCM 등록/해제·백엔드 가드를 변경하지 않는다. 본 SPEC 은 이들을 **통과 보존**만 한다(M3 선인증은 기존 토큰 로드를 더 일찍 호출할 뿐, 인증 의미 무변경).
- **새 의존성 없음(WebView 측).** `react-native-webview` 13.16.1 / `expo-router` / `expo-splash-screen`(보유)만 사용한다. 웹 측은 보유 Next.js 16 의 PPR/`cacheComponents`·표준 View Transitions API·CSS `content-visibility`만 사용하고 새 애니메이션/전환 라이브러리(Framer Motion 등)를 도입하지 않는다.
- **네이티브 에셋 인터셉트 캐싱(.js 청크 프리캐시)은 본 SPEC 의 필수 범위가 아니다(optional).** Android `shouldInterceptRequest`/iOS `WKURLSchemeHandler` 기반 네이티브 캐싱은 플랫폼-네이티브 고난도 작업으로, M5 에서 **선택적·후순위(higher-effort/optional)**로만 플래그한다 — 본 SPEC 의 acceptance 게이트에 포함되지 않으며 별도 SPEC 후보다.

---

## EARS Requirements

> 모듈 ≤5. 각 요구사항은 acceptance.md 의 AC 와 1:1 대응(R-NF1~NF5 ↔ AC-NF1~NF5). `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 의존. 리서치 티어 사상은 각 모듈 헤더에 표기.

### M1. WebView perf 프롭 (티어 1 — 호스트 GPU/감속/캐시/정적감)

- **R-NF1 (Ubiquitous + Unwanted 혼합)** `[MODIFY] apps/mobile/components/WebViewShell.tsx`: The shared WebView SHALL set host-level performance props — `androidLayerType="hardware"` (Android GPU 합성 → 스크롤 jank 해소), `decelerationRate="normal"` (iOS 네이티브 감속 일치), `overScrollMode` (Android 글로우/바운스 정책), `domStorageEnabled` (웹 캐시 전략 보장), Android `cacheMode` (캐시 우선, stale 정책은 OD 로 확정) — and SHALL disable text selection and user zoom (앱 같은 정적 느낌) via the platform-appropriate mechanism. The WebView SHALL NOT weaken any existing security prop — `originWhitelist`, `sharedCookiesEnabled`/`thirdPartyCookiesEnabled`, `setSupportMultipleWindows={false}`, `injectedJavaScriptBeforeContentLoaded` SHALL remain unchanged. The perf props SHALL be additive only (보안/쿠키/브리지 프롭과 무충돌 — 리서치 [높음 2]). UNIFY-001 R-U1 이 정의하는 perf 프롭 집합(`cacheEnabled`/`cacheMode`/`androidLayerType`/`domStorageEnabled`)과 **중복되는 항목은 UNIFY-001 의 정의를 따르고**, 본 요구는 그 위에 `decelerationRate`/`overScrollMode`/텍스트선택·줌 비활성화를 **추가**한다(이중 정의 금지 — 충돌 시 UNIFY-001 이 권위).

### M2. 로딩 체감 (티어 1 — 진입 흰 플래시 제거)

- **R-NF2 (Event-driven + Unwanted 혼합)** `[MODIFY] WebViewShell.tsx` + `[MODIFY] BridgedWebView.tsx` 호출부 + `[MODIFY] apps/mobile/app/_layout.tsx`: The WebView SHALL render a brand-colored skeleton during load via `startInLoadingState={true}` + `renderLoading` (흰화면 → 의도된 스켈레톤; `renderLoading` 은 `startInLoadingState` 없으면 미동작). **WHEN** `onLoadEnd` fires, the app SHALL fade the WebView content in via opacity transition (흰 깜빡임 제거). The Expo splash SHALL hand off without a gap: `preventAutoHideAsync()` (이미 전역 스코프 — `_layout.tsx:28`) → `hideAsync()` SHALL be called with a fade option synced to the shared-WebView ready signal (현재 `BridgedWebView.tsx:199-201` 의 `hideAsync` 를 fade 옵션 + ready 신호 동기화로 강화 — splash→콘텐츠 갭 제거). **IF** the iOS WebView content process terminates (`onContentProcessDidTerminate`), **THEN** the app SHALL recover by reloading the current route rather than showing a blank screen (long-lived WebView 의 iOS 빈화면 안전장치). **Note (device-gated 검증 필요):** RN 0.85 / RNWebView 13.16 조합에서 `onContentProcessDidTerminate` 콜백의 실제 발화 여부는 검증 대상이다(리서치 §1 — GitHub #2559 회귀 보고). The fade/skeleton SHALL NOT introduce a hard WebView reload (비리마운트 불변 보존 — UNIFY-001 OD-1).

### M3. 워밍업 + 선인증 (티어 2 — Shopify 패턴, 진입 즉시 콘텐츠)

- **R-NF3 (Event-driven + State-driven 혼합)** `[MODIFY] _layout.tsx` 부팅 경로 + `[MODIFY] BridgedWebView.tsx:182-208` 콜드스타트: **WHEN** the app starts, the app SHALL pre-instantiate the shared WebView in a background/hidden state and SHALL complete the auth handshake (SecureStore 토큰 로드 → `injectRestore`) **before the first visible screen is presented**, so that entry shows authenticated content immediately rather than a serial cold-boot gap (Shopify 워밍업·선인증 패턴 — 리서치 §0/티어 2; 진단 [중간 4] "토큰 로드·핸드셰이크가 first paint 를 직렬 차단" 정면 해소). This SHALL strengthen UNIFY-001 R-U4 (앱당 1회 핸드셰이크) into a **PRE-warmed** handshake — the once-per-app handshake is moved earlier (부팅 시점) rather than triggered on first screen mount. **WHILE** running on iOS, the app SHALL guard against out-of-memory by keeping the warmed WebView pool size ≤ 2 (iOS OOM 가드 — 리서치 티어 2). The pre-warm SHALL NOT change auth semantics (`AuthContext.isSignedIn` 도출 의미 보존) and SHALL NOT mount a second persistent WebView (워밍업된 인스턴스가 곧 공유 인스턴스 — UNIFY-001 단일 인스턴스 불변 보존). **Note:** 본 요구는 UNIFY-001 의 단일 핸드셰이크를 **시점만 앞당기는 강화**이며, UNIFY-001 미적용 시 효과가 제한된다(전제 의존).

### M4. 네이티브 체감 전환 + 제스처 (티어 2 — 런타임 감각)

- **R-NF4 (Event-driven + Unwanted 혼합)** `[NEW] apps/web` 전환/제스처 레이어 (웹 측, 최소 추가) + `[EXISTING] _layout.tsx` 네이티브 chrome: **WHEN** the web performs an SPA route push/pop inside the shared WebView, the web SHALL animate the transition via the View Transitions API (`document.startViewTransition()`) with forward/back direction (`types`) to produce a native slide push/pop feel. **WHERE** the user has `prefers-reduced-motion: reduce`, the app SHALL skip the view transition (접근성 가드). The web SHALL remove transition flash between routes via snapshot/skeleton (Shopify 스냅샷 방식 — 공유 WebView 라 state 유지로 상대적 용이). The app SHALL resolve gesture conflicts: iOS swipe-back vs horizontal scroll SHALL be disambiguated via `touch-action: pan-x` on horizontally-scrollable regions; pull-to-refresh SHALL be gated on `scrollTop === 0`; status-bar tap SHALL scroll-to-top; tap latency SHALL use `touch-action: manipulation` (FastClick 금지 — Next 기본 viewport 로 300ms 탭 지연 이미 해결, 리서치 §5). View Transitions SHALL improve **perceived** feel only and SHALL NOT be claimed to shorten actual load time (정직성 — 리서치 티어 2). 본 전환 레이어는 웹 UI 를 재작성하지 않고 **최소 추가**(전환 트리거 + CSS)만 한다.

### M5. 콘텐츠 측 비용 (티어 3 — hydration/렌더 비용 제거)

- **R-NF5 (Ubiquitous + Optional 혼합)** `[MODIFY] apps/web/next.config.ts` + `[MODIFY] apps/web` 긴 리스트/인터랙션: The web SHALL enable Next.js PPR + Suspense streaming (`cacheComponents`) so that a static shell paints immediately and the hydration step is removed/reduced for the entry surface (LCP render-delay=CPU/hydration 지배 직격 — 진단 baseline §4, 리서치 티어 3). The web SHALL apply `content-visibility:auto` + `contain-intrinsic-size` on long lists (스크롤 부드러움 + INP — web.dev 렌더 232→30ms 사례). The web SHALL maintain INP/main-thread hygiene — `transform`/`opacity` 기반 애니메이션, 무거운 핸들러 yield, layout thrash 회피 — targeting INP P75 ≤ 200ms. **Where** native asset-intercept caching (.js 청크 프리캐시 — Android `shouldInterceptRequest` / iOS `WKURLSchemeHandler`) is implemented, it SHALL be platform-native and is an **OPTIONAL, higher-effort** item flagged for a separate SPEC — it is NOT part of this SPEC's acceptance gate (비목표 참조). PPR/`cacheComponents` 적용은 기존 페이지 동작·라우트 트리를 회귀시키지 않는다(웹 동작 보존).

---

## 델타 마커 (변경 분류)

| 마커 | 대상 | 내용 | 티어 |
|------|------|------|------|
| `[MODIFY]` | `WebViewShell.tsx` props | perf 프롭(`androidLayerType`/`decelerationRate`/`overScrollMode`/`domStorageEnabled`/`cacheMode`/텍스트선택·줌 off) 추가. 보안/쿠키/브리지 프롭 무변경. UNIFY-001 중복 항목은 UNIFY-001 정의 우선. | 1 |
| `[MODIFY]` | `WebViewShell.tsx` + `BridgedWebView.tsx` 호출부 | `startInLoadingState`+`renderLoading` 스켈레톤 + `onLoadEnd` opacity 페이드인 + `onContentProcessDidTerminate` 복구. | 1 |
| `[MODIFY]` | `_layout.tsx` splash | `hideAsync` 에 fade 옵션 + 공유 WebView ready 신호 동기화(현 `preventAutoHideAsync` 보존). | 1 |
| `[MODIFY]` | `_layout.tsx` 부팅 + `BridgedWebView.tsx:182-208` 콜드스타트 | 핸드셰이크를 부팅 시점 사전 워밍업으로 선행(UNIFY-001 R-U4 강화). iOS OOM 풀 ≤2. | 2 |
| `[NEW]` | `apps/web` 전환/제스처 레이어 (최소 추가) | View Transitions API push/pop + reduced-motion 가드 + 스냅샷 플래시 제거 + 제스처 충돌 정리(`touch-action`/PTR/상태바 탭). | 2 |
| `[MODIFY]` | `apps/web/next.config.ts` + 긴 리스트/인터랙션 | PPR+`cacheComponents` 스트리밍 + `content-visibility:auto` + INP 위생. | 3 |
| `[EXISTING]` | UNIFY-001 공유 WebView·네이티브 탭바·핸드셰이크 | 변경 없이 전제로 의존(본 SPEC 이 강화만, 재지정 안 함). | — |
| `[OPTIONAL]` | 네이티브 에셋 인터셉트 캐싱 | 플랫폼-네이티브 고난도 — 별도 SPEC 후보로 플래그만(게이트 제외). | 3 |

---

## 성능 측정 프로토콜 / KPI

> [REQUIRED] 본 SPEC 이 판정받는 지표. 웹 측 지표는 **지금 측정**(chrome-devtools — `.moai/reports/webview-native-feel-baseline.md` 로 병렬 캡처 중), WebView 내부 체감 지표는 **device-gated**(실기기 only). acceptance 는 before→after 델타를 참조한다.

### 측정 프로토콜 (재사용 — `client-bundle-hydration-baseline.md` §0)

- **방법**: `navigate_page(reload)` + Performance API(`evaluate_script`). performance trace reload 는 LCP 과대측정이므로 **navigate 방식 통일**(§0 동일).
- **조건 매트릭스**: CPU throttle {1x 데스크톱, **4x 모바일 WebView 근사**} × 캐시 {cold=ignoreCache true, warm=false}. 주 baseline 은 4x.
- **반복**: 각 조건 최소 3회, 첫 cold 1회는 CDN warm-up outlier 처리, 중앙값/범위로 보고.
- **재측정 스니펫**: `client-bundle-hydration-baseline.md` 부록 보존(동일 재현).
- **측정 변동성 경고**: 동일 조건에서도 LCP 출렁임 → 단일 측정 비교 금지, before/after 동일 방식 필수.

### KPI 집합 (native-feel 확장)

| KPI | 정의 | 측정 채널 | 목표/판정 |
|-----|------|-----------|-----------|
| **First Load JS (transfer)** | 압축 전송 JS(KB) — `/home` 빈 계정 | 자동(번들/네트워크) | before→after 감소(PPR/streaming 후) |
| **First Load JS (decoded)** | 파싱 대상 decoded JS(KB) | 자동(번들) | before→after 감소(hydration 비용 ↓) |
| **cold-start FCP** | first-contentful-paint(4x cold) | 자동(웹) + device-gated(실 WebView) | 웹 측 before→after; 실기기는 게이트 |
| **domInteractive (hydration 근사)** | JS 평가 완료(4x) | 자동(웹) | PPR 후 감소(hydration 제거) |
| **LCP** | largest-contentful-paint(4x) | 자동(웹) | render-delay 비중 감소 |
| **탭 soft-nav 전환 시간** | 탭/상세 전환 체감 시간 | device-gated(실 WebView) | View Transitions 후 부드러움(게이트) |
| **INP (P75)** | Interaction to Next Paint | 자동(웹 lab) + device-gated(실 체감) | **P75 ≤ 200ms** |
| **scroll long-task / jank** | 스크롤 중 long task / 프레임 드롭 | device-gated(실 WebView, fps) | `androidLayerType`/`content-visibility` 후 jank 감소 |
| **WebView 인스턴스 / onLoadStart** | 콜드스타트 1회 후 추가 발화 | 자동(계측 — UNIFY-001 게이트 재사용) | 워밍업 후에도 0회 증가(비리마운트 보존) |

> **분리 원칙**: 웹 측 지표(번들/정적/빌드 + chrome-devtools 4x)는 **AUTO** 게이트. WebView 내부 지표(실기기 콜드스타트·스크롤 fps·전환 부드러움·실 INP 체감)는 **DEVICE-GATED** — 자동 불가, iOS 시뮬레이터/실기기 종단으로만 확정(moyura WebView SPEC 관행).

---

## 설계 노트

- **티어→모듈 사상 추적.** 리서치 티어 1(즉시·저비용·고효과) = M1(perf 프롭)+M2(로딩 체감); 티어 2(중비용·네이티브 감각 핵심) = M3(워밍업·선인증)+M4(전환·제스처); 티어 3(고비용) = M5(콘텐츠 측 PPR/INP, +optional 네이티브 캐싱). best practice 는 "마법 prop 이 아니라 3축 조합"(리서치 §0)이므로 단일 모듈로 묶지 않고 효과·난이도별로 분리했다.
- **UNIFY-001 과의 경계.** M1 의 `cacheEnabled`/`cacheMode`/`androidLayerType`/`domStorageEnabled` 는 UNIFY-001 R-U1 과 **겹친다**. 이중 정의를 피하려 본 SPEC 은 "겹치는 항목은 UNIFY-001 정의 우선, 본 SPEC 은 `decelerationRate`/`overScrollMode`/텍스트선택·줌 비활성화를 추가"로 명시한다(R-NF1). M3 의 핸드셰이크는 UNIFY-001 R-U4(앱당 1회)를 **시점만 앞당기는** 강화이지 재정의가 아니다.
- **워밍업의 단일 인스턴스 불변.** Shopify 패턴의 핵심은 "WebView 를 버리지 않고 재사용(TransportableView)"이다(리서치 §0/§3). 우리는 UNIFY-001 의 셸 레벨 단일 인스턴스를 **부팅 시점에 미리 만들고 인증까지 채운** 뒤 첫 화면에서 그대로 보여준다 — 두 번째 인스턴스를 만들지 않는다(OOM 풀 ≤2 는 전환 순간의 임시 상한). 워밍업된 인스턴스 == 공유 인스턴스.
- **전환은 체감만.** View Transitions 는 실제 로드를 단축하지 않는다(리서치 티어 2 정직성). 실제 단축은 M3(워밍업)·M5(hydration 제거)가 한다. M4 는 "이미 빠른 전환을 네이티브처럼 보이게" 마감하는 역할이다.
- **웹 측 최소 추가.** M4 전환 레이어는 웹 UI 재작성 0 — `startViewTransition` 래핑 + `prefers-reduced-motion` 가드 + `touch-action` CSS 만 추가한다(UNIFY-001 Non-Goal "웹 최소 추가" 계약과 일치). M5 PPR 은 페이지 동작 보존하며 렌더 모델만 바꾼다.
- **measure 정직성.** 모든 웹 측 정량치는 데스크톱 Chrome 4x throttle 근사이고 실 WebView 측정은 device-gated(진단 §6 / baseline §6.3 의 정직한 해석 계승). "번들 다이어트는 확정적 성과, 체감 개선 폭은 디바이스 trace 로만 확정"이라는 baseline 의 결론을 본 SPEC 도 동일하게 적용한다.

---

## 리스크

| 리스크 | 심각도 | 내용 · 대응 |
|--------|--------|-------------|
| **UNIFY-001 미확정 의존** | High | 본 SPEC 의 M3(워밍업)·M4(전환)·M2(splash 핸드오프)는 공유 단일 WebView(UNIFY-001, 현재 draft)를 전제한다. UNIFY-001 이 미적용/변경되면 본 SPEC 의 핵심 효과가 무력화된다. **대응: 전제를 Non-Goal 에 명시(재지정 안 함), M1·M5 일부는 UNIFY-001 독립 적용 가능하도록 분리, 실행 순서 = UNIFY-001 먼저 → 본 SPEC.** |
| **`onContentProcessDidTerminate` 미발화** | High | iOS 콘텐츠 프로세스 복구는 long-lived WebView 의 필수 안전장치인데, RN 0.85/RNWebView 13.16 조합에서 콜백이 실제로 발화하는지 미검증(리서치 §1 — GitHub #2559 회귀). 미발화 시 iOS 빈화면 복구 불가. **대응: device-gated 검증을 AC 에 명시, 미발화 시 대체 복구(onError/주기적 health-ping) 폴백 OD 로 확정.** |
| **워밍업 OOM (iOS)** | High | 부팅 시점에 WebView 를 미리 띄우면 iOS 메모리 압박 → OOM 위험(리서치 티어 2). 풀 ≤2 상한으로 완화하나 실 기기 메모리는 device-gated. **대응: 풀 ≤2 불변(R-NF3), 워밍업 인스턴스 == 공유 인스턴스(추가 인스턴스 0), 실기기 메모리 trace 로 확정.** |
| **PPR/`cacheComponents` 회귀** | Medium | Next.js 16 PPR 활성화가 기존 페이지(동적 데이터·세션 가드 `requireNamedSession`)와 충돌해 동작 회귀 가능. **대응: PPR 은 정적 셸만 프리렌더(동적 부분 Suspense 경계), 세션 가드/동적 데이터 무회귀를 자동 게이트(빌드+동작)로 검증, 점진 적용.** |
| **View Transitions desync / 깜빡임** | Medium | SPA View Transitions 가 공유 WebView 의 비리마운트 모델과 충돌하거나 reduced-motion 미가드 시 멀미 유발. iOS 18+/Android System WebView same-document VT 지원 가정(리서치 티어 2)의 실 디바이스 편차. **대응: reduced-motion 가드 필수(R-NF4), 스냅샷 플래시 제거, device-gated 전환 부드러움 검증.** |
| **제스처 충돌 잔존** | Medium | iOS swipe-back vs 가로 스크롤, PTR vs 스크롤이 단일 WebView 에서 한 지점으로 모임(리서치 티어 2). `touch-action` 정리가 모든 케이스를 덮지 못할 수 있음. **대응: 가로 스크롤 영역 `pan-x`, PTR `scrollTop===0` 게이팅, device-gated 제스처 검증.** |
| **measure 한계** | Medium | 모든 웹 측 정량치는 데스크톱 Chrome 4x 근사, 실 WebView 미측정(진단 §6). 체감 개선 폭은 디바이스 trace 로만 확정. **대응: KPI 를 AUTO(웹) vs DEVICE-GATED(체감)로 분리, before→after 델타 + 디바이스 게이트.** |

---

## Open Decisions / Risks

| ID | 주제 | 결정/상태 | 영향 |
|----|------|-----------|------|
| **OD-1** | `cacheMode` stale 정책 | **권장: `LOAD_DEFAULT`(또는 `LOAD_CACHE_ELSE_NETWORK` 은 재방문 즉시성 ↑ 이나 stale 위험).** 공유 WebView + 웹 SPA 라우팅이라 캐시 즉시성보다 최신성이 중요한 인증/세션 화면이 많다. 정확한 모드는 구현 시 화면별 트레이드오프로 확정. | 잘못 선택 시 stale 콘텐츠 노출(특히 세션·모임 데이터). |
| **OD-2** | 텍스트선택/줌 비활성화 메커니즘 | **권장: 웹 측 CSS(`user-select:none` 선택 영역 한정) + viewport `user-scalable` 정책 — 단, `touch-action:none` 전역·접근성 줌 차단은 금지(리서치 §5).** WebView prop(`scalesPageToFit` 등) vs CSS 중 어디서 할지 구현 시 확정. | 전역 줌 차단 시 저시력 접근성 위반. |
| **OD-3** | `onContentProcessDidTerminate` 미발화 폴백 | **상태: device-gated 검증 후 확정.** 콜백 발화 시 → 현재 라우트 reload. 미발화 시 → `onError` 경로 재사용 또는 health-ping 폴백. 실기기 검증 전까지 미확정(리서치 §1 회귀 보고). | iOS 빈화면 복구 가능 여부의 핵심. |
| **OD-4** | 워밍업 시점 vs splash 유지 | **권장: 부팅 모듈 평가 시점에 워밍업 시작 + splash 는 워밍업 ready(또는 8s 타임아웃)까지 유지.** 현 `preventAutoHideAsync`(`_layout.tsx:28`)를 워밍업 완료 신호에 동기화. 정확한 ready 신호(핸드셰이크 synced/none vs 첫 paint)는 구현 시 확정. | 너무 늦게 해제하면 부팅 체감 지연, 너무 일찍 해제하면 흰 플래시. |
| **OD-5** | View Transitions 적용 범위 | **권장: 탭 전환(forward/back 방향) + 상세 push/pop 에 한정. 모달/오버레이는 별도.** 전 전환에 적용하면 멀미/성능 부담. reduced-motion 가드 필수. | 과적용 시 체감 저하·접근성 문제. |
| **OD-6** | PPR 적용 surface 우선순위 | **권장: 진입 surface(`/home` 탭 + 콜드스타트 첫 화면)부터 점진 적용.** 전 페이지 일괄 PPR 은 회귀 위험. 동적 데이터/세션 가드는 Suspense 경계로 분리. | 일괄 적용 시 세션 가드·동적 데이터 회귀. |

---

## Sources (출처)

- `.moai/reports/webview-native-feel-best-practices.md` — 본 SPEC 의 **1차 근거**. §0 핵심 통찰(3축 조합·Shopify 6→1.4s), §1 현재 코드 gap 표, §2 티어 1/2/3 기법, §3 실제 하이브리드 사례(Shopify/Tata 1mg/Coinbase), §5 검증 정직성(folklore 기각). (리포트 직접 확인 2026-06-25)
- `.moai/reports/webview-rn-rendering-performance.md` — 근본 진단. [높음 2] perf 프롭 전무, [중간 4] 콜드스타트 직렬 차단, §4 render-delay=CPU/hydration, §6 measure 한계. (리포트 직접 확인)
- `.moai/reports/client-bundle-hydration-baseline.md` — §0 측정 프로토콜(navigate+Performance API, 4x throttle, cold/warm 매트릭스, 재측정 스니펫), §6 정직한 해석(번들 확정 vs 체감 디바이스). 본 SPEC 측정 프로토콜의 출처. (리포트 직접 확인)
- `.moai/specs/SPEC-WEBVIEW-UNIFY-001/spec.md` + `acceptance.md` — **전제 의존 SPEC**(공유 단일 WebView). R-U1(perf 프롭)·R-U4(앱당 1회 핸드셰이크)를 본 SPEC 이 강화. device-gated AC 패턴·경쟁안 분리 계승. (.moai/specs/ 직접 확인)
- `.moai/specs/SPEC-WEBVIEW-SHELL-001/spec.md` + `acceptance.md` — 프로젝트 SPEC 컨벤션 미러 원본(frontmatter, HISTORY, Background/Goal/Non-Goals, EARS+[DELTA], 모듈 ≤5, AC 1:1, device-gated 패턴). (.moai/specs/ 직접 확인)
- `apps/mobile/components/WebViewShell.tsx` — 현 WebView props(`:105-133` 보안/쿠키/브리지만, perf 프롭 부재), OD-1 비리마운트(`key` 없음, `:108`). (코드 직접 확인)
- `apps/mobile/components/BridgedWebView.tsx` — 콜드스타트 핸드셰이크(`:182-208`), `onLoadEnd`/`onError` splash 해제(`:243-256`), 에러 재시도(`:220` `handleRetry`). (코드 직접 확인)
- `apps/mobile/app/_layout.tsx` — Expo splash `preventAutoHideAsync`(`:28`), `Stack` `animation:"none"`(`:87`), 알림 탭 라우팅(`:73-81`). (코드 직접 확인)
- `apps/web/app/(main)/layout.tsx` — 셸 모드 감지·탭바 숨김(`:25`), 세션 가드 `requireNamedSession`(`:38`). (코드 직접 확인)
- `apps/web/next.config.ts` — `reactCompiler:true` 만 활성, PPR/`cacheComponents` 미사용(`:6`). (코드 직접 확인)
- `apps/web/app/globals.css` — light 토큰(브랜드색 `--primary:#ff6b35`), `h-dvh-fixed`/`pb-bottom-tab` 유틸. 스켈레톤 브랜드색·`content-visibility` 적용 지점. (코드 직접 확인)
- 리서치 Sources (전부 WebFetch 검증 — 본 SPEC 의 best-practice 출처):
  - react-native-webview Reference — https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md
  - Shopify Engineering — Mobile Bridge (P75 6→1.4s) — https://shopify.engineering/mobilebridge-native-webviews
  - Expo Docs — SplashScreen — https://docs.expo.dev/versions/latest/sdk/splash-screen/
  - Next.js — Caching / Partial Prerendering (v16) — https://nextjs.org/docs/app/getting-started/caching
  - web.dev — content-visibility — https://web.dev/articles/content-visibility
  - web.dev — Optimize INP — https://web.dev/articles/optimize-inp
  - Chrome — Same-document view transitions (SPA) — https://developer.chrome.com/docs/web-platform/view-transitions/same-document
  - web.dev — View transitions for SPAs — https://web.dev/learn/css/view-transitions-spas
  - MDN — View Transition API — https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
  - MDN — touch-action — https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
  - Chrome — 300ms tap delay gone away — https://developer.chrome.com/blog/300ms-tap-delay-gone-away
  - NN/g — Response Time Limits — https://www.nngroup.com/articles/response-times-3-important-limits/
  - Games24x7 — Initial Load Time for Micro Front-End in RN (3G 30~40%) — https://medium.com/@Games24x7Tech/enhancing-initial-load-time-for-micro-front-end-pages-in-react-nativ-8ec1744e4536
  - Tata 1mg — Native-like WebView Part 1 / Part 2 — https://medium.com/1mgofficial/hybrid-application-native-like-experience-with-webview-9896f61881cb
</content>
</invoke>
