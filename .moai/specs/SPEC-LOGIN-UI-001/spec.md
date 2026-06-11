---
id: SPEC-LOGIN-UI-001
version: 0.1.0
status: completed
created: 2026-06-04
updated: 2026-06-04
author: hatae
priority: medium
issue_number: null
---

# SPEC-LOGIN-UI-001 — Login Screen Design Port ("Meetup")

## HISTORY

- 2026-06-04 (v0.1.0): 최초 작성(draft). 사용자의 Figma Make "Meetup" LoginScreen 디자인을
  `apps/web` 로그인 화면에 그대로 이식하고, 기존 SPEC-AUTH-001 인증 액션에 배선하는 SPEC.
- 2026-06-04 (v0.1.0): 구현 완료(status: completed). M1~M6를 expert-frontend에 위임 구현 후
  typecheck/lint/build 통과 + 금지패턴 grep 0건으로 검증. `feature/SPEC-LOGIN-UI-001 @ 4aba164`.
  상세는 하단 Implementation Notes 참조.

## Background

사용자가 Figma Make에서 직접 만든 "Meetup" 앱의 LoginScreen 디자인을 `apps/web`의 기존 로그인
화면(SPEC-AUTH-001에서 스캐폴드된 `app/login/page.tsx`, `app/login/login-form.tsx`)에 **그대로**
이식한다. 디자인은 plain Tailwind utility + `lucide-react` 아이콘 + 인라인 `GoogleIcon` SVG로
구성된 자족적(self-contained) React 컴포넌트이며, 로컬 state로 토글되는 두 개의 뷰(소셜 랜딩 /
이메일 폼)를 가진다.

핵심 원칙: **시각(visual)은 디자인 소스를 그대로 따르되, 데이터 계층은 moyura의 기존 인증을
재사용한다.** Figma Make 원본은 `supabase.auth`를 직접 호출하고 커스텀 edge-function 회원가입과
`alert()`/`console.log` 플레이스홀더를 사용했으나, 이는 모두 폐기한다. moyura에는 이미
`apps/web/lib/auth/actions.ts`에 server action(`signInAction`, `signUpAction`,
`signInWithOAuthAction`)이 존재하며, 이식된 UI는 이 액션들을 호출한다.

## Goal

Figma Make "Meetup" LoginScreen의 두 뷰(소셜 랜딩 / 이메일 폼)를 브랜딩 텍스트·아이콘·Tailwind
클래스까지 동일하게 재현하면서, 기존 SPEC-AUTH-001 server action에 배선하여 실제 로그인/회원가입/
소셜 진입점이 동작하는 로그인 화면을 `apps/web`에 제공한다.

## Non-Goals / Exclusions (What NOT to Build)

- **신규 인증 로직 없음**: 새 server action, 세션 관리, 쿠키 로직을 만들지 않는다. 기존
  `apps/web/lib/auth/actions.ts`의 액션만 호출한다.
- **Kakao UI 없음**: SPEC-AUTH-001이 스캐폴드한 Kakao provider는 이 화면에 노출하지 않는다.
  소셜 버튼은 Google / Apple / Email 3종만 렌더한다(디자인 일치).
- **이메일 확인 / 비밀번호 재설정 UI 없음**: 해당 흐름은 SPEC-AUTH-001 범위에서도 제외되어 있으며
  이 SPEC에서도 만들지 않는다.
- **다른 앱 화면 없음**: 로그인 화면(`app/login/`)만 대상이다. `/me` 등 리다이렉트 대상 화면은
  손대지 않는다.
- **디자인 재설계 / 이탈 없음**: 소스 디자인의 색상·여백·카피·구조를 임의로 개선하거나
  변경하지 않는다. "그대로 구현"이 원칙이다.
- **약관 / 개인정보 링크 구현 없음**: 푸터의 약관·개인정보 문구는 디자인상 underline 스타일의
  비기능 텍스트로 유지한다(라우팅 대상 미정 — Open Decisions 참조).
