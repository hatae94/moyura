# Plan — SPEC-MOBILE-NAV-001 (모바일 네이티브 헤더·뒤로가기)

> 단일 지속 WebView + **네이티브 헤더 크롬 오버레이**(브리지 nav 상태 구동)로 "홈→상세 진입 시 눈에 보이는 뒤로가기 수단 부재" 버그를 해소하는 구현 계획.
> 방법론: TDD(`quality.development_mode: tdd`). RN/expo import 파일(컴포넌트·라우트·`_layout.tsx`)은 vitest 불가이므로 결정 로직을 `-core.ts` 순수 모듈로 추출해 RED 대상으로 삼는다(MOBILE-003 plan §4.4·research 관행). 브라운필드 — 기존 동작 보존.
> 시간 추정 금지: 우선순위 라벨(High/Medium/Low) + phase 순서로 표기.
> 문서 언어 한국어 / 코드 식별자·라우트·경로 영어. HARD: 이 문서는 **계획만** — 구현 코드·spec.md·acceptance.md·spec-compact.md 는 사용자 승인 후 별도 작성.

---

## 1. 개요 + 문제 정의

### 1.1 문제 (research.md §문제 원인 분석 검증 완료)

홈(`/home`)에서 모임 상세(`/home/[id]`)로 진입하면 화면 어디에도 **눈에 보이는 뒤로가기 수단이 없다.** 세 원인이 겹친다(전부 코드 대조 확인):

1. **웹 상세 헤더에 back 버튼 없음** — `apps/web/app/(main)/home/[id]/page.tsx:106` sticky 헤더는 모임명 `<h1>`(:113)만 렌더, back 미제공. `apps/web/app/moims/new/create-moim-form.tsx:30-31` 도 `<h1>새 모임 만들기</h1>` 만 있고 back 없음(폼 실패 시 갇힘).
2. **네이티브 스택은 push하지만 헤더를 숨김** — `_layout.tsx:92` 루트 Stack `{ headerShown:false, animation:"none" }`. `BridgedWebView.tsx:131-136` `onDetailPush`가 `router.push('/(tabs)/home/[id]')` 하지만 헤더가 그려지지 않는다. iOS엔 하드웨어 백이 없어 스와이프를 모르면 사실상 갇힌다.
3. **셸 모드 크롬 공백** — `(main)/layout.tsx:30` + `globals.css:372-379` 는 셸 모드에서 웹 하단 탭바를 숨기는 계약(`html[data-shell="native"]`)이 이미 있는데, **헤더에 대해서는 네이티브가 아무것도 그리지 않아** 크롬 공백이 발생한 것이 이 SPEC의 본질이다.

### 1.2 딥리서치가 확정한 설계 제약 (research.md §외부 웹 리서치 — 결정적)

- **[확정 거짓]** `onShouldStartLoadWithRequest`는 SPA soft-nav(Next `<Link>` pushState 전환)에서 **발화하지 않는다**. 진입 링크는 전부 soft-nav다(`HomeTab.tsx:50` `<Link href="/home/{id}">`). → **네이티브 콜백으로 SPA 내비를 가로채 스택 push하는 옵션 A 단독은 이 API로 성립 불가.** 웹측 명시 신호가 필수재.
- **[확정]** 현 `/home/[id]` push조차 실기기 검증 0건(MOBILE-003 device-gated, in-progress). "동작 중인 검증된 패턴"이라는 전제 자체가 미성립.
- **[비대칭]** iOS = WKWebView 백스와이프 opt-in(끄면 엣지 충돌 없음), Android = WebView 레벨 스와이프 수단 부재. 라이브러리 차원 UX 대칭 없음.
- **[아키텍처 경고]** 페이지당 WebView push는 Shopify가 명시 거부(세션 유실+느림). 다중 WebView = react-query 인메모리 상태 격리 비용. **단일 WebView + 네이티브 헤더 오버레이가 back affordance만 목표라면 더 저렴**.

### 1.3 이 SPEC의 접근 (사용자 확정)

**push 승격을 버리고 헤더 크롬을 브리지 구동으로 오버레이한다.** 네이티브는 WebView 위에 헤더 바(back chevron + title)를 셸 모드에서 항상 렌더한다. 웹이 route 변경마다 자신의 nav 상태를 브리지로 보고하고, 네이티브가 그에 따라 back chevron 가시성·타이틀을 그린다. 이 접근은 딥리서치가 죽인 blocker들을 정면으로 우회한다:

- `onShouldStartLoadWithRequest` soft-nav 인터셉트 의존 없음(웹이 명시 보고).
- 페이지당 WebView push 없음(Shopify 거부 회피, react-query 격리 비용 회피).
- `animation:"none"`×스와이프 pop 불확정성 없음(네이티브 스택 pop 제스처를 back 수단으로 쓰지 않음).

---

## 2. 선택 아키텍처 (데이터 흐름)

### 2.1 개념도

