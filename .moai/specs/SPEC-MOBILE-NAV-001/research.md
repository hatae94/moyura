# Research: SPEC-MOBILE-NAV-001 (모바일 네이티브 헤더·뒤로가기)

작성일: 2026-07-03 | 리서처 4명(모바일 딥다이브 / 웹 라우트 인벤토리 / 네비게이션 플로우 / 선행 SPEC 제약)의 원본 조사 결과를 통합. 모든 file:line 인용은 원본 그대로 보존. 조사 간 상충 지점은 각 섹션에서 **[상충]** 으로 명시.

---

## 문제 원인 분석

### 증상

홈(`/home`)에서 모임 상세(`/home/[id]`)로 진입하면 화면 어디에도 **눈에 보이는 뒤로가기 수단(back affordance)이 없다**.

### 원인 1 — 웹 상세 페이지의 sticky 헤더에 뒤로 버튼이 없음

- 모임 상세 페이지는 sticky 헤더를 가지고 있으나 **모임 이름·일정·장소만 표시**하고 뒤로 버튼은 렌더하지 않는다.
  - 근거: `/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/home/[id]/page.tsx:1-178` — line 106: `<header className="sticky top-0...">`, 내용은 모임 정보만.
- 진입 경로는 웹 내부 `<Link>`다: `/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/home/HomeTab.tsx:50` — `<Link href={/home/${moim.id}}` 로 MeetupCard 전체를 감쌈(lines 50-68).
- 상세 페이지 계열에서 `router.back()` 호출은 **코드베이스 전체에서 단 1곳**뿐이며 그것도 상세가 아닌 초대 페이지다: `/Users/hatae/Documents/personal/moyura/apps/web/app/invite/page.tsx:129`. 즉 모임 상세에는 프로그래밍적 뒤로가기도 없다.

### 원인 2 — 네이티브 스택은 push하지만 헤더를 숨김

- 모바일에서 홈 → 상세 진입은 WebView 자체 이동이 아니라 네이티브 스택 push로 처리된다(SPEC-MOIM-003 REQ-MOIM3-003):
  - `/Users/hatae/Documents/personal/moyura/apps/mobile/components/BridgedWebView.tsx:190-195` — `decideWebViewLoad`가 `{ action: "push", route: "home", id: moimId }` 반환 시 `onDetailPush` 콜백이 `router.push(/(tabs)/home/${encodeURIComponent(id)})` 실행.
  - `/Users/hatae/Documents/personal/moyura/apps/mobile/lib/route-map-core.ts:94-132` — `detailRouteForUrl()`이 2세그먼트 URL(`/home/123`)을 분류.
- 그런데 루트 Stack이 **`headerShown:false, animation:"none"`** 으로 설정되어 있어(`/apps/mobile/app/_layout.tsx:74-103`), push된 상세 화면에도 네이티브 헤더(뒤로 화살표·타이틀)가 그려지지 않는다. `(auth)` 그룹도 동일(`/apps/mobile/app/(auth)/_layout.tsx:18`).
- 결과: 스택은 존재하므로 **Android 하드웨어 백 버튼**(`routeContext="(tabs)"` → `decideBackPress` "native-back", `/apps/mobile/hooks/app-lifecycle-core.ts:24-32`)과 **iOS 스와이프 제스처**(expo-router Stack)로는 돌아갈 수 있지만, 화면에 보이는 UI 단서는 0개다. iOS에는 하드웨어 백 버튼이 없으므로 스와이프를 모르는 사용자는 사실상 갇힌다.
  - **[상충/검증 필요]** 모바일 딥다이브 리서처는 "iOS back: swipe-left gesture triggers expo-router back stack"이라 보고했으나, 루트 Stack의 `animation:"none"` 설정(_layout.tsx:74-103)과 제스처 활성 여부의 상호작용은 실기기에서 별도 검증되지 않았다.

### 원인 3 — 웹 셸 모드에서 웹 크롬을 의도적으로 숨기는 계약

- 네이티브 셸 감지 시 `html[data-shell="native"]`가 설정되고(`/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/layout.tsx:30`), CSS가 웹 BottomTabBar를 숨긴다(`/Users/hatae/Documents/personal/moyura/apps/web/app/globals.css:371-389`). 즉 "네이티브가 크롬을 소유한다"는 계약(R-WB2/R-U2)이 이미 존재하는데, **헤더에 대해서는 네이티브가 아무것도 그리지 않아** 크롬 공백이 발생한 것이 이 SPEC의 본질이다.

---

## 모바일 셸 현재 구조

### expo-router 트리

```
app/
├── _layout.tsx            Stack { headerShown:false, animation:"none" } (:74-103)
│                          알림 URL 파싱 moimIdFromChatUrl → /(tabs)/home/[id]?target=chat (:78-85, :59-68)
├── (auth)/
│   ├── _layout.tsx        isSignedIn → /(tabs)/home Redirect (:14-15), Stack headerShown:false (:18)
│   └── login.tsx          BridgedWebView ${WEB_URL}/login, routeContext="(auth)" (:18)
├── (tabs)/
│   ├── _layout.tsx        4탭 home/explore/notifications/profile (:47-76), lazy:true (:44),
│   │                      !isSignedIn → /(auth)/login (:34-35), 이모지 아이콘 (:26)
│   ├── home/
│   │   ├── _layout.tsx    Stack: index + [id] (:11-14) — 상세 push 시 리스트 히스토리 보존
│   │   ├── index.tsx      TabWebView route="home"
│   │   └── [id].tsx       params.id + target="chat" (:17-28) → urlForDetailRoute / buildChatUrl
│   ├── explore.tsx        TabWebView route="explore"
│   ├── notifications.tsx  TabWebView route="notifications"
│   └── profile.tsx        TabWebView route="profile"
└── invite/[token].tsx     공개 딥링크 moyura://invite/{token} (:12-22), routeContext="(auth)"
```

### WebView 래퍼 2층 구조

- **BridgedWebView** (`/apps/mobile/components/BridgedWebView.tsx:61-284`)
  - Props: `sourceUri`, `routeContext: "(tabs)" | "(auth)"` (:61-68)
  - **key 없음 / 리마운트 금지**(OD-1, :8) — OAuth는 `setSourceUri`로 URL만 교체(:90)
  - safe-area edges: (tabs)=top+left+right, (auth)=4면 (:48-51)
  - 논스 부트스트랩 주입(:57-59, `buildNonceBootstrapJs` :75-78), `useAuthBridge`(:157), `useAppLifecycle`(:104-113, 핸드셰이크 8s 타임아웃), `onNavigationStateChange`로 currentUrlRef 추적(:220-226), 에러 리트라이(:228-234)
  - `TabWebView` 헬퍼(:275-277): `urlForRoute(route, WEB_URL)` + routeContext="(tabs)"
- **WebViewShell** (`/apps/mobile/components/WebViewShell.tsx:91-270`)
  - `originWhitelist` 신뢰 오리진 한정(R-T9/C-2), `setSupportMultipleWindows=false`(:160)
  - `sharedCookiesEnabled`(iOS) + `thirdPartyCookiesEnabled`(Android) (:165-166, R-O5)
  - `decelerationRate="normal"`은 **iOS 전용**(:175 — Android 크래시 수정 이력, 커밋 be885d6), `overScrollMode="never"`(Android, :177)
  - 로딩 처리: WebView opacity가 아닌 **Animated.View 커버** 페이드(:125-143) — iOS WKWebView는 opacity:0이면 JS가 서스펜드되어 핸드셰이크가 깨지기 때문(:119-124)

### 브리지 프로토콜 (bridge-protocol v1)

`/apps/mobile/lib/auth/bridge-protocol.ts:24-47` — 스키마 `{ version:1, type, nonce, payload? }`, 논스는 `constantTimeEquals`로 검증(R-T8/OD-11).

