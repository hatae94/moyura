# SPEC Review Report: SPEC-MOBILE-NAV-001
Iteration: 1/3
Verdict: PASS
Overall Score: 0.93

> Reasoning context ignored per M1 Context Isolation. This audit judges ONLY the on-disk documents: `spec.md` (primary), `plan.md`, `acceptance.md`, `spec-compact.md`, `research.md` (supporting), plus the cross-referenced `SPEC-WEBVIEW-UNIFY-001/spec.md:66` for verifying the shared-channel contract claim.

## Must-Pass Results

- **[PASS] MP-1 REQ number consistency**: 12 REQs — `REQ-MOBNAV-001/002/003` (M1), `010/011/012/013` (M2), `020/021/022` (M3), `030/031` (M4). Consistent 3-digit zero-padding throughout. No duplicates. No unintended gaps — the ranges `004-009`, `014-019`, `023-029` are deliberate module-reserved blocks under the declared scheme (spec.md:74 "요구사항 ID prefix: REQ-MOBNAV-NNN", module-block numbering matching the sibling convention in SPEC-MOBILE-003). Verified identical REQ set across spec.md, spec-compact.md (:10-27), and plan.md §3 via set comparison.
- **[PASS] MP-2 EARS format compliance**: All 12 REQ shall-statements match a declared EARS pattern (the SPEC declares a 6-pattern taxonomy incl. Complex at spec.md:74). State-driven: REQ-001 (`WHILE ... the app shall render`, spec.md:79), REQ-002 (spec.md:81), REQ-030 (`WHILE html[data-shell="native"] is set, the web shall hide`, spec.md:108). Event-driven: REQ-010 (`WHEN the web pathname changes ... the web shall report`, spec.md:88), REQ-020 (`WHEN the native back chevron is tapped, native shall post`, spec.md:99). Unwanted (If-Then): REQ-021 (`IF no in-app navigation history exists ... THEN ... shall fall back to router.replace('/home')`, spec.md:101). Complex: REQ-022 (`WHILE ... WHEN ... AND ...; IF ... THEN`, spec.md:103). Ubiquitous: REQ-012 (`The reported title shall be derived from ... never from the static document <title>`, spec.md:92). Acceptance criteria correctly use Given/When/Then (per MoAI convention EARS is for REQs, G/W/T for ACs) — not mislabeled EARS.
- **[PASS] MP-3 YAML frontmatter validity**: All required fields present with correct types (spec.md:1-11): `id: SPEC-MOBILE-NAV-001` (string, matches pattern), `version: "0.1.0"` (quoted string), `status: draft` (string), `created: 2026-07-03` (ISO date), `updated: 2026-07-03` (ISO date), `author: hatae` (string), `priority: high` (string), `issue_number: 0` (documented no-issue at spec.md:18), `labels: [mobile, navigation, webview, native-header, bridge]` (array). The date field is named `created` (not `created_at`); this is the dominant project schema — verified against siblings SPEC-MOBILE-004, SPEC-WEBVIEW-UNIFY-001, SPEC-ACCOUNT-001 which all use `created`. Field name is the project-standard equivalent of MP-3 `created_at`.
- **[N/A] MP-4 Section 22 language neutrality**: N/A — single-project SPEC. Scoped to the moyura monorepo (Expo RN 0.85 / Next.js 16), not template-bound or 16-language LSP tooling. TypeScript/RN/Next references are the project's actual single stack. Auto-passes per the N/A rule.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.95 | 1.0 band (minor) | Every REQ has a single interpretation; file:line anchors are concrete (spec.md:34-36, 108, 110); the 5 header pages are enumerated identically in spec.md:52, acceptance.md:36, spec-compact.md:10. No pronoun ambiguity. One perceptual phrase ("빈 헤더 깜빡임 없이", acceptance.md:76) is device-gated and paired with concrete behavior. |
| Completeness | 0.97 | 1.0 band | All sections present: HISTORY (spec.md:20), Background/WHY (:26), Goal/WHAT (:51), Exclusions (:57, 8 entries), EARS Requirements (:72), Delta Markers (:116), Design Notes (:126), Risks (:135), DoD (:148), Sources (:156). Frontmatter complete. Acceptance.md adds Quality Gate table (:158) + DoD (:167). |
| Testability | 0.92 | 1.0 band (minor) | Every AC carries an explicit 검증 command (vitest / next build / tsc --noEmit / expo export / iOS 시뮬레이터). Device-gated vs locally-verifiable separation is explicit and rigorous (acceptance.md:3-9 taxonomy + :158-165 Quality Gate mapping). Then-clauses are binary (e.g. `{headerVisible: true}`, round-trip decodes to `{kind: "nav-state", ...}`, `next build` 0 errors). No weasel words in ACs or normative REQ text (verified by scan). |
| Traceability | 1.0 | 1.0 band | Every REQ-XXX has >=1 AC and every AC references a valid REQ. Verified by atomic expansion of compound references: REQ-003 ← AC-M1-1 (`REQ-MOBNAV-001/003`), REQ-012 ← AC-M2-2/M2-3 (`REQ-MOBNAV-010/012`), REQ-031 ← AC-M4-2 (`REQ-MOBNAV-030/031`). No uncovered REQ, no orphaned AC (set diff both directions empty). |

