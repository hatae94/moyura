# Research: 모바일 네이티브 Google 로그인 (Native SDK + Supabase)

> SPEC-MOBILE-004 사전 조사 문서 (ID 잠정 — Phase 1.5에서 확정)
> 작성일: 2026-06-11 | 조사 도구: Explore agent (deep read) + 공식 문서 WebFetch 검증

## 1. 목표 요약

모바일 앱스토어 제출(Google Play, Apple App Store) 승인을 위해 다음을 구현한다:

- **Google Sign-In**: WebView 기반 웹 OAuth 대신 **네이티브 Google Sign-In SDK 사용** (`@react-native-google-signin/google-signin`)
- **Apple Sign-In**: 현재 제외(Apple Developer Program 미가입, SPEC-AUTH-002 기록)
- **동작**: (1) 신규 계정 → 회원가입 + 로그인, (2) 기존 계정 → 로그인
- **CRITICAL**: 이메일 회원가입 흐름처럼 **Google/Apple 로그인도 사용자 이름을 별도 입력 단계로 수집** — 구현 시 명시적 검증 필요

---

## 2. 현재 아키텍처 (모바일 브리지 / 웹 인증 / 백엔드 Profile)

### 2.1 모바일 WebView 셸 아키텍처

**파일: `apps/mobile/App.tsx` (L1–193)**

- **진입점**: `index.ts` → `registerRootComponent(App)` → `App.tsx`
- **구조**: SafeAreaView + WebView 단일 풀스크린 셸
- **현재 웹 호스트**: `WEB_URL` (env `EXPO_PUBLIC_WEB_URL` → `http://localhost:3000` 또는 dev 호스트)
- **특징**:
  - L33–35: 스플래시 자동 숨김 방지(`SplashScreen.preventAutoHideAsync`)
  - L38–39: 신뢰 origin 잠금 (`ORIGIN_WHITELIST = [buildTargetOrigin(WEB_URL)]`)
  - L58: `sourceUri` 상태로 OAuth 복귀 시 URL 교체(리마운트 안 함 — OD-1 critical)
  - L69–93: useAuthBridge 훅 — OAuth 인터셉트 + 토큰 브리지
  - L96–117: 콜드스타트 토큰 로드 + session:restore 주입
  - L160–164: onLoadEnd → maybeInjectRestore 호출

### 2.2 OAuth 브리지 핵심 로직

**파일: `apps/mobile/hooks/useAuthBridge.ts` (L1–260)**

- **목적**: Google OAuth URL 인터셉트 + 시스템 브라우저 브리지 + 토큰 동기화
- **주요 메서드**:
  - L136–157: `onShouldStartLoadWithRequest` — OAuth authorize URL 감지 → `runOAuthBridge` 호출
  - L123–133: `runOAuthBridge(interceptedAuthorizeUrl)` — `bridgeGoogleOAuth` 호출 → 콜백 URL 조립 → `onNavigateToCallback` 실행
  - L209–238: `injectRestore(tokens, currentUrl)` — origin allowlist 통과 후 session:restore 주입 (bounded retry)
  - L241–252: `injectRevalidate(tokens, currentUrl)` — resume 시 재검증 메시지 주입

**@MX:ANCHOR 지점 (L103–109)**: 토큰이 JS 브리지를 가로지르는 단일 동기화·인증 경계 (fan_in ≥ 3)

### 2.3 브리지 프로토콜 (메시지 스키마)

**파일: `apps/mobile/lib/auth/bridge-protocol.ts` (L1–252)**

- **메시지 타입** (`BRIDGE_MESSAGE_TYPES`, L24–35):
  - `session:restore` — native→web: 저장 토큰 주입 (cold-start)
  - `session:synced` — web→native: 유효 토큰 회신
  - `session:none` — web→native: 세션 없음/만료
  - `session:cleared` — web→native: 로그아웃
  - `resume:revalidate` — native→web: resume 시 재검증
- **보안 기제** (L13–17, L198–207, L224–251):
  - per-session nonce (cold-start 1회 생성 → 모든 메시지에 포함)
  - 상수시간 비교 (`constantTimeEquals`, L198–207)
  - PII 최소화: access/refresh 토큰만 (userId/프로필 미포함)
  - targetOrigin specific (신뢰 origin literal만)

---

## 3. 현재 이메일 회원가입의 이름 수집 흐름

### 3.1 웹 로그인 폼

**파일: `apps/web/app/login/login-form.tsx` (L1–255)**

- **회원가입 경로**:
  - L181–194: 조건부 이름 필드 (`{isSignUp ? (...)}`).
    - L188: `<input id="login-name" name="name" type="text" placeholder="홍길동" />`
    - **주의**: 현재 signUpAction이 이 필드를 읽지 않음 (아래 참조)
- **Google/Apple 소셜 버튼** (L89–111):
  - 현재 WebView 기반 `signInWithOAuthAction` 호출 (native SDK 아님)
  - 소셜 로그인 성공 후 `/me` 도착 (이름 수집 안 함 — **문제점**)

