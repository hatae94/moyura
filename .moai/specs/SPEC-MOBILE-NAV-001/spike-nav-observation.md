# SPIKE — Next 16 App Router 클라이언트 내비게이션 웹측 관측 완전성 (REQ-MOBNAV-013 / OD-4)

> Phase 0 선행 게이트. NavStateReporter(REQ-MOBNAV-010)가 세 내비 유형 — (1) `<Link>` 클릭, (2) `router.push()`, (3) Server Action `redirect()` — 을 **누락 없이** 웹측에서 관측할 수 있는지, 설치된 Next 소스로 권위 있게 판정한다. 딥리서치가 미해결로 남긴 구간(research.md §미해결 1)을 로컬 소스 대조로 종결한다.
>
> 검증 대상 버전: **`next@16.2.6`** (`apps/web/node_modules/next/package.json`). React 19. App Router.
> 인용 경로는 전부 `apps/web/node_modules/next/dist/` 하위 설치 산출물.

---

## 0. 결론 요약 (TL;DR)

**Verdict: `confirmed-local`.**

세 내비 유형 전부 **App Router의 단일 수렴점**(`canonicalUrl` 상태)을 통과한다. `usePathname()`은 이 상태에서 파생된 `PathnameContext`를 `useContext`로 구독하므로, 세 유형 모두에서 pathname 변경 시 리렌더가 **보장**된다. 따라서:

- **권장 관측 방식**: `usePathname()` + `useEffect([pathname])` 단일 메커니즘으로 세 유형 전부 포착. `Link onNavigate`는 **불필요**(보조 수단으로도 불요).
- **누락(gap) 없음** — Server Action redirect 포함 세 유형 모두 `usePathname` 리렌더로 관측됨.
- **WebView 의존성 없음** — 이 관측은 WebView 내부의 **순수 React 재렌더**이며 `react-native-webview` 네이티브 콜백에 의존하지 않는다. 즉 관측 완전성은 **로컬에서 답이 확정**된다. 디바이스 게이트는 관측이 아니라 그 뒤의 postMessage 전달 + 네이티브 헤더 렌더에만 걸린다(§5).

---

## 1. 핵심 메커니즘 — `usePathname`은 무엇을 구독하는가

`usePathname()`은 `PathnameContext`를 `useContext`로 읽는 얇은 훅이다.

- `dist/client/components/navigation.js:126-145` — `usePathname()` 본문. 핵심: `const pathname = useContext(PathnameContext)`(:130). 다른 로직은 dev-only 계측·빌드타임 검증뿐이고, 프로덕션 런타임 반환값은 이 컨텍스트 값 그대로다.

`PathnameContext`의 값은 루트 `Router` 컴포넌트가 `canonicalUrl`에서 파생해 Provider로 내려준다.

- `dist/client/components/app-router.js:112-125` — `Router({ actionQueue })`. `const state = useActionQueue(actionQueue)`(:113)로 라우터 상태를 구독하고, `const { canonicalUrl } = state`(:114). 이어서 `useMemo(() => { const url = new URL(canonicalUrl, ...); return { searchParams, pathname: ... } }, [canonicalUrl])`(:116-125) — **pathname은 `canonicalUrl`에서 파생되며 `canonicalUrl`이 바뀔 때만 재계산**된다.
- `dist/client/components/app-router.js:427-428` — `<PathnameContext.Provider value={pathname}>`. 이 값이 `usePathname()`의 반환값이 된다.

`useActionQueue`는 라우터 상태를 React 상태로 동기화한다.

- `dist/client/components/use-action-queue.js:76-139` — `useActionQueue(actionQueue)`. `const [canonicalState, setState] = useState(actionQueue.state)`(:77), `const [state, setGesture] = useOptimistic(canonicalState)`(:82). 모든 라우터 액션은 `actionQueue.dispatch(action, setState)`로 `setState`를 호출(:100,:104)해 리렌더를 유발한다.

**따라서 판정 기준은 하나로 환원된다: "세 내비 유형이 각각 `canonicalUrl`을 바꾸는가?"** 바꾼다면 `usePathname`은 반드시 리렌더된다. 아래 §2에서 세 유형 전부가 `canonicalUrl`을 갱신하는 **동일한 리듀서 경로**(`ACTION_NAVIGATE` 또는 `ACTION_RESTORE`)로 수렴함을 보인다.

