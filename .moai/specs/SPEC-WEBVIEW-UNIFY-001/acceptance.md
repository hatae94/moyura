# SPEC-WEBVIEW-UNIFY-001 — Acceptance Criteria

> 각 AC 는 spec.md 의 EARS 요구사항과 1:1 대응한다(R-U1~U5 ↔ AC-U1~U5). 호스팅/네비게이션 모델 전환 — 렌더링 비용 회귀 0(onLoadStart 반복 제거)이 목표, 사용자 흐름 회귀 0(OAuth/초대/푸시/세션)이 제약.
> 검증 채널: **자동/계측**(typecheck 0 / WebView 인스턴스·onLoadStart 카운트 계측 / 프롭 존재 정적 검사 / `expo export` 번들 OK) + **수동 전용 — device-gated**(WebView 비리마운트·세션 연속·OAuth 왕복·Android back·푸시 탭은 iOS 시뮬레이터/실기기 종단으로만 확정 — moyura WebView SPEC 관행, iOS 시뮬레이터 우선·Android back 은 게이트 보류 기록).

---

## M1. 공유 단일 WebView 수명 + perf 프롭

### AC-U1 ↔ R-U1 (단일 인스턴스 + 비리마운트 + perf 프롭)
- **Given** 현재 화면별 `BridgedWebView`/`<WebView>` 인스턴스 마운트 모델(`BridgedWebView.tsx:269-271`, `home/[id].tsx:28`)
- **When** 셸 레벨에 단일 공유 WebView 를 1회 마운트하도록 호스팅 모델을 전환한다
- **Then** 앱 세션 동안 WebView 인스턴스는 **정확히 1개**이고, 탭 전환·상세 진입에서 **새 WebView 가 마운트되지 않는다**.
- **And When** 사용자가 탭을 전환하거나 상세를 연다
- **Then** 단일 WebView 가 in-WebView 웹 SPA soft-nav 로 이동하며, **`onLoadStart` 가 콜드스타트 1회 외에 추가로 0회 발화한다**(전환 후 풀 GET 로드 없음).
- **And Then** 단일 WebView 는 `key` 미부여 + ref/현재 라우트 상태를 셸이 소유하며, 라우트 이동은 hard reload(`source` URI 하드 리셋)가 아니라 in-WebView SPA 네비게이션이다(OD-1).
- **And Then** 공유 WebView 에 perf 프롭(`cacheEnabled`, Android `cacheMode`, `androidLayerType="hardware"`, `domStorageEnabled`)이 설정되고, 기존 보안 프롭(`originWhitelist`/쿠키/`setSupportMultipleWindows`/`injectedJavaScriptBeforeContentLoaded`)은 무변경이다.
- **자동/계측 검증**: typecheck 0; 셸 트리에 `<WebView>` 사용처가 1곳(정적 검사 — 탭/상세가 자기 WebView 를 마운트하지 않음); `onLoadStart` 호출 카운터를 계측해 콜드스타트 1회 후 탭 전환·상세 진입에서 0회 증가; perf 프롭 4종이 WebView 에 전달됨(프롭 존재 정적 검사); 보안 프롭 4종 유지; `expo export` 번들 OK.
- **수동 전용 — device-gated**: 단일 WebView 비리마운트로 쿠키/PKCE/세션이 탭+상세+back 왕복을 가로질러 보존됨(OD-1, 자동 불가). Android `androidLayerType="hardware"` 스크롤 jank 해소(체감, 게이트 보류).

---

## M2. 네이티브 탭 ↔ 웹 라우트 양방향 동기화 + 단일 탭바

### AC-U2 ↔ R-U2 (양방향 동기화 + 단일 탭바 소유)
- **Given** 네이티브 탭바(expo-router `Tabs`)와 웹 `BottomTabBar`(셸 모드 숨김)
- **When** 사용자가 네이티브 탭 N 을 탭한다
- **Then** 단일 WebView 의 웹 pathname 이 in-WebView SPA 네비게이션으로 `/{route_N}` 가 되며(네이티브→웹 navigate 명령), **새 WebView 가 마운트되지 않는다**(`onLoadStart` 0회 증가).
- **And When** 단일 WebView 내부에서 웹 pathname 이 변한다(탭 전환 결과 또는 웹 내부 링크 이동)
- **Then** 웹이 새 pathname 을 네이티브로 보고하고, 네이티브 탭바 하이라이트가 매칭 루트 탭을 반영한다(`routeForUrl` 로 루트 매핑 — `/home/{id}` 도 home 탭 active 유지).
- **And Then** 화면에 **보이는 하단 탭바는 정확히 1개**다 — 네이티브 탭바가 승하고 웹 `BottomTabBar` 는 `html[data-shell="native"]` 계약으로 계속 숨겨진다(이중 탭바 금지, OD-5).
- **And Then** 네이티브→웹 navigate 명령과 웹→네이티브 pathname 보고는 기존 nonce + 신뢰 origin 불변식을 재사용하는 네비게이션 채널 메시지이고, v1 세션 메시지 타입(`session:synced/none/cleared` 등)을 변경하지 않는다.
- **자동/계측 검증**: typecheck 0; 네비게이션 채널 메시지가 nonce 봉투/신뢰 origin 가드를 통과하는 단위 검사(순수 분류 함수 — `route-map-core` 패턴, expo/RN import 0); v1 `bridge-protocol` 세션 타입 diff 부재(메시지 타입 추가만, 기존 타입 무변경); 셸 모드 탭바 숨김 CSS 계약(`data-shell="native"`) 무변경; 탭 탭 시 `onLoadStart` 0회 증가(계측).
- **수동 전용 — device-gated**: 탭 탭→웹 pathname 동기화 및 하이라이트 일치, 웹 내부 이동 시 하이라이트 추종, 이중 탭바 부재(시각 — 자동 불가).

