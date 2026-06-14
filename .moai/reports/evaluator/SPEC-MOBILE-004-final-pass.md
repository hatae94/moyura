# Evaluation Report

SPEC: SPEC-MOBILE-004 (네이티브 Google 로그인 + 이름 온보딩)
Harness: standard | Profile: default
Evaluated: 2026-06-15
Overall Verdict: **PASS**

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 75/100 | PASS | AC-3/4/7/8 코드+테스트 검증. AC-1/2/5/6a/6b UNVERIFIED(device-gated, 예상됨). |
| Security (25%) | 75/100 | PASS | Critical/High 없음. Medium 1건(범위 외 경로). |
| Craft (20%) | 75/100 | PASS | 전체 branch 85.36% ≥ 85%. 214+187 테스트 통과. dead code 1건. |
| Consistency (15%) | 90/100 | PASS | bridge-protocol v1 재사용, @MX:ANCHOR 보존, pure-core 패턴 일관. |

---

## Gate Results

| Gate | Result | Detail |
|------|--------|--------|
| backend test (214) | PASS | 214/214 통과 |
| backend branch coverage | PASS | All files 85.36% (≥ 85%) |
| backend tsc | PASS | 0 errors |
| prisma migrate status | PASS | clean, additive column |
| mobile test (187) | PASS | 187/187 통과 |
| mobile tsc --noEmit | PASS | 0 errors |
| expo export --platform ios | PASS | 번들 3.3MB 생성 |
| web build (Next.js) | PASS | 12/12 페이지 생성 |

---

## Functionality (AC별 검증)

### AC-1/2/5 (UNVERIFIED — device-gated)

네이티브 SDK 로그인 → signInWithIdToken → session:restore 실제 주입은 EAS dev build + 실기기 환경에서만 검증 가능. 자동화 게이트의 선행 조건(tsc, expo export, 코어 테스트)은 모두 통과함.

### AC-3 (PASS)

`requireNamedSession()` 서버사이드 가드가 `(main)/layout.tsx`(L38)와 `me/page.tsx`(L10)에 모두 적용됨. 세션 있음 + `Profile.name` null → `/onboarding` redirect. `/onboarding`은 `(main)` 밖 → 루프 구조적 불가능(onboarding/page.tsx L4-5 주석 명시).

### AC-4 (PASS)

`signUpAction` (actions.ts L44): `formData.get("name")` trim → `options.data.name` → `supabase.auth.signUp`. 세션 확립 후 `api.patchMe(name)` 호출(L69). PATCH 실패 시 가입은 유효 + `(main)` 가드가 온보딩 리다이렉트 안전망(L71-74 주석). `me.controller.spec.ts` T-002 테스트가 200/401/400 모두 커버.

### AC-6a/6b (UNVERIFIED — device-gated, 코어는 PASS)

`classifyGoogleSignInResult` 19개 테스트: 취소 코드(`SIGN_IN_CANCELLED`)/resolve 취소 타입(`cancelled`, `noSavedCredentialFound`) → `{kind:'cancelled'}`, AC-6b credential non-leakage 명시 검증 포함. `classifyIdTokenSession` 17개 테스트: `error.message`에 토큰 포함 시도 → reason 비노출 검증. 런타임 동작(SecureStore 토큰 0 검증)은 device-gated.

### AC-7 (PASS)

데스크톱 웹은 `isOAuthAuthorizeUrl(url, supabaseBaseUrl)` 인터셉트가 없으므로 기존 `signInWithOAuthAction` 경로 유지(auth-bridge-core.ts `decideWebViewLoad` 분기 확인). 이름 온보딩 가드는 `requireNamedSession()`이 서버사이드에서 적용되어 데스크톱도 자동 커버.

### AC-8 (PASS)

