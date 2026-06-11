# SPEC Review Report: SPEC-MOBILE-003
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.69

> Reasoning context ignored per M1 Context Isolation. 감사는 `.moai/specs/SPEC-MOBILE-003/` 의 spec.md(주 입력) + acceptance.md/plan.md(교차 참조)만으로 수행했다.

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: 요구 ID 체계는 spec.md:L76 에 선언된 prefix 스킴(R-RT/R-AS/R-NC/R-WB/R-PR). grep 전수 열거 결과 R-RT1~RT6(L81-86), R-AS1~AS5(L90-94), R-NC1~NC5(L98-102), R-WB1~WB5(L106-110), R-PR1~PR5(L114-118) — 각 그룹 내 순차, 갭 0, 중복 0, 패딩 표기 일관(무패딩 통일). 비고: `REQ-NNN` 형식이 아닌 선언된 프로젝트 관례 스킴이며 문서 내 일관 사용.
- [PASS] MP-2 EARS format compliance: spec.md:L74 "## EARS Requirements" 의 26개 요구 전부가 EARS 문장 템플릿에 부합하고 패턴 태그([U]/[E]/[S]/[Un]/[O], L77 범례)를 명시. 예: R-RT3(L83) "**When** the app cold-starts, the root `app/_layout.tsx` **shall** perform..."(Event-driven), R-WB3(L108) "**While** the web page runs inside the native WebView (shell mode), the web **shall** hide..."(State-driven). acceptance.md 의 AC-1~7 은 Given/When/Then 이지만 L3 에 "Given/When/Then 인수 시나리오" 로 명시 라벨링되어 있어 "G/W/T mislabeled as EARS" 실패 조건에 해당하지 않음(EARS 본문은 spec.md 요구 섹션에 존재). 단, 마이너 결함 D4/D5 참조([Un] 태그 오분류 4건, R-RT6 Where 절 어순).
- [FAIL] MP-3 YAML frontmatter validity: spec.md:L1-10 frontmatter 에 (1) `labels` 필드 완전 부재, (2) `created_at` 부재 — L5-6 에 `created: 2026-06-11` / `updated: 2026-06-11` 로 필드명 불일치. 필수 스키마(id, version, status, created_at, priority, labels) 대비 2개 필드 누락. "Any missing required field = FAIL." 비고: 형제 SPEC(SPEC-MOBILE-002, SPEC-WEBVIEW-SHELL-001)도 동일 스키마(`created`/`updated`, labels 없음)를 사용 — 본 SPEC 단독 실수가 아닌 템플릿 차원 관례이나, must-pass 기준상 판정은 FAIL 유지. 충족 필드: id "SPEC-MOBILE-003"(L2, SPEC-{DOMAIN}-{NUM} 패턴 일치), version "0.1.0"(L3), status "draft"(L4), priority "high"(L8) — 타입 정상.
- [N/A] MP-4 Section 22 language neutrality: N/A — 단일 스택(TypeScript: Expo RN + Next.js) 앱 기능 SPEC. 멀티-언어 툴링/템플릿 바운드 콘텐츠가 아님(spec.md:L26 모노레포 스코프 명시). Auto-pass.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.85 | 0.75 | 26개 요구 전부 단일 해석 가능, file:line 앵커 풍부(L29-44 live source 목록). 마이너: R-WB5(L110) "thin WebView wrapper" 의 'thin' 임계 미정의(DoD L145 static-grep 이 부분 보완), R-WB2(L107) "Figma HomeTab" 외부 참조(단 구성요소를 인라인 열거하여 완화) |
| Completeness | 0.55 | 0.50 | 섹션 자체는 충실: HISTORY(L18), Background=WHY(L24), Goal=WHAT(L50), Exclusions 10개 구체 항목(L56-70), EARS Requirements(L74), AC 7건(acceptance.md), HOW(plan.md). 그러나 rubric 0.50 band 조건 "frontmatter missing one or two fields" 정확히 해당 — labels + created_at 2개 누락(L1-10) |
| Testability | 0.85 | 0.75 | weasel word grep 결과 0건(appropriate/adequate/reasonable/proper/should 부재). AC 마다 자동(vitest/static-grep/build) vs 디바이스 게이트 검증 경로 명시(acceptance.md L13,20,27,34,41,48,55). 마이너: AC-5(a) "수동 브라우저 확인"(L41, web-no-test-harness 제약 명시로 수용 가능), AC-6 의 When 절에 기대 반환값 혼입(D8) |
| Traceability | 0.50 | 0.50 | AC→R 방향은 전건 유효(AC-1~7 인용 ID 전부 spec.md 에 실존). 그러나 R→AC 방향: 26개 중 7개(R-RT2, R-RT3, R-RT4, R-RT5, R-AS3, R-WB2, R-WB5)가 어떤 번호 AC 에도 인용 없음(grep 전수 확인). R-RT1/R-RT6 은 Edge Cases 산문(acceptance.md:L64)과 Quality Gates(L70)에만 등장. acceptance.md:L4 의 "각 AC 는 요구사항(R-*)과 1:1 추적" 주장과 불일치. Rubric 0.50: "Multiple REQs lack ACs" |

