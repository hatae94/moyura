# SPEC-WEBVIEW-NATIVE-FEEL-001 — Acceptance Criteria

> 각 AC 는 spec.md 의 EARS 요구사항과 1:1 대응한다(R-NF1~NF5 ↔ AC-NF1~NF5). 본 SPEC 은 UNIFY-001 의 공유 단일 WebView 위에 **네이티브 체감 레이어를 부가**한다 — 보안 약화 0, 기존 동작 회귀 0 이 제약, 체감(perceived) 개선이 목표.
> **검증 채널 분리(repo 관행):** **자동/AUTO**(typecheck 0 / 프롭·설정 존재 정적 검사 / `expo export` 번들 OK / `next build` OK / chrome-devtools 4x 웹 측 KPI / 번들 크기) + **수동 전용 — DEVICE-GATED**(실 WebView 콜드스타트 체감·스크롤 fps·전환 부드러움·제스처·iOS 콘텐츠 프로세스 복구 — iOS 시뮬레이터/실기기 종단으로만 확정. moyura WebView SPEC 관행 — SHELL-001 AC-S3, UNIFY-001 동일. iOS 시뮬레이터 우선, Android 체감은 게이트 보류 기록).
> **KPI 참조:** 각 AC 는 spec.md "성능 측정 프로토콜 / KPI" 의 before→after 델타를 참조한다. 웹 측 baseline 은 `.moai/reports/webview-native-feel-baseline.md`(병렬 캡처 중), 측정 프로토콜은 `client-bundle-hydration-baseline.md` §0 재사용.

---

## M1. WebView perf 프롭 (티어 1)

### AC-NF1 ↔ R-NF1 (perf 프롭 추가 + 보안 무변경)
- **Given** 현 `WebViewShell.tsx:105-133` — 보안/쿠키/브리지 프롭만 설정되고 perf 프롭이 전무(진단 [높음 2])
- **When** 공유 WebView 에 호스트 perf 프롭을 추가한다
- **Then** `androidLayerType="hardware"`, iOS `decelerationRate="normal"`, `overScrollMode`, `domStorageEnabled`, Android `cacheMode` 가 WebView 에 전달되고, 텍스트 선택 + user zoom 이 비활성화된다(앱 같은 정적 느낌 — OD-2 메커니즘).
- **And Then** 기존 보안 프롭(`originWhitelist`, `sharedCookiesEnabled`/`thirdPartyCookiesEnabled`, `setSupportMultipleWindows={false}`, `injectedJavaScriptBeforeContentLoaded`)이 **무변경**으로 유지된다(보안 약화 0).
- **And Then** UNIFY-001 R-U1 과 겹치는 항목(`cacheEnabled`/`cacheMode`/`androidLayerType`/`domStorageEnabled`)은 UNIFY-001 정의를 따르고 이중 정의하지 않으며, 본 AC 는 그 위에 `decelerationRate`/`overScrollMode`/텍스트선택·줌 비활성화를 추가한다.
- **And Then** `touch-action:none` 전역·FastClick 은 도입되지 않는다(리서치 §5 folklore 기각 — 접근성 보존).
- **자동/AUTO 검증**: typecheck 0; perf 프롭(`androidLayerType`/`decelerationRate`/`overScrollMode`/`domStorageEnabled`/`cacheMode`)이 WebView 에 전달됨(프롭 존재 정적 검사); 보안 프롭 4종 유지(정적 diff 부재); `touch-action:none` 전역 부재 + FastClick 의존성 부재(import/package.json 검사); `expo export` 번들 OK.
- **수동 전용 — DEVICE-GATED**: `androidLayerType="hardware"` 스크롤 jank 해소 + `decelerationRate="normal"` iOS 감속 체감 일치(scroll long-task/jank KPI — 실 WebView fps, 게이트 보류); 텍스트선택/줌 off 로 앱 같은 정적감(시각 — 자동 불가).

---

## M2. 로딩 체감 (티어 1)

