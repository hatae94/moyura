# WebView ↔ RN 렌더링 성능 저하 — 원인 진단 리포트

- 대상: `apps/mobile`(Expo ~56 / RN 0.85.3 / react-native-webview 13.16.1) ↔ `apps/web`(Next.js 16 App Router, React 19 + React Compiler)
- 작성일: 2026-06-25 (KST)
- 성격: **원인 진단(read-only)**. 코드 변경 없음. 정적 분석 + 빌드 산출물 검증 + 기존 실측 baseline 통합.
- 분석 방식: 호스트 측(RN WebView) / 콘텐츠 측(Next 렌더링) 2축 독립 분석 → baseline 리포트와 3축 통합.
- 관련 baseline: `web-page-transition-performance.md`, `client-bundle-hydration-baseline.md`

---

## 1. 요약 (TL;DR)

WebView 환경의 체감 지연은 단일 버그가 아니라 **두 구조가 곱해진 결과**다.

> **화면마다 독립 WebView 인스턴스(호스트)** × **인스턴스마다 Next.js를 통째로 다시 부팅·hydration(콘텐츠)** = 화면 진입 비용의 반복 누적.

그리고 **기존 성능 측정이 이 비용을 보지 못했다.** 지금까지의 모든 baseline은 *데스크톱 Chrome*에서 Next 클라이언트 라우터의 **soft-nav(전환 RSC ~560–700ms)** 를 잰 것인데, 실제 RN에서 탭/상세 진입은 soft-nav가 아니라 **별도 WebView의 hard load(full GET + 번들 파싱 + hydration)** 다. 사용자가 겪는 비용은 측정된 RSC 시간이 아니라 그 위에 얹힌 **WebView 콜드 부팅 비용**이다.

핵심 정량 사실(웹 단독, 4x throttle 근사 — `client-bundle-hydration-baseline.md`):
- First Load JS **159KB 압축 / 520KB decoded** (supabase 지연 로드 후, -32%)
- LCP ~1044ms 중 **render delay가 98%** → 네트워크 아닌 **CPU(JS 평가/hydration)** 가 페인트를 막음
- 최대 잔여 청크: react-dom 222KB raw
- WebView는 이보다 **느린 JS 엔진 + 적은 메모리 + 콜드 캐시** → 이 hydration 비용이 더 커짐

---

## 2. 렌더링 구조 (확정)

`apps/mobile`은 **expo-router 하이브리드**다 — native 탭/스택 chrome + **라우트마다 매칭 웹 페이지를 호스팅하는 별도 `<WebView>`**.

- `BridgedWebView.tsx:269-271` → `WebViewShell.tsx:105`: 화면당 `<WebView>` 1개 마운트
- 탭 4개(home/explore/notifications/profile) + `home/[id]` 상세 + login + invite가 각각 `${WEB_URL}/{route}` 를 **풀 페이지 로드**(`route-map-core.ts:78` `urlForRoute`)
- 웹 측 자체는 **견고**: root layout 포함 전부 Server Component, `'use client'`는 leaf island(폼·탭바·realtime 섹션)에만, SPA soft-nav(`next/link`+`usePathname`), 페인트 전 셸 감지 인라인 스크립트로 hydration flash 없음, `reactCompiler` 실활성 — *브라우저 단독이면 좋은 설계*. 문제는 이 SPA 라우팅 이점을 **WebView 멀티 인스턴스 모델이 무력화**한다는 점.

설계 배경(`SPEC-WEBVIEW-SHELL-001`, `SPEC-MOBILE-003`): 단일 `App.tsx` 셸 → expo-router 하이브리드로 마이그레이션. `BridgedWebView`는 5개 화면(login + 4탭)이 공유하는 seam이며, OD-1 설계상 "한 화면 안에서 sourceUri 교체로만 이동"을 보장한다(쿠키/PKCE 보존). 단, 이는 "탭 전환 시 같은 인스턴스 재사용"이 아니라 화면별 인스턴스를 전제한다.

---

## 3. 근본 원인 (심각도 순, 통합)

### [높음 1] 화면별 독립 WebView → 매 진입 풀 로드 + hydration 반복

