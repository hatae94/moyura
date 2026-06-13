# Task Decomposition — SPEC-MOIM-002 (초대 링크 + 게스트 참여)

Approved: 2026-06-13 (autonomous, auto-proceed). TDD jest, coverage 85%. Branch feature/SPEC-MOBILE-004. Local-only.
Corrections: X-1 GoneException(410)/ConflictException(409) standard exceptions / X-2 api-client:generate+typecheck / X-3 Moim.invites[] additive back-relation / X-4 supabase npx stop&&start (no reset). Reuse MOIM-001 assertOwner (no reimplement). crypto.randomBytes(32)=256-bit token. No new backend deps.

| Task | Description | REQ / AC | Deps | Files | Status |
|------|-------------|----------|------|-------|--------|
| T-001 | MoimInvite model + Moim.invites[] back-relation + migrate add_moim_invite | data foundation | - | schema.prisma [M], migrations/ [N] | pending |
| T-002 | InviteService.create() — assertOwner + crypto token(256-bit) + expiresAt default 7d/cap 30d(400) | REQ-INV-001/004 / AC-1,5a | T-001 | invite.service.ts [N] + spec | pending |
| T-003 | list() + revoke() — both assertOwner (owner-only) | REQ-INV-002/003/004 / AC-6,4,5bc | T-002 | invite.service.ts + spec | pending |
| T-004 | accept() happy path — membership(member,nickname) + usedCount atomic increment ($transaction) [@MX:ANCHOR] | REQ-INV-005 / AC-2 | T-001 | invite.service.ts + spec | pending |
| T-005 | accept() invalid token — unknown 404 / expired·revoked 410(GoneException) / exceeded 409(ConflictException), no side-effect | REQ-INV-006 / AC-3 | T-004 | invite.service.ts + spec | pending |
| T-006 | accept() idempotent — already-member re-accept: no dup, usedCount unchanged | REQ-INV-005 / AC-7 | T-004,T-005 | invite.service.ts + spec | pending |
| T-007 | InviteController(4 routes, @UseGuards) + DTOs + InviteModule(imports MoimModule,AuthModule) + app.module register + integration spec(401/403/404/410/409, idempotent) | all REQ HTTP / AC-1~7 | T-002~006 | invite.controller.ts [N], dto/ [N], invite.module.ts [N], invite.integration.spec.ts [N], app.module.ts [M] | pending |
| T-008 | supabase config enable_anonymous_sign_ins=true + npx supabase stop&&start (no reset) | REQ-INV-007 전제 | - | supabase/config.toml [M] | pending |
| T-009 | web /invite/[token] page + accept helper — signInAnonymously→nickname→accept→/moims/[id]/chat redirect [@MX:NOTE] | REQ-INV-007 / AC-8 | T-007,T-008,T-010 | apps/web/app/invite/[token]/page.tsx [N], lib/invite/accept.ts [N] | pending |
| T-010 | openapi + api-client regen (generate+typecheck) + gates (jest 85%+, backend typecheck, web build+lint) | gates | T-007 | openapi.json [regen], api-client schema.d.ts [regen] | pending |

## MX plan
- @MX:ANCHOR: accept() (guest join entry, web depends, idempotent+validation contract)
- @MX:WARN+REASON: token generation (crypto.randomBytes(32), no weak RNG)
- @MX:NOTE: signInAnonymously (web — guest gets real sub, guard/RLS/FK unchanged; cookie-loss=new guest), assertOwner reuse, list() owner-only (response carries live tokens)

## Migration
schema edit → `cd apps/backend && pnpm exec prisma migrate dev --name add_moim_invite` (moim_invite CREATE only, moim untouched) → prisma generate → supabase config + `npx supabase stop && start`.

## Gates
jest 85%+, backend:typecheck 0, web build+lint, anon config applied, api-client:generate+typecheck. AC-1~8 + fixed codes 404/410/409/403.