```
┌──────────────────────────────────────────────────────┐
│  Native shell ((tabs) 컨텍스트)                        │
│  ┌────────────────────────────────────────────────┐  │
│  │  NativeHeaderBar  [ <  |  모임명 ]   ← 네이티브  │  │  ← WebView 뷰포트 밖(위), status bar 인셋 소유
│  ├────────────────────────────────────────────────┤  │
│  │                                                │  │
│  │   WebViewShell (기존 단일 인스턴스, 셸 모드)     │  │  ← 웹 sticky 헤더는 셸 모드에서 숨김
│  │   /home/[id] → soft-nav → /moims/[id]/chat ...  │  │
│  │                                                │  │
│  └────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────┐  │
│  │  Native Tabs (기존 R-U2 계약)                    │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 2.2 브리지 데이터 흐름 (양방향 nav 채널 — v1 additive)

```
[route 변경]
  웹(usePathname effect) ──nav:state{pathname,title,canGoBack}──▶ 네이티브
                                                                    │
                                        nav-header-core.decideHeader() 순수 결정
                                                                    ▼
                                          NativeHeaderBar {showBackChevron,title} 갱신

[back chevron 탭]
  네이티브 ──nav:back(nonce)──▶ 웹(리스너) ── router.back()/history.back()
                                              │  (in-app 히스토리 있으면 이전 route)
                                              └─ 히스토리 없음(딥링크 첫 진입) → router.replace('/home') 폴백
                                                                    │
                              웹 route 변경 → 다시 nav:state 보고 → 헤더 자가 갱신
```

**단일 진실 출처 = 웹.** 타이틀(모임명 등)·canGoBack·딥링크 폴백 로직 모두 웹이 소유하고 네이티브는 헤더를 그리기만 한다. 이 선택이 back-action 라우팅 결정을 강제한다(§8 OD-2 참조): 네이티브가 `webViewRef.goBack()`을 직접 부르지 않고 `nav:back`으로 웹에 위임하는 이유는, 네이티브가 "딥링크 첫 진입 vs in-app 히스토리"를 알 수 없기 때문이다(웹만 `history.length`/document.referrer로 판정 가능).

### 2.3 topology-agnostic 성질 (수렴 OD의 핵심 — §8 OD-1)

이 헤더 오버레이는 **단일/멀티 WebView 무관하게 동작한다.** 헤더는 웹이 보고한 pathname만 소비하므로, 그 WebView가 네이티브 push된 상세 화면이든 soft-nav 중인 탭 WebView든 동일하게 그려진다. 현 코드의 실제 상태(멀티: `TabWebView`×4 + `home/[id]` 네이티브 push, chat/schedule/expenses는 `home/[id]` WebView 안 soft-nav)에서도, UNIFY-001 단일 WebView로 수렴한 뒤에도 이 메커니즘은 무효화되지 않는다. **따라서 이 SPEC은 topology 수렴을 수행하지 않는다(권고안 — §8 OD-1).**

---

## 3. EARS 요구사항 설계 (모듈 ≤5, 각 typed)

> ID 규칙: `REQ-MOBNAV-NNN`. `[DELTA]` 마커: `[NEW]` 신규 / `[MODIFY]` 기존 변경 / `[EXISTING]` 변경 없이 의존. 각 요구는 acceptance.md 작성 시 AC 와 1:1 대응 예정.

### M1 — 네이티브 헤더 크롬 렌더 (`[NEW]` NativeHeaderBar + nav-header-core)

- **REQ-MOBNAV-001 (State-driven)** `[NEW]` `apps/mobile/components/NativeHeaderBar.tsx`, `apps/mobile/lib/nav-header-core.ts`:
  **WHILE** the app is in `(tabs)` shell context AND the current web route is one of the 5 header pages, the app **SHALL** render a native header bar (뒤로 chevron 영역 + title) positioned ABOVE the WebView viewport, owning the status-bar top inset.
- **REQ-MOBNAV-002 (State-driven)** `[NEW]` nav-header-core:
  **WHILE** the reported nav state indicates in-app back is possible (`canGoBack`/`depth > 0`), the header **SHALL** show the back chevron as an interactive affordance; **IF** back is not possible, **THEN** the header **SHALL** hide the chevron (title-only 헤더).
- **REQ-MOBNAV-003 (Unwanted)** `[NEW]`:
  The app **SHALL NOT** render the native header bar on tab-root routes (`/home`, `/explore`, `/notifications`, `/profile`) nor on the 3 held pages (`/me`, `/invite`, `/invite/[token]`) — 헤더는 헤더 필요 5페이지에 한정한다(§9 제외 범위와 1:1).

### M2 — 웹측 nav 상태 보고 (`[NEW]` NavStateReporter + `[MODIFY]` 웹 브리지)

- **REQ-MOBNAV-010 (Event-driven)** `[NEW]` `apps/web/app/(main)/_components/NavStateReporter.tsx` (+ `apps/web/app/moims/layout.tsx` 마운트):
  **WHEN** the web pathname changes inside shell mode (soft-nav 또는 full load), the web **SHALL** report `{pathname, title, canGoBack}` to native via an additive `nav:state` bridge message. 데스크톱 브라우저에서는 no-op(브리지 부재).
- **REQ-MOBNAV-011 (Event-driven)** `[NEW]` `apps/web/lib/native-bridge/bridge-protocol.ts`, `bridge-client.ts` `[MODIFY]` + `apps/mobile/lib/auth/bridge-protocol.ts` `[MODIFY]`:
  The `nav:state`/`nav:back` message types **SHALL** be added as **additive v1 types** reusing the existing per-session nonce + trusted-origin envelope, and **SHALL NOT** alter the existing session message types(`session:*`, `auth:google-request`, `invite:invalid`). unknown-type graceful-ignore 계약 보존.
- **REQ-MOBNAV-012 (Ubiquitous)** `[NEW]` NavStateReporter title 소스:
  The reported `title` **SHALL** be derived from web route context data (모임명 등 — 전 페이지 `title:"moyura"` 고정이므로 route에서 명시 산출), never from the static document `<title>`.
- **REQ-MOBNAV-013 (Unwanted — 선행 스파이크 게이트)** `[NEW]`:
  The web-side pathname-observation pattern **SHALL** be verified (SPIKE, §5 Phase 0) to cover `<Link>` navigation, `router.push`, and Server Action redirect **without omission on Next 16** before M2 실구현 착수. 미검증 상태에서 M2를 구현하면 헤더가 특정 전환 유형에서 침묵(누락)하는 반쪽 결과가 된다.

### M3 — Back 동작 라우팅 + 하드웨어/제스처 정합 (`[MODIFY]` 브리지 + back 분기)

- **REQ-MOBNAV-020 (Event-driven)** `[MODIFY]` `apps/mobile/hooks/useAuthBridge.ts`(injectNavBack) + `apps/mobile/lib/auth/bridge-protocol.ts`(decideInboundAction) + `apps/web/lib/native-bridge/bridge-client.ts`(nav:back 리스너):
  **WHEN** the native back chevron is tapped, native **SHALL** post `nav:back`; the web **SHALL** execute in-app back (`router.back()`/`history.back()`).
- **REQ-MOBNAV-021 (Unwanted — 딥링크 폴백)** `[NEW]` 웹측 폴백 규칙:
  **IF** no in-app navigation history exists (딥링크 첫 진입 — `moyura://invite/{token}` 또는 알림 탭 cross-tab 직진입), **THEN** `nav:back` handling **SHALL** fall back to `router.replace('/home')` instead of exiting the WebView or no-op. (알림 cross-tab 진입 폴백을 요구사항화 — §8 OD-3 재해석.)
