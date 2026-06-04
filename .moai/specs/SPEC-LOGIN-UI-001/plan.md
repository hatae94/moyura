---
id: SPEC-LOGIN-UI-001
version: 0.1.0
status: draft
created: 2026-06-04
updated: 2026-06-04
---

# Implementation Plan — SPEC-LOGIN-UI-001

/ moai run 이 이 순서대로 실행한다. 시간 추정 없음 — 우선순위 + 단계 순서.

## Technical Approach

- 기존 `app/login/login-form.tsx`의 시각을 Figma Make "Meetup" LoginScreen 디자인으로 교체하고,
  `app/login/page.tsx`가 이를 호스팅하도록 조정한다.
- 두 뷰(소셜 랜딩 / 이메일 폼) + `isSignUp` + loading/error는 client component 로컬 state로 관리
  (`'use client'`).
- 인증은 신규 로직 없이 기존 server action(`signInAction`, `signUpAction`,
  `signInWithOAuthAction`)에만 배선. 이메일/비번은 기존 패턴대로 `useActionState`로 처리하고,
  필요 시 `useTransition`을 병용한다(기존 login-form 패턴과 일관되게).
- 소셜 버튼은 OD-1에 따라 `signInWithOAuthAction(formData)`의 실제 시그니처(hidden `provider`
  필드를 가진 `<form>`)에 맞춰 배선한다.
- 아이콘: `lucide-react`(`Mail`, `Apple`) 추가, `GoogleIcon`은 인라인 SVG 컴포넌트로 유지.

## Milestones (priority-ordered)

### M1 — Add dependency (Priority: High)
- `apps/web/package.json`에 `lucide-react` 런타임 의존성 추가 후 워크스페이스 설치.
- 검증: `Mail`, `Apple` import 가능.
- 충족: R-F1.

### M2 — Build LoginScreen client component, 2 views verbatim (Priority: High)
- `'use client'` 컴포넌트로 소셜 랜딩 뷰(R-A1~R-A5)와 이메일 폼 뷰(R-B1~R-B5)를 디자인 클래스·
  카피·아이콘 그대로 구현.
- `showEmailForm` / `isSignUp` 토글 및 뒤로/토글 링크 동작(R-C1~R-C4).
- 브랜딩 텍스트 VERBATIM("Meetup", 🎉, 모든 한국어 카피).
- 충족: Group A, Group B, R-C1~R-C4, R-H1.

### M3 — Wire to existing auth actions (Priority: High)
- Google/Apple → `signInWithOAuthAction`(provider "google"/"apple", OD-1 form 패턴).
- 이메일/비번 → `signInAction`(로그인) / `signUpAction`(회원가입, name optional).
- `supabase.auth` 직접 호출·edge-function·`alert()`/`console.log` 사용 금지(R-D3).
- 성공 시 기존 리다이렉트(`/me`) 따름.
- 충족: R-D1~R-D4.

### M4 — Loading and error states (Priority: Medium)
- 제출 중 submit 버튼 disable + "처리 중..." 라벨; 평상시 "가입하기"/"로그인"(R-E1, R-E2).
- 액션 에러를 `bg-red-50` 에러 박스에 표시. `useActionState` 에러와 서버 `?error=` 초기값을
  함께 반영(OD-2).
- 충족: R-E1~R-E3.

### M5 — Replace page.tsx and prune scaffold (Priority: Medium)
- `app/login/page.tsx`가 새 LoginScreen을 호스팅하도록 조정. 기존 Kakao 포함 소셜 스캐폴드 마크업
  제거(Kakao UI 미노출, R 제외 항목).
- 서버 컴포넌트의 `searchParams.error` 초기값을 client 컴포넌트로 전달(OD-2).
- 충족: Non-Goals(Kakao 미노출), R-C4 호스팅.

### M6 — Verify (Priority: Medium)
- `apps/web`에서 build + typecheck 통과 확인(증거 출력).
- Tailwind v4 팔레트 토큰 직접 매핑 확인(OD-6).
- 소셜 랜딩 / 이메일 폼 두 뷰 시각 확인 + 토글 동작 확인.
- 접근성 baseline(라벨-인풋 연결, 버튼 텍스트, 키보드 제출) 확인(R-G1).
- 가능하면 RN WebView 호스트에서 full-screen 렌더 확인(OD-5).

## Risks

- OD-1: OAuth 액션 시그니처가 brief 표현과 다름 → form+hidden 패턴으로 배선해야 함.
- OD-2: 에러 채널 이원화(useActionState vs `?error=`) → 에러 박스 통합 처리 필요.
- OD-3/OD-6: 디자인 폰트 vs 웹 기존 폰트, Tailwind v4 팔레트 매핑 — 구현 시 시각 검증.
- OD-5: RN WebView 내 `size-full` full-screen 렌더 미확인.

## Files in Scope

- `apps/web/package.json` (M1)
- `apps/web/app/login/login-form.tsx` (M2~M4, 디자인 교체 — 이름/구조 조정 가능)
- `apps/web/app/login/page.tsx` (M5)

비대상: `apps/web/lib/auth/actions.ts`(읽기 전용 재사용), `/me` 등 기타 화면.
