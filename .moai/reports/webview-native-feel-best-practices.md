# WebView를 네이티브처럼 — best practice 웹 리서치 보고

- 대상: `apps/mobile`(react-native-webview 13.16.1 / RN 0.85.3 / Expo ~56) ↔ `apps/web`(Next.js 16 / React 19) 하이브리드
- 작성일: 2026-06-25 (KST)
- 방식: 2축 웹 리서치(진입/로딩 체감 · 런타임 네이티브 감각), 전 출처 WebFetch 검증
- 근거 진단: `webview-rn-rendering-performance.md`. 관련 SPEC: `SPEC-WEBVIEW-UNIFY-001`(공유 WebView, 본 기법 대부분의 전제)
- 후속: `SPEC-WEBVIEW-NATIVE-FEEL-001`(본 문서를 근거로 작성), 웹 측 baseline 실측

---

## 0. 핵심 통찰

가장 권위 있는 1차 사례 **Shopify Mobile Bridge**(2025-04, P75 로드 6초→1.4초)가 우리가 가려는 **공유 long-lived WebView(A안)** 방향과 정확히 일치한다. 결정타는 우리 진단의 핵심 병목과 동일:

> "auth 리다이렉트가 first paint를 직렬로 막는다" → 앱 시작 시 **백그라운드에서 WebView를 미리 띄워 인증까지 선행** + 인스턴스를 버리지 않고 **재사용(TransportableView)**.

best practice는 마법 prop이 아니라 **(1) 워밍업·선인증으로 진입 비용을 화면 밖으로 옮기고, (2) 단일 인스턴스를 유지하며, (3) 전환·로딩을 의도된 시각요소로 가리는** 3축 조합이다.

---

## 1. 우리 현재 코드 gap (`apps/mobile/components/WebViewShell.tsx`)

| 기법 / prop | 현재 상태 | best practice | 위치 |
|---|---|---|---|
| `key` 없음(비리마운트) | 적용됨 | 권장 — 유지 | `WebViewShell.tsx:108` |
| `cacheEnabled` | 기본 true | 공유 WebView로 자동 수혜 | — |
| 쿠키 보존 | `sharedCookies`/`thirdParty` | 유지 | `:119-120` |
| `androidLayerType="hardware"` | 없음 | GPU 렌더 → 스크롤 부드러움 | `:105` |
| `decelerationRate="normal"`(iOS) | 없음 | iOS 네이티브 감속 일치 | `:105` |
| `overScrollMode`(Android) | 없음 | 글로우/바운스 정책 | `:105` |
| `cacheMode=LOAD_CACHE_ELSE_NETWORK` | 없음 | 재방문 즉시성(stale 주의) | `:105` |
| `domStorageEnabled` | 없음 | 웹 캐시 전략 보장 | `:105` |
| `startInLoadingState`+`renderLoading` | 없음(상태로만) | 흰화면→스켈레톤 | `:105`+호출부 |
| `onContentProcessDidTerminate` | 없음 | iOS 빈화면 복구(필수) | `:105` |
| 텍스트선택/줌 비활성화 | 없음 | 앱 같은 정적 느낌 | `:105` |
| `onLoadEnd` opacity fade-in | 없음 | 흰 깜빡임 제거 | 호출부(`BridgedWebView`) |

---

## 2. 적용 우선순위 (효과 × 난이도)

