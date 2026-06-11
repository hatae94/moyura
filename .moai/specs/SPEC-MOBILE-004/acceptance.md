# Acceptance: SPEC-MOBILE-004 — 모바일 네이티브 Google 로그인

> Given/When/Then 인수 시나리오 + 엣지 케이스 + 품질 게이트.
> 각 시나리오는 spec.md의 REQ-MOB4-XXX에 추적된다.

---

## 1. 인수 시나리오 (Given / When / Then)

### AC-1: 신규 사용자 Google 로그인 → 가입 + 온보딩 이름 입력 → /me (REQ-MOB4-001/002/004)

- **Given** Supabase에 계정이 없는 사용자가 모바일 앱의 WebView 로그인 페이지를 보고 있다
- **When** 사용자가 Google 로그인 버튼 동작을 트리거하면
- **Then** 앱은 동작을 인터셉트하고 네이티브 Google Sign-In SDK를 실행하며, 성공 시 `idToken`을 `signInWithIdToken`에 전달해 Supabase 세션을 생성하고, `saveTokens` 후 `session:restore`로 웹 세션을 주입한다
- **And** `Profile.name`이 null이므로 사용자는 이름 입력 온보딩 페이지로 강제 리다이렉트되고, Google `user_metadata`의 이름이 입력 필드에 prefill된다
- **And** 사용자가 이름을 확정하면 백엔드에 영속되고 `/me`로 진입한다

### AC-2: 이름 보유 기존 사용자 Google 로그인 → 온보딩 없이 직접 진입 (REQ-MOB4-001/002/004)

- **Given** `Profile.name`이 이미 채워진 기존 사용자가 WebView 로그인 페이지에 있다
- **When** 사용자가 Google 로그인을 완료하면
- **Then** 네이티브 SDK → `signInWithIdToken` → 세션 주입이 수행되고
- **And** `Profile.name`이 존재하므로 온보딩 리다이렉트 없이 `/me`로 바로 진입한다

### AC-3: 이름 미보유 기존 사용자 → 온보딩 리다이렉트 (REQ-MOB4-004)

- **Given** 계정은 있으나 `Profile.name`이 비어 있거나 null인 기존 사용자
- **When** Google 로그인을 완료하면
- **Then** 신규/기존 여부와 무관하게 `Profile.name` 미보유이므로 이름 온보딩 페이지로 리다이렉트되고
- **And** 이름을 입력하기 전까지 보호 경로(`/me`) 진입이 차단된다

### AC-4: 이메일 회원가입이 이름을 영속한다 (REQ-MOB4-003)

- **Given** 사용자가 웹/WebView 로그인 폼에서 회원가입 모드로 이름·이메일·비밀번호를 입력한다
- **When** `signUpAction`이 호출되면
- **Then** 폼의 `name` 값이 읽혀 가입 시 영속되고
- **And** 가입 후 `Profile.name`이 채워진 상태이므로 온보딩 리다이렉트가 발생하지 않는다 (이메일·소셜 경로가 동일 이름 수집 규칙을 따른다)

### AC-5: 네이티브 로그인 후 브리지 세션 주입 (REQ-MOB4-002)

- **Given** 네이티브 SDK 로그인이 성공해 Supabase access/refresh 토큰을 획득했다
- **When** 토큰이 `saveTokens`로 SecureStore에 저장되고 `session:restore` 메시지가 주입되면
- **Then** 웹은 신뢰 origin + nonce 검증을 통과한 메시지만 수용해 세션을 확립하고 `session:synced`로 회신한다
- **And** 토큰 값은 로그에 남지 않으며 bridge-protocol v1 메시지 타입은 변경되지 않는다(`session:restore`/`synced`/`cleared` 재사용)

### AC-6a: 사용자가 네이티브 SDK 로그인을 취소 (REQ-MOB4-005)

- **Given** 사용자가 WebView 로그인 페이지에 있다
- **When** 사용자가 네이티브 Google Sign-In을 **취소**하면
- **Then** 앱은 미인증 상태를 유지하고 로그인 페이지에 머무르며 토큰을 저장/주입하지 않는다(SecureStore 토큰 0)
- **And** Google 로그인 버튼이 재활성화되어 즉시 재시도할 수 있다