---

## 2. 세 내비 유형별 소스 추적

### 2.1 유형 1 — `<Link>` 클릭 (soft-nav pushState)

`<Link>` 클릭은 `linkClicked()`를 거쳐 `dispatchNavigateAction`을 호출한다.

- `dist/client/app-dir/link.js:53-89` — `linkClicked(e, href, ..., onNavigate, ...)`. 로컬 URL이면 `e.preventDefault()`(:72) 후 `dispatchNavigateAction(href, replace ? 'replace' : 'push', ...)`(:84-87)를 `startTransition` 안에서 호출.
- `dist/client/components/app-router-instance.js:211-236` — `dispatchNavigateAction(...)`은 `dispatchAppRouterAction({ type: ACTION_NAVIGATE, url, ... })`(:228-235)를 디스패치. → 리듀서가 `canonicalUrl`을 갱신 → `usePathname` 리렌더.

**포착됨.** `<Link>` → `ACTION_NAVIGATE` → `canonicalUrl` 변경.

### 2.2 유형 2 — `router.push()` (프로그램적 내비)

`useRouter()`가 반환하는 인스턴스의 `push`/`replace`는 `<Link>`와 **동일한** `dispatchNavigateAction`을 부른다.

- `dist/client/components/navigation.js:146-156` — `useRouter()`는 `useContext(AppRouterContext)`(:147)를 반환.
- `dist/client/components/app-router.js:433-434` — `<AppRouterContext.Provider value={publicAppRouterInstance}>`. 즉 `useRouter()` == `publicAppRouterInstance`.
- `dist/client/components/app-router-instance.js:288-354` — `publicAppRouterInstance`. `push:(href, options) => startTransition(() => dispatchNavigateAction(href, 'push', ...))`(:343-354), `replace`도 동형(:331-342). → `ACTION_NAVIGATE` → `canonicalUrl` 변경.

**포착됨.** `router.push()` → (`<Link>`와 같은) `dispatchNavigateAction` → `ACTION_NAVIGATE` → `canonicalUrl` 변경.

> 부수 확인: `router.back()`/`router.forward()`는 `window.history.back()/forward()`(:289-290)로 위임되고, 브라우저 `popstate` → `onPopState`(app-router.js:284-299) → `dispatchTraverseAction` → `ACTION_RESTORE`로 역시 `canonicalUrl`을 갱신한다(app-router-instance.js:237-247). 즉 **REQ-MOBNAV-020의 `nav:back`(웹 `router.back()`) 이후 새 route도 동일하게 `usePathname`으로 재관측**되어 헤더가 자가 갱신된다(§2.2 데이터흐름 도식과 일치).

### 2.3 유형 3 — Server Action `redirect()`

이 유형이 딥리서치의 핵심 불확실 구간이었다. 소스는 **명확히 SPA 내비로 수렴**함을 보인다. 두 하위 경로 모두 확인:

**(a) Server Action 응답의 redirect (가장 흔한 경우 — form action / `useActionState`):**

- `dist/client/components/router-reducer/reducers/server-action-reducer.js:84-108` — 액션 응답 헤더 `x-action-redirect`를 파싱해 `redirectLocation`/`redirectType` 산출(내부 redirect는 기본 `push`, :89).
- 같은 파일 `:214-234` — `redirectLocation`이 내부 URL이면(`else` 분기 :228-234) `createRedirectErrorForAction(redirectHref, navigateType)`로 **redirect error를 만들어 `reject(redirectError)`**(:232-233). 액션 프로미스를 redirect 에러로 거부해 `RedirectBoundary`가 처리하도록 넘긴다(주석 :216-219 명시). 외부 URL만 `completeHardNavigation`(MPA, :222-227).

**(b) `RedirectBoundary`가 redirect error를 라우터 내비로 전환:**