| type | 방향 | 용도 |
|---|---|---|
| `session:restore` | native→web | 콜드스타트 토큰 주입 (R-T2) |
| `session:synced` | web→native | 토큰 저장 + **`seedSharedCookiesFromWebKit()`** (iOS 크로스 WebView 쿠키, useAuthBridge.ts :270-274) |
| `session:none` | web→native | 세션 없음 신호 (:292) |
| `session:cleared` | web→native | 로그아웃: 토큰/쿠키 클리어 + 디바이스 해제 (:284, :298-299) |
| `resume:revalidate` | native→web | 포그라운드 재검증 (R-R1) |
| `auth:google-request` | web→native | 네이티브 Google Sign-In 트리거 (SPEC-MOBILE-004, :302) |
| `invite:invalid` | web→native | 무효 초대 → Alert + 홈/로그인 라우팅 (:307) |

메시지 디스패치: `useAuthBridge.onMessage`(:248-316), 파싱·논스 검증: `decideInboundAction` / `parseBridgeMessage`(bridge-protocol.ts).

### 백 버튼·제스처 상태

- Android: `decideBackPress(canGoBack, routeContext)` (`/apps/mobile/hooks/app-lifecycle-core.ts:24-32`) — `(tabs)`면 무조건 `"native-back"`(expo-router에 위임, R-NC4), `(auth)`면 WebView `goBack()` 또는 앱 종료.
- iOS: expo-router Stack 히스토리가 있으면 스와이프 백(리서처 보고 기준, 위 검증 필요 항목 참조). 시각적 affordance는 없음.
- 웹 셸 감지: `window.__MOYURA_NATIVE_SHELL__ === true`(BridgedWebView.tsx :112 주입) + `window.ReactNativeWebView` 존재(`/apps/web/app/(main)/layout.tsx:30`), 소비처: `/apps/web/lib/native-bridge/bridge-client.ts:50`, `/apps/web/app/(main)/_components/ShellModeEffect.tsx:28` 등. **커스텀 UA 오버라이드 없음** — 마커 주입 타이밍에 의존.

### 라우트 매핑

`/apps/mobile/lib/route-map-core.ts` — `AppRoute = "home" | "explore" | "notifications" | "profile"`(:13, :21-26), `urlForRoute`(:78-81), `urlForDetailRoute`(:146-148), `routeForUrl`(:53-65), `detailRouteForUrl`(:112-134), `isCrossRoute`(:168-169).

핵심 사실: `/moims/{id}/chat|schedule|expenses`는 2+세그먼트로 `routeForUrl`이 null을 반환 → cross-route dispatch 대상이 아니고 **상세 WebView 안의 "trusted-load"로 그대로 흘러간다**(R-NC3). 즉 현재 chat/schedule/expenses는 네이티브 스택 화면이 생기지 않는다.

---

## 웹 페이지 전수 인벤토리

인벤토리 리서처의 표를 원문 그대로 보존하고, 우측에 파생 컬럼 **헤더 필요 판정**(필요/불필요/보류)을 추가했다. 판정 기준: (a) 다른 페이지에서 도달하는 detail-depth 페이지 = back+title 필요, (b) 최상위 탭 루트 = 불필요, (c) auth/standalone = 케이스별 판단.

| 경로 | 화면 목적 | 계층 | 웹 내 뒤로가기 | 진입 출처 | 모바일 WebView 도달 | 헤더 필요 판정 |
|------|----------|------|-----------|--------|--------|--------|
| `/` | 세션 기반 진입 라우터 (RootEntry) | top-level entry | 없음 (리다이렉트) | 초기 로드, /invite/[token] 수락 완료 | 예 (web URL root) | 불필요 (UI 없는 리다이렉트, page.tsx:1-19) |
| `/login` | 소셜 OAuth + 매직링크 로그인 UI | auth/standalone | 없음 (fullscreen) | RootEntry (세션 미인증), OAuth 콜백 실패 | 예 (in-WebView) | 불필요 (인증 진입점, 되돌아갈 곳 없음) |
| `/auth/callback` | PKCE OAuth 콜백 (Route Handler) | auth/system | - (서버 리다이렉트만) | 외부 OAuth provider (Google, 등) | 예 (깊은 링크) | 불필요 (화면 없는 Route Handler) |
| `/onboarding` | 이름 온보딩 폼 | auth/standalone | 없음 (session validation로 자동 /home 리다이렉트) | /login 후 세션 생성, 또는 /invite/[token] 수락 중 익명→인증 전환 시 | 예 (in-WebView) | 불필요 (선형 플로우, 뒤로 비활성 의도) |
| `/me` | 프로필 미니 페이지 (디버그용) | top-level detail | 없음 (requireNamedSession 가드) | 직접 URL 진입 | 예 (but 미사용—/profile으로 실제 기능 제공) | 보류 (디버그용·앱 내 진입 링크 없음; 존치 여부 자체가 미결) |
| `/profile` | 마이 프로필 — 개인정보 + 표시 이름 수정 + 로그아웃 + 계정 삭제 | top-level tab (via BottomTabBar) | 없음 (bottom tab은 탭 경로 링크, 뒤로가기 없음) | BottomTabBar Link href="/profile", 또는 직접 URL | 예 (WebView 가능—mobile "마이" 탭) | 불필요 (탭 루트) |
| `/home` | 모임 목록 (필터 탭: 모두/예정됨/진행중) + 홈 액션 FAB | top-level tab | 없음 (홈 탭 자체) | RootEntry, 로그인 후 리다이렉트, 각 탭 및 모임 상세에서 BottomTabBar | 예 (WebView 홈) | 불필요 (탭 루트) |
| `/home/[id]` | 모임 상세 — 모임 정보 + 멤버 + 투표 + 채팅/일정/경비 speed dial FAB | detail (under /home tab) | **없음** (sticky 헤더만—뒤로 버튼 미제공) | HomeTab Link href="/home/{id}", **알림 탭 직링크**(notification-item.tsx:105, 118, 180, 188 — member.joined/owner.delegated/poll.created/poll.closed; cross-tab 진입 → 추가 조사 갭 3) | 예 (in-WebView—**navigation anchor**) | **필요** (본 SPEC 핵심; back + 모임명 title) |
| `/explore` | 향후 모임 탐색 기능 (현재 placeholder "곧 준비 중" 안내) | top-level tab | 없음 | BottomTabBar Link href="/explore" | 예 | 불필요 (탭 루트) |
| `/notifications` | 인앱 알림 피드 (실시간 구독 + 페이지 매기기) | top-level tab | 없음 | BottomTabBar Link href="/notifications" | 예 | 불필요 (탭 루트) |
| `/invite` | 초대 링크/토큰 진입 페이지 (디바운스 검증 + 모임 미리보기) | standalone/modal-like | 있음 (router.back()으로 뒤로—웹 히스토리) | HomeActionDock "초대 링크 참여", LoginScreen "초대를 받으셨나요?" | 예 (in-WebView 공개) | 보류 (웹 자체 back 버튼 이미 존재 :129; 인증 전/후 두 맥락 — 네이티브 헤더 추가 시 중복 크롬 위험) |
| `/invite/[token]` | 게스트 초대 수락 랜딩 (닉네임 폼 + 수락 흐름 → /home/[moimId]) | standalone/public | 있음 (돌아가기 버튼으로 웹 히스토리 또는 /explore로 router.back()) | /invite 토큰 파라미터로 라우팅, 모바일 딥링크 moyura://invite/... | 예 (깊은 링크로 직접 진입) | 보류 (**[상충]** 딥다이브 리서처는 "NEEDS HEADER (back to home or login)"로 판정; 그러나 moyura:// 딥링크로 앱 첫 화면이 될 수 있어 back 대상이 없는 경우 존재 — 진입 경로별 분기 필요) |
| `/moims/new` | 모임 생성 폼 (이름/정원/일정/장소) | standalone form | 없음 (form submit 성공 시 /home/[id]로 라우팅, 실패 시 폼 에러 표시) | HomeActionDock "새 모임 만들기" | 예 | **필요** (뒤로 미구현 — 폼 실패 시 갇힘, page.tsx:1-18) |
| `/moims/[id]/chat` | 모임 채팅 (실시간 메시지 + 신고/차단) | sub-detail (fullscreen) | **있음** (sticky 헤더 Link "← 뒤로") | MoimActionDock "채팅", 모임 상세 speed dial | 예 (in-WebView) | **필요** (chat/page.tsx:84-89 웹 back Link 존재 → 네이티브 이관 시 중복 제거 결정 필요) |
| `/moims/[id]/schedule` | 일정 조율 (히트맵 투표 + 일정 생성) | sub-detail (fullscreen) | **있음** (sticky 헤더 Link "← 뒤로"로 /home/[id]) | /home/[id] ScheduleVoteBar, MoimActionDock "일정 조율", **알림 탭 직링크**(notification-item.tsx:137, 146, 155, 168 — schedule.* 4종; cross-tab 진입 → 추가 조사 갭 3) | 예 | **필요** (schedule-view.tsx 웹 back Link 존재 → 동일) |
| `/moims/[id]/expenses` | 경비 관리 (지출 목록 + 정산 요약) | sub-detail (fullscreen) | **있음** (sticky 헤더 Link "← 뒤로"로 /home/[id]) | MoimActionDock "경비", **알림 탭 직링크**(notification-item.tsx:202, 214, 222 — expense.added/settlement.*; cross-tab 진입 → 추가 조사 갭 3) | 예 | **필요** (expenses-view.tsx:59 웹 back Link 존재 → 동일) |

