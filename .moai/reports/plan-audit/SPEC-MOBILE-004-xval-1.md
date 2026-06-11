# Cross-Validation Report: SPEC-MOBILE-004
Iteration: xval-1 (post-auditor-recommendations)
Cross-validation: AGREE (PASS)

Evaluator: evaluator-active (skeptical, independent; did not defer to plan-auditor verdict)
Documents validated: spec.md, plan.md, acceptance.md, spec-compact.md (+ research.md for context)
Harness: thorough

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 86/100 | PASS | All 5 REQs have EARS-compliant shall-statements with binary-testable ACs; brownfield delta markers provide specific file:line references; onboarding state-machine semantics fully specified. Minor residual: D5 (HOW-in-WHAT) for L48/L42-43 remains but is justified brownfield contract language. |
| Security (25%) | 80/100 | PASS | Token non-logging (REQ-MOB4-002), origin allowlist + per-session nonce (REQ-MOB4-002), @MX:ANCHOR boundary preservation, credential non-exposure in error state (REQ-MOB4-005 observable condition 4), SecureStore for token storage all specified. nonce local-skip/prod risk documented in §5. No OWASP Critical gap. |
| Craft (20%) | 82/100 | PASS | All required sections present (HISTORY, Overview, Requirements, Delta Markers, Exclusions, Risks, Quality Gate). Labels corrected post-D2. Clarifying clause added at L24 (D4 resolved). "복구 가능한 오류 상태" defined observably at L63–65 (D8 resolved). Non-normative note at REQ-MOB4-003 is cleanly labeled. Minor residual: deferred design decisions at plan.md §3.1 remain open (intentional pre-run gates, not a defect). |
| Consistency (15%) | 90/100 | PASS | spec-compact.md REQ/AC/exclusion summaries match spec.md without semantic drift. AC-6 split to AC-6a/AC-6b in both acceptance.md and compact. AC-7 and AC-8 promoted from edge cases (D3 resolved). DoD at acceptance.md:L100 explicitly cites AC-1~AC-8, AC-6a/AC-6b. plan.md phases A–F cover all [MODIFY]/[NEW] delta markers. Quality gates consistent across spec.md §6 / acceptance.md §3 / plan.md §6. |

---

## Must-Pass Criterion Verification

### MP-1: REQ numbering consistency and EARS pattern compliance

PASS.

REQ sequence: spec.md L34/L40/L45/L54/L62 — 001 through 005, sequential, zero-padded, no gaps, no duplicates. spec-compact.md L7–11 mirrors the same five without drift.

EARS compliance (verified per-bullet, not sampled):
- REQ-MOB4-001: "WHEN ... the mobile app shall" (Event-driven) L36, L37; "The mobile app shall" (Ubiquitous) L38 — all correct.
- REQ-MOB4-002: "WHEN ... the mobile app shall" L42; "The mobile app shall" L43 — correct.
- REQ-MOB4-003: "The system shall" x3 (L47, L48, L49) — Ubiquitous; non-normative NOTE at L51–52 explicitly labeled "(비규범 보충 노트, 요구사항 아님)" — not a shall-statement, no compliance issue.
- REQ-MOB4-004: "(Event-driven) WHEN" L54, L56; "(State-driven) WHILE" L55; "(Ubiquitous) The system shall" L57, L58 — all labels match syntax. D2 (label mismatch) confirmed RESOLVED; the previously mismatched WHERE/IF/then patterns no longer appear.
- REQ-MOB4-005: "IF ... then the mobile app shall" L64 (Unwanted); "IF ... then the mobile app shall" L65 (Unwanted); "IF ... then the system shall" L66 (Unwanted) — correct pattern for all three.

All shall-statements are testable (each maps to at least one AC).

### MP-2: Frontmatter schema — 8 required fields

PASS.

spec.md L1–10:
- id: SPEC-MOBILE-004 (string, pattern SPEC-{DOMAIN}-{NUM}) ✓
- version: 0.1.0 (semver string) ✓
- status: draft (valid enum) ✓
- created: 2026-06-11 (ISO-8601 date) ✓
- updated: 2026-06-11 (ISO-8601 date) ✓
- author: hatae ✓
- priority: high (lowercase, consistent with sibling SPECs) ✓
- issue_number: 0 (integer, consistent with other draft SPECs) ✓