### 3.2 웹 회원가입/로그인 액션

**파일: `apps/web/lib/auth/actions.ts` (L1–100)**

- **L30–47 `signUpAction`**:
  - `readCredentials(formData)` → email/password만 추출 (L20–24)
  - **이름 필드 미수집**: Supabase `auth.signUp({ email, password })` — name 파라미터 없음
  - 결과: **이메일 회원가입 시 이름이 저장되지 않는다** (현재 상태)
- **L79–99 `signInWithOAuthAction`**:
  - L86–90: `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: ${CALLBACK_URL}?next=/me } })`

### 3.3 웹 OAuth 콜백

**파일: `apps/web/app/auth/callback/route.ts` (L1–52)**

- L39: `exchangeCodeForSession(code)` → L49: `next` 경로로 redirect
- **post-OAuth 이름 입력**: 없음 (현재 상태)

### 3.4 백엔드 Profile 모델

**파일: `apps/backend/prisma/schema.prisma` (L18–28)**

```prisma
model Profile {
  id        String   @id  // Supabase user id (sub)
  createdAt DateTime @default(now())
  @@map("profile")
}
```

- **`name` 필드 없음** — 이메일 가입 경로조차 이름 영속화 미구현
- 본 SPEC 실행 시 **스키마 마이그레이션 필수** (`name` nullable 컬럼 추가)
- UPSERT는 보호 라우트 `GET /me` 경유 (ProfileService)

---

## 4. SPEC-AUTH-002 / SPEC-MOBILE-001/003 연계 및 선후 관계

### 4.1 SPEC-AUTH-002 (completed, 2026-06-08)

- Google 로컬 OAuth `enabled = true` + `skip_nonce_check = true` (OD-5, config.toml L345–352)
- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `..._GOOGLE_SECRET` env 정의 (Web application 클라이언트)
- 웹 콜백: `http://localhost:3000/auth/callback`, GoTrue 콜백: `http://127.0.0.1:54321/auth/v1/callback`
- **미완 (follow-up)**: Apple (Developer Program 미가입), prod OAuth (OD-4), prod nonce 분리 (OD-5)

### 4.2 SPEC-MOBILE-001 (in-progress, v0.2.0)

- WebView 셸 + Google OAuth 브리지 (시스템 브라우저), `moyura://auth-callback` deep-link
- 자동 게이트 통과 (typecheck 0 / vitest 12/12 / expo export OK), **디바이스 검증 대기** (R-P2)

### 4.3 SPEC-MOBILE-003 (research-only)

- expo-router 도입 + 로그인 후 네이티브 `/home` 라우트
- **로그인/회원가입은 여전히 WebView 유지** 전제 — 본 SPEC의 UI 진입점 결정과 직결

### 4.4 선후 관계

```
SPEC-AUTH-002 (Google OAuth 키 배선, completed)
    ↓
SPEC-MOBILE-001 (시스템 브라우저 OAuth 브리지, in-progress)
    ↓ (분기점)
    ├─→ [본 SPEC] 네이티브 SDK Google Sign-In
    │    - Supabase signInWithIdToken
    │    - Profile 이름 수집 + UPSERT
    │    - 신규/기존 유저 판별
    └─→ [향후] SPEC-MOBILE-003 (expo-router + 네이티브 /home)
```

본 SPEC(네이티브 SDK)은 SPEC-MOBILE-001(브라우저 브리지)과 **대체 또는 병렬** 관계이며 SPEC-AUTH-002 위에서 동작.

---

## 5. 외부 검증: 라이브러리/Supabase/스토어 정책

### 5.1 @react-native-google-signin/google-signin

출처: https://www.npmjs.com/package/@react-native-google-signin/google-signin , https://github.com/react-native-google-signin/google-signin

- **Expo 지원**: config plugin 제공, **dev build 필수 (Expo Go 불가)** — `npx expo install`로 호환 버전 설치
- **iOS**: URL scheme `com.googleusercontent.apps.<IOS_CLIENT_ID>` 등록 필요
- **Android**: SHA-1 fingerprint 등록 필요 (debug keystore + Play Console signing key)
- **Google Cloud Console**: Web / iOS / Android 클라이언트 ID 각각 생성 필요 (기존 SPEC-AUTH-002는 Web만 배선)
- **라이선싱 주의**: Universal/OneTap 계열 API는 유료(스폰서) 정책 이력 있음 — 구현 시 무료 Original API 사용 여부 버전별 공식 문서로 확인 필수
- 로그인 성공 시 `idToken` 반환 → Supabase에 전달

### 5.2 Supabase `signInWithIdToken`

출처: https://supabase.com/docs/reference/javascript/auth-signinwithidtoken , https://supabase.com/docs/guides/auth/social-login/auth-google

```typescript
const { data, error } = await supabase.auth.signInWithIdToken({
  provider: "google",
  token: idToken,
  nonce, // 옵션 — Supabase provider 설정과 일치 필요
});
```