## Adversarial Verification of Task-Flagged Contracts

- **Deep-research constraint (onShouldStartLoadWithRequest does NOT catch soft-nav) — NOT VIOLATED**: No requirement relies on `onShouldStartLoadWithRequest` to observe or intercept SPA soft-nav for header/nav purposes. REQ-010 (spec.md:88) mandates web-side pathname observation via `nav:state` (usePathname), REQ-013 (spec.md:94) gates it behind a Phase 0 SPIKE verifying web-side coverage of `<Link>`/`router.push`/Server Action redirect. The Exclusions section (spec.md:63) explicitly kills option A citing the soft-nav 미발화 blocker. The only surviving `onShouldStartLoadWithRequest` usage (plan §6, useAuthBridge.ts:152-238) is the pre-existing Google OAuth hard-nav intercept, which this SPEC does not touch. Constraint respected as the central design driver.
- **Single WebView overlay, no push promotion**: Aligned. `WebViewShell` retained as single WebView owner ([EXISTING], spec.md:122); native-stack push detail screens explicitly excluded (spec.md:63); header is a component-level overlay with `headerShown:false` retained (spec.md:122, plan.md:140) — bridge-driven overlay, NOT native-stack-push. Contract respected.
- **OD-1..5 all resolved**: HISTORY (spec.md:22) enumerates all 5 as 확정; plan §8 marks each [해소]. OD-1→UNIFY-001 delegation (Exclusion spec.md:62), OD-2→nav:back web delegation (REQ-020), OD-3→web-history-first + /home deeplink fallback (REQ-021), OD-4→Phase 0 SPIKE gate (REQ-013), OD-5→iOS swipe-back excluded (Exclusion spec.md:65). Each maps to a REQ or exclusion.
- **nav:* additive channel sharing UNIFY-001 R-U2**: VERIFIED. UNIFY-001 spec.md:66 (R-U2) text reads "navigation-channel bridge message that reuses the existing nonce + trusted-origin security invariants and SHALL NOT alter the v1 session message types" — exactly the shared-channel contract REQ-011 (spec.md:90) claims to inherit. Cross-reference is accurate, not fabricated. Design Notes (spec.md:130) restate it correctly.

## Defects Found

No blocking defects found. Three minor, non-blocking observations (none affect the primary spec.md; all cosmetic or confined to supporting docs):