`submitNameAction` (onboarding/actions.ts L29): `name.trim()` 빈 값 → `{ error: "이름을 입력해 주세요." }` 반환(redirect 없음 → 온보딩 유지). 백엔드 실패 → generic `GENERIC_ERROR` 반환(L54, 토큰/status 비노출). `me.controller.spec.ts` T-002가 빈/공백 → 400 검증.

---

## Findings

### [MEDIUM] apps/web/app/moims/[id]/chat/page.tsx — 이름 온보딩 가드 미적용

`/moims/[id]/chat`은 Client Component이며 서버사이드 `requireNamedSession()` 가드가 없다. `Profile.name=null`인 사용자가 이 URL에 직접 접근하면 이름 온보딩을 거치지 않고 페이지가 렌더링된다(실제 API 호출은 백엔드 가드가 401로 막음). SPEC-MOBILE-004의 보호 대상은 `(main)` 경로와 `/me`로 명시되어 있어 이 경로는 SPEC **범위 밖**이나, 향후 SPEC에서 커버가 필요함.

**구체적 재현 경로**: 세션 있음 + `Profile.name=null` 상태 → `http://localhost:3000/moims/any-id/chat` 직접 접근 → 페이지 렌더링됨(API 호출은 401).

### [LOW] apps/mobile/hooks/useAuthBridge.ts L165 — runOAuthBridge dead code

`runOAuthBridge`는 `useCallback`으로 정의되어 있으나 `oauth-intercept` 케이스에서 `nativeGoogleSignInRef.current()`로 교체된 이후 실제 호출 경로가 없다. 주석은 "비-Google provider/수동 폴백 용도"라 명시하지만 현재 어떤 경로도 이를 호출하지 않는다. 렌더링마다 useCallback 클로저 비용 발생.

### [LOW] apps/backend/src/profile/me.controller.ts L82-86 — requireNonEmpty typeof 분기 미테스트

`requireNonEmpty`의 `typeof value !== 'string'` 분기(body.name이 undefined/non-string일 때)가 테스트되지 않아 `profile` 모듈 branch coverage가 78.26%다. 전체 branch 85.36%는 임계값 통과이지만, PATCH /me에서 `UpdateNameDto.name`이 undefined로 올 수 있는 케이스(ValidationPipe 없음)를 명시 테스트하면 더 견고해진다.

### [INFO] apps/mobile/lib/auth/google-signin-core.ts L36 — Android 취소 코드 "12501" 테스트 누락

`CANCEL_CODES`에 `"12501"`이 방어적으로 포함되어 있으나 테스트에서 이 코드의 `cancelled` 분류를 검증하지 않는다. 런타임에서 이 코드가 실제 발생할 때 예상대로 동작하는지 단위 테스트로 보강하면 좋다.

---

## Security Deep-Dive

### 온보딩 가드 우회 가능성

SPEC 보호 범위 내(`(main)`, `/me`)에서는 우회 불가능:
- `(main)/layout.tsx`: `requireNamedSession()` 서버사이드 강제 — React 클라이언트 라우팅이 레이아웃을 건너뛰지 못함
- `me/page.tsx`: 독자적 `requireNamedSession()` 호출
- `/onboarding`: `(main)` 밖 → 이름 가드 루프 없음; 이름 보유 시 `/home` redirect(loop-safe)

### 리다이렉트 루프

`(main)/layout.tsx` → `requireNamedSession()` → name 없음 → `/onboarding`. `/onboarding`은 `(main)` 밖이므로 `(main)/layout.tsx` 가드가 재실행되지 않음. 구조적으로 루프 불가능(onboarding/page.tsx L4-8 확인).

### PATCH /me mass-assignment

`UpdateNameDto`에 `name` 필드만 존재. `me.controller.ts` L72: `this.profileService.updateName(user.sub, name)` — `user.sub`는 `SupabaseAuthGuard` 검증된 값만 사용, `body`의 `id`/`sub` 필드는 컨트롤러가 무시. `me.controller.spec.ts` T-002 mass-assignment 테스트 확인(L209-226, verifiedSub vs attackerSub).