- **REQ-MOBNAV-022 (State-driven — 하드웨어/제스처 정합)** `[MODIFY]` `apps/mobile/hooks/app-lifecycle-core.ts` `decideBackPress` 분석 대상:
  **WHILE** in `(tabs)` shell context, **WHEN** Android hardware back is pressed AND the web reports in-app back is possible, the app **SHALL** route back through the same `nav:back` web-history path (not a native-stack pop that discards the whole detail); **IF** the web reports it is at a route root, **THEN** the existing `(tabs)` native-back behavior applies. iOS는 WKWebView 백스와이프 OFF(엣지 충돌 회피), 헤더 back chevron 1차 수단(§7 리스크 R-5·R-4).

### M4 — 셸 모드 웹 헤더 숨김 (`[MODIFY]` 5페이지 헤더 + globals.css)

- **REQ-MOBNAV-030 (State-driven)** `[MODIFY]` `globals.css` + 5페이지 헤더 파일:
  **WHILE** `html[data-shell="native"]` is set, the web **SHALL** hide its sticky header back Links and header chrome on the 5 header pages(chat/schedule/expenses의 "← 뒤로" Link 및 헤더 크롬), ceding title ownership to the native header.
- **REQ-MOBNAV-031 (Unwanted — 레이아웃 회귀 금지)** `[MODIFY]`:
  Shell-mode header hiding **SHALL NOT** break the chat fixed-viewport scroll model (`h-dvh-fixed`, `chat/page.tsx:459`) nor the schedule sticky sub-toolbar offset (`sticky top-[60px]`, `schedule-view.tsx:1014` — 헤더 높이 60px 하드코딩 커플링). 네이티브 헤더가 뷰포트를 차지할 때의 레이아웃을 재검증한다(§7 R-9 device-verify).

> **총 5 모듈** — M2에 SPIKE 게이트(REQ-MOBNAV-013)를 요구사항으로 접었고 별도 6번째 모듈을 만들지 않았다.

---

## 4. 기술 설계 (파일별 델타)

### 4.1 모바일 (native)

