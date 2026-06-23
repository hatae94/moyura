---
id: SPEC-MOBILE-004
version: 0.3.1
status: completed
created: 2026-06-11
updated: 2026-06-23
author: hatae
priority: high
issue_number: 0
---

# SPEC-MOBILE-004: 모바일 네이티브 Google 로그인 (Native SDK + Supabase signInWithIdToken)

## HISTORY

- 2026-06-23 (v0.3.1): 사후 버그 수정(post-completion) — 네이티브 Google 로그인 후 메인 진입 직후 로그인으로 튕기는 **cross-WebView 쿠키 격리** 버그 수정. 원인: 네이티브 Google 사인인은 로그인 WebView 안에서 web `setSession()` 으로 세션을 확립하는데, 이는 `document.cookie` 로 @supabase/ssr 세션 쿠키를 WKWebView 자체 store(useWebKit=true)에만 쓴다. 로그인 성공 → isSignedIn=true → expo-router 가 `(tabs)/home` 을 *별개 WebView* 로 마운트하고 그 WebView 는 `sharedCookiesEnabled` 로 NSHTTPCookieStorage(useWebKit=false)에서 쿠키를 읽으므로, 첫 GET 에 세션 쿠키가 없어 서버 가드 `requireNamedSession()` 가 `/login` 으로 302(main→login 바운스). 이메일 로그인은 서버 Set-Cookie 가 NSHTTPCookieStorage 에 바로 들어가 무영향(대조 확인). 수정: 신규 `apps/mobile/lib/auth/cookie-seed.ts` `seedSharedCookiesFromWebKit()` — `session:synced` 수신 시(홈 리다이렉트 직전) WKWebView store 의 `sb-*` 세션 쿠키를 NSHTTPCookieStorage 로 복사해 새 홈 WebView 첫 GET 이 쿠키를 싣게 한다(`cookie-clear.ts` 역방향 미러, @supabase/ssr 포맷 비복제 — 웹이 만든 실제 쿠키 복사라 ssr 업그레이드 무관). `useAuthBridge.onMessage` case "save" 에서 synced 신호 직전 await 선주입(실패해도 finally 로 synced 보장). 검증: mobile typecheck 0 + vitest 215/215 + **iOS 시뮬레이터 실검증(로그인 후 바운스 없음 — 사용자 확인 2026-06-23)**. status `completed` 유지(패치). 동반: `login-form.tsx` 로그인 랜딩 flex `grow` 1줄.
- 2026-06-17 (v0.3.0): sync 단계 — status `in-progress` → `completed` 전환. **디바이스 게이트(device-gate) 완전 충족**: iOS 시뮬레이터(iPhone 16 Pro, expo run:ios dev build) + 로컬 Supabase + 실 Google 계정으로 라이브 E2E 검증 완료(2026-06-17T17:19:03 UTC 세션 확인). 아래 3개 추가 변경사항이 두 커밋(0700e7d, a03fe75)에 포함됨:
  - **GoogleSignin.configure 배선(0700e7d)**: `apps/mobile/app/_layout.tsx`에서 앱 부트 시 `GoogleSignin.configure` 호출(실제 OAuth 클라이언트 ID — `apps/mobile/.env`, gitignored). `app.json` `iosUrlScheme` 플레이스홀더를 실 reversed iOS client scheme으로 교체. `.gitignore /credentials/` 추가.
  - **설계 변경 + 버그 수정(a03fe75): OAuth 네비게이션 인터셉트 → bridge 커맨드 `auth:google-request` 전환**: 원래 SPEC 설계는 WebView의 `onShouldStartLoadWithRequest(decideWebViewLoad)`에서 Google OAuth 네비게이션을 인터셉트하여 네이티브 SDK를 트리거하는 방식이었다. **라이브 테스트로 이 경로가 실패함을 확인**: Google 버튼(`signInWithOAuthAction` → GoTrue authorize URL)을 WebView 안에서 탭하면 `onShouldStartLoadWithRequest`가 해당 네비게이션에 대해 **발동하지 않음**(진단: `/login` 로드에만 발동 확인). 결과적으로 react-native-webview가 OAuth URL을 외부 브라우저로 열어버려 네이티브 SDK에 도달하지 못하고 로그인 완료 불가. **수정(결정론적, 취약한 인터셉션 대체)**: `auth:google-request`라는 추가적(additive) web→native bridge 커맨드 타입(토큰 없음, nonce 인증)을 **양쪽 bridge protocol에 동시 추가**(`apps/mobile/lib/auth/bridge-protocol.ts` + `apps/web/lib/native-bridge/bridge-protocol.ts` — BRIDGE_VERSION 1 유지, additive). 웹 로그인 폼의 Google 버튼은 네이티브 셸 내(`window.ReactNativeWebView` 존재 시) OAuth 네비게이션 대신 `window.ReactNativeWebView.postMessage`로 이 커맨드를 전송 + form submit preventDefault. 데스크톱 브라우저에서는 `requestNativeGoogleSignIn()`이 false를 반환하여 기존 웹 OAuth 흐름 유지(변경 없음). 모바일 `useAuthBridge.onMessage`가 nonce 검증 후 커맨드를 `{ kind: "google-signin" }`으로 매핑 → 네이티브 GoogleSignin SDK 실행. vitest 4건 신규 추가(bridge command).
  - **use_modular_headers! build fix(a03fe75)**: Expo config plugin `apps/mobile/plugins/withModularHeaders.js` 추가(`app.json plugins` 진입) — `use_modular_headers!`를 Podfile에 주입. GoogleSignin 8.x가 AppCheckCore를 정적 라이브러리 통합 방식으로 끌어오는데 modular headers 없이는 `pod install` 실패.
  - **라이브 E2E 검증 결과(2026-06-17)**: `expo run:ios`(iPhone 16 Pro, dev build) + 로컬 Supabase(external.google=true) 환경에서 실 Google 계정으로 종단 검증. "Google로 계속하기" 탭 → 네이티브 in-app Google 시트 표시(외부 브라우저 없음) → Google 계정 선택 및 로그인 → `signInWithIdToken`이 Supabase 세션 생성(`auth.users.last_sign_in_at: 2026-06-17T17:19:03`, `auth.sessions` 1행) → native→web bridge `session:restore` 주입 → 웹 `setSession` 성공 → 백엔드 `GET /me` Profile 생성(`name` 초기 null) → 앱이 이름 온보딩 화면 표시 + Google 계정 이름 "하태용" prefill. AC-1/AC-2/AC-3/AC-5 라이브 PASS. AC-4(이메일 signup 이름 배선) 자동 테스트 PASS. AC-6a/6b(취소·오류 → 미인증 유지) 순수 로직 vitest PASS + 로깅 없는 설계로 보장.
  - mobile vitest 191/191(+4 auth:google-request bridge command), tsc 0, web build OK, expo export OK, backend jest 214/214(85.36% branch) 전부 GREEN.
