# SPEC-MOBILE-002 — Acceptance Criteria

> 각 AC 는 spec.md 의 EARS 요구사항과 1:1 대응한다(R-xx ↔ AC-xx). 가능한 경우 Given/When/Then.
> 검증 채널 (H-1 명확화): **(1) apps/mobile 자동 vitest** — 순수 로직만(bridge-protocol 직렬화/파싱, origin 매칭, 메시지 인증(nonce/HMAC) 검증, 메시지 핸들러 분기, 페이로드 빌더). **(2) apps/web 빌드+수동** — `apps/web` 에는 테스트 하니스가 없다(package.json scripts 는 dev/build/start/lint 뿐, vitest/jest 0). 따라서 웹 브리지 동작(R-T3 분기, R-T4 가드, R-T8 웹 인증, R-R2 emit)은 **typecheck/`next build` + 수동 종단**으로 검증한다 — "vitest 전량 통과" 는 웹을 포함하지 않는다. **(3) 수동 종단** — 에뮬레이터·디바이스.
>
> 참고: WebViewShell 추출 AC(AC-S1~AC-S5)는 선행 SPEC-WEBVIEW-SHELL-001 로 split 되었다 — 거기서 검증한다.

---

## M1. 네이티브 토큰 캐시 + 진입 라이프사이클

### AC-N1 ↔ R-N1 (expo-secure-store 의존성 — OD-4 역전)
- **Given** `package.json` 에 `expo-secure-store` 부재
- **When** `npx expo install expo-secure-store` 로 SDK 56 bundled 핀을 추가한다
- **Then** `expo-secure-store` 가 dependency 로 선언되고 버전이 SDK 56 핀과 일치한다.
- 자동 검증: `package.json` dependencies 에 `expo-secure-store` AND `expo-splash-screen` 둘 다 존재(R-N1/DoD 와 일치).

### AC-N2 ↔ R-N2 (token-store 모듈 + refresh 저장 정책 + accessibility)
- **Given** 토큰 캐시 필요
- **When** `lib/auth/token-store.ts` 를 만든다
- **Then** `loadTokens()`/`saveTokens({access,refresh})`/`clearTokens()` 를 `expo-secure-store` 로 구현하고, refresh 토큰은 SecureStore 에만 저장한다(AsyncStorage/plaintext 금지).
- **그리고(보안 — M-1)** 모든 `setItemAsync` 호출이 명시적 `keychainAccessible` accessibility 옵션을 안전값(예: `WHEN_UNLOCKED`/`AFTER_FIRST_UNLOCK`, 권장 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`)으로 전달하며 SDK 기본값에 의존하지 않고 `ALWAYS` 를 쓰지 않는다.
- 자동 검증: 세 함수 export, SecureStore 사용; `setItemAsync` 호출에 안전 `keychainAccessible` 옵션 전달(예: `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) 확인 + `ALWAYS` 부재; **Unwanted**: 코드 내 `AsyncStorage`/plaintext 토큰 저장 부재.

### AC-N3 ↔ R-N3 (콜드스타트 — 스플래시 + 토큰 로드 + WEB_URL)
- **Given** 앱이 콜드스타트한다
- **When** 진입 라이프사이클이 실행된다
- **Then** 스플래시를 표시하고, SecureStore 에서 마지막 `{access,refresh}` 를 로드하며, WebView 에 `WEB_URL` 루트를 로드한다.
- 검증: 수동(AC-V3) + 자동(라이프사이클 훅 로직 단위 테스트 가능 부분).

### AC-N4 ↔ R-N4 (핸드셰이크 결과 시 스플래시 숨김)
- **Given** 콜드스타트 핸드셰이크 진행 중(스플래시 표시)
- **When** 콜드스타트 핸드셰이크 결과(`session:synced` 또는 `session:none` — 콜드스타트의 유효 결과는 이 둘뿐, `session:cleared` 는 로그아웃 그룹 R-R2 이므로 제외 — M-1)를 수신한다
- **Then** 스플래시를 숨긴다(웹 `/login` redirect 플래시가 스플래시에 가려진다).
- 검증: 수동(AC-V3a/b — 플래시 미노출 확인); apps/mobile 자동(synced/none 분기 핸들러 단위 테스트, cleared 는 콜드스타트 트리거 아님 확인).

