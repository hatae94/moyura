# SPEC-MOBILE-003 (compact)

expo-router 네비게이션 골격 + 라우트별 WebView 하이브리드 (로그인 후 `/home` 전환).
depends-on: SPEC-WEBVIEW-SHELL-001, SPEC-MOBILE-002. status: draft. priority: high.

## REQ (요구사항)

### M1 expo-router 파운데이션
- R-RT1 [U]: expo-router SDK 56 API only — `main: expo-router/entry`, NO `expo-router/babel` / `@react-navigation/*` import / `useRootNavigation()`.
- R-RT2 [U]: SDK 56 호환 버전으로 해석되는 네비게이션 의존성 추가(수동 핀 금지) — expo-router, react-native-safe-area-context, react-native-screens, expo-constants (apps/mobile 스코프). 설치 메커니즘(`npx expo install`)은 plan.md 단계 E.
- R-RT3 [E]: 콜드스타트 시 `app/_layout.tsx` 가 App.tsx 의 스플래시/브리지/콜드스타트 핸드셰이크를 행위 보존 이전.
- R-RT4 [U]: 엔트리 전환 후에도 `import './lib/env'` env 가드 side-effect 를 첫 렌더 전 보존.
- R-RT5 [U]: App.tsx 라우터 우회 default-export 렌더 경로 제거 — `app/` 트리 단일 진입(Ubiquitous 부정 불변).
- R-RT6 [O]: SDK 56 typecheck/build 비파괴 시(Where) `app.json experiments.typedRoutes: true`.

### M2 네이티브 인증 상태 + 가드
- R-AS1 [U]: 네이티브 AuthContext, isSignedIn = SecureStore tokens + bridge `session:synced/none/cleared` 만으로 도출.
- R-AS2 [E]: `session:synced`→isSignedIn=true; `session:none`/`session:cleared`/토큰 클리어→false.
- R-AS3 [S]: isSignedIn=false → `(tabs)` 가드(→`(auth)/login`); true → `(auth)` 가드(→`(tabs)/home`). `Stack.Protected`/`Tabs.Protected` 사용.
- R-AS4 [U]: isSignedIn 결정 로직을 `auth-state-core.ts` 순수 모듈로(vitest, expo/RN import 0).
- R-AS5 [U]: 라우터는 웹 `/me` 세션 상태를 네이티브 인증 소스로 읽지 않음(Ubiquitous 부정 불변).

### M3 네비게이션 계약
- R-NC1 [U]: 웹/앱 동일 라우트 트리(`/home`,`/explore`,`/notifications`,`/profile`) 1:1 매핑 — `route-map-core.ts`(순수, vitest).
- R-NC2 [E]: 탭 WebView 의 교차 라우트 URL 로드 시 `decideWebViewLoad` 확장이 deny + 네이티브 라우트 디스패치 반환.
- R-NC3 [U]: 탭 WebView 는 교차 라우트 자체 이동 금지 — 인증 플로우 내부 기존 허용 규칙(MOBILE-001/002)만 예외(Ubiquitous 부정 불변).
- R-NC4 [E]: `(tabs)` Android 하드웨어 back = expo-router 네이티브. `decideBackPress` 라우트 컨텍스트 확장; `(auth)/login` WebView back 보존.
- R-NC5 [E]: 로그인 완료(`session:synced`)→`router.replace("/(tabs)/home")`; `/me` 네이티브 타깃 하드코딩 금지.

### M4 웹 (main) UI + 셸 모드 + 네이티브 탭바
- R-WB1 [U]: `apps/web/app/(main)/` 그룹(layout BottomTabBar+가드, home/explore/notifications/profile) — Next.js 16 + Tailwind v4 + lucide-react(Figma Make 적응).
- R-WB2 [U]: `/home` = Figma HomeTab(인사말+아바타, CTA, 필터 칩, 모임 카드 mock, 빈 상태); explore/notifications/profile = 플레이스홀더만.
- R-WB3 [S]: 셸 모드(네이티브 WebView 내부)에서 웹 BottomTabBar 숨김 — 네이티브 탭바만.
- R-WB4 [Un]: If 셸 모드 판정이 하이드레이션 전 미확정(네이티브 WebView 내부지만 마커 미도착 — 셸 모드가 확정적으로 부재인 데스크톱 브라우저는 제외) then 웹은 탭바 숨김 기본값(fail-safe) — 이중 탭바/하이드레이션 flash 금지. 셸 마커는 콘텐츠 하이드레이션 전 가용(`injectedJavaScriptBeforeContentLoaded` 또는 pre-hydration `window.ReactNativeWebView`).
- R-WB5 [U]: 모바일 `(tabs)/_layout.tsx` = expo-router Tabs(Figma BottomTabBar RN 재해석, safe-area, notifications 배지 mock); 각 탭 = `${WEB_URL}/<route>` 호스팅 얇은 WebView 래퍼.