| 작업 | 파일 | DELTA | 요구 | 비고 |
|---|---|---|---|---|
| nav 헤더 순수 결정 모듈 | `apps/mobile/lib/nav-header-core.ts` + `.test.ts` | `[NEW]` | M1 | 입력 `{pathname,title,canGoBack}` → `{headerVisible,showBackChevron,headerTitle}`. 헤더 필요 5페이지 판정 + back-폴백 결정. vitest node-env(RN import 0 — mobile pure-core seam). **@MX:ANCHOR** 후보(헤더 렌더+back이 공유 의존) |
| 네이티브 헤더 컴포넌트 | `apps/mobile/components/NativeHeaderBar.tsx` | `[NEW]` | M1 | chevron + title. `nav-header-core` 결정 소비. safe-area top inset 소유(WebViewShell `edges`와 정합 재조정 — 아래) |
| 브리지 nav 타입 추가 | `apps/mobile/lib/auth/bridge-protocol.ts` | `[MODIFY]` | M2/M3 | `BRIDGE_MESSAGE_TYPES`에 `NAV_STATE:"nav:state"`(web→native, payload `{pathname,title,canGoBack}`), `NAV_BACK:"nav:back"`(native→web, 신호). `BridgeMessage` union + `parseBridgeMessage` payload 가드 + `decideInboundAction`에 `{kind:"nav-state",...}` 분기 추가. **additive v1 — 기존 타입/nonce 봉투 불변**(REQ-MOBNAV-011) |
| onMessage nav 처리 + injectNavBack | `apps/mobile/hooks/useAuthBridge.ts` | `[MODIFY]` | M2/M3 | onMessage: `nav:state` 수신 → 헤더 상태 콜백(`onNavState?`) 보고. `injectNavBack` 추가(nav:back postMessage — google/invite 명령과 동형). 신규 arg는 optional(부재 시 회귀 0 — MOBILE-004 패턴) |
| 헤더 오버레이 배치 + 배선 | `apps/mobile/components/BridgedWebView.tsx` | `[MODIFY]` | M1/M2/M3 | `(tabs)` 컨텍스트에서 `NativeHeaderBar`를 `WebViewShell` 위에 렌더. nav:state → 헤더 상태, 헤더 back 탭 → `injectNavBack`. `currentUrlRef`(:96) 이미 URL 추적 중이라 재사용. safe-area: 헤더가 top inset을 가지면 WebViewShell `edges`에서 top 제거 재조정(이중 인셋 방지) |
| Android 하드웨어 back 정합 분석 | `apps/mobile/hooks/app-lifecycle-core.ts` `decideBackPress` | `[MODIFY?]` | M3 | 현 `(tabs)`=무조건 `"native-back"`(:28-29). chat/schedule/expenses는 `home/[id]` WebView 안 soft-nav라 native-back이 상세 전체를 pop함 → **web 히스토리 우선 분기 필요**(REQ-MOBNAV-022). 순수 함수 확장 + vitest RED |
| 루트/그룹 레이아웃 | `apps/mobile/app/_layout.tsx`, `(tabs)/_layout.tsx` | `[EXISTING]` | M1 | 헤더는 컴포넌트 레벨 오버레이 — expo-router `headerShown:true`가 **아니다**. `headerShown:false`(:92) 유지. 변경 최소 |

### 4.2 웹 (in-WebView content)

| 작업 | 파일 | DELTA | 요구 | 비고 |
|---|---|---|---|---|
| nav 상태 리포터 | `apps/web/app/(main)/_components/NavStateReporter.tsx` | `[NEW]` | M2 | `ShellModeEffect.tsx` 동형 client effect. `usePathname` 변화 시 `{pathname,title,canGoBack}` postMessage. 데스크톱 no-op(브리지 부재). **SPIKE(§5 Phase 0) 결과가 이 컴포넌트의 관측 방식을 확정** |
| 리포터 2차 마운트 | `apps/web/app/moims/layout.tsx` | `[MODIFY]` | M2 | moims 라우트는 `(main)` 그룹 **밖**(`apps/web/app/moims/`)이라 `(main)/layout.tsx` 리포터가 커버 안 함 → chat/schedule/expenses용 2차 마운트 필요. (`(main)/layout.tsx`는 home/[id]·moims/new… 확인: moims/new도 `moims/` 밖 → moims/layout이 커버) |
| 웹 브리지 nav 직렬화 | `apps/web/lib/native-bridge/bridge-protocol.ts`, `bridge-client.ts` | `[MODIFY]` | M2/M3 | `serializeNavState()` 추가 + `nav:back` 리스너(수신 시 `router.back()`/폴백). `requestNativeGoogleSignIn`/`notifyInviteInvalid` 동형(bridge-client.ts:84-109). nonce 봉투 재사용 |
| 셸 모드 웹 헤더 숨김 | `apps/web/app/globals.css` | `[MODIFY]` | M4 | `html[data-shell="native"]` 규칙 확장(:372-389 패턴). 대상: 5페이지 sticky 헤더/back Link. **data-attr 마커 방식 권장**(schedule `sticky top-[60px]` 60px 커플링 보존 위해 헤더 높이 변경 회피) |
| 5페이지 헤더 셸 분기 | `home/[id]/page.tsx:106`, `moims/new/create-moim-form.tsx:30`, `moims/[id]/chat/page.tsx:83`, `moims/[id]/schedule/schedule-view.tsx:648`, `moims/[id]/expenses/expenses-view.tsx:540` | `[MODIFY]` | M4 | 각 sticky 헤더/back Link에 셸 숨김 대상 data-attr 부여 또는 조건부 렌더. chat `h-dvh-fixed`(:459)·schedule `top-[60px]`(:1014) 회귀 재검증(REQ-MOBNAV-031) |

### 4.3 설계 노트

- **왜 nav:back(native→web)이고 webViewRef.goBack()이 아닌가**: §2.2·§8 OD-2. 웹만 딥링크-첫-진입 vs in-app-히스토리를 판정할 수 있다. `webViewRef.canGoBack`은 WebView 레벨 히스토리(로그인 페이지 등 포함)라 의미가 다르다.
- **왜 additive v1인가**: `bridge-protocol.ts:19` `BRIDGE_VERSION=1`, unknown type graceful-ignore(:135), `auth:google-request`(MOBILE-004)·`invite:invalid`(MOIM-011) 전례. NATIVE-FEEL-001 non-goal("v1 세션 메시지 의미 변경 없음", spec.md:51)은 **세션** 메시지에 한정 — nav는 신규 채널이라 additive 확장으로 무모순(§8에 명시).
- **UNIFY-001 R-U2 정합**: UNIFY-001 R-U2(spec.md:66)가 이미 "navigation-channel bridge message that reuses nonce + trusted-origin and SHALL NOT alter v1 session message types"를 명세 — NAV-001의 `nav:*`는 **동일 채널로 설계**해 UNIFY 착수 시 재작업/충돌을 방지한다(권고, §8 OD-1).

