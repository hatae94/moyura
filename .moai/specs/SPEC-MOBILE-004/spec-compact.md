# SPEC-MOBILE-004 (Compact)

모바일 네이티브 Google 로그인 (Native SDK + Supabase signInWithIdToken). status: draft / priority: high.

## Requirements

- **REQ-MOB4-001 (Event-driven)**: WebView 내 Google 버튼 동작을 인터셉트 → 네이티브 Google Sign-In SDK 실행 → `idToken`을 `signInWithIdToken({ provider: 'google' })`로 Supabase 세션 획득. 데스크톱 웹 OAuth **로그인 흐름** 무변경(로그인 후 이름 온보딩 가드는 데스크톱에도 적용 — REQ-004).
- **REQ-MOB4-002 (Event-driven)**: 세션 토큰을 `saveTokens`로 SecureStore 저장 + 기존 `session:restore` 브리지로 주입(bridge-protocol v1 무변경). 토큰 비로깅, origin allowlist + nonce 보장(useAuthBridge L103–109 @MX:ANCHOR).
- **REQ-MOB4-003 (Ubiquitous)**: 이메일 가입과 동일하게 Google(향후 Apple) 로그인도 이름 수집·영속. `Profile.name`(nullable) 추가 + `signUpAction` name 배선. 모든 인증 경로가 단일 이름 수집·영속 경로(provider 비종속) 공유. (보충: 구현 단계 검증 체크포인트 — plan §3, 비규범 노트.)
- **REQ-MOB4-004 (Event-driven / State-driven 혼합)**: **WHEN** `Profile.name` 비어있음/null → 이름 온보딩 페이지 강제 리다이렉트. **WHILE** name 미보유 동안 보호경로(`/me`) 차단. **WHEN** Google `user_metadata` 이름 존재 → 입력 필드 prefill. 신규/기존 판별 = name 보유 여부(timestamp 비의존). provider 비종속, WebView/데스크톱 공용.
- **REQ-MOB4-005 (Unwanted behavior)**: SDK 취소 → 미인증 유지·미주입(토큰 0). `signInWithIdToken` 실패 → 세션 미확립 + 복구 가능 오류 상태(로그인 페이지 오류 메시지 표시 + Google 버튼 재활성화 + SecureStore 토큰 0 + 자격증명 비노출). 온보딩 제출 실패 → 보호경로 차단·오류 표시·재제출 허용.

## Acceptance Criteria

- AC-1: 신규 Google 로그인 → 가입 + 온보딩 이름 입력(prefill) → /me
- AC-2: 이름 보유 기존 사용자 → 온보딩 없이 직접 /me
- AC-3: 이름 미보유 기존 사용자 → 온보딩 리다이렉트
- AC-4: 이메일 회원가입이 name 영속 → 온보딩 미발생
- AC-5: 네이티브 로그인 후 `session:restore` 주입 → 웹 세션 확립·`session:synced` 회신, v1 무변경
- AC-6a: SDK 로그인 취소 → 미인증 유지·미주입, Google 버튼 재활성화
- AC-6b: `signInWithIdToken` 실패 → 세션 미확립·복구 가능 오류(오류 메시지·버튼 재활성화·토큰 0·자격증명 비노출)
- AC-7: 데스크톱 웹 OAuth 로그인 흐름 무변경(단 로그인 후 이름 온보딩 가드는 데스크톱에도 적용)
- AC-8: 이름 온보딩 제출 실패 → 보호경로 차단·오류 표시·재제출 허용

## Files to Modify

- [MODIFY] `apps/backend/prisma/schema.prisma` — `Profile.name String?` 추가 + 마이그레이션
- [MODIFY] `apps/web/lib/auth/actions.ts` — `signUpAction`(L30–47) name 영속 배선
- [MODIFY] `apps/web/app/login/login-form.tsx` — 이름 필드(L181–194) action 정합
- [MODIFY] `apps/mobile/hooks/useAuthBridge.ts` — Google 버튼 인터셉트 분기(@MX:ANCHOR 경계 확장)
- [MODIFY] `apps/backend/src/profile/me.controller.ts` / `profile.service.ts` — 이름 업데이트 엔드포인트(예: PATCH /me)
- [NEW] `apps/mobile` 의존성: `@supabase/supabase-js` + `@react-native-google-signin/google-signin`
- [NEW] 네이티브 Google Sign-In 모듈 + `signInWithIdToken` 래퍼
- [NEW] 이름 온보딩 웹 페이지(provider 비종속) + 보호경로 진입 가드
- [NEW] `app.json` config plugin + Google Cloud Console iOS/Android 클라이언트 ID
- [EXISTING] `token-store.ts`, `bridge-protocol.ts`(v1), `auth/callback/route.ts`, `GET /me` UPSERT — 보존

## Exclusions (What NOT to Build)

- Apple Sign-In 구현 (별도 follow-up SPEC; 단 설계는 provider 비종속)
- prod OAuth 배선 (OD-4) / prod nonce 강제 분리 (OD-5)
- expo-router 도입 + 네이티브 라우트 (SPEC-MOBILE-003 범위)
- RBAC / 권한 모델
- iOS App Store 제출 (App Store 4.8 리스크 → Android 우선)
- 이메일 확인 / 비밀번호 재설정 (R-G6)
- 네이티브 RN 로그인 화면 (WebView 웹 로그인 UI 유지)
