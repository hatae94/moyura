# Research: expo-router 도입 + 로그인 후 네이티브 /home 라우트

> SPEC-MOBILE-003 사전 조사 문서
> 작성일: 2026-06-11 | 조사 도구: Explore agent + 공식 문서 WebFetch 검증 + Figma MCP

## 1. 목표 요약

- 현재: 모바일 앱은 WebView 단일 셸. 로그인/회원가입은 WebView 내 웹 페이지로 처리, 로그인 완료 시 웹이 `/me`로 리다이렉트.
- 목표 (2026-06-11 사용자 align 확정 — 초기 요구 "네이티브 RN /home"에서 수정됨): **하이브리드 아키텍처**. 모바일은 최신 expo-router(SDK 56)로 네이티브 네비게이션 골격(탭/스택)을 구축하되, 각 라우트의 화면 콘텐츠는 대응하는 웹 페이지를 WebView로 렌더링. 웹(apps/web)에는 `/home` 등 메인 라우트를 신설하여 데스크톱 브라우저와 모바일 셸 양쪽을 단일 웹 화면으로 지원.
- **단일 원칙**: 모바일에서 화면을 바꾸는 주체는 오직 expo-router(탭/push/back/로그인 후 전환 전부). WebView는 화면당 1개 콘텐츠 렌더러이며 자체 라우트 이동 금지(인증 플로우 내부의 기존 허용 규칙만 예외). 웹 브라우저에서는 전부 Next.js 라우팅.
- 로그인 완료 후: 네이티브는 bridge `session:synced` → `router.replace("/(tabs)/home")`. 웹 단독 사용자는 웹 redirect → `/home` (기존 `/me` 리다이렉트 3곳 변경, `/me` 페이지 자체는 유지).
- UI 소스: Figma Make `One-time-Event-App` (접근 확인 완료). 화면 UI는 **웹(Next.js 16 + Tailwind v4)으로 구현** — Make 코드(React 웹 + Tailwind + lucide-react)와 스택 호환성 높음. 모바일 네이티브로 만드는 것은 **네비게이션 크롬(탭바 등)뿐**.

## 2. 현재 아키텍처 (모바일 셸 + 인증 브리지)

### 엔트리 체인
- `apps/mobile/package.json` → `"main": "index.ts"`
- `apps/mobile/index.ts` → `registerRootComponent(App)`
- `apps/mobile/App.tsx` (1-192) — WebView 셸 + 토큰 브리지 오케스트레이션 (SPEC-WEBVIEW-SHELL-001 + SPEC-MOBILE-002 결합)

### 핵심 모듈
| 파일 | 역할 |
|---|---|
| `apps/mobile/components/WebViewShell.tsx` | 재사용 WebView 컴포넌트 (R-S1) |
| `apps/mobile/components/LoadingOverlay.tsx`, `WebViewErrorOverlay.tsx` | 로딩/에러 오버레이 (R-U3/R-U4) |
| `apps/mobile/hooks/useAppLifecycle.ts` + `app-lifecycle-core.ts` | Android back, resume 재검증, handshake timeout (순수 로직은 -core 분리) |
| `apps/mobile/hooks/useAuthBridge.ts` + `auth-bridge-core.ts` | OAuth 인터셉트, 토큰 주입/동기화, origin allowlist, nonce 인증 |
| `apps/mobile/lib/auth/token-store.ts` / `token-store-core.ts` | SecureStore 토큰 캐시 (R-N2/R-N3) |
| `apps/mobile/lib/auth/bridge-protocol.ts` | 버전드 메시지 스키마 v1: `session:restore/synced/none/cleared`, `resume:revalidate` |
| `apps/mobile/lib/auth/oauth-bridge.ts` | OAuth 콜백 URL 조립: `${WEB_URL}/auth/callback?code=...&next=/me` |

### 로그인 완료 흐름 (현재)
```
시스템 브라우저 OAuth → 딥링크 복귀 → WebView가 /auth/callback?code&next=/me 로드
→ 웹이 /me 렌더 → bridge session:synced → 네이티브 SecureStore 저장 → splash 해제
```
- 네이티브의 인증 상태 신호: bridge `session:synced` / `session:none` (SPEC-MOBILE-002에서 구축 완료)