- 근거: `BridgedWebView.tsx:269-271`, `WebViewShell.tsx:105`, `route-map-core.ts:78`. 탭은 `lazy:true`(`(tabs)/_layout.tsx:44`)로 첫 포커스에 마운트되고 expo-router가 keep-mounted → **두 번째 방문부터는 완화**. 하지만 `home/[id]` 상세는 `router.push`로 매번 새 WebView 스택(`BridgedWebView.tsx:122-127`, `home/[id].tsx:28`).
- 영향: 가장 빈번한 동선인 **목록→상세 진입마다** WebView 컨텍스트 생성 → HTTP GET → 번들 파싱 → React hydration 전체 반복. soft-nav였다면 ~600ms로 끝날 전환이 WebView full boot로 치환된다.
- 방향: (전략) 공유 WebView + 웹 SPA 라우팅 일원화 — 별도 SPEC.

### [높음 2] WebView 성능 프롭 전무

- 근거: 코드 전수 grep — `cacheEnabled`·`cacheMode`·`androidLayerType`·`renderToHardwareTextureAndroid`·`decelerationRate`·`overScrollMode`·`nestedScrollEnabled`·`domStorageEnabled`·`startInLoadingState`·`allowsInlineMediaPlayback`이 **하나도 설정 안 됨**. `WebViewShell.tsx:105-133`은 보안/쿠키/브리지 프롭(`originWhitelist`, `sharedCookiesEnabled`, `setSupportMultipleWindows`, `injectedJavaScriptBeforeContentLoaded`, `onMessage`)만 설정.
- 영향: 재방문/재마운트가 **디스크 캐시를 못 타고 매번 네트워크** 재로드(→ [높음 1]과 곱해짐). Android는 `androidLayerType="hardware"` 부재로 스크롤 GPU 합성 미적용 → jank. `domStorageEnabled` 부재로 웹 클라이언트 캐시 전략 제약 가능(인증은 쿠키 기반이라 무관).
- 방향: 즉시 적용 가능한 **최저비용 개선**(보안 프롭과 무충돌).

### [중간 3] 상세·login·realtime 라우트에 supabase 64KB(gz) 잔류 — 지연 로드 부분 우회

- 근거: realtime hook의 static import — `members-section.tsx:17`/`polls-section.tsx:36` → `useMemberChannel.ts:11`/`usePollChannel.ts:11` → `@/lib/supabase/client`. login은 `login-form.tsx:19` + `LogoutBridgeNotifier`가 `bridge-client`(supabase 끌어옴, `bridge-client.ts:19`) static import. chat은 `chat/page.tsx:33` 직접 import. 빌드 매니페스트로 확정: `home/[id]`·`login` 청크에 supabase `0d24832m2qz0s.js`(243KB raw / 64KB gz) 참조.
- 영향: **콜드스타트 첫 화면(login)** 과 **핵심 화면(모임 상세)** 에 GoTrue+Postgrest+Realtime 전체가 First Load로 들어가 hydration 비용 최대화. WebView 멀티 인스턴스라 이 비용을 캐시로 분산 못 함.
- 방향: realtime hook의 `createClient`를 effect 내부 `await import("@/lib/supabase/client")`로(구독은 effect 시점이라 무해), login의 postMessage 명령 함수를 supabase-free 모듈로 분리.

### [중간 4] 콜드스타트 토큰 로드·핸드셰이크가 first paint를 직렬로 가로막음

- 근거: `BridgedWebView.tsx:182-208`이 `loadTokens()`(SecureStore = 키체인/디스크 I/O) await 후에야 `registerColdStartTokens` → `startHandshakeTimeout` → `maybeInjectRestore` 호출. 스플래시는 `markHandshakeResolved` 또는 **8초 타임아웃**(`useAppLifecycle.ts:62` `HANDSHAKE_TIMEOUT_MS = 8000`)까지 유지(`_layout.tsx:28` preventAutoHideAsync). restore 주입은 400ms 간격(`useAuthBridge.ts:117`)으로 최대 5회(`auth-bridge-core.ts:104`). 게다가 `AuthContext.tsx:80-99`와 `BridgedWebView.tsx:182`가 **같은 토큰을 콜드스타트에 중복 로드**.
- 영향: 콜드 부팅 = 키체인 I/O + WebView 첫 로드 + restore ack 왕복이 직렬 누적. 느린 망에선 스플래시→흰 화면 빈 구간이 길어져 "멈춘 앱" 인상. 정상 경로에선 ack가 빠름.
- 방향: AuthContext 토큰을 컨텍스트로 내려 단일화, 토큰 로드와 WebView 마운트 병렬화, restore 재시도 간격/횟수를 네트워크 상태에 맞춤.

