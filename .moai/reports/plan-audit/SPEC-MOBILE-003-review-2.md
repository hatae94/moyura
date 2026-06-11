# SPEC Review Report: SPEC-MOBILE-003
Iteration: 2/3
Verdict: PASS
Overall Score: 0.90

> Reasoning context ignored per M1 Context Isolation. 감사는 개정된 spec.md(주 입력) + acceptance.md/plan.md(교차 참조)만으로 수행했다. spec-compact.md 는 입력 계약 범위 밖이라 감사 대상에서 제외(비고 참조).

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: grep 전수 재열거 — spec.md 에 R-RT1~RT6, R-AS1~AS5, R-NC1~NC5, R-WB1~WB5, R-PR1~PR5 정확히 26개. 각 prefix 그룹 내 순차, 갭 0, 중복 0, 표기 일관(스킴 선언 spec.md:L79). iteration 1 과 동일 — 개정으로 인한 ID 변동 없음.
- [PASS] MP-2 EARS format compliance: 26개 요구 전부 EARS 문장 템플릿 부합. 개정 확인 — R-RT5(L88) "[U][REMOVE]: After migration, the app **shall not** retain..."(Ubiquitous 부정으로 재태깅), R-AS5(L97)/R-NC3(L103) 동일하게 [U] 재태깅, R-WB4(L112) "**If** the shell marker is not available before content hydration, **then** the web **shall** default to hiding its BottomTabBar (fail-safe)..." — Unwanted If-Then 표준형으로 재서술, R-RT6(L89) "**Where** the SDK 56 typecheck/build is not broken, the app **shall** enable..." — Optional 표준 어순. acceptance.md G/W/T 는 L3 에 명시 라벨링(mislabeled-as-EARS 아님). informal language 0건(weasel grep 0 hit).
- [PASS] MP-3 YAML frontmatter validity: id "SPEC-MOBILE-003"(L2, 패턴 일치, string), version "0.1.0"(L3, string), status "draft"(L4, string), **created_at "2026-06-11"(L7, ISO date — 신규 추가)**, priority "high"(L10, string), **labels [mobile, navigation, expo-router, webview, hybrid](L12, array — 신규 추가)**. 6개 필수 필드 전부 존재, 타입 정상. 비고: `created`/`updated`(L5-6)와 `created_at`/`updated_at`(L7-8) 중복 보유 — D13 참조(minor).
- [N/A] MP-4 Section 22 language neutrality: N/A — 단일 스택(TypeScript: Expo RN + Next.js) 앱 기능 SPEC(L29 모노레포 스코프). 멀티-언어 툴링 아님. Auto-pass.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.80 | 0.75 | 26개 요구 대부분 단일 해석. 잔여 마이너 모호성 2건: R-WB4(L112) fail-safe 조건의 셸 스코핑 누락(D10), R-NC1(L101)↔OD-1(L138) 긴장(D11) — 둘 다 주변 아티팩트(Edge Case L113, AC-5, DoD L129)가 일관 해석 가능. Band 0.75: "Minor ambiguity in one or two requirements that a reasonable engineer would resolve consistently" 정확히 해당 |
| Completeness | 0.95 | 1.0 | HISTORY(L21), Background=WHY(L27), Goal=WHAT(L53), Exclusions 10개 구체 항목(L59-73), EARS Requirements 26건(L77), AC 8건+매트릭스(acceptance.md), HOW(plan.md). **frontmatter 완전(L1-13)** — iteration 1 의 0.50 band 원인 해소. 마이너 감점: 중복 날짜 필드(D13) |
| Testability | 0.90 | 1.0 | AC-1~8 전부 binary + 검증 경로 명시(자동 vitest/static-grep/typecheck vs 디바이스 게이트, acceptance.md L13,20,29,36,43,52,59,70). AC-6 개정으로 When(자극)/Then(단언) 분리 완료(L49-51). AC-8(L61-70)이 "thin wrapper"/deprecated-API 금지를 static-grep 계약으로 조작화. weasel word 0건. 잔여: AC-5(a) 수동 브라우저 확인(L43) — web-no-test-harness 환경 제약 명시로 binary 판정 가능 |
| Traceability | 0.95 | 1.0 | **R→AC 전수 커버리지 달성**: AC 헤더 인용 합집합 = 26/26(grep 검증), 명시적 추적 매트릭스 신설(acceptance.md L74-105). AC→R 역방향: 8개 AC 헤더 인용 ID 전부 spec.md 실존. orphan AC 0, uncovered REQ 0. 마이너 감점: 매트릭스 L87 "R-AS2 | AC-1, AC-2" — AC-2 헤더(L15)는 R-AS2 미인용(본문 내용은 실질 커버, D12) |