### 요약 블록

- **총 페이지 수: 16** (라우트 기준; `/auth/callback`은 Route Handler 포함)
  - **[상충]** 인벤토리 리서처 요약문은 "Total Pages Found: 20 pages"라고 기술했으나 실제 열거된 표 행은 16개. 열거된 16개를 기준으로 채택하고, 차이(레이아웃 파일 3개 등 비페이지 산입 추정)는 plan 단계에서 재확인.
- **헤더 필요 수: 5** — `/home/[id]`, `/moims/new`, `/moims/[id]/chat`, `/moims/[id]/schedule`, `/moims/[id]/expenses`
- **보류: 3** — `/me`(디버그성), `/invite`(웹 자체 back 존재), `/invite/[token]`(딥링크 첫 화면 가능성)
- **불필요: 8** — `/`, `/login`, `/auth/callback`, `/onboarding`, `/home`, `/explore`, `/notifications`, `/profile`

### 인벤토리 부속 사실 (원본 보존)

- 웹에서 back affordance가 이미 있는 페이지: `/moims/[id]/chat`(chat/page.tsx:84-89, ChevronLeft → `/home/{moimId}`), `/moims/[id]/schedule`, `/moims/[id]/expenses`(expenses-view.tsx:59), `/invite`(invite/page.tsx:206-212 "돌아가기", :129 router.back()), `/invite/[token]`.
- 웹에서 back affordance가 없는 페이지 8곳: `/login`, `/onboarding`, `/home`, **`/home/[id]`**, `/explore`, `/notifications`, `/profile`, **`/moims/new`**.
- 공유 크롬 레이아웃 3개: `/apps/web/app/layout.tsx:42-62`(NativeBridgeProvider, viewport-fit=cover :37-38), `/apps/web/app/(main)/layout.tsx:60-98`(BottomTabBar :94, 셸 감지 스크립트 :30, NotificationCountProvider :63-66), `/apps/web/app/moims/layout.tsx:14-23`(requireNamedSession 패스스루).
- 내비게이션 수단 집계: `<Link>` 13곳, `router.push()` 3곳(초대 플로우), `router.replace()` 4곳(초대 수락/무효 처리/멤버 자진 탈퇴), `router.back()` 1곳(invite/page.tsx:129).
- **타이틀 소스 부재**: 전 페이지가 루트 metadata `title: "moyura"`(`/apps/web/app/layout.tsx:28-30`)를 상속. `generateMetadata()` 0곳, `document.title` 조작 0곳 → 네이티브가 `onNavigationStateChange`의 title로 컨텍스트 타이틀을 만들 수 없음.

---

## 네비게이션 메커니즘 옵션

전제: "웹 내 이동을 네이티브 스택 화면(헤더 포함)으로 승격"하는 방법. 3안 비교.

### 옵션 A — WebView 로드 인터셉트 확장 (`onShouldStartLoadWithRequest` → `router.push`)

- **동작 방식**: 현재 `/home/{id}`에만 적용된 검증된 패턴(BridgedWebView.tsx:190-195, `decideWebViewLoad` → `{action:"push"}` → `router.push(/(tabs)/home/${id})`)을 확장. `route-map-core.ts`의 분류기(`detailRouteForUrl`, :112-134)에 `/moims/{id}/chat|schedule|expenses`, `/moims/new` 패턴을 추가하고, 대응하는 expo-router 화면(예: `(tabs)/moims/[id]/chat.tsx`)을 신설, 각 화면에서 `headerShown:true` + 네이티브 헤더를 켠다. 신규 화면 생성 절차는 딥다이브 리서처가 정리한 패턴 그대로: route-map AppRoute/분류기 확장 → 화면 파일 추가 → `BridgedWebView sourceUri=... routeContext="(tabs)"`.
- **장점**: 웹 코드 무수정으로 시작 가능(링크는 이미 일반 `<Link href>`); Android 하드웨어 백(`decideBackPress` "native-back")·iOS 스와이프가 스택과 자동 정합; MOBILE-003의 R-NC3(교차 라우트 자체 네비 금지) 철학과 같은 방향.
- **단점**: 화면당 WebView 인스턴스 증가 → **iOS 쿠키 시딩 의존 확대**(`seedSharedCookiesFromWebKit()`, MOBILE-004 v0.3.1; WKHTTPCookieStore 내부 구현 의존으로 취약); 화면마다 로딩 커버+핸드셰이크 비용; `onShouldStartLoadWithRequest`는 **SPA soft-nav(pushState)를 잡지 못함** — Next.js `<Link>`가 클라이언트 전환하면 인터셉트가 발생하지 않을 수 있어, 실제로 어떤 전환이 풀 로드로 오는지 라우트별 검증 필요; UNIFY-001(단일 공유 WebView, R-U1)과 **정면 충돌**.
- **기존 코드 정합**: 현재 구현된 코드베이스(멀티 BridgedWebView + 쿠키 시딩)와는 가장 잘 맞음. OD-1(리마운트 금지)은 인스턴스별로 준수하면 됨. 타이틀 문제는 미해결(웹 title 전부 "moyura") — URL 파라미터 또는 옵션 B 보완 필요.

### 옵션 B — web→native 브리지 내비 프로토콜 (`nav:push` postMessage)