### AC-NF2 ↔ R-NF2 (스켈레톤 + 페이드인 + splash fade + iOS 복구)
- **Given** 현 흰 플래시 노출 — `startInLoadingState`/`renderLoading` 미사용, `onLoadEnd` 페이드인 없음, splash `hideAsync` fade 옵션 없음(`BridgedWebView.tsx:199-201`), `onContentProcessDidTerminate` 미설정
- **When** 로딩 체감 레이어를 추가한다
- **Then** `startInLoadingState={true}` + `renderLoading` 으로 브랜드색(`--primary:#ff6b35`) 스켈레톤이 로드 중 렌더되고(흰화면 대체), `renderLoading` 이 `startInLoadingState` 없이 미동작하지 않도록 둘 다 설정된다.
- **And When** `onLoadEnd` 가 발화한다
- **Then** WebView 콘텐츠가 opacity 트랜지션으로 페이드인된다(흰 깜빡임 제거), 그리고 이 페이드/스켈레톤이 **hard WebView reload 를 유발하지 않는다**(비리마운트 보존 — UNIFY-001 OD-1).
- **And Then** Expo splash 가 갭 없이 핸드오프된다 — `preventAutoHideAsync()`(`_layout.tsx:28` 보존) → `hideAsync()` 가 fade 옵션 + 공유 WebView ready 신호 동기화로 호출된다(OD-4).
- **And When** iOS WebView 콘텐츠 프로세스가 종료된다(`onContentProcessDidTerminate`)
- **Then** 앱이 빈화면 대신 현재 라우트 reload 로 복구한다.
- **자동/AUTO 검증**: typecheck 0; `startInLoadingState={true}` + `renderLoading` 존재(정적 검사); `onLoadEnd` opacity 페이드 로직 존재; `hideAsync` 에 fade 옵션 전달; `onContentProcessDidTerminate` 핸들러 존재(현재 라우트 reload 분기 — 순수 단위 테스트 가능 시); 페이드/스켈레톤이 WebView 에 `key` 부여하지 않음(비리마운트 정적 검사); `expo export` 번들 OK.
- **수동 전용 — DEVICE-GATED**: 콜드스타트 흰 플래시 부재(스켈레톤→페이드인 시각), splash→콘텐츠 갭 부재(fade 핸드오프 체감); **iOS `onContentProcessDidTerminate` 실제 발화 여부 + 복구 동작**(RN 0.85/RNWebView 13.16 검증 — 리서치 §1 회귀, OD-3 폴백 확정 입력). cold-start FCP KPI 는 웹 측 AUTO + 실 WebView DEVICE-GATED 양쪽.

---

## M3. 워밍업 + 선인증 (티어 2 — Shopify 패턴)

### AC-NF3 ↔ R-NF3 (사전 워밍업 핸드셰이크 + iOS OOM 가드)
- **Given** 현 콜드스타트 핸드셰이크가 첫 화면 진입 시점에 직렬로 도는 모델(`BridgedWebView.tsx:182-208`, 진단 [중간 4])과 UNIFY-001 R-U4(앱당 1회 핸드셰이크)
- **When** 앱이 시작된다
- **Then** 공유 WebView 가 백그라운드/숨김 상태로 사전 인스턴스화되고, 인증 핸드셰이크(SecureStore 토큰 로드 → `injectRestore`)가 **첫 가시 화면 표시 전에** 선행 완료되어, 진입 시 직렬 콜드부팅 갭 없이 인증된 콘텐츠가 즉시 보인다(Shopify 워밍업·선인증).
- **And Then** 이것은 UNIFY-001 R-U4 의 앱당 1회 핸드셰이크를 **PRE-warmed** 핸드셰이크로 강화한 것이다 — 핸드셰이크가 첫 화면 마운트가 아니라 부팅 시점으로 앞당겨지며, 호출 횟수는 여전히 앱당 1회다(재정의 아님).
- **And While** iOS 에서 실행 중
- **Then** 워밍업된 WebView 풀 크기가 ≤ 2 로 유지된다(OOM 가드).
- **And Then** 사전 워밍업이 인증 의미(`AuthContext.isSignedIn` 도출)를 보존하고, 두 번째 영속 WebView 를 마운트하지 않는다(워밍업 인스턴스 == 공유 인스턴스 — UNIFY-001 단일 인스턴스 불변).
- **자동/AUTO 검증**: typecheck 0; 핸드셰이크 호출(`loadTokens`/`registerColdStartTokens`/`injectRestore`)이 앱 콜드스타트당 **1회** 호출되고 첫 화면 마운트 전 시점에 트리거됨을 계측(부팅 경로); 워밍업 후에도 WebView 인스턴스 1개(정적 검사 — UNIFY-001 게이트 재사용); 풀 상한 ≤2 로직 존재(정적/단위); `AuthContext.isSignedIn` 도출 순수 코어 무회귀; `expo export` 번들 OK.
- **수동 전용 — DEVICE-GATED**: 부팅→진입 시 인증된 콘텐츠 즉시 표시(직렬 갭 부재 체감), iOS 실기기 메모리 OOM 부재(워밍업 풀 ≤2 메모리 trace — 게이트), 토큰/세션 라이브 경로 정상(자동 불가).

---

## M4. 네이티브 체감 전환 + 제스처 (티어 2)

