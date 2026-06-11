---
id: SPEC-MOBILE-001
version: 0.2.0
status: in-progress
created: 2026-06-05
updated: 2026-06-09
author: hatae
priority: medium
issue_number: null
---

# SPEC-MOBILE-001 — RN WebView 셸 + Google 소셜 OAuth 브리지

## HISTORY

- 2026-06-05 (v0.1.0): 최초 작성 (draft). `apps/mobile`(Expo ~56.0.6, RN 0.85.3, React 19.2.3)가 `apps/web`(Next.js)을 풀스크린 WebView 로 호스팅하는 **씬 셸(thin shell)**을 만들고, 웹 로그인 화면에서 시작되는 Google 소셜 OAuth 를 **시스템 브라우저로 브리지**한다(임베디드 WebView OAuth 는 Google 이 차단 — `oauth.ts` R-E2). 입력 자산: (1) `apps/mobile/lib/auth/oauth.ts` — `launchSocialOAuth(authorizeUrl)`/`buildReturnUrl()` 스캐폴드(SPEC-AUTH-001), `authorizeUrl` 산출은 R-F3 으로 연기됨; (2) SPEC-AUTH-002 — 로컬 Google 키 배선 완료(`signInWithOAuthAction` 이 진짜 IdP authorize URL 을 반환); (3) SPEC-LOGIN-UI-001 — 웹 로그인 UI(Google/Apple 버튼), OD-5(RN WebView 풀스크린 렌더 미검증). 이 SPEC 은 oauth.ts 의 **연기된 `authorizeUrl` 산출(R-F3)을 Google 한정으로 완성**하고, SPEC-LOGIN-UI-001 **OD-5/AC-H1(WebView 풀스크린 렌더)을 종단 검증으로 닫는다**. 범위 = 셸 + WebView UX + Google OAuth 브리지(로컬/dev 우선). prod URL/HTTPS/배포는 follow-up.

- 2026-06-09 (v0.2.0): M1~M3 구현 완료 (status: draft → in-progress). 브랜치 `feature/SPEC-MOBILE-001` 커밋 `6e59272`. `react-native-webview` 13.16.1(Expo56 핀) + 풀스크린 WebView 셸(`App.tsx`: SafeAreaView/로딩/에러+재시도/Android 백), `lib/web-url.ts` env 가드(`WEB_URL` @MX:ANCHOR, `lib/env.ts` 패턴). Google OAuth 브리지: `onShouldStartLoadWithRequest`로 GoTrue authorize URL 인터셉트 → `redirect_to`를 `moyura://auth-callback`로 재작성(OD-5 브라우저 쿠키 half-auth 회피) → 시스템 브라우저 → deep-link 복귀 → WebView가 웹 콜백 로드(WebView 쿠키 컨텍스트 세션, R-O1~O6). 테스트 가능 순수 로직은 `lib/auth/oauth-bridge.ts`로 분리(vitest node-env, 12 테스트). 자동 게이트 통과: typecheck 0 / vitest 12/12 / expo export 번들 OK. 웹 코드 변경 0(Non-Goal 준수). **미완(디바이스 필요): R-P2 종단, OD-2(에뮬레이터 호스트 ↔ GoTrue/Google 허용목록) — status=in-progress 유지, 디바이스 검증 후 completed.**

---

## Background (배경)

`moyura` 모노레포는 웹(`apps/web`, Next.js)을 **단일 UI surface** 로 삼는다. 모바일 앱(`apps/mobile`, Expo)은 그 웹을 풀스크린 WebView 로 감싸는 **씬 셸**이며, 자체 제품 화면을 네이티브로 다시 만들지 않는다. 세션 소유권은 웹 레이어(`@supabase/ssr` 쿠키 세션)에 있고, 그 쿠키는 **WebView 쿠키 저장소** 에 머문다 — 네이티브는 토큰을 보관하지 않는다(`oauth.ts` OD-4 에서 "둘 다 미도입"으로 확정).