### AC-6b: signInWithIdToken 호출 실패 (REQ-MOB4-005)

- **Given** 네이티브 SDK 로그인은 성공해 `idToken`을 획득했으나 Supabase `signInWithIdToken`이 실패하는 조건(토큰 검증 실패·네트워크 오류·provider 미설정)이다
- **When** `signInWithIdToken`이 호출되어 실패하면
- **Then** 세션을 확립하지 않고 **복구 가능한 오류 상태**가 된다: WebView 로그인 페이지에 일반화된 오류 메시지가 표시되고, Google 버튼이 재활성화되며, SecureStore에 토큰이 저장되지 않는다(토큰 0)
- **And** 토큰 값이나 오류 상세에 자격증명이 노출되지 않는다

### AC-7: 데스크톱 웹 OAuth 로그인 흐름은 변경되지 않는다 (REQ-MOB4-001)

- **Given** 데스크톱 웹 브라우저(모바일 앱 WebView가 아닌) 사용자가 로그인 페이지에 있다
- **When** 사용자가 Google 로그인 버튼을 누르면
- **Then** 네이티브 SDK 인터셉트가 동작하지 않고 기존 `signInWithOAuthAction` 웹 OAuth 경로가 그대로 사용된다
- **And** 단, 로그인 후 `Profile.name` 미보유 사용자는 데스크톱에서도 이름 온보딩 가드(REQ-MOB4-004)로 리다이렉트된다

### AC-8: 이름 온보딩 제출 실패 (REQ-MOB4-005)

- **Given** 이름 온보딩 페이지에서 사용자가 빈 값을 제출하거나 백엔드 저장이 실패한다
- **When** 온보딩 이름 제출이 실패하면
- **Then** 시스템은 보호 경로(`/me`) 진입을 차단하고 온보딩 페이지에 머무른 채 일반화된 오류 메시지를 표시한다
- **And** 사용자가 이름을 재제출할 수 있다

---

## 2. 엣지 케이스 (Edge Cases)

> 다음은 위 번호 시나리오(AC-1~AC-8)에 추가되는 보조 검증 항목이다. DoD의 "위 인수 시나리오 통과"는 AC-1~AC-8을 의미한다.

- Google `user_metadata`에 이름이 없는 경우 온보딩 prefill은 빈 값으로 시작하고 입력을 강제한다.
- 콜드스타트 시 저장된 토큰이 있으면 기존 `injectRestore` 경로(SPEC-MOBILE-002)가 그대로 동작한다(본 SPEC이 깨지 않음).
- nonce가 로컬에서 `skip_nonce_check=true`인 상태에서도 브리지 nonce(per-session)는 기존대로 검증된다.
- provider 비종속 온보딩: 향후 Apple 추가 시 동일 온보딩/영속 경로를 분기 없이 재사용할 수 있어야 한다.

---

## 3. 품질 게이트 (Quality Gate Criteria)

- typecheck 0 error (web / backend / mobile)
- lint 0 error
- vitest 통과 (모바일 순수 코어 / 웹)
- web build 통과
- `expo export` 통과
- Prisma 마이그레이션 적용 성공 (`Profile.name` nullable)

---

## 4. Definition of Done

- [ ] REQ-MOB4-001~005 모두 구현 및 위 인수 시나리오(AC-1~AC-8, AC-6a/AC-6b 포함) 통과
- [ ] `Profile.name` 마이그레이션 적용, 이메일·소셜 경로 모두 이름 영속
- [ ] 이름 온보딩 페이지 + 보호 경로 가드 동작(provider 비종속)
- [ ] 기존 `session:restore` 브리지 경로 재사용(v1 무변경), @MX:ANCHOR(useAuthBridge L103–109) 보존
- [ ] 구현 중 확인 체크포인트(plan §3) 5개 항목 점검 완료
- [ ] 자동 게이트 전체 통과
- [ ] **디바이스 종단 검증 완료** — EAS dev build 실기기에서 신규/기존/무이름 3 케이스 검증 (이 항목 완료 전까지 status는 in-progress 유지)