---

## M3. 단일 WebView 내 히스토리 네비게이션

### AC-U3 ↔ R-U3 (상세 push·pop + Android back in-WebView 히스토리)
- **Given** 현재 상세(`/home/{id}`)가 별도 expo-router Stack 라우트로 새 `BridgedWebView` 를 마운트하는 모델(`home/[id].tsx:28`)과 "(tabs)" back 의 네이티브 위임(`useAppLifecycle.ts` `decideBackPress`)
- **When** 사용자가 상세를 연다
- **Then** 단일 WebView 의 웹 히스토리 깊이가 in-WebView SPA 네비게이션으로 +1 되며(`WebView.canGoBack` true), **새 WebView 가 마운트되지 않는다**(`onLoadStart` 0회 증가).
- **And Given** 단일 WebView 의 웹 히스토리가 비어있지 않을 때(`canGoBack` true)
- **And When** Android 하드웨어 백을 누른다
- **Then** 앱이 `WebView.goBack()` 을 소비해 in-WebView SPA 히스토리를 되감고(상세→목록 복귀가 같은 WebView 안에서 발생), **새 WebView 마운트 없음**(`onLoadStart` 0회 증가).
- **And Given** 웹 히스토리가 탭 루트(더 돌아갈 곳 없음)일 때
- **And When** Android 하드웨어 백을 누른다
- **Then** 앱이 기본 동작(종료/백그라운드)으로 fall-through 하고 리마운트하지 않는다.
- **And Then** 탭 전환은 단일 공유 웹 히스토리에 `push` 의미로 기록된다(per-탭 독립 스택 아님 — OD-3).
- **자동/계측 검증**: typecheck 0; `decideBackPress` 의 단일-WebView 분기(canGoBack true→`goBack` 소비 / 루트→fall-through)에 대한 순수 단위 테스트(주입 콜백, expo/RN import 0 — SHELL-001 AC-S6 패턴); 상세 진입·back 시 `onLoadStart` 0회 증가(계측).
- **수동 전용 — device-gated**: Android 하드웨어 백으로 상세→목록 복귀가 같은 WebView 안에서 일어남, 루트에서 종료, cross-탭 back 거동(자동 불가 — Android back 게이트 보류 기록).

---

## M4. 단일 콜드스타트 인증 핸드셰이크

### AC-U4 ↔ R-U4 (앱당 1회 핸드셰이크 + 스플래시 1회)
- **Given** 현재 화면(`BridgedWebView`)마다 콜드스타트 핸드셰이크가 도는 모델(`BridgedWebView.tsx:182-208`)과 토큰 이중 로드(`AuthContext.tsx:80` + `BridgedWebView.tsx:182`)
- **When** 셸 레벨 단일 WebView 로 일원화한다
- **Then** 콜드스타트 핸드셰이크(토큰 로드 `loadTokens` → `injectRestore` → `startHandshakeTimeout` 8s 폴백 → `SplashScreen.hideAsync`)가 **앱 세션당 정확히 1회** 실행되고, 탭/상세 진입마다 재실행되지 않는다.
- **And Then** 스플래시는 **정확히 1회** 해제된다(synced/none 수신 또는 8s 타임아웃 중 먼저 오는 것).
- **And Then** resume(AppState active) 재검증(`injectRevalidate`)은 단일 WebView 의 현재 web 라우트에 대해 기존대로 1회씩 동작한다.
- **And Then** 콜드스타트 토큰 로드는 단일 진입으로 정리되되 `AuthContext.isSignedIn` 인증 도출 의미는 보존된다.
- **자동/계측 검증**: typecheck 0; `loadTokens`/`registerColdStartTokens`/`injectRestore`/`startHandshakeTimeout` 가 앱 콜드스타트당 1회 호출됨을 계측(탭/상세 진입에서 추가 호출 0); 기존 핸드셰이크 순수 코어(`auth-bridge-core`/`app-lifecycle-core`) 단위 테스트 무회귀; `expo export` 번들 OK.
- **수동 전용 — device-gated**: 콜드스타트 1회 스플래시→인증된 첫 화면(또는 8s 폴백) 종단, 탭/상세 전환에서 재핸드셰이크/재스플래시 부재, 토큰 단일 로드 후 `isSignedIn` 가드 정상(자동 불가 — 토큰/세션 라이브 경로).

---