- **동작 방식**: bridge-protocol v1의 versioned+nonce 봉투(bridge-protocol.ts:24-47)에 additive 메시지 타입(예: `nav:push {path, title}`, `nav:back`)을 추가. 웹이 셸 모드에서 내비 의도를 명시적으로 postMessage하면(진입점: `NativeBridgeProvider`, `/apps/web/lib/native-bridge/bridge-client.ts:50`), 네이티브가 대응 스택 화면을 push하고 **payload의 title로 헤더 타이틀을 그린다**. 웹 쪽은 셸 모드 분기(`html[data-shell="native"]` / `window.ReactNativeWebView`)로 `<Link>` 클릭을 브리지 호출로 승격.
- **장점**: SPA soft-nav도 확실히 포착(인터셉트 사각지대 없음); **타이틀 소스 부재 문제를 유일하게 구조적으로 해결**(모임명 등 컨텍스트 타이틀 전달); UNIFY-001 단일 WebView 모델이 채택되더라도 "공유 WebView + 네이티브 헤더 오버레이" 형태로 양립 가능한 유일한 접근; 논스 봉투 재사용으로 보안 모델 일관.
- **단점**: 웹 코드 수정 필요(내비 지점 래핑); 브리지 메시지 타입 추가가 NATIVE-FEEL-001의 non-goal("bridge-protocol v1 메시지 타입 변경 없음", spec.md :51, :64)과 긴장 — 단 선행 SPEC 리서처는 "Session/navigation messages are extensible"로 판독했고 MOBILE-004가 `auth:google-request`를 additive로 추가한 전례 있음; 웹·네이티브 동시 배포 순서 관리 필요.
- **기존 코드 정합**: `invite:invalid`·`auth:google-request` 등 web→native 신호 패턴과 동형. 쿠키 시딩과 무관(같은 WebView 유지 시) 또는 옵션 A와 병용 시 동일 제약 상속.

### 옵션 C — 웹 측 뒤로 버튼 폴백 (네이티브 화면 없음)

- **동작 방식**: 셸 모드 CSS/조건부 렌더로 웹이 자체 헤더+뒤로 버튼을 그림(기존 `html[data-shell="native"]` 계약 재사용, globals.css:371-389 패턴). `/home/[id]`·`/moims/new`에 웹 헤더 추가, 기존 `/moims/[id]/*` 웹 back Link는 유지.
- **장점**: 최소 변경(웹만); UNIFY-001 vs NATIVE-UI-001 미결 상태에서도 안전(어느 쪽이 채택돼도 무효화되지 않음); WebView 인스턴스·쿠키 시딩 이슈 없음.
- **단점**: 네이티브 헤더·전환 애니메이션 부재(NATIVE-FEEL-001 방향성 후퇴); iOS 제스처 affordance 없음; **Android 하드웨어 백과 부정합** — `(tabs)` 컨텍스트에서 `decideBackPress`는 무조건 "native-back"(app-lifecycle-core.ts:24-32)이라 WebView 내부에서 깊어진 히스토리를 하드웨어 백이 걷지 못함(네이티브 스택에 엔트리가 없으므로). 이를 고치려면 결국 네이티브 수정 필요.
- **기존 코드 정합**: 크롬 소유권 계약(R-U2 "네이티브가 크롬 소유")과 개념적으로 역행.

### 권고

**옵션 A(로드 인터셉트 확장)를 1차 골격으로, 옵션 B의 `nav:*` 메시지를 타이틀 전달·SPA 전환 보완재로 병용**하는 하이브리드를 권고한다. 근거: 현재 코드베이스는 이미 멀티 WebView + 상세 push 패턴(MOBILE-003)으로 구현·부분 검증되어 있고, `/home/[id]` 한 곳에서 동작하는 메커니즘의 확장이 리스크가 가장 작다. 단, **UNIFY-001(단일 WebView, draft)이 채택 확정되면 옵션 B 단독 구조로 전환**해야 하므로, plan 단계에서 이 결정 의존성을 OD(Open Decision)로 명시할 것. 옵션 C는 단독으로는 Android 백 부정합 때문에 불충분하며, 웹 브라우저(비셸) 사용자용 개선으로만 병행 가치가 있다.

---

## 선행 SPEC 제약·정합

### 중복 체크

**기존 SPEC-MOBILE-NAV-001 없음.** `.moai/specs/` 디렉토리에 `SPEC-MOBILE-NAV*` 항목 부재 확인(SPEC-WEBVIEW-SHELL-001, SPEC-WEBVIEW-UNIFY-001, SPEC-WEBVIEW-NATIVE-FEEL-001, SPEC-MOBILE-NATIVE-UI-001, SPEC-MOBILE-001~004 존재 확인; NAV 부재). 신규 ID로 진행 가능.

### SPEC별 구속 사항

| SPEC (상태) | 구속 결정 | NAV-001 영향 |
|---|---|---|
| **WEBVIEW-SHELL-001** (in-progress) | R-S5(spec.md :72): "SHALL NOT introduce expo-router or a second navigatable route"; Non-Goals(:56): expo-router·네이티브 필 금지; OD-1 WebView 비리마운트(:81, :114) | **[상충 — 시간적 대체]** 이 non-goal은 MOBILE-003의 expo-router 도입으로 사실상 구식화됨. NAV-001은 "SHELL-001은 MOBILE-003 이전 시점 문서이며 NAV-001은 MOBILE-003의 내비 모델을 상속한다"를 명문화해야 혼선 방지. OD-1은 헤더(네이티브 크롬)와 직교라 위반 없음 |
| **WEBVIEW-UNIFY-001** (draft, 디바이스 게이트 대기) | R-U1(:62): 앱 전체 세션에서 **정확히 1개의 WebView**, 탭 전환·상세 이동 시 신규 마운트 금지; R-U2/OD-5(:66, :125): 네이티브 탭바 단일 소유 + 웹 BottomTabBar 숨김(이중 탭바 금지); R-U3/OD-3(:70): 탭 전환은 단일 공유 웹 히스토리 push, per-탭 독립 스택 비목표; OD-1 앱 스코프 확장(:122) | **[상충 — 핵심 미결]** R-U1은 옵션 A(화면당 WebView)와 양립 불가. 그러나 **현재 구현 코드는 멀티 BridgedWebView**(TabWebView×4 + home/[id])로 UNIFY-001과 이미 불일치. NAV-001은 어느 모델 위에 서는지 OD로 명시 필수. 헤더가 네이티브 크롬이어야 한다는 방향성(R-U2 위임 원칙)은 어느 모델에서든 동일 |
| **WEBVIEW-NATIVE-FEEL-001** (draft) | UNIFY-001 의존(:17, :48) — M4 "View Transitions API로 SPA 전환을 네이티브 push/pop 슬라이드화"는 in-WebView 애니메이션; R-NF1/Non-Goal(:51, :64): bridge-protocol v1 메시지 타입 변경 없음 | 네이티브 스택 push 전환(옵션 A)과 M4의 in-WebView 전환은 이중 애니메이션 위험 — 채택 조합 조정 필요. `nav:*` 메시지 추가(옵션 B)는 이 non-goal과의 관계 해석 필요(additive 확장 전례: MOBILE-004 `auth:google-request`) |
| **MOBILE-NATIVE-UI-001** (draft) | UNIFY-001과 **상호 배타적 대안**(Option B, :17, :49) — 전 UI 네이티브 RN 화면화, WebView 제거; OD-1(채택 여부) 미결 | Option B 채택 시 본 인벤토리의 "웹 헤더" 논의는 무효화(네이티브 화면별 헤더는 별개 설계). NAV-001은 "UNIFY 계열(웹 UI 유지)을 전제한다"는 가정 명시 필요 |
| **MOBILE-002** (in-progress) | Non-Goal(:59): "실제 네이티브 화면은 이후 SPEC(범위 밖)"; R-N6(:72, :87) 브리지 토큰 동기화 파운데이션 | NAV-001이 바로 그 "이후 SPEC". 헤더 가시성·인증 게이팅은 MOBILE-002의 세션 신호(`session:synced/none`)에 의존 |
| **MOBILE-003** (in-progress, 디바이스 게이트 대기) | expo-router 스켈레톤(R-RT1~R-RT6); 라우트↔URL 계약(웹 `/home` 등 = 네이티브 `(tabs)/home` 등, :158); R-NC3(:161): WebView 교차 라우트 자체 네비 금지 → `decideWebViewLoad`로 차단 후 네이티브 디스패치; R-WB2(:162): 이중 탭바 금지; "MeetupDetail 화면 제외 — 후속 SPEC"(:157-162) | **NAV-001의 직접 토대.** 라우트 트리와 URL 계약은 비협상 기반. 인터셉트-후-네이티브-디스패치 철학은 옵션 A와 동방향. 디바이스 게이트(Google OAuth 라운드트립/Android/로그아웃 E2E) 미통과 상태 |
| **MOBILE-004** (completed) | `auth:google-request` additive 브리지 타입(v0.3.0, :39); **cross-WebView 쿠키 격리 수정** `seedSharedCookiesFromWebKit()`(v0.3.1, :24) | 브리지 확장 전례 제공(옵션 B 근거). 옵션 A로 WebView 화면을 늘리면 쿠키 시딩 패턴 유지·확장 필수; UNIFY 단일 WebView면 이 이슈 자체가 소멸 |