---

## 5. 태스크 분해 (실행 순서 = SPIKE-first)

### Phase 0 — 선행 SPIKE (device-gated, BLOCKING) — Priority High

> 딥리서치가 죽인 전제 위에 구현을 얹지 않기 위한 필수 게이트. 실패 시 M2 설계 재편.

| 태스크 | 검증 | 게이트 |
|---|---|---|
| Next 16 nav 관측 완전성 | iOS 시뮬레이터 dev build → 로그인 → `usePathname` effect(또는 Next 16 `Link onNavigate`)가 `<Link>`·`router.push`·Server Action redirect 전환을 **누락 없이** 포착하는지 로그 관측. Next 16 API는 `node_modules/next/dist/docs/` 확인 선행(AGENTS.md) | **device** — 관측 방식이 확정돼야 NavStateReporter 구현. 누락 유형 발견 시 그 전환에 대한 보완 신호 설계 |

### Phase 1 — 브리지 nav 채널 (순수 로직 우선, TDD RED) — Priority High

| 태스크 | 파일 | 검증 |
|---|---|---|
| `nav-header-core.ts` RED→GREEN | `[NEW]` + `.test.ts` | vitest: 5페이지 판정, back-폴백 결정, title 산출 |
| bridge-protocol nav 타입 additive | `[MODIFY]` mobile+web bridge-protocol | vitest: `nav:state`/`nav:back` round-trip, unknown 무시·기존 타입 회귀 0, nonce 검증 |
| decideBackPress web-history 분기 | `[MODIFY]` app-lifecycle-core | vitest: `(tabs)` + web-back-possible → web 위임, root → 기존 native-back |

### Phase 2 — 웹 nav 리포터 + 헤더 숨김 (build/lint 검증) — Priority High

| 태스크 | 파일 | 검증 |
|---|---|---|
| NavStateReporter + 2차 마운트 | `[NEW]` + `moims/layout.tsx` `[MODIFY]` | `next build` + `tsc --noEmit`. (웹 테스트 하니스 없음 — 메모리 `web-no-test-harness`, 하니스 추가 전 사용자 확인) |
| 웹 브리지 nav 직렬화/리스너 | `[MODIFY]` bridge-client/protocol | `next build` |
| 셸 모드 헤더 숨김 + 5페이지 분기 | `[MODIFY]` globals.css + 5 파일 | `next build`. chat/schedule 레이아웃 육안 재검증 대상 표식 |

### Phase 3 — 네이티브 헤더 오버레이 배선 (device-gated) — Priority High

| 태스크 | 파일 | 검증 |
|---|---|---|
| NativeHeaderBar + BridgedWebView 배선 | `[NEW]`+`[MODIFY]` | `tsc --noEmit`(mobile), `expo export` |
| useAuthBridge nav 처리/injectNavBack | `[MODIFY]` | `nx test mobile`(기존 baseline + 신규 GREEN), 회귀 0 |

### Phase 4 — 종단 검증 (device-gated AC — 자동만으로 completed 불가) — Priority High

| 디바이스 AC (iOS 시뮬레이터 전용 — 메모리 `ios-simulator-only`) | 대응 요구 |
|---|---|
| 홈 카드 탭 → 상세 진입 → 네이티브 헤더 back chevron 표시 → 탭 → 홈 복귀 | REQ-MOBNAV-001/002/020 |
| 상세 → chat/schedule/expenses soft-nav → 헤더 타이틀·back 갱신 → back으로 상세 복귀 | REQ-MOBNAV-010/012/020, R-9 |
| 알림 탭 cross-tab 직진입 → back → (히스토리 있으면 알림 피드) / (딥링크 첫 진입이면 홈 폴백) | REQ-MOBNAV-021 |
| 셸 모드에서 웹 sticky back Link 미노출(이중 헤더 없음) + chat h-dvh-fixed 레이아웃 정상 | REQ-MOBNAV-030/031 |
| Android 하드웨어 back = web 히스토리 정합(상세 전체 pop 아님) | REQ-MOBNAV-022 (Android AC는 iOS 검증 후 보류 기록 가능 — 메모리 `ios-simulator-only`) |

> **분리 원칙**: 웹(Phase 2)은 build/lint로 검증 완료 가능. 모바일 헤더 렌더·nav 왕복·back·제스처(Phase 3-4)는 **디바이스 종단 검증 전까지 status in-progress**(메모리 `mobile-spec-device-gated`). 단 Phase 0 SPIKE와 REQ-MOBNAV-021 폴백 로직 일부는 로컬 검증 가능 여부를 run 단계에서 분리 판정(메모리 `verify-locally-before-device-gating`).

---

## 6. 참조 구현 (재사용 자산 — file:line, research.md 검증 완료)

