# SPEC Review Report: SPEC-SAFETY-001
Iteration: 2/3
Verdict: PASS
Overall Score: 0.87

Reasoning context ignored per M1 Context Isolation. (No author reasoning was passed; audit performed solely on `.moai/specs/SPEC-SAFETY-001/` artifacts: spec.md primary; plan.md, acceptance.md, spec-compact.md, interview.md supporting; research.md and `.moai/specs/SPEC-ACCOUNT-001/plan.md` for cross-reference only. Previous report `.moai/reports/plan-audit/SPEC-SAFETY-001-review-1.md` used for regression check.)

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: Module-scoped sequential numbering, zero gaps, zero duplicates, consistent 3-digit zero-padding, verified end-to-end across all three REQ-bearing documents: REQ-RPT-001..005 (spec.md:L59–L72), REQ-BLK-001..005 (L76–L89), REQ-FLT-001..006 (L93–L109), REQ-CPL-001..004 (L113–L123), REQ-STO-001..002 (L127–L131). Identical 22-REQ set in plan.md §2 (L29–L62) and spec-compact.md (L6–L35); no drift in IDs, type tags, or substance.
- [PASS] MP-2 EARS format compliance: All 22 requirements carry an explicit EARS type tag, structurally match the tagged pattern, and every REQ now carries the "(shall)" normative marker (D5 fixed — REQ-RPT-004 spec.md:L69 "…신고를 거부한다(400)(shall)"). Samples: [Event-driven] REQ-RPT-001 "**When** 사용자가 특정 UGC 항목을 사유와 함께 신고하면, 시스템은 … 저장한다(shall)" (L60); [State-driven] REQ-FLT-006 "**While** B가 A에게 차단된 동안(A가 B를 차단), 시스템은 … FCM 푸시 수신 대상에서 A를 제외한다(shall)" (L109); [Unwanted] REQ-RPT-004 (L69); [Ubiquitous] REQ-BLK-004 — retagged from the misused [Optional] to [Ubiquitous] (D6 fixed, L85–L86). Per repo template convention (precedent SPEC-MOIM-002/SAFETY review-1): acceptance.md is the GWT artifact, spec.md §5 is the EARS artifact — GWT ACs are not mislabeled EARS.
- [PASS] MP-3 YAML frontmatter validity: All 8 contracted fields present with correct types (spec.md:L1–L10): `id: SPEC-SAFETY-001` (L2), `version: "0.1.0"` (L3), `status: draft` (L4), `created: 2026-07-02` (L5), `updated: 2026-07-02` (L6), `author: hatae` (L7), `priority: critical` (L8), `issue_number: 0` (L9).
- [N/A] MP-4 Section 22 language neutrality: N/A — single-stack product SPEC (NestJS + Prisma + Supabase + Next.js, spec.md:L48). Not template-bound multi-language tooling content. Auto-pass.