### AC-N5 ↔ R-N5 (미인증 콜드스타트 — State-Driven)
- **Given** 콜드스타트 시 보유 토큰 없음
- **When** WebView 가 `WEB_URL` 루트를 로드한다
- **Then** 기존 웹 가드(`me/page.tsx` `getSession()`(L19-21) empty → `redirect("/login")`(L23-24))가 `/login` 으로 라우팅하고, 스플래시가 그 플래시를 가린다(네이티브가 별도 라우팅하지 않음).
- 검증: 수동(AC-V3b).

### AC-N6 ↔ R-N6 (콜드스타트 타임아웃 → 스플래시 강제 해제)
- **Given** 콜드스타트 핸드셰이크가 시작되었으나 결과(`session:synced`/`session:none`)가 도착하지 않음(웹 미응답/핸들러 미등록/네트워크 단절)
- **When** bounded 타임아웃이 경과한다
- **Then** 스플래시를 강제로 숨기고 기존 웹 가드 라우팅으로 폴백한다(무한 스플래시 금지). 선택적으로 복구 가능 에러 상태(MOBILE-001 R-U4 재시도 오버레이)로 폴백할 수 있다.
- 검증: apps/mobile 자동(타임아웃 타이머 → 스플래시 hide 콜백 호출 단위 테스트, 주입 가능한 타이머/클록) + 수동(웹 미기동 상태로 콜드스타트 → 스플래시가 일정 시간 후 해제됨 확인).

---

## M2. 토큰 동기화 브리지 (버전드 양방향)

### AC-T1 ↔ R-T1 (버전드/확장 가능 스키마, type 집합 닫힘)
- **Given** Native↔Web 통신 필요
- **When** `lib/auth/bridge-protocol.ts`(+웹 브리지 모듈)에 스키마를 정의한다
- **Then** `{ version, type, ... }` 형태로 type 집합이 최소 `session:restore`/`session:synced`/`session:none`/`session:cleared`/`resume:revalidate` 5종을 **포함**하고(M-3: enum/const 로 고정해 오타를 컴파일 타임에 차단), 직렬화/파싱이 알려진 type 을 정확히 round-trip 하며, unknown type 은 안전히 무시(throw 없음)한다. payload 는 access/refresh 토큰만 담으며(프로필/`userId` 미포함), 신규 필드 추가가 additive(기존 필드 비파괴)이다.
- **그리고** `userId` 는 의도적으로 브리지에 싣지 않는다 — 네이티브가 사용자 식별자가 필요하면 access token 의 JWT `sub` 를 디코드한다(PII 최소화, OD-4).
- 자동 검증(apps/mobile vitest): type 상수 enum/const export(≥5 포함), 알려진 type round-trip 정확성, unknown type 무시(throw 없음), payload 타입에 `userId`/프로필 필드 부재.

### AC-T2 ↔ R-T2 (콜드스타트 토큰 주입)
- **Given** WebView 가 신뢰 `WEB_URL` origin 로드 완료
- **When** 콜드스타트 핸드셰이크가 시작된다
- **Then** 네이티브가 저장 `{access,refresh}` 를 `session:restore` 로 주입한다(`injectedJavaScript`/`postMessage`).
- 검증: 수동(AC-V3a) + 자동(주입 페이로드 빌더 순수 함수 vitest).

### AC-T3 ↔ R-T3 (웹 setSession 검증/갱신 → 회신/리다이렉트 + 회신 메커니즘)
- **Given** 웹 브리지가 `session:restore` 수신
- **When** browser 클라이언트(`lib/supabase/client.ts` — 신규 wiring, 현재 미사용)로 `supabase.auth.setSession({access_token,refresh_token})` 를 호출한다
- **Then** valid/refreshed → **`setSession()` 리턴값(`data.session`)에서 갱신 토큰을 읽어**(또는 `onAuthStateChange` — OD-9) 최신 `{access,refresh}`(토큰만, `userId` 미포함)를 `session:synced` 로 네이티브에 회신하고 main surface 로 라우팅; empty/expired refresh → `session:none` 회신 + 기존 웹 가드가 `/login` 으로 redirect.
- **그리고(권위 — M-5)** 유효성 권위는 `setSession()` 갱신 성공(및 백엔드 JWKS 가드)이며 `me/page.tsx` `getSession()` 은 서명 미검증 쿠키 가드일 뿐이다.
- **그리고(예외 폴백 — B-2)** `setSession()` 이 네트워크 오류/런타임 예외로 throw(valid 도 empty 도 아님)하면, 웹이 `session:none`(throw 결과를 `session:none` 으로 통합 — 별도 type 미도입, R-T1 의 보장 5 type 유지)를 post 해 네이티브가 스플래시를 해제하고 로그인 라우트로 폴백한다 — 핸드셰이크가 미해결로 남지 않는다(R-N6 타임아웃과 함께 작동).
- 검증: **apps/web 빌드(typecheck/`next build`) + 수동 종단**(AC-V3a/b — 자동 vitest 불가, apps/web 무 하니스 H-1); 회신 payload 에 `userId`/프로필 부재(AC-T1 일관); setSession throw 모사(supabase 중단 상태 콜드스타트 → 무한 스플래시 없이 `/login` 도달).

