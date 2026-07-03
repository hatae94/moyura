---
id: SPEC-MOBILE-NAV-001
version: "0.1.0"
status: draft
created: 2026-07-03
updated: 2026-07-03
author: hatae
priority: high
issue_number: 0
labels: [mobile, navigation, webview, native-header, bridge]
---

# SPEC-MOBILE-NAV-001 — 모바일 네이티브 헤더·뒤로가기 (헤더 크롬 오버레이)

> **depends-on**: SPEC-MOBILE-003 (expo-router 하이브리드 네비게이션 골격 + 라우트↔URL 계약 — 라우트 트리는 비협상 토대), SPEC-MOBILE-002 (SecureStore 토큰 + bridge `session:*` 신호), SPEC-MOBILE-004 (`auth:google-request` additive 브리지 확장 전례)
> **relates-to**: SPEC-WEBVIEW-UNIFY-001 (R-U2 nav 채널 — NAV의 `nav:*`가 상속·수렴할 공유 채널 계약)
> **lifecycle**: spec-anchored (헤더 오버레이 + nav 채널 계약은 UNIFY-001 등 후속 SPEC이 상속하는 코어 계약)
> `issue_number: 0` — GitHub Issue 생성은 로컬 전용 git 정책에 따라 생략(0 = no-issue 표기).

## HISTORY

- 2026-07-03 (v0.1.0): 최초 작성 (draft). 사전 조사 `research.md`(사내 4인 리서치 + deep-research 하니스 21소스 · 100주장 → 18 confirmed / 7 killed) 기반. **딥리서치로 옵션 A(`onShouldStartLoadWithRequest` push 승격) 폐기** — 이 콜백은 SPA soft-nav(Next `<Link>` pushState)에서 발화하지 않음이 확정(주장1 거짓). **단일 지속 WebView + 네이티브 헤더 크롬 오버레이**(브리지 `nav:*` 채널 구동, topology-agnostic) 채택. Plan Review 게이트에서 Open Decision 5건 전부 확정: OD-1(수렴 미포함, UNIFY-001 위임 + 공유 nav 채널 계약 명문화), OD-2(back = nav:back 웹 위임), OD-3(알림 cross-tab back = 웹 히스토리 우선 + 딥링크 첫 진입 시 /home 폴백), OD-4(웹 인터셉트 완전성 SPIKE = Phase 0 필수 선행 게이트), OD-5(iOS 스와이프 백 미포함 — allowsBackForwardNavigationGestures OFF, 헤더 back chevron 단독). 브라운필드 — 기존 동작 보존.

---

## Background (배경)

`moyura` 모노레포는 웹(`apps/web`, Next.js 16 App Router)을 단일 UI surface 로 삼고, 모바일 앱(`apps/mobile`, Expo SDK 56 / RN 0.85)이 그 웹을 WebView 로 호스팅한다. SPEC-MOBILE-003 이 expo-router 하이브리드 골격(Root Stack + `(auth)`/`(tabs)` 그룹 + 라우트↔URL 1:1 계약)을 도입했고, MeetupDetail(모임 상세) 화면은 후속 SPEC 으로 명시 제외했다. 본 SPEC 이 그 후속이다.

### 문제 정의 (research.md §문제 원인 분석 — 코드 대조 확인)

홈(`/home`)에서 모임 상세(`/home/[id]`)로 진입하면 화면 어디에도 **눈에 보이는 뒤로가기 수단(back affordance)이 없다.** 세 원인이 겹친다:

1. **웹 상세 헤더에 back 버튼 없음** — `apps/web/app/(main)/home/[id]/page.tsx:106` sticky 헤더는 모임명만 렌더, back 미제공. `apps/web/app/moims/new/create-moim-form.tsx:30` 도 back 없음(폼 실패 시 갇힘).
2. **네이티브 스택은 push 하지만 헤더를 숨김** — `apps/mobile/app/_layout.tsx:92` 루트 Stack `{ headerShown:false, animation:"none" }`. iOS 엔 하드웨어 백이 없어 스와이프를 모르면 사실상 갇힌다.
3. **셸 모드 크롬 공백** — `(main)/layout.tsx:30` + `globals.css:372-389` 는 셸 모드에서 웹 하단 탭바를 숨기는 계약(`html[data-shell="native"]`)이 이미 있는데, **헤더에 대해서는 네이티브가 아무것도 그리지 않아** 크롬 공백이 발생한 것이 이 SPEC 의 본질이다.