## Category Scores (0.0–1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.80 | 0.75–1.0 — minor ambiguity a reasonable engineer resolves consistently | The four iteration-1 clarity drags are gone: REQ-FLT-006 mechanism is now uniformly `getBlockersOf([senderId])` (plan.md:L50, L121, L135, L139, R-14 L262; spec.md:L32, L109; AC-FLT-6 acceptance.md:L78) with an explicit "이 발신 경로는 getHiddenUserIds…를 사용하지 않는다" sentence (plan.md:L50); report entry-point scope is pinned ("채팅 메시지 말풍선 한정", spec.md:L158, plan.md:L148/L286 — "우선" removed); mask-label semantics under union are documented (spec.md:L100). Residual: service-ownership naming ambiguity (N1) and fallback-mechanism cross-description drift (N2), both resolvable without behavioral risk. |
| Completeness | 0.90 | 0.75–1.0 | All sections present: HISTORY (spec.md:L16–L22), Goal (L24), Context (L28), policy mapping (L37), Assumptions (L46), 22 EARS REQs (L53–L131), Delta Markers (L133–L149), Exclusions with 14 specific falsifiable entries (L151–L166, now including the report-entry-point exclusion L158), Dependencies (L168), Quality Gate (L174). settlement_request display surface now fully specified (REQ-FLT-003 spec.md:L100; AC-FLT-3 acceptance.md:L60–L63; plan.md:L47, L131) — D3 hole closed. interview.md Round 2 (L24–L31) records all 4 plan-gate decisions — D12 provenance gap closed. Residual: plan.md §9 omits one exclusion entry present in spec.md §7 (N3). |
| Testability | 0.85 | 0.75–1.0 | All 17 ACs binary-testable with concrete GWT and assertable outcomes: AC-BLK-1 "P2002 → 200 … 자기 차단은 400" (acceptance.md:L36); AC-FLT-3 "표시 항목 합 == 표시 합계(정합)" (L63); AC-FLT-6 contrast case "report만 있고 … push 유지" (L79–L80); AC-CPL-1 union {B, C} + 차단 해제 후 report 항 불변 (L87). No weasel words in any AC. Residual: the new normative claim that report-only-hidden authors are also masked with the same label (spec.md:L100) has no direct AC scenario — verified only by composition of AC-RPT-2 + AC-CPL-1 + AC-FLT-3 (N4). |
| Traceability | 0.95 | 0.75–1.0 | Bidirectional REQ↔AC mapping complete for all 22 REQs / 17 ACs; every "— AC:" citation (spec.md:L60–L131) resolves to an existing AC; every AC header (acceptance.md:L9, L14, L19, L26, L33, L38, L43, L50, L55, L60, L65, L70, L75, L84, L89, L94, L101) cites only existing REQs. No orphans, no uncovered REQs. Risk-ID integrity restored: R-15 now defined (plan.md:L263) and all three citations resolve (L161, L258, L263); acceptance.md:L116 cites R-10 only (D9 fixed); REQ-CPL-002 now includes push, matching AC-CPL-2 and the quality gate (spec.md:L117, acceptance.md:L92, spec.md:L177 — D8 fixed). Residual: DoD/M2 vs plan §3.2 service-name placement (N1). |

## Checklist Summary

- FC-1..FC-6 (8-field project contract): PASS — see MP-3.
- SC-1 HISTORY: PASS (spec.md:L16–L22). SC-2 WHY: PASS (L24–L44). SC-3 WHAT: PASS (L53–L131). SC-4 REQUIREMENTS: PASS (22 entries). SC-5 ACCEPTANCE CRITERIA: PASS (17 GWT ACs in acceptance.md, linked at spec.md:L14). SC-6 Exclusions: PASS — 14 concrete falsifiable entries (spec.md:L153–L166).
- RQ-1/RQ-2: PASS (MP-1). RQ-3/RQ-4: PASS with same tolerance as iteration 1 — REQ-RPT-005 (TEXT/BigInt, L72) and REQ-CPL-003/004 pin cross-cutting data/authz contracts; endpoint/DB detail correctly relegated to plan.md per spec.md:L55. RQ-5: PASS — "(shall)" on all 22; self-claim softened to "단일 응집 행위 묶음" (spec.md:L55, D7 fixed).
- AC-1..AC-5: PASS (MP-2 + Traceability row).
- LN-1..LN-3: N/A (single-stack product SPEC).
- CN-1 (no contradictions): PASS with two minor residuals (N1, N2) — the iteration-1 blocking contradictions (D1, D2) are gone; no requirement-level contradictions remain.
- CN-2 (exclusions vs REQs): PASS — expense masking exception (spec.md:L155), report entry-point limitation (L158), and fan-out exclusion (L161) all consistent with REQ-FLT-003/REQ-RPT-004/REQ-FLT-006.
- CN-3 (priority/scope): PASS — `priority: critical` matches store-release blocker framing (spec.md:L26).
- Cross-SPEC contract (orchestrator-supplied): RESPECTED — (a) orphan cleanup owned by SPEC-ACCOUNT-001: spec.md:L22/L165, plan.md §3.5 (L159–L169), R-10 (L258); confirmed against ACCOUNT-001 plan on disk (SPEC-ACCOUNT-001/plan.md:L5, R-16 L193, §9 L211, §10-1 L221 — "정리 소유자 = ACCOUNT-001", both plans same direction). (b) Implementation order SAFETY-first: spec.md:L51/L165, plan.md:L165–L167/L169; ACCOUNT-001 plan L5/R-17 L194 agrees. (c) No-op guard: intact and user-approved on the owner side (ACCOUNT-001 plan L5, L27, L65, L84, R-17 L194); SAFETY-side description of the ACCOUNT-first fallback uses "후속 위임 태스크" instead — recorded as N2 (minor, see below), does not breach ownership or order.
- Interview scope alignment: PASS — Round 1 four answers and Round 2 four plan-gate confirmations (interview.md:L10–L22, L24–L31) all traceable into REQs; the expense masking exception to Round-1 "모든 UGC 숨김" is now explicitly recorded as user-approved (interview.md:L28), closing D12.