8/8 fields present and valid.

### MP-3: REQ ↔ acceptance criteria traceability

PASS.

Full forward-trace (REQ → ACs):
- REQ-MOB4-001 → AC-1 (L11), AC-2 (L18), AC-7 (L60) — 3 ACs ✓
- REQ-MOB4-002 → AC-5 (L39) + AC-1/AC-2 And-clauses ✓
- REQ-MOB4-003 → AC-4 (L33) + AC-1 And-clause ✓
- REQ-MOB4-004 → AC-1 (L11), AC-2 (L18), AC-3 (L25) ✓
- REQ-MOB4-005 → AC-6a (L46), AC-6b (L53), AC-8 (L67) ✓

Full reverse-trace (AC → REQs, orphan check):
- AC-1: REQ-MOB4-001/002/004 ✓
- AC-2: REQ-MOB4-001/002/004 ✓
- AC-3: REQ-MOB4-004 ✓
- AC-4: REQ-MOB4-003 ✓
- AC-5: REQ-MOB4-002 ✓
- AC-6a: REQ-MOB4-005 ✓
- AC-6b: REQ-MOB4-005 ✓
- AC-7: REQ-MOB4-001 ✓
- AC-8: REQ-MOB4-005 ✓

Zero orphan ACs. D3 (previously unnumbered edge cases) confirmed RESOLVED: AC-7 covers REQ-MOB4-001 bullet 3 (desktop web unchanged); AC-8 covers REQ-MOB4-005 bullet 3 (onboarding submit failure). DoD line at acceptance.md:L100 explicitly enumerates AC-1~AC-8, AC-6a/AC-6b.

### MP-4: spec-compact.md sync with spec.md

PASS.

REQ phrasing: compact REQ-MOB4-001 through 005 match spec.md normative content without semantic drift. All key constraints preserved (v1 무변경, @MX:ANCHOR L103–109 reference, observable error-state conditions, timestamp 비의존, provider 비종속).

AC list: compact L15–23 lists AC-1, AC-2, AC-3, AC-4, AC-5, AC-6a, AC-6b, AC-7, AC-8 — matches post-fix acceptance.md, including AC-6 split and AC-7/AC-8 additions.

Exclusions: 7 compact bullets vs 8 spec.md entries — "prod OAuth 배선 (OD-4)" and "prod nonce 강제 분리 (OD-5)" are merged into one compact bullet. Semantically equivalent; no omitted exclusion. Acceptable compression for a compact document.

Files-to-modify list: compact's [MODIFY]/[NEW]/[EXISTING] entries match spec.md §3 Delta Markers. Minor omission: compact does not list `signInWithOAuthAction` (spec.md §3 EXISTING) explicitly, but this is an EXISTING/preserved item, not an implementation target. Not a defect.

### MP-5: Exclusions section non-empty and consistent with scope

PASS.

spec.md §4 has 8 concrete exclusions, each with cross-references:
1. Apple Sign-In (Apple Developer Program 미가입, SPEC-AUTH-002) — consistent with Google-only scope ✓
2. prod OAuth 배선 (OD-4) — consistent with local/dev-only validation target ✓
3. prod nonce 강제 분리 (OD-5) — consistent with local skip_nonce_check=true policy ✓
4. expo-router + 네이티브 라우트 (SPEC-MOBILE-003 범위) — scope boundary explicit ✓
5. RBAC / 권한 모델 — consistent with identification-only Profile scope ✓
6. iOS App Store 제출 (App Store 4.8 리스크) — consistent with Android-first decision ✓
7. 이메일 확인 / 비밀번호 재설정 (R-G6) — consistent with existing actions.ts constraint ✓
8. 네이티브 RN 로그인 화면 (WebView UI 유지) — consistent with WebView-shell architecture ✓

### MP-6: REQ-MOB4-003 name-collection verification checkpoint

PASS.

Present: spec.md L45 header includes "구현 단계 필수 확인 체크포인트"; L47–49 carries 3 normative "The system shall" statements covering name collection, Profile.name nullable field, and provider-agnostic path.