## Defects Found

D10. spec.md:L112 — R-WB4 의 If 조건("the shell marker is not available before content hydration")에 셸 모드/셸 의심 스코핑이 없음. 문자 그대로 읽으면 데스크톱 브라우저(마커가 원래 없음)에서도 조건이 참이 되어 웹 탭바 기본 숨김으로 해석될 여지 — AC-5(a)(L42 데스크톱은 탭바 표시)와 표면 충돌. "default"(초기 상태) + Edge Case L113("셸 의심 시 숨김") + AC-5(a) 단언이 fail-safe 초기상태 해석으로 일관 해소하므로 모순 아닌 모호성으로 판정. 권고: "If shell-mode determination is unresolved before content hydration..." 로 조건 스코핑 — Severity: minor
D11. spec.md:L101 vs L138 — R-NC1 은 `route-map-core.ts` 모듈이 매핑을 정의할 것을 "shall" 로 확정했으나, OD-1 은 매핑을 `decideWebViewLoad` 내장으로 두는 대안을 열어둠. 비권장안 채택 시 R-NC1 개정 필요 — DoD(acceptance.md:L129)의 OD 확정 체크박스가 AC 동기화는 다루지만 요구 개정 필요성은 명시하지 않음 — Severity: minor
D12. acceptance.md:L87 — 추적 매트릭스가 R-AS2 의 인용 AC 로 "AC-1, AC-2" 를 기재했으나 AC-2 헤더(L15)는 R-AS2 를 인용하지 않음(AC-2 본문 L19 의 session 신호→isSignedIn 전이 단언이 실질 커버). 매트릭스 정밀도 결함 — AC-2 헤더에 R-AS2 추가 또는 매트릭스를 "AC-1" 로 정정 — Severity: minor
D13. spec.md:L5-8 — `created`/`created_at`, `updated`/`updated_at` 중복 보유(동일 값). 향후 한쪽만 갱신되는 드리프트 위험. 템플릿 호환 목적으로 추정되나 single source of truth 원칙상 정리 권고 — Severity: minor

## Chain-of-Verification Pass

Second-look findings: 신규 결함 D10/D11 은 2차 자기비판 패스에서 발견(1차 패스는 D4 해소 형식만 확인했으나, 재독에서 R-WB4 의 If 조건이 데스크톱 환경에 literal 하게 적용될 수 있음을 식별 — 두 해석을 모두 검토한 결과 fail-safe 초기상태 해석이 표준적이고 AC-5 가 결과를 구속하므로 minor 판정). 재검 수행 항목: (1) 26개 R-ID 전수 grep 재열거 — 개정 전후 동일. (2) 추적 매트릭스 26행 vs AC 헤더 인용 — 행 단위 대조(D12 발견). (3) Exclusions(L59-73) — 개정 없음, 10개 구체 항목 유지. (4) 요구 간 모순 재스캔 — R-WB4↔R-WB3/AC-5 표면 긴장은 D10 으로 분류(해석 일관 가능), R-NC1↔OD-1 은 D11. 그 외 CN-1/CN-2 모순 0건. (5) weasel word grep 0건 재확인. (6) AC-3/AC-6 의 "계약 기준 AC" 주석(L24, L47)이 OD-1/OD-2 비권장안에서도 단언 유효함을 확인 — D9 해소 타당.

## Regression Check (Iteration 2+ only)

이전 iteration(review-1) 결함 9건 전수 재검증:

