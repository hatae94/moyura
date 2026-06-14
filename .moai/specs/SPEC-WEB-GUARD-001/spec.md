---
id: SPEC-WEB-GUARD-001
version: 0.2.0
status: completed
created: 2026-06-15
updated: 2026-06-15
author: hatae
priority: medium
issue_number: 0
---

# SPEC-WEB-GUARD-001: 비-(main) 보호 라우트 이름-온보딩 가드 적용 (moims 트리)

## HISTORY

- 2026-06-15 (v0.2.0): sync 단계 — status `draft` → `completed` 전환. 본 SPEC은 device-gated 아님: 순수 웹 서버 측 라우팅 로직으로 OAuth/FCM/Realtime/네이티브 의존이 없다. 6개 AC 전부 검증 완료: AC-1(서버 layout 가드, 코드 검사), AC-2(미인증 → 307→/login, 실 HTTP 확인), AC-3(이름 없음 → /onboarding, `requireNamedSession()` 동일 코드 경로 재사용으로 보증 — web/app/(main)/layout.tsx·app/me/page.tsx에서 이미 실 검증됨), AC-4(탭바 없음, 코드 검사), AC-5(리다이렉트 루프 없음 — /login·/onboarding이 app/moims/ 밖, 코드 검사), AC-6(nx run web:build 0 errors, nx run web:lint 0 errors). 검증 증거: `nx run web:build` PASS(Compiled successfully, TypeScript finished 0 errors), `nx run web:lint` PASS(0 errors), GET /moims/test-id/chat 세션 없음 → HTTP 307→/login PASS. SPEC-MOBILE-004 sync 리포트의 cross-SPEC 후속(chat 페이지 이름 온보딩 가드 미적용) 해소.
- 2026-06-15 (v0.1.0): 최초 draft. SPEC-MOBILE-004 evaluator가 MEDIUM으로 플래그한 cross-SPEC follow-up. `app/moims/` 서브트리가 `app/(main)/` 라우트 그룹 밖에 있어 `app/(main)/layout.tsx`의 `requireNamedSession()` 가드가 적용되지 않는 갭을 닫는다. 단일 파일(`app/moims/layout.tsx`) 가드 적용으로 기존·이미 테스트된 가드의 커버리지를 moims 서브트리로 확장한다.

---

## 1. 개요 (Overview)

`apps/web/app/moims/[id]/chat/page.tsx`는 Client Component(`"use client"`)로, access token 획득을 위해 클라이언트에서 `supabase.auth.getSession()`만 호출할 뿐 **서버 측 세션 강제도, 이름-온보딩 강제도 수행하지 않는다**.

chat 라우트는 `app/moims/` 아래에 있어 `app/(main)/` 라우트 그룹 **밖**이다. 따라서 이미 `requireNamedSession()`을 호출하는 `app/(main)/layout.tsx`가 이 경로를 가드하지 않으며, `app/moims/layout.tsx`도 존재하지 않는다. 결과적으로 미인증 사용자, 또는 인증되었으나 `Profile.name`이 없는(가입했지만 온보딩 미완료) 사용자가 `/moims/{id}/chat`로 직접 진입해 `/login`과 `/onboarding`을 모두 우회할 수 있다.

본 SPEC은 `app/moims/layout.tsx`(서버 컴포넌트)를 추가해 기존·이미 테스트된 가드 `requireNamedSession()`(`apps/web/lib/auth/require-named-session.ts`)을 자식 렌더링 전에 호출한다. 이 가드는 정책을 이미 인코딩하고 있다: 세션 없음 → `/login`, 세션 있음 + 이름 없음 → `/onboarding`, 그 외 → `{ session, profile }` 반환. 본 SPEC은 이 가드의 **커버리지를 moims 서브트리로 확장**할 뿐이며 가드 자체의 정책을 변경하지 않는다.

이는 **단일 파일 가드 적용**이지 대형 기능이 아니다.

---

## 2. EARS 요구사항 (Requirements)