### AC-T4 ↔ R-T4 (웹 브리지 가드 — 순수 웹 무영향, Unwanted)
- **Given** 웹이 일반 브라우저(네이티브 없음)에서 로드됨
- **When** 브리지 emit/handler 경로에 도달한다
- **Then** `if (window.ReactNativeWebView)` 가드로 모든 브리지 동작이 no-op 이 되어 순수 웹 앱이 동일하게 동작한다(네이티브 의존성 누수 없음).
- 검증(H-1 — apps/web 무 하니스): 코드 리뷰 + typecheck/`next build` 로 `window.ReactNativeWebView` presence 가드 존재 확인 + **수동**(일반 브라우저로 웹 로드 시 콘솔 에러·동작 변화 없음). 가드 false 분기 자동 단위 테스트는 웹 러너 부재로 불가 — 수동/리뷰로 대체.

### AC-T5 ↔ R-T5 (네이티브 session:synced 수신 → SecureStore 갱신)
- **Given** 네이티브 `onMessage` 가 `session:synced` 수신
- **When** 메시지를 처리한다
- **Then** SecureStore 를 최신 `{access,refresh}` 로 갱신하고, 라우팅은 웹이 소유한다(네이티브가 라우트 변경용 reload 를 하지 않음).
- 검증: 수동(AC-V3c) + 자동(메시지 핸들러 분기 vitest).

### AC-T6 ↔ R-T6 (origin allowlist + 비로깅, Unwanted)
- **Given** WebView 가 신뢰 `WEB_URL` 이 아닌 페이지에 있음
- **When** 토큰 주입 시점이 도래한다(콜드스타트 R-T2 **또는** resume R-R1)
- **Then** 네이티브가 토큰을 주입하지 않으며, 토큰 값을 로깅하지 않고, injected JS 가 토큰 raw 보간 대신 `postMessage` 채널을 사용한다.
- **그리고(M-4)** 허용 origin 집합은 `EXPO_PUBLIC_WEB_URL` 호스트에서 파생되며 OD-7 호스트 결정과 일관된다(localhost 일관 셋업 권장).
- 자동 검증(apps/mobile vitest): origin 매칭 순수 함수(허용/거부 케이스) — **콜드스타트 경로와 resume 경로 모두**에 동일 함수 적용(H-3); 코드에 토큰 console 로깅 부재. 종단 origin 일관성은 AC-V3 에서 실제 에뮬레이터 호스트로 확인.

### AC-T7 ↔ R-T7 (브리지 핸들러 미등록 race → 메시지 미유실, Unwanted)
- **Given** 네이티브가 `session:restore` 를 주입하는 시점에 웹 브리지 핸들러가 아직 등록되지 않음(`onLoadEnd`↔handler 등록 순서 race)
- **When** 첫 주입이 핸들러에 도달하지 못한다
- **Then** 네이티브가 bounded 재시도로 재주입하거나, 웹이 메시지를 버퍼링했다가 핸들러 등록 시 ack 한다 — `session:restore` 가 silent 하게 유실되지 않는다(B-2).
- 검증: apps/mobile 자동(bounded 재시도 카운터/스케줄러 단위 테스트 — 주입 가능한 타이머) + 수동(느린 웹 로드에서 핸드셰이크가 결국 성립). 무한 미응답은 R-N6 타임아웃이 종료.

