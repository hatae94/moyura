# SPEC-MOBILE-001 — 인수 기준 (acceptance.md)

> EARS 요구사항과 1:1 대응(R-* ↔ AC-*). Given/When/Then 시나리오 + 엣지 케이스 + Quality Gate.

## Acceptance Criteria (Given / When / Then)

### AC-S2 (R-S2) — 풀스크린 셸이 웹을 로드
- **Given** `EXPO_PUBLIC_WEB_URL` 이 도달 가능한 웹 호스트로 설정된 상태에서 앱을 실행하면
- **When** 셸이 부팅되면
- **Then** 단일 `WebView` 가 그 URL 을 풀스크린으로 로드하고, Expo 기본 템플릿 텍스트("Open up App.tsx...")는 더 이상 보이지 않는다.

### AC-W2 (R-W2) — env 미설정 시 부팅 실패
- **Given** `EXPO_PUBLIC_WEB_URL` 이 미설정(또는 공백)인 상태에서
- **When** 앱이 부팅 경로에서 `resolveWebUrl` 을 평가하면
- **Then** 설명 메시지와 함께 throw 한다(silent 하게 `undefined` 호스트로 로드하지 않는다 — R-W2/R-E4 식).

### AC-U1 (R-U1) — Android 하드웨어 백
- **Given** Android 에서 WebView 가 한 페이지 이상 네비게이트해 히스토리가 있는 상태에서
- **When** 사용자가 하드웨어 백 버튼을 누르면
- **Then** 셸이 `WebView.goBack()` 을 호출해 이전 웹 페이지로 돌아간다(앱이 종료되지 않는다).
- **And** 히스토리가 없으면 기본 종료 동작을 허용한다.

### AC-U4 (R-U4) — 로드 실패 복구
- **Given** 웹 호스트가 도달 불가능한 상태에서
- **When** WebView 로드가 실패하면
- **Then** 셸이 복구 가능한 에러/오프라인 상태(재시도 제공)를 표시한다 — 빈 화면이나 크래시가 아니다.

### AC-O1 (R-O1) — Google OAuth 인터셉트 → 임베디드 차단
- **Given** WebView 안의 웹 로그인 화면에서
- **When** 사용자가 "Google로 계속하기" 를 눌러 provider authorize URL 로의 네비게이션이 발생하면
- **Then** 셸이 `onShouldStartLoadWithRequest` 에서 그 네비게이션에 `false` 를 반환해 임베디드 WebView 로드를 차단하고, `authorizeUrl` 을 네이티브로 추출한다(Google 의 임베디드 OAuth 차단 회피 — R-E2). (oauth.ts R-F3 의 연기된 authorizeUrl 산출이 Google 한정 완성됨.)

### AC-O3 (R-O2 + R-O3) — 시스템 브라우저 → deep-link → WebView 콜백 → 세션
- **Given** 네이티브가 `authorizeUrl` 을 받은 상태에서
- **When** `launchSocialOAuth(authorizeUrl)` 가 시스템 브라우저를 열고 사용자가 Google 동의를 완료해 `moyura://auth-callback` 로 복귀하면(`{kind:"authenticated"}`)
- **Then** 셸이 WebView 를 웹 콜백 URL(`?code=`)로 네비게이트하고, `@supabase/ssr` 가 코드를 교환해 WebView 쿠키 저장소에 세션 쿠키를 설정하며, `/me` 가 WebView 에 렌더된다.

### AC-O4 (R-O4) — 취소/에러 복구
- **Given** OAuth 진행 중
- **When** 사용자가 시스템 브라우저를 닫거나(`{kind:"cancelled"}`) redirect 불일치 등 오류가 발생하면(`{kind:"error"}`)
- **Then** 사용자는 미인증 상태로 남고, 앱은 크래시하지 않으며, WebView 는 로그인 surface 에 머문다(R-E4).

### AC-P1 (R-P1) — 이메일/비번은 브리지 없이 동작
- **Given** WebView 안의 이메일 폼에서
- **When** 사용자가 유효한 이메일/비밀번호로 로그인하면
- **Then** WebView 내부에서 쿠키 세션이 확립되고 `/me` 로 이동한다 — 시스템 브라우저/네이티브 브리지를 거치지 않는다.

## Edge Cases