- idToken 서명 검증(Google JWKS) → claims 파싱 (`sub`, `email`, `name`, `given_name`, `family_name`, `picture`)
- **신규 사용자**: auth user 자동 생성 + `user_metadata`에 name claims 자동 저장
- **기존 사용자**: email/sub 일치 user 반환
- **신규/기존 구분 신호를 API가 명시 제공하지 않음** → §6 판별 옵션 필요
- nonce: 로컬 `skip_nonce_check=true` 상태(SPEC-AUTH-002 OD-5) — prod 분리 필요
- 모바일에서 Supabase JS SDK(`@supabase/supabase-js`) 직접 호출 필요 (현재 모바일은 웹 세션 의존, SDK 미사용)

### 5.3 앱스토어 정책

#### Google Play (Android)
- 소셜 로그인 제약 없음. SHA-1 서명 등록만 필요. **제출 가능: OK**

#### Apple App Store (iOS) — CRITICAL
- **App Store Review Guideline 4.8**: 서드파티 로그인 제공 앱은 **Sign in with Apple(또는 동등 프라이버시 보장 로그인) 옵션 필수**
- 현재 Apple Developer Program 미가입 + Apple 로그인 제외 → **iOS 제출 시 거부 가능성 HIGH**
- **권장 전략**: Phase 1 = Google 네이티브 로그인 + Android 제출, Phase 2 = Apple 로그인 구현(별도 SPEC) 후 iOS 제출

---

## 6. 신규/기존 유저 판별 옵션 비교

| 옵션 | 방식 | 장점 | 단점 | 평가 |
|------|------|------|------|------|
| **A. Profile 조회 (권장)** | `signInWithIdToken` 후 `GET /me` → Profile.name null/row 신규 여부로 판단 | 백엔드 단일 권위, 기존 엔드포인트 재사용, 기존 유저의 이름 미보유 케이스도 커버 | API 왕복 1회 추가 | **HIGH** |
| B. ID Token claims 분석 | JWT 파싱으로 판별 시도 | API 호출 절약 | 표준 claims에 신규 가입 신호 없음 → **기술적 불가** | LOW |
| C. Supabase 반환 플래그 | 응답 메타데이터 활용 | 간단 | API가 신규/기존 플래그 미제공 | LOW |
| D. created_at 타임스탬프 | `now - user.created_at < 5s` → 신규 | 구현 간단 | 네트워크 지연 경계 케이스, 부정확 | MEDIUM |

**권장**: **옵션 A 단독** (이름 보유 여부가 진짜 판별 기준이므로 "신규 여부"보다 "Profile.name 미보유 여부"로 분기하는 것이 요구사항에 더 정확) — 옵션 D는 보조 신호로만.

---

## 7. 리스크 및 제약

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| App Store 4.8 (Apple 로그인 미제공) | **CRITICAL** | iOS 제출 거부 가능성 HIGH. Android 우선 제출 + Apple 로그인 별도 SPEC 후 iOS 제출 |
| Profile.name 필드 미존재 | HIGH | Prisma 마이그레이션 필수. 이메일 가입 경로도 이름 미영속 상태 — 스코프 결정 필요 |
| Expo Go 개발 불가 | MEDIUM | 네이티브 모듈 → EAS dev build 필수, 개발 루프 비용 증가 |
| nonce 검증 분기 (로컬 skip / prod 강제) | MEDIUM | SPEC-AUTH-002 OD-5와 일관성 유지, 네이티브 SDK nonce 전달 설계 확인 |
| Google 클라이언트 ID 3종 필요 | MEDIUM | 기존 Web 클라이언트 외 iOS/Android 클라이언트 신규 발급 + Supabase provider authorized client IDs 등록 |
| 네이티브/웹 OAuth 이중 경로 | LOW | 앱=네이티브 SDK, 데스크톱 웹=기존 OAuth 유지로 역할 분리 |

---

## 8. 구현 접근 권고 (기존 브리지 재사용 지점 명시)

### 8.1 세션 주입 재사용

- 네이티브 SDK 로그인 → `signInWithIdToken` → access/refresh 토큰 획득
- `token-store.ts`(`saveTokens`) 저장 → 기존 **`session:restore`** 메시지로 WebView 웹 세션 주입 (SPEC-MOBILE-002 경로 그대로)
- bridge-protocol v1 메시지 타입 변경 불필요 (재사용: `session:restore`/`synced`/`cleared`)

### 8.2 구현 단계 (잠정)

1. **준비**: Prisma `Profile.name` 마이그레이션, Google Cloud Console iOS/Android 클라이언트 ID 발급, Supabase provider 설정, app.json config plugin
2. **네이티브 SDK 통합**: `@react-native-google-signin/google-signin` + EAS dev build
3. **Supabase 통합**: 모바일 `signInWithIdToken` 호출 → 토큰 SecureStore 저장 → session:restore 주입
4. **이름 수집 UX**: Profile.name 미보유 시 이름 입력 단계 강제 (진입점/위치는 사용자 결정 반영)
5. **검증**: 디바이스 종단 검증 (기존 메모리 규칙: 자동 게이트만으로 complete 처리 금지)
