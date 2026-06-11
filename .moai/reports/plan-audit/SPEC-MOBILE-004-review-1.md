# SPEC Review Report: SPEC-MOBILE-004
Iteration: 1/3
Verdict: PASS
Overall Score: 0.83

Auditor: plan-auditor (adversarial mode, M1–M6 active)
Audited documents: spec.md, plan.md, acceptance.md, spec-compact.md (+ research.md for cross-reference)
Note: No author reasoning context was passed in the invocation; audit performed on documents only per M1 Context Isolation.

## Must-Pass Results

- [PASS] **MP-1 REQ number consistency**: REQ-MOB4-001 (spec.md:L34), REQ-MOB4-002 (L40), REQ-MOB4-003 (L45), REQ-MOB4-004 (L51), REQ-MOB4-005 (L58). Sequential 001–005, no gaps, no duplicates, consistent zero-padding. spec-compact.md:L7-11 mirrors the same five without drift.
- [PASS] **MP-2 EARS format compliance**: Project convention verified against approved sibling SPECs (SPEC-MOBILE-001/acceptance.md:L3, SPEC-AUTH-002/acceptance.md:L3): EARS lives in spec.md requirements; acceptance.md holds honestly-labeled Given/When/Then scenarios (not "GWT mislabeled as EARS"). All normative statements in spec.md Section 2 match EARS patterns: Event-driven "WHEN ... the mobile app shall" (L36, L37, L42), Ubiquitous "The system shall" (L38, L47, L48, L55), Unwanted "IF ... then the ... shall" (L53, L60, L61, L62), Optional "WHERE ... the system shall" (L54). Exceptions are non-normative annotations, not shall-statements — recorded as defects D1/D2 (minor), insufficient to fail the firewall.
- [PASS] **MP-3 YAML frontmatter validity**: 8/8 fields per project schema (verified identical across all 13 SPECs in .moai/specs/): id "SPEC-MOBILE-004" (L2, matches SPEC-{DOMAIN}-{NUM}), version "0.1.0" (L3, string), status "draft" (L4), created/updated "2026-06-11" (L5-6, ISO dates), author "hatae" (L7), priority "high" (L8, lowercase consistent with majority convention), issue_number 0 (L9, matches sibling drafts SPEC-MOBILE-003/SPEC-CHAT-001). No `labels` field exists in this project's schema — not a defect (no sibling SPEC has one).
- [N/A] **MP-4 Section 22 language neutrality**: N/A — single-project product SPEC (TypeScript monorepo: Expo mobile / Next.js web / NestJS backend). Google SDK / Supabase / Prisma names are the subject matter, not template-bound multi-language tooling content. Auto-pass.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 — minor ambiguity a reasonable engineer resolves consistently | D1 (spec.md:L49 process note), D2 (L51/L54 pattern-label mismatch), D4 (L24 desktop scoping vs L56) — all resolvable from explicit REQ text |
| Completeness | 0.90 | 0.75–1.0 — all sections present, frontmatter complete | HISTORY L14, Overview L20, Requirements L30, Delta Markers L66, Exclusions L101 (8 concrete entries with cross-refs OD-4/OD-5/R-G6), Risks L116, Quality Gate L130; acceptance.md has AC+edge+gates+DoD; deduction: no explicit AC↔REQ mapping table (SPEC-AUTH-002 precedent has one) |
| Testability | 0.75 | 0.75 — one or two ACs need minor interpretation | AC-1..AC-6 binary-testable in core; "복구 가능한 오류 상태" (spec.md:L61, acceptance.md:L51) and "provider 비종속 설계" (L56) need observable definitions; D1 checkpoint untestable as a requirement (operationalized in plan.md §3 instead) |
| Traceability | 0.90 | 0.75–1.0 — all REQs covered, all ACs trace to valid REQs | REQ-001→AC-1/2, REQ-002→AC-1/2/5, REQ-003→AC-4 (+AC-1 And-clause), REQ-004→AC-1/2/3, REQ-005→AC-6. Zero orphan ACs. Deduction: two REQ sub-bullets covered only by unnumbered edge cases (D3) |