### AC-T8 ↔ R-T8 (메시지 인증 + specific targetOrigin — 보안 C-1/H-1)
- **Given** 토큰을 나르는 브리지 메시지(`session:restore` 등)와, 동일 page 에 임의 스크립트(서드파티/XSS)가 있을 수 있는 위협
- **When** 네이티브가 토큰을 주입하고, 웹이 인바운드 메시지를 처리한다
- **Then** (a) 네이티브 주입 `postMessage` 의 `targetOrigin` 은 신뢰 `EXPO_PUBLIC_WEB_URL` origin literal 이다(`"*"` 아님 — `"*"` 사용 부재). (b) 웹 브리지는 토큰 메시지를 처리하기 전 `event.origin === 신뢰 WEB_URL origin` 검증 AND per-session nonce/HMAC(OD-11) 검증을 통과한 메시지만 처리하고, foreign-origin 또는 미인증(스키마는 맞으나 nonce/HMAC 불일치) `session:restore` 는 거부한다(setSession 미호출). (c) 네이티브도 인증 가능한(동일 nonce/HMAC) 인바운드 메시지만 수신한다.
- 자동 검증: **apps/mobile vitest** — 주입 빌더가 신뢰 origin literal targetOrigin 을 생성(`"*"` 미사용), nonce/HMAC 검증 순수 함수가 정상(일치) accept / 위조(불일치)·foreign-origin reject. **apps/web 빌드+수동** — 웹 핸들러의 origin+nonce 게이트(러너 부재로 리뷰/`next build`); 회귀 수동: 위조 `session:restore`(임의 origin/nonce 없음)가 setSession 을 호출하지 않음(AC-V3h).

### AC-T9 ↔ R-T9 (WebView origin 잠금 + live-origin 재검증 — 보안 C-2)
- **Given** WebView 가 링크/리다이렉트로 비신뢰 origin 으로 갈 수 있는 위협(originWhitelist 기본값 = 모든 http/https)
- **When** WebView 가 네비게이트하고, 주입 시점이 도래한다
- **Then** (a) `WebViewShell` 의 `originWhitelist` 가 신뢰 origin 으로 제한된다(기본 `["http://*","https://*"]` 아님). (b) `onShouldStartLoadWithRequest` 가 비신뢰 top-level origin 의 in-WebView 로드를 거부하고 외부 브라우저(`Linking.openURL`)로 위임하되, 기존 OAuth authorize→system-browser 인터셉트는 보존한다. (c) 토큰 주입(콜드스타트 R-T2 AND resume R-R1)은 stale 캐시 URL 이 아니라 **주입 순간의 LIVE 현재 origin** 을 재검증한다(TOCTOU 차단).
- 자동 검증: **apps/mobile vitest** — origin 게이트 순수 함수가 신뢰 accept / 비신뢰(서브도메인/포트/scheme 불일치 포함) reject, OAuth authorize URL 은 인터셉트 분기 보존; live-origin 재검증 함수가 주입 시점 origin 을 인자로 받아 판정(stale ref 미사용). `WebViewShell` props 에 `originWhitelist` 설정 존재(typecheck). 종단은 AC-V3h.

---

## M3. Resume 재검증 + 로그아웃 클리어

### AC-R1 ↔ R-R1 (AppState active → resume 재검증, origin 선통과)
- **Given** 앱이 백그라운드에서 복귀(`AppState` → `active`)하고 토큰 보유
- **When** resume 라이프사이클이 실행된다
- **Then** 네이티브가 **먼저 R-T6 origin allowlist 를 통과**(현재 WebView origin 이 신뢰 `WEB_URL` 이 아니면 주입 금지 — 사용자가 third-party 페이지로 네비게이트한 상태일 수 있음, H-3)한 뒤, 저장 토큰 + `resume:revalidate` 를 주입해 웹이 silent refresh 후 `session:synced` 를 post 하고, 네이티브가 SecureStore 를 갱신한다(웹이 라우팅 소유, 네이티브 reload 없음).
- **그리고(중복 억제 — B-2)** `AppState` 가 OS/포커스에 따라 `active` 를 연속/중복 발화하면, debounce / 직전 상태 비교로 중복 `active` 전이를 억제해 토큰 중복 주입·refresh 경합을 막는다.
- 검증: 수동(AC-V3d) + apps/mobile 자동(AppState 핸들러 분기 + origin 거부 시 미주입 + 연속 active→주입/재검증 1회만 트리거 debounce 단위 테스트, 주입 가능한 타이머).

