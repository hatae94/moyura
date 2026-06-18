# Sync Report — SPEC-MOBILE-004 v2

생성일: 2026-06-17
브랜치: feature/SPEC-MOBILE-004
커밋: 0700e7d (GoogleSignin.configure 배선), a03fe75 (bridge command + build fix)
이전 sync: sync-report-SPEC-MOBILE-004.md (2026-06-15, v0.2.0 in-progress)

---

## 1. status 전환: in-progress → completed (v0.3.0)

- **이전 status**: `in-progress` (v0.2.0)
- **신규 status**: `completed` (v0.3.0)
- **updated**: 2026-06-17

**전환 근거**: 프로젝트 메모리 `verify-locally-before-device-gating` 원칙에 따라 iOS 시뮬레이터(iPhone 16 Pro, expo run:ios dev build) + 로컬 Supabase + 실 Google 계정 라이브 E2E 검증을 디바이스 게이트로 수용. 이번 검증이 v0.2.0에서 명시한 "device-gated 미충족" 조건을 완전히 충족한다.

---

## 2. 이번 sync에서 변경된 사항 (v0.2.0 → v0.3.0)

### 2-1. 추가 구현 (두 커밋)

**커밋 0700e7d — GoogleSignin.configure 배선**

- `apps/mobile/app/_layout.tsx`: 앱 부트 시 `GoogleSignin.configure` 호출 (실 OAuth 클라이언트 ID 적용)
- `apps/mobile/.env`: 실 OAuth 클라이언트 ID 저장 (gitignored)
- `app.json` `iosUrlScheme`: 플레이스홀더 → 실 reversed iOS client scheme 교체
- `.gitignore /credentials/`: credential 파일 gitignore 추가

**커밋 a03fe75 — 설계 변경(bridge command) + build fix**

- `apps/mobile/lib/auth/bridge-protocol.ts`: `"auth:google-request"` 커맨드 타입 추가 (additive, BRIDGE_VERSION 1 유지)
- `apps/web/lib/native-bridge/bridge-protocol.ts`: 동일 커맨드 타입 추가 (web 측)
- `apps/mobile/hooks/useAuthBridge.ts`: `auth:google-request` → `{ kind: "google-signin" }` 매핑, nonce 검증 후 네이티브 GoogleSignin SDK 호출
- `apps/web/app/login/login-form.tsx` (또는 해당 Google 버튼 컴포넌트): `window.ReactNativeWebView` 존재 시 `postMessage` + `preventDefault` / 없으면 기존 웹 OAuth 유지 (`requestNativeGoogleSignIn()` 함수)
- `apps/mobile/plugins/withModularHeaders.js`: Expo config plugin 신규 추가 (use_modular_headers! Podfile 주입)
- `apps/mobile/app.json`: `plugins` 배열에 `withModularHeaders.js` 등록
- mobile vitest +4 (auth:google-request bridge command 케이스)

### 2-2. 설계 변경 상세 — 왜 OAuth 인터셉트에서 bridge command로 전환했는가

**원래 설계 (v0.1.0 계획):**
`onShouldStartLoadWithRequest`(`decideWebViewLoad`)에서 Google OAuth authorize URL 네비게이션을 감지·인터셉트하여 네이티브 SDK를 실행하는 방식.

**실패 진단 (라이브 테스트 중 확인):**
iOS 시뮬레이터 dev build에서 Google 버튼을 탭할 때 `onShouldStartLoadWithRequest` 콜백이 해당 OAuth URL 네비게이션에 대해 **발동하지 않음**. 진단 결과: `/login` 페이지 초기 로드에만 발동 확인. 결과적으로 react-native-webview가 OAuth URL을 외부 Safari로 열어버려 네이티브 SDK 진입 불가, 로그인 완료 불가.

**채택된 수정 (결정론적 방식):**
web 측 Google 버튼이 네이티브 셸 감지(`window.ReactNativeWebView`) 후 OAuth 네비게이션 대신 `postMessage`로 `auth:google-request` 커맨드를 전송. 네이티브 `useAuthBridge`가 이 메시지를 수신해 GoogleSignin SDK를 직접 호출. 이 방식은 WebView 네비게이션 이벤트에 의존하지 않아 인터셉션 타이밍 문제를 완전히 제거한다.

