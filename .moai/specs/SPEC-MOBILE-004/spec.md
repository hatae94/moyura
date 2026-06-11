---
id: SPEC-MOBILE-004
version: 0.1.0
status: draft
created: 2026-06-11
updated: 2026-06-11
author: hatae
priority: high
issue_number: 0
---

# SPEC-MOBILE-004: 모바일 네이티브 Google 로그인 (Native SDK + Supabase signInWithIdToken)

## HISTORY

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