### 의존·차단 관계 (선행 SPEC 리서처 원문 요약)

```
SHELL-001 (in-progress) → MOBILE-002 (in-progress) → MOBILE-003 (in-progress) → MOBILE-004 (completed)
                                                            ↓ [라우트 트리 계약]
                                                    MOBILE-NAV-001 [제안]
                                                            ├→ [가정] UNIFY-001 (draft) ←배타→ NATIVE-UI-001 (draft)
                                                            └→ [가정] NATIVE-FEEL-001 (draft, UNIFY 의존)
```

선행 SPEC 리서처의 차단 권고: MOBILE-003 디바이스 게이트(iOS/Android E2E 인증·로그아웃·내비)와 UNIFY-001 디바이스 게이트(단일 WebView 지속성) 확인 전 NAV-001 착수 시 가정 무효화가 연쇄될 수 있음. 단, 현재 구현 코드가 이미 멀티 WebView라는 사실을 감안하면 "UNIFY-001 채택 여부 결정"을 NAV-001 plan의 선행 OD로 두는 것이 실질적 최소 조건이다.

---

## 리스크와 암묵적 계약

### 축적된 교훈 (auto-memory + 코드 주석으로 확인된 것)

1. **iOS opacity:0 서스펜드**: WKWebView를 opacity:0으로 감추면 occluded 판정으로 JS가 서스펜드되어 브리지 핸드셰이크가 깨진다. 로딩 연출은 반드시 별도 커버 오버레이로(WebViewShell.tsx:119-124, :125-143). 신규 헤더 화면의 로딩/전환 연출에도 동일 적용.
2. **decelerationRate Android 크래시**: `decelerationRate="normal"`은 iOS 전용으로 분기되어 있음(WebViewShell.tsx:175, 커밋 be885d6). 신규 화면이 WebViewShell을 우회해 WebView를 직접 만들면 재발 위험.
3. **WKHTTPCookieStore 시딩**: 멀티 WebView에서 세션 쿠키는 NSHTTPCookieStorage가 아닌 WKHTTPCookieStore에 시딩해야 새 WebView의 첫 GET이 읽는다(`seedSharedCookiesFromWebKit()`, useAuthBridge.ts:270-274; MOBILE-004 v0.3.1). RN WebView 내부 구현 의존이라 라이브러리 업그레이드 시 파손 가능 — 옵션 A로 화면 수가 늘수록 이 취약면이 넓어진다.

### 네비게이션 자체 리스크

4. **Android 하드웨어 백 이원화**: `(tabs)`=native-back / `(auth)`=WebView goBack(app-lifecycle-core.ts:24-32). 신규 BridgedWebView에서 `routeContext` prop을 누락하면 백 동작이 조용히 어긋난다. 신규 화면이 `(tabs)`/`(auth)` 어느 그룹에도 안 맞으면(예: 전체화면 모달) 제3의 컨텍스트 설계 필요 — 현재 네이티브 모달/시트 패턴 부재.
5. **iOS 스와이프 제스처**: 스택 히스토리 기반 스와이프 백이 동작한다는 보고가 있으나 `animation:"none"`(_layout.tsx:74-103)과의 상호작용은 미검증. 헤더 도입 시 화면별 `animation`/`gestureEnabled` 정책을 명시적으로 정해야 함.
6. **타이틀 소스 부재**: 전 페이지 title="moyura" 고정(layout.tsx:28-30), `generateMetadata` 0곳. 네이티브 헤더 타이틀은 (a) 브리지 payload, (b) URL 파라미터로 모임명 전달, (c) 네이티브에서 API 재조회 중 하나를 선택해야 하며, 각각 배포 결합도/URL 오염/중복 fetch 트레이드오프가 있다.
7. **SPA soft-nav 인터셉트 사각지대**: `onShouldStartLoadWithRequest`는 클라이언트 사이드 pushState 전환을 잡지 못할 수 있다. `/home` → `/home/[id]`가 현재 push로 잡히는 것은 검증됐지만, `/home/[id]` → `/moims/[id]/chat` 등 신규 인터셉트 대상이 풀 로드로 오는지 라우트별 실측 필요.
8. **웹 back 크롬과의 이중화**: `/moims/[id]/*` 3페이지는 웹 sticky 헤더에 "← 뒤로" Link가 이미 있다(chat/page.tsx:84-89 등). 네이티브 헤더 도입 시 셸 모드에서 웹 헤더를 숨기는 CSS 계약(`html[data-shell="native"]` 패턴, globals.css:371-389) 확장이 없으면 뒤로 버튼이 2개가 된다. 반대로 웹 back Link의 목적지는 `/home/{moimId}` **고정 링크**라, 네이티브 스택 pop(진입 경로 복귀)과 의미가 다를 수 있음(알림에서 chat 직행한 경우 등).
9. **탭↔스택 상태 손실**: 상세에서 리스트로 복귀 시 WebView가 다르므로 스크롤 위치·필터 상태가 보존되지 않을 수 있음(인벤토리 리서처 HIGH 리스크).
10. **딥링크 경로**: `moyura://invite/{token}`(invite/[token].tsx:12-22)과 알림 → `/(tabs)/home/[id]?target=chat`(_layout.tsx:59-68, :78-85) 두 딥링크는 **스택 히스토리 없이 화면이 첫 진입**이 될 수 있다. 이 경우 헤더의 back은 pop이 아니라 명시적 홈 이동(fallback)이어야 하며, 딥링크 파싱이 중앙화되어 있지 않아(수동 URL 파싱) 신규 화면 추가 시 _layout.tsx 수정이 강제된다.
11. **셸 감지 취약성**: UA 오버라이드 없이 `window.__MOYURA_NATIVE_SHELL__` 주입 타이밍 + `window.ReactNativeWebView` 존재에 의존. 브리지 구현 변경 시 감지가 조용히 깨지고, 그러면 웹 크롬 숨김/헤더 분기 전체가 오작동.
12. **선행 SPEC 결정 미결의 연쇄**: UNIFY-001 vs NATIVE-UI-001 상호 배타 선택(OD-1)이 미결. NAV-001을 옵션 A 구조로 구현한 뒤 UNIFY-001이 채택되면 화면별 WebView를 걷어내는 재작업, NATIVE-UI-001이 채택되면 웹 헤더 인벤토리 자체가 무효화. plan에서 가정을 명시하고 게이트로 걸 것.
13. **sticky 헤더 공존**: 모든 상세 페이지에 `sticky top-0` 웹 헤더(z-30/z-20)가 존재. 네이티브 헤더는 WebView 뷰포트 바깥(위)에 위치하므로 문서 흐름과 직접 충돌하지 않지만, 웹 헤더를 숨기지 않으면 시각적 이중 헤더가 된다. chat의 `h-dvh` 고정 내부 스크롤 모델(chat/page.tsx:475)은 네이티브 헤더만큼 뷰포트가 줄었을 때의 레이아웃 재검증 필요. safe-area는 `viewport-fit=cover`(layout.tsx:37-38) + `env(safe-area-inset-*)` 사용 중 — 네이티브 헤더가 status bar 영역을 차지하면 웹 측 top inset 가정이 바뀐다.

---