## Code Citation Verification (adversarial spot-check)

All load-bearing code citations in the SPEC were verified against the actual codebase:

- `useAuthBridge.ts` @MX:ANCHOR — confirmed at L103 (anchor block L103–110; SPEC cites L103–109, within tolerance)
- `actions.ts` `signUpAction` L30–47 — confirmed; reads only email/password (readCredentials L20–24), name un-wired as SPEC claims
- `actions.ts` `signInWithOAuthAction` L79–99 — confirmed exactly
- `login-form.tsx` name field L181–194 — confirmed; decorative (no action wiring) as SPEC claims
- `schema.prisma` Profile — confirmed: only id/createdAt, no `name` field (migration claim valid)
- `me.controller.ts` GET /me at L26, `upsertBySub` at L35 — confirmed
- mobile `package.json` — `@supabase/supabase-js` and `@react-native-google-signin/google-signin` NOT present, confirming [NEW] claims (spec.md:L89)
- `bridge-protocol.ts` — exactly 5 message types (RESTORE/SYNCED/NONE/CLEARED/REVALIDATE) as SPEC claims (spec.md:L73)

No fabricated or stale citations found.

## Defects Found

D1. spec.md:L49 — REQ-MOB4-003 third bullet is a bracketed implementation-phase checkpoint ("구현 단계에서 반드시 확인"), not an EARS shall-statement; it defers name-collection mechanism/field/UPSERT-path/provider-agnosticism decisions to implementation. Untestable as a requirement. Mitigation present: normative content carried by L47-48 shall-statements; checkpoint operationalized as plan.md:L76-82 checklist and traces to explicit user instruction (HISTORY L16). — Severity: minor

D2. spec.md:L51, L53, L54 — REQ-MOB4-004 header labeled "(State-driven)" but bullet 1 (L53) uses IF/then (Unwanted/conditional) syntax, not WHILE; bullet 2 (L54) uses WHERE (Optional pattern, reserved for feature presence) for a runtime data condition (user_metadata name presence) where IF/WHEN is the correct EARS pattern. Statements remain unambiguous; labels are wrong. — Severity: minor

D3. spec.md:L38 → acceptance.md:L57; spec.md:L62 → acceptance.md:L59 — Two REQ sub-bullets have no numbered AC: REQ-MOB4-001 bullet 3 (desktop web OAuth unchanged) and REQ-MOB4-005 bullet 3 (onboarding submit failure) are covered only by unnumbered Edge Cases entries, which are excluded from the DoD line "위 인수 시나리오 통과" (acceptance.md:L79). — Severity: minor

D4. spec.md:L24 vs L56 — Overview states desktop web is kept "변경 없이" (scoped to `signInWithOAuthAction`), while REQ-MOB4-004 (L56) requires the onboarding guard to operate on desktop web too — i.e., post-login desktop behavior DOES change for name-less users. The REQ text is explicit so implementation divergence is unlikely, but the Overview framing invites a "desktop untouched" misreading. — Severity: minor

D5. spec.md:L42-43, L48 — Requirements embed implementation specifics (saveTokens/SecureStore/token-store.ts; "Prisma `Profile` 모델에 nullable `name` 필드 추가"; signUpAction wiring). For the bridge-reuse constraints (L42-43) this is justified brownfield contract language ("v1 무변경" IS the requirement); L48 is HOW-in-WHAT — the requirement is "persist user name", the nullable column is design. — Severity: minor

D6. acceptance.md:L51 — AC-6 bundles a second When/Then pair ("And **When** `signInWithIdToken`이 실패...") inside one scenario, merging two distinct test cases (user cancel vs token-exchange failure) into one PASS/FAIL unit. Should be split (AC-6a/AC-6b) for binary granularity. — Severity: minor

