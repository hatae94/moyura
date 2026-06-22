---
id: SPEC-WEB-VIEWPORT-001
version: 0.1.0
status: in-progress
created: 2026-06-23
updated: 2026-06-23
author: hatae
priority: medium
issue_number: 0
---

# SPEC-WEB-VIEWPORT-001: 웹 줌 비활성화 + 인풋 포커스 자동 줌 방지

## HISTORY

- 2026-06-23 (v0.1.0): 최초 작성 + 구현(사용자 요청 — "웹 줌인 줌아웃 안되도록 지정해서 인풋 포커스시 줌인되지 않게"). `apps/web/app/layout.tsx` 루트 레이아웃에 Next 16 `export const viewport: Viewport` 추가 — `maximumScale: 1` + `userScalable: false` (+ width=device-width, initialScale=1). 핀치 줌인/줌아웃과 iOS 인풋 포커스 자동 줌인을 모두 차단한다(네이티브 셸 WebView·모바일 브라우저 공통). 앱 같은 고정 레이아웃 UX 의도. **자동 게이트**: web typecheck/lint/`nx run web:build` 0(/profile 등 전 라우트 컴파일). **미완료 device-gated**: iOS 시뮬레이터/기기에서 인풋(투표 생성·닉네임·채팅 입력 등) 포커스 시 화면이 확대되지 않는지 + 핀치 줌이 막히는지 실관찰 대기(사용자 수면 중 — 깨어난 뒤 확인). status in-progress 유지(mobile-spec-device-gated).

## 1. 개요

웹(및 네이티브 셸 WebView)에서 사용자가 페이지를 핀치 줌하거나, 모바일 Safari/WebView가 인풋 포커스 시 자동으로 확대(font-size < 16px 휴리스틱)하는 것을 막는다. 앱 같은 고정 레이아웃 경험을 위해 줌을 전역 비활성화한다.

## 2. EARS 요구사항

- **REQ-VP-001** (Ubiquitous): **The web app shall** 루트 레이아웃에 viewport 메타(`maximum-scale=1`, `user-scalable=no`, `width=device-width`, `initial-scale=1`)를 전역으로 설정한다.
- **REQ-VP-002** (State-driven): **WHILE** 모바일 브라우저/WebView 에서 폼 인풋에 포커스하는 동안, **the web app shall** 화면을 자동 확대하지 않는다(인풋 포커스 줌 방지).
- **REQ-VP-003** (Unwanted behavior): **The web app shall** 핀치 제스처로 페이지를 줌인/줌아웃하지 못하게 한다.
- **REQ-VP-004** (Ubiquitous, 회귀): **The web app shall** 기존 레이아웃/스크롤/입력 동작을 보존한다(viewport 추가는 순수 메타 — 컴포넌트 무변경).

## 3. 구현 (Delta)

- **[MODIFY]** `apps/web/app/layout.tsx` — `import type { Viewport }` 추가 + `export const viewport: Viewport = { width:"device-width", initialScale:1, maximumScale:1, userScalable:false }`.

## 4. 제외

- 접근성 토글(줌 재허용 설정)·플랫폼별 분기·인풋 font-size 일괄 16px 강제(viewport 차단으로 불필요)는 범위 밖.

## 5. 검증 게이트

- web typecheck/lint/`nx run web:build` 0(완료).
- 디바이스: iOS WebView/Safari 인풋 포커스 비확대 + 핀치 줌 차단 실관찰(device-gated — 대기).