### M5 보존/회귀 + 목적지 전환
- R-PR1 [U]: 기존 `lib/auth/`·`hooks/` vitest(134/134 이상 — 94 기존 baseline + 40 신규) 보존.
- R-PR2 [S]: `(auth)/login` 이메일/비번 로그인 in-WebView 흐름 보존(네이티브 인터셉트 없음).
- R-PR3 [E]: 웹 단독 로그인 완료 → `redirect("/home")`(actions.ts:46,65,89 + oauth-bridge.ts:29 DEFAULT_NEXT + 관련 테스트 일관 변경).
- R-PR4 [U]: `moyura://auth-callback` 딥링크가 expo-router 자동 라우팅과 공존(콜백 경로 라우트 파일 부재).
- R-PR5 [E]: 로그아웃(`session:cleared`, R-R4 cookie-clear 포함)→`(auth)/login` 네이티브 이동; Google 시스템 브라우저 OAuth 브리지 보존.

## Acceptance Criteria (요약) — R→AC 전수 커버리지

- AC-1 (R-NC5/R-AS2): 로그인→`router.replace("/(tabs)/home")`, home 탭 WebView = `${WEB_URL}/home` (디바이스).
- AC-2 (R-AS4/R-AS1/R-AS5/R-AS3): `auth-state-core` 순수 결정(none→login, synced→home, cleared→login; RN import 0) — 가드 결정 포함 (vitest).
- AC-3 (R-NC1/R-NC2/R-NC3): 탭 WebView 교차 라우트 로드 시 라우트 매핑+WebView-load 결정(구현 위치 무관) → deny + 네이티브 디스패치; 기존 단언 보존 (vitest).
- AC-4 (R-PR1/R-PR2/R-RT2/R-RT3/R-RT4): 엔트리 이전 행위 보존 + 회귀 게이트 — vitest 134/134 이상(94 기존 baseline + 40 신규), tsc 0, next build, expo export, env 가드/이메일 로그인 보존 (자동).
- AC-5 (R-WB1/R-WB2/R-WB3/R-WB4/R-PR3): 셸 모드 웹 탭바 숨김(flash 없음, 이중 탭바 없음) + 데스크톱 `/home` HomeTab 렌더 + `redirect("/home")` (웹 build+수동/디바이스).
- AC-6 (R-NC4): back 결정 컨텍스트(구현 위치 무관) — `(tabs)` native-back / `(auth)/login` WebView back 보존 (vitest+디바이스).
- AC-7 (R-PR4/R-PR5): `moyura://` 딥링크 공존(콜백 라우트 파일 부재) + 로그아웃→`(auth)/login` 종단 (static-grep+디바이스).
- AC-8 (R-RT1/R-RT5/R-RT6/R-WB5): 라우트 구조 + deprecated API 금지 정적 계약 — `main: expo-router/entry`, `@react-navigation/*`/babel/`useRootNavigation` 0, App.tsx 우회 경로 부재, `(tabs)/*.tsx` WebView 래퍼, 웹 `(main)/*` 에 `react-native-webview` 0 (static-grep+tsc).

## Files to Modify / Create

NEW (mobile): `apps/mobile/app/_layout.tsx`, `app/index.tsx`, `app/(auth)/_layout.tsx`, `app/(auth)/login.tsx`, `app/(tabs)/_layout.tsx`, `app/(tabs)/{home,explore,notifications,profile}.tsx`, `app/+not-found.tsx`, `lib/route-map-core.ts`(+test), `lib/auth/auth-state-core.ts`(+test), `lib/auth/AuthContext.tsx`.
NEW (web): `apps/web/app/(main)/layout.tsx`, `(main)/_components/BottomTabBar.tsx`, `(main)/home/page.tsx`, `(main)/home/_mock.ts`, `(main)/{explore,notifications,profile}/page.tsx`.
MODIFY (mobile): `package.json`(main + deps), `app.json`(experiments/plugins), `hooks/auth-bridge-core.ts:187`(decideWebViewLoad cross-route), `hooks/app-lifecycle-core.ts:19`+`useAppLifecycle.ts:77-90`(back), `lib/auth/oauth-bridge.ts:29`(DEFAULT_NEXT /me→/home), tests(`oauth-bridge.test.ts`, `auth-bridge-core.test.ts`), `index.ts`(entry/env), `App.tsx`(REMOVE).
MODIFY (web): `lib/auth/actions.ts:46,65,89`(/me→/home), `app/globals.css`(Figma 토큰), `lib/native-bridge/`(셸 모드 감지 참조).
PRESERVE: bridge/nonce/token-store security 테스트, `WebViewShell.tsx`, OAuth 브리지, `scheme: "moyura"`, 웹 `app/me/page.tsx`.

## Exclusions (What NOT to Build)

- MeetupDetail 제외 — 후속 SPEC(SPEC-MOBILE-004 후보)로 명시, 네비게이션 계약(native push `(tabs)/home/[id]` + 대응 웹 상세 또는 RN 단위 교체) 준수.
- 실 모임 데이터/API 연동 없음(mock only). explore/notifications/profile 기능 없음(플레이스홀더). 알림 배지 mock.
- 웹 `app/me/page.tsx` 제거/변경 금지 — 변경은 post-login redirect 목적지만.
- WebView 교차 라우트 자체 네비게이션 금지(차단→네이티브 디스패치). 이중 탭바 금지.
- 디자인 토큰 파이프라인 없음(수동 추출). 세션 권위 구조 변경 없음(웹 권위 유지). prod URL/HTTPS/배포 없음.
- deprecated expo-router API 금지(`@react-navigation/*`/`expo-router/babel`/`useRootNavigation`).