## 3. '/me' 사용 맵 (변경 영향 지점)

**Mobile:**
- `apps/mobile/lib/auth/oauth-bridge.ts:75` — `const DEFAULT_NEXT = "/me"`
- `apps/mobile/lib/auth/oauth-bridge.test.ts` — `/me` URL 단언 2건
- `apps/mobile/hooks/auth-bridge-core.test.ts` — `next=/me` 단언 1건
- `apps/mobile/hooks/auth-bridge-core.security.test.ts` — `/me` URL 변형 5건
- `apps/mobile/hooks/auth-bridge-core.token.test.ts` — origin 매칭 3건

**Web:**
- `apps/web/lib/auth/actions.ts:46,65` — 이메일 로그인/가입 완료 `redirect("/me")`
- `apps/web/lib/auth/actions.ts:89` — OAuth `redirectTo: ${CALLBACK_URL}?next=/me`
- `apps/web/app/me/page.tsx` — 현 post-login 랜딩 (세션 없으면 `/login`)

주의: 웹(데스크톱 브라우저) 사용자의 `/me` 랜딩은 유지될 수 있음 — 네이티브 셸에서만 `/home` 네이티브 전환이 필요한지가 SPEC 결정 포인트.

## 4. 기존 SPEC 의존성

```
SPEC-MOBILE-001 (WebView 셸 + Google OAuth bridge, in-progress: 디바이스 검증 대기)
  → SPEC-WEBVIEW-SHELL-001 (셸 컴포넌트화 리팩토링, expo-router 대비 가드레일 R-S4/R-S5)
  → SPEC-MOBILE-002 (토큰 기반 세션 파운데이션: SecureStore + 브리지 프로토콜 v1, 보안 루프 완료)
  → [신규] SPEC-MOBILE-003 (expo-router + 네이티브 /home)
```
- SPEC-WEBVIEW-SHELL-001의 훅 추출은 "향후 expo-router 마이그레이션을 기계적으로 만들기 위한" 선행 작업이었음 — 본 SPEC이 그 후속.
- SPEC-MOBILE-002의 bridge `session:synced`가 네이티브 라우팅 전환 신호의 단일 소스로 재사용 가능.

## 5. expo-router SDK 56 검증 사실 (공식 문서, 2026-06-11 확인)

Sources:
- https://docs.expo.dev/router/installation/ (2026-06-03 갱신)
- https://docs.expo.dev/versions/v56.0.0/sdk/router/

### 설치 (검증됨)
```bash
npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
```
- `npx expo install`이 SDK 56 호환 버전을 자동 결정 (수동 버전 핀 금지)
- `package.json` → `"main": "expo-router/entry"` (글로벌 초기화 필요 시 커스텀 엔트리 파일 허용)
- `app.json` → `"scheme"` 필수 (현재 `moyura` 이미 존재), `"experiments": { "typedRoutes": true }` 권장
- babel: `babel-preset-expo` 프리셋이면 충분. **`expo-router/babel` 플러그인은 SDK 50에서 제거됨 — 사용 금지**
- 설정 변경 후 `npx expo start --clear`

### SDK 56 핵심 변경 (deprecated 회피 목록)
| 항목 | 상태 | 대응 |
|---|---|---|
| `@react-navigation/*` 직접 import | **SDK 56부터 미지원** | 모든 네비게이션 API는 `expo-router`에서 import (공식 codemod 존재) |
| `useRootNavigation()` | deprecated | `useNavigationContainerRef()` 사용 |
| `expo-router/babel` | SDK 50에서 제거 | babel-preset-expo만 사용 |
| `getInitialURL` 수동 처리 | 불필요 | expo-router가 딥링크 자동 처리 |

### 현행 API (SDK 56)
- 네비게이터: `Stack`, `Tabs`, `Slot`, `ErrorBoundary` (+ 실험적 `ExperimentalStack`)
- 라우팅: `Link`, `Redirect`, `router.replace()`, `useRouter()`
- 가드: `Stack.Protected` / `Tabs.Protected` (guard prop) — 인증 보호 라우트 표준 패턴
- 훅: `useLocalSearchParams`, `usePathname`, `useSegments`, `useFocusEffect`