## M5. 회귀 경계 — OAuth / 초대 / 푸시 라우팅 보존

### AC-U5 ↔ R-U5 (단일 WebView 통과 보존)
- **Given** 기존 OAuth 인터셉트(`useAuthBridge.ts:221-227`), 무효 초대 Alert(`BridgedWebView.tsx:134-145`), 푸시 `?target=chat`→`buildChatUrl`(`home/[id].tsx:23-27`)
- **When** 단일 WebView 안에서 in-WebView Google authorize 네비게이션이 인터셉트된다
- **Then** 단일 WebView 의 `onShouldStartLoadWithRequest` `oauth-intercept` 분기가 네이티브 Google Sign-In 을 실행하고, 세션은 `injectRestore` 로 그 단일 WebView 에 주입된다(데스크톱 웹 OAuth 흐름 무영향).
- **And When** 웹 초대 수락 페이지가 `invite:invalid` 를 통지한다
- **Then** 네이티브 Alert 후 `(tabs)/home`(로그인) 또는 `(auth)/login`(미로그인)으로 라우팅된다(기존 의미 보존).
- **And When** 알림 탭이 chat 을 타깃한다(`?target=chat`)
- **Then** 앱이 `buildChatUrl` 로 chat URL 을 해석하고 단일 WebView 를 그 URL 로 in-WebView 이동시킨다(**새 WebView 마운트 없음**).
- **And Then** 위 세 흐름의 목적지·인증 의미가 회귀 없이 보존된다.
- **자동/계측 검증**: typecheck 0; `decideWebViewLoad`(oauth-intercept/trusted-load/deny/cross-route/detail-push) 순수 분류 단위 테스트 무회귀; `buildChatUrl`/`onInviteInvalid` 분기 단위 테스트 무회귀; 푸시 chat 진입 시 `onLoadStart` 0회 증가(in-WebView 이동 계측); v1 `bridge-protocol` 세션/초대/google 타입 무변경.
- **수동 전용 — device-gated**: 네이티브 Google Sign-In 왕복(OAuth 자격 필요), 무효 초대 Alert→라우팅, 알림 탭→chat 단일 WebView 이동(FCM 실기기 필요 — 자동 불가).

---

## Definition of Done

- [ ] 진입 전제: 일원화 전 동일 환경(웹 dev + 로컬 supabase + 호스트 일관)에서 현재 모델의 기준선(콜드스타트 1회·탭 전환·상세 push·Android back·Google OAuth 왕복·초대·푸시 탭)을 1회 통과시켜 무회귀 기준선을 고정한다. 기준선 미확보 시 흐름 무회귀(AC-U5/AC-U3) 판정 불가.
- [ ] 자동/계측 게이트: `apps/mobile` typecheck 0 / 단일 WebView 인스턴스 정적 검사 + `onLoadStart` 0회-증가 계측(AC-U1/U2/U3/U5) / 핸드셰이크 1회-호출 계측(AC-U4) / 순수 코어 단위 테스트(`route-map-core`/`auth-bridge-core`/`app-lifecycle-core`/네비게이션 채널 분류) 무회귀 / `expo export` 번들 OK.
- [ ] 신규 의존성 0(`react-native-webview` 13.16.1 / `expo-router` 보유만 사용).
- [ ] 웹 변경은 **최소 추가만**(브리지 구동 navigate 진입점 + pathname 보고). 웹 페이지·라우트 트리·디자인·셸 모드 탭바 숨김 계약 무변경(AC-U2).
- [ ] perf 프롭 4종 적용 + 보안 프롭 4종 유지(AC-U1) — 보안 약화 0.
- [ ] OD-1 단일 WebView 비리마운트: `key` 미부여, ref/라우트 상태 셸 소유, 라우트 이동은 in-WebView SPA(hard reload 금지) — 계측(인스턴스 1개) + 수동 전용(세션 연속) 확인.
- [ ] 양방향 동기화: 웹 pathname 단일 진실(OD-4) + 네비게이션 채널 nonce/신뢰 origin 재사용, v1 세션 타입 무변경(AC-U2).
- [ ] back 모델 전환(AC-U3): "(tabs)" in-WebView `goBack()` 소비 + 루트 fall-through — 순수 분기 단위 테스트 + Android back 디바이스 게이트(보류 기록).
- [ ] 단일 핸드셰이크(AC-U4): 콜드스타트 1회 + 스플래시 1회 — 호출 카운터 계측 + 수동 전용 종단.
- [ ] 회귀 경계(AC-U5): OAuth/초대/푸시 목적지·의미 보존 — 순수 분류 무회귀 + device-gated 종단(OAuth 자격·FCM 실기기).
- [ ] 완료 정책: 기준선 고정 → 자동/계측 게이트 통과 후 status draft→in-progress, iOS 시뮬레이터/실기기 종단(AC-U1 세션 연속·AC-U3 Android back·AC-U4 핸드셰이크·AC-U5 OAuth/푸시) 통과 시 completed. Android back AC 는 시뮬레이터 범위 밖이면 게이트 보류로 기록(iOS 시뮬레이터 우선 관행).