## 추가 조사 (갭 보강)

2026-07-03 추가 리서치 3건(soft-nav 인터셉트 검증 갭 / push 가드 구조 갭 / 알림 탭 진입 경로) 통합. 알림 탭 진입 출처는 상단 전수 인벤토리 표(`/home/[id]`, `/moims/[id]/schedule`, `/moims/[id]/expenses` 행의 진입 출처 컬럼)에 직접 반영했고, 나머지 발견은 아래에 정리한다.

### 갭 1 — SPA soft-nav 인터셉트는 미검증이며, "검증된 패턴의 확장" 전제를 흔든다

**문제 진술과의 자기모순.** SPEC-MOIM-003 spec.md:31의 문제 진술은 "navigating home → 모임 상세 happens INSIDE the WebView" — 즉 soft-nav가 `onShouldStartLoadWithRequest`에 **잡히지 않는다**는 것을 전제한다. 그런데 구현과 본 문서의 옵션 A 서술은 이 이동이 인터셉트되어 네이티브 push로 승격된다고 가정한다. 두 전제는 직접 모순이며, 어느 쪽이 실기기에서 참인지 확인된 바 없다.

**근거 1 — 인터셉트 지점은 full-page 로드 전용.** 유일한 인터셉트 지점은 `onShouldStartLoadWithRequest`다(`/Users/hatae/Documents/personal/moyura/apps/mobile/hooks/useAuthBridge.ts:197-238`). react-native-webview 문서 기준 이 콜백은 top-level HTTP(S) 네비게이션 시에만 발화하며, Next.js `<Link>` soft-nav(내부적으로 pushState), React Router 이동, 수동 `history.pushState()` 호출에는 발화하지 않는다. 그리고 진입 링크는 soft-nav다: HomeTab.tsx:50 `<Link href="/home/{id}">`.

**근거 2 — pushState 심(shim)이 양쪽 앱 어디에도 없음.** apps/mobile 전체에서 `pushState|replaceState|history\.` 검색 결과 커스텀 구현 0건(node_modules 타입 정의만 존재). 웹 셸 모드도 마찬가지: `/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/_components/ShellModeEffect.tsx:1-35`는 `data-shell="native"` 속성 설정만 수행하며(line 4 주석에서 "pushState, server-action redirect"를 인지하고는 있음), 강제 풀 로드·history 인터셉트·pushState 발생 시 브리지 신호 어느 것도 주입하지 않는다(`/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/layout.tsx:27-30` 동일). 즉 soft-nav 발생 사실을 네이티브 레이어가 알 수 있는 채널이 현재 0개다.

**근거 3 — 기존 "검증"은 순수 함수 단위 테스트일 뿐.** `/Users/hatae/Documents/personal/moyura/apps/mobile/hooks/auth-bridge-core.detailpush.test.ts:1-106`(특히 lines 21-28)의 입력은 이미 파싱된 URL 문자열(`currentUrl: "http://localhost:3000/home"`)이다. 이 테스트는 URL이 주어졌을 때의 결정 로직만 검증하며, soft-nav 시 그 URL이 실제로 `onShouldStartLoadWithRequest`를 거쳐 결정 함수에 도달하는지는 검증하지 않는다. MOIM-003 sync 리포트도 이를 명시한다: "이 24건은 모두 GREEN이나 **in-app E2E를 대체하지 않는다**"(`/Users/hatae/Documents/personal/moyura/.moai/reports/sync-report-SPEC-MOIM-003.md:138-140`).

**근거 4 — 디바이스 게이트 AC-3 미수행.** "이번 세션에서 앞서 진행된 Google 로그인 토큰이 유효 기간 경과로 만료되어 실 인증 세션 하에서 카드 탭을 수행하지 못했다"(sync-report-SPEC-MOIM-003.md:126-141). spec.md:182 게이트(iOS 시뮬레이터 dev build에서 홈 카드 탭 → 네이티브 상세 push → 웹 상세 렌더 → 네이티브 back 복귀 라이브 검증) 미통과로 MOIM-003 status는 `in-progress`로 남아 있다. 즉 카드 탭 → push의 실기기 증거는 현재 0건이다.

**본 문서 서술 정정.** 위에 따라 옵션 A의 "현재 `/home/{id}`에만 적용된 검증된 패턴"과 리스크 7의 "`/home` → `/home/[id]`가 현재 push로 잡히는 것은 검증됐지만"은 **과대 진술**로 하향한다 — 검증된 것은 결정 로직(vitest 24건)뿐이고, soft-nav가 인터셉트 경로에 도달한다는 실기기 증거는 없다.

**설계 함의.** soft-nav가 인터셉트되지 않는 것으로 실측되면: 옵션 A 단독은 동작 불가하고, 옵션 B(웹이 셸 모드에서 `nav:push {path, title}` postMessage로 명시 신호 → 네이티브 `router.push`)가 보완재가 아니라 **필수재**가 되며, 옵션 C 계열(셸 모드에서 soft-nav를 풀 로드로 강제)은 UX 후퇴를 감수하는 차선책으로 남는다.

**착수 전 검증 절차(필수 게이트).** iOS 시뮬레이터 dev build → 로그인 → 홈 카드 탭 → `onShouldStartLoadWithRequest` 콜백 로그 관찰. 라이브러리 동작 기준 예상은 "로그 없음(soft-nav 우회)"이다. 만약 로그가 찍힌다면(예: 해당 전환이 실제로는 풀 로드로 처리되는 경우) 옵션 A가 유효하다 — 이 라우트별 실측 결과가 곧 옵션 선택의 결정 변수이므로, plan의 선행 검증 항목으로 명시할 것.

### 갭 2 — same-tab push 가드의 구조적 한계: 헤더 필요 5페이지 중 3페이지는 분류기 확장만으로 push 불가

옵션 A 서술("분류기에 `/moims/{id}/chat|schedule|expenses` 패턴 추가")은 **push 가드 자체의 재설계 필요성을 누락**했다. `decideWebViewLoad`의 push 가드(`/Users/hatae/Documents/personal/moyura/apps/mobile/hooks/auth-bridge-core.ts:268-272`)는 두 조건을 동시에 요구한다: (1) `detailRouteForUrl(url)`이 비-null(= 정확히 2세그먼트), (2) `routeForUrl(ctx.currentUrl) === detail.route`(= 현재 URL이 1세그먼트 앱 라우트).

세그먼트 수 기준 분류 결과:

| 경로 유형 | 예 | 세그먼트 | routeForUrl | detailRouteForUrl | push 가능? |
|---|---|---|---|---|---|
| 앱 라우트 | /home | 1 | "home" | null | 아니오 (dispatch 경로) |
| detail (2세그먼트) | /home/123 | 2 | null | {route:"home", id:"123"} | 예 |
| sub-detail (3세그먼트) | /moims/abc/chat | 3 | null | null | **아니오** |

**차단 근거(코드).**
- `/Users/hatae/Documents/personal/moyura/apps/mobile/lib/route-map-core.ts:53-65` — `routeForUrl`은 세그먼트 수가 1이 아니면 null 반환(:59-61)
- `route-map-core.ts:112-134` — `detailRouteForUrl`은 세그먼트 수가 2가 아니면 null 반환(:119-120)
- `auth-bridge-core.ts:258-264` — cross-route dispatch 분기는 `isCrossRoute`가 targetRoute null이면 false(route-map-core.ts:170-171)라 3세그먼트 URL은 dispatch 검사도 건너뜀

**네비게이션 트레이스** (currentUrl=/home/abc → 대상 /moims/abc/chat): ① line 258 isCrossRoute 검사 — routeForUrl("/moims/abc/chat")=null(3세그먼트) → false, 분기 스킵. ② line 269 detailRouteForUrl 검사 — null(3세그먼트) → 가드 불통과(line 270). ③ line 275 trusted-load 폴스루 — URL이 WebView 내부에서 그대로 로드, 네이티브 push 없음. 기존 테스트가 이 동작을 명시적으로 고정하고 있다(`auth-bridge-core.detailpush.test.ts:79-86`):