## Defects Found

D1. spec.md:L1-10 — frontmatter 에 `labels` 필드 부재 (MP-3 필수 필드) — Severity: critical
D2. spec.md:L5 — `created_at` 부재, `created`/`updated` 로 필드명 불일치 (MP-3 필수 필드명) — Severity: major
D3. acceptance.md 전체 — R-RT2/R-RT3/R-RT4/R-RT5/R-AS3/R-WB2/R-WB5 (7/26) 가 번호 AC 미인용; R-RT1/R-RT6 은 Edge Cases(L64)/Quality Gates(L70) 산문 커버만 존재. L4 의 "R-* 1:1 추적" 주장과 모순 — Severity: major
D4. spec.md:L85,L94,L100,L109 — [Un] 태그 4건(R-RT5/R-AS5/R-NC3/R-WB4)이 EARS Unwanted 표준형 "If [undesired condition], then the [system] shall [response]" 이 아닌 Ubiquitous 부정형("shall not ...") — 패턴 태그 오분류 — Severity: minor
D5. spec.md:L86 — R-RT6 [O] 의 Where 절 어순 도치: "shall enable ... **where** it does not break ..." (표준형: "Where [feature], the [system] shall ...") — Severity: minor
D6. spec.md:L82(R-RT2 정확한 패키지명+`npx expo install` 설치 메커니즘), L92(R-AS3 `Stack.Protected`/`Tabs.Protected` API 명), L93(R-AS4 파일명 `auth-state-core.ts` 강제), L98(R-NC1 `route-map-core.ts` 강제) — 규범 요구문에 구현 상세(HOW) 혼입 (RQ-3/RQ-4). 브라운필드 델타 앵커링 관례로 일부 정당화되나 순수 설치 메커니즘(R-RT2)은 plan.md 영역 — Severity: minor
D7. acceptance.md:L22 — AC-3 헤더의 "[REPLACED]" 마커가 무엇을 대체했는지 이력/설명 부재(acceptance.md 에 HISTORY 없음) — 댕글링 편집 마커 — Severity: minor
D8. acceptance.md:L46 — AC-6 의 When 절이 기대 반환값(`"native-back"` / `"goBack"` 결정 반환)을 포함 — 자극(When)과 단언(Then)의 G/W/T 구조 혼동 — Severity: minor
D9. acceptance.md:L24(AC-3, OD-1 권장안 전제), L43-45(AC-6 헤더가 OD-2 를 추적 대상으로 인용) — AC 가 미해결 Open Decision Points(spec.md:L133-138, "런 단계 진입 전 확인")의 권장안에 의존. 비권장안 채택 시 AC 재서술 필요 — Severity: minor

## Chain-of-Verification Pass