### 토큰/자격증명 노출

- `google-signin-core.ts`: `reason`에 고정 사유 코드 문자열만 사용, `idToken` 값 미포함
- `signin-id-token-core.ts`: `error.message` → reason 비전달, access/refresh token 미포함
- `supabase-mobile.ts`: `exchangeGoogleIdTokenForSession` catch → core classifier 위임, 로깅 없음
- `useAuthBridge.ts`: `nativeGoogleSignInRef.current()` catch(L358) → void, 로깅 없음
- `submitNameAction`: PATCH 실패 → `console.error`에 status만 기록, 토큰/본문 미노출

### bridge-protocol v1

`BRIDGE_MESSAGE_TYPES` 5종(`session:restore`, `session:synced`, `session:none`, `session:cleared`, `resume:revalidate`) 변경 없음. 새 메시지 타입 추가 없음. `useAuthBridge.ts` oauth-intercept에서 `nativeGoogleSignInRef.current()`가 기존 `injectRestore`(session:restore v1)를 재사용함(L351 확인).

### @MX:ANCHOR 보존

`useAuthBridge.ts` L128-138: 팬-인 증가(App.tsx + resume + 네이티브 SDK 경로, ≥3)로 ANCHOR 갱신됨. 기존 보안 불변식(origin allowlist, LIVE origin 재검증, specific targetOrigin, nonce 인증, 토큰 비로깅) 모두 명시 보존.

### onboarding form XSS

`onboarding-form.tsx`: `dangerouslySetInnerHTML` 사용 없음. `profile.name` 렌더링은 `me/page.tsx` L19 `{profile.name}` — React 기본 escape. `(main)/layout.tsx`의 `dangerouslySetInnerHTML`은 CSP nonce 부여된 인라인 셸 감지 스크립트(사용자 입력 없음) — XSS 위험 없음.

---

## Recommendations

1. **[MEDIUM] `/moims/[id]/chat` 가드 추가**: 해당 경로에 서버사이드 세션 + 이름 가드 또는 최소한 클라이언트사이드 리다이렉트 로직을 추가하여 이름 온보딩 우회를 방지할 것. SPEC-CHAT-001 또는 별도 SPEC으로 보호.

2. **[LOW] `runOAuthBridge` 정리**: 현재 호출 경로가 없는 dead code. 향후 Apple 등 비-Google provider 폴백으로 실제 사용 계획이 있으면 주석과 함께 보존하고, 없으면 제거하여 번들 크기와 렌더링 비용 절감.

3. **[LOW] `requireNonEmpty` non-string 분기 테스트 추가**: `body.name`이 `undefined`(Content-Type 오류 등)인 경우의 400 응답을 명시 테스트하면 `profile` 모듈 branch coverage가 85% 이상으로 개선됨.

4. **[INFO] Android 취소 코드 `"12501"` 단위 테스트 추가**: `google-signin-core.test.ts`에 `{ code: "12501" }` 입력 → `{kind:'cancelled'}` 케이스 1개 추가.

---

## Mobile Runtime UNVERIFIED Items

다음 AC는 디바이스 종단 검증(EAS dev build + 실기기)이 완료될 때까지 UNVERIFIED 상태로 유지된다. DoD의 "디바이스 종단 검증 완료" 체크박스 미완료 상태이므로 SPEC status는 in-progress 유지가 적합하다.

- AC-1: 신규 사용자 네이티브 SDK → signInWithIdToken → session:restore → /onboarding
- AC-2: 기존(이름 보유) 사용자 네이티브 SDK → /me 직행
- AC-5: session:restore 주입 + session:synced ack + 토큰 비로깅 런타임 검증
- AC-6a: 취소 시 SecureStore 토큰 0 확인
- AC-6b: signInWithIdToken 실패 시 SecureStore 토큰 0 + 버튼 재활성 확인