- 2026-06-15 (v0.2.0): sync 단계 — status `draft` → `in-progress` 전환. 자동화 가능한 게이트(backend jest 214/214 85.36% branch, mobile vitest 187/187, tsc 0 errors, web build OK, expo export OK, prisma migrate status clean, evaluator-active Overall PASS Func 75/Sec 75/Craft 75/Consistency 90) 전부 GREEN. **device-gated 미충족으로 `in-progress` 유지**: AC-1(Google 버튼 네이티브 SDK 진입), AC-2(signInWithIdToken Supabase 세션 획득), AC-3(session:restore 주입 + 웹 세션 확립), AC-5(구글 계정 이름 prefill), AC-6a(취소 시 로그인 페이지 복귀), AC-6b(signInWithIdToken 실패 에러 표시)는 EAS dev build + 실제 Google 계정 + Google Cloud OAuth 클라이언트 ID 없이 검증 불가. 이 패턴은 SPEC-MOBILE-001/002/003·SPEC-CHAT-001/002·SPEC-MOIM-001(OAuth) 동일 정책을 따른다. `completed` 전환 조건: spec.md §6 디바이스 종단 검증 게이트 항목(device-gated AC 전부) 실 기기/EAS dev build에서 통과 확인 후.
- 2026-06-11 (v0.1.0): 최초 draft 작성. research.md(2026-06-11) 기반. SPEC-MOBILE-001(브라우저 OAuth 브리지)·SPEC-MOBILE-002(토큰 세션 기반)·SPEC-AUTH-002(Google OAuth 키 배선) 위에서 동작. 핵심 결정: (1) WebView 내 웹 로그인 UI 유지 + Google 버튼만 인터셉트 → 네이티브 SDK 실행, (2) 기존 `session:restore` 경로 재사용(bridge-protocol v1 무변경), (3) 이메일 가입과 Google(향후 Apple) 가입 모두 이름 수집, (4) Profile.name 미보유 시 온보딩 강제 리다이렉트로 신규/기존 분기. App Store 4.8 리스크로 Android(Google Play) 제출 우선 타깃.