현 상태 (live source-of-truth):
- `apps/mobile/App.tsx` — Expo 기본 템플릿(셸 미구현). `package.json` `main: index.ts`.
- `apps/mobile/package.json` — `expo-auth-session`/`expo-web-browser`/`expo-linking` 보유. **`react-native-webview` 누락**.
- `apps/mobile/lib/auth/oauth.ts` — `launchSocialOAuth(authorizeUrl)`(`expo-web-browser` `openAuthSessionAsync`로 시스템 브라우저 진입), `buildReturnUrl()`(`makeRedirectUri({scheme:"moyura", path:"auth-callback"})` → `moyura://auth-callback`). `authorizeUrl` 산출(웹 `data.url` 을 네이티브로 전달)은 **R-F3 으로 연기**.
- `apps/mobile/lib/env.ts` — `EXPO_PUBLIC_API_BASE_URL`/`SUPABASE_URL`/`SUPABASE_ANON_KEY` in-app env 가드 패턴.
- `apps/mobile/app.json` — `scheme: "moyura"`, package/bundleId `com.hatae.moyura`.
- `supabase/config.toml` — `site_url = "http://localhost:3000"`; `additional_redirect_urls = ["http://localhost:3000/auth/callback", "moyura://auth-callback"]`; `[auth.external.google] enabled = true`(SPEC-AUTH-002).
- `apps/web/lib/auth/actions.ts:14` — `CALLBACK_URL = "http://localhost:3000/auth/callback"`; `signInWithOAuthAction` 이 `redirectTo=${CALLBACK_URL}?next=/me` 로 `signInWithOAuth` 호출 후 `data.url`(IdP authorize URL)로 `redirect`.
- `apps/web/app/auth/callback/route.ts` — `?code=` 를 받아 `exchangeCodeForSession` 으로 쿠키 세션 확립 후 `?next` 로 redirect.

이메일/비밀번호 로그인은 WebView **안에서 브리지 없이 동작**한다(쿠키 쓰기가 WebView 내부에서 일어남). 소셜(Google)만 시스템 브라우저로 빠져나갔다 deep link 로 돌아오는 네이티브 브리지가 필요하다.

---

## Goal (목표)

`apps/mobile` 이 `apps/web` 을 풀스크린 WebView 로 띄우는 씬 셸을 구축하고, 환경별 웹 호스트를 env(`EXPO_PUBLIC_WEB_URL`)로 주입하며, WebView 기본 UX(안드로이드 백, safe-area, 로딩/에러)를 제공한다. WebView 안의 웹 로그인이 Google OAuth 를 개시하면 네이티브가 `launchSocialOAuth`로 시스템 브라우저를 열고, `moyura://auth-callback` 복귀 후 WebView 가 웹 콜백 URL 을 로드해 `@supabase/ssr` 쿠키 세션을 WebView 쿠키 저장소에 확립하고 `/me` 로 도달함을 종단 검증한다. 이로써 `oauth.ts` 의 연기된 `authorizeUrl` 산출(R-F3)을 Google 한정 완성하고 SPEC-LOGIN-UI-001 OD-5(WebView 풀스크린 렌더)를 닫는다.

---

## Non-Goals (제외 — What NOT to Build)

> [HARD] 본 SPEC 의 명시적 비목표. 최소 1개 이상.

- **네이티브 제품 화면 없음.** 셸은 WebView 호스트일 뿐, 일정/모임/투표 등 제품 화면을 네이티브로 만들지 않는다(웹이 UI surface).
- **네이티브 토큰/세션 저장소 없음.** `expo-secure-store`/`AsyncStorage` 도입하지 않는다 — 세션은 WebView 쿠키(웹 소유, `oauth.ts` OD-4). 네이티브는 "브라우저를 열고 복귀 결과만 받는" 역할.
- **Apple 소셜 브리지 연기.** Apple Developer Program 미가입(SPEC-AUTH-002 와 일관). 지금은 Google 만 브리지하고, Apple 은 동일 메커니즘으로 이후 SPEC.
- **Kakao 제외.** provider 자체가 범위 밖.
- **prod 웹 URL / HTTPS / 앱스토어 배포 연기.** 로컬/dev 우선. 단 `EXPO_PUBLIC_WEB_URL` 은 향후 prod 를 위해 env 기반(하드코딩 금지)으로 만든다.
- **신규 웹 server action / 세션 / 콜백 코드 없음.** 기존 `signInWithOAuthAction` + `app/auth/callback/route.ts` 를 그대로 재사용한다. 웹 코드 변경은 (선택적) 브리지 postMessage 훅 한 곳으로 제한(OD-1 참조).
- **`expo-router` 도입 없음.** 셸은 단일 화면이므로 라우팅 라이브러리 불필요(`App.tsx` 단일 진입).

---

## EARS Requirements