```typescript
it("채팅 입장(/moims/{id}/chat, 3 세그먼트)은 push/dispatch 아님 → trusted-load(WebView 내 유지)", () => {
  expect(
    decideWebViewLoad("http://localhost:3000/moims/abc/chat", {
      ...ctx,
      currentUrl: "http://localhost:3000/home/abc",
    }),
  ).toBe("trusted-load");
});
```

**필요 재설계.** 현 가드는 depth-1 → depth-2 push(/home → /home/123)만 지원한다. chat/schedule/expenses에 옵션 A를 적용하려면 depth-2 → depth-3 push(/home/123 → /moims/123/chat)까지 지원하도록: (1) 3세그먼트 경로를 인식하는 분류기 신설, (2) 가드 조건이 depth-2 currentUrl도 허용하도록 수정, (3) same-context sub-detail push(허용)와 cross-context 이동(거부)을 구분하는 검증 추가. 또한 신규 sub-detail 화면이 currentUrl=undefined 상태로 첫 로드될 때 self-push 루프를 막는 초기화 예외 메커니즘이 필요하다(현행 `ctx.currentUrl !== undefined` 가드(:268)와의 상호작용 설계).

**인벤토리 영향.** 헤더 필요 5페이지 중 `/moims/[id]/chat`, `/moims/[id]/schedule`, `/moims/[id]/expenses` 3곳(60%)이 **가드 재설계 없이는 옵션 A 구현 불가**. 재설계 없이(분류기 패턴 추가 수준으로) 가능한 것은 `/home/[id]`(기동작)와 `/moims/new`(2세그먼트)뿐이다. 따라서 옵션 A의 실작업 범위는 "분류기 패턴 추가"가 아니라 "push 가드 구조 재설계"이며, 이는 plan의 규모 산정과 실행 가능성 게이트에 직접 영향을 준다. 가드 재구조화 시 검증 로직이 불완전하면 cross-context 네비게이션 우회(의도치 않은 push)가 열리는 리스크도 함께 관리해야 한다.

### 갭 3 — 알림 탭 직링크와 cross-tab push 정책: 같은 목적지가 진입 경로에 따라 뒤로가기 유무가 갈린다

**알림 피드의 3종 링크 대상.** 알림 탭(/notifications)의 NotificationItem은 세 경로로 직접 링크한다(`/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/notifications/notification-item.tsx:97-224`): `/home/{moimId}`(member.joined/owner.delegated/poll.created/poll.closed — :105, 118, 180, 188), `/moims/{moimId}/schedule`(schedule.* 4종 — :137, 146, 155, 168), `/moims/{moimId}/expenses`(expense.added/settlement.* — :202, 214, 222). 기존 인벤토리 표의 해당 3행 진입 출처에는 이 알림 탭 직링크가 누락되어 있었다(본 갭 보강에서 표에 직접 반영 완료).

**현행 정책: same-tab push만 허용.** `auth-bridge-core.ts:223-224` 주석이 명시한다: "detail push 는 같은 탭(route(currentUrl)===detailRoute)일 때만 — cross-tab detail(/explore→/home/123)은 push 아님 (MOBILE-003 crossroute 동작 보존, trusted-load)". 구현은 :268-273.

**알림 탭에서의 실제 동작** (currentUrl=/notifications 기준, :265-276):
- `/home/[id]`: currentRoute(notifications) ≠ detailRoute(home) → cross-tab 판정 → push 불가 → **WebView 내부 로드** → back affordance 없음
- `/moims/[id]/schedule`·`/moims/[id]/expenses`: 3세그먼트라 애초 push 대상 자체가 아님(갭 2) → 동일하게 **WebView 내부 로드** → back affordance 없음

**홈 탭 경유와의 대비.** 홈 탭 카드 탭(`/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/home/HomeTab.tsx:51` `<Link href={/home/${moim.id}}`)은 routeForUrl(/home) === detailRoute(home) → **push 가능** → expo-router Stack 화면 생성 → 네이티브 헤더 부착 가능. 한편 MoimActionDock의 3링크(`/Users/hatae/Documents/personal/moyura/apps/web/app/(main)/home/[id]/moim-action-dock.tsx:18-41` — chat/schedule/expenses)는 `/home/[id]`(이미 네이티브 스택 위) 내부에서 호출되므로 현 push 정책의 영향권 밖이다. 관련 네이티브 측 코드: currentUrl 추적은 `BridgedWebView.tsx:220-226`(onNavigationStateChange), push 실행은 :190-195(onDetailPush 콜백).

**이중 표면(버그 재생산).** 결과적으로 동일한 `/home/123` 페이지가 홈 탭 경유면 뒤로가기 가능(native push), 알림 탭 경유면 불가(WebView 내부 trusted-load)가 된다 — 본 SPEC이 고치려는 "back affordance 부재" 버그가 진입 경로 축으로 재생산된다. 알림 경유는 실사용 빈도가 높은 경로이므로, 요구사항/AC가 홈 탭 경로만 커버하면 반쪽 SPEC이 된다.

**설계 결정 강제.** cross-tab detail을 push하지 않는 정책(스택 오염 방지 vs back affordance 제공의 트레이드오프)은 현재 **코드 주석에만** 존재하고 SPEC 차원의 설계 결정으로 명문화된 적이 없다. NAV-001 plan에서 "알림 경유 진입의 back 동작"을 명시적 OD로 승격해야 한다: (a) cross-tab push 허용으로 정책 변경(어느 탭 스택에 쌓을지 결정 필요), (b) 현 정책 유지 + 알림 경유 페이지는 웹 back 폴백, (c) 옵션 B `nav:push`로 알림 클릭을 네이티브 내비로 승격 등. 단 (c)의 경우에도 알림 피드 링크는 `<Link>` soft-nav이므로 갭 1의 인터셉트 사각지대가 그대로 적용된다 — 웹 측 명시 신호 없이는 어떤 안도 자동으로 성립하지 않는다.

### 갭 보강이 기존 권고에 미치는 영향

기존 권고(옵션 A 골격 + 옵션 B 보완 하이브리드)는 다음 조건부로 하향 조정한다:

1. **갭 1의 실측이 선행 게이트다.** soft-nav가 `onShouldStartLoadWithRequest`에 잡히는지의 라우트별 실측(iOS 시뮬레이터) 결과에 따라 A+B 하이브리드 유지 vs B 중심(웹 내비 지점의 명시 `nav:push` 신호) 재편이 갈린다. "검증된 패턴의 확장"이라는 기존 근거는 실측 전까지 성립하지 않는다.
2. **갭 2로 옵션 A의 규모 산정이 바뀐다.** 채택 시에도 실작업은 분류기 패턴 추가가 아니라 push 가드 재설계(depth-2→depth-3 지원 + 초기화 루프 방지 + cross-context 우회 차단)이며, 헤더 필요 5페이지 중 3페이지가 이 재설계에 종속된다.
3. **갭 3의 cross-tab 정책 결정이 요구사항에 반드시 포함되어야 한다.** 알림 탭 직링크 3종(인벤토리 표 반영 완료)의 back 동작을 정의하지 않으면, 네이티브 헤더 도입 후에도 알림 경유 경로만 WebView 내부에 남는 불일치가 생긴다.

---

## 외부 웹 리서치 (실현 가능성 검증)

2026-07-03 deep-research 하니스(21개 소스 정독, 100개 주장 추출 → 25개 적대적 3표 검증 → 18 confirmed / 7 killed). 주장별 판정과 출처는 아래. **이 검증은 사내 리서처가 세운 옵션 A의 핵심 전제 하나를 거짓으로 판정한다.**