### 딥리서치가 확정한 설계 제약 (research.md §외부 웹 리서치 — 결정적)

- **soft-nav 미발화 (확정 거짓 판정)**: `onShouldStartLoadWithRequest` 는 SPA soft-nav(Next `<Link>` pushState 전환)에서 **발화하지 않는다.** 진입 링크는 전부 soft-nav(`HomeTab.tsx:50` `<Link href="/home/{id}">`). 네이티브 콜백으로 SPA 내비를 가로채 스택 push 하는 옵션 A 단독은 이 API 로 성립 불가 → **웹측 명시 nav 보고가 필수재.**
- **웹측 nav 보고 필수**: 단일 진실 출처 = 웹. 타이틀(모임명 등)·canGoBack·딥링크 폴백 로직 모두 웹이 소유하고 네이티브는 헤더를 그리기만 한다. 전 페이지 `title:"moyura"` 고정(`generateMetadata` 0곳)이라 타이틀은 route 데이터에서 명시 산출한다.
- **제스처 비대칭 (확정)**: iOS = WKWebView 백스와이프 opt-in(끄면 엣지 충돌 없음), Android = WebView 레벨 스와이프 수단 부재. 라이브러리 차원 UX 대칭 없음 → 헤더 back chevron 을 1차 수단으로 통일하고, Android 하드웨어 back 은 web 히스토리 경로로 정합.
- **아키텍처 비용 (확정)**: 페이지당 WebView push 는 Shopify 가 명시 거부(세션 유실 + 느림). 다중 WebView = react-query 인메모리 상태 격리 비용. **단일 WebView + 네이티브 헤더 오버레이가 back affordance 만 목표라면 더 저렴.**

### 이 SPEC 의 접근 (Plan Review 확정)

push 승격을 버리고 **헤더 크롬을 브리지 구동으로 오버레이**한다. 네이티브는 WebView 위에 헤더 바(back chevron + title)를 셸 모드에서 항상 렌더한다. 웹이 route 변경마다 자신의 nav 상태(`{pathname, title, canGoBack}`)를 브리지로 보고하고, 네이티브가 그에 따라 back chevron 가시성·타이틀을 그린다. 헤더 back 탭은 `nav:back` 으로 웹에 위임되어 웹이 `router.back()`/폴백을 결정한다. 이 헤더 오버레이는 단일/멀티 WebView 무관하게 동작한다(**topology-agnostic**) — 헤더는 웹이 보고한 pathname 만 소비하므로, UNIFY-001 단일 WebView 수렴 전후 어느 상태에서도 무효화되지 않는다.

---

## Goal (목표)

셸 모드(`(tabs)` 컨텍스트)에서 헤더 필요 5페이지(`/home/[id]`, `/moims/new`, `/moims/[id]/chat`, `/moims/[id]/schedule`, `/moims/[id]/expenses`)에 대해, WebView 뷰포트 위에 **네이티브 헤더 바**(back chevron + 컨텍스트 타이틀)를 렌더하여 "back affordance 부재" 버그를 해소한다. 헤더는 웹이 브리지 `nav:state` 로 보고한 nav 상태만 소비하며(단일 진실 출처 = 웹), back chevron 탭은 `nav:back` 으로 웹에 위임되어 웹이 in-app 히스토리 back 또는 딥링크 첫 진입 시 `/home` 폴백을 결정한다. `nav:*` 는 기존 bridge-protocol v1 의 nonce + trusted-origin 봉투를 재사용하는 **additive 신규 채널**이며, UNIFY-001 R-U2 가 예고한 nav 채널과 동일한 공유 채널 계약으로 설계해 UNIFY 착수 시 재작업을 방지한다. 셸 모드에서는 웹 5페이지의 sticky 헤더/back Link 를 숨겨 이중 헤더를 방지한다. 실구현 착수 전 **Next 16 nav 관측 완전성 SPIKE(Phase 0)를 필수 선행 게이트**로 통과한다.

