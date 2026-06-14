# Task Decomposition — SPEC-MOBILE-004 (모바일 네이티브 Google 로그인 + 이름 온보딩)

Approved: 2026-06-15 (Run Decision Point 1). TDD jest(backend)/vitest(mobile-core). Coverage 85% backend automatable. Branch feature/SPEC-MOBILE-004. Local-only. STATUS TARGET: in-progress (device-gated AC-1/2/3/5/6a/6b mobile runtime).
Reconciliation (SPEC pre-dates MOBILE-003/CHAT-002): protected route /me→/home+(main) guard; onboarding page OUTSIDE (main) (loop-safe); guard reads Profile.name via GET /me server-side; requireNamedSession helper shared by (main)/layout+me/page; AC-7 desktop auto via server guard. useAuthBridge @MX:ANCHOR L123-129 (preserve), oauth-intercept branch L177-180 → native SDK. api-client generate sequencing (backend PATCH/DTO → api-client:generate → web). Both mobile deps absent: @supabase/supabase-js@2.106.x + @react-native-google-signin/google-signin (npx expo install, Expo56 config plugin, EAS dev build, free Original API). OD-1 PATCH /me {name}; OD-2 signUp options.data.name + PATCH /me (provider-agnostic single persistence).

| Task | Description | REQ/AC | Verify | Deps | Status |
|------|-------------|--------|--------|------|--------|
| T-001 | Profile.name String? + migration add_profile_name + GET /me returns name + profile-response.dto name | REQ-003 / AC-4(be) | jest+migrate | - | pending |
| T-002 | PATCH /me {name} + ProfileService.updateName(sub,name) sub-scoped, empty reject, mass-assignment block | REQ-003/004 / AC-4,8(be) | jest | T-001 | pending |
| T-003 | api-client regen (api-client:generate) + patchMe(name) [SEQUENCING GATE] | infra / AC-4 전제 | tsc/build | T-002 | pending |
| T-004 | signUpAction name persist (signUp options.data.name + PATCH /me) + login-form name field wiring | REQ-003 / AC-4 | build/lint | T-003 | pending |
| T-005 | onboarding page (OUTSIDE (main), prefill user_metadata.name, empty/fail stays+error AC-8, named→/home) + require-named-session.ts helper + (main)/layout guard + me/page guard | REQ-004/005 / AC-1,3,7,8(web) | build/lint | T-003,T-004 | pending |
| T-006 | google-signin-core.ts classifyGoogleSignInResult → idToken/cancelled/error [@MX:NOTE], no token logging | REQ-001/005 / AC-1,2,6a(decision) | vitest | - | pending |
| T-007 | signin-id-token-core.ts classifyIdTokenSession → session{access,refresh}/error, no cred leak | REQ-001/002/005 / AC-1,2,5,6b(decision) | vitest | - | pending |
| T-008 | npx expo install @react-native-google-signin/google-signin + @supabase/supabase-js@2.106.x + app.json config plugin + iOS URL scheme + thin google-signin.ts/supabase-mobile.ts wrappers | REQ-001/002 / AC-1,2,5(runtime) | tsc+expo export (runtime device-gated) | T-006,T-007 | pending |
| T-009 | useAuthBridge oauth-intercept branch (L177-180) → native SDK + signInWithIdToken + saveTokens + injectRestore(session:restore v1), @MX:ANCHOR L123-129 preserve+REASON update, cancel/fail re-enable | REQ-001/002 / AC-1,2,5,6a,6b(runtime) | tsc+lint (runtime device-gated) | T-008 | pending |
| T-010 | EAS dev build real-device: new/existing/nameless Google login → onboarding → /home + cancel/fail recovery | AC-1/2/3/5/6a/6b(runtime) | manual device-gated (blocks completed) | T-001~009 | pending |

## MX plan
- @MX:ANCHOR preserve: useAuthBridge L123-129 (token bridge boundary, fan_in↑ → @MX:REASON update)
- @MX:NOTE: google-signin-core (SDK result classify), signin-id-token-core (idToken→session), onboarding guard (Profile.name = new/existing single authority), supabase-mobile signInWithIdToken wrapper
- @MX:WARN candidate: signInWithIdToken nonce local-skip/prod boundary (+REASON)
- @MX:ANCHOR candidate: PATCH /me if fan_in≥3 (email signup + onboarding + future social)

## Gates
backend jest 85% (Profile.name roundtrip, PATCH /me, updateName sub-scope, empty 400, mass-assignment), mobile vitest (core classify), tsc 0 (web/be/mobile), lint 0, web build, expo export, api-client regen, migrate add_profile_name. AC-1/2/3/5/6a/6b mobile runtime = device-gated → in-progress.

## OD decisions (resolved)
OD-1: PATCH /me {name} (reuse MeController+ProfileService, sub-scoped). OD-2: signUp options.data.name (user_metadata for prefill/home display) + PATCH /me (Profile.name authoritative for guard) — provider-agnostic single persistence path shared by email/onboarding/future-social.