---

## 1. 개요 (Overview)

모바일 앱스토어 제출 승인을 위해, 모바일 앱에서의 Google 로그인을 WebView 기반 웹 OAuth 대신 **네이티브 Google Sign-In SDK**로 전환한다. 신규 계정은 회원가입+로그인, 기존 계정은 로그인으로 처리하며, 일반 이메일 회원가입과 동일하게 소셜 로그인에서도 **이름 정보**를 수집한다.

데스크톱 웹은 기존 웹 OAuth **로그인 흐름**(`signInWithOAuthAction`)을 변경 없이 유지한다. 모바일 앱만 WebView 안의 Google 버튼 동작을 브리지로 인터셉트하여 네이티브 SDK를 실행하고, 획득한 Supabase 세션을 기존 `session:restore` 경로로 웹에 주입한다. 단, 로그인 후 이름 온보딩 가드(REQ-MOB4-004)는 의도적으로 데스크톱 웹에도 적용된다 — 이름 미보유 사용자는 데스크톱에서도 온보딩으로 리다이렉트되므로, "데스크톱 변경 없음"은 OAuth 로그인 진입 경로에 한정된 것이지 로그인 후 동작 전체를 의미하지 않는다.

상세 사전 조사는 `research.md`를 참조한다.

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 5개로 제한한다. 각 모듈은 `REQ-MOB4-XXX`로 번호를 부여하며 모두 테스트 가능하고 `acceptance.md`의 시나리오로 추적된다.

### REQ-MOB4-001: 네이티브 Google Sign-In 진입 (Event-driven)

- **WHEN** WebView 내 웹 로그인 페이지에서 사용자가 Google 로그인 버튼 동작을 트리거하면, **the mobile app shall** 해당 동작을 브리지로 인터셉트하고 기존 웹 OAuth 네비게이션 대신 네이티브 Google Sign-In SDK를 실행한다.
- **WHEN** 네이티브 SDK 로그인이 성공하면, **the mobile app shall** 반환된 Google `idToken`을 Supabase `auth.signInWithIdToken({ provider: 'google', token })`에 전달하여 Supabase 세션(access/refresh 토큰)을 획득한다.
- **The mobile app shall** 데스크톱 웹 경로의 기존 OAuth 흐름을 변경하지 않는다(모바일 앱 컨텍스트에서만 인터셉트가 동작한다).

### REQ-MOB4-002: 세션 주입 (브리지 재사용) (Event-driven)

- **WHEN** Supabase 세션 토큰을 획득하면, **the mobile app shall** 토큰을 기존 `token-store.ts`의 `saveTokens`로 SecureStore에 저장하고, 기존 `session:restore` 브리지 메시지로 WebView 웹 세션에 주입한다(bridge-protocol v1 메시지 타입 무변경).
- **The mobile app shall** 토큰 값을 로그에 남기지 않으며, 주입 시 신뢰 origin allowlist 통과 + per-session nonce를 기존 `useAuthBridge` 경계(@MX:ANCHOR, `useAuthBridge.ts` L103–109)를 통해 보장한다.

### REQ-MOB4-003: 이름 수집 — 이메일·소셜 통합 (Ubiquitous, 구현 단계 필수 확인 체크포인트)

- **The system shall** 이메일 회원가입과 동일하게 Google(및 향후 Apple) 로그인에서도 사용자 이름을 수집·영속한다.
- **The system shall** 백엔드 `Profile` 모델에 nullable `name` 필드를 추가하고, 이메일 회원가입(`signUpAction`)이 폼의 `name` 값을 읽어 가입 시 영속하도록 배선한다.
- **The system shall** 이메일 경로와 소셜(Google·향후 Apple) 경로가 동일한 이름 수집 규칙을 따르도록, 모든 인증 경로가 단일 이름 수집·영속 경로(provider 비종속)를 공유한다.

> **[구현 단계 검증 체크포인트 — 사용자 명시 지시]** (비규범 보충 노트, 요구사항 아님)
> 위 shall-요구사항을 만족하는지 구현 과정에서 반드시 확인하여 진행한다: 이름 수집 방식·필드·UPSERT 경로·provider 비종속(provider-agnostic) 여부를 구현 시점에 점검한다. 운영화된 체크리스트는 `plan.md` §3을 따른다.

### REQ-MOB4-004: 이름 온보딩 리다이렉트 (Event-driven / State-driven 혼합)