- `apps/mobile/lib/auth/bridge-protocol.ts:19-48,121-166,266-299` — additive 타입 추가 지점(`BRIDGE_MESSAGE_TYPES`, `parseBridgeMessage`, `decideInboundAction`). unknown graceful-ignore 계약 원본.
- `apps/mobile/hooks/useAuthBridge.ts:84-100,152-238` — optional callback 패턴(`onCrossRouteDispatch`/`onDetailPush`/`onInviteInvalid`) + onShouldStartLoadWithRequest 배선. injectNavBack가 따를 명령 postMessage 패턴은 `requestNativeGoogleSignIn` 경로.
- `apps/mobile/components/BridgedWebView.tsx:96,131-172,236-272` — `currentUrlRef` URL 추적, onDetailPush/onInviteInvalid 콜백 배선, WebViewShell 합성 위치(헤더 오버레이 삽입점).
- `apps/mobile/components/WebViewShell.tsx:112-114,148,175` — 셸 마커 항상 선행 주입, SafeAreaView `edges` 재조정 대상, iOS 전용 `decelerationRate`(Android 크래시 회피 — 신규 컴포넌트가 WebView 직접 생성 금지, R-2).
- `apps/mobile/lib/route-map-core.ts:53-65,112-134` — `routeForUrl`/`detailRouteForUrl`(nav-header-core의 5페이지 판정 로직 참조 — 3세그먼트 chat/schedule/expenses는 여기서 null이므로 헤더 판정은 별도 세그먼트 매칭 필요).
- `apps/mobile/hooks/app-lifecycle-core.ts:24-32` — `decideBackPress` `(tabs)` 분기 수정 대상.
- `apps/web/app/(main)/_components/ShellModeEffect.tsx:26-34` — NavStateReporter가 미러할 client effect 셸 감지 패턴(setup-only, 데스크톱 no-op).
- `apps/web/lib/native-bridge/bridge-client.ts:84-109` — web→native 명령 직렬화 패턴(`requestNativeGoogleSignIn`/`notifyInviteInvalid`), `nav:state`가 따를 형태.
- `apps/web/app/(main)/layout.tsx:30` + `globals.css:372-389` — 셸 감지 인라인 스크립트 + `html[data-shell="native"]` 숨김 규칙 확장 원본.
- 웹 5페이지 헤더: `home/[id]/page.tsx:106`, `moims/new/create-moim-form.tsx:30`, `moims/[id]/chat/page.tsx:83`(+`h-dvh-fixed`:459), `moims/[id]/schedule/schedule-view.tsx:648`(+`top-[60px]`:1014), `moims/[id]/expenses/expenses-view.tsx:540`.
- 알림 cross-tab 링크: `apps/web/app/(main)/notifications/notification-item.tsx:105,137,202`(home/schedule/expenses href) — REQ-MOBNAV-021 폴백 대상 경로.

---

## 7. 리스크 · 완화

> 딥리서치 미해결 4건(research.md §미해결) + 사내 리스크 13건 중 관련분.

| # | 리스크 | 심각도 | 완화 |
|---|---|---|---|
| R-1 | **[딥리서치 미해결 1]** Next 16 nav 관측(Link+router.push+Server Action redirect) 완전 패턴 미확정 → 특정 전환에서 nav:state 누락(헤더 침묵) | HIGH | **Phase 0 SPIKE 게이트(REQ-MOBNAV-013)** — 실측 전 M2 착수 금지. Next 16 API는 node_modules 문서 선행 확인(AGENTS.md) |
| R-2 | 신규 컴포넌트가 WebViewShell 우회해 WebView 직접 생성 시 `decelerationRate` Android 크래시 재발(WebViewShell.tsx:175, 커밋 be885d6) | HIGH | NativeHeaderBar는 WebView를 만들지 않음(헤더 크롬만). WebView는 기존 WebViewShell 단일 소유 유지 |
| R-3 | nav:* 브리지 확장이 기존 nonce/토큰 동기화 회귀(bridge-protocol round-trip) | HIGH | additive only + 기존 security/round-trip 테스트 보존 후 신규 분기 RED 추가. nonce 봉투·unknown-ignore 불변 |
| R-4 | **[딥리서치 확정]** Android WebView 레벨 스와이프 백 수단 부재 + `(tabs)` 하드웨어 back = 무조건 native-back(app-lifecycle-core.ts:28) → 상세 내부 soft-nav 히스토리를 하드웨어 back이 못 걸음 | HIGH | REQ-MOBNAV-022: `(tabs)` back을 web-history 우선으로 재분기. 헤더 back chevron 1차 수단 |
| R-5 | **[딥리서치 미해결 2]** iOS `animation:"none"` 스크린 스와이프 pop 생사 문서 공백 | MEDIUM | 네이티브 스택 pop을 back 수단으로 쓰지 않음(설계상 회피). WKWebView 백스와이프 OFF(엣지 충돌 회피 — 딥리서치 주장4). 헤더 back 1차, 스와이프 보조 |
| R-6 | 타이틀 소스 부재(전 페이지 title="moyura", `generateMetadata` 0곳) | MEDIUM | REQ-MOBNAV-012: 웹 route 데이터 → nav:title. document.title 비의존 |
| R-7 | 셸 감지 취약성(UA 오버라이드 없이 `__MOYURA_NATIVE_SHELL__` + `ReactNativeWebView` 주입 타이밍 의존) | MEDIUM | 기존 계약 재사용(신규 감지 도입 0). NavStateReporter도 동일 판정식(ShellModeEffect 미러) |
| R-8 | 웹·네이티브 동시 배포 순서(웹 nav:state 먼저 배포 시 네이티브 미수신 → 무해, 반대는 헤더 침묵) | MEDIUM | additive graceful-ignore로 부분 배포 안전. run 단계 배포 순서 메모 |
| R-9 | 네이티브 헤더가 뷰포트 차지 시 chat `h-dvh-fixed`(:459)·schedule `sticky top-[60px]`(:1014, 60px 하드코딩) 레이아웃 깨짐 | MEDIUM | REQ-MOBNAV-031 device-verify. 헤더는 WebView 뷰포트 **밖**(위)이라 문서 흐름과 직접 충돌 없음이 가설 — chat 내부 스크롤 재검증 |
| R-10 | **[딥리서치 미해결 4]** 웹 인터셉트→postMessage→헤더 갱신 체감 지연(route 변경과 헤더 갱신 사이 깜빡임) | LOW | 디바이스 체감 측정. 헤더는 이전 타이틀 유지 후 갱신(빈 헤더 방지) |
| R-11 | 알림 cross-tab 진입 시 web `history.length`가 "딥링크 첫 진입"을 신뢰 판정하는지 불확실 | MEDIUM | REQ-MOBNAV-021 폴백 규칙 + device-verify(§8 OD-3). history 없으면 홈 폴백(fail-safe) |
| R-12 | **[선행 SPEC 연쇄]** UNIFY-001 vs NATIVE-UI-001 미결 — NATIVE-UI-001(웹 제거) 채택 시 웹 헤더 작업 무효화 | MEDIUM | §8 OD-1 가정 명시(UNIFY-family 전제). 헤더 오버레이는 topology-agnostic이라 UNIFY 채택엔 무영향 |