### 티어 1 — 즉시·저비용·고효과 (quick wins)
- **WebView perf props 일괄 추가** — `androidLayerType="hardware"`, iOS `decelerationRate="normal"`, `overScrollMode`, `domStorageEnabled`, 텍스트선택/줌 off. `WebViewShell.tsx:105` 한 곳, 보안 prop과 무충돌. *낮음 / 중상(특히 Android 스크롤)*
- **`renderLoading`+`startInLoadingState` 브랜드색 스켈레톤 + `onLoadEnd` 페이드인** — 흰 플래시를 의도된 스켈레톤으로 대체. `renderLoading`은 `startInLoadingState={true}` 없으면 미동작. *낮음 / 큼 (가장 빠른 win)*
- **Expo splash 핸드오프 동기화** — `preventAutoHideAsync()`(전역 스코프) → 공유 WebView 준비 신호에 `hideAsync()` + `setOptions({fade:true})`. splash→흰화면 갭 제거. *낮음 / 큼*
- **`onContentProcessDidTerminate` 복구** — long-lived WebView의 iOS 빈화면 안전장치(우리 RN 0.85/RNWebView 13.16 조합 호출 여부 검증 필요 — GitHub #2559 회귀 보고). *낮음 / 안정성*
- **`touch-action: manipulation`**(CSS) — 탭 즉발. FastClick은 obsolete, 도입 금지. *매우 낮음 / 중*
- **`content-visibility:auto`+`contain-intrinsic-size:auto`**(긴 리스트) — 스크롤 부드러움+INP. web.dev 사례 렌더 232→30ms. *낮음 / 중상*

### 티어 2 — 중비용·구조 (네이티브 감각의 핵심)
- **Shopify식 워밍업 + 선인증** — 앱 시작 시 숨김 공유 WebView로 auth handshake 미리 완료. "토큰 주입이 first paint 직렬 차단" 정면 해소. **A안 SPEC과 결합**. *중~높음 / 매우 큼* — iOS OOM 주의(풀 1~2개)
- **View Transitions API로 SPA 전환을 네이티브 슬라이드 push/pop화** — `document.startViewTransition()`, `types`로 forward/back 방향, `prefers-reduced-motion` 가드. iOS 18+/Android System WebView 모두 same-document VT 지원. **체감만** 개선(실제 로드 단축 아님). *중 / 상*
- **전환 플래시 제거(Shopify 스냅샷 방식)** — 라우트 전환 사이 빈화면을 스냅샷/스켈레톤으로 가림. 공유 WebView라 state 유지되어 상대적 용이. *중 / 상*
- **제스처 충돌 정리** — iOS swipe-back(`allowsBackForwardNavigationGestures`) vs 가로 스크롤(`touch-action:pan-x`), PTR을 `scrollTop===0` 게이팅, 상태바 탭 scroll-to-top 보장. 단일 WebView라 충돌 지점 한 곳으로 모임. *중상 / 상*

### 티어 3 — 고비용·큰 작업
- **Next.js PPR + Suspense 스트리밍**(`cacheComponents`) — 정적 셸 즉시 + hydration 단계 제거. **LCP render-delay(CPU/hydration) 지배** 직격. *중~높음 / 큼*
- **네이티브 에셋 인터셉트 캐싱**(.js 청크 프리캐시) — Android `shouldInterceptRequest`/iOS `WKURLSchemeHandler`. 3G 30~40% 단축 사례. *높음 / 중(네트워크 한정)*
- **INP/메인스레드 위생** — 무거운 핸들러 yield(`requestAnimationFrame`+`setTimeout`), `transform`/`opacity` 애니메이션, layout thrash 회피. INP 목표 P75 200ms 이하. *중 / 상*

---

## 3. 실제 하이브리드 앱 사례

- **Shopify Mobile Bridge** — TransportableView(WebView를 mount 안 하고 화면 간 이동), 백 네비 시 스냅샷으로 플래시 제거, 모달은 네이티브 애니 완료까지 렌더 지연, 네이티브 타이틀바(웹이 bridge로 전달), 배경 프리로드+캐싱(6s→1.4s).
- **Tata 1mg** — CSS skeleton/shimmer, Framer Motion spring 전환, 첫 바이트 도착 시 postMessage로 네이티브 로더 제거, WebView Singleton + object pool.
- **Coinbase**(2차 요약) — 단일 공유 `Animated.Value(ScrollY)`로 복잡 스크롤 관리(원문 403, 단정 인용 회피).

---

## 4. SPEC 연결

기법 대부분은 **`SPEC-WEBVIEW-UNIFY-001`(A안) 전제** 위에서 동작:
- 티어 1 perf props → A안 R-U1에 포함
- Shopify 워밍업·선인증 → A안 R-U4(앱당 1회 핸드셰이크)를 선제 워밍업으로 강화
- View Transitions → A안 R-U2/R-U3(SPA 네비/히스토리)를 네이티브 슬라이드로 마감
- onContentProcessDidTerminate → A안 OD-1/OD-2(단일 WebView 취약성·복원) 안전장치

---

## 5. 검증 정직성 (folklore 기각)

- **300ms 탭 지연**: Next.js 기본 viewport(`width=device-width`)로 이미 해결 — FastClick 불필요
- **"스켈레톤이 spinner보다 9~12% 빠름 / Facebook 300ms"**: 1차 출처(NN/g) 미확인 2차 재인용 → 근거 사용 금지. 확실한 1차 근거는 NN/g "피드백 있는 대기는 11~15% 빠르게 느껴짐"
- **iOS WKWebView Service Worker / 다중 리치 WebView**: 실제 플랫폼 제약(SW 지원·OOM) → iOS는 SW 캐싱보다 네이티브 인터셉트가 안전
- `touch-action:none` 전역: 접근성(저시력 줌) 위반, 금지

---

## Sources (전부 WebFetch 검증)

- react-native-webview Reference — https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md
- Shopify Engineering — Mobile Bridge (P75 6→1.4s) — https://shopify.engineering/mobilebridge-native-webviews
- Expo Docs — SplashScreen — https://docs.expo.dev/versions/latest/sdk/splash-screen/
- Next.js — Caching / Partial Prerendering (v16.2.9) — https://nextjs.org/docs/app/getting-started/caching
- web.dev — content-visibility — https://web.dev/articles/content-visibility
- web.dev — Optimize INP — https://web.dev/articles/optimize-inp
- web.dev — Caching (Learn PWA) — https://web.dev/learn/pwa/caching
- Chrome — Same-document view transitions (SPA) — https://developer.chrome.com/docs/web-platform/view-transitions/same-document
- web.dev — View transitions for SPAs — https://web.dev/learn/css/view-transitions-spas
- MDN — View Transition API — https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
- MDN — touch-action — https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action
- Chrome — 300ms tap delay gone away — https://developer.chrome.com/blog/300ms-tap-delay-gone-away
- NN/g — Skeleton Screens 101 — https://www.nngroup.com/articles/skeleton-screens/
- NN/g — Response Time Limits — https://www.nngroup.com/articles/response-times-3-important-limits/
- Games24x7 — Initial Load Time for Micro Front-End in RN (3G 30~40%) — https://medium.com/@Games24x7Tech/enhancing-initial-load-time-for-micro-front-end-pages-in-react-nativ-8ec1744e4536
- Tata 1mg — Native-like WebView Part 1 / Part 2 — https://medium.com/1mgofficial/hybrid-application-native-like-experience-with-webview-9896f61881cb
- (2차) Coinbase RN — https://www.fullstack.com/labs/resources/blog/why-coinbase-built-their-mobile-app-with-react-native