## Defects Found

N1. plan.md:L201 + acceptance.md:L131 vs plan.md:L120–L121 — Service-ownership naming inconsistency: plan §3.2's API table assigns `getHiddenUserIds`/`getBlockersOf` to `BlockService` (as do spec.md:L30/L32, the MX plan plan.md:L269–L270, and AC-CPL-2), but plan M2 ("`SafetyService` 단위 테스트 선작성(…): `getHiddenUserIds`(…), `getBlockersOf`(…)") and DoD ("`SafetyService`(getHiddenUserIds union / getBlockersOf 역방향 / …)") list both filter methods under `SafetyService`. Both passages then also say "`SafetyModule`이 `BlockService` export", so the two-provider structure is recoverable, but the parentheticals contradict the predominant BlockService placement. No behavioral divergence; provider naming only. — Severity: minor
N2. plan.md:L167, L303, acceptance.md:L139 vs SPEC-ACCOUNT-001/plan.md:L5/L65/L84/R-17(L194) — Fallback-mechanism cross-description drift: for the ACCOUNT-first merge scenario, SAFETY's documents prescribe a "후속 위임 태스크" (deleteMany code added only after SAFETY tables merge), while the cleanup owner's authoritative, user-approved plan (ACCOUNT-001) specifies a "no-op 가드" (guarded code lands immediately, skips while tables absent, activates after SAFETY deploys) — the mechanism named in the orchestrator's cross-SPEC contract. Additionally, plan.md:L168 ("이 변경은 ACCOUNT plan에도 반영 필요 — 오케스트레이터가 별도 태스크로 처리") is stale and contradicts plan.md:L303 ("양쪽 plan이 이미 동일 방향…정합함을 확인 — 별도 문구 재수정 불필요"): ACCOUNT's plan already records ownership=ACCOUNT on disk. Ownership, SAFETY-first order, and the error-avoidance invariant are respected on both sides; only the fallback-mechanism wording and one stale sentence diverge. — Severity: minor
N3. plan.md §9 (L281–L293) vs spec.md:L163 — Document-parity gap: spec.md §7 lists 14 exclusions including "차단 목록 전용 설정 라우트"; plan §9 lists 13 and omits that entry. The constraint is normatively present in plan REQ-BLK-004 (plan.md:L40 "전용 라우트 미신설") and §3.3 (L150), so no contradiction — parity nit only. — Severity: minor
N4. spec.md:L100 vs acceptance.md:L60–L63 — The newly added normative sentence "신고만 하고 차단하지 않은 대상의 행도 동일 라벨로 마스킹된다" (report-only source masking on the expense surface) has no direct AC: AC-FLT-3's Given covers only the block case. The property is verifiable by composition (AC-RPT-2 union membership + AC-CPL-1 union semantics + AC-FLT-3 mask rule), but a one-line report-only Given variant in AC-FLT-3 would make it directly testable. — Severity: minor