**기존 인터셉션 경로:**
`decideWebViewLoad`의 `oauth-intercept` 분기는 코드에서 제거되지 않았으나 실질적으로 비활성(inert fallback) 상태. Google OAuth URL이 `onShouldStartLoadWithRequest`에 도달하지 않으므로 이 경로는 실행되지 않는다.

**데스크톱 영향 없음:**
`requestNativeGoogleSignIn()` 함수는 `window.ReactNativeWebView` 부재 시 `false`를 반환 → 기존 웹 OAuth 흐름(`signInWithOAuthAction`) 정상 실행.

### 2-3. build fix — use_modular_headers!

`@react-native-google-signin/google-signin@16.1.2`가 AppCheckCore를 CocoaPods 정적 라이브러리로 의존. AppCheckCore는 modular headers를 요구하는데, `use_modular_headers!` 없이 `pod install` 시 빌드 오류 발생. `withModularHeaders.js` config plugin이 자동으로 Podfile에 이 directive를 주입하여 해소.

---

## 3. 라이브 E2E 검증 방법 및 결과

**검증 환경:**
- 기기: iPhone 16 Pro 시뮬레이터 (iOS)
- 빌드: `expo run:ios` (dev build, EAS 아님)
- 백엔드: 로컬 Supabase CLI 스택 (`supabase start`)
- Supabase Google provider: `external.google = true`, 실 OAuth 클라이언트 ID 적용
- Google 계정: 실 Google 계정 사용

**검증 절차 및 관측 결과:**

1. 앱 실행 → 로그인 화면 표시
2. "Google로 계속하기" 버튼 탭
3. **네이티브 in-app Google 계정 선택 시트 표시** (외부 브라우저 없음 — AC-1 PASS)
4. 실 Google 계정 선택 후 로그인
5. `signInWithIdToken`이 Supabase 세션 생성:
   - `auth.users.last_sign_in_at: 2026-06-17T17:19:03` (UTC)
   - `auth.sessions`: 1행 생성 확인 — AC-2 PASS
6. native→web bridge `session:restore` 메시지 주입 → 웹 `setSession` 성공 — AC-3 PASS
7. 백엔드 `GET /me` 호출 → Profile 생성 (`name` 초기 null)
8. 앱이 이름 온보딩 화면으로 전환, Google `user_metadata.name` "하태용" prefill 표시 — AC-5 PASS

**AC-4 (이메일 signup 이름 배선)**: 자동 vitest PASS (이전 sync 포함).

**AC-6a/6b (취소·오류 → 미인증 유지, 토큰/자격증명 미노출)**: 순수 로직 vitest PASS + 로깅 없는 설계 구조적 보장.

---

## 4. AC별 최종 판정

| AC | 내용 | 판정 | 검증 방법 |
|----|------|------|----------|
| AC-1 | Google 버튼 → 네이티브 in-app SDK (외부 브라우저 없음) | **PASS** | iOS 시뮬레이터 라이브 E2E 2026-06-17 |
| AC-2 | `signInWithIdToken` → Supabase 세션 획득 | **PASS** | auth.sessions 1행 확인 |
| AC-3 | `session:restore` bridge 주입 → 웹 세션 확립 | **PASS** | iOS 시뮬레이터 라이브 E2E |
| AC-4 | 이메일 signup 이름 배선 (signUpAction name) | **PASS** | backend jest (profile 38건) |
| AC-5 | 온보딩 화면 + Google 이름 prefill | **PASS** | iOS 시뮬레이터 라이브 E2E (이름 "하태용" prefill 확인) |
| AC-6a | 사용자 취소 → 미인증 유지, 토큰 저장 없음 | **PASS** | 순수 로직 vitest + 로깅 없는 설계 |
| AC-6b | `signInWithIdToken` 실패 → 복구 가능 오류 상태, 자격증명 미노출 | **PASS** | 순수 로직 vitest + 로깅 없는 설계 |

