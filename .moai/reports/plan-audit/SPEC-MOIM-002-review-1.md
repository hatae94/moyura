# SPEC Review Report: SPEC-MOIM-002
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.65

Reasoning context ignored per M1 Context Isolation. (No author reasoning was passed; audit performed solely on `.moai/specs/SPEC-MOIM-002/` artifacts. Sibling SPEC frontmatter was read only to determine whether defects are SPEC-local or template-systematic.)

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-INV-001 (spec.md:L47), REQ-INV-002 (L50), REQ-INV-003 (L53), REQ-INV-004 (L56), REQ-INV-005 (L59). Sequential 001–005, zero gaps, zero duplicates, consistent 3-digit zero-padding. Verified end-to-end, cross-checked against spec-compact.md:L6–L10 (identical set).
- [PASS] MP-2 EARS format compliance: All 5 requirements carry explicit EARS pattern tags and match the tagged pattern structure:
  - REQ-INV-001 [Event-driven] "**When** 모임 owner가 초대 발급을 요청하면, 시스템은 … 생성하고 토큰을 반환한다(shall)" (spec.md:L48)
  - REQ-INV-002 [Event-driven] (L51), REQ-INV-003 [State-driven] "**While** 토큰이 … 상태인 동안, 시스템은 … 거부한다(shall)" (L54), REQ-INV-004 [Event-driven] (L57), REQ-INV-005 [Unwanted] "**If** … **then** 시스템은 403으로 거부한다" (L60).
  - Interpretation note (documented per M4): acceptance.md AC-1–AC-5 are Given/When/Then scenarios, but they are explicitly labeled "Given/When/Then 시나리오" (acceptance.md:L3) — NOT mislabeled as EARS. The MoAI template designates spec.md §4 as the EARS artifact and acceptance.md as GWT scenarios; all 13 sibling SPECs share this structure. MP-2 is graded against the EARS-designated content. If the orchestrator intends MP-2 to require EARS in acceptance.md, this becomes a template-level finding, not a SPEC-author defect.
- [FAIL] MP-3 YAML frontmatter validity: Frontmatter (spec.md:L1–L10) contains `id, version, status, created, updated, author, priority, issue_number`. Required field `labels` is ABSENT entirely. Required field `created_at` is absent under that name (`created: 2026-06-11` at L5 is an ISO date but not the contracted field name). Per contract: "Any missing required field = FAIL." Systematic note: all 13 SPECs in `.moai/specs/` lack `labels` and use `created` — this is a template-level mismatch with the audit contract, but it still fails as written. Additional non-blocking finding: `priority: High` (L8) — capitalized, deviating from the contract enum (critical/high/medium/low) and from older sibling convention (`high` in SPEC-AUTH-001, SPEC-MOBILE-002).
- [N/A] MP-4 Section 22 language neutrality: N/A — single-stack product SPEC (TypeScript monorepo: NestJS backend `apps/backend`, Next.js web `apps/web`, Supabase). Not template-bound or multi-language tooling content. Auto-pass.

## Category Scores (0.0–1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 — minor ambiguity in one or two requirements | REQs are mostly single-interpretation with measurable values (≥128-bit, now+7d, 403). Ambiguities: "410(Gone) 또는 409" leaves status code to implementer choice (spec.md:L54); "조정 가능" on expiresAt is unbounded (L48); REQ-INV-004 disjunctive response "반환하거나 … 설정한다" (L57). |
| Completeness | 0.50 | 0.50 — frontmatter missing one or two fields | Sections present: HISTORY (L14), Goal/WHAT (L23), Context/WHY (L27), REQUIREMENTS (L43), Exclusions (L62, 5 specific entries); AC in acceptance.md, HOW in plan.md per template. Frontmatter missing `labels` + `created_at` (L1–L10) forces the 0.50 band. Substantive gap: the headline guest web-join flow has no REQ (see D2). |
| Testability | 0.75 | 0.75 — one AC measurable with minor interpretation | ACs are binary-testable with concrete codes/values (acceptance.md:L8, L13, L18, L28). No weasel words ("appropriate/reasonable/adequate") found in any AC. Interpretation points: "410 또는 409" set-membership (L18, L33); AC-4 "(또는 revoke 엔드포인트)" endpoint ambiguity (L22); DoD "abuse 완화 … 문서화" (L54) not crisply binary. |
| Traceability | 0.65 | between 0.50 and 0.75 — multiple partial coverage holes | Positive: every AC cites a valid existing REQ (AC-1→REQ-INV-001 … AC-5→REQ-INV-005, acceptance.md:L5–L29); every REQ has ≥1 AC. Holes: REQ-INV-004's list-half has NO AC (only revoke tested, L20–L23); non-owner revoke 403 has no AC (AC-5 tests only POST issue, L26–L28); edge cases 400/404/atomic-update (L33–L36) and DoD web-landing item (L51) trace to no REQ. |

