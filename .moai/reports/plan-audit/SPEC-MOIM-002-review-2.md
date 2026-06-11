# SPEC Review Report: SPEC-MOIM-002
Iteration: 2/3
Verdict: PASS
Overall Score: 0.91

Reasoning context ignored per M1 Context Isolation. (No author reasoning was passed. The orchestrator-adjudicated audit contract — 8-field frontmatter `id/version/status/created/updated/author/priority/issue_number`, no `labels`, GWT ACs in acceptance.md with REQ→AC references in spec.md — was NOT taken on trust: it was independently verified against 5 sibling SPECs (SPEC-AUTH-001, SPEC-CHAT-001, SPEC-MOIM-001, SPEC-MOBILE-004, SPEC-ENV-SETUP-001), all of which carry exactly that 8-field set with `created` and no `labels`. MP-3 and SC-5 are graded against this verified contract, consistent with iteration 1's ORCHESTRATOR NOTE on D1.)

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-INV-001 (spec.md:L57), 002 (L60), 003 (L63), 004 (L66), 005 (L71), 006 (L74), 007 (L77). Sequential 001–007, zero gaps, zero duplicates, consistent 3-digit padding. Verified end-to-end (not sampled) and cross-checked against spec-compact.md:L6–L12 and plan.md:L13–L19 (identical 7-REQ set in both).
- [PASS] MP-2 EARS format compliance: all 7 REQs carry explicit pattern tags matching their structure — REQ-INV-001/002/003/005/007 [Event-driven] "**When** …, 시스템은 …한다(shall)" (L58, L61, L64, L72, L78); REQ-INV-004 [Unwanted] "**If** … **then** 시스템은 처리 없이 403으로 거부한다" (L67); REQ-INV-006 [State-driven] "**While** 토큰이 … 상태인 동안, 시스템은 … 거부한다" (L75). Documented interpretation (M4): Korean normative "~한다" form is the established shall-equivalent in this repo (same grading as iteration 1). One formatting deviation: REQ-INV-005's second (idempotency) sentence has full event-driven structure ("이미 멤버인 사용자가 재수락하면, 시스템은 …" = trigger + system + response, L72) but omits the bold **When** keyword and "(shall)" marker — logged as minor defect D13, not a pattern violation. acceptance.md AC-1–AC-8 are GWT scenarios explicitly labeled as such (acceptance.md:L5), which is the sanctioned artifact split per the adjudicated contract.
- [PASS] MP-3 YAML frontmatter validity: spec.md:L1–L10 contains exactly the 8 contracted fields — `id: SPEC-MOIM-002` (L2, matches SPEC-{DOMAIN}-{NUM}), `version: "0.1.1"` (L3, string), `status: draft` (L4, valid enum), `created: 2026-06-11` (L5, ISO date), `updated: 2026-06-11` (L6), `author: hatae` (L7), `priority: high` (L8, lowercase enum — iteration-1 D10 fixed), `issue_number: 0` (L9, matches newer sibling convention). No missing fields, no type mismatches.
- [N/A] MP-4 Section 22 language neutrality: N/A — single-stack product SPEC (TypeScript monorepo: NestJS `apps/backend`, Next.js `apps/web`, Supabase). Not template-bound or multi-language tooling content. Auto-pass (unchanged from iteration 1).

## Category Scores (0.0–1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.85 | 0.75–1.0 — minor ambiguity a reasonable engineer resolves consistently | Failure codes now deterministic per class (spec.md:L53, L75); expiresAt bounded ("상한 30일", L48, L58); single-interpretation REQs with measurable values (≥128-bit, +7d, 403). Residual ambiguities: cap-exceeded behavior (clamp vs reject-400) not in REQ text (L58 vs acceptance.md:L52); sessioned-visitor landing flow unspecified (L77–78, D15); invite "상태" enumeration loose (L61). |
| Completeness | 0.95 | 1.0 — all sections present, frontmatter complete | HISTORY (L16), Goal (L31), Context (L35), Assumptions (L45), EARS REQUIREMENTS (L51, 7 REQs), Exclusions with 5 specific entries (L80–86), Delta Markers (L88), Dependencies (L98), Quality Gate (L104); ACs in acceptance.md per template; frontmatter 8/8. Headline guest-join feature now first-class (REQ-INV-007 + AC-8) — iteration-1's substantive gap closed. Nit: sessioned-visitor case (D15). |
| Testability | 0.95 | 1.0 — every AC binary-testable | All 8 ACs assert concrete codes/values: 201+entropy+now+7d (acceptance.md:L10), 200+role/nickname/usedCount+1 (L15), 404/410/410/409+불변 (L20), revokedAt→410 (L25), 3×403+부작용 없음 (L30), 200+목록 (L35), 멱등+usedCount 불변 (L40), 세션+멤버십+리다이렉트 (L45). No weasel words (appropriate/reasonable/적절한) in any AC. DoD abuse item now enumerates its four mitigations (L71). AC-8 automated gate is build/lint only (documented repo constraint, L45). |
| Traceability | 0.90 | 0.75–1.0 — formal set bijective; one indirect edge-case mapping | Every AC header cites a valid existing REQ (AC-1→001, AC-2→005, AC-3→006, AC-4→003, AC-5→004, AC-6→002, AC-7→005, AC-8→007; acceptance.md:L7–L45) and every spec.md REQ carries a matching "— AC:" reference (L58–L78) — walked REQ-by-REQ, fully consistent both directions, no orphans, no uncovered REQs. Edge cases all carry REQ annotations (L49–L53); the nickname-400 and cap-400 mappings are indirect (D12). |

## Defects Found

D12. spec.md:L53, L58 + acceptance.md:L49, L52 — The 400 input-error class is absent from the fixed-code enumeration "미지 404 / 만료·폐기 410 / 초과 409 / 인가 403" (L53), yet two edge cases assert 400 (nickname 빈/누락, expiresAt 상한 초과) and plan.md:L13 pins "만료>30d 400". REQ-INV-001 states the 30-day cap but not the rejection semantics (clamp vs 400); REQ-INV-005's trigger mandates nickname but no REQ states the 400 response. Add "입력 오류 400" to L53 and a rejection clause to REQ-INV-001. — Severity: minor
D13. spec.md:L72 — REQ-INV-005's second sentence (멱등 clause) is a second event-driven statement without the bold **When** keyword or "(shall)" marker used by every other normative clause; the REQ packs two triggers (first accept / re-accept). Structure is EARS-conformant in substance; formatting and atomicity deviate from the document's own convention. — Severity: minor
D14. spec-compact.md:L12 vs spec.md:L77 — REQ-INV-007 is tagged [State-driven] in spec-compact.md but [Event-driven] in spec.md. spec.md's tag matches its own When-trigger text; the compact artifact is stale (spec.md edited after compact regeneration). Regenerate spec-compact.md. — Severity: minor
D15. spec.md:L77–78 — REQ-INV-007 covers only "세션이 없는 사용자". Landing behavior for visitors WITH an existing session (registered user or returning guest clicking an invite link) is unspecified in any REQ; plan.md:L37 ("세션 없으면 signInAnonymously()") implies skip-signin but the spec is silent. — Severity: minor

No critical or major defects found.

## Chain-of-Verification Pass

Second-look findings: D14 (spec-compact.md pattern-tag drift) and D15 (sessioned-visitor gap) were found only on the second pass — the first pass had checked compact only for REQ-set identity, not tag identity. Re-verified on second pass:
- Every REQ entry re-read individually (L57–L78): no additional pattern violations; no endpoint paths or DB operations remain in REQ normative text (HISTORY L23 claim verified — HOW correctly relocated to plan.md).
- REQ sequencing re-checked end-to-end across spec.md, spec-compact.md, plan.md: consistent 001–007.
- Traceability re-walked for all 7 REQs and all 8 ACs in both directions (not sampled): bijective; spec.md "AC:" annotations exactly match acceptance.md headers.
- Exclusions (L80–86) re-checked: 5 concrete, falsifiable entries (전환 UI, QR, email/SMS, per-invite 역할, 분석/통계) — no vague entries.
- Cross-requirement contradiction scan (CN-1): probed the REQ-INV-005 idempotency clause vs REQ-INV-006 rejection for "already-member with invalid token" — no contradiction: 005's second sentence imposes only negative obligations (no duplicate row, no usedCount increment), which remain satisfied under 006's 410/409/404 rejection; AC-7's Given pins the valid-token success path. CN-2: Exclusions consistent with REQs (per-invite 역할 exclusion ↔ role=member in AC-2; 전환 UI exclusion ↔ Context L40 설명만). CN-3: priority/labels/scope consistent (depends: SPEC-MOIM-001, parallel-with SPEC-CHAT-001).
- Weasel-word scan across spec.md + acceptance.md: none in normative text or ACs.

## Regression Check (Iteration 2+ only)

Defects from previous iteration (.moai/reports/plan-audit/SPEC-MOIM-002-review-1.md):

- D1 (critical, MP-3 frontmatter): RESOLVED — orchestrator recalibrated MP-3 to the repo-verified 8-field contract per iteration-1's ORCHESTRATOR NOTE; spec.md:L1–L10 conforms exactly; `priority` lowercased (L8).
- D2 (major, guest web-join untraced): RESOLVED — REQ-INV-007 [Event-driven] (spec.md:L77–78) + AC-8 (acceptance.md:L42–45) cover landing → 익명 로그인 → nickname → accept → chat redirect.
- D3 (major, non-owner list unspecified / token-leak channel): RESOLVED — REQ-INV-004 explicitly extends 403 to 발급·목록 조회·폐기 with the token-leak rationale inline (L67); AC-5(b) tests GET list → 403 (acceptance.md:L29–30).
- D4 (major, list retrieval no AC): RESOLVED — REQ-INV-002 (L60–61) de-compounded from revoke + dedicated AC-6 (L32–35).
- D5 (minor, "410 또는 409" non-determinism): RESOLVED — codes pinned per failure class (L53, REQ-INV-006 L75, AC-3 L20, AC-4 L25).
- D6 (minor, compound REQ + non-owner revoke untested): RESOLVED — authz separated into REQ-INV-004 with AC-5(c) covering DELETE 403; idempotency has dedicated AC-7. (Residual formatting on the idempotency clause logged as new D13.)
- D7 (minor, orphaned edge cases): RESOLVED with residual — unknown-token 404 now normative in REQ-INV-006 (L75); concurrent-accept outcome backed by REQ-INV-006 (초과 409) + REQ-INV-005 usedCount semantics, mechanism correctly placed in plan.md:L30; all edge cases now carry explicit REQ annotations (acceptance.md:L49–53). Residual: the 400 code itself is not normatively pinned in REQ text or the L53 enumeration — re-logged as new D12 (minor), not a carry-over FAIL, because the defect's stated harm (orphaned criteria with no backing REQ) is materially fixed.
- D8 (minor, nickname persistence not in REQ): RESOLVED — REQ-INV-005 "해당 nickname을 가진 멤버십을 생성하고" (L72); AC-2 asserts nickname stored (L15).
- D9 (minor, unbounded expiresAt): RESOLVED — 상한 30일 in Assumptions (L48), REQ-INV-001 (L58), edge case (acceptance.md:L52), risk table (plan.md:L75).
- D10 (minor, `priority: High`): RESOLVED — `priority: high` (L8).
- D11 (minor, usedCount on idempotent re-accept): RESOLVED — "사용 횟수도 증가시키지 않는다(멱등)" (L72) + AC-7 "usedCount 불변" (L40).

Resolution: 11/11 addressed; 10 fully resolved, 1 (D7) resolved with a minor residual re-logged as D12. No defect persists unchanged — no stagnation.

## Recommendation

PASS — all four must-pass criteria hold with evidence: MP-1 (sequential REQ-INV-001–007, L57–L77, cross-artifact consistent), MP-2 (all 7 REQs tagged and structurally matching their EARS pattern, L58–L78), MP-3 (8/8 contracted frontmatter fields with correct types, L1–L10, contract independently verified against 5 sibling SPECs), MP-4 (N/A, single-stack product SPEC). All three iteration-1 majors (D2/D3/D4) and the critical (D1) are demonstrably closed; traceability is now bijective across REQ↔AC.

Non-blocking fixes recommended before or during run phase (all minor, no re-audit needed):
1. (D12) Add "입력 오류 400" to the fixed-code enumeration (spec.md:L53) and state the cap-exceeded rejection (400) in REQ-INV-001.
2. (D13) Add the bold keyword + (shall) marker to REQ-INV-005's idempotency sentence, or split it into REQ-INV-005a/sub-clause.
3. (D14) Regenerate spec-compact.md (REQ-INV-007 tag: [State-driven] → [Event-driven]).
4. (D15) Add one sentence to REQ-INV-007 (or an Assumption) covering sessioned visitors on the landing page.

Strengths preserved from iteration 1 (verified no regression): sequential numbering, explicit EARS tags, measurable values (≥128-bit, +7d/30d cap, fixed codes), 5-entry specific Exclusions, concurrency edge case, and clean WHAT/HOW separation (endpoints and DB ops now live only in plan.md).