---

## 8. Open Decisions (Plan Review 게이트에서 전건 해소)

> 2026-07-03 Plan Review 게이트에서 사용자가 5건 전부를 확정했다. 아래 각 OD는 **[해소]** 로 마감하고 결정을 명문화한다. 결정은 spec.md/acceptance.md 작성의 구속 입력이다.

### OD-1 — 다중→단일 WebView 수렴을 이 SPEC이 수행하는가 **[해소: 아니오 — UNIFY-001에 위임]**

- **상황**: 현 코드는 멀티 WebView(`TabWebView`×4 + `home/[id]` 네이티브 push). 선택 방향은 "단일 지속 WebView". UNIFY-001(draft, device-gated)이 R-U1에서 정확히 1개 WebView 수렴을, R-U2에서 nav-channel 브리지를 이미 명세. NATIVE-UI-001(draft)은 UNIFY와 **상호 배타**(웹 제거 대안).
- **[해소] 결정**: NAV-001은 **topology-agnostic 헤더 오버레이 + nav:* 채널만** 구현하고, 다중→단일 수렴은 **UNIFY-001에 위임**한다. 근거: (1) 헤더 오버레이는 단일/멀티 무관 동작(§2.3), (2) minimal-change — 실제 버그(back affordance 부재)를 UNIFY(draft) 착수 없이 즉시 해소, (3) NAV의 `nav:*`를 UNIFY-001 R-U2가 예고한 동일 nav 채널로 설계하면 UNIFY 착수 시 재작업/충돌 없음.
- **[해소] 공유 채널 계약 명문화**: NAV의 `nav:state`/`nav:back`은 **UNIFY-001 R-U2가 예고한 nav 채널과 동일한 공유 채널 계약**(nonce + trusted-origin 봉투 재사용, v1 세션 타입 무변경)으로 설계한다. 즉 UNIFY-001 착수 시 NAV의 nav 채널을 그대로 상속·확장하며, 별도 nav 채널을 신설하지 않는다. 이 계약은 REQ-MOBNAV-011에 반영한다(재작업 방지).
- **기각한 대안(b)**: NAV-001이 수렴을 흡수(UNIFY-001 일부 대체) — 규모 폭증 + device-gated UNIFY 종속으로 버그 해소 지연. 채택 안 함.

### OD-2 — Back 동작: nav:back(웹 위임) vs webViewRef.goBack()(네이티브 직접) **[해소: nav:back 웹 위임 확정]**

- **[해소] 결정**: 네이티브 back 탭 → `nav:back` → 웹 `router.back()`/`history.back()` + 히스토리 없으면 `/home` 폴백. `webViewRef.goBack()`(네이티브 직접)은 **채택하지 않는다.**
- **근거**: 웹만 딥링크-첫-진입 vs in-app-히스토리를 판정 가능(§2.2). 타이틀·canGoBack도 웹이 이미 보고하므로 단일 진실 출처 일관. `webViewRef.goBack()`은 WebView 레벨 히스토리(로그인 페이지 등 포함)라 폴백 판정 불가, 딥링크 첫 진입에서 오작동 위험. REQ-MOBNAV-020에 반영.

### OD-3 — 알림 cross-tab 진입의 back 동작 **[해소: 웹 히스토리 우선 + 딥링크 첫 진입 시 /home 폴백]**

- **원안**: 사용자는 "현재 탭 스택에 push"를 선택했으나, 단일-WebView 오버레이엔 네이티브 스택 push가 없음.
- **[해소] 결정(요구사항화 = REQ-MOBNAV-021)**: back은 **웹 히스토리를 우선**한다(in-app 히스토리 있으면 이전 route = 알림 피드로 복귀). 히스토리 없는 **딥링크 첫 진입**(`moyura://invite/{token}` 또는 알림 탭 cross-tab 직진입)이면 `router.replace('/home')`로 **홈 폴백**한다. WebView 이탈이나 no-op은 하지 않는다.
- **수용**: R-11 — `history.length`/`document.referrer`의 "딥링크 첫 진입" 신뢰 판정은 device-verify 대상으로 수용. fail-safe로 히스토리 불확실 시 홈 폴백.