Normative phrasing: The shall-statements (L47–49) ARE normative. The checkpoint NOTE at L51–52 is explicitly labeled "(비규범 보충 노트, 요구사항 아님)" — it is an implementation-phase meta-instruction appended to the normative content, clearly distinguished from the requirements. The requirement itself is normatively phrased. Testable via AC-4 (email path) and AC-1 And-clause (Google path).

Traceable to plan.md §3: spec.md L52 explicitly cites "운영화된 체크리스트는 plan.md §3을 따른다." plan.md §3 (L74–82) contains 5 checklist items covering: onboarding name entry gate, email signup name persistence, existing nameless user redirect, provider-agnostic name collection, and free Original API usage. The linkage is bidirectional and explicit.

### MP-7: Brownfield delta markers present and consistent

PASS.

All 4 delta categories present in spec.md §3:
- [EXISTING]: 6 items with file paths and line references ✓
- [MODIFY]: 5 items matching plan.md phases A/B/E ✓
- [NEW]: 5 items matching plan.md phases C/D/E ✓
- [REMOVE]: none (explicitly stated as "없음") ✓

Cross-check with plan.md phases:
- Phase A → schema.prisma [MODIFY], me.controller.ts/profile.service.ts [MODIFY] ✓
- Phase B → actions.ts signUpAction [MODIFY], login-form.tsx [MODIFY] ✓
- Phase C → onboarding page [NEW], onboarding guard [NEW] ✓
- Phase D → @supabase/supabase-js + @react-native-google-signin [NEW], app.json config plugin [NEW] ✓
- Phase E → useAuthBridge.ts [MODIFY], native SDK module [NEW] ✓
- [EXISTING] items all referenced in Phase E implementation steps ✓

No delta marker is referenced in plan phases without a corresponding spec.md §3 entry.

---

## Findings

- [INFO] spec.md:L48,L42-43 — Residual D5: Requirements embed implementation specifics (saveTokens/SecureStore, Prisma nullable field, signUpAction wiring). Justified as brownfield contract constraints ("v1 무변경" is the requirement, not the mechanism). Does not block implementation.
- [INFO] plan.md:L88-89 — Deferred design decisions (name-update endpoint shape; signUp options.data vs explicit Profile update) remain open at §3.1. Intentional pre-run gates, not a defect; blocking these before Phase A/B is the correct pattern.
- [INFO] spec-compact.md — "prod OAuth 배선 (OD-4)" and "prod nonce 강제 분리 (OD-5)" merged into one compact bullet (vs two entries in spec.md §4). Semantically equivalent compression; no information loss.
- [INFO] spec-compact.md — `signInWithOAuthAction (L79–99)` from spec.md §3 [EXISTING] is omitted from compact's [EXISTING] list. EXISTING items are preservation context markers, not implementation targets; omission is acceptable.

No critical, major, or minor blocking defects found. All plan-auditor D1–D8 defects verified:
- D2 (EARS label mismatch on REQ-MOB4-004): RESOLVED — correct Event-driven/State-driven/Ubiquitous labels now present
- D3 (unnumbered edge cases): RESOLVED — AC-7 and AC-8 promoted to numbered scenarios
- D4 (desktop scoping ambiguity): RESOLVED — clarifying clause added at spec.md:L24
- D6 (AC-6 bundled): RESOLVED — split into AC-6a and AC-6b
- D8 ("복구 가능한 오류 상태" unobservable): RESOLVED — 4 observable conditions enumerated at spec.md:L63-65
- D1, D5, D7: Acknowledged, non-blocking, correctly handled

---

## Recommendations

No blocking recommendations. The document set is ready for run-phase execution subject to the two pre-run design decisions at plan.md §3.1.

Non-blocking:
1. plan.md §3.1 design decisions must be resolved before Phase A/B execution (already mandated in plan.md itself).
2. When the `PATCH /me` endpoint is confirmed, spec-compact.md Files-to-modify list would benefit from the confirmed API form annotation (currently "예: PATCH /me").

---

🗿 MoAI <email@mo.ai.kr>
