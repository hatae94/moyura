# SPEC-MOBILE-001 — 구현 계획 (plan.md)

> 우선순위 기반 마일스톤(시간 추정 없음). 브라운필드 — 기존 패턴(`oauth.ts`, `lib/env.ts`) 재사용, 최소 변경.

## Milestones (우선순위 순)

### M1 (Priority High) — react-native-webview + 풀스크린 셸 + EXPO_PUBLIC_WEB_URL
- `apps/mobile/package.json` 에 `react-native-webview` 추가([MODIFY], `npx expo install react-native-webview` → Expo 56 pin `13.16.1`).
- `apps/mobile/lib/web-url.ts` 신규([NEW]) — `resolveWebUrl(value)` 순수 가드(`lib/env.ts` 패턴 복제: trim, 미설정/공백 throw, 리터럴 키 `process.env.EXPO_PUBLIC_WEB_URL` 직접 접근으로 Expo 인라인 보장). 모듈 레벨 `export const WEB_URL = resolveWebUrl(process.env.EXPO_PUBLIC_WEB_URL)`.
- `apps/mobile/App.tsx` 교체([MODIFY]) — Expo 기본 템플릿 제거, 단일 `<WebView source={{ uri: WEB_URL }} />` 풀스크린.
- `.env` 예시/문서: 환경별 호스트 매핑(Android emulator `http://10.0.2.2:3000`, iOS sim `http://localhost:3000`, 실기기 LAN IP). prod 연기.
- 대응 R: R-S1, R-S2, R-S3, R-W1, R-W2, R-W3.

### M2 (Priority High) — WebView UX (백/safe-area/로딩/에러)
- `App.tsx`([MODIFY]): `SafeAreaView` 래핑(R-U2), `onLoadStart`/`onLoadEnd` 로딩 인디케이터(R-U3), `onError`/`onHttpError` 복구 가능 에러/오프라인 상태 + 재시도(R-U4).
- Android 하드웨어 백: `BackHandler` + WebView `ref`(`onNavigationStateChange` 로 `canGoBack` 추적) → 히스토리 있으면 `goBack()`, 없으면 기본 종료(R-U1).
- (선택) pull-to-refresh.
- 대응 R: R-U1, R-U2, R-U3, R-U4.

### M3 (Priority High) — Google OAuth 브리지 (인터셉트 → 시스템 브라우저 → deep-link → WebView 콜백)
- `App.tsx`([MODIFY]): `onShouldStartLoadWithRequest`(OD-1 채택안 a) — provider authorize 호스트(`accounts.google.com` 등) 네비게이션 감지 시 `return false` 로 임베디드 로드 차단 + 그 URL 을 `authorizeUrl` 로 추출(R-O1). 정확한 인터셉트 대상 URL 패턴은 구현 시 실측(OD-1).
- `oauth.ts`([MODIFY]): R-F3 의 연기된 `authorizeUrl` 산출을 Google 한정 완성 — 인터셉트한 URL 을 `launchSocialOAuth(authorizeUrl)` 에 전달(R-O2). 기존 `launchSocialOAuth` 시그니처/`buildReturnUrl` 그대로 사용.
- 복귀 처리(R-O3): `{kind:"authenticated"}` → WebView 를 웹 콜백 URL(`?code=`)로 네비게이트해 `@supabase/ssr` 가 교환·쿠키 세션 설정 → `/me`. `{kind:"cancelled"|"error"}` → 미인증 유지, 로그인 surface(R-O4).
- 쿠키(R-O5): WebView `sharedCookiesEnabled`(iOS) + `thirdPartyCookiesEnabled`(Android).
- 호스트 일관성(R-O6): 앱 로드 호스트 = OAuth 콜백 호스트(localhost 일관 또는 에뮬레이터 매핑 — OD-2/OD-3).
- 대응 R: R-O1, R-O2, R-O3, R-O4, R-O5, R-O6.

### M4 (Priority Medium) — 검증 (보존 + 종단)
- 이메일/비번 로그인이 WebView 안에서 브리지 없이 동작 확인(R-P1).
- 종단 수동(R-P2): 에뮬레이터/디바이스에서 (1) 웹 로그인 풀스크린 렌더 = SPEC-LOGIN-UI-001 OD-5/AC-H1 닫음, (2) Google 시스템 브라우저 로그인 → 세션 → `/me` WebView 표시.
- 자동화 가능 항목(typecheck/lint/build, `resolveWebUrl` 단위 테스트)은 acceptance.md Quality Gate 참조.

## Technical Approach