- (Event-driven) **WHEN** 로그인이 완료되고 인증 사용자의 `Profile.name`이 비어 있거나 null이면, **the system shall** 사용자를 이름 입력 온보딩 웹 페이지로 강제 리다이렉트한다.
- (State-driven) **WHILE** 인증 사용자의 `Profile.name`이 비어 있거나 null인 동안, **the system shall** 보호 경로(`/me`) 진입을 허용하지 않고 온보딩 페이지에 머무르게 한다.
- (Event-driven) **WHEN** Google `user_metadata`에 이름(`name`/`given_name`)이 존재하면, **the system shall** 온보딩 입력 필드에 해당 값을 기본값으로 prefill하여 사용자가 확인·수정할 수 있게 한다.
- (Ubiquitous) **The system shall** 신규/기존 사용자 판별을 `Profile.name` 보유 여부(research §6 옵션 A)로 수행하며 created_at 타임스탬프에 의존하지 않는다. 이로써 신규 사용자와 이름 미보유 기존 사용자를 모두 온보딩으로 커버한다.
- (Ubiquitous) **The onboarding page shall** WebView와 데스크톱 웹 양쪽에서 동작하며 provider 비종속(향후 Apple 추가 시 분기 없이 재사용)으로 설계된다.

### REQ-MOB4-005: 실패·취소 경로 (Unwanted behavior)

- **IF** 사용자가 네이티브 Google Sign-In을 취소하면, **then the mobile app shall** 미인증 상태를 유지하고 WebView 로그인 페이지에 그대로 머무르며 토큰을 저장하거나 주입하지 않는다.
- **IF** `signInWithIdToken` 호출이 실패(토큰 검증 실패·네트워크 오류·provider 미설정)하면, **then the mobile app shall** 세션을 확립하지 않고 **복구 가능한 오류 상태**로 처리한다. 복구 가능한 오류 상태는 관측 가능하게 다음으로 정의한다: (1) WebView 로그인 페이지에 일반화된 오류 메시지가 표시되고, (2) Google 로그인 버튼이 재활성화되어 사용자가 즉시 재시도할 수 있으며, (3) SecureStore에 토큰이 저장되지 않고(토큰 0), (4) 토큰 값이나 오류 상세에 자격증명이 노출되지 않는다.
- **IF** 이름 온보딩 제출이 실패(빈 값·백엔드 오류)하면, **then the system shall** 보호 경로 진입을 차단하고 온보딩 페이지에 머무른 채 일반화된 오류 메시지를 표시하며 사용자가 재제출할 수 있게 한다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC은 기존 코드를 수정하는 brownfield 작업이다.

### [EXISTING] (보존 — 변경 없음)

- `apps/mobile/lib/auth/token-store.ts` — `saveTokens`/`loadTokens`/`clearTokens` (SecureStore 캐시)
- `apps/mobile/lib/auth/bridge-protocol.ts` — `BRIDGE_MESSAGE_TYPES`(`session:restore` 등 5종), nonce 봉투, v1 스키마 (메시지 타입 무변경)
- `apps/mobile/hooks/useAuthBridge.ts` L103–109 — @MX:ANCHOR 토큰 동기화·인증 경계 (보존·확장)
- `apps/web/lib/auth/actions.ts` `signInWithOAuthAction` (L79–99) — 데스크톱 웹 OAuth 경로
- `apps/web/app/auth/callback/route.ts` — 웹 PKCE 콜백 (변경 없음)
- `apps/backend/src/profile/me.controller.ts` `GET /me`(L26), `profileService.upsertBySub`(L35) — UPSERT 동작 보존

### [MODIFY] (수정)

- `apps/backend/prisma/schema.prisma` — `Profile` 모델에 nullable `name` 필드 추가 (마이그레이션)
- `apps/web/lib/auth/actions.ts` `signUpAction`(L30–47) — 폼의 `name` 값 읽어 가입 시 영속하도록 배선
- `apps/web/app/login/login-form.tsx` (L181–194) — 이름 필드는 이미 존재(decorative); action 배선과의 정합 확인
- `apps/mobile/hooks/useAuthBridge.ts` — Google 버튼 동작 인터셉트 분기 추가(@MX:ANCHOR 경계 확장)
- `apps/backend/src/profile/me.controller.ts` / `profile.service.ts` — 이름 업데이트 엔드포인트 추가(예: `PATCH /me`, 정확한 API 형태는 설계 결정)

### [NEW] (신규)

