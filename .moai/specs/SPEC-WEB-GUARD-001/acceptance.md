# SPEC-WEB-GUARD-001 — 수용 기준 (Acceptance)

> 웹 앱에는 테스트 하니스가 없다. 검증은 build/lint/tsc + 코드 추론으로 수행하며 자동화 테스트는 작성하지 않는다.

## 수용 기준 (Acceptance Criteria)

- **AC-1** — `app/moims/layout.tsx`가 존재하고 서버 컴포넌트(`async`, `"use client"` 없음)이며, children 반환 전에 `requireNamedSession()`을 await한다. (REQ-WG1-001)
- **AC-2** — 세션 없이 `/moims/{id}/chat`로 직접 진입 시 chat 콘텐츠 렌더링 전에 서버 측에서 `/login`으로 리다이렉트된다. (REQ-WG1-002)
- **AC-3** — 세션은 있으나 `Profile.name`이 없는 상태로 `/moims/{id}/chat`로 직접 진입 시 `/onboarding`으로 리다이렉트된다. (REQ-WG1-003)
- **AC-4** — 온보딩 완료 사용자(세션 + 이름)는 chat 페이지를 변경 없이 본다(시각 회귀 없음; chat 라우트에 하단 탭바가 추가되지 않는다). (REQ-WG1-004)
- **AC-5** — 리다이렉트 루프가 없다(`/onboarding`·`/login`은 `app/moims/` 밖). (REQ-WG1-002/003)
- **AC-6** — `nx run web:build`, web lint, `tsc`가 모두 0 error로 통과한다. (검증 게이트)

## Given-When-Then 시나리오

### 시나리오 1: 미인증 직접 진입 (AC-2)
- **Given** 유효한 Supabase 세션 쿠키가 없는 사용자가
- **When** `/moims/{id}/chat`로 직접 네비게이션하면
- **Then** chat 콘텐츠가 렌더링되기 전에 서버 측 가드가 `/login`으로 리다이렉트한다.

### 시나리오 2: 인증 + 이름 미보유 (AC-3)
- **Given** 세션은 있으나 `Profile.name`이 비어 있거나 null인 사용자가
- **When** `/moims/{id}/chat`로 직접 네비게이션하면
- **Then** 가드가 `/onboarding`으로 리다이렉트한다.

### 시나리오 3: 정상 진입 (AC-4)
- **Given** 유효한 세션과 비어 있지 않은 `Profile.name`을 보유한 사용자가
- **When** `/moims/{id}/chat`로 진입하면
- **Then** chat 페이지가 기존과 동일하게 렌더링되며 하단 탭바는 추가되지 않는다.

## 엣지 케이스 (Edge Cases)

- 백엔드 `GET /me`가 401 또는 비-401 오류를 반환하면 가드는 fail-closed로 `/login`으로 리다이렉트한다(REQ-WG1-005; `require-named-session.ts`가 이미 처리).
- `app/moims/` 아래 향후 추가될 라우트도 동일 레이아웃 가드를 자동 상속한다.

## Definition of Done

- [ ] `app/moims/layout.tsx` 신규 작성(가드 + children, 셸 요소 없음).
- [ ] 기존 파일(chat 페이지, (main) 가드, `require-named-session.ts`) 무변경.
- [ ] AC-1 ~ AC-6 충족.
- [ ] `nx run web:build` / web lint / `tsc` 0 error.
