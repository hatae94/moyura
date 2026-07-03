# SPEC-MOBILE-NAV-001 Progress

- Started: 2026-07-03
- Branch: feature/SPEC-MOBILE-NAV-001 (from master 8eff825)
- Harness: standard/thorough (priority high, mobile navigation)
- Development mode: tdd
- Plan phase: complete (plan-auditor PASS, commit 8eff825)
- Run scope (this session): Phase 0 SPIKE (local) + Phase 1 pure-logic TDD + Phase 2 web (build/lint). Phase 3-4 (native header wiring + iOS simulator end-to-end) are device-gated — stopped at boundary.
- Working-tree note: unrelated dirty files present (localhost→192.168.219.102 LAN IP swap for device testing) — NOT touched, NOT committed.

## 2026-07-04 — Phase 2 배선 갭 수정 + Android 디바이스 검증 (sync)

- **배선 갭 발견·수정 (커밋 daa128c)**: 헤더는 렌더되나 back 무동작 = `bridge-client.installNavBackListener`(구현 완비)가 웹 어디에도 마운트 안 됨(핸들러 미등록). 하드웨어 백(좌표 무관)도 무동작한 게 탭미스 배제 증거. `apps/web/app/(main)/_components/NavBackListener.tsx` 신규(Next router → NavBackNavigator 주입, ShellSessionAnnouncer 동형 dynamic import·셸 가드·null) + `(main)/layout`·`moims/layout` 2차 마운트. **tsc 0 / eslint 0 / next build 성공**.
- **Android 실기기(S25 SM-S938N) 검증 (CDP+adb)**: 하드웨어 백(모임상세→채팅)·헤더 ‹ 탭(채팅→모임상세) 모두 router.back() 이동 확인. 헤더 페이지(모임 상세·모임 채팅) 헤더+route-derived 타이틀 렌더, 탭 루트(/home) 헤더 부재(REQ-MOBNAV-001/003/010/012/020). before/after 단일변수 차분으로 fix 인과 확정(이전 세션 동일 하드웨어백은 URL 고정=무동작).
- **status 판정 (사용자 승인)**: SPEC [device-gated] 정책은 iOS 시뮬레이터를 formal 게이트로 유지(메모리 `ios-simulator-only`). Android 검증은 플랫폼 무관 nav:back 브리지의 강한 증거이나 iOS 전용 AC(WKWebView 제스처·inset) 미검증 → **status `in-progress` 유지**.
- **미검증(저위험)**: REQ-MOBNAV-021 딥링크 폴백(history.length≤1 → /home replace)은 canGoBack=false → chevron 숨김 + 하드웨어백=native-back이라 정상 UX 재현 불가한 방어 브랜치 — 유닛테스트 커버.
- Working-tree note: unrelated dirty files (LAN IP swap) 여전히 미접촉·미커밋. sync 커밋은 SPEC 문서만 명시 pathspec(로컬 전용, push/PR 없음).
