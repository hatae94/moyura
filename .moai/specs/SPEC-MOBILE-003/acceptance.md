# Acceptance — SPEC-MOBILE-003

> Given/When/Then 인수 시나리오. 자동(vitest/typecheck/build/static-grep) 검증과 디바이스 수동 검증을 분리 표기.
> 추적성: spec.md 의 26개 요구(R-RT*/R-AS*/R-NC*/R-WB*/R-PR*) 전부가 아래 번호 AC 중 최소 1개에 인용된다(R→AC 전수 커버리지 — 끝의 추적 매트릭스 참조). 디바이스 게이트는 status `in-progress`→`completed` 전환 조건(메모리 `mobile-spec-device-gated` 일관).

---

## AC-1 — 로그인 완료 후 네이티브 `/(tabs)/home` 전환 (R-NC5 / R-AS2)

- **Given** 앱이 콜드스타트되어 `(auth)/login` WebView 에서 사용자가 OAuth(또는 이메일) 로그인을 완료하고 bridge 가 `session:synced` 를 emit 한 상태에서,
- **When** `AuthContext` 가 `isSignedIn = true` 로 전이하면,
- **Then** 앱은 `router.replace("/(tabs)/home")`(네이티브 디스패치)로 home 탭을 표시하고, 그 탭의 WebView 는 `${WEB_URL}/home` 을 렌더하며, WebView `/me` 로드를 네이티브 목적지로 두지 않는다.
- 검증: 디바이스 게이트(실기기/에뮬레이터 로그인 라운드트립). 순수 분기는 AC-2 가 자동 검증.

## AC-2 — 인증 상태 결정 + 라우트 가드 순수 로직 (R-AS4 / R-AS1 / R-AS2 / R-AS5 / R-AS3)

- **Given** `auth-state-core.ts` 의 결정 함수에 `{ tokens: null, lastBridgeSignal: "session:none" }` 입력이 주어졌을 때,
- **When** 결정 함수를 호출하면,
- **Then** 결과는 `{ isSignedIn: false, redirectTo: "(auth)/login" }` 이고, `{ tokens: <valid>, lastBridgeSignal: "session:synced" }` 입력 시 `{ isSignedIn: true, redirectTo: "(tabs)/home" }`, `{ ..., lastBridgeSignal: "session:cleared" }` 입력 시 `{ isSignedIn: false, redirectTo: "(auth)/login" }` 이다. 즉 isSignedIn=false → `(tabs)` 가드가 `(auth)/login` 으로, isSignedIn=true → `(auth)` 가드가 `(tabs)/home` 으로 보내는 결정(R-AS3)이 이 순수 함수 출력으로 검증된다. 함수는 expo/RN import 가 0 이며 `/me` 페이지 상태를 읽지 않는다.
- 검증: 자동(vitest node-env). RN import 부재는 static-grep. (R-AS3 가드 적용/`Stack.Protected`·`Tabs.Protected` 배선의 런타임 동작은 AC-1 디바이스 게이트가 종단 검증)

## AC-3 — 네비게이션 계약: 교차 라우트 차단 → 네이티브 디스패치 (R-NC1 / R-NC2 / R-NC3)

> 계약 기준 AC: 결과 동작(deny + 네이티브 디스패치)을 단언하며, 결정 로직이 어느 모듈에 위치하든(OD-1: `route-map-core.ts` 분리 vs `decideWebViewLoad` 내장) 동일하게 적용된다.

- **Given** home 탭 WebView 안에서 신뢰 origin(`${WEB_URL}`)의 교차 라우트 URL 로드(예: `${WEB_URL}/explore`, 현재 라우트와 다른 path)가 시도되고, 라우트 매핑 + WebView-load 결정 로직(구현 위치 무관)이 평가에 사용될 때,
- **When** 결정 로직이 그 URL 을 평가하면,
- **Then** in-WebView 로드는 거부(deny)되고 매핑된 네이티브 라우트 디스패치 결정(예: `{ action: "dispatch", route: "(tabs)/explore" }`)이 반환되며, 인증 플로우 내부 허용 URL(OAuth authorize→system-browser, 동일 라우트 신뢰 로드)은 기존대로 허용된다.
- 검증: 자동(vitest node-env, 순수 로직). 기존 WebView-load 단언(trusted-load/oauth-intercept/deny, `auth-bridge-core.security.test.ts`)은 회귀 없이 유지.

## AC-4 — 엔트리 이전 행위 보존 + 의존성/회귀 게이트 (R-PR1 / R-PR2 / R-RT2 / R-RT3 / R-RT4)

