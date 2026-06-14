# SPEC-MOBILE-004 Progress

- Started: 2026-06-15 (run). Mode: sub-agent sequential, TDD (jest backend / vitest mobile-core), coverage 85%, branch feature/SPEC-MOBILE-004, local-only.
- **DEVICE-GATED** (spec DoD mandates): native Google Sign-In SDK + real Google account + Google Cloud OAuth client IDs + EAS dev build → AC-1/2/3/5/6a/6b + mobile runtime not auto-verifiable. status target in-progress.
- **Stale plan reconciliation (SPEC pre-dates MOBILE-003/CHAT-002 — verified 2026-06-15):**
  - Profile model = id + createdAt ONLY (no name) → add `name String?` + migration.
  - Post-login destination is `/home` (MOBILE-003 pivot; actions.ts redirect /me→/home L46/65/89). SPEC AC references `/me` as protected route — RECONCILE: real protected surface = (main) route group (/home etc.); /me page still exists. Name-onboarding guard belongs in apps/web/app/(main)/layout.tsx (next to existing session guard getSession→/login). Onboarding page must live OUTSIDE (main) guard to avoid redirect loop.
  - useAuthBridge now 302 lines (grew via MOBILE-003 cross-route dispatch + CHAT-002 unregister). @MX:ANCHOR moved to L123 (SPEC says L103-109 — stale). runOAuthBridge L146, onShouldStartLoadWithRequest intercept L160-189. Google-button intercept extends the EXISTING system-browser OAuth bridge path.
  - MOBILE-003 (expo-router) is DONE — SPEC exclusion "expo-router 도입 (MOBILE-003 범위)" still holds (don't add routes); mobile login is (auth)/login hosting BridgedWebView. Native SDK replaces system-browser for Google.
  - Mobile has NEITHER @supabase/supabase-js NOR @react-native-google-signin → both new deps (Expo 56 — per apps/mobile/AGENTS.md verify via docs/npx expo install; google-signin needs config plugin + EAS dev build, Expo Go can't).
- OD to resolve (plan §3.1): name update endpoint shape (PATCH /me {name}), email name persistence mechanism (signUp options.data vs explicit Profile update).
- Automatable surface: backend Profile.name + endpoint + jest; web signUpAction name wiring + onboarding page + (main) guard extension (build/lint); mobile pure-logic cores (signInWithIdToken decision / cancel+failure state / name-presence new-vs-existing) vitest + thin SDK wrappers tsc. Device-gated: native SDK runtime.
- Strategy pending.

## Phase A+B complete (T-001~T-005, 2026-06-15) — backend + web, automatable surface GREEN

- **T-001** Profile.name String? + migration 20260615000000_add_profile_name + GET /me returns name + ProfileResponseDto.name(string|null).
  - Migration applied via diff→db execute→migrate resolve (NOT migrate dev: add_chat checksum drift → migrate dev wanted reset). `prisma migrate status` clean (6 migrations, up to date).
- **T-002** PATCH /me {name} (MeController.@Patch + requireNonEmpty 400) + ProfileService.updateName(sub,name) sub-scoped, data={name} only (mass-assignment block). UpdateNameDto for OpenAPI.
- **T-003** `nx run api-client:generate` regenerated schema.d.ts (PATCH /me + UpdateNameDto + name:string|null) → patchMe(name) added → api-client:typecheck GREEN.
- **T-004** signUpAction: options.data.name (user_metadata) + post-signup PATCH /me (Profile.name authoritative). login-form name field now wired (comment updated, no UI change).
- **T-005** app/onboarding/page.tsx (OUTSIDE (main), loop-safe: name present→/home) + onboarding-form.tsx + onboarding/actions.ts (empty/fail stays+generic error AC-8) + lib/auth/require-named-session.ts (getSession→/login, getMe, name missing→/onboarding; returns {session,profile}) shared by (main)/layout.tsx + me/page.tsx.
- **Loop-safety confirmed**: onboarding outside (main) so no name guard applies; onboarding self-redirects /home only when name present; (main) redirects /onboarding only when name missing. No cycle.
- **Gates**: backend jest 214/214 pass (7 new T-001/T-002 RED→GREEN); profile surface coverage 100% stmt/func/line (branch 78% = istanbul decorator-metadata artifact only, real branches covered); backend+web+api-client tsc 0; web lint 0; `nx run web:build` GREEN; migrate status no drift.
- **Device-gated remaining**: T-006~T-010 (mobile native Google SDK + signInWithIdToken + bridge intercept + EAS dev build) = SEPARATE agent / Phase C/D. status stays in-progress until device E2E (AC-1/2/3/5/6a/6b).