- **EC-1 (Android 에뮬레이터 호스트 매핑, OD-2)**: 에뮬레이터에서 `localhost` 는 호스트 머신이 아님. `EXPO_PUBLIC_WEB_URL=http://10.0.2.2:3000` 또는 `adb reverse tcp:3000`+`localhost`. GoTrue/Google redirect 허용목록과의 일관성 검증 필요(`localhost` ≠ `10.0.2.2` ≠ `127.0.0.1`).
- **EC-2 (쿠키 origin 호스트 바인딩, OD-3/R-O6)**: 앱 로드 호스트와 OAuth 콜백 호스트가 다르면(`localhost` vs `127.0.0.1`) 쿠키 미설정(half-auth). live source-of-truth = `localhost`.
- **EC-3 (쿠키 영속성, OD-4/R-O5)**: 앱 재시작 후에도 세션 유지(`sharedCookiesEnabled`/`thirdPartyCookiesEnabled`). 시스템 브라우저와 WebView 의 별도 쿠키 저장소 — 세션 쿠키는 WebView 가 웹 콜백 로드 시점에 설정.
- **EC-4 (deep-link 미복귀, OD-5)**: 시스템 브라우저가 `moyura://auth-callback` 로 복귀하지 못하면 멈춤 — `launchSocialOAuth` 의 `cancelled`/`error` 분류로 복구.
- **EC-5 (인터셉트 패턴 폭, OD-1)**: `onShouldStartLoadWithRequest` 매칭이 너무 넓으면 정상 네비게이션까지 차단, 너무 좁으면 OAuth 미인터셉트.

## Quality Gate

### 자동화 가능 (CI / 로컬 명령)
- **Typecheck**: `tsc --noEmit`(apps/mobile, `react-native-webview` 타입 포함) — 에러 0.
- **Lint**: 프로젝트 린터(oxlint/eslint) — 신규/수정 파일 경고 0.
- **Build/Bundle**: Expo 번들이 `react-native-webview` 포함해 성공(metro bundle / `expo export` smoke).
- **단위 테스트(순수 함수)**: `resolveWebUrl(value)` — (1) 정상값 trim 반환, (2) `undefined` throw, (3) 공백 throw. `oauth.ts` `buildReturnUrl()` = `moyura://auth-callback` (기존, 회귀 확인). 인터셉트 URL 판별 헬퍼(있다면) — Google authorize 호스트 매칭 true/false.

### 수동 검증 (에뮬레이터 / 디바이스 — 자동화 불가)
- **셸 풀스크린(R-S2)**: 웹이 WebView 풀스크린으로 로드, safe-area 정상.
- **로그인 화면 풀스크린 렌더(R-P2)**: SPEC-LOGIN-UI-001 의 `size-full` 로그인 화면이 RN WebView 안에서 풀스크린 렌더 → **SPEC-LOGIN-UI-001 OD-5 / AC-H1 닫음**.
- **Google 종단(R-O1~R-O3)**: WebView 로그인 → "Google로 계속하기" → 시스템 브라우저 동의 → `moyura://auth-callback` 복귀 → WebView 콜백 로드 → 세션 → `/me` 표시.
- **취소/에러(R-O4)**: 시스템 브라우저 취소 시 미인증 유지·크래시 없음.
- **이메일/비번(R-P1)**: 브리지 없이 WebView 안에서 로그인 성공.
- **Android 백/로딩/에러(R-U1/U3/U4)**: 하드웨어 백 동작, 로딩 인디케이터, 오프라인 에러 표시.
- **iOS 주의(OD-6)**: iOS 시뮬레이터/디바이스 검증은 **macOS + Xcode 필요**. Mac 부재 시 Android 만으로 종단 증명.

### Definition of Done
- [ ] M1~M3 의 모든 자동화 Quality Gate 통과(typecheck/lint/build/단위 테스트).
- [ ] `react-native-webview` `13.16.1` 핀이 `package.json` 에 반영.
- [ ] `web-url.ts` env 가드 + 환경별 호스트 매핑 문서화.
- [ ] R-P2 수동 종단 1회 이상 통과(최소 Android) — SPEC-LOGIN-UI-001 OD-5/AC-H1 닫음 기록.
- [ ] OD-2(에뮬레이터 호스트 ↔ OAuth 허용목록) 실측 결과를 spec.md OD-2 에 확정 기록.
- [ ] 신규 웹 server action/세션/콜백 코드 0(Non-Goal 준수) — 웹 변경은 (선택) 브리지 훅으로 한정.