### REQ-WG1-001: moims 서브트리 가드 적용 (Ubiquitous)

- **The system shall** `app/moims/` 아래 모든 라우트에 대해 페이지 콘텐츠 렌더링 전 세션 + `Profile.name` 온보딩 가드를 강제한다.

### REQ-WG1-002: 미인증 리다이렉트 (Event-driven)

- **WHEN** 미인증 사용자가 `app/moims/*` 라우트를 요청하면, **the system shall** `/login`으로 리다이렉트한다.

### REQ-WG1-003: 이름 미보유 리다이렉트 (Event-driven)

- **WHEN** `Profile.name`이 없는 인증 사용자가 `app/moims/*` 라우트를 요청하면, **the system shall** `/onboarding`으로 리다이렉트한다.

### REQ-WG1-004: 정상 렌더링 (State-driven)

- **WHILE** 사용자가 유효한 세션과 비어 있지 않은 `Profile.name`을 보유한 동안, **the system shall** 요청된 `app/moims/*` 라우트를 렌더링한다.

### REQ-WG1-005: 백엔드 실패 시 fail-closed (Unwanted behavior)

- **IF** 가드 검사 중 백엔드 `GET /me`가 실패하거나 401을 반환하면, **then the system shall** fail-closed로 처리하여 `/login`으로 리다이렉트하고 토큰 내용을 노출하지 않는다.

---

## 3. 델타 마커 (Delta Markers — Brownfield)

### [EXISTING] (보존 — 변경 없음)

- `apps/web/lib/auth/require-named-session.ts` — 가드 정책 본체(세션·이름·fail-closed). 변경 없음, 재사용만.
- `apps/web/app/(main)/layout.tsx` — (main) 그룹 가드. 변경 없음.
- `apps/web/app/moims/[id]/chat/page.tsx` — chat 페이지 컴포넌트. 변경 없음(가드는 상위 layout에서 적용).

### [NEW] (신규)

- `apps/web/app/moims/layout.tsx` — 서버 컴포넌트. `requireNamedSession()`을 await한 뒤 children을 렌더링한다. (main) 레이아웃의 하단 탭바·셸 감지 스크립트는 **포함하지 않는다**(chat은 풀스크린 라우트).

### [REMOVE]

- 없음.

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC에서 **구현하지 않는다**:

- chat 페이지 컴포넌트 자체, `(main)` 가드, `require-named-session.ts` 수정 — 어느 것도 변경하지 않는다.
- moim 목록/상세 페이지 추가 — 현재 존재하지 않으며 본 SPEC 범위 아님.
- 모바일·백엔드 변경 — 본 SPEC은 웹 단일 파일 가드에 한정.
- (main) 레이아웃의 하단 탭바·셸 감지 스크립트의 moims 이식 — chat은 풀스크린 라우트이므로 제외.

---

## 5. 설계 노트 (Design Notes)

- moims 레이아웃은 **최소**여야 한다: 가드 + children 렌더링뿐. (main) 레이아웃의 `BottomTabBar`·셸 감지 인라인 스크립트·`ShellSessionAnnouncer`를 복제하지 않는다.
- 리다이렉트 루프 안전성은 이미 보장된다: `/onboarding`과 `/login`이 `app/moims/` 밖에 있으므로 가드가 그쪽으로 보낸 뒤 재진입 루프가 발생하지 않는다(`require-named-session.ts` 주석과 동일 근거).
- 가드는 `requireNamedSession()`이 내부적으로 `redirect()`(throw)를 호출하므로, 레이아웃은 단순히 `await requireNamedSession()` 후 children을 반환하면 된다.

---

## 6. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 검증은 build/lint/tsc + 추론으로 수행하며, 자동화 테스트는 작성하지 않는다.

- `nx run web:build` 통과 (0 error)
- web lint 통과 (0 error)
- `tsc` 통과 (0 error)
- 상세 수용 기준은 `acceptance.md` 참조.