### AC-R2 ↔ R-R2 (로그아웃 시 session:cleared post — emit 지점 + 종단)
- **Given** 웹에서 로그아웃 발생. `signOutAction` 은 Server Action 이고 `signOut()` 직후 server `redirect("/login")`(actions.ts:69-73) — client JS 실행 기회 없음
- **When** 로그아웃이 트리거된다
- **Then** 웹이 server redirect 와 경합하지 않는 client 지점에서 `session:cleared` 를 1회 post 한다(`window.ReactNativeWebView` 가드): `/login` 도착 후 client mount, 또는 `/me` 로그아웃 버튼 client handler 에서 `signOut` 전 — Server Action 본문 안에 두지 않는다(OD-10/H-2).
- **그리고(종단 — H-2)** 네이티브 `onMessage` 가 `session:cleared` 를 수신하고 `clearTokens()` 가 실행되어 SecureStore 가 비워진다(emit 유실 없음 — stale 토큰 잔존 방지).
- 검증: 코드 리뷰 + typecheck/`next build`(가드된 emit 이 Server Action 밖 client 경로에 존재, apps/web 무 하니스 H-1) + 수동 종단(AC-V3e — emit→수신→clear 체인 확인).

### AC-R3 ↔ R-R3 (네이티브 session:cleared → clearTokens)
- **Given** 네이티브가 `session:cleared` 수신
- **When** 메시지를 처리한다
- **Then** SecureStore 토큰을 `clearTokens()` 로 제거한다.
- 검증: 수동(AC-V3e) + 자동(메시지 핸들러 분기 vitest).

### AC-R4 ↔ R-R4 (로그아웃 신뢰성 + session:none 시 clear + 로그아웃 쿠키 clear — 보안 H-2/M-3/cookie resurrection)
- **Given** 로그아웃 `session:cleared` emit 이 유실될 수 있고(앱 종료/origin 이탈/경합), refresh 가 만료되면 웹이 `session:none` 을 회신하며, 디바이스 검증에서 측정된 바 **WebView 쿠키(`sb-*` auth)** 삭제가 앱 영속 저장소(`binarycookies`)에 영속되지 않을 수 있는 상황
- **When** (a) 네이티브가 `session:none` 을 수신하거나, (b) 단일 `session:cleared` emit 이 유실되거나, (c) 네이티브가 `session:cleared`(명시 로그아웃)를 수신한다
- **Then** (a) `session:none` 수신 시 네이티브가 **`clearTokens()` 도 수행**한다(저장 스킵에 그치지 않음 — M-3: inbound `none` 액션이 clear). (b) 단일 emit 유실이 지속 접근을 주지 않는다 — ack/retry 로 신뢰 전달하거나, 다음 cold-start 의 `session:none`→clear(a)가 멱등 재clear 로 stale refresh 잔존을 제거한다. **(c) `session:cleared` 수신 시 `clearTokens()` 에 더해 신뢰 `WEB_URL` origin 의 WebView 쿠키도 제거**(WKWebView store + `NSHTTPCookieStorage`)한다. 이 쿠키 clear 는 `session:cleared` 에만 적용하고 `session:none` 에는 적용하지 않는다(R-T3 network-throw 폴백에서 유효 쿠키 세션 파괴 방지 — 웹이 그 경로의 세션 권위).
- 자동 검증: apps/mobile 자동(`decideInboundAction`/핸들러 분기에서 `none`→clear / `cleared`→clearTokens+cookie-clear / `synced`→쿠키 clear 미발생 의 **결정 순수 로직** 단위 테스트 — 쿠키 clear 가 `cleared` 에서만 트리거됨을 확인; ack/retry 멱등성 단위 테스트).
- 디바이스 검증 proof(수동/스크립트 탭): 로그아웃(`session:cleared`) 후 **앱 영속 쿠키 저장소에 `sb-*` auth 쿠키가 더 이상 존재하지 않고**, 콜드 재시작이 `/login` 으로 도달(세션 부활 없음) — AC-V3i 와 동일 시나리오의 종단 증거.

---

## M4. 보존 + 검증