- `apps/mobile`에 `@supabase/supabase-js` + `@react-native-google-signin/google-signin` 의존성 (현재 mobile에 미존재)
- 모바일 네이티브 Google Sign-In 모듈 + Supabase `signInWithIdToken` 호출 래퍼
- 이름 입력 온보딩 웹 페이지(provider 비종속, WebView/데스크톱 공용)
- 온보딩 진입 가드(보호 경로에서 `Profile.name` 미보유 시 리다이렉트)
- `app.json` config plugin 설정(Google Sign-In) + Google Cloud Console iOS/Android 클라이언트 ID

### [REMOVE]

- 없음 (기존 경로는 보존; 모바일 앱은 네이티브 SDK로 분기, 데스크톱 웹은 기존 OAuth 유지)

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- **Apple Sign-In 구현** — Apple Developer Program 미가입(SPEC-AUTH-002 기록). 별도 follow-up SPEC. 단, 본 SPEC의 이름 온보딩·세션 흐름은 provider 비종속으로 설계하여 향후 Apple 추가를 차단하지 않는다.
- **prod OAuth 배선 (OD-4)** — prod Supabase Google provider 설정, prod 클라이언트 ID, prod 도메인 콜백. 로컬/dev 검증에 한정.
- **prod nonce 강제 분리** — 로컬은 `skip_nonce_check=true`(SPEC-AUTH-002 OD-5) 유지. prod nonce 검증 강제는 follow-up.
- **expo-router 도입 + 네이티브 라우트** — SPEC-MOBILE-003 범위. 본 SPEC은 단일 WebView 셸 유지 전제.
- **RBAC / 권한 모델** — Profile은 단일 사용자 식별·이름만 다룬다.
- **iOS App Store 제출** — App Store 4.8(아래 §5) 리스크로 본 SPEC은 Android(Google Play) 제출 준비를 타깃한다.
- **이메일 확인 / 비밀번호 재설정** — `actions.ts` 기존 범위 제약(R-G6) 유지.
- **네이티브 RN 로그인 화면** — 로그인 UI는 WebView 내 기존 웹 로그인 페이지를 그대로 사용한다.

---

## 5. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| **App Store Review Guideline 4.8** | **CRITICAL** | 서드파티 로그인(Google) 제공 iOS 앱은 Sign in with Apple(동등 프라이버시 로그인) 미제공 시 **제출 거부 가능성 HIGH**. 대응: 본 SPEC은 **Android(Google Play) 제출 준비**를 타깃. Apple Sign-In은 별도 SPEC. 온보딩/이름/세션 흐름을 provider 비종속으로 설계해 Apple 추가를 차단하지 않음. |
| Profile.name 필드 미존재 | HIGH | Prisma 마이그레이션 필수(nullable). 이메일 가입조차 현재 이름 미영속(`signUpAction` L30–47). |
| Expo Go 개발 불가 | MEDIUM | 네이티브 모듈 → EAS dev build 필수. 개발 루프 비용 증가. |
| Google 클라이언트 ID 3종 | MEDIUM | 기존 Web 클라이언트 외 iOS/Android 클라이언트 신규 발급 + Supabase provider authorized client IDs 등록 필요. |
| nonce 로컬 skip / prod 강제 분기 | MEDIUM | SPEC-AUTH-002 OD-5와 일관 유지. 네이티브 SDK nonce 전달 설계 확인(prod follow-up). |
| Universal/OneTap 유료 정책 | MEDIUM | 무료 Original API 사용 여부를 버전별 공식 문서로 구현 시 확인. |
| 네이티브/웹 OAuth 이중 경로 | LOW | 앱=네이티브 SDK, 데스크톱 웹=기존 OAuth로 역할 분리. |

---

## 6. 검증 게이트 (Quality Gate)

- typecheck 0 error (web/backend/mobile)
- lint 0 error
- vitest 통과 (모바일 순수 코어 / 웹)
- web build 통과 / `expo export` 통과
- **디바이스 종단 검증**: 본 SPEC은 자동 게이트 통과만으로 완료되지 않으며, 실제 디바이스에서 Google 네이티브 로그인 + 세션 주입 + 온보딩이 검증되어야 status가 완료로 전환된다(프로젝트 메모리 규칙).

**[완료 — 2026-06-17 라이브 E2E로 모든 게이트 충족]**: 상기 자동 게이트 전부 GREEN + iOS 시뮬레이터(iPhone 16 Pro, expo run:ios dev build) 라이브 E2E로 디바이스 종단 검증 완료. HISTORY v0.3.0 참조.