### 검증된 주장 (판정 + 출처)

| # | 판정 | 요지 | 출처 |
|---|------|------|------|
| 1 | **거짓** | `onShouldStartLoadWithRequest`는 SPA soft-nav(pushState, Next.js `<Link>` 클라이언트 전환)에서 **발화하지 않는다**. 이 콜백은 '웹뷰 로드 요청' 전용. 게다가 Android는 첫 로드에서 미호출 + `navigationType`/`isTopFrame`/`mainDocumentURL`/`hasTargetFrame` 4개 필드가 전부 iOS 전용이라, Android에서는 이 콜백으로 '링크 클릭'을 구분하는 것 자체가 API상 불가능. → **네이티브 콜백으로 SPA 내비를 가로채 스택 push하는 옵션 A 설계는 이 API로 성립하지 않는다.** | RN-WebView Reference.md, issues #390·#1785 |
| 1보완 | **조건부 사실** | SPA soft-nav의 **사후 감지**는 `onNavigationStateChange`로 가능(iOS는 주입된 history shim, Android는 v12.1.0+ `doUpdateVisitedHistory`, 13.x는 양 플랫폼 지원). 단 **사전 차단(intercept)이 아니라 사후 통지** — push 전에 웹 이동을 막으려면 웹 측 인터셉트(주입 스크립트 preventDefault + postMessage)가 필수. | RN-WebView issues #2667, PR #2929 |
| 2 | **부분 사실** | `allowsBackForwardNavigationGestures`는 iOS/macOS 전용(기본 false), **Android에는 WebView 레벨 상응 prop이 없다**(feature request #1613은 2020년 봇 자동 종료 후 미구현). Android 스와이프-백 정합은 시스템 백 제스처 + `webViewRef.goBack()` 직접 구현만 가능. | Reference.md, issue #1613 |
| 4 | **조건부** | WKWebView 백포워드 엣지 스와이프는 opt-in(기본 false, 13.x 소스도 미오버라이드). **끄면 좌측 엣지에서 네이티브 스택 pop 제스처와 충돌 자체가 없다.** 켜면 `interactivePopGestureRecognizer`와 동일 엣지 경쟁이 반복 보고됨. → **끄고 네이티브 pop만 쓰는 것이 설계상 안전.** | Apple WKWebView 문서, cordova-plugin #574 등 |
| 3 | **미확정(문서 공백)** | `animation:"none"`일 때 `gestureEnabled`(스와이프 pop) 생사는 **어느 공식 문서에도 없다.** '죽는다/산다' 어느 쪽도 문서로 단정 불가. → **현재 코드의 `animation:"none"`(_layout.tsx:92, home/_layout.tsx:13)에서 스와이프 pop 동작은 실기기 프로토타입으로 반드시 확인해야 하는 리스크.** | reactnavigation.org native-stack, react-native-screens jsdocs |
| 3/4보완 | **사실** | `fullScreenSwipeEnabled`는 iOS 버전 의존(iOS<26 커스텀 recognizer 기본 false / iOS≥26 네이티브 기본 true). 단 **expo-router 3~4.x가 고정하는 구버전 screens(~3.29/~4.4)에는 iOS 26 경로 없음**(screens 4.15+ 필요). | react-native-screens@4.25.2 문서 |
| 5 | **조건부(대형 반례)** | **Shopify는 '페이지당 새 WebView를 네이티브 스택에 push'하는 패턴을 명시적으로 거부**(세션 유실 + 느린 경험). 단일 WebView를 스크린 간 이동시키는 TransportableView + 프리로드/풀로 **로드 P75 6s→1.4s(~6x) 개선**. | shopify.engineering/mobilebridge-native-webviews |
| 5 | **조건부 사실(실전 사례)** | 이 패턴 실전 사례는 존재하나 결이 다름: (a) SW Mansion `react-native-web-screen` = 네이티브 스택+헤더지만 **Hotwire Turbo 전제 + 단일 세션 공유 + 이전 화면 스크린샷 캐싱**(라이브 N개 아님); (b) 한국 스타트업(Devocean) = 스크린마다 개별 URL WebView, 라우팅/탭바/헤더 네이티브 위임, 2.5개월 30+ 스크린. **둘 다 Next.js App Router 스택 직접 이식을 보증하진 않음.** | npm react-native-web-screen, devocean.sk.com |
| 5리스크 | **사실** | **다중 WebView 인스턴스 = 격리된 브라우징 컨텍스트.** 한 화면의 react-query refetch/invalidate가 다른 화면 WebView에 전파 안 됨 → BroadcastChannel 브리지 직접 구현 필요. **쿠키/영속 스토리지는 앱 전역 공유(세션 자체는 OK)** — 격리되는 건 인메모리 JS 상태. | devocean.sk.com |

### 기각된 주장 (근거로 쓸 수 없음)

- "토스가 페이지당 WebView push 패턴의 레퍼런스" → **0-3 기각.** 토스 공식 방향은 오히려 WebView 콜드 로드 비용 때문에 RN으로 이탈. 카카오 stackflow는 검증 대상에 오르지 못함.
- "Next.js App Router가 `router.events`를 제거해 공식 내비 가로채기 수단이 없다" → **0-3 기각**(더 정교한 사정 존재).
- "`<Link>`·`router.push`가 모두 `window.history.pushState`로 수렴하므로 pushState 몽키패치로 전부 가로챌 수 있다" → **0-3 기각**(커버리지 불충분).

### 미해결(실기기/프로토타입 선행 검증 필수)

1. **Next.js App Router 내비 완전 가로채기**: `<Link>` 클릭 · `router.push` · Server Action redirect를 **누락 없이** 웹 측에서 가로채는 확정 패턴은 이 리서치로 확정 불가(관련 주장 전원 기각). Next 15.3+ `Link onNavigate` prop 등 별도 검증 필요.
2. **`animation:"none"` 스크린의 iOS 스와이프 pop 실제 생사** (문서 공백 — screens 고정 버전 기준 실기기 확인).
3. **`allowsBackForwardNavigationGestures` on + pushState 히스토리의 스냅샷 글리치 품질**(끄기를 권장하므로 우선순위 낮음).
4. **웹 인터셉트→postMessage→네이티브 push 체감 지연** 실측 + 프리로드 풀 대비 WebView 인스턴스당 메모리 비용.

### 검증이 사내 리서치 권고에 미치는 영향

- **옵션 A(로드 인터셉트 확장) 단독은 불성립.** `onShouldStartLoadWithRequest`가 soft-nav를 못 잡으므로(주장1 거짓), 사내 리서치가 이미 "과대 진술"로 하향했던 갭 1이 외부 근거로 **확정**됨. 현재 `/home/[id]` push조차 실기기 검증 0건(MOIM-003 device-gated, in-progress)이라 "동작 중인 검증된 패턴"이라는 전제 자체가 성립하지 않는다.
- **웹 측 인터셉트 + `nav:push` postMessage(옵션 B)가 보완재가 아니라 필수재**로 승격. 단 옵션 B의 웹 측 가로채기 완전성(위 미해결 1)은 별도 스파이크로 확인해야 한다.
- **제스처는 플랫폼 비대칭**: iOS는 WKWebView 백스와이프 OFF + 네이티브 스택 pop(단 animation:"none" 상호작용 device-verify), Android는 WebView 레벨 스와이프 수단 부재 → 시스템 predictive back + goBack 직접 구현. "iOS·Android 동일 UX 대칭"은 라이브러리 차원에서 제공되지 않는다.
- **아키텍처 비용 경고**: 페이지당 WebView push는 Shopify가 거부한 패턴이며 다중 WebView는 react-query 상태 격리 비용을 수반. 단일 WebView + 네이티브 헤더 오버레이(UNIFY-001 방향)가 back affordance만 목표라면 더 저렴한 대안일 수 있다 — plan에서 정면 비교 필요.