- **신규 데이터 계층 없음**: Figma Make 원본의 `supabase.auth` 직접 호출, edge-function 회원가입,
  `alert()`/`console.log`는 모두 폐기한다.

## EARS Requirements

### Group A — Visual Fidelity: Social Landing View

- **R-A1 (State-Driven)**: WHILE `showEmailForm === false`, the login screen SHALL render the
  social landing view with outer structure
  `div.size-full.flex.flex-col.bg-white > div.flex-1.flex.flex-col.items-center.justify-center.px-6.py-12 > div.w-full.max-w-md`.

- **R-A2 (Ubiquitous)**: The social landing header SHALL render the logo badge
  (`div.inline-flex.items-center.justify-center.w-16.h-16.bg-blue-600.rounded-2xl.mb-4`
  containing `span.text-3xl` "🎉"), the title `h1.text-3xl.font-bold.mb-3` exactly "Meetup",
  and the subtitle `p.text-gray-600` "간편하게 모임을 만들고<br/>일정, 장소, 투표를 한곳에서".

- **R-A3 (Ubiquitous)**: The social landing view SHALL render exactly three primary buttons in a
  `flex.flex-col.gap-3` container — a Google outline button (inline `GoogleIcon` 20×20 SVG +
  "Google로 계속하기"), an Apple solid-black button (lucide `<Apple size={20} />` +
  "Apple로 계속하기"), and an Email outline button (lucide `<Mail size={20} />` +
  "이메일로 계속하기") — with the exact utility classes specified in the design source.

- **R-A4 (Ubiquitous)**: The social landing view SHALL render a divider (`relative.my-4`) with a
  centered `span.px-2.bg-white.text-gray-500.text-sm` "또는" over a `border-t.border-gray-300` line,
  positioned between the Apple button and the Email button.

- **R-A5 (Ubiquitous)**: The social landing footer SHALL render
  `p.text-xs.text-gray-500.text-center.mt-8` "계속 진행하면 [이용약관] 및 [개인정보처리방침]에
  동의하는 것으로 간주됩니다" where 이용약관/개인정보처리방침 are `span.underline` non-functional text.

### Group B — Visual Fidelity: Email Form View

- **R-B1 (State-Driven)**: WHILE `showEmailForm === true`, the login screen SHALL render the email
  form view with outer structure
  `div.size-full.flex.flex-col.bg-white > div.flex-1.flex.flex-col.px-6.py-8`, beginning with a
  back button `button.self-start.text-gray-600.mb-8` "← 뒤로".

- **R-B2 (State-Driven)**: WHILE `isSignUp === true`, the email form view SHALL render the heading
  `h1.text-2xl.font-bold.mb-2` "회원가입" and subtitle `p.text-gray-600.mb-8`
  "새로운 계정을 만들어주세요"; WHILE `isSignUp === false` it SHALL render heading "로그인" and
  subtitle "이메일로 계속하기".

- **R-B3 (Ubiquitous)**: The email form (`form.flex.flex-col.gap-4`) SHALL render an email field
  (label "이메일", `input[type=email]` placeholder "example@email.com") and a password field
  (label "비밀번호", `input[type=password]` placeholder "••••••••"), with inputs styled
  `w-full.px-4.py-3.border.border-gray-300.rounded-lg.focus:outline-none.focus:ring-2.focus:ring-blue-500`
  and labels styled `block.text-sm.font-medium.mb-2`.

- **R-B4 (State-Driven)**: WHILE `isSignUp === true`, the email form SHALL additionally render a
  name field (label "이름", `input` placeholder "홍길동") above the email field; WHILE
  `isSignUp === false` the name field SHALL NOT be present.

