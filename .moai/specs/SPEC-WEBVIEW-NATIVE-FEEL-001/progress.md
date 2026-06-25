## SPEC-WEBVIEW-NATIVE-FEEL-001 Progress

- Started: 2026-06-25
- Scope: M1 (perf props) + M2 (로딩 체감) + M5 (콘텐츠 content-visibility/INP)
- Deferred: M3 (워밍업+선인증), M4 (View Transitions) — depends on SPEC-WEBVIEW-UNIFY-001 (공유 WebView, 미구현)
- Mode: before baseline 보강 → TDD 구현 → after 비교
- development_mode: tdd. apps/mobile=vitest(core), apps/web=no harness(build/lint gate)
- Data account: gkxo5959@naver.com (baseline account-gated 보강용)

- Phase 0 (baseline 보강) + Phase 1 (strategy) 병렬 시작
- Phase 0 complete: baseline 보강 (계정 모임 1개) — /home LCP ~968ms, 탭전환 RSC 539~722ms, list→detail RSC ~1211ms/LCP ~1708ms (supabase 236KB 포함), INP 15ms(병목 아님), scroll jank 0
- Phase 1 complete: strategy — M1/M2/M5, PPR DEFER 권장(세션 가드+테스트 하베스 부재), T-001~007
- 핵심 통찰: 웹 INP/scroll 이미 양호 → M5 효과 제한적. 최대 잔여 레버는 list→detail의 supabase 236KB (진단 [중간3], NATIVE-FEEL 범위 밖)
- Phase 2 complete: 구현 (8파일 +159/-55). M1 perf props 5종, M2 스켈레톤/fade/splash 일원화/iOS 복구, M5 content-visibility 3 유틸. tsc 0, vitest 220 pass(회귀 0), next build ✓, lint 0. PPR DEFER, 텍스트/줌 보류.
- Phase 2.5 complete: manager-quality TRUST 5 — Secured/Readable/Unified/Trackable PASS, Tested WARNING(device-gated). 동작 보존 5/6 PASS + fade-in caveat(로딩 오버레이가 커버 → 실위험 낮음). critical 0. overall WARNING.
- after 측정: device/배포-gated (web content-visibility는 배포 전+baseline상 scroll 이미 양호; mobile 실기기 전용)
- status: in-progress (device 검증 전 — 로딩 스켈레톤·스크롤 감속·splash fade·iOS terminate 발화)