## Defects Found

D1. spec.md:L1–L10 — YAML frontmatter missing required `labels` field; `created_at` absent (file uses `created`, L5). Must-pass MP-3 violation. Systematic across all 13 repo SPECs (template-level), but FAIL per contract as written. — Severity: critical
D2. spec.md:L43–L60 vs L77, acceptance.md:L51 — The SPEC's headline deliverable "게스트 참여" (guest join via anonymous login web landing: `/invite/[token]` → `signInAnonymously()` → nickname → accept → redirect to chat) has NO requirement and NO acceptance criterion. It appears only in Delta Markers (spec.md:L77), plan.md M3, and DoD (acceptance.md:L51). All 5 REQs cover only the backend invite API. A core scope item is untraced and formally untestable. The cause appears to be the self-imposed "요구사항 모듈: 5개 (한도 준수)" cap (spec.md:L45). — Severity: major
D3. spec.md:L57, L60 — Non-owner access to the invite LIST is unspecified. REQ-INV-004 grants owner list/revoke; REQ-INV-005 blocks non-owners only for 발급/폐기 (issue/revoke). A regular member requesting `GET` invite list is undefined behavior — and the list response contains live, secret invite tokens (token = `@id`, plan.md:L40), so this gap is a token-leak channel. — Severity: major
D4. spec.md:L57 + acceptance.md:L20–L23 — REQ-INV-004 is a compound requirement (list OR revoke) and AC-4 verifies only the revoke half. Invite list retrieval has no acceptance criterion at all. — Severity: major
D5. spec.md:L54, acceptance.md:L18, L33 — "410(Gone) 또는 409" is non-deterministic: the SPEC permits either code for expired/revoked/max-uses rejection. Implementations will diverge; clients cannot rely on a code per condition. Pin one code per failure class (e.g., 410 expired/revoked, 409 max_uses exceeded, 404 unknown token). — Severity: minor
D6. spec.md:L59–L60, acceptance.md:L26–L29 — REQ-INV-005 merges two unrelated requirements (non-owner authz 403 + idempotent re-accept) into one [Unwanted] entry; additionally, non-owner REVOKE attempt (named in the REQ) has no AC — AC-5's When covers only `POST /moims/A/invites`. — Severity: minor
D7. acceptance.md:L33–L36 — Edge cases (nickname empty → 400, unknown token → 404, concurrent accept → atomic conditional update) have no backing REQ. They are orphaned criteria relative to the requirements set; the 404-for-unknown-token case is not derivable from REQ-INV-003 (which covers only expired/revoked/exceeded). — Severity: minor
D8. spec.md:L51 vs acceptance.md:L13 — REQ-INV-002's response clause omits nickname persistence ("moim_member row를 생성하고 usedCount를 증가시킨다"), yet AC-2 asserts `nickname="게스트1"` is stored. The tested behavior is not in the requirement text. (Related nit: AC-1 returns 201 for invite creation while AC-2 returns 200 for member creation — inconsistent creation semantics, acceptable but worth pinning.) — Severity: minor
D9. spec.md:L19, L40, L48 — `expiresAt` is "조정 가능" with no upper bound. Assumption §3 (L40–L41) relies on expiry to limit token-exposure risk, but an owner may set an effectively permanent expiry, undermining the stated mitigation. Specify a max TTL or explicitly accept unbounded with rationale. — Severity: minor
D10. spec.md:L8 — `priority: High` capitalization deviates from the contract enum (lowercase) and from older sibling SPECs (`high`). — Severity: minor
D11. spec.md:L60, acceptance.md:L29 — Idempotent re-accept's effect on `usedCount` is unspecified. REQ-INV-005 forbids duplicate rows but is silent on whether a re-accept consumes a use; AC-5 does not assert `usedCount` unchanged. Under maxUses this matters. — Severity: minor

