# SPEC Review Report: SPEC-MOIM-001
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.62

> M1 Context Isolation: No author reasoning context was provided with the invocation. Audit performed solely on `spec.md` (primary) with `acceptance.md` and `plan.md` as cross-reference. Reasoning context ignored per M1 Context Isolation.

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-MOIM-001 (spec.md:L44), REQ-MOIM-002 (L48), REQ-MOIM-003 (L52), REQ-MOIM-004 (L56), REQ-MOIM-005 (L60). Sequential 001-005, no gaps, no duplicates, consistent zero-padding. Verified end-to-end, not spot-checked.
- [FAIL] MP-2 EARS format compliance: REQ-MOIM-003 (spec.md:L52-54) bundles TWO independent Event-driven behaviors in a single requirement: "**When** 멤버가 탈퇴를 요청하면... 삭제한다(shall)" AND "**When** 멤버가 멤버 목록을 요청하면... 반환한다(shall)". A criterion must match exactly one EARS pattern (M3 rubric 1.0 anchor); this compound criterion matches two. The bundling appears motivated by the self-imposed cap at spec.md:L42 ("요구사항 모듈: 5개 (한도 준수)"). All other REQs individually match valid EARS patterns: REQ-MOIM-001 Ubiquitous (L46), REQ-MOIM-002 Event-driven (L50), REQ-MOIM-004 State-driven (L58), REQ-MOIM-005 Unwanted If/then (L62). Note: acceptance.md scenarios are honestly labeled Given/When/Then test scenarios (acceptance.md:L3), not mislabeled as EARS — the mislabeling clause does not trigger.
- [FAIL] MP-3 YAML frontmatter validity: Two required fields missing.
  1. `labels` (array or string) is entirely absent from frontmatter (spec.md:L1-L10). Missing required field = FAIL.
  2. `created_at` is absent; the frontmatter uses `created: 2026-06-11` (spec.md:L5) instead. Field name does not match the required schema.
  Additionally `priority: High` (spec.md:L8) does not match the allowed enum values (critical, high, medium, low — lowercase). Present and valid: `id: SPEC-MOIM-001` (L2, matches SPEC-{DOMAIN}-{NUM}), `version: "0.1.0"` (L3, string), `status: draft` (L4, valid enum).
- [N/A] MP-4 Section 22 language neutrality: N/A — single-project SPEC scoped to the moyura NestJS/Prisma backend (spec.md:L23, L27). Not template-bound or multi-language tooling content.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.50 | 0.50 — multiple requirements require interpretation | spec.md:L58 "멤버 한정 조회(멤버 목록 등)" — "등" leaves the member-only endpoint set unenumerated; owner-leave behavior unspecified (L52-54 vs L50); moim deletion authorization unspecified despite plan.md:L20 listing `DELETE /moims/:id` |
| Completeness | 0.50 | 0.50 — frontmatter missing two fields; sections externalized | Frontmatter missing `labels` and `created_at` (spec.md:L1-10); no ACCEPTANCE CRITERIA section or link to acceptance.md anywhere in spec.md; title promises "Moim CRUD" (L12) but no R/U/D requirements exist |
| Testability | 0.75 | 0.75 — mostly binary-testable with minor judgment calls | ACs assert concrete status codes and row states (acceptance.md:L8, L13, L18, L23, L28 — good); but acceptance.md:L35 "멱등 처리(204 또는 404, 구현 시 결정)" is non-deterministic; spec.md:L58 "등" requires judgment |
| Traceability | 0.75 | 0.75 — one REQ uncovered | REQ-MOIM-001 (spec.md:L44-46) has NO corresponding AC. Mapping verified for every REQ: REQ-002←AC-1 (acceptance.md:L5), REQ-003←AC-4,AC-5 (L20, L25), REQ-004←AC-2 (L10), REQ-005←AC-3 (L15). All ACs reference valid REQs; no orphaned ACs |

## Defects Found