Second-look findings: 2차 패스에서 신규 결함 D9 발견(AC 의 OD 의존성), D3 정밀화(R-RT1/R-RT6 이 Edge Cases 산문에만 존재함을 grep 으로 확정). 재검 항목: (1) REQ 전수 열거 — grep 으로 26개 ID 기계 추출, 스킴 내 갭/중복 0 재확인. (2) 추적성 — 양방향 trace matrix 를 grep 기반으로 전수 구축(샘플링 아님). (3) Exclusions 구체성 — L60-70 의 10개 항목 전부 대상+근거+경계 명시(예: L63 변경 허용 범위를 `actions.ts:46,65,89` line 단위로 한정) 확인. (4) 요구 간 모순 스캔 — Exclusion L64("/home 을 WebView 로 구현 금지(웹 측)") vs R-WB5(모바일 탭이 웹 페이지를 WebView 호스팅)는 문서 내에서 명시적으로 구분·해소됨(L64 후반부); R-NC2/R-NC3 의 차단 규칙 vs 인증 플로우 예외(L65)도 상호 일관. CN-1/CN-2 모순 0건. (5) weasel word — grep 0건 재확인.

## Regression Check (Iteration 2+ only)

해당 없음 — iteration 1.

## Recommendation

manager-spec 수정 지시 (번호순):

1. **[D1/D2 — must-pass 차단]** spec.md frontmatter 에 `labels` 추가(예: `labels: [mobile, expo-router, webview, navigation]`) 및 `created_at: 2026-06-11` 필드 보강(또는 `created` → `created_at` 개명). 주의: 형제 SPEC 2건도 동일 스키마이므로 근본 원인은 SPEC 템플릿 — 템플릿 차원 수정 여부를 오케스트레이터가 사용자에게 확인할 것을 권고. 본 SPEC 의 PASS 전환에는 본 파일 수정만으로 충분.
2. **[D3 — 추적성]** R→AC 커버리지 보강: (a) acceptance.md Quality Gates L70 의 static-grep(deprecated API 0, `(tabs)/*.tsx` 래퍼)을 번호 AC(예: AC-8)로 승격하고 R-RT1/R-RT5/R-WB5 인용, (b) AC-4 헤더에 R-RT3/R-RT4(엔트리 이전 행위 보존이 Given 에 이미 서술됨) 및 R-RT2(빌드/번들 게이트) 추가, (c) AC-2 헤더에 R-AS3 추가(redirectTo 단언이 가드 결정을 이미 검증) 또는 가드 전용 AC 신설, (d) AC-5 헤더에 R-WB2 추가(Then (a) 가 이미 HomeTab 구성요소를 검증), (e) R-RT6 은 Edge Case L64 를 AC 로 승격하거나 Optional 임을 명시한 N/A 처리. 이후 L4 의 "1:1 추적" 주장이 사실이 되도록 정합화.
3. **[D4/D5]** [Un] 태그 4건(L85/L94/L100/L109)을 [U] 부정 제약으로 재태깅하거나 "If ..., then ... shall ..." 형으로 재서술. R-RT6 은 "Where the SDK 56 typecheck/build is not broken, the app shall enable ..." 어순으로 교정.
4. **[D7/D8]** AC-3 의 "[REPLACED]" 마커에 대체 이력 1줄 주석을 달거나 마커 제거. AC-6 의 기대 반환값을 When 에서 Then 으로 이동.
5. **[D9 — 권고]** OD-1/OD-2 가 AC-3/AC-6 의 전제임을 AC 본문에 명시("OD-N 권장안 채택 가정")하거나, 런 단계 진입 전 OD 확정 시 AC 동기화를 DoD 체크박스로 추가.
6. **[D6 — 선택]** R-RT2 의 설치 메커니즘(`npx expo install` 명령 자체)은 plan.md 단계 E 에 이미 존재하므로, 요구문은 "SDK 56 호환 버전으로 해석되는 네비게이션 의존성 추가(수동 핀 금지)" 수준으로 완화 가능. 파일명 강제(R-AS4/R-NC1)는 테스트 가능성 seam 이라는 설계 의도가 명확하므로 유지 허용.

수정 후 iteration 2 재감사 시 D1~D3 해소를 must-check 회귀 항목으로 검증한다.
