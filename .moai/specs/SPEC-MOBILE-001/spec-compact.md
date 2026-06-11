# SPEC-MOBILE-001 (compact)

RN WebView 셸 + Google 소셜 OAuth 브리지. `apps/mobile`(Expo ~56) 이 `apps/web` 을 풀스크린 WebView 로 호스팅(웹 = 단일 UI surface, 세션 = 웹 쿠키 소유, 네이티브 토큰 미보관). Google OAuth 는 시스템 브라우저로 브리지(Google 임베디드 WebView OAuth 차단), `moyura://auth-callback` 복귀 후 WebView 가 웹 콜백 로드해 세션 확립. `oauth.ts` R-F3(authorizeUrl 산출) Google 한정 완성 + SPEC-LOGIN-UI-001 OD-5 닫음.

## REQ (EARS)

- **R-S1**: `package.json` 에 `react-native-webview@13.16.1`(Expo 56 pin) 선언.
- **R-S2**: 셸이 단일 풀스크린 `WebView`(source=resolved web URL)를 렌더, 기본 템플릿 교체.
- **R-S3**: 진입 `App.tsx`(`main: index.ts`)·scheme `moyura` 유지(변경 없음).
- **R-W1**: `lib/web-url.ts` `resolveWebUrl(value)` 순수 가드(`lib/env.ts` 패턴, 리터럴 키 `process.env.EXPO_PUBLIC_WEB_URL`).
- **R-W2**: IF `EXPO_PUBLIC_WEB_URL` 미설정/공백 THEN 부팅 시 throw(silent undefined 금지).
- **R-W3**: 환경별 호스트 — Android emulator `10.0.2.2:3000` / iOS sim `localhost:3000` / 실기기 LAN IP / prod 연기(env-driven).
- **R-U1**: WHEN Android 백 + 히스토리 존재 THEN `WebView.goBack()`, 없으면 기본 종료.
- **R-U2**: `SafeAreaView` 호스팅.
- **R-U3**: WHILE 로딩 THEN 로딩 인디케이터.
- **R-U4**: IF 로드 실패 THEN 복구 가능 에러/오프라인(재시도) — 빈 화면/크래시 금지.
- **R-O1**: WHEN 웹 로그인이 Google OAuth 개시(authorize URL 네비게이션 or postMessage) THEN 네이티브가 `authorizeUrl` 인수, 임베디드 WebView 직접 로드 금지(R-E2). → oauth.ts R-F3 Google 완성.
- **R-O2**: WHEN 네이티브가 `authorizeUrl` 수령 THEN `launchSocialOAuth`(시스템 브라우저)→`moyura://auth-callback` 복귀.
- **R-O3**: WHEN `{authenticated}` THEN WebView 가 웹 콜백(`?code=`)로 네비게이트 → `@supabase/ssr` 교환 → WebView 쿠키 세션 → `/me`.
- **R-O4**: IF `{cancelled|error}` THEN 미인증 유지·크래시 없음·로그인 surface(R-E4).
- **R-O5**: `sharedCookiesEnabled`(iOS)+`thirdPartyCookiesEnabled`(Android) 로 세션 쿠키 영속.
- **R-O6**: 앱·콜백 단일 일관 호스트(cookie origin 바인딩, `localhost`≠`127.0.0.1`; 에뮬레이터 `10.0.2.2` ↔ OAuth 허용목록 — OD-2).
- **R-P1**: 이메일/비번 로그인은 브리지 없이 WebView 안에서 동작.
- **R-P2 (manual)**: WHEN 에뮬레이터/디바이스 실행 THEN 웹 로그인 풀스크린 렌더(SPEC-LOGIN-UI-001 OD-5/AC-H1 닫음) + Google 시스템 브라우저 로그인 → 세션 → `/me`.

## AC (요약)

- AC-S2 풀스크린 로드 / AC-W2 env 미설정 throw / AC-U1 Android 백 / AC-U4 로드 실패 복구 / AC-O1 인터셉트·임베디드 차단 / AC-O3 시스템브라우저→deep-link→콜백→세션 / AC-O4 취소·에러 복구 / AC-P1 이메일·비번 브리지 없이.
- 자동화: typecheck/lint/build + `resolveWebUrl`/`buildReturnUrl` 단위 테스트. 수동: 에뮬레이터/디바이스 종단(iOS 는 macOS+Xcode 필요).

## Files to modify

- `apps/mobile/package.json` [MODIFY] — `react-native-webview@13.16.1`
- `apps/mobile/App.tsx` [MODIFY] — 풀스크린 WebView 셸 + UX + OAuth 인터셉트/복귀
- `apps/mobile/lib/web-url.ts` [NEW] — `resolveWebUrl`/`WEB_URL` env 가드
- `apps/mobile/lib/auth/oauth.ts` [MODIFY] — R-F3 authorizeUrl 산출 Google 완성
- `apps/mobile/.env`(예시)/문서 [NEW] — `EXPO_PUBLIC_WEB_URL` 호스트 매핑
- `apps/web/lib/auth/actions.ts`, `apps/web/app/auth/callback/route.ts`, `supabase/config.toml` [EXISTING] — 변경 없이 의존

## Exclusions (≥1)

- 네이티브 제품 화면 없음(웹이 UI surface).
- 네이티브 토큰/세션 저장소 없음(`oauth.ts` OD-4).
- Apple 브리지 연기(Apple Developer Program 미가입), Kakao 제외.
- prod 웹 URL/HTTPS/배포 연기(로컬·dev 우선; `EXPO_PUBLIC_WEB_URL` 은 env-driven).
- 신규 웹 server action/세션/콜백 코드 없음(기존 재사용); `expo-router` 미도입.

## Cross-refs

SPEC-AUTH-001(oauth 스캐폴드/R-F3) · SPEC-AUTH-002(Google 키 + host-consistency) · SPEC-LOGIN-UI-001(웹 로그인 UI + OD-5).
