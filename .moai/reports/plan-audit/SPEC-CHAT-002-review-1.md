# SPEC Review Report: SPEC-CHAT-002
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.81

> M1 Context Isolation: 작성자 추론 컨텍스트는 전달되지 않았으며, spec.md / acceptance.md / plan.md 파일만을 근거로 감사함.
> 감사 대상: `.moai/specs/SPEC-CHAT-002/spec.md` (주 입력), `acceptance.md`, `plan.md` (교차 참조).

## Must-Pass Results

- [PASS] **MP-1 REQ number consistency**: REQ-PUSH-001(spec.md:L51), REQ-PUSH-002(L54), REQ-PUSH-003(L57), REQ-PUSH-004(L60), REQ-PUSH-005(L63) — 순차, 갭 없음, 중복 없음, zero-padding(3자리) 일관. 전수 확인 완료.
- [FAIL] **MP-2 EARS format compliance**: spec.md에는 ACCEPTANCE CRITERIA 섹션이 존재하지 않음(L1-103 전체 확인). 수락 기준은 acceptance.md에만 존재하며, 전부(AC-1~AC-5) Given/When/Then 테스트 시나리오 형식임(acceptance.md:L3 "## Given/When/Then 시나리오", L5-29). 5개 EARS 패턴에 부합하는 AC가 0/5. spec.md §4의 REQ들은 EARS 구조(When/Where/Ubiquitous)를 따르지만(L52, L55, L58, L61, L64) 이는 요구사항이지 수락 기준이 아님. "Every acceptance criterion must match one of the five EARS patterns" 기준 위반.
- [FAIL] **MP-3 YAML frontmatter validity**: 필수 필드 2개 누락. (1) `created_at` 부재 — spec.md:L5는 `created: 2026-06-11`로 필드명이 다름. (2) `labels` 필드 완전 부재(L1-10 전수 확인). 참고: `priority: Medium`(L8)은 존재하나 소문자 enum(critical/high/medium/low)과 대소문자 불일치. 비고: SPEC-CHAT-001도 동일 frontmatter 패턴 사용 — 프로젝트 템플릿 수준의 체계적 편차로 보이나, 감사 계약상 누락 필드 = FAIL.
- [N/A] **MP-4 Section 22 language neutrality**: N/A — 본 SPEC은 특정 제품 스택(NestJS 백엔드 + Expo 모바일)에 스코프된 단일 프로젝트 기능 SPEC이며, 템플릿 바운드/멀티 언어 툴링 콘텐츠가 아님. FCM/expo-notifications 언급(L52, L64)은 제품 본질상 플랫폼 특정으로 정당.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 1.00 | 1.0 — 모든 요구사항이 단일 해석 | REQ-PUSH-001~005(L51-64) 각각 트리거·주체·응답이 구체적. 대명사 모호성 없음. 측정 가능("sender를 제외한", "upsert", "삭제") |
| Completeness | 0.50 | 0.50 — 섹션 누락 + frontmatter 1-2 필드 누락 | spec.md에 ACCEPTANCE CRITERIA 섹션 부재(전체 L1-103); frontmatter `created_at`/`labels` 누락(L1-10). HISTORY(L14), Goal(L22), Context(L26), REQUIREMENTS(L47), Exclusions(L66, 7개 항목)는 존재 |
| Testability | 1.00 | 1.0 — 모든 AC가 binary-testable | AC-1 "멤버2 토큰으로만 1회 발송"(acceptance.md:L8), AC-2 "row 존재→row 제거"(L13), AC-3 "grep 결과 없음"(L18). weasel word("appropriate"/"reasonable" 등) 전무. AC-5 device-gate는 수동이나 binary(L25-29) |
| Traceability | 0.75 | 0.75 — orphan AC 1건 | REQ 5개 전부 AC 커버: 001→AC-1, 002/003→AC-2, 004→AC-3, 005→AC-5. 단 AC-4(acceptance.md:L20)는 REQ 참조 없이 "(게스트 제외)" 게이트 결정만 참조 — orphan AC |

## Defects Found