### [낮음 5] 미사용 Geist 폰트 두 패밀리 self-host 다운로드

- 근거: `layout.tsx:11-19`가 Geist+Geist_Mono(woff2 12개) 로드. 그러나 `globals.css:78` body는 실제 `font-family: Arial, Helvetica, sans-serif`. `--font-sans`/`--font-mono` 토큰(`globals.css:41-42`)은 정의만 되고 body 미적용. Geist Mono는 `/me` 디버그 페이지 3곳만 사용.
- 영향: WebView 콜드스타트에서 거의 안 보이는 폰트 woff2 fetch/decode(render-blocking은 아님 — next/font 자동 swap). 제한된 WebView 대역폭/메모리에서 낭비.
- 방향: 제거(현재 Arial 적용 중이라 폰트 로드가 거의 무의미) 또는 Geist Sans를 body에 실적용.

### [낮음 6] supabase 번들이 turbopack에서 두 변종으로 중복 생성

- 근거: `0n-je1onunjey.js`와 `0d24832m2qz0s.js` 모두 supabase+realtime 포함(각 243KB raw / 64KB gz). chat/invite는 전자, home[id]/login/expenses는 후자.
- 영향: 단일 라우트는 하나만 받지만 chat↔home[id] 이동 시 거의 동일한 번들을 **별 캐시 키로 두 번** 받음 → WebView 캐시 효율 저하.
- 방향: [중간 3] 적용 시 supabase 사용 라우트가 줄어 자연 통합 여지 증가. turbopack splitChunks 튜닝은 우선순위 낮음.

### [기각] 흔히 의심되지만 이 코드베이스에선 병목 아님 (증거 기반 제외)

- **브리지 onMessage**: 메시지 타입 5종(session synced/none/cleared / google-request / invite-invalid)뿐(`bridge-protocol.ts:24-48`). 스크롤·타이핑 같은 고빈도 스트림이 브리지에 **흐르지 않음**. 메시지당 `JSON.parse` 1회 + nonce 비교는 인증 라이프사이클 순간에만 발생 → 무시 가능(`useAuthBridge.ts:249-314`).
- **injectedJavaScriptBeforeContentLoaded**: `window.__MOYURA_NATIVE_SHELL__=true`(`WebViewShell.tsx:97`) + nonce 부트스트랩 한 줄(`BridgedWebView.tsx:49-51`) = 수십 바이트 → first-paint 차단 없음.
- **리렌더 churn**: AuthContext value `useMemo` 안정화(`AuthContext.tsx:136-143`), `reportSignal` `useCallback`. `source={{ uri }}` 객체 교체는 navigate일 뿐 리마운트 아님(OD-1 보존 확인). 인라인 핸들러(`BridgedWebView.tsx:242-256`)는 로드 이벤트 시점만 → 빈도 낮음.
- **onNavigationStateChange**: ref 2개 갱신 + 위임만, setState 없음 → 리렌더 미유발(`BridgedWebView.tsx:211-217`).

---

## 4. supabase 지연 로드 검증

**부분적으로 효과적이지만 완전하지 않다.**

- 효과(검증됨): `(main)/home`·`profile`·`notifications`·`explore` 탭의 `page_client-reference-manifest.js`에 supabase 청크 **미포함**. `NativeBridgeProvider.tsx:50`·`ShellSessionAnnouncer.tsx:46`이 `void import("./bridge-client")` + WebView 가드(`!window.ReactNativeWebView` bail-out) 선행 → 일상 탭 soft-nav에서 supabase 비용 0. **핵심 목표 달성**.
- 우회(defeated): `login`, `home/[id]`, `chat`, `expenses`, `invite/[token]` — realtime hook과 login bridge 명령 함수의 static import 때문에 supabase가 First Load에 잔류. 즉 lazy-load는 **NativeBridgeProvider/ShellSessionAnnouncer 경로에서만** 적용됐다.

