# SPEC-MOBILE-NAV-001 (compact) — 모바일 네이티브 헤더·뒤로가기

- id: SPEC-MOBILE-NAV-001 · version: 0.1.0 · status: draft · priority: high · issue_number: 0
- 접근: 단일 지속 WebView + **네이티브 헤더 크롬 오버레이**(브리지 `nav:*` 채널, topology-agnostic). 옵션 A(`onShouldStartLoadWithRequest` push 승격) 폐기 — soft-nav 미발화(딥리서치 확정).
- OD 5건 해소: OD-1(수렴 미포함→UNIFY-001 위임 + 공유 nav 채널 계약), OD-2(back=nav:back 웹 위임), OD-3(알림 cross-tab back=웹 히스토리 우선+딥링크 첫 진입 /home 폴백), OD-4(SPIKE=Phase 0 필수 게이트), OD-5(iOS 스와이프 백 미포함).

## REQ 목록 (5 모듈)

**M1 — 네이티브 헤더 크롬 렌더** [NEW]
- REQ-MOBNAV-001 [S]: `(tabs)` 셸 + 헤더 필요 5페이지 → WebView 위 네이티브 헤더 바(chevron+title), status-bar top inset 소유.
- REQ-MOBNAV-002 [S]: canGoBack → chevron 표시 / 불가 → title-only.
- REQ-MOBNAV-003 [Un]: 탭 루트 4 + 보류 3페이지에 헤더 미렌더(5페이지 한정).

**M2 — 웹측 nav 상태 보고** [NEW]+[MODIFY]
- REQ-MOBNAV-010 [E]: 셸 모드 pathname 변화 → `nav:state{pathname,title,canGoBack}` 보고, 데스크톱 no-op.
- REQ-MOBNAV-011 [E]: `nav:state`/`nav:back` = additive v1 타입, nonce+trusted-origin 재사용, **UNIFY-001 R-U2 와 동일 공유 nav 채널 계약**, 세션 타입 무변경, unknown graceful-ignore.
- REQ-MOBNAV-012 [U]: title = route 컨텍스트 데이터 산출(static `document.title` 비의존).
- REQ-MOBNAV-013 [Un] (SPIKE 게이트): Next 16 nav 관측(`<Link>`/`router.push`/Server Action redirect) 누락 없음 실측 전 M2 착수 금지.

**M3 — Back 동작 라우팅 + 하드웨어/제스처 정합** [MODIFY]
- REQ-MOBNAV-020 [E]: back chevron 탭 → native `nav:back` post → 웹 `router.back()`/`history.back()`. `webViewRef.goBack()` 직접호출 금지.
- REQ-MOBNAV-021 [Un] (딥링크 폴백): in-app 히스토리 없음(딥링크 첫 진입) → `router.replace('/home')` 폴백(이탈·no-op 아님).
- REQ-MOBNAV-022 [C]: `(tabs)` + web-back-possible + Android 하드웨어 back → 동일 `nav:back` web-history 경로(상세 전체 pop 아님); route root → 기존 native-back. iOS 스와이프 OFF.

**M4 — 셸 모드 웹 헤더 숨김** [MODIFY]
- REQ-MOBNAV-030 [S]: `html[data-shell="native"]` → 5페이지 sticky 헤더/back Link 숨김(title 소유 네이티브 이관).
- REQ-MOBNAV-031 [Un]: 헤더 숨김이 chat `h-dvh-fixed`(:459) / schedule `top-[60px]`(:1014) 레이아웃 깨지 않음.

## Acceptance 요약