D1. spec.md:L1-10 — frontmatter에 필수 필드 `labels` 부재 — Severity: **critical** (MP-3)
D2. spec.md:L5 — 필수 필드 `created_at` 대신 `created` 사용 — Severity: **critical** (MP-3)
D3. spec.md:L1-103 / acceptance.md:L3-29 — spec.md에 ACCEPTANCE CRITERIA 섹션 부재. 수락 기준이 acceptance.md의 Given/When/Then 시나리오로만 존재하며 EARS 패턴 AC가 0건 — Severity: **critical** (MP-2, SC-5)
D4. acceptance.md:L20 — AC-4가 어떤 REQ-PUSH-XXX도 참조하지 않음("(게스트 제외)"는 게이트 결정 참조). REQ-PUSH-001에서 간접 도출 가능하나 명시적 trace 부재 — Severity: **major** (AC-4 traceability)
D5. spec.md:L55, L58 — REQ-PUSH-002/003이 API 스키마(`POST /devices`, `DELETE /devices/:token`)와 DB 수준 연산("`device_token` row를 upsert/삭제")을 요구사항 본문에 포함. WHAT이 아닌 HOW — Severity: **major** (RQ-3/RQ-4)
D6. spec.md:L52, L64 — REQ-PUSH-001이 모듈명 `PushModule`, REQ-PUSH-005가 라이브러리명 `expo-notifications`를 요구사항 본문에 하드코딩 (REQ-PUSH-004 L61의 ChatModule/PushModule 명명은 아키텍처 제약 자체가 요구사항이므로 허용 범위) — Severity: **minor** (RQ-4)
D7. spec.md:L64 — REQ-PUSH-005가 단일 요구사항에 3개 응답(토큰 획득, 백그라운드 수신, 탭 시 앱 열기)을 복합 기술 — 부분 구현 시 판정 모호 — Severity: **minor**
D8. spec.md:L8 — `priority: Medium` 대문자 표기, 소문자 enum(medium) 불일치 — Severity: **minor**
D9. spec.md:L1-103 — spec.md 본문이 acceptance.md를 참조/링크하지 않음(HISTORY L20은 CHAT-001의 research/interview만 링크). 수락 기준 탐색 경로 단절 — Severity: **minor**

## Chain-of-Verification Pass

Second-look findings:
- REQ 전수 재독(5/5): 추가 갭/중복 없음 확인 — L51-64 끝까지 확인.
- 번호 시퀀스 end-to-end 재검증: REQ-PUSH-001→005 연속 확인.
- Traceability 전수 재검증: REQ 5개 모두 커버 확인, AC-4 orphan(D4)은 1차 발견 유지.
- Exclusions 구체성 재검증: L66-74 7개 항목 모두 구체적(금지 사유, 후속 SPEC 참조 R-1/R-3/R-4 포함). PASS 유지.
- 요구사항 간 모순 재탐색: REQ-PUSH-001 "발송한다(shall)"(L52)와 Exclusion "재시도/큐/배달 보장 비범위 — best-effort"(L73)는 발송 시도 vs 배달 보장의 구분으로 모순 아님(acceptance.md:L35 엣지 케이스가 의미 고정). CN-1/CN-2 PASS.
- **2차 신규 발견**: D9 (spec.md → acceptance.md 미참조). 1차 결함 목록에 추가됨.

## Regression Check (Iteration 2+ only)

N/A — iteration 1.

## Recommendation

manager-spec 수정 지시 (우선순위 순):

1. **[D1, D2 — MP-3]** spec.md frontmatter에 `labels` 필드 추가(예: `labels: [push, fcm, chat, mobile]`), `created:`를 `created_at:`로 변경(또는 `created_at` 병기). 비고: SPEC-CHAT-001 등 기존 SPEC도 동일 패턴이므로, 이것이 의도된 프로젝트 템플릿 관례라면 오케스트레이터가 감사 기준과 템플릿 중 하나를 정렬해야 함 — 현 계약 기준으로는 FAIL.
2. **[D3 — MP-2]** spec.md §4와 §5 사이에 ACCEPTANCE CRITERIA 섹션을 추가하고, 각 AC를 5개 EARS 패턴 중 하나로 작성하여 REQ-PUSH-XXX에 매핑할 것. 기존 acceptance.md의 GWT 시나리오는 테스트 시나리오로 유지 가능하나, EARS 형식의 수락 기준이 문서 세트 내에 0건인 상태는 해소 필요.
3. **[D4]** acceptance.md AC-4 헤더에 명시적 REQ 참조 추가(예: "AC-4 (REQ-PUSH-001 파생, 게이트 결정)"). 또는 게스트 제외를 독립 REQ로 승격.
4. **[D5, D6, D7]** REQ-PUSH-002/003에서 엔드포인트 경로·DB 연산을 행위 기술로 환원(예: "등록 요청 시 시스템은 디바이스 토큰을 중복 없이 저장한다"), 구체 스키마는 §6 Delta Markers/plan.md로 이동. REQ-PUSH-005를 응답 단위로 분리 검토.
5. **[D8]** `priority: Medium` → `medium` 소문자 정규화.
6. **[D9]** spec.md HISTORY 또는 §4에 acceptance.md 링크 추가.

검증 강점(수정 시 보존할 것): REQ 번호 체계(MP-1 PASS), Exclusions 7개 항목의 구체성(L66-74), AC의 binary-testability와 device-gate 명시(acceptance.md:L29, L45), 느슨한 결합 정적 검사 게이트(L100).