- `dist/client/components/redirect-boundary.js:30-45` — `HandleRedirect`가 `useRouter()`(:31)를 잡고 `useEffect`(:32) 안에서 `startTransition(() => redirectType === 'push' ? router.push(redirect, {}) : router.replace(redirect, {}))`(:33-37).
- 즉 Server Action 내부 redirect → redirect error → `RedirectBoundary` → **`router.push()`/`router.replace()`** → §2.2와 완전히 동일한 `dispatchNavigateAction` → `ACTION_NAVIGATE` → `canonicalUrl` 변경.

**(c) Server Component 렌더 중 `redirect()` / 스트리밍 컨텍스트:**

- `dist/docs/01-app/03-api-reference/04-functions/redirect.md:11` — "When used in a streaming context, this will insert a meta tag to emit the redirect on the **client side**. When used in a server action, it will serve a 303 HTTP redirect response to the caller."
- 클라이언트 측에서 버블링된 redirect error도 안전망이 잡는다: `dist/client/components/app-router.js:178-202` — `handleUnhandledRedirect`가 `error`/`unhandledrejection` 리스너에서 `isRedirectError` 확인 후 `publicAppRouterInstance.push(url,{})` 또는 `.replace(url,{})`(:189-193) 호출. → 역시 `ACTION_NAVIGATE`.

**포착됨.** Server Action redirect(내부)는 3개 경로(reducer reject → RedirectBoundary, 스트리밍 meta-tag 클라이언트 emit, unhandled redirect 안전망) **모두** `router.push/replace` == `dispatchNavigateAction` == `ACTION_NAVIGATE`로 수렴 → `canonicalUrl` 변경 → `usePathname` 리렌더.

> **예외 = 외부(MPA) redirect만 관측 불가**하나 이는 정상이다: 외부 URL redirect(`completeHardNavigation`, `location.assign/replace`)는 SPA 이탈로 전체 문서가 언로드되며 셸/헤더 맥락 자체가 종료된다. NAV-001의 5개 헤더 페이지(REQ-MOBNAV-003)는 전부 내부 route라 이 예외는 스코프 밖이다.

---

## 3. `Link onNavigate` 및 router-events API 표면 (Next 15.3+ / 16)

### 3.1 `onNavigate`는 존재한다

- `dist/client/app-dir/link.d.ts:4-6` — `type OnNavigateEventHandler = (event: { preventDefault: () => void; }) => void;`
- `dist/client/app-dir/link.d.ts:170` — `onNavigate?: OnNavigateEventHandler;` (Link props).
- 구현: `dist/client/app-dir/link.js:73-83` — `if (onNavigate) { onNavigate({ preventDefault: () => { isDefaultPrevented = true } }); if (isDefaultPrevented) return; }`. **client-side 내비 직전(`e.preventDefault()` 이후, `dispatchNavigateAction` 이전)에 동기 호출**되며, `event.preventDefault()`로 전환을 취소할 수 있다.

### 3.2 `onNavigate`의 한계 — 두 유형을 못 잡는다

`onNavigate`는 **`<Link>` 컴포넌트에만** 붙는 prop이다(`link.js:322`에서 `linkClicked(... onNavigate ...)` 배선). 따라서:

- 유형 2 `router.push()`(프로그램적) → `<Link>`를 경유하지 않으므로 **`onNavigate` 미발화**.
- 유형 3 Server Action redirect → `RedirectBoundary`가 `router.push`를 직접 부르므로 **`onNavigate` 미발화**.

즉 `onNavigate` 단독으로는 세 유형 중 **1개(Link 클릭)만** 포착 → NavStateReporter의 관측 수단으로는 부적합(불완전).

### 3.3 router-events / navigation-guard API — 부재

- `dist/client/components/navigation.d.ts` / `navigation.react-server.d.ts` 를 `onNavigate|routerEvents|router-events|navigationGuard|useRouterEvents|events` 로 grep — **매치 0건**. Pages Router 시절의 `router.events`(`routeChangeStart` 등)에 대응하는 App Router 공개 API는 설치본에 **존재하지 않는다**. (실험적 `experimental_gesturePush`(app-router-instance.js:255-287,382-385)만 있으며 제스처 전용이라 무관.)

**결론**: Next 16에는 "모든 내비를 가로채는 공개 router-events 훅"이 없다. 그러나 §1-2가 보인 대로 **`usePathname` 리렌더가 그 역할을 완전히 대체**한다(세 유형 전부 커버).

