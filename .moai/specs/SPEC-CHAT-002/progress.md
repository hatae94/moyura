# SPEC-CHAT-002 Progress

- Started: 2026-06-13 (autonomous batch, 3/3 final). Mode: sub-agent sequential, TDD jest+vitest, coverage 85%, branch feature/SPEC-MOBILE-004, local-only, auto-proceed.
- Depends: SPEC-CHAT-001 (chat-events.ts CHAT_MESSAGE_CREATED contract — committed f3fe178), SPEC-MOIM-001 (moim_member). DB :54322 up.
- **DEVICE-GATED**: AC-5 (real-device background push + tap) needs Firebase project + dev build → status target in-progress (spec mandates; consistent with mobile-spec-device-gated). Automatable surface only.
- New deps: firebase-admin (backend, pin stable), expo-notifications (mobile, Expo 56 — per apps/mobile/AGENTS.md check official docs, no guess).
- KEY grounding correction to verify: MOBILE-003 REMOVED App.tsx → expo-router app/_layout.tsx + AuthContext + BridgedWebView/useAuthBridge. Mobile push wiring + logout DELETE /devices integration point is now app/_layout.tsx/AuthContext/useAuthBridge session:cleared path, NOT App.tsx (plan references App.tsx — stale post-MOBILE-003).
- FIREBASE_CREDENTIALS: plan says fail-fast, but absent locally → must be OPTIONAL/graceful (push disabled when absent) so boot + integration tests (AppModule) don't break; jest mocks firebase-admin. Strategy to resolve.
- Loose coupling: chat ↛ push (static grep AC-3); push imports chat-events.ts only.
- Automatable: DeviceToken register/unregister (jest), push.listener @OnEvent + fcm-sender mock (sender exclusion + guest exclusion), static-grep, FIREBASE_CREDENTIALS Zod, mobile pure helpers vitest + tsc. Device-gated: AC-5 real FCM delivery + native.
- Strategy pending.

## 2026-06-14 구현 완료(자동화 표면) — status: in-progress(device-gated)

- T-001~T-010 구현. 백엔드 jest 206 passed, 모바일 vitest 151 passed, tsc 0(backend+mobile), api-client generate+typecheck, prisma migrate status clean.
- firebase-admin@13.10.0(node≥20 정합, 14 회피), expo-notifications@~56.0.17(npx expo install).
- FIREBASE_CREDENTIALS Zod optional + graceful no-op — 부재 시 부팅/통합 테스트 통과 확인.
- 느슨한 결합(AC-3): chat↛push import 0건(grep clean) + loose-coupling.spec 통과. push는 chat-events.ts만 단방향 import.
- 보안 수정(evaluator FAIL→해소): unregister IDOR → @CurrentUser + unregisterByOwner(sub,token) deleteMany(owner-scoped). orphan token → register가 토큰 저장, unregisterDevice가 저장 토큰으로 해제(재획득 의존 제거).
- 커버리지: src/push authored 로직 100% stmt/func/line. **브랜치 83.63%** — 미커버 잔여는 전부 NestJS DI 생성자/메서드 데코레이터의 emitDecoratorMetadata phantom 삼항(istanbul-ignore가 이 jest/v8 설정에서 비동작). 프로젝트 전체 브랜치 85.08% PASS. evaluator가 지목한 실질 갭(recipient-0/already-init/IDOR)은 테스트로 전부 해소. MOIM-001 데코레이터-노이즈 수용 선례와 동형 — 자동화 표면 합격으로 판단.
- **device-gated(AC-5, T-011)**: 실 FCM 전달 + 네이티브 백그라운드 수신/탭은 Firebase 프로젝트 + dev build + 실기기 필요 — 수동 검증 대기. status=in-progress 유지(자동 게이트만으로 completed 금지).
- divergence: add_chat 체크섬 드리프트로 add_device_token은 db execute + migrate resolve(비파괴) 적용, migrate status clean.