---

## Exclusions (What NOT to Build) — 제외

> [HARD] 본 SPEC 의 명시적 비목표. 각 항목은 §제외를 요구사항(REQ-MOBNAV-003) 및 Plan Review 확정 결정과 1:1 대응한다.

- **보류 3페이지 전부 제외 (헤더 미렌더)**: `/me`(디버그성·앱 내 진입 링크 없음), `/invite`(웹 자체 back `invite/page.tsx:129` 이미 존재 — 네이티브 헤더 추가 시 중복 크롬), `/invite/[token]`(딥링크 첫 화면 가능성 — back 대상 부재). 네이티브 헤더를 이 3페이지에 렌더하지 않는다(REQ-MOBNAV-003).
- **다중→단일 WebView 수렴 미수행 (OD-1 해소)**: 본 SPEC 은 topology-agnostic 헤더 오버레이 + `nav:*` 채널만. 다중→단일 topology 수렴은 **UNIFY-001 에 위임**한다.
- **네이티브 스택 push 기반 상세 화면 신설 없음 (옵션 A 폐기)**: chat/schedule/expenses 용 expo-router 화면 신설 없음. `onShouldStartLoadWithRequest` push 승격 방식(옵션 A) 폐기 — 딥리서치 blocker(soft-nav 미발화). push 가드 재설계(research 갭 2) 불필요.
- **in-WebView 전환 애니메이션 없음**: NATIVE-FEEL-001 M4 (View Transitions) 범위. 본 SPEC 은 헤더 가시성만.
- **iOS 스와이프 백 미포함 (OD-5 해소)**: `allowsBackForwardNavigationGestures` OFF 유지. 헤더 back chevron 이 유일한 1차 수단이며 스와이프 백을 보조로도 넣지 않는다.
- **Android 풀 검증 보류**: iOS 시뮬레이터 검증 후 Android AC 는 보류 기록(메모리 `ios-simulator-only`). Android 하드웨어 back 정합은 요구(REQ-MOBNAV-022)하되 실기 검증은 후속.
- **관리자/디버그 도구·웹 브라우저(비셸) 사용자용 헤더 개선 없음**: 셸 모드 한정. 데스크톱은 no-op.
- **bridge-protocol v1 세션 타입 의미 변경 없음**: `nav:*` 는 additive 신규 채널이며 `session:*`·`auth:google-request`·`invite:invalid` 의 봉투/nonce/의미를 변경하지 않는다.

---

## EARS Requirements

> 요구사항 ID prefix: **REQ-MOBNAV-NNN**. 패턴 표기: [U]biquitous / [E]vent-driven / [S]tate-driven / [Un]wanted / [O]ptional / [C]omplex. 델타: [NEW]/[MODIFY]/[EXISTING]. 각 요구는 acceptance.md AC 와 대응.

### M1 — 네이티브 헤더 크롬 렌더 (`[NEW]` NativeHeaderBar + nav-header-core)

- **REQ-MOBNAV-001 [S][NEW]** `apps/mobile/components/NativeHeaderBar.tsx`, `apps/mobile/lib/nav-header-core.ts`:
  **WHILE** the app is in `(tabs)` shell context AND the current web route is one of the 5 header pages, the app **shall** render a native header bar (뒤로 chevron 영역 + title) positioned ABOVE the WebView viewport, owning the status-bar top inset.
- **REQ-MOBNAV-002 [S][NEW]** nav-header-core:
  **WHILE** the reported nav state indicates in-app back is possible (`canGoBack` / `depth > 0`), the header **shall** show the back chevron as an interactive affordance; **IF** back is not possible, **THEN** the header **shall** hide the chevron (title-only 헤더).
- **REQ-MOBNAV-003 [Un][NEW]**:
  The app **shall not** render the native header bar on tab-root routes (`/home`, `/explore`, `/notifications`, `/profile`) nor on the 3 held pages (`/me`, `/invite`, `/invite/[token]`) — 헤더는 헤더 필요 5페이지에 한정한다(§Exclusions 와 1:1).

### M2 — 웹측 nav 상태 보고 (`[NEW]` NavStateReporter + `[MODIFY]` 웹 브리지)