## 6. Figma UI 구조 (Make 소스 분석 완료)

파일: `https://www.figma.com/make/VDxYuSp4OwOTJuF53c4gnc/One-time-Event-App` — **접근 가능 확인됨**

### 화면 구조
- **하단 탭 4개** (`BottomTabBar.tsx`): `home`(홈), `explore`(탐색), `notifications`(알림, 배지 카운트), `profile`(마이)
- **HomeTab**: 인사말 헤더(시간대별) + 아바타, 예정 모임 배너, "새 모임 만들기" CTA 카드, 필터 칩(전체/예정/완료), 모임 카드 리스트(이모지 커버, 날짜/장소/인원, 상태 배지), 빈 상태 UI
- **MeetupDetail**: 카드 탭 시 상세 화면 (홈 탭 내 push 네비게이션)
- **explore/notifications/profile**: PlaceholderTab (이모지 + 타이틀 + 설명)

### 구현 매핑 (확정 아키텍처 기준)
- 화면 UI(HomeTab, PlaceholderTab, 웹용 BottomTabBar)는 **apps/web(Next.js 16 + Tailwind v4 + lucide-react)으로 구현** — Make 코드와 스택이 거의 일치(shadcn 컴포넌트는 해당 화면 코드에서 미사용, plain div + Tailwind)하여 적응 비용 낮음
- 모바일 네이티브 구현 대상은 **expo-router 탭바(네비게이션 크롬)뿐** — Figma BottomTabBar 스타일을 RN 컴포넌트로 재해석 (`react-native-safe-area-context`, RN 호환 아이콘)
- 셸 모드(모바일 WebView 안)에서 웹 페이지는 **웹 탭바를 숨김** — 이중 탭바 금지
- 디자인 토큰(색/타이포/radius)은 Figma 테마 CSS에서 추출하여 웹 globals.css(Tailwind v4 테마)에 반영

## 7. 리스크 및 제약

1. **엔트리 포인트 전환 (HIGH)**: `main: index.ts` → `expo-router/entry` 전환 시 기존 App.tsx 로직(스플래시, 브리지, 콜드스타트 토큰 로드)을 `app/_layout.tsx`로 이전해야 함. App.tsx와 app/ 공존 시 혼란 — 명확한 단방향 이전 필요.
2. **인증 상태 단일 소스 (HIGH)**: 네이티브 라우트는 `/me` 페이지의 세션 체크를 사용할 수 없음 → SecureStore 토큰 + bridge `session:synced/none`을 소스로 하는 네이티브 AuthContext 필요.
3. **WebView ↔ 네이티브 경계 (MEDIUM)**: 로그인/회원가입은 WebView 유지, `/home` 이후는 네이티브. WebView가 라우트 트리 내 화면으로 들어가야 함 (로그인 화면 = WebView를 품은 라우트).
4. **딥링크 (MEDIUM)**: OAuth 딥링크(`moyura://...`)가 expo-router의 자동 딥링크 라우팅과 충돌하지 않도록 콜백 경로 설계 필요.
5. **테스트 전략 (LOW)**: vitest는 node 환경 순수 TS만 — 라우트 파일(JSX+expo import)은 vitest 불가. 기존 `-core.ts` 분리 패턴 유지(네비게이션 결정 로직을 core로 추출).
6. **patches/ (LOW)**: `patches/`의 expo 패치는 JSI/런타임 레이어 — expo-router(JS 레이어)와 무관. pnpm patch는 exact 버전 필요하므로 의존성 추가 시 lockfile 주의.
7. **모노레포 (LOW)**: pnpm workspace에서 expo-router 의존성 추가는 `apps/mobile` 스코프로 한정.

## 8. 확정 아키텍처 (2026-06-11 사용자 align 완료)