> 모듈 ≤5. 각 요구사항은 acceptance.md 의 AC 와 1:1 대응. `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 의존.

### M1. Shell (셸 + 의존성)

- **R-S1 (Ubiquitous)** `[MODIFY] apps/mobile/package.json`: The mobile app SHALL declare `react-native-webview` (Expo SDK 56 bundled version `13.16.1`, 설치 시 `npx expo install react-native-webview` 로 핀 일치) as a dependency.
- **R-S2 (Ubiquitous)** `[MODIFY] apps/mobile/App.tsx`: The app shell SHALL render a single full-screen `WebView` whose `source` URI is the resolved web URL, replacing the default Expo template content.
- **R-S3 (Ubiquitous)** `[EXISTING] apps/mobile/index.ts + app.json`: The app entry SHALL remain `App.tsx`(via `main: index.ts`) and the URL scheme SHALL remain `moyura`(no new entrypoint, no scheme change).

### M2. WebURL / Env (환경별 웹 호스트 주입)

- **R-W1 (Ubiquitous)** `[NEW] apps/mobile/lib/web-url.ts`: The app SHALL provide an in-app env guard `resolveWebUrl(value)` that returns the trimmed value, mirroring `lib/env.ts` `resolveApiBaseUrl`/`resolvePublicSupabaseValue` (pure, testable, literal-key access `process.env.EXPO_PUBLIC_WEB_URL` for Expo inlining).
- **R-W2 (Unwanted)** `[NEW] apps/mobile/lib/web-url.ts`: IF `EXPO_PUBLIC_WEB_URL` is unset or blank, THEN `resolveWebUrl` SHALL throw a descriptive configuration error at boot (never silently load `undefined`).
- **R-W3 (Ubiquitous)** `[NEW] docs/.env example`: The web URL SHALL be host-mapped per environment: Android emulator → `http://10.0.2.2:3000`, iOS simulator → `http://localhost:3000`, physical device → LAN IP host; prod URL deferred (env-driven, not hardcoded).

### M3. WebViewUX (WebView 사용성)

- **R-U1 (Event-Driven)** `[MODIFY] App.tsx`: WHEN the user presses the Android hardware back button AND WebView navigation history exists, THEN the shell SHALL call `WebView.goBack()` instead of exiting; WHEN no history exists, THEN the shell SHALL allow default exit behavior.
- **R-U2 (Ubiquitous)** `[MODIFY] App.tsx`: The shell SHALL host the WebView inside `SafeAreaView` so web content does not collide with the device status bar / notch.
- **R-U3 (State-Driven)** `[MODIFY] App.tsx`: WHILE the WebView is loading, the shell SHALL display a loading indicator.
- **R-U4 (Unwanted)** `[MODIFY] App.tsx`: IF the WebView fails to load (network error / unreachable host), THEN the shell SHALL display a recoverable error/offline state with a retry affordance (not a blank screen or crash).

### M4. OAuthBridge (Google 시스템 브라우저 브리지)

- **R-O1 (Event-Driven)** `[MODIFY] App.tsx + oauth.ts`: WHEN the WebView-hosted web login initiates Google OAuth (navigation toward the provider authorize URL, OR a `window.ReactNativeWebView.postMessage` carrying the authorize URL), THEN the shell SHALL hand the `authorizeUrl` to native and SHALL NOT let the embedded WebView load the provider page directly (Google blocks embedded-WebView OAuth — `oauth.ts` R-E2). 이 요구사항이 oauth.ts 의 연기된 `authorizeUrl` 산출(R-F3)을 Google 한정 완성한다.
- **R-O2 (Event-Driven)** `[EXISTING] oauth.ts launchSocialOAuth`: WHEN native receives the `authorizeUrl`, THEN the shell SHALL call `launchSocialOAuth(authorizeUrl)` which opens the system browser via `expo-web-browser` `openAuthSessionAsync` and returns to `moyura://auth-callback`.
- **R-O3 (Event-Driven)** `[MODIFY] App.tsx`: WHEN `launchSocialOAuth` returns `{kind:"authenticated"}` (deep-link success), THEN the shell SHALL navigate the WebView to the web callback URL carrying the `?code=` so `@supabase/ssr` exchanges it and sets the cookie session in the WebView's cookie store, landing on `/me`.
- **R-O4 (Unwanted)** `[EXISTING] oauth.ts`: IF `launchSocialOAuth` returns `{kind:"cancelled"}` or `{kind:"error"}`, THEN the shell SHALL keep the user unauthenticated, SHALL NOT crash, and SHALL leave the WebView on the login surface (recoverable — `oauth.ts` R-E4).
- **R-O5 (Ubiquitous)** `[MODIFY] App.tsx`: The WebView SHALL enable cookie persistence/sharing — `sharedCookiesEnabled` (iOS) and `thirdPartyCookiesEnabled` (Android) — so the `@supabase/ssr` session cookie survives across the OAuth round-trip and app sessions.
- **R-O6 (Ubiquitous)** `[EXISTING] WebView host consistency`: The WebView SHALL load ONE consistent host for both the app and the OAuth callback (cookie origin host-bound: `localhost` ≠ `127.0.0.1` — SPEC-AUTH-002 lesson). On Android emulator the host is `10.0.2.2`, which the GoTrue/Google redirect allowlist must also accommodate (see OD-2).