- **REQ-MOBNAV-010 [E][NEW]** `apps/web/app/(main)/_components/NavStateReporter.tsx` (+ `apps/web/app/moims/layout.tsx` 2차 마운트):
  **WHEN** the web pathname changes inside shell mode (soft-nav 또는 full load), the web **shall** report `{pathname, title, canGoBack}` to native via an additive `nav:state` bridge message. 데스크톱 브라우저에서는 no-op(브리지 부재).
- **REQ-MOBNAV-011 [E][NEW]** `apps/web/lib/native-bridge/bridge-protocol.ts` `[NEW]`, `bridge-client.ts` `[MODIFY]` + `apps/mobile/lib/auth/bridge-protocol.ts` `[MODIFY]`:
  The `nav:state`/`nav:back` message types **shall** be added as **additive v1 types** reusing the existing per-session nonce + trusted-origin envelope, **shall** be designed as the **same shared nav-channel contract** that SPEC-WEBVIEW-UNIFY-001 R-U2 anticipates (so UNIFY converges on this channel without rework), and **shall not** alter the existing session message types (`session:*`, `auth:google-request`, `invite:invalid`). unknown-type graceful-ignore 계약 보존.
- **REQ-MOBNAV-012 [U][NEW]** NavStateReporter title 소스:
  The reported `title` **shall** be derived from web route context data (모임명 등 — 전 페이지 `title:"moyura"` 고정이므로 route 에서 명시 산출), never from the static document `<title>`.
- **REQ-MOBNAV-013 [Un][NEW] (선행 SPIKE 게이트)**:
  The web-side pathname-observation pattern **shall** be verified (SPIKE, Phase 0 — plan §5) to cover `<Link>` navigation, `router.push`, and Server Action redirect **without omission on Next 16** before M2 실구현 착수. 미검증 상태에서 M2 를 구현하면 헤더가 특정 전환 유형에서 침묵(누락)하는 반쪽 결과가 된다.

### M3 — Back 동작 라우팅 + 하드웨어/제스처 정합 (`[MODIFY]` 브리지 + back 분기)

- **REQ-MOBNAV-020 [E][MODIFY]** `apps/mobile/hooks/useAuthBridge.ts`(injectNavBack) + `apps/mobile/lib/auth/bridge-protocol.ts`(decideInboundAction) + `apps/web/lib/native-bridge/bridge-client.ts`(nav:back 리스너):
  **WHEN** the native back chevron is tapped, native **shall** post `nav:back`; the web **shall** execute in-app back (`router.back()` / `history.back()`). native **shall not** call `webViewRef.goBack()` directly (OD-2 해소 — 딥링크-첫-진입 vs in-app-히스토리 판정은 웹만 가능).
- **REQ-MOBNAV-021 [Un][NEW] (딥링크 폴백)** 웹측 폴백 규칙:
  **IF** no in-app navigation history exists (딥링크 첫 진입 — `moyura://invite/{token}` 또는 알림 탭 cross-tab 직진입), **THEN** `nav:back` handling **shall** fall back to `router.replace('/home')` instead of exiting the WebView or no-op (OD-3 해소 — 웹 히스토리 우선 + 딥링크 첫 진입 시 홈 폴백).
- **REQ-MOBNAV-022 [C][MODIFY]** `apps/mobile/hooks/app-lifecycle-core.ts` `decideBackPress` 분석 대상:
  **WHILE** in `(tabs)` shell context, **WHEN** Android hardware back is pressed AND the web reports in-app back is possible, the app **shall** route back through the same `nav:back` web-history path (not a native-stack pop that discards the whole detail); **IF** the web reports it is at a route root, **THEN** the existing `(tabs)` native-back behavior applies. iOS 는 WKWebView 백스와이프 OFF(엣지 충돌 회피 — OD-5 해소), 헤더 back chevron 1차 수단.

### M4 — 셸 모드 웹 헤더 숨김 (`[MODIFY]` 5페이지 헤더 + globals.css)

- **REQ-MOBNAV-030 [S][MODIFY]** `apps/web/app/globals.css` + 5페이지 헤더 파일:
  **WHILE** `html[data-shell="native"]` is set, the web **shall** hide its sticky header back Links and header chrome on the 5 header pages (chat/schedule/expenses 의 "← 뒤로" Link 및 헤더 크롬), ceding title ownership to the native header.
