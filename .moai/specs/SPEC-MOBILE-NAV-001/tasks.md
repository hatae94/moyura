## Task Decomposition
SPEC: SPEC-MOBILE-NAV-001

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-00 | Phase 0 SPIKE: Next 16 nav 관측 완전성 (Link/router.push/Server Action redirect) 로컬 조사 | REQ-MOBNAV-013 | - | spike-nav-observation.md | pending |
| T-01 | nav-header-core.ts 순수 결정 모듈 (5페이지 판정·back폴백·title) + vitest | REQ-MOBNAV-001/002/003 | T-00 | apps/mobile/lib/nav-header-core.ts, .test.ts | pending |
| T-02 | bridge-protocol nav:state/nav:back additive 타입 (mobile+web) + 테스트 | REQ-MOBNAV-011 | - | apps/mobile/lib/auth/bridge-protocol.ts, apps/web/lib/native-bridge/bridge-protocol.ts | pending |
| T-03 | decideBackPress web-history 분기 (순수 함수, optional param) + vitest | REQ-MOBNAV-022 | - | apps/mobile/hooks/app-lifecycle-core.ts, .test.ts | pending |
| T-04 | NavStateReporter + moims/layout 마운트 (build/lint) | REQ-MOBNAV-010/012 | T-00, T-02 | apps/web/app/(main)/_components/NavStateReporter.tsx, apps/web/app/moims/layout.tsx | pending |
| T-05 | 웹 브리지 nav 직렬화 + nav:back 리스너 (build/lint) | REQ-MOBNAV-020/021 | T-02 | apps/web/lib/native-bridge/bridge-client.ts, bridge-protocol.ts | pending |
| T-06 | 셸 모드 웹 헤더 숨김 CSS + 5페이지 분기 (build/lint) | REQ-MOBNAV-030/031 | - | apps/web/app/globals.css + 5 header files | pending |
| T-07 | [device-gated] NativeHeaderBar + BridgedWebView 배선 | REQ-MOBNAV-001/002/020 | T-01,T-02,T-03,T-04,T-05 | apps/mobile/components/NativeHeaderBar.tsx, BridgedWebView.tsx, useAuthBridge.ts | deferred |
| T-08 | [device-gated] iOS 시뮬레이터 종단 검증 (헤더·nav 왕복·back·레이아웃 회귀) | REQ-MOBNAV-021/031 | T-07 | (검증만) | deferred |

coverage_verified: true (locally-runnable T-00~T-06 map all non-device REQs; T-07/T-08 carry device-gated ACs)

REQ→task: 001/002/003→T-01,T-07 · 010/012→T-04 · 011→T-02 · 013→T-00 · 020/021→T-05,T-07 · 022→T-03 · 030/031→T-06,T-08