- **R-B5 (Ubiquitous)**: The email form SHALL render a submit button
  `button[type=submit].w-full.bg-blue-600.text-white.py-3.rounded-lg.font-medium.hover:bg-blue-700.transition-colors.mt-4.disabled:opacity-50`
  and a toggle link below the form (`mt-6.text-center > button.text-blue-600.text-sm`).

### Group C — View Toggle and Form State

- **R-C1 (Event-Driven)**: WHEN the user activates the Email button ("이메일로 계속하기") in the
  social landing view, the login screen SHALL set `showEmailForm = true` and render the email form view.

- **R-C2 (Event-Driven)**: WHEN the user activates the back button ("← 뒤로") in the email form view,
  the login screen SHALL set `showEmailForm = false` and render the social landing view.

- **R-C3 (Event-Driven)**: WHEN the user activates the toggle link in the email form view, the login
  screen SHALL invert `isSignUp`; the link label SHALL be "이미 계정이 있으신가요? 로그인" while
  `isSignUp === true` and "계정이 없으신가요? 회원가입" while `isSignUp === false`.

- **R-C4 (Ubiquitous)**: The login screen SHALL be a client component (`'use client'`) holding
  `showEmailForm`, `isSignUp`, and loading/error UI state locally.

### Group D — Auth Wiring to Existing Actions

- **R-D1 (Event-Driven)**: WHEN the user activates the Google button, the login screen SHALL invoke
  the existing `signInWithOAuthAction` with provider `"google"`; WHEN the user activates the Apple
  button, it SHALL invoke `signInWithOAuthAction` with provider `"apple"`.

- **R-D2 (Event-Driven)**: WHEN the email form is submitted while `isSignUp === false`, the login
  screen SHALL invoke the existing `signInAction` with the email and password fields; WHEN submitted
  while `isSignUp === true`, it SHALL invoke the existing `signUpAction` with the name (optional),
  email, and password fields.

- **R-D3 (Unwanted Behavior)**: IF an authentication action is invoked, THEN the login screen SHALL
  NOT call `supabase.auth` directly, SHALL NOT call any custom signup edge function, and SHALL NOT use
  `alert()` or `console.log` for user feedback.

- **R-D4 (Event-Driven)**: WHEN an authentication action succeeds, the login screen SHALL follow the
  existing redirect behavior defined by the action (redirect to `/me`).

### Group E — Loading and Error States

- **R-E1 (State-Driven)**: WHILE an email-form authentication action is pending, the submit button
  SHALL be disabled (`disabled:opacity-50`) and its label SHALL read "처리 중...".

- **R-E2 (State-Driven)**: WHILE no action is pending, the submit button label SHALL read "가입하기"
  when `isSignUp === true` and "로그인" when `isSignUp === false`.

- **R-E3 (Event-Driven)**: WHEN an authentication action returns an error, the login screen SHALL
  render the error message inside an error box
  `div.bg-red-50.text-red-600.px-4.py-3.rounded-lg.text-sm` at the top of the form.

### Group F — Dependency and Build

- **R-F1 (Ubiquitous)**: The `apps/web` package SHALL declare `lucide-react` as a runtime dependency
  for the `Mail` and `Apple` icon components, and the `GoogleIcon` SHALL remain an inline SVG component.

### Group G — Accessibility Baseline

- **R-G1 (Ubiquitous)**: The login screen SHOULD associate every form input with a label, give every
  button discernible text content, and keep the email form submittable via keyboard
  (Enter on a focused field submits the form).

### Group H — Responsive / Full-Screen

- **R-H1 (Ubiquitous)**: The login screen SHALL render full-screen using the `size-full` mobile-first
  layout so that it fills the viewport on web and renders correctly when hosted inside the React
  Native WebView.

## Open Decisions / Risks

- **OD-1 (action signature mismatch)**: The actual `signInWithOAuthAction(formData: FormData)` reads
  a hidden `provider` field from a `<form>` rather than accepting a `provider` string argument as the
  brief phrased it (`signInWithOAuthAction('google'|'apple')`). The Run phase MUST wire the social
  buttons via a form-with-hidden-input pattern (or adapt to the real signature) — do not assume a
  string-argument signature.