- **REQ-MOBNAV-031 [Un][MODIFY] (레이아웃 회귀 금지)**:
  Shell-mode header hiding **shall not** break the chat fixed-viewport scroll model (`h-dvh-fixed`, `chat/page.tsx:459`) nor the schedule sticky sub-toolbar offset (`sticky top-[60px]`, `schedule-view.tsx:1014` — 헤더 높이 60px 하드코딩 커플링). 네이티브 헤더가 뷰포트를 차지할 때의 레이아웃을 재검증한다.

> **총 5 모듈** — M2 에 SPIKE 게이트(REQ-MOBNAV-013)를 요구사항으로 접었고 별도 6번째 모듈을 만들지 않았다.

---

## Delta Markers (브라운필드 변경 요약)

| 마커 | 대상 | 요구 |
|---|---|---|
| [NEW] | `apps/mobile/lib/nav-header-core.ts` + `.test.ts`, `apps/mobile/components/NativeHeaderBar.tsx`; `apps/web/app/(main)/_components/NavStateReporter.tsx`; `apps/web/lib/native-bridge/bridge-protocol.ts`(`serializeNavState`) | REQ-MOBNAV-001/002/003, 010/012/013, 021 |
| [MODIFY] | `apps/mobile/lib/auth/bridge-protocol.ts`(nav 타입 additive + `decideInboundAction` 분기), `apps/mobile/hooks/useAuthBridge.ts`(onMessage nav:state + `injectNavBack`), `apps/mobile/components/BridgedWebView.tsx`(헤더 오버레이 배치 + safe-area 재조정), `apps/mobile/hooks/app-lifecycle-core.ts`(`decideBackPress` web-history 분기); `apps/web/lib/native-bridge/bridge-client.ts`(nav:back 리스너 + nav:state 직렬화), `apps/web/app/moims/layout.tsx`(리포터 2차 마운트), `apps/web/app/globals.css`(셸 헤더 숨김 규칙 확장), 웹 5페이지 헤더 파일(`home/[id]/page.tsx`, `moims/new/create-moim-form.tsx`, `moims/[id]/chat/page.tsx`, `moims/[id]/schedule/schedule-view.tsx`, `moims/[id]/expenses/expenses-view.tsx`) | REQ-MOBNAV-011, 020/022, 030/031 |
| [EXISTING] | `apps/mobile/app/_layout.tsx`·`(tabs)/_layout.tsx`(`headerShown:false` 유지 — 헤더는 컴포넌트 레벨 오버레이), `apps/mobile/components/WebViewShell.tsx`(단일 WebView 소유 유지 — 신규 컴포넌트가 WebView 직접 생성 금지), nonce/trusted-origin 봉투 | REQ-MOBNAV-001, 011 |

---

## Design Notes (설계 근거)

- **왜 nav:back(native→web)이고 webViewRef.goBack()이 아닌가 (OD-2)**: 웹만 딥링크-첫-진입 vs in-app-히스토리를 판정할 수 있다(`history.length`/`document.referrer`). `webViewRef.canGoBack`은 WebView 레벨 히스토리(로그인 페이지 등 포함)라 의미가 다르다.
- **왜 additive v1 인가**: `bridge-protocol.ts` `BRIDGE_VERSION=1`, unknown type graceful-ignore, `auth:google-request`(MOBILE-004)·`invite:invalid`(MOIM-011) 전례. `nav:*`는 신규 채널이라 세션 타입 비변경 non-goal 과 무모순.
- **UNIFY-001 R-U2 공유 채널 계약 (OD-1)**: UNIFY-001 R-U2(spec.md:66)가 이미 "navigation-channel bridge message that reuses nonce + trusted-origin and SHALL NOT alter v1 session message types"를 명세 — NAV-001 의 `nav:*`는 **동일 채널로 설계**해 UNIFY 착수 시 재작업/충돌을 방지한다(REQ-MOBNAV-011).
- **topology-agnostic**: 헤더는 웹이 보고한 pathname 만 소비하므로 단일/멀티 WebView 무관 동작. UNIFY-001 수렴 전후 어느 상태에서도 이 메커니즘은 무효화되지 않는다.

