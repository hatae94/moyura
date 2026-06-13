# SPEC-MOIM-002 Progress

- Started: 2026-06-13 (autonomous batch — MOIM-002→CHAT-001→CHAT-002)
- Mode: sub-agent sequential, TDD jest, harness standard, coverage 85%. Branch feature/SPEC-MOBILE-004. Local-only. Auto-approve recommended options (user asleep).
- Depends: SPEC-MOIM-001 (assertOwner — committed cc37924). DB :54322 (supabase_db_moyura up).
- Phase 1 strategy complete. Corrections: X-1 GoneException/ConflictException available in @nestjs/common 11.1.24 (use standard exceptions, not manual HttpException) / X-2 api-client:generate+typecheck (no build target) / X-3 Moim.invites[] back-relation additive (no data migration) / X-4 supabase config via `npx supabase stop && start` (NOT reset — preserve data). usedCount atomic via conditional updateMany (verify Prisma 7 field-ref; fallback Serializable tx). accept idempotent via membership pre-check.
- Tasks T-001~T-010: M1 model+create/list/revoke(owner) → M2 accept+guest+fixed-codes+idempotent → M3 supabase anon config + web /invite/[token] → M4 contract+gates.
- Cross-SPEC note: web invite redirects to /moims/[id]/chat (CHAT-001, not built) — redirect string, build won't fail; resolves after CHAT-001.
- status target: completed (backend gates + web build/lint; no device gate).