- [spike-gate] AC-SPIKE-1/2: Next 16 nav 관측 완전성 실측 + NavStateReporter 반영 (BLOCKING).
- [local] AC-M1-1/2: nav-header-core 5페이지 판정 + chevron 가시성 (vitest).
- [device-gated] AC-M1-3: 헤더 바 렌더 + inset 소유 (iOS 시뮬).
- [local] AC-M2-1: nav 브리지 round-trip + nonce + unknown 무시 + 세션 회귀 0 (vitest). AC-M2-2: 웹 build/tsc.
- [device-gated] AC-M2-3: soft-nav 헤더 타이틀·back 갱신.
- [local] AC-M3-1: decideBackPress web-history 분기 (vitest). AC-M3-2: nav:back 웹 위임 계약. AC-M3-3: 딥링크 폴백(로컬 우선).
- [device-gated] AC-M3-4: 알림 cross-tab back 종단. [android-held] AC-M3-5: Android 하드웨어 back 정합.
- [local] AC-M4-1: 셸 헤더 숨김 build. [device-gated] AC-M4-2: 이중 헤더 없음 + 레이아웃 회귀 없음.
- [local] AC-REG-1: mobile vitest baseline 보존. AC-REG-2: NativeHeaderBar WebView 미생성.
- **status 정책**: device-gated AC iOS 시뮬 라이브 검증 전까지 `in-progress` 유지(자동 PASS ≠ completed).

## Files to modify

**mobile [NEW]**: `apps/mobile/lib/nav-header-core.ts` (+ `.test.ts`), `apps/mobile/components/NativeHeaderBar.tsx`
**mobile [MODIFY]**: `apps/mobile/lib/auth/bridge-protocol.ts`(nav 타입 additive + `decideInboundAction`), `apps/mobile/hooks/useAuthBridge.ts`(onMessage nav:state + `injectNavBack`), `apps/mobile/components/BridgedWebView.tsx`(헤더 오버레이 + safe-area 재조정), `apps/mobile/hooks/app-lifecycle-core.ts`(`decideBackPress` web-history 분기)
**mobile [EXISTING]**: `apps/mobile/app/_layout.tsx`·`(tabs)/_layout.tsx`(headerShown:false 유지), `WebViewShell.tsx`(WebView 단일 소유)
**web [NEW]**: `apps/web/app/(main)/_components/NavStateReporter.tsx`, `apps/web/lib/native-bridge/bridge-protocol.ts`(`serializeNavState`)
**web [MODIFY]**: `apps/web/lib/native-bridge/bridge-client.ts`(nav:back 리스너 + 직렬화), `apps/web/app/moims/layout.tsx`(리포터 2차 마운트), `apps/web/app/globals.css`(셸 헤더 숨김 규칙), 웹 5페이지: `home/[id]/page.tsx`, `moims/new/create-moim-form.tsx`, `moims/[id]/chat/page.tsx`, `moims/[id]/schedule/schedule-view.tsx`, `moims/[id]/expenses/expenses-view.tsx`

## Exclusions (What NOT to Build)

- 보류 3페이지(`/me`, `/invite`, `/invite/[token]`) 헤더 미렌더.
- 다중→단일 WebView 수렴 미수행(UNIFY-001 위임).
- 네이티브 스택 push 상세 화면 신설 없음(옵션 A 폐기).
- in-WebView 전환 애니메이션 없음(NATIVE-FEEL-001 범위).
- iOS 스와이프 백 미포함(`allowsBackForwardNavigationGestures` OFF).
- Android 풀 검증 보류(iOS 후 보류 기록).
- 비셸(데스크톱) 헤더 개선 없음(셸 모드 한정, no-op).
- bridge-protocol v1 세션 타입 의미 변경 없음(nav:* additive).

## Quality gate

- `apps/web`: `next build` + `tsc --noEmit` (테스트 하니스 없음 — 하니스 추가 전 사용자 확인).
- mobile pure-core: `nx test mobile`(vitest) — 기존 baseline 보존 + nav-header-core/nav round-trip/decideBackPress 신규 GREEN.
- `tsc --noEmit`(mobile) + `expo export`.
- Phase 0 SPIKE 통과 후 M2 착수. device-gated AC iOS 시뮬 검증 전까지 status in-progress.