- **Given** `App.tsx` 의 스플래시/브리지/콜드스타트 핸드셰이크 오케스트레이션이 `app/_layout.tsx` 로 행위 보존 이전(R-RT3)되고 `import './lib/env'` env 가드 side-effect 가 첫 렌더 전 보존(R-RT4)되며 SDK 56 호환 네비게이션 의존성이 추가(R-RT2)된 `apps/mobile`/`apps/web` 에서,
- **When** `nx test mobile`(vitest), `tsc --noEmit`(mobile/web), `next build`(web), `expo export`(mobile) 를 실행하면,
- **Then** 기존 `lib/auth/`·`hooks/` 테스트가 전부 통과(89/89 baseline 이상 유지, 신규 `auth-state-core`/`route-map-core`/확장 테스트 포함)하고, typecheck 0 에러(추가된 expo-router 의존성·타입 포함), web build 통과, expo 번들 OK(엔트리 이전이 번들/스플래시 부트를 깨지 않음)이며, 이메일 로그인 in-WebView 흐름 단언이 보존된다.
- 검증: 자동(전체 게이트 출력 첨부). env 가드 보존(R-RT4)은 미설정 throw 동작 확인 + `_layout.tsx`/entry 의 `./lib/env` import 존재 static-grep.

## AC-5 — 셸 모드 탭바 숨김(이중 탭바 없음) + 웹 `(main)`/`/home` 렌더 (R-WB1 / R-WB2 / R-WB3 / R-WB4 / R-PR3)

- **Given** 동일 웹 `(main)/home` 페이지가 (a) 데스크톱 브라우저, (b) 모바일 네이티브 WebView(셸 모드)에서 렌더될 때,
- **When** 각 환경에서 페이지가 로드되면,
- **Then** (a) 데스크톱은 웹 BottomTabBar + Figma HomeTab(인사말/CTA/필터 칩/모임 카드 mock/빈 상태)을 표시하고 로그인 후 `redirect("/home")` 로 도달하며, (b) 셸 모드는 웹 BottomTabBar 를 숨겨(하이드레이션 flash 없이) 네이티브 탭바만 보이게 한다 — 이중 탭바가 나타나지 않는다.
- 검증: (a) 웹 `next build` + 수동 브라우저 확인(메모리 `web-no-test-harness` — 자동 하니스 없음), redirect 변경은 `actions.ts` static-grep(`/home`). (b) 셸 모드 flash 미발생은 디바이스 게이트.

## AC-6 — Android back 네이티브 일원화 + `(auth)` 보존 (R-NC4)

> 계약 기준 AC: 라우트 컨텍스트별 back 결정을 단언하며, 컨텍스트 전달 방식이 어떻든(OD-2: `decideBackPress` 시그니처 확장 vs 라우트별 훅 분리) 동일하게 적용된다.

- **Given** back 결정 로직에 `(tabs)` 라우트 컨텍스트가 주어진 경우와 `(auth)/login` 컨텍스트 + `canGoBack=true` 가 주어진 경우,
- **When** 각 컨텍스트에서 Android 하드웨어 back 을 평가하면,
- **Then** `(tabs)` 컨텍스트는 `"native-back"`(expo-router 네이티브 네비게이션) 결정을 반환하고, `(auth)/login` 컨텍스트는 기존 `"goBack"`(WebView history) 결정을 반환한다 — 즉 `(tabs)` 의 back 은 네이티브로 일원화되고 `(auth)/login` 의 WebView 히스토리 back 은 SPEC-MOBILE-001 대로 보존된다.
- 검증: 자동(vitest 순수 분기). 실제 하드웨어 back 동작은 디바이스 게이트.

## AC-7 — 딥링크 공존 + 로그아웃 종단 (R-PR4 / R-PR5)

- **Given** expo-router 가 도입되고 `scheme: "moyura"` 가 유지된 디바이스/에뮬레이터에서,
- **When** (a) OAuth 시스템 브라우저 복귀로 `moyura://auth-callback` 딥링크가 발생하고, (b) 사용자가 로그아웃(`session:cleared`)하면,
- **Then** (a) expo-router 가 콜백을 앱 라우트로 가로채지 않고 기존 OAuth 브리지 흐름이 정상 동작하며(콜백 경로는 라우트 파일로 존재하지 않음), (b) 앱은 `(auth)/login` 으로 네이티브 이동하고 SPEC-MOBILE-002 R-R4 cookie-clear 가 보존된다.
- 검증: 콜백 경로 라우트 파일 부재는 static-grep. 딥링크/로그아웃 종단은 디바이스 게이트.

## AC-8 — 라우트 구조 + deprecated API 금지 정적 계약 (R-RT1 / R-RT5 / R-RT6 / R-WB5)

- **Given** 본 SPEC 구현 후의 `apps/mobile/app/` 트리와 `apps/mobile/package.json`/`app.json`,
- **When** 소스를 정적 검사(static-grep + typecheck)하면,
- **Then** 다음이 전부 성립한다:
  - (R-RT1) `package.json` `main` = `expo-router/entry`(또는 이를 re-export 하는 custom entry); `@react-navigation/*` 직접 import 0, `expo-router/babel` plugin 부재, `useRootNavigation()` 호출 0.
  - (R-RT5) 라우터를 우회하는 `App.tsx` 최상위 default-export 렌더 경로 부재 — `app/` 트리가 단일 진입.
  - (R-RT6) `app.json` `experiments.typedRoutes` 가 `true` 이거나, SDK 56 typecheck 비호환으로 비활성(Optional — 둘 중 하나면 통과, AC-에지 typedRoutes 미호환 참조).
  - (R-WB5) `apps/mobile/app/(tabs)/{home,explore,notifications,profile}.tsx` 가 각각 `${WEB_URL}/<route>` 를 호스팅하는 WebView 래퍼이고 `(tabs)/_layout.tsx` 가 expo-router `Tabs`(notifications 배지 포함)이며, 웹 `(main)/*` 페이지에는 `react-native-webview` import 0.