### AC-V1 ↔ R-V1 (기존 OAuth/이메일 보존 — 무회귀)
- **Given** SPEC-MOBILE-001 의 Google 시스템 브라우저 OAuth 브리지 + WebView 내 이메일/비번 로그인 (선행 SPEC-WEBVIEW-SHELL-001 추출 이후 상태)
- **When** 본 SPEC 의 M1~M3 변경을 적용한다
- **Then** 두 로그인 경로 모두 회귀 없이 동작하고 `oauth.ts`/`oauth-bridge.ts` 흐름이 재구현/삭제되지 않는다.
- 검증: 자동(기존 `oauth-bridge` vitest 전량 통과) + 수동(AC-V3c — Google 로그인).

### AC-V2 ↔ R-V2 (보안 제약 + expert-security 리뷰 closure)
- **Given** 토큰이 JS 브리지를 가로지름
- **When** 설계/구현을 검토한다
- **Then** refresh 토큰 SecureStore 전용 + 안전 accessibility(AC-N2) + 네이티브 origin allowlist(AC-T6) + **웹 인바운드 메시지 인증·specific targetOrigin(AC-T8) + WebView origin 잠금·live-origin 재검증(AC-T9) + 로그아웃 신뢰성·`session:none`→clear·로그아웃 WebView 쿠키 clear(AC-R4 a/b/c)** + 토큰 비로깅 + prod 웹 origin HTTPS(dev localhost 예외)가 강제된다.
- 검증: 설계 리뷰 체크리스트 + security-review.md 의 CRITICAL/HIGH(C-1/C-2/H-1/H-2) 가 R-T8/R-T9/R-R4 로 닫힘 + Run phase expert-security 재리뷰로 closure 확인(OD-5).

### AC-V3 ↔ R-V3 (수동 디바이스 종단 — 핸드셰이크)
- **Given** 에뮬레이터/디바이스에서 셸 실행
- **When** 사람이 다음 시나리오를 수행한다
- **Then** 모두 통과:
  - **(a)** 유효 저장 세션 콜드스타트 → `/login` 노출 없이 main surface 도달(스플래시가 플래시 가림).
  - **(b)** 무/만료 세션 콜드스타트 → `/login` 도달(스플래시가 플래시 가림).
  - **(c)** 로그인(Google + 이메일) → 웹이 토큰 post → 네이티브가 SecureStore 에 영속.
  - **(d)** 토큰 만료 후 resume → silent refresh → SecureStore 갱신.
  - **(e)** 로그아웃 → SecureStore 클리어(AC-R2 종단 — emit→네이티브 수신→clearTokens).
  - **(f)** origin allowlist(M-4)가 실제 에뮬레이터 호스트(`EXPO_PUBLIC_WEB_URL` 파생)를 종단에서 통과 — 토큰 주입이 거부되지 않고 핸드셰이크 성립(OD-7 일관 셋업).
  - **(g)** 웹 미기동/중단 상태로 콜드스타트 → 무한 스플래시 없이 타임아웃 후 폴백(R-N6/AC-N6 종단).
  - **(h)** (보안 C-1/C-2/H-1, AC-T8/AC-T9) 위조 `session:restore`(임의 origin/nonce 없음)가 setSession 을 호출하지 않음; 비신뢰 origin 으로 네비게이트 시 WebView 내 로드 거부(외부 브라우저 위임); evil origin 에서 injectJavaScript 가 토큰을 전달하지 않음(specific targetOrigin).
  - **(i)** (보안 H-2/M-3/cookie resurrection, AC-R4) 로그아웃(`session:cleared`) 후 앱 영속 쿠키 저장소(`binarycookies`)에 `sb-*` auth 쿠키 부재 + 콜드 재시작이 `/login` 도달(세션 부활 없음) — 디바이스 검증에서 측정된 쿠키 삭제 미영속 갭을 R-R4(c) 네이티브 쿠키 clear 로 차단; emit 강제 유실 모사 시에도 `session:none`→clear(a) 가 백업.
  - 위 전 과정에서 SPEC-MOBILE-001 의 WebView/OAuth 동작 무회귀.
- 검증: 수동(OD-7 호스트 일관성). iOS 종단은 macOS+Xcode 환경 의존 — **MOBILE-001 의 OD-6(iOS macOS+Xcode 환경 의존)을 상속**(본 SPEC 의 OD-6 은 버전드 스키마이므로 구분 — L-2).

---

## Definition of Done