### M5. Preservation / Verify (보존 + 검증)

- **R-P1 (Ubiquitous)** `[EXISTING] apps/web`: Email/password login SHALL continue to work inside the WebView WITHOUT the native bridge (cookie write happens inside the WebView; only social needs native).
- **R-P2 (Event-Driven, manual)** `[VERIFY]`: WHEN a human runs the shell on an emulator/device, THEN the web login screen SHALL render full-screen inside the RN WebView (closes SPEC-LOGIN-UI-001 OD-5 / AC-H1), Google login via system browser SHALL establish the session, and `/me` SHALL render in the WebView.

---

## Open Decisions / Risks

| ID | 주제 | 결정/상태 | 영향 |
|----|------|-----------|------|
| **OD-1** | `authorizeUrl` 를 네이티브로 전달하는 메커니즘 (M4 중심 설계) | **권장: (a) `onShouldStartLoadWithRequest` 인터셉트.** WebView 가 provider authorize 호스트(`accounts.google.com`)로의 네비게이션을 감지하면 `false` 를 반환해 임베디드 로드를 막고, 그 URL 을 `launchSocialOAuth`로 넘긴다. **웹 코드 변경 0**(기존 `signInWithOAuthAction` 의 `redirect(data.url)` 을 그대로 가로챔) — 브라운필드 최소 변경 원칙에 부합. 대안: **(b) `window.ReactNativeWebView.postMessage` + `onMessage`** — 웹이 `data.url` 을 명시적으로 네이티브에 post. (b)는 의도가 명확하고 호스트 매칭 휴리스틱이 불필요하지만 **웹 코드 변경 필요**(서버 redirect 를 client postMessage 로 바꿔야 함 → server action 흐름과 충돌, 신규 웹 경로 = Non-Goal 위반 위험). → **(a) 채택**, (b)는 (a)가 Google 의 중간 redirect 체인에서 깨질 경우의 fallback. 정확한 인터셉트 대상 URL 패턴(authorize 직접 vs GoTrue authorize redirect)은 구현 시 실측. | redirect_uri/인터셉트 패턴 오류 시 OAuth 진입 실패. (a)의 호스트 매칭이 너무 넓으면 정상 네비게이션까지 가로챌 위험. |
| **OD-2** | Android 에뮬레이터 호스트(`10.0.2.2`) ↔ OAuth redirect 허용목록 상호작용 (핵심 리스크) | **미결(구현 시 검증).** 에뮬레이터에서 WebView 가 `http://10.0.2.2:3000` 을 로드하면, 쿠키 origin·웹 콜백·`additional_redirect_urls` 가 모두 `10.0.2.2` 로 일관돼야 한다. 그러나 `config.toml` 허용목록은 `localhost:3000` 만 등록(`actions.ts` `CALLBACK_URL` 도 `localhost`). GoTrue exact-match 이므로 `10.0.2.2` ≠ `localhost`. 또한 Google Cloud authorized redirect 는 `127.0.0.1:54321`(GoTrue 콜백)이고 `10.0.2.2` 루프백을 허용하는지 불확실. → 에뮬레이터 종단 OAuth 는 `localhost` 일관 셋업(adb reverse `tcp:3000`/`tcp:54321` 로 `localhost` 를 호스트 머신에 포워딩)으로 우회하는 것이 더 안전할 수 있음 — 구현 시 두 경로(`10.0.2.2` vs `adb reverse`+`localhost`) 실측 후 확정. | 가장 흔한 종단 실패. 호스트 불일치 시 쿠키 미설정(half-auth) 또는 `redirect_uri_mismatch`. SPEC-AUTH-002 의 host-consistency 교훈의 모바일 확장. |
| **OD-3** | 웹 호스트 리터럴 드리프트 (`localhost` vs `127.0.0.1`) | **확정: live source-of-truth = `localhost`.** `config.toml site_url`/`additional_redirect_urls`, `actions.ts:14 CALLBACK_URL` 모두 `http://localhost:3000`. 단 `app/auth/callback/route.ts:4` 주석과 SPEC-AUTH-002 spec.md 서술은 `127.0.0.1` 로 드리프트되어 있음(문서 불일치, 코드 아님). 이 SPEC 은 `localhost` 를 따른다. **route.ts 주석/문서 정정은 본 SPEC 범위 밖**(별도 docs sync). | 문서만 보고 `127.0.0.1` 로 셋업하면 cookie origin/exact-match 불일치로 종단 실패. |
| **OD-4** | WebView 쿠키 영속성 | **권장: `sharedCookiesEnabled`(iOS) + `thirdPartyCookiesEnabled`(Android) 활성화(R-O5).** `@supabase/ssr` 세션 쿠키가 OAuth 왕복(시스템 브라우저↔WebView)과 앱 재시작을 가로질러 보존돼야 한다. 단, 시스템 브라우저(`ASWebAuthenticationSession`/CustomTabs)와 WebView 는 별도 쿠키 저장소이므로 — OAuth 쿠키 자체는 브라우저가, **세션 쿠키는 WebView 가 웹 콜백 로드 시점에** 설정(R-O3). 영속성 미설정 시 앱 재시작마다 재로그인. iOS `sharedCookiesEnabled` 가 `NSHTTPCookieStorage` 와 공유되는 동작은 구현 시 실측. | 쿠키 미영속 시 UX 저하(매 실행 재로그인) 또는 half-auth. |
| **OD-5** | `expo-web-browser` `openAuthSessionAsync` 의 `returnUrl` ↔ deep link 매칭 | **확정(기존): `moyura://auth-callback`** (`oauth.ts buildReturnUrl()` = `makeRedirectUri({scheme,path})`, `config.toml additional_redirect_urls` 에 등록됨). 이 SPEC 은 변경하지 않음. 단 IdP→GoTrue→웹콜백→`moyura://` 의 어느 단계에서 deep link 가 트리거되는지(웹 콜백이 `moyura://` 로 redirect 하는지 vs 시스템 브라우저가 등록 scheme 으로 자동 복귀)는 구현 시 흐름 실측. | deep link 미복귀 시 시스템 브라우저가 닫히지 않고 멈춤. |
| **OD-6** | iOS 시뮬레이터/디바이스 테스트 환경 | **제약: iOS 검증은 macOS + Xcode 필요.** 자동화 불가(에뮬레이터/디바이스 수동). Android 우선 검증, iOS 는 Mac 환경에서 수동(R-P2). | iOS 종단 검증이 환경 의존적 — Mac 없으면 Android 만으로 종단 증명. |

