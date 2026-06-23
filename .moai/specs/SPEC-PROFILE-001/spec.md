---
id: SPEC-PROFILE-001
version: 0.1.0
status: in-progress
created: 2026-06-23
updated: 2026-06-23
author: hatae
priority: medium
issue_number: 0
---

# SPEC-PROFILE-001: 마이 페이지 — 개인정보 조회 + 표시 이름 수정

## HISTORY

- 2026-06-23 (v0.1.0): 최초 작성 + 구현(사용자 요청 — "마이 페이지를 추가해서 개인정보 수정할 수 있게"). SPEC-MOBILE-003 의 `(main)/profile` 플레이스홀더(PlaceholderTab "마이")를 실 기능으로 대체. **백엔드 무변경** — 기존 `GET /me`(ProfileResponse: id/name/createdAt) + `PATCH /me`(UpdateNameDto, SPEC-MOBILE-004)를 재사용. 웹: `(main)/profile/page.tsx` Server Component(`requireNamedSession` → 이메일(session.user.email, read-only) + 가입일(createdAt) + 표시 이름) + `profile-form.tsx` Client 폼(useActionState — 이름 수정, 저장 시 "저장되었습니다" 피드백, redirect 없음) + `actions.ts` Server Action `updateProfileAction`(patchMe → revalidatePath, onboarding actions 미러) + 로그아웃(signOutAction 재사용). Meetup 오렌지 토큰(bg-primary/bg-card/border-border/text-muted-foreground). 모바일 "마이" 탭(`(tabs)/profile.tsx`)은 이미 `${WEB_URL}/profile` 을 WebView 로 호스팅 → 신규 네이티브 코드 0(웹 페이지가 양 표면 커버). **자동 게이트**: web typecheck/lint/`nx run web:build` 0(/profile 라우트 컴파일). **미완료 device-gated**: iOS 시뮬레이터/기기 "마이" 탭 WebView 에서 개인정보 표시 + 이름 수정 → 저장 → 반영 실관찰 대기(사용자 수면 중 — 깨어난 뒤 확인). status in-progress 유지(mobile-spec-device-gated).

## 1. 개요

모임 앱의 "마이"(profile) 탭이 플레이스홀더였다. 본 SPEC 은 로그인 사용자가 자신의 개인정보(이메일·가입일)를 보고 **표시 이름을 수정**할 수 있는 실 페이지로 대체한다. 백엔드는 이미 `GET /me`·`PATCH /me` 를 제공하므로 무변경 — 웹 UI 만 추가한다.

## 2. EARS 요구사항

- **REQ-PROF-001** (Ubiquitous, 백엔드 무변경): **The backend shall** 본 SPEC 에서 변경되지 않는다 — `GET /me`(id/name/createdAt) + `PATCH /me`(name) 재사용.
- **REQ-PROF-002** (State-driven, 조회): **WHILE** 로그인 사용자가 `/profile` 에 진입한 동안, **the web app shall** 이메일(read-only)·가입일(read-only)·표시 이름을 표시한다.
- **REQ-PROF-003** (Event-driven, 수정): **WHEN** 사용자가 표시 이름을 바꿔 저장하면, **the web app shall** `PATCH /me` 로 영속하고 같은 화면에 "저장되었습니다" 피드백을 표시한다(빈 값 → 오류, 백엔드 실패 → 일반화된 오류, 토큰/상세 비노출).
- **REQ-PROF-004** (State-driven, 가드): **WHILE** 미인증/이름 미보유면, **the web app shall** `/login` 또는 `/onboarding` 으로 가드한다((main) 그룹 + requireNamedSession 상속).
- **REQ-PROF-005** (Ubiquitous, 로그아웃): **The web app shall** 마이 페이지에 로그아웃(signOutAction 재사용)을 제공한다.
- **REQ-PROF-006** (Ubiquitous, 모바일 무변경): **The mobile app shall** 기존 "마이" 탭(`${WEB_URL}/profile` WebView 호스팅)을 그대로 사용한다(신규 네이티브 코드 0).

## 3. 구현 (Delta)

- **[MODIFY]** `apps/web/app/(main)/profile/page.tsx` — PlaceholderTab → Server Component(requireNamedSession + 개인정보 카드 + ProfileForm + 로그아웃).
- **[ADD]** `apps/web/app/(main)/profile/profile-form.tsx` — Client 폼(useActionState, 이름 수정, 저장 피드백). onboarding-form 미러.
- **[ADD]** `apps/web/app/(main)/profile/actions.ts` — Server Action `updateProfileAction`(patchMe + revalidatePath). onboarding actions 미러.

## 4. 제외

- 이메일/비밀번호 변경, 프로필 이미지/아바타, 계정 삭제·탈퇴, 알림 설정, 참여 모임 기록 목록은 범위 밖(향후). MVP = 이메일/가입일 조회 + 표시 이름 수정 + 로그아웃.

## 5. 검증 게이트

- web typecheck/lint/`nx run web:build` 0(완료 — /profile 컴파일).
- 디바이스: iOS "마이" 탭 WebView 개인정보 표시 + 이름 수정 → 저장 → 반영 실관찰(device-gated — 대기). 상세는 acceptance.md 참조.
