# Task Decomposition — SPEC-MOIM-001

Approved: 2026-06-13 (Run Decision Point 1)
Mode: sub-agent sequential, TDD (jest), harness standard, coverage 85%. Branch feature/SPEC-MOBILE-004. Local-only.
Corrections adopted: C-1 (no class-validator → manual nickname 400 check), C-2 (api-client:build absent → api-client:generate + typecheck), interactive $transaction for createMoim, assert* as MoimService methods (no PolicyService), fakePrisma integration spec (Prisma 7 WASM can't run in jest VM).

| Task | Description | REQ / AC | Deps | Planned Files | Status |
|------|-------------|----------|------|---------------|--------|
| T-001 | Prisma Moim + MoimMember(nickname, role, joinedAt, @@id([moimId,userId]), onDelete:Cascade) + migrate dev --name add_moim (:54322) + generate | data foundation | - | schema.prisma [M], migrations/<ts>_add_moim/ [N], src/generated/prisma [regen] | pending |
| T-002 | MoimService.createMoim(sub,name,nickname) — interactive $transaction: moim + owner moim_member(role=owner) | REQ-004 / AC-1 | T-001 | moim.service.ts [N] + spec | pending |
| T-005 | assertMember + assertOwner — authz single source (@MX:ANCHOR + REASON). 404 missing, 403 non-member/non-owner | REQ-002/003 / AC-2,7 | T-002 | moim.service.ts + spec | pending |
| T-003 | getMoim(member-only, 404 missing) / listMyMoims | REQ-005 / AC-6 | T-002,T-005 | moim.service.ts + spec | pending |
| T-004 | listMembers — nickname included | REQ-006 / AC-5 | T-002,T-005 | moim.service.ts + spec | pending |
| T-006 | leave(sub,moimId) — non-member 404, owner 403 (@MX:NOTE orphan prevention), member delete | REQ-007/008 / AC-4,8 | T-002,T-005 | moim.service.ts + spec | pending |
| T-007 | moim.controller.ts — 6 routes + per-route @UseGuards + @CurrentUser + manual nickname 400 + DTOs(@ApiProperty) | all REQ HTTP surface | T-002~006 | moim.controller.ts [N], dto/*.ts [N], moim.controller.spec.ts [N] | pending |
| T-008 | integration spec (.spec.ts) — AppModule + override TokenVerifierService(local JWKS) + PrismaService(fake): 401 vs 403 vs 404 across 6 routes + MoimModule register | REQ-001 / AC-3 + AC-2/7/8 + edges | T-007 | moim.integration.spec.ts [N], app.module.ts [M] | pending |
| T-009 | MoimModule + contract regen (openapi → api-client:generate + typecheck) + gates (jest 85%+, backend:typecheck) | integration + gates | T-001~008 | moim.module.ts [N], app.module.ts [M], openapi.json [regen], api-client/schema.d.ts [regen] | pending |

## Migration procedure
1. schema.prisma edit → 2. prisma:generate → 3. `cd apps/backend && pnpm exec prisma migrate dev --name add_moim` (DIRECT_URL via prisma.config.ts, :54322) → 4. `prisma migrate status` (no drift) → 5. backend:typecheck.

## Success gates
- jest 85%+ statement coverage, backend:typecheck green, migration applied (no drift), openapi+api-client regen + api-client:typecheck green, 8 REQ / 8 AC + 401/403/404 + owner-leave 403 + owner-only-delete 403 all covered.

## MX plan
- @MX:ANCHOR: assertMember, assertOwner (fan_in≥3: CHAT-001/CHAT-002/MOIM-002), createMoim (atomic entry). + @MX:REASON.
- @MX:NOTE: leave (owner-leave block = orphan prevention), MoimModule boundary + nickname display-name source.