### OD-4 — 웹 인터셉트 완전성 SPIKE (Phase 0 게이트) **[해소: 필수 선행 게이트로 수용]**

- **[해소] 결정**: Next 16에서 `<Link>`·`router.push`·Server Action redirect를 누락 없이 관측하는 패턴은 딥리서치 전원 기각 상태이므로, **Phase 0 SPIKE를 M2 실구현 착수 전 필수(BLOCKING) 게이트로 수용**한다(REQ-MOBNAV-013). SPIKE 결과가 NavStateReporter 관측 방식을 확정하며, 누락 전환 유형 발견 시 그 전환에 대한 보완 신호를 설계한 뒤에만 M2에 착수한다.

### OD-5 — iOS 스와이프 백 device-verify **[해소: 미포함 — 헤더 back chevron 단독 1차 수단]**

- **[해소] 결정**: iOS WKWebView 백스와이프는 **미포함**한다(`allowsBackForwardNavigationGestures` OFF 유지 — 엣지 충돌 회피). 헤더 back chevron이 유일한 1차 back 수단이며, 스와이프 백을 보조 수단으로도 넣지 않는다. `allowsBackForwardNavigationGestures` on 시 pushState 스냅샷 글리치는 미검증이나 끄기 확정이라 검증 대상에서 제외. §9 제외 범위에 반영.

---

## 9. 제외 범위 (What NOT to Build)

- **보류 3페이지 전부 제외**: `/me`(디버그성·앱 내 진입 링크 없음), `/invite`(웹 자체 back `invite/page.tsx:129` 이미 존재 — 네이티브 헤더 추가 시 중복 크롬), `/invite/[token]`(딥링크 첫 화면 가능성 — back 대상 부재). 네이티브 헤더를 이 3페이지에 렌더하지 않는다(REQ-MOBNAV-003).
- **다중→단일 WebView 수렴 미수행**(OD-1 권고안 (a)): 본 SPEC은 헤더 오버레이만. topology 수렴은 UNIFY-001.
- **네이티브 스택 push 기반 상세 화면 신설 없음**: chat/schedule/expenses용 expo-router 화면 신설 없음(옵션 A 폐기 — 딥리서치 blocker). push 가드 재설계(research 갭 2) 불필요.
- **in-WebView 전환 애니메이션 없음**(NATIVE-FEEL-001 M4 View Transitions 범위) — 헤더 가시성만.
- **Android 풀 검증 보류**: iOS 시뮬레이터 검증 후 Android AC는 보류 기록(메모리 `ios-simulator-only`). Android predictive back 정합은 요구(REQ-MOBNAV-022)하되 실기 검증은 후속.
- **관리자/디버그 도구·웹 브라우저(비셸) 사용자용 헤더 개선 없음**: 셸 모드 한정.
- **bridge-protocol v1 세션 타입 의미 변경 없음**: nav:*는 additive 신규 채널(§4.3).

---

## 10. MX 태그 플랜

- **@MX:ANCHOR**(@MX:REASON 필수): `nav-header-core.ts`의 헤더/back 결정 함수(NativeHeaderBar + back 라우팅이 fan_in ≥ 2, run 단계 fan_in 확인 후 승격). `bridge-protocol.ts`의 확장된 `decideInboundAction`(nav 분기 추가로 fan_in 유지) — 기존 ANCHOR 보존.
- **@MX:WARN**(@MX:REASON 필수): `useAuthBridge.ts` nav:state/injectNavBack 배선부 — 브리지 메시지 경계(위조/누락 시 헤더 오작동·back 침묵). `decideBackPress` `(tabs)` 재분기 — 하드웨어 back 회귀 위험 HIGH(R-4).
- **@MX:NOTE**: `NavStateReporter.tsx`의 nav 관측 방식(SPIKE 결과 반영 — Next 16 관측 API 근거), `BridgedWebView.tsx` 헤더 오버레이 삽입점(WebViewShell edges 재조정 의미), `globals.css` 셸 헤더 숨김 규칙의 schedule 60px 커플링 주의.
- **@MX:TODO**: SPIKE 미해결 구간(Phase 0 통과 전 NavStateReporter 관측 방식) — GREEN 시 제거.

---

## 11. 신규 의존성 (0 지향)

- **신규 npm 의존성 0.** 헤더 바는 기존 RN 프리미티브(`View`/`Pressable`/`Text` + `react-native-safe-area-context` 기존 사용)로 구성. 아이콘은 기존 자산 범위 내(chevron). 웹은 기존 스택(Next 16 + Tailwind v4 + lucide-react `^1.17.0`) 재사용 — 신규 UI 라이브러리 없음.
- 브리지 확장은 기존 `bridge-protocol`(mobile+web 인라인 동등 구현) 내부 additive — 외부 의존 없음.
- **제약**: pnpm workspace hoisted, expo SDK 56 — 신규 네이티브 모듈이 없으므로 `pod install`/patch 영향 없음.