- **OD-2 (error surfacing path)**: `signInAction`/`signUpAction` surface errors via `useActionState`
  return state, while OAuth/`signInWithOAuthAction` failures redirect back to `/login?error=...`
  (read from `searchParams` in the server component). The error box (R-E3) must reconcile both
  channels — client `useActionState` error AND the server-side `?error=` initial value.
- **OD-3 (base font)**: The Figma Make design may assume a specific font; `apps/web` already has its
  own font setup. Decision pending — keep web's existing font vs. import the design font. Default to
  web's existing font unless the visual diff is unacceptable.
- **OD-4 (약관/개인정보 link targets)**: Route targets for 이용약관/개인정보처리방침 are TBD; kept as
  non-functional underline text for now.
- **OD-5 (mobile WebView rendering)**: Full-screen rendering inside the RN WebView host must be
  verified visually; `size-full` behavior under the WebView viewport is unconfirmed.
- **OD-6 (Tailwind v4 palette)**: Default palette tokens (blue-600/gray-300/gray-600/red-50/red-600/
  black/white) are assumed to map directly to Tailwind v4. Verify at implementation; no custom theme
  config is intended.

## Sources

- Design source: 사용자의 Figma Make 파일 "Meetup" (fileKey `VDxYuSp4OwOTJuF53c4gnc`), LoginScreen
  컴포넌트. Figma MCP를 통해 확인.
- Auth wiring source: `apps/web/lib/auth/actions.ts`, `apps/web/app/login/page.tsx`,
  `apps/web/app/login/login-form.tsx` (SPEC-AUTH-001).

## Implementation Notes

- 2026-06-04 구현 완료(status: completed). 검증 전략: **SPEC 기준**(테스트 하네스 미설치) — 사용자 승인.
- 구현 커밋 `feature/SPEC-LOGIN-UI-001 @ 4aba164`. 문서 동기화는 별도 `docs(sync)` 커밋.
- 변경 파일(계획과 동일 — divergence 없음):
  - `apps/web/package.json`: `lucide-react ^1.17.0` 런타임 의존성 추가(major 1.x).
  - `apps/web/app/login/login-form.tsx`: "Meetup" LoginScreen client component(소셜 랜딩 + 이메일 폼 2뷰)로
    전면 재작성, 인라인 `GoogleIcon` SVG.
  - `apps/web/app/login/page.tsx`: server component가 `searchParams.error`를 `initialError`로 전달,
    기존 Kakao 포함 소셜 스캐폴드·`<h1>moyura 로그인</h1>` 제거.
- 주요 구현 결정:
  - OD-1: Google/Apple은 `<form action={signInWithOAuthAction}>` + hidden `provider` 패턴으로 배선(문자열 인자 아님).
  - OD-2: `useActionState` 에러와 서버 `?error=` 초기값을 폼 상단 에러 박스에 통합. `initialError`가 있으면
    `showEmailForm`을 true로 초기화해 OAuth 실패 메시지를 노출(EC-2/AC-E3).
  - R-A3에서 미명시된 소셜 버튼 클래스는 디자인 설명에 맞춰 재구성(outline/solid) — 색상·카피 변경 없음.
- 검증 결과: `tsc --noEmit` 0 errors · `eslint` 0 findings · `next build` 성공(`/login` ƒ 라우트 생성).
  금지패턴 grep: `supabase.auth`/`alert(`/`console.log`/`functions.invoke` 실호출 0건(설명 주석 1줄만 매치),
  `kakao` 0건.
- 미검증(시각 확인 권고): AC-H1 RN WebView 풀스크린 렌더(OD-5), Figma 픽셀 단위 일치 — 클래스·카피 일치까지만 확인.
