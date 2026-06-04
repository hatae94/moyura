---
id: SPEC-LOGIN-UI-001
version: 0.1.0
status: draft
created: 2026-06-04
updated: 2026-06-04
---

# Acceptance Criteria — SPEC-LOGIN-UI-001

각 EARS 요구사항에 1:1로 대응하는 검증 가능 기준. 모두 관찰 가능(렌더 결과 / 호출 / 빌드 출력)해야 한다.

## Group A — Social Landing View

- **AC-A1 (R-A1)**: `showEmailForm === false`일 때 소셜 랜딩 뷰가 렌더되며, 외곽 구조가
  `div.size-full.flex.flex-col.bg-white > div.flex-1...px-6.py-12 > div.w-full.max-w-md`로 존재한다.
- **AC-A2 (R-A2)**: 로고 배지(`w-16.h-16.bg-blue-600.rounded-2xl` + "🎉"), 타이틀이 정확히
  "Meetup"(`h1.text-3xl.font-bold`), 서브타이틀 "간편하게 모임을 만들고 / 일정, 장소, 투표를
  한곳에서"(`<br/>` 포함)가 렌더된다.
- **AC-A3 (R-A3)**: Google(인라인 GoogleIcon + "Google로 계속하기"), Apple(검정 배경 +
  `<Apple size={20} />` + "Apple로 계속하기"), Email(`<Mail size={20} />` + "이메일로 계속하기")
  버튼 3개가 지정 클래스로 렌더된다.
- **AC-A4 (R-A4)**: Apple 버튼과 Email 버튼 사이에 "또는" 디바이더(`relative.my-4`,
  `span.px-2.bg-white.text-gray-500.text-sm`, `border-t.border-gray-300`)가 렌더된다.
- **AC-A5 (R-A5)**: 푸터(`p.text-xs.text-gray-500.text-center.mt-8`)에 약관/개인정보 문구가 렌더되며
  "이용약관"·"개인정보처리방침"이 `span.underline` 비기능 텍스트로 표시된다.

## Group B — Email Form View

- **AC-B1 (R-B1)**: `showEmailForm === true`일 때 이메일 폼 뷰가 외곽
  `div.size-full...> div.flex-1.flex.flex-col.px-6.py-8` 구조로 렌더되고 상단에
  `button.self-start.text-gray-600.mb-8` "← 뒤로"가 존재한다.
- **AC-B2 (R-B2)**: `isSignUp === true`이면 제목 "회원가입" + 서브 "새로운 계정을 만들어주세요",
  `isSignUp === false`이면 제목 "로그인" + 서브 "이메일로 계속하기"가 렌더된다.
- **AC-B3 (R-B3)**: 이메일 필드(label "이메일", `input[type=email]` placeholder
  "example@email.com")와 비밀번호 필드(label "비밀번호", `input[type=password]` placeholder
  "••••••••")가 지정 input/label 클래스로 렌더된다.
- **AC-B4 (R-B4)**: `isSignUp === true`일 때만 이름 필드(label "이름", placeholder "홍길동")가
  이메일 필드 위에 렌더되고, `isSignUp === false`이면 이름 필드가 DOM에 없다.
- **AC-B5 (R-B5)**: submit 버튼(지정 `bg-blue-600...disabled:opacity-50` 클래스)과 토글 링크
  (`mt-6.text-center > button.text-blue-600.text-sm`)가 폼 하단에 렌더된다.

## Group C — View Toggle and Form State

- **AC-C1 (R-C1)**: Email 버튼("이메일로 계속하기") 클릭 시 `showEmailForm`이 `true`가 되고 이메일
  폼 뷰로 전환된다.
- **AC-C2 (R-C2)**: "← 뒤로" 버튼 클릭 시 `showEmailForm`이 `false`가 되고 소셜 랜딩 뷰로 복귀한다.
- **AC-C3 (R-C3)**: 토글 링크 클릭 시 `isSignUp`이 반전되며, 라벨이 `isSignUp === true`일 때
  "이미 계정이 있으신가요? 로그인", `false`일 때 "계정이 없으신가요? 회원가입"으로 바뀐다.
- **AC-C4 (R-C4)**: 컴포넌트 파일 상단에 `'use client'`가 있고 `showEmailForm`/`isSignUp`/
  loading/error가 로컬 state로 보유된다.