---

## 4. 권장 NavStateReporter 관측 방식

**단일 메커니즘: `usePathname()` + `useEffect`.** `Link onNavigate` 불사용.

```
"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function NavStateReporter(): null {
  const pathname = usePathname();            // 세 유형 전부 여기서 리렌더 (§1-2)
  useEffect(() => {
    if (!isShellMode()) return;              // 데스크톱 no-op (브리지 부재)
    postNavState({ pathname, title: deriveTitle(pathname), canGoBack: computeCanGoBack() });
  }, [pathname]);                            // pathname 변경마다 nav:state 보고
  return null;
}
```

| 내비 유형 | `usePathname` effect | `Link onNavigate` |
|---|---|---|
| (1) `<Link>` 클릭 | 포착 (§2.1) | 포착 |
| (2) `router.push()` | 포착 (§2.2) | **미포착** |
| (3) Server Action redirect(내부) | 포착 (§2.3) | **미포착** |
| back/forward (popstate) | 포착 (§2.2 부수확인, `ACTION_RESTORE`) | 해당 없음 |
| 외부(MPA) redirect | 스코프 밖(문서 언로드) | 해당 없음 |

**근거**: `usePathname`이 세 유형의 **공통 수렴점**(`canonicalUrl`)을 구독하므로 관측 지점이 하나로 충분하다(단일 진실 출처 원칙과도 정합 — plan §2.2). `onNavigate`를 얹어도 얻는 것이 없고, 오히려 Link 유형만 이중 발화해 디바운스 부담만 생긴다.

### 4.1 관측 설계 세부 주의

- **shell 판정식은 `ShellModeEffect`와 동일 재사용** — `apps/web/app/(main)/_components/ShellModeEffect.tsx`가 `window.__MOYURA_NATIVE_SHELL__ === true || !!window.ReactNativeWebView`로 셸 감지 후 no-op(desktop). NavStateReporter도 같은 식으로 데스크톱 no-op(REQ-MOBNAV-010) — 신규 감지 도입 0(plan R-7 완화와 정합).
- **`title` 소스**: `usePathname`은 pathname만 제공하므로 모임명 등 title은 route 데이터에서 별도 산출해야 한다(REQ-MOBNAV-012, plan R-6). document.title은 전 페이지 `"moyura"` 고정이라 사용 불가.
- **soft-nav 셸 세팅 순서**: `ShellModeEffect`가 이미 soft-nav 시 `html[data-shell]`을 보강한다(mount effect). NavStateReporter의 셸 판정은 `data-shell` 속성이 아니라 전역 플래그(`window.__MOYURA_NATIVE_SHELL__`/`ReactNativeWebView`)를 직접 읽어야 timing 독립적이다.
- **커버리지 마운트 위치**: `(main)` 그룹 밖 route(`moims/[id]/chat|schedule|expenses`, `moims/new`)는 `(main)/layout.tsx` 리포터가 커버 못 하므로 `moims/layout.tsx` 2차 마운트 필요(plan §4.2 이미 반영). `usePathname` 자체는 `AppRouterContext` 하위 어디서든 동작하므로 리포터 컴포넌트의 배치만 라우트 그룹을 덮으면 된다.

---

## 5. WebView 컨텍스트 의존성 명확화 (질문 4)

**웹측 관측(`usePathname` 리렌더)은 순수 React이며 `react-native-webview` 네이티브 콜백에 의존하지 않는다.**