No critical or major defects found in iteration 2.

## Chain-of-Verification Pass

Second-look findings: N1 was discovered only on the second pass — the first pass had accepted M2/DoD as summaries without matching each listed method against the §3.2 provider table. N2's stale sentence (plan.md:L168 vs L303) also surfaced on the re-read of §3.5 line-by-line against §10-3 and the ACCOUNT-001 plan. Re-verified on second pass:
- Every REQ entry re-read individually (spec.md:L59–L131): all 22 tagged, all carry "(shall)", direction of A/B block semantics is consistent across REQ-FLT-001..006 and AC-FLT-1..6 (A blocks B; A's views filter B; push suppressed toward A only).
- REQ sequencing re-walked end-to-end across spec.md, plan.md §2, spec-compact.md: 22/22 consistent, no ID/tag/substance drift.
- Traceability re-walked for all 22 REQs and all 17 ACs (not sampled): complete; all risk-ID citations in acceptance.md edge cases (R-1, R-2, R-3, R-4, R-5, R-6, R-7, R-9, R-10, R-13, R-14) resolve to matching rows in plan §7 (R-1..R-15 now fully defined).
- Exclusions re-checked for specificity: 14 concrete entries in spec.md §7, each falsifiable; spec-compact mirrors all 14; plan §9 has 13 (N3).
- Contradiction scan across documents: REQ-FLT-006 mechanism now consistent everywhere (getBlockersOf([senderId]), block-only); getHiddenUserIds/getBlockersOf signatures consistent (plan.md:L120–L121 vs AC usage); expense mask-vs-hide tension resolved by explicit exception documentation (spec.md:L100/L155, interview.md:L28). N1/N2 are the only residual inconsistencies.
- Cross-SPEC contract re-verified against SPEC-ACCOUNT-001/plan.md directly (not via SAFETY's claims): ownership, order, and no-orphan-hole closure (ACCOUNT R-16) all hold.

## Regression Check (Iteration 2+)

Defects from iteration 1 (SPEC-SAFETY-001-review-1.md):
- D1 (major): getHiddenUserIds vs getBlockersOf in plan §2 REQ-FLT-006 — [RESOLVED]: plan.md:L50 now reads "`getBlockersOf([senderId])`가 반환한 blocker 집합에 속한 수신자를 차감한다(§3.2). 이 발신 경로는 `getHiddenUserIds`…를 사용하지 않는다".
- D2 (major): `getBlockersOf(recipientUserIds)` wrong argument — [RESOLVED]: plan.md:L135 now "`getBlockersOf([senderId])`를 1회 조회해 반환된 blocker 집합을 recipient 집합과 대조하고, 그 교집합…을 차감한다"; consistent with L139.
- D3 (major): settlement_request display surface unspecified — [RESOLVED]: REQ-FLT-003 (spec.md:L100) and AC-FLT-3 (acceptance.md:L61–L63) now cover settlement_request rows (retain + requester masking, `requester_id`); plan.md:L47/L131 aligned.
- D4 (major): report entry-point UI scope ambiguous ("우선") — [RESOLVED]: explicit exclusion added (spec.md:L158, plan.md:L286, spec-compact.md:L68); plan.md:L148 and M4 (L213) now say "채팅 메시지 말풍선 한정"; "우선" removed.
- D5 (minor): REQ-RPT-004 missing "(shall)" — [RESOLVED]: spec.md:L69.
- D6 (minor): REQ-BLK-004 [Optional] misuse — [RESOLVED]: retagged [Ubiquitous] (spec.md:L85), rephrased as placement constraint (L86); plan.md:L40 and spec-compact.md:L16 aligned.
- D7 (minor): "단일 행위" self-claim — [RESOLVED]: spec.md:L55 now "단일 응집 행위 묶음…(일부 REQ는 멱등·자기차단·수락/거부 등 분리 불가한 부속 조건을 함께 명세)".
- D8 (minor): push missing from REQ-CPL-002 no-import list — [RESOLVED]: spec.md:L117 "(chat/poll/expense/schedule/notification/push)"; plan.md:L55 and spec-compact.md:L29 aligned.
- D9 (minor): acceptance.md R-11 mis-citation — [RESOLVED]: acceptance.md:L116 now cites R-10 only.
- D10 (minor): undefined R-15 — [RESOLVED]: R-15 row added to risk table (plan.md:L263); all citations (L161, L258) now resolve.
- D11 (minor): "(모듈당 ≤5)" header contradiction — [RESOLVED]: plan.md:L25 now "(모듈 개수 5개 — spec.md §5와 동일 한도)"; spec.md:L55 "모듈 개수 ≤5" — both module-count semantics.
- D12 (minor): decision provenance gap — [RESOLVED]: interview.md Round 2 (L24–L31) records all 4 plan-gate confirmations with date (2026-07-02), including the expense-masking exception to the Round-1 answer marked "사용자 승인".
- D13 (minor): frontmatter dependency claim + guard terminology drift — [RESOLVED as scoped]: plan.md:L169 now correctly states the 8-field frontmatter holds no dependency field and pins order in body text (spec.md §8 + plan.md §3.5); §3.5 (L167) and §10-3 (L303) now use one wording ("후속 위임 태스크") internally. The residual cross-SPEC mechanism drift against ACCOUNT-001's "no-op 가드" is a NEW finding recorded as N2 (out of D13's original scope, which was SAFETY-internal).
- D14 (minor): mask-label semantics under union — [RESOLVED]: spec.md:L100 documents that '차단한 멤버' applies to both union sources including report-only targets (recommendation option "accept and document" taken); spec-compact.md:L22 mirrors it.

Result: 14/14 prior defects resolved. No unresolved carry-overs; no stagnating defects.

## Recommendation

PASS. Rationale per must-pass criterion:
- MP-1: 22-REQ set sequential and identical across spec.md (L59–L131), plan.md §2, spec-compact.md — verified end-to-end, no gaps or duplicates.
- MP-2: All 22 REQs match their tagged EARS pattern with "(shall)" markers (evidence lines above); the two iteration-1 formality deviations (D5, D6) are fixed.
- MP-3: All 8 contracted frontmatter fields present and typed correctly (spec.md:L1–L10).
- MP-4: N/A (single-stack product SPEC).
All four iteration-1 blocking defects (D1–D4) are verifiably fixed with exact-text evidence; the cross-SPEC contract (cleanup ownership = ACCOUNT-001, SAFETY-first order, no-op guard on the owner side) is respected and was re-verified directly against SPEC-ACCOUNT-001's plan.

Non-blocking cleanup for the sync phase (or a quick pre-run edit; none blocks implementation):
1. (N1) plan.md:L201 and acceptance.md:L131 — move `getHiddenUserIds`/`getBlockersOf` out of the `SafetyService` parentheticals (they belong to `BlockService` per plan §3.2/spec.md:L30/L32), e.g., "`SafetyService`(createReport/createBlock/unblock/listBlocks) + `BlockService`(getHiddenUserIds union / getBlockersOf 역방향)".
2. (N2) plan.md:L167/L303 and acceptance.md:L139 — align the ACCOUNT-first fallback wording with ACCOUNT-001's approved mechanism ("no-op 가드 — SAFETY 배포 후 활성화") or state both are acceptable; delete the stale sentence at plan.md:L168 ("이 변경은 ACCOUNT plan에도 반영 필요") since ACCOUNT's plan already records the agreed direction.
3. (N3) plan.md §9 — add the "차단 목록 전용 설정 라우트" exclusion entry for parity with spec.md:L163.
4. (N4) acceptance.md AC-FLT-3 — add a report-only Given variant (A reported but did not block B) asserting the same '차단한 멤버' masking, making spec.md:L100's union-label claim directly testable.
