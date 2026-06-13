# Task Decomposition — SPEC-CHAT-002 (FCM 백그라운드 푸시)

Approved: 2026-06-13 (autonomous, auto-proceed). TDD jest(backend)+vitest(mobile pure). Coverage 85% automatable. Branch feature/SPEC-MOBILE-004. Local-only. STATUS TARGET: in-progress (device-gated AC-5).
Corrections: firebase-admin@^13.10.0 (14 needs node≥22; backend ≥20). expo-notifications via `npx expo install` (SDK56 ~56.0.x) + app.json plugin; remote push needs dev build (Expo Go can't — AC-5 device-gated). FIREBASE_CREDENTIALS Zod OPTIONAL + graceful degrade (absent=push disabled, no-op, warn; else boot+integration tests break). Mobile wiring: App.tsx REMOVED by MOBILE-003 → register in AuthContext (signed-in effect), unregister in useAuthBridge cleared path. Loose-coupling grep: `from '../push'`/`from './push'` in chat/** =0 (chat-events import excluded). No class-validator (manual 400). jest mocks firebase-admin fully.

| Task | Description | REQ / AC | Verify | Deps | Status |
|------|-------------|----------|--------|------|--------|
| T-001 | DeviceToken model(token PK,userId,platform,timestamps,@@index userId) + migrate add_device_token | REQ-002/003 | migrate/typecheck | - | pending |
| T-002 | DeviceTokenService.register(upsert, sub-only)/unregister(delete) [@MX:ANCHOR] | REQ-002/003 / AC-2 | jest unit | T-001 | pending |
| T-003 | DeviceTokenController POST /devices, DELETE /devices/:token (guard, @CurrentUser, manual 400) + DTO | REQ-002/003 / AC-2 | jest | T-002 | pending |
| T-004 | FIREBASE_CREDENTIALS Zod OPTIONAL (graceful) + .env.example | infra (R-ENV fix) | jest unit (absent→boot OK) | - | pending |
| T-005 | FcmSender (firebase-admin@^13.10.0 wrapper, graceful no-op if no creds, best-effort) [@MX:WARN] | REQ-001 | jest (firebase-admin mock) | T-004 | pending |
| T-006 | PushListener @OnEvent(CHAT_MESSAGE_CREATED) — recipients=moim_member(moimId)−sender ⋈ device_token, server-side nickname resolve, sender+guest exclusion [@MX:NOTE one-way] | REQ-001/006 / AC-1,4 | jest (mock prisma+fcm) | T-002,T-005 | pending |
| T-007 | PushModule + app.module register (after ChatModule, no export to chat) + loose-coupling static grep test | REQ-004 / AC-3 | jest + grep | T-003,T-006 | pending |
| T-008 | mobile pure helpers register-device-core.ts (payload build) + notification-core.ts (moimId→/moims/{id}/chat URL) | REQ-005/007 (pure) | vitest + tsc | - | pending |
| T-009 | expo-notifications install + app.json plugin + thin wrappers register-device.ts/notification-handler.ts [@MX:NOTE REST not bridge] | REQ-005/007 | tsc (runtime device-gated) | T-003,T-008 | pending |
| T-010 | wiring: AuthContext signed-in effect→registerDevice; useAuthBridge cleared→unregisterDevice (orphan prevent, logout only) | REQ-005/003 | tsc (runtime device-gated) | T-009 | pending |
| T-011 | DEVICE-GATED manual: Firebase project + FIREBASE_CREDENTIALS + google-services.json/EAS APNs + dev build + real-device bg receive/tap | REQ-005/007 / AC-5 | manual (blocks completed) | T-001~010 | pending |
| REGEN | openapi.json + api-client (generate+typecheck) after T-003/T-007 | gates | auto | T-007 | pending |

## MX plan
- @MX:ANCHOR: DeviceTokenService register/unregister (mobile + logout depend)
- @MX:WARN+REASON: FcmSender (external network firebase-admin + best-effort ignore, no retry/queue)
- @MX:NOTE: PushListener one-way dep boundary (push imports chat-events only, never reverse), register-device REST-not-bridge (R-1), device routes guard reuse, env FIREBASE_CREDENTIALS optional-graceful

## Gates
jest 85% (register/unregister, listener→fcm mock sender+guest exclusion, env Zod optional, grep chat↛push), backend:typecheck 0, mobile vitest(*-core) + tsc 0, openapi+api-client generate/typecheck. Static: chat/** has zero push import. AC-5 device-gated → status in-progress.