---

## 5. 빠른 개선 후보 (low-effort, high-impact)

| 우선 | 조치 | 위치 | 효과 |
|---|---|---|---|
| 1 | WebView perf 프롭 추가 (`cacheEnabled`, Android `cacheMode="LOAD_CACHE_ELSE_NETWORK"`/`androidLayerType="hardware"`/`domStorageEnabled`) | `WebViewShell.tsx:105` | 재방문 캐시 히트 + 스크롤 jank 해소, 전역 |
| 2 | realtime hook `createClient` → effect 내 dynamic import | `useMemberChannel.ts:11`, `usePollChannel.ts:11`, `useChatChannel.ts:13`, expense hook | 모임상세·chat·expenses First Load에서 64KB 제거 |
| 3 | login bridge 명령 함수를 supabase-free 모듈로 분리 | `login-form.tsx:19`, `bridge-client.ts:19` | **콜드스타트 첫 화면** 64KB 제거(체감 최대) |
| 4 | SecureStore 토큰 단일 로드 | `AuthContext.tsx:80` + `BridgedWebView.tsx:182` | 콜드 부팅 키체인 I/O 절반 |
| 5 | Geist 폰트 정리 | `layout.tsx:11`, `globals.css:78` | 콜드스타트 폰트 fetch/decode 절감 |

**확인만 권장(이미 양호):** lucide-react는 전부 named per-icon import(barrel 없음), `loading.tsx` 3곳 존재(`(main)`/`home/[id]`/`expenses`), api-client는 `schema.d.ts`가 타입 전용(런타임 번들 0).

**아키텍처급(별도 SPEC 권장):** 멀티 WebView → 공유 WebView + 웹 SPA 라우팅 전환. 가장 큰 레버지만 변경폭·회귀 위험이 커 plan-run-sync 사이클로 다뤄야 함.

---

## 6. 검증 한계 (정직성)

- 모든 정량치는 **데스크톱 Chrome 4x throttle 근사** — 실제 RN WebView 직접 측정은 **미수행**(device-gated 보류 항목).
- **[높음 1]의 실제 체감 크기**(탭 keep-mounted가 어디까지 완화하는지, `home/[id]` push/pop 리로드 빈도)는 **실기기/시뮬레이터 trace로만 확정 가능**. 정적 분석은 "구조적으로 비싸다"까지 입증했고, "얼마나 비싼지"는 디바이스 측정이 필요하다.
- 별도 잔여 병목(범위 밖): Render free 콜드스타트(~50s, `web-page-transition-performance.md` §8).

---

## 부록: 분석 근거 파일

호스트 측(RN):
- `apps/mobile/components/WebViewShell.tsx`, `BridgedWebView.tsx`
- `apps/mobile/app/(tabs)/_layout.tsx`, `home/[id].tsx`
- `apps/mobile/lib/route-map-core.ts`, `hooks/useAuthBridge.ts`, `hooks/useAppLifecycle.ts`, `hooks/auth-bridge-core.ts`
- `apps/mobile/lib/auth/AuthContext.tsx`, `bridge-protocol.ts`

콘텐츠 측(Next):
- `apps/web/app/layout.tsx`, `globals.css`, `login/login-form.tsx`
- `apps/web/lib/native-bridge/bridge-client.ts`, `NativeBridgeProvider.tsx`, `ShellSessionAnnouncer.tsx`
- `apps/web/app/(main)/home/[id]/members-section.tsx`, `polls-section.tsx`
- `apps/web/lib/moim/useMemberChannel.ts`, `lib/poll/usePollChannel.ts`, `lib/chat/useChatChannel.ts`
- 빌드 증거: `apps/web/.next/server/app/*/page_client-reference-manifest.js`, `.next/static/chunks/0d24832m2qz0s.js`(64KB gz supabase)