- [ ] 진입 전제(H-4): (1) SPEC-WEBVIEW-SHELL-001 완료(`WebViewShell`/`useAppLifecycle`/`useAuthBridge`/오버레이 추출) — 본 SPEC 은 그 결과를 확장한다. (2) **MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline 을 동일 환경(웹 dev + 로컬 supabase + 호스트 일관)에서 통과** — AC-V1 무회귀 기준선 고정.
- [ ] 의존성: `expo-secure-store` AND `expo-splash-screen` 둘 다 `npx expo install` 핀으로 선언(AC-N1, M-2).
- [ ] **apps/mobile 자동 게이트**: typecheck 0 / vitest(기존 `oauth-bridge` + 신규 순수 로직: bridge-protocol 직렬화·파싱·type round-trip·unknown 무시, origin 매칭(콜드스타트+resume), **메시지 인증(nonce/HMAC) accept/reject, specific targetOrigin 빌더(`"*"` 미사용), live-origin 재검증, `session:none`→clear/멱등**, 콜백/페이로드 빌더, 메시지 핸들러 분기, 타임아웃/재시도/debounce 타이머) 전량 통과 / `expo export` 번들 OK. **이 "vitest 전량 통과" 는 apps/web 을 포함하지 않는다**(H-1).
- [ ] **apps/web 게이트(H-1 — 무 테스트 하니스)**: typecheck/`next build` 통과 + 수동 종단. 웹 브리지 동작(R-T3 분기·R-T4 가드·R-T8 origin+nonce 인증·R-R2 emit)은 자동 vitest 불가 — 빌드+수동으로 검증.
- [ ] `apps/web` 변경은 `window.ReactNativeWebView` 가드된 브리지 한 곳으로 제한, 순수 웹 동작 무영향(AC-T4) — 신규 라우트/server action 0(단 browser `client.ts` setSession 호출은 신규 client-side wiring, B-1).
- [ ] 실패/경합/타임아웃 계약(B-2): 콜드스타트 타임아웃→스플래시 해제(AC-N6), 핸들러 미등록→메시지 미유실(AC-T7), setSession throw→로그인 폴백(AC-T3 예외 분기), resume debounce 중복 억제(AC-R1 중복 분기) 모두 충족.
- [ ] resume origin 재검증(H-3): resume 재주입이 R-T6 origin allowlist 를 선통과(AC-R1/AC-T6).
- [ ] 로그아웃 emit 종단(H-2): server redirect 와 경합하지 않는 client 지점 emit → 네이티브 `clearTokens()`(AC-R2 emit+종단 분기/OD-10).
- [ ] **보안 게이트(security-review.md C-1/C-2/H-1/H-2/M-1/M-3 + device-verif cookie resurrection closure)**: 웹 메시지 인증(origin + nonce/HMAC) + specific targetOrigin(`"*"` 부재)(AC-T8), WebView origin 잠금 + live-origin 재검증(AC-T9), `session:none`→clear + 로그아웃 신뢰 전달 + **로그아웃 시 WebView 쿠키 clear(R-R4 c — 쿠키 부활 차단)**(AC-R4), SecureStore 안전 accessibility(AC-N2) 모두 충족. Run phase 에서 expert-security 재리뷰로 closure 확인(OD-5/OD-11).
- [ ] forward-compat 가드레일: 본 SPEC 은 가드레일 2(버전드 스키마, AC-T1)·3(웹 브리지 가드, AC-T4)을 충족한다. 가드레일 1(훅 분리)·4(generic WebViewShell)은 선행 SPEC-WEBVIEW-SHELL-001 이 충족(여기서 재주장하지 않음).
- [ ] 브리지 PII 최소화: payload 에 `userId`/프로필 부재, 필요 시 access token JWT `sub` 디코드(AC-T1/AC-T3, OD-4).
- [ ] 보안 제약(AC-V2) 충족 + Run phase expert-security 재리뷰 closure 기록.
- [ ] 수동 종단(AC-V3 a~i) 통과 — 디바이스 검증 전까지 status=in-progress 유지(MOBILE-001 패턴).
- [ ] OD-1(웹 세션 권위)이 revisitable Open Decision 으로 기록됨(마이그레이션 경로 1줄 포함). 유효성 권위는 setSession 갱신+백엔드 JWKS, getSession 은 쿠키 가드(M-5).