- D1 (labels 부재, critical): **RESOLVED** — spec.md:L12 `labels: [mobile, navigation, expo-router, webview, hybrid]` (array 타입).
- D2 (created_at 부재, major): **RESOLVED** — spec.md:L7 `created_at: 2026-06-11` (ISO date). 부수 효과로 중복 필드 발생(신규 D13, minor).
- D3 (R→AC 추적 7건 누락, major): **RESOLVED** — AC-8 신설(L61-70: R-RT1/R-RT5/R-RT6/R-WB5), AC-4 헤더 확장(L31: +R-RT2/R-RT3/R-RT4), AC-2 헤더 확장(L15: +R-AS3, 본문 L19 가드 결정 단언 추가), AC-5 헤더 확장(L38: +R-WB2). grep 검증: AC 헤더 인용 합집합 = 26/26. 추적 매트릭스 신설(L74-105). 잔여 정밀도 결함은 D12(minor).
- D4 ([Un] 태그 오분류 4건, minor): **RESOLVED** — R-RT5(L88)/R-AS5(L97)/R-NC3(L103) → [U] 재태깅 + "(Ubiquitous 부정 불변)" 주석, R-WB4(L112) → If-Then Unwanted 표준형 재서술. 단 재서술이 신규 D10(조건 스코핑) 유발.
- D5 (R-RT6 Where 어순, minor): **RESOLVED** — L89 "**Where** the SDK 56 typecheck/build is not broken, the app **shall** enable...".
- D6 (요구문 내 구현 상세, minor): **RESOLVED** (iteration-1 권고 범위 기준) — R-RT2(L85) 설치 메커니즘을 plan.md 단계 E 참조로 이동, 의존성 목록은 WHAT 으로 유지. 파일명 앵커(R-AS4/R-NC1)·`Stack.Protected` API 지정(R-AS3)은 테스트 가능성 seam / deprecated-API 회피 제약으로 의도적 유지 — 권고 #6 에서 허용한 사항.
- D7 ([REPLACED] 댕글링 마커, minor): **RESOLVED** — AC-3 헤더(L22)에서 마커 제거.
- D8 (AC-6 When/Then 혼동, minor): **RESOLVED** — L49-51 Given(컨텍스트)/When(평가 자극)/Then(기대 결정) 분리.
- D9 (AC 의 OD 의존, minor): **RESOLVED** — AC-3(L24)/AC-6(L47)에 "계약 기준 AC" 주석(구현 위치 무관 단언), DoD(L129)에 런 진입 전 OD-1~4 확정 + AC 동기화 체크박스 추가.

해소율: 9/9. 정체(stagnation) 결함 없음.

## Recommendation

**PASS 근거** (must-pass 별 증거):
- MP-1: grep 전수 열거로 26개 ID 갭/중복 0 확인 (spec.md L84-121).
- MP-2: 개정 4건(R-RT5/R-AS5/R-NC3 재태깅, R-WB4 If-Then 재서술, R-RT6 어순) 포함 전 요구가 EARS 템플릿 부합, informal language 0건.
- MP-3: 필수 6필드 전부 존재·타입 정상 (spec.md L2,L3,L4,L7,L10,L12).
- MP-4: 단일 스택 SPEC — N/A auto-pass.
- 이전 결함 9/9 해소, 신규 결함은 minor 4건(D10~D13)으로 must-pass·구현 가능성에 영향 없음(AC 가 관찰 가능 결과를 구속).

**비차단 권고** (런 단계 진입 전 또는 sync 단계 정리 — verdict 에 영향 없음):
1. D10: R-WB4 의 If 조건을 "If shell-mode determination is unresolved before content hydration" 등으로 셸 스코핑 명시 (spec.md:L112 한 줄 수정).
2. D11: OD-1 확정 시 비권장안 채택이면 R-NC1 동반 개정 필요함을 DoD L129 체크박스에 한 구절 추가.
3. D12: AC-2 헤더에 R-AS2 추가(본문이 이미 실질 검증) 또는 매트릭스 L87 을 "AC-1" 로 정정.
4. D13: `created`/`updated` 또는 `created_at`/`updated_at` 중 한 쌍으로 통일(템플릿 스키마 확인 후).

비고: spec-compact.md(15:52 개정)는 plan-auditor 입력 계약(spec.md 주 입력 + acceptance.md/plan.md 교차 참조) 범위 밖이라 미감사 — spec.md 와의 정합성은 sync 단계 manager-docs 책임.