### 확정 결정 사항
1. 하이브리드: 모바일 네비게이션 골격 = expo-router 네이티브, 화면 콘텐츠 = 라우트별 WebView(대응 웹 페이지)
2. 웹/앱 **동일 라우트 트리** (`/home`, `/explore`, `/notifications`, `/profile`) — URL ↔ 네이티브 라우트 1:1 매핑이 네비게이션 계약
3. 모바일의 모든 화면 전환(탭/push/back/로그인 후)은 expo-router. WebView 내 교차 라우트 이동은 `onShouldStartLoadWithRequest`로 차단 후 네이티브 라우트로 디스패치 (기존 `decideWebViewLoad` 인터셉트 자산 확장). 인증 플로우 내부의 기존 허용 규칙만 예외
4. 셸 모드에서 웹 탭바 숨김 (이중 탭바 금지). 데스크톱 브라우저는 웹 탭바 + 웹 라우팅
5. 로그인/회원가입은 기존 WebView 흐름을 `(auth)` 그룹 라우트로 보존
6. `/me` 페이지 유지, post-login 리다이렉트 목적지만 `/home`으로 변경 (web actions.ts 3곳 + mobile oauth-bridge DEFAULT_NEXT + 관련 테스트)
7. 단일 SPEC (M1~M5). MeetupDetail 제외하되 **후속 SPEC 대상으로 명시** (네비게이션 계약을 따르는 push 라우트로 구현 예정)
8. 향후 화면 단위 RN 전환: 각 탭 파일이 WebView를 품는 얇은 래퍼이므로 라우트별 독립 교체 가능 — expo-router 토대를 지금 만드는 이유

### 모바일 라우트 트리
```
apps/mobile/app/
├── _layout.tsx          # Root Stack + AuthProvider + 스플래시/브리지 오케스트레이션 (App.tsx 행위 보존 이전)
├── index.tsx            # 진입 분기: 인증 상태 따라 (auth)/login 또는 (tabs)/home 으로 Redirect
├── (auth)/
│   ├── _layout.tsx
│   └── login.tsx        # 기존 WebViewShell + 인증 브리지 재사용 (로그인/회원가입 = 웹뷰 유지)
├── (tabs)/
│   ├── _layout.tsx      # 네이티브 Tabs (Figma BottomTabBar 스타일 RN 재해석) + Protected 가드
│   ├── home.tsx         # WebView(${WEB_URL}/home) 호스팅 래퍼
│   ├── explore.tsx      # WebView(${WEB_URL}/explore)
│   ├── notifications.tsx# WebView(${WEB_URL}/notifications) + 네이티브 탭 배지
│   └── profile.tsx      # WebView(${WEB_URL}/profile)
└── +not-found.tsx
```

### 웹 라우트 트리 (apps/web 신규)
```
apps/web/app/(main)/
├── layout.tsx           # 공유 웹 BottomTabBar (셸 모드에서 숨김) + 인증 가드
├── home/page.tsx        # ★ Figma HomeTab (mock 데이터: 인사말, CTA, 필터 칩, 모임 카드, 빈 상태)
├── explore/page.tsx     # 플레이스홀더
├── notifications/page.tsx # 플레이스홀더
└── profile/page.tsx     # 플레이스홀더
```

### 핵심 전환 신호
```
로그인 완료(WebView) → bridge session:synced → AuthContext isSignedIn=true
→ router.replace("/(tabs)/home") → home 탭의 WebView가 ${WEB_URL}/home 렌더
웹 단독: redirect("/home") (기존 /me 3곳 변경)
```

### 신규 기술 고려사항
- **셸 모드 감지**: `injectedJavaScriptBeforeContentLoaded`에서 마커 주입(하이드레이션 전 실행) 또는 `window.ReactNativeWebView` 감지 — 웹 탭바 깜빡임(flash) 없이 숨기는 메커니즘 필요
- **탭별 WebView 인스턴스**: 4개 lazy 마운트, 쿠키 공유는 기존 `sharedCookiesEnabled` 자산
- **Android back**: 네이티브 back으로 일원화 — 기존 useAppLifecycle의 WebView 히스토리 back 위임 로직 수정 필요 [MODIFY]
- **라우트 매핑 계약**: URL↔라우트 매핑/인터셉트 결정 로직은 순수 `-core.ts` 모듈로 추출 (vitest 검증)
- **apps/web 스택**: Next.js 16.2.6 (App Router) + Tailwind CSS v4 (config-less) + lucide-react ^1.17 — Figma Make 코드와 호환