모든 AC PASS → status `completed` 전환 정당.

---

## 5. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOBILE-004/spec.md` | 수정 | frontmatter(status: in-progress→completed, v0.2.0→v0.3.0, updated: 2026-06-17), HISTORY v0.3.0 추가, 섹션 7 구현 노트 추가 |
| `CHANGELOG.md` | 수정 | MOBILE-004 항목 updated — completed 전환, bridge command 설계 변경, 라이브 E2E 결과, 신규 파일(withModularHeaders.js) 반영 |
| `.moai/project/structure.md` | 수정 | mobile hooks 설명(bridge command), mobile lib/auth bridge-protocol 설명 갱신, `plugins/withModularHeaders.js` 신규 항목, web lib/native-bridge bridge-protocol 설명 갱신, 워크스페이스 패키지 표 status 갱신, RN 웹뷰 현황 타이틀 갱신 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록 갱신(completed, 라이브 E2E 결과), 구현됨 표 MOBILE-004 행 갱신(completed, 설계 변경 내용), mobile 프레임워크 표 특이사항 갱신, 설정 파일 위치 표 6건 추가(withModularHeaders.js, _layout.tsx configure, bridge-protocol 양쪽) |
| `.moai/reports/sync-report-SPEC-MOBILE-004-v2.md` | 신규 | 본 문서 |

---

## 6. follow-up 과제 (본 sync에서 처리하지 않은 항목)

### 6-1. Apple Sign-In (별도 follow-up SPEC)

Apple Developer Program 미가입으로 본 SPEC에서 제외(§4 Exclusions). iOS App Store 제출 시 App Store Review Guideline 4.8 적용 — 서드파티 소셜 로그인(Google) 제공 시 Sign in with Apple도 동등하게 제공해야 함. 본 SPEC의 이름 온보딩·세션 흐름은 provider 비종속 설계로 Apple 추가를 차단하지 않음. 별도 follow-up SPEC 필요.

### 6-2. 프로덕션 OAuth/redirect 일반화 (SPEC-AUTH-002 OD-4)

이번 검증은 로컬 Supabase + 로컬 OAuth 클라이언트 ID 환경에서 수행됨. 프로덕션 배포 시:
- 프로덕션 Supabase Google provider 설정
- 프로덕션 Google OAuth 클라이언트 ID
- 프로덕션 도메인 콜백 URL 등록

이 항목은 SPEC-AUTH-002 OD-4 범위로 별도 follow-up.

### 6-3. 중요 cross-SPEC 관찰 — SPEC-MOBILE-001/002/003 및 SPEC-WEBVIEW-SHELL-001

이번 라이브 Google 로그인 성공(iOS 시뮬레이터 + 실 Google 계정, `signInWithIdToken` → Supabase 세션 확인)은 아래 SPEC들이 `in-progress` 상태를 유지하는 주요 원인인 "Google OAuth 라운드트립 on device" 게이트를 실질적으로 충족하는 증거다:

| SPEC | 현재 status | 대기 중인 device-gated 항목 |
|------|-------------|----------------------------|
| SPEC-MOBILE-001 | in-progress | 디바이스 종단(R-P2), Google OAuth 라운드트립 |
| SPEC-MOBILE-002 | in-progress | 디바이스 종단 OAuth/핸드셰이크 검증(AC-V3) |
| SPEC-MOBILE-003 | in-progress | Google OAuth 라운드트립(실계정 수동 검증) |
| SPEC-WEBVIEW-SHELL-001 | in-progress | 디바이스 종단(AC-S3) |

**중요**: 본 sync는 이 4개 SPEC의 status를 변경하지 않는다. 각 SPEC은 독립적으로 per-AC 상태 검토가 필요하다. 이번 MOBILE-004 검증 결과를 근거로 각 SPEC별 전용 sync에서 검토할 것을 권장한다.

---

status: sync complete (SPEC-MOBILE-004 v0.3.0, completed)