D1. spec.md:L1-L10 — Required frontmatter field `labels` (array or string) is entirely absent. — Severity: critical (MP-3)
D2. spec.md:L5 — Frontmatter uses `created: 2026-06-11` instead of the required field name `created_at`. — Severity: critical (MP-3)
D3. spec.md:L8 — `priority: High` does not match the allowed enum (critical/high/medium/low, lowercase). — Severity: major (FC-5)
D4. spec.md:L52-L54 — REQ-MOIM-003 is a compound requirement: two independent Event-driven behaviors (member leave + member list retrieval) in one criterion. Must be split into two REQs; the "5개 한도" note at L42 is not a valid reason to bundle. — Severity: major (MP-2)
D5. spec.md:L44-L46 / acceptance.md — REQ-MOIM-001 (인증 가드 적용) has no acceptance criterion. AC-3 (acceptance.md:L15-18) traces to REQ-MOIM-005, leaving REQ-MOIM-001 uncovered. — Severity: major (Traceability, AC-5)
D6. spec.md:L12 vs L44-L62 — Title claims "Moim CRUD + 멤버십" and plan.md:L20 lists routes `GET /moims`, `GET /moims/:id`, `DELETE /moims/:id`, but spec.md contains NO requirement for moim read, update, or delete, and no owner-only deletion authorization rule. Exclusion at L71 ("onDelete: Cascade 채택") presupposes deletion is in scope without a governing REQ. — Severity: major (Completeness/Consistency CN-2)
D7. spec.md:L46 — REQ-MOIM-001 hardcodes the implementation class name `SupabaseAuthGuard` in normative requirement text (HOW, not WHAT). The requirement should state the behavior (reject requests without a verified identity); the guard class belongs in plan.md (where it already appears, plan.md:L21). — Severity: major (RQ-3/RQ-4)
D8. spec.md:L52-L54 + L50 — Owner-leave is unspecified: REQ-MOIM-003 allows any member to leave, and acceptance.md:L33 confirms "owner도 멤버", so the owner leaving produces an ownerless moim — conflicting with the owner invariant established by REQ-MOIM-002 while owner transfer is excluded (L68). Behavior must be specified (block owner leave, or define orphan handling). — Severity: major (Consistency CN-1)
D9. spec.md:L58 — "멤버 한정 조회(멤버 목록 등)" — "등" (etc.) leaves the set of member-only endpoints unenumerated; 403 coverage is not binary-testable across endpoints. — Severity: minor (AC-2)
D10. acceptance.md:L35 — Edge case defers behavior to implementation: "멱등 처리(204 또는 404, 구현 시 결정)". Acceptance criteria must be deterministic before run phase. — Severity: minor (Testability)
D11. spec.md (whole document) — No ACCEPTANCE CRITERIA section and no reference/link to acceptance.md; the AC document is discoverable only by directory convention. — Severity: minor (SC-5)

## Chain-of-Verification Pass

Second-look findings: D6 (CRUD scope mismatch) and D8 (owner-leave contradiction) were discovered on the second pass by cross-checking plan.md routes and acceptance.md edge cases against the REQ set — they were not visible from a section-by-section first read. Re-verified on second pass: (1) every REQ entry read in full, L44-L62, not skimmed; (2) REQ sequencing checked end-to-end 001→005; (3) traceability verified for all 5 REQs and all 5 ACs individually; (4) Exclusions section (L64-L71) checked for specificity — 6 entries, all specific with delegation targets, PASS as a section; (5) cross-requirement contradiction scan produced D8. No further defects found beyond D1-D11.

## Regression Check (Iteration 2+ only)

N/A — iteration 1.

## Recommendation

FAIL. Fix instructions for manager-spec, in priority order:

1. (D1, MP-3) Add `labels` to the YAML frontmatter, e.g. `labels: [backend, prisma, membership]`.
2. (D2, MP-3) Rename frontmatter field `created` to `created_at` (keep ISO format `2026-06-11`).
3. (D3) Change `priority: High` to `priority: high`.
4. (D4, MP-2) Split REQ-MOIM-003 into two single-behavior Event-driven requirements (e.g., REQ-MOIM-003 탈퇴, REQ-MOIM-006 멤버 목록 조회) and renumber/remap ACs accordingly. Remove or revise the "5개 한도" constraint note at L42 — requirement atomicity outranks a count cap.
5. (D5) Add an AC for REQ-MOIM-001 (guard applied to ALL moim routes — e.g., parameterized 401 test across every route), or re-map AC-3 with explicit dual coverage.
6. (D6) Either add requirements for moim read/delete (including owner-only delete authorization and cascade behavior currently implied by L71 and plan.md:L20), or remove those routes from plan.md and narrow the title "CRUD".
7. (D7) Rewrite REQ-MOIM-001 in behavioral terms (reject access without a verified identity → 401); move `SupabaseAuthGuard` reference to plan.md only.
8. (D8) Specify owner-leave behavior in REQ or Exclusions (recommended: owner cannot leave while other members exist / owner leave deletes moim — pick one and state it).
9. (D9) Enumerate the member-only endpoints in REQ-MOIM-004 (remove "등").
10. (D10) Decide 204 vs 404 for non-member membership DELETE now; record the decision in acceptance.md.
11. (D11) Add an explicit link to acceptance.md from spec.md (e.g., in section 4 header or HISTORY).

🗿 MoAI <email@mo.ai.kr>