### AC-NF4 ↔ R-NF4 (View Transitions + reduced-motion + 제스처 충돌)
- **Given** 현 라우트 전환에 의도된 시각요소(스냅샷/View Transitions)가 없고, 제스처 충돌(swipe-back vs 가로 스크롤·PTR·상태바 탭) 정리가 없음
- **When** 공유 WebView 안에서 웹이 SPA 라우트 push/pop 을 수행한다
- **Then** 웹이 View Transitions API(`document.startViewTransition()`)로 forward/back 방향(`types`)을 적용해 네이티브 슬라이드 push/pop 체감을 만든다.
- **And Where** 사용자가 `prefers-reduced-motion: reduce` 인 경우
- **Then** 앱이 view transition 을 건너뛴다(접근성 가드).
- **And Then** 라우트 전환 사이 빈화면을 스냅샷/스켈레톤으로 가린다(전환 플래시 제거 — 공유 WebView state 유지로 용이).
- **And Then** 제스처 충돌이 정리된다: 가로 스크롤 영역에 `touch-action: pan-x`(iOS swipe-back 구분), PTR 은 `scrollTop === 0` 게이팅, 상태바 탭은 scroll-to-top, 탭 지연은 `touch-action: manipulation`(FastClick 금지 — Next 기본 viewport 로 300ms 해결).
- **And Then** View Transitions 는 **체감만** 개선하며 실제 로드 단축을 주장하지 않는다(정직성).
- **And Then** 본 전환 레이어는 웹 UI 를 재작성하지 않고 최소 추가(전환 트리거 + CSS)만 한다(UNIFY-001 "웹 최소 추가" 계약 일치).
- **자동/AUTO 검증**: typecheck 0; `next build` OK; `startViewTransition` 래핑 + `prefers-reduced-motion` 가드 존재(정적 검사); 가로 스크롤 영역 `touch-action:pan-x` + `touch-action:manipulation` CSS 존재; PTR `scrollTop===0` 게이팅 로직 존재; FastClick 의존성 부재; 웹 페이지 라우트 트리/디자인 무변경(최소 추가만 — diff 범위 검사).
- **수동 전용 — DEVICE-GATED**: 탭/상세 전환 슬라이드 push/pop 부드러움(탭 soft-nav 전환 시간 KPI — 실 WebView, 게이트), reduced-motion 시 전환 생략, 전환 플래시 부재, iOS swipe-back vs 가로 스크롤 비충돌, PTR scrollTop 게이팅, 상태바 탭 scroll-to-top(자동 불가 — 실기기 제스처).

---

## M5. 콘텐츠 측 비용 (티어 3)

### AC-NF5 ↔ R-NF5 (PPR/streaming + content-visibility + INP)
- **Given** 현 `next.config.ts` `reactCompiler:true` 만 활성(PPR/`cacheComponents` 미사용), 긴 리스트 `content-visibility` 미적용, LCP render-delay=CPU/hydration 지배(baseline §4)
- **When** 콘텐츠 측 렌더 비용을 줄인다
- **Then** Next.js PPR + Suspense 스트리밍(`cacheComponents`)이 활성화되어 정적 셸이 즉시 페인트되고 진입 surface 의 hydration 단계가 제거/감소된다(LCP render-delay 직격).
- **And Then** 긴 리스트에 `content-visibility:auto` + `contain-intrinsic-size` 가 적용된다(스크롤 부드러움 + INP — web.dev 렌더 232→30ms 사례).
- **And Then** INP/메인스레드 위생이 유지된다 — `transform`/`opacity` 애니메이션, 무거운 핸들러 yield, layout thrash 회피 — **INP P75 ≤ 200ms** 목표.
- **And Then** PPR/`cacheComponents` 적용이 기존 페이지 동작·라우트 트리·세션 가드(`requireNamedSession`)·동적 데이터를 회귀시키지 않는다(동적 부분 Suspense 경계 분리, 진입 surface 우선 점진 — OD-6).
- **And Where** 네이티브 에셋 인터셉트 캐싱이 구현되는 경우, 그것은 플랫폼-네이티브 **OPTIONAL·higher-effort** 항목으로 별도 SPEC 으로 플래그되며 **본 SPEC 의 게이트에 포함되지 않는다**.
- **자동/AUTO 검증**: typecheck 0; `next build` OK; `cacheComponents`/PPR 설정 존재(`next.config.ts` 정적 검사); 긴 리스트에 `content-visibility:auto` + `contain-intrinsic-size` CSS 존재; **KPI before→after 델타**(`client-bundle-hydration-baseline.md` §0 프로토콜, 4x throttle): First Load JS transfer/decoded 감소 + domInteractive(hydration) 감소 + LCP render-delay 비중 감소(웹 측 — `.moai/reports/webview-native-feel-baseline.md` 대비); INP lab 측정 P75 ≤200ms 근사; 세션 가드/동적 데이터 동작 무회귀(빌드+동작 게이트). 네이티브 캐싱은 게이트 제외(optional).
- **수동 전용 — DEVICE-GATED**: 실 WebView 콜드스타트 FCP/LCP 체감 개선(번들 다이어트는 AUTO 확정이나 실 체감은 디바이스 — baseline §6.3 정직성 계승), scroll long-task/jank KPI 실 fps, 실 INP P75 체감(자동 불가).