- 검증: 자동(static-grep + `tsc --noEmit`). 네이티브 탭바 스타일/배지의 시각적 동작은 디바이스 게이트.

---

## R→AC Traceability Matrix

모든 요구가 최소 1개 번호 AC 에 인용됨(R→AC 전수 커버리지):

| 요구 | 인용 AC |
|---|---|
| R-RT1 | AC-8 |
| R-RT2 | AC-4 |
| R-RT3 | AC-4 |
| R-RT4 | AC-4 |
| R-RT5 | AC-8 |
| R-RT6 | AC-8 |
| R-AS1 | AC-2 |
| R-AS2 | AC-1, AC-2 |
| R-AS3 | AC-2 |
| R-AS4 | AC-2 |
| R-AS5 | AC-2 |
| R-NC1 | AC-3 |
| R-NC2 | AC-3 |
| R-NC3 | AC-3 |
| R-NC4 | AC-6 |
| R-NC5 | AC-1 |
| R-WB1 | AC-5 |
| R-WB2 | AC-5 |
| R-WB3 | AC-5 |
| R-WB4 | AC-5 |
| R-WB5 | AC-8 |
| R-PR1 | AC-4 |
| R-PR2 | AC-4 |
| R-PR3 | AC-5 |
| R-PR4 | AC-7 |
| R-PR5 | AC-7 |

---

## Edge Cases

- **콜드스타트 핸드셰이크 타임아웃**: 토큰 핸드셰이크가 타임아웃되면(SPEC-MOBILE-002 R-N6) `_layout.tsx` 가 스플래시를 강제 해제하고 `auth-state-core` 가 `session:none` 폴백으로 `(auth)/login` 분기 — 무한 스플래시 금지.
- **교차 라우트 vs 동일 라우트 쿼리 변경**: `${WEB_URL}/home?filter=done` 같은 동일 라우트 내 쿼리/해시 변경은 cross-route 가 아니므로 in-WebView 허용(route-map 은 path 기준 비교).
- **셸 모드 미감지(레이스)**: 마커 주입 실패 시 웹 탭바가 보일 수 있음 — `injectedJavaScriptBeforeContentLoaded`(하이드레이션 전)로 레이스 제거, 폴백은 숨김 우선(안전측: 셸 의심 시 숨김).
- **typedRoutes 미호환**: TS 6 에서 typedRoutes 가 typecheck 실패하면 R-RT6(Optional)을 비활성화하고 진행(R-RT1~RT5 는 불변).
- **알림 배지 mock**: 네이티브 탭 배지·웹 notifications 배지는 mock 카운트 — 실데이터 0 가정, 0 일 때 배지 미표시.

## Quality Gates (요약)

- 자동: vitest 89/89 baseline 이상(+ `auth-state-core`/`route-map-core`/확장 `decideWebViewLoad`·`decideBackPress`), `tsc --noEmit`(mobile/web) 0 에러, `next build` 통과, `expo export` OK.
- static-grep: `(tabs)/*.tsx` = WebView 래퍼, 웹 `(main)/*` 에 `react-native-webview` import 0, deprecated expo-router API(`@react-navigation/*`/`expo-router/babel`/`useRootNavigation`) 0, `actions.ts`/`oauth-bridge.ts` redirect = `/home`.
- 디바이스 게이트(completed 전환 조건): 로그인→`/(tabs)/home`, 탭 전환=네이티브, 교차 라우트 차단→디스패치, Android 네이티브 back, 셸 모드 웹 탭바 미표시(flash 없음), `moyura://` 딥링크 공존, 로그아웃 종단.

## Definition of Done

- [ ] M1~M5 모든 요구(R-RT*/R-AS*/R-NC*/R-WB*/R-PR*, 26건) 구현 + AC-1~AC-8 충족(R→AC 전수 커버리지 매트릭스 일치)
- [ ] 자동 게이트 전부 통과(출력 첨부)
- [ ] Exclusions 준수: MeetupDetail 미구현(후속 SPEC 명시), 실 API 0, 웹 `/me` 페이지 보존, 디자인 토큰 파이프라인 0
- [ ] @MX:ANCHOR(auth-state-core/route-map-core) + @MX:WARN(엔트리 이전) 부착
- [ ] 런 단계 진입 전 OD-1~OD-4 확정 — 비권장안 채택 시 AC-3(OD-1)/AC-6(OD-2) 계약 단언이 그대로 유효한지 확인(계약 기준 AC 이므로 구현 위치 변경에 불변)하고 필요 시 동기화
- [ ] 디바이스 종단 검증 완료 후 status `in-progress`→`completed` 전환