## Group D — Auth Wiring

- **AC-D1 (R-D1)**: Google 버튼 클릭은 provider `"google"`로, Apple 버튼 클릭은 provider
  `"apple"`로 기존 `signInWithOAuthAction`을 호출한다(form+hidden provider 패턴, OD-1).
- **AC-D2 (R-D2)**: `isSignUp === false` 제출은 email/password로 `signInAction`을, `true` 제출은
  name(optional)/email/password로 `signUpAction`을 호출한다.
- **AC-D3 (R-D3)**: 코드에 `supabase.auth` 직접 호출, 커스텀 signup edge function 호출,
  `alert(`, `console.log(`가 인증 흐름에 존재하지 않는다(grep 결과 0건).
- **AC-D4 (R-D4)**: 액션 성공 시 기존 리다이렉트(`/me`)가 수행된다(액션 자체가 redirect 수행 —
  UI는 이를 막지 않는다).

## Group E — Loading and Error States

- **AC-E1 (R-E1)**: 액션 pending 동안 submit 버튼이 disabled이고 라벨이 "처리 중..."이다.
- **AC-E2 (R-E2)**: pending이 아닐 때 submit 라벨이 `isSignUp === true`이면 "가입하기",
  `false`이면 "로그인"이다.
- **AC-E3 (R-E3)**: 액션이 에러를 반환하면 폼 상단 `div.bg-red-50.text-red-600.px-4.py-3.rounded-lg.text-sm`
  박스에 에러 메시지가 렌더된다(useActionState 에러 + 서버 `?error=` 초기값 모두 처리, OD-2).

## Group F — Dependency and Build

- **AC-F1 (R-F1)**: `apps/web/package.json` `dependencies`에 `lucide-react`가 존재하고,
  `Mail`/`Apple` import가 빌드에서 해석되며, `GoogleIcon`은 인라인 SVG 컴포넌트로 정의된다.

## Group G — Accessibility Baseline

- **AC-G1 (R-G1)**: 모든 input이 label과 연결되고(htmlFor/id 또는 라벨 래핑), 모든 버튼이 식별 가능한
  텍스트를 가지며, 이메일 폼이 키보드(포커스된 필드에서 Enter)로 제출된다.

## Group H — Responsive / Full-Screen

- **AC-H1 (R-H1)**: 로그인 화면이 `size-full` 레이아웃으로 뷰포트를 채워 풀스크린 렌더되고, RN
  WebView 호스트에서도 올바르게 표시된다(가능 시 시각 확인, OD-5).

## Edge Cases

- **EC-1**: 이메일/비번 누락 제출 → 기존 액션이 "이메일과 비밀번호를 입력하세요." 에러 반환 → 에러
  박스 표시(AC-E3).
- **EC-2**: OAuth provider 키 미배선(로컬) → `signInWithOAuthAction`이 `/login?error=oauth_*_unavailable`로
  복귀 → 서버 `?error=` 초기값이 에러 박스에 표시(OD-2).
- **EC-3**: 뷰 전환·isSignUp 토글 시 입력값/에러 잔존 동작은 디자인 소스 동작을 따른다(임의 개선 금지).

## Quality Gate Criteria

- `apps/web`에서 `next build` 및 타입체크(`tsc --noEmit` 또는 빌드 내 타입검사) 통과(증거 출력).
- ESLint 통과(`eslint`).
- Kakao 버튼이 DOM에 존재하지 않는다(소셜 버튼 = Google/Apple/Email 3종만).

## Definition of Done

- [ ] 소셜 랜딩 / 이메일 폼 두 뷰가 디자인 소스대로 렌더(Group A, B).
- [ ] 뷰/isSignUp 토글 동작(Group C).
- [ ] Google/Apple/Email/로그인/회원가입이 기존 server action에 배선(Group D).
- [ ] loading/error 상태 동작(Group E).
- [ ] `lucide-react` 의존성 추가, `GoogleIcon` 인라인(F).
- [ ] 접근성 baseline 충족(G).
- [ ] 풀스크린 렌더(H).
- [ ] build / typecheck / lint 통과, Kakao 버튼 부재 확인.
- [ ] `supabase.auth` 직접 호출 / edge-function / alert / console.log 부재(AC-D3).