## Chain-of-Verification Pass

Second-look findings: D8 (nickname persistence missing from REQ-INV-002 response clause) and D11 (usedCount on idempotent accept) were discovered only on the re-read — first pass had skimmed REQ-INV-002/005 effects. Re-verified on second pass:
- Every REQ entry re-read individually (L47–L60): no additional pattern violations.
- REQ sequencing re-checked end-to-end including spec-compact.md and plan.md cross-references: consistent.
- Traceability re-walked REQ-by-REQ (not sampled): confirmed REQ-INV-004 list-half hole (D4) and the AC-5 revoke hole (D6).
- Exclusions (spec.md:L62–L68) re-checked for specificity: 5 concrete, falsifiable entries (전환 UI, QR, email/SMS 발송, per-invite 역할, 분석/통계) — PASS, no vague entries.
- Cross-requirement contradiction scan (CN-1): none found. Exclusions vs REQs (CN-2): consistent — "per-invite 역할 지정" exclusion matches role=member fixed; identity-linking exclusion matches Context L32 (설명만). Priority/scope (CN-3): consistent.
- spec-compact.md vs spec.md: REQ/AC/Exclusion sets match; no drift.

## Regression Check (Iteration 2+ only)

N/A — iteration 1, no prior report.

## Recommendation

FAIL — fix instructions for manager-spec, in priority order:

1. (D1, blocking) Frontmatter: add `labels` (e.g., `labels: [invite, guest, anonymous-auth, supabase, moim]`) and a `created_at` ISO field to spec.md:L1–L10. ORCHESTRATOR NOTE: this defect is template-systematic (all 13 sibling SPECs use `created` and omit `labels`). If the repo template is the sanctioned source of truth, recalibrate the MP-3 field list instead of patching one SPEC; otherwise fix the template and this SPEC together. manager-spec should not silently diverge from the repo template for one SPEC.
2. (D2, major) Add REQ-INV-006 [Event-driven] for the guest web landing flow: "When an unauthenticated user opens `/invite/:token`, the system shall establish an anonymous Supabase session, collect a nickname, submit acceptance, and redirect to the moim chat." Add a matching AC. If the 5-REQ cap (spec.md:L45) forbids this, raise the cap — the cap is currently forcing the SPEC's title feature out of its own requirements (and causing the compound REQs in D6).
3. (D3, major) Specify non-owner invite-list access: extend REQ-INV-005 (or REQ-INV-004) to "발급/조회/폐기" with 403, and add an AC. Note the security stake: list responses contain live tokens.
4. (D4/D6) De-compound REQ-INV-004 and REQ-INV-005 or, minimally, add ACs for the untested halves: invite list retrieval (owner 200 + shape) and non-owner revoke 403.
5. (D5/D7) Pin one HTTP status per failure class (suggest: 404 unknown, 410 expired/revoked, 409 max_uses) in REQ-INV-003, and promote the orphaned edge cases (nickname 400, unknown token 404, atomic usedCount) into REQ text or sub-clauses so every tested behavior traces to a REQ.
6. (D8/D11) In REQ-INV-002, state that the created `moim_member` records the submitted nickname; in REQ-INV-005, state that idempotent re-accept does not increment `usedCount`, and assert it in AC-5.
7. (D9) Bound `expiresAt` (e.g., max 30d) or add an explicit rationale for unbounded adjustability to §3 Assumptions.
8. (D10) Normalize `priority` to lowercase `high`.

Strengths to preserve (do not regress while fixing): clean sequential REQ numbering, explicit EARS pattern tags per REQ, concrete measurable values (≥128-bit entropy, now+7d, 403), specific 5-entry Exclusions, 1:1 AC→REQ citations, and the concurrency edge case (atomic usedCount, acceptance.md:L34).