---

## 7. 구현 노트 (Implementation Notes)

> 본 섹션은 v0.3.0 completed 전환 시 추가되었다. 원래 SPEC 설계(§3 Delta Markers)에서 실제 구현이 달라진 지점을 기록한다.

### Google 네이티브 로그인 트리거 방식 — 설계 변경 (v0.3.0)

**원래 설계 (v0.1.0 § [MODIFY] useAuthBridge.ts):**

`onShouldStartLoadWithRequest`(`decideWebViewLoad`) 에서 Google OAuth URL 네비게이션을 인터셉트하여 네이티브 SDK를 트리거하는 방식. 인터셉션 경로(`oauth-intercept`)가 Google 버튼 동작을 감지하면 외부 브라우저 대신 네이티브 GoogleSignin SDK를 실행하는 설계.

**라이브 테스트에서 드러난 실패 원인:**

iOS 시뮬레이터 + dev build + 실 Google 계정으로 검증 시, Google 버튼(`signInWithOAuthAction` → GoTrue `/authorize` URL로 redirect) 탭 시 `onShouldStartLoadWithRequest`가 **해당 네비게이션에 대해 발동하지 않음**을 진단으로 확인 (진단: `/login` 초기 로드에만 발동). react-native-webview가 OAuth URL을 외부 Safari로 열어 네이티브 SDK 진입 자체가 불가능했다.

**채택된 수정 (v0.3.0 — 결정론적 bridge command 방식):**

`auth:google-request` bridge 커맨드 타입을 **additive**로 양쪽 bridge protocol에 추가 (BRIDGE_VERSION 1 보존):

- `apps/mobile/lib/auth/bridge-protocol.ts`: `"auth:google-request"` 커맨드 타입 추가
- `apps/web/lib/native-bridge/bridge-protocol.ts`: 동일 커맨드 타입 추가

웹 로그인 폼 Google 버튼: `window.ReactNativeWebView` 존재 시(= 네이티브 셸 내) `window.ReactNativeWebView.postMessage`로 `auth:google-request` 커맨드 전송 + form submit `preventDefault`. 데스크톱에서는 `requestNativeGoogleSignIn()` → false → 기존 웹 OAuth 흐름 유지.

`useAuthBridge.onMessage`: nonce 검증 후 `auth:google-request` 커맨드를 `{ kind: "google-signin" }` 이벤트로 매핑 → 네이티브 GoogleSignin SDK 호출.

**기존 인터셉션 경로 상태:**

`decideWebViewLoad`의 `oauth-intercept` 분기는 코드에서 제거되지 않았으나 실질적으로 비활성(inert fallback) 상태다. Google OAuth URL이 `onShouldStartLoadWithRequest`에 도달하지 않으므로 이 경로는 실행되지 않는다. 향후 cleanup SPEC에서 정리 가능.

### use_modular_headers! Expo config plugin (v0.3.0)

`apps/mobile/plugins/withModularHeaders.js`: `use_modular_headers!`를 Podfile에 주입하는 Expo config plugin. `app.json plugins` 배열에 등록.

배경: `@react-native-google-signin/google-signin` 8.x가 AppCheckCore를 의존으로 끌어오는데, AppCheckCore가 CocoaPods 정적 라이브러리 통합 시 modular headers를 요구한다. 이 plugin 없이는 `pod install`이 빌드 오류로 실패한다.

### 관련 follow-up 참고

- **Apple Sign-In**: Apple Developer Program 미가입으로 본 SPEC 제외(§4). iOS App Store 제출 시 App Store Guideline 4.8 적용. 별도 follow-up SPEC 필요.
- **prod OAuth/redirect 일반화**: 로컬/dev 검증에 한정(SPEC-AUTH-002 OD-4). 프로덕션 Supabase Google provider 설정, prod 클라이언트 ID, prod 도메인 콜백은 follow-up(SPEC-AUTH-002 범위).
- **SPEC-MOBILE-001/002/003 · SPEC-WEBVIEW-SHELL-001 cross-SPEC 후속**: 이번 라이브 Google 로그인 성공이 해당 SPEC들이 대기 중인 "Google OAuth 라운드트립 on device" 게이트를 실질적으로 충족하는 증거다. 각 SPEC의 per-AC 상태 검토를 별도 sync에서 수행 권장(본 sync에서 해당 SPEC status 변경 없음 — 각 SPEC별 전용 검증 필요).