D7. spec.md:L85; plan.md:L33, L38 — Deferred design decisions ("정확한 API 형태는 설계 결정" for the name-update endpoint; "Supabase signUp options.data 또는 가입 직후 Profile 반영 — 설계 결정"). Acceptable at plan stage; must be resolved before run-phase task execution to avoid mid-implementation churn. — Severity: minor

D8. spec.md:L61; acceptance.md:L51 — "복구 가능한 오류 상태로 처리" lacks an observable definition (what does the user see; what retry affordance exists). A tester cannot determine PASS/FAIL on "recoverable" without interpretation. — Severity: minor

No critical or major defects found.

## Chain-of-Verification Pass

Second-look findings: one additional defect found on re-read (D8, "복구 가능한 오류" weasel-adjacent phrasing) and one candidate defect REJECTED with evidence:

- Re-read every REQ bullet (15 normative/annotation statements across 5 modules) — confirmed no skim-miss.
- Re-checked REQ sequencing end-to-end (001→005) — no gaps/dups.
- Re-verified traceability for every REQ individually (not sampled) — module-level coverage 5/5; sub-bullet gaps already captured as D3.
- Re-checked Exclusions for specificity — 8 entries, each with concrete cross-references (Apple/SPEC-AUTH-002, OD-4, OD-5, SPEC-MOBILE-003, RBAC, App Store 4.8, R-G6, WebView UI 유지). Not vague. PASS.
- Re-checked cross-requirement contradictions: REQ-MOB4-003 "이메일과 동일하게" (mechanism differs: signup-form field vs post-login onboarding) — NOT a contradiction; "동일하게" governs the collection rule, not the mechanism, and AC-4 (acceptance.md:L37) explicitly reconciles the two paths. Empty-name email signup self-heals via the REQ-004 guard. No silent conflict.
- Cross-document drift check: spec-compact.md REQ/AC/exclusion summaries match spec.md/acceptance.md without semantic drift; plan.md phases A–F cover all [MODIFY]/[NEW] delta markers; quality gates consistent across spec.md §6 / acceptance.md §3 / plan.md §6 (including the device-verification completion gate from project memory rules).
- issue_number: 0 and lowercase priority initially suspected as defects — rejected after schema comparison across all 13 sibling SPECs (drafts use 0; lowercase is the dominant form).

## Regression Check (Iteration 2+ only)

N/A — iteration 1.

## Recommendation

**PASS.** All four must-pass criteria hold with cited evidence:
- MP-1: REQ-MOB4-001..005 sequential and unique (spec.md L34/L40/L45/L51/L58).
- MP-2: spec.md requirements conform to EARS; acceptance.md GWT format matches the approved project template (SPEC-MOBILE-001, SPEC-AUTH-002 precedents).
- MP-3: frontmatter 8/8 fields, types correct, schema-consistent with all sibling SPECs (spec.md L1-10).
- MP-4: N/A (product-scoped SPEC).

All 8 defects are minor; none blocks implementation. Recommended (non-blocking) improvements for manager-spec before or during run phase:

1. Split AC-6 into AC-6a (user cancel) and AC-6b (signInWithIdToken failure) — acceptance.md:L46-51 (D6).
2. Promote the two edge-case bullets (acceptance.md:L57, L59) to numbered ACs so DoD line 79 covers REQ-MOB4-001 bullet 3 and REQ-MOB4-005 bullet 3 (D3).
3. Fix EARS labels: REQ-MOB4-004 → split label per bullet (Unwanted for L53, Event-driven IF/WHEN instead of WHERE for L54) (D2).
4. Define "복구 가능한 오류 상태" observably (e.g., "error message shown on login page, Google button re-enabled, no token in SecureStore") — spec.md:L61 (D8).
5. Resolve the two deferred design decisions (name-update endpoint shape; signUp options.data vs post-signup persistence) at the start of run phase before Phase A/B task execution (D7).
6. Add one clarifying clause to Overview L24: desktop OAuth flow unchanged, but the post-login name-onboarding guard intentionally applies to desktop web as well (D4).

🗿 MoAI <email@mo.ai.kr>