- `usePathname` → `useContext(PathnameContext)` → `useActionQueue`의 `useState`/`useOptimistic` 리렌더 — 전 과정이 WebView 내부에서 실행되는 **JS/React 런타임 동작**이다. WebView는 단지 그 React 앱을 담는 브라우저 컨텍스트일 뿐, `onShouldStartLoadWithRequest`·`onNavigationStateChange` 같은 RN 네이티브 콜백은 **이 관측에 전혀 관여하지 않는다**.
- 딥리서치가 죽인 것은 **네이티브측** `onShouldStartLoadWithRequest`가 SPA soft-nav에 발화하지 않는다는 점이었다(plan §1.2 [확정 거짓]). 본 SPIKE의 관측 방식은 그 네이티브 콜백을 **애초에 쓰지 않고** 웹이 자기 상태를 스스로 관측·보고하므로 그 blocker와 무관하다.
- **따라서 관측 완전성(observation-completeness)은 로컬에서 답이 확정된다** — 설치 소스가 세 유형의 `canonicalUrl` 수렴을 증명하고, `usePathname`이 그 상태를 구독함이 코드로 확정되므로 런타임 디바이스 확인 없이 판정 가능.
- **디바이스 게이트에 남는 것**은 관측 이후 단계뿐: (a) 관측된 nav:state의 `postMessage(ReactNativeWebView.postMessage)` 전달, (b) 네이티브 onMessage 수신 → `nav-header-core` 결정 → `NativeHeaderBar` 렌더, (c) back chevron 탭 → `nav:back` 왕복. 이들은 종단 postMessage 전달 + 네이티브 UI라 iOS 시뮬레이터 종단 검증 대상(plan Phase 4). **관측 자체는 여기 포함되지 않는다.**

---

## 6. 검증 결과 매트릭스

| 항목 | 판정 | 1차 근거(설치 경로) |
|---|---|---|
| `usePathname` = `PathnameContext` 구독 | 확정 | `navigation.js:126-145` |
| pathname은 `canonicalUrl` 파생 | 확정 | `app-router.js:116-125`, Provider `:427-428` |
| `<Link>` 클릭 → `ACTION_NAVIGATE` | 포착 | `link.js:84-87` → `app-router-instance.js:228-235` |
| `router.push()` → `ACTION_NAVIGATE` | 포착 | `app-router-instance.js:343-354`(push), `:211-236` |
| Server Action redirect(내부) → `router.push` | 포착 | `server-action-reducer.js:214-234` → `redirect-boundary.js:30-45` |
| unhandled redirect 안전망 → `router.push/replace` | 포착 | `app-router.js:178-202` |
| back/forward(popstate) → `ACTION_RESTORE` | 포착 | `app-router.js:284-299`, `app-router-instance.js:237-247` |
| `Link onNavigate` 존재 | 존재(단 Link 전용) | `link.d.ts:4-6,170`, `link.js:73-83` |
| 공개 router-events/guard API | 부재 | `navigation.d.ts` grep 0건 |
| 외부(MPA) redirect | 관측 불가(스코프 밖) | `server-action-reducer.js:222-227` |
| 관측이 RN 네이티브 콜백 비의존 | 확정 | §5 (순수 React 경로) |

---

## 7. 최종 판정 및 M2 착수 조건

**Verdict = `confirmed-local`.**

REQ-MOBNAV-013의 게이트 조건("`<Link>`·`router.push`·Server Action redirect를 Next 16에서 누락 없이 관측")은 **설치 소스 대조로 충족**된다. 세 유형 전부 `usePathname()` 리렌더로 관측되며 누락 전환 유형은 없다(외부 MPA redirect는 설계상 스코프 밖). 따라서:

- **NavStateReporter는 `usePathname` + `useEffect([pathname])` 단일 메커니즘으로 구현**한다. `Link onNavigate`·router-events 도입 불요.
- **누락 전환 유형에 대한 보완 신호 설계 불필요** — OD-4가 "누락 발견 시 보완 신호 설계"를 조건부로 걸었으나, 누락이 없으므로 이 분기는 발동하지 않는다.
- **M2 실구현 착수 허용** — 웹측 관측 방식이 확정되어 REQ-MOBNAV-010/012 구현의 선행 게이트가 해제된다.

**로컬로 종결된 것 / 디바이스에 남는 것 분리**(메모리 `verify-locally-before-device-gating` 원칙):
- 로컬 종결: 관측 완전성(세 유형 커버) — 본 SPIKE.
- 디바이스 게이트: nav:state postMessage 종단 전달 + 네이티브 헤더 렌더 + nav:back 왕복(plan Phase 4, 관측과 무관).

---

버전: 1.0 | 대상: `next@16.2.6` (설치본) | 작성: Phase 0 SPIKE (REQ-MOBNAV-013 / OD-4)