- **O1. plan.md:147 — wording slip** — The parenthetical "moims/new도 `moims/` 밖 → moims/layout이 커버" is self-contradictory (`moims/new` is INSIDE `apps/web/app/moims/`, not outside). The net routing conclusion (moims/* pages covered by `moims/layout.tsx` 2차 마운트, /home/[id] covered by the (main) mount) is correct and consistent with spec.md:87 and the delta table spec.md:121. — Severity: minor (supporting doc; primary spec unaffected).
- **O2. spec.md:82,109 — EARS label nuance** — REQ-003 `[Un]` and REQ-031 `[Un]` are ubiquitous-prohibition shall-not statements rather than the strict If-Then Unwanted template; REQ-011 is tagged `[E]` but its text is ubiquitous (no When/While trigger). Each remains a valid EARS shall-statement (ubiquitous prohibition / ubiquitous constraint are accepted variants). — Severity: minor (cosmetic label; MP-2 not affected).
- **O3. plan.md §9 vs spec.md/compact Exclusions count** — plan §9 lists 7 exclusion bullets while spec.md and spec-compact.md each carry 8 (plan merges the bridge-session-type non-goal into a §4.3 note). Both authoritative docs (spec + compact) carry the full 8. — Severity: minor (supporting-doc merge; each spec-level exclusion maps to REQ-003 or an OD).

## Chain-of-Verification Pass

Second-look findings performed by re-reading: EARS requirements block (spec.md:76-112), REQ-011↔UNIFY-001 R-U2 cross-reference (UNIFY spec.md:66), full traceability matrix, Exclusions (spec.md:57-68), and inter-requirement contradiction scan.

- **Caught a first-pass skim error**: My initial `grep -oE 'REQ-MOBNAV-[0-9]+'` truncated compound references at the slash, producing a FALSE traceability gap for REQ-003/012/031. Re-extraction preserving slash-compound refs (`REQ-MOBNAV-001/003` etc.) confirmed all 12 REQs are genuinely covered. No real gap.
- **Inter-requirement contradiction scan (not just intra-requirement)**: REQ-020 (nav:back delegation) vs REQ-022 (Android hw back via same nav:back path) — consistent. REQ-002 (canGoBack→chevron) vs REQ-021 (deeplink first-entry→home fallback) — coherent (canGoBack:false hides chevron AND triggers fallback). REQ-030 (hide web sticky header) vs REQ-001 (render native header) — complementary, reconciled at Goal spec.md:53 (double-header avoidance). REQ-011 "shall not alter session message types" vs Exclusion "bridge v1 session type semantics unchanged" — same statement. No contradictions.
- **Frontmatter field-name check**: `created` vs literal MP-3 `created_at` verified against 4 sibling SPECs — `created` is the dominant project convention; flagging it would be a false positive. Confirmed not a defect.
- No new blocking defects surfaced in the second pass. The three minor observations (O1-O3) stand and are non-blocking.

## Recommendation

**PASS.** Rationale by must-pass criterion, with evidence:

1. **MP-1** — 12 REQs, consistent 3-digit padding, no duplicates, deliberate module-block ranges (spec.md:74 declared scheme); identical REQ set across spec/compact/plan.
2. **MP-2** — All 12 shall-statements match a declared EARS pattern (spec.md:79-108); ACs correctly use Given/When/Then, not mislabeled EARS.
3. **MP-3** — Frontmatter complete with correct types (spec.md:1-11); `created` is the project-standard ISO-date field (verified against siblings).
4. **MP-4** — N/A (single-project SPEC).

Additionally: the deep-research constraint is respected (not violated) — the SPEC's entire design pivots on web-side nav observation precisely because `onShouldStartLoadWithRequest` cannot catch soft-nav; scope aligns with all confirmed decisions (single WebView overlay, no push promotion, OD-1..5 resolved); the UNIFY-001 R-U2 shared-channel cross-reference is verified accurate against the cited line; traceability is complete and bidirectional; and the device-gated vs locally-verifiable AC separation is exemplary (acceptance.md:3-9, :158-165).

The three minor observations (O1-O3) are optional polish for a future revision and do not require a re-audit. No manager-spec revision is mandated for this iteration.