- **셸 = 단일 화면.** `expo-router` 불필요 — `App.tsx` 가 단일 WebView 를 호스트. `index.ts(main)` 진입 유지.
- **OAuth 브리지 = 인터셉트 우선(OD-1 a).** 웹 코드 변경 0 으로 `signInWithOAuthAction` 의 `redirect(data.url)` 결과를 WebView 가 가로채 네이티브로 위임. 임베디드 WebView 로 provider 페이지를 직접 띄우지 않음(R-E2). (b) postMessage 는 (a) 실패 시 fallback(웹 변경 수반).
- **세션 소유권 = 웹.** 네이티브 토큰 저장소 미도입(`oauth.ts` OD-4). deep-link 복귀 후 WebView 가 웹 콜백을 로드해 `@supabase/ssr` 가 쿠키 세션 확립.
- **env 가드 = 기존 패턴 복제.** `web-url.ts` 는 `env.ts` 의 순수 throw 가드를 그대로 따라 테스트 가능 단위로 유지(`EXPO_PUBLIC_*` 인라인 동작 보장 위해 리터럴 키 직접 접근).
- **Expo 56 검증 필수.** `apps/mobile/AGENTS.md` — 구현 전 https://docs.expo.dev/versions/v56.0.0/ + `react-native-webview` Reference 확인. 핀 = `13.16.1`(`npx expo install` 로 일치).
- **@MX 태그.** `App.tsx` 의 OAuth 인터셉트/복귀 경계는 외부 시스템 경계 → `@MX:WARN`(+REASON, R-E4 식 복구 가능 분류). `web-url.ts WEB_URL` 은 다수 의존 부팅 가드 → `@MX:ANCHOR`(env.ts `API_BASE_URL` 패턴).

## Files in Scope

| 파일 | DELTA | 변경 내용 |
|------|-------|-----------|
| `apps/mobile/package.json` | [MODIFY] | `react-native-webview@13.16.1` 추가 |
| `apps/mobile/App.tsx` | [MODIFY] | 기본 템플릿 → 풀스크린 WebView 셸 + UX(백/safe-area/로딩/에러) + OAuth 인터셉트/복귀 |
| `apps/mobile/lib/web-url.ts` | [NEW] | `resolveWebUrl`/`WEB_URL` env 가드(`lib/env.ts` 패턴) |
| `apps/mobile/lib/auth/oauth.ts` | [MODIFY] | 연기된 `authorizeUrl` 산출(R-F3)을 Google 한정 완성 — 인터셉트 URL → `launchSocialOAuth` 배선 |
| `apps/mobile/.env`(예시) / 문서 | [NEW] | `EXPO_PUBLIC_WEB_URL` 환경별 호스트 매핑 |
| `apps/web/lib/auth/actions.ts` | [EXISTING] | 변경 없이 의존(`signInWithOAuthAction` → `data.url`) |
| `apps/web/app/auth/callback/route.ts` | [EXISTING] | 변경 없이 의존(PKCE 교환·쿠키 세션) |
| `supabase/config.toml` | [EXISTING] | 변경 없이 의존(`additional_redirect_urls`, `[auth.external.google]`) — 단 에뮬레이터 호스트 매핑(OD-2)은 별도 검토 |

## Risks

- **OD-2 (핵심)**: Android 에뮬레이터 호스트(`10.0.2.2`)와 GoTrue exact-match 허용목록(`localhost`)/Google Cloud authorized redirect(`127.0.0.1:54321`) 불일치 → 종단 OAuth 실패. 완화: `adb reverse tcp:3000`/`tcp:54321` 로 `localhost` 일관 셋업 vs `10.0.2.2` 매핑 — 둘 다 실측 후 확정.
- **OD-1**: `onShouldStartLoadWithRequest` 인터셉트 대상 URL 패턴이 너무 넓으면 정상 네비게이션 차단, 너무 좁으면 OAuth 미인터셉트. 구현 시 실측. (b) postMessage fallback 존재(웹 변경 수반).
- **OD-3**: 문서 드리프트(`localhost` vs `127.0.0.1`) — 문서만 따르면 cookie origin 불일치. live = `localhost`.
- **OD-4**: 시스템 브라우저 ↔ WebView 별도 쿠키 저장소 — 세션 쿠키 영속성 미설정 시 매 실행 재로그인.
- **OD-6**: iOS 종단 검증은 macOS + Xcode 필요(자동화 불가). Android 우선.
- **R-F3 완성 범위**: `authorizeUrl` 산출은 Google 한정. Apple/Kakao 는 본 SPEC 범위 밖(동일 메커니즘 이후 확장).