---

## Sources (출처)

- `apps/mobile/lib/auth/oauth.ts` — `launchSocialOAuth`/`buildReturnUrl`, R-E1~R-E4, OD-4, R-F3(연기된 authorizeUrl 산출). (코드 직접 확인 2026-06-05)
- `apps/mobile/lib/env.ts` — env 가드 패턴(`resolveApiBaseUrl`/`resolvePublicSupabaseValue`). (코드 직접 확인)
- `apps/mobile/package.json` / `App.tsx` / `app.json` / `index.ts(main)` — 현 셸 상태, 누락 의존성, scheme. (코드 직접 확인)
- `apps/web/lib/auth/actions.ts:14,79-99` — `CALLBACK_URL = "http://localhost:3000/auth/callback"`, `signInWithOAuthAction`. (코드 직접 확인)
- `apps/web/app/auth/callback/route.ts` — PKCE `exchangeCodeForSession` 콜백. (코드 직접 확인)
- `supabase/config.toml:155-169` — `site_url`, `additional_redirect_urls`(localhost + `moyura://auth-callback`), `[auth.external.google] enabled = true`. (코드 직접 확인)
- Expo SDK 56 bundledNativeModules.json — `react-native-webview` `13.16.1`. (WebFetch 2026-06-05, github.com/expo/expo sdk-56)
- `react-native-webview` Reference.md — `sharedCookiesEnabled`(iOS), `thirdPartyCookiesEnabled`(Android), `onShouldStartLoadWithRequest`(return false = block), `onMessage`/`window.ReactNativeWebView.postMessage`. (WebFetch 2026-06-05)
- SPEC-AUTH-001(oauth 스캐폴드), SPEC-AUTH-002(Google 키 + host-consistency 교훈), SPEC-LOGIN-UI-001(웹 로그인 UI + OD-5/AC-H1). (.moai/specs/ 직접 확인)