---

## Risks (요약 — 상세 plan §7)

| # | 리스크 | 심각도 | 완화 |
|---|---|---|---|
| R-1 | Next 16 nav 관측 완전 패턴 미확정 → 특정 전환 nav:state 누락(헤더 침묵) | HIGH | Phase 0 SPIKE 게이트(REQ-MOBNAV-013) — 실측 전 M2 착수 금지 |
| R-2 | 신규 컴포넌트가 WebViewShell 우회해 WebView 직접 생성 시 `decelerationRate` Android 크래시 재발 | HIGH | NativeHeaderBar 는 WebView 미생성(헤더 크롬만). WebView 는 WebViewShell 단일 소유 |
| R-3 | nav:* 확장이 기존 nonce/토큰 round-trip 회귀 | HIGH | additive only + 기존 security/round-trip 테스트 보존 후 신규 분기 RED 추가 |
| R-4 | Android WebView 스와이프 부재 + `(tabs)` 하드웨어 back = 무조건 native-back | HIGH | REQ-MOBNAV-022 web-history 우선 재분기. 헤더 back chevron 1차 |
| R-9 | 네이티브 헤더 뷰포트 차지 시 chat `h-dvh-fixed`·schedule `top-[60px]` 레이아웃 깨짐 | MEDIUM | REQ-MOBNAV-031 device-verify. 헤더는 WebView 뷰포트 밖(위) |
| R-11 | 알림 cross-tab `history.length` 딥링크 첫 진입 신뢰 판정 불확실 | MEDIUM | REQ-MOBNAV-021 폴백 + device-verify. 불확실 시 홈 폴백(fail-safe) |

---

## Definition of Done (요약)

- **자동 게이트 (로컬 검증 가능)**: `nx test mobile`(vitest) — 기존 baseline 유지 + `nav-header-core`/bridge nav round-trip/`decideBackPress` 분기 신규 GREEN, 회귀 0. `tsc --noEmit`(mobile/web) 0 에러. `apps/web` 은 `next build` + `tsc --noEmit`(웹 테스트 하니스 없음 — 메모리 `web-no-test-harness`, 하니스 추가 전 사용자 확인). `expo export` 번들 OK.
- **Phase 0 SPIKE 게이트 (선행, BLOCKING)**: Next 16 nav 관측 완전성(`<Link>`·`router.push`·Server Action redirect 누락 없음) 실측 통과 전 M2 착수 금지(REQ-MOBNAV-013).
- **디바이스 검증 게이트 (메모리 `mobile-spec-device-gated` 일관)**: iOS 시뮬레이터에서 헤더 렌더·nav 왕복·back·레이아웃 회귀 검증 완료 전까지 **status `in-progress` 유지**. Android AC 는 iOS 검증 후 보류 기록 가능(메모리 `ios-simulator-only`).

---

## Sources

- `.moai/specs/SPEC-MOBILE-NAV-001/research.md` (문제 원인 분석, 웹 페이지 전수 인벤토리, 네비게이션 메커니즘 옵션, 외부 웹 리서치 — 옵션 A 폐기 근거)
- `.moai/specs/SPEC-MOBILE-NAV-001/plan.md` (구현 계획, 파일별 델타, Phase 0 SPIKE, OD 5건 해소)
- depends-on: `.moai/specs/SPEC-MOBILE-003/spec.md`(라우트↔URL 계약), `.moai/specs/SPEC-MOBILE-002/spec.md`(bridge session 신호), `.moai/specs/SPEC-MOBILE-004`(auth:google-request additive 전례)
- relates-to: `.moai/specs/SPEC-WEBVIEW-UNIFY-001/spec.md:66`(R-U2 nav 채널 공유 계약)
- live source: `apps/mobile/{app/_layout.tsx, components/BridgedWebView.tsx, components/WebViewShell.tsx, hooks/useAuthBridge.ts, hooks/app-lifecycle-core.ts, lib/auth/bridge-protocol.ts, lib/route-map-core.ts}`, `apps/web/{app/(main)/_components/ShellModeEffect.tsx, lib/native-bridge/bridge-client.ts, app/globals.css}` + 웹 5페이지 헤더