---

## Definition of Done

- [ ] **진입 전제(전제 SPEC)**: SPEC-WEBVIEW-UNIFY-001(공유 단일 WebView)이 적용된 환경을 전제한다. 미적용 시 M3(워밍업)·M4(전환)·M2(splash 핸드오프)의 효과가 제한되므로, 실행 순서는 **UNIFY-001 먼저 → 본 SPEC**. M1·M5 일부는 UNIFY-001 독립 적용 가능(부분 게이트).
- [ ] **웹 측 baseline 고정**: 개선 착수 전 `client-bundle-hydration-baseline.md` §0 프로토콜(navigate+Performance API, 4x throttle, cold/warm)로 현재 KPI(First Load JS transfer/decoded, FCP, domInteractive, LCP, INP)를 `.moai/reports/webview-native-feel-baseline.md` 에 1회 캡처해 before 기준선을 고정한다. baseline 미확보 시 AC-NF5 before→after 델타 판정 불가.
- [ ] **자동/AUTO 게이트**: `apps/mobile` typecheck 0 + perf 프롭/스켈레톤/페이드/splash fade/`onContentProcessDidTerminate`/워밍업-1회-호출 정적·계측 검사(AC-NF1/NF2/NF3) + `expo export` 번들 OK; `apps/web` `next build` OK + View Transitions/`touch-action`/PPR·`cacheComponents`/`content-visibility` 설정 정적 검사(AC-NF4/NF5) + KPI before→after 델타 측정(4x throttle).
- [ ] **보안 무변경(AC-NF1)**: 보안 프롭 4종 유지, `touch-action:none` 전역·FastClick 부재 — 보안/접근성 약화 0.
- [ ] **비리마운트 보존(AC-NF2/NF3)**: 페이드/스켈레톤/워밍업이 WebView `key` 부여·hard reload 유발하지 않음(UNIFY-001 OD-1 불변) — 정적 검사 + 워밍업 인스턴스 1개 계측.
- [ ] **사전 워밍업(AC-NF3)**: 핸드셰이크 앱당 1회 + 첫 화면 마운트 전 트리거(계측) + iOS 풀 ≤2 — UNIFY-001 R-U4 강화(재정의 아님).
- [ ] **전환 최소 추가(AC-NF4)**: View Transitions + reduced-motion 가드 + 제스처 정리가 웹 UI 재작성 0(전환 트리거 + CSS 만) — diff 범위 검사.
- [ ] **콘텐츠 비용(AC-NF5)**: PPR/`cacheComponents`/`content-visibility`/INP 위생 + KPI 델타(First Load JS·domInteractive·LCP 감소, INP P75 ≤200ms) + 세션 가드/동적 데이터 무회귀. 네이티브 캐싱은 optional(게이트 제외).
- [ ] **신규 의존성 0**: WebView 측 `react-native-webview` 13.16.1/`expo-router`/`expo-splash-screen` 보유만, 웹 측 보유 Next.js 16 PPR + 표준 View Transitions/`content-visibility` 만 — 새 애니메이션/전환 라이브러리 도입 0.
- [ ] **measure 정직성**: 웹 측 KPI 는 데스크톱 Chrome 4x 근사(AUTO 확정), 실 WebView 체감(콜드스타트·스크롤 fps·전환·제스처·iOS 복구)은 DEVICE-GATED — before→after 델타 + 디바이스 게이트로 분리 판정(baseline §6.3 계승).
- [ ] **완료 정책**: 웹 baseline 고정 → 자동/AUTO 게이트(KPI 델타 포함) 통과 후 status draft→in-progress, iOS 시뮬레이터/실기기 종단(AC-NF1 스크롤·AC-NF2 iOS 콘텐츠 프로세스 복구·AC-NF3 워밍업 즉시성/OOM·AC-NF4 전환/제스처·AC-NF5 실 체감) 통과 시 completed. Android 체감 AC 는 시뮬레이터 범위 밖이면 게이트 보류로 기록(iOS 시뮬레이터 우선 관행). `onContentProcessDidTerminate` 미발화 시 OD-3 폴백 확정 후 재판정.
</content>
