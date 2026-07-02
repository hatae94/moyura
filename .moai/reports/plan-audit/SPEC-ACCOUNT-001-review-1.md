# SPEC Review Report: SPEC-ACCOUNT-001
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.85

> Reasoning context ignored per M1 Context Isolation. 디스크상의 문서만 감사함:
> spec.md(주), acceptance.md / plan.md / spec-compact.md / interview.md / research.md(보조),
> 교차 SPEC 계약 검증을 위해 SPEC-SAFETY-001/plan.md 확인.

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-ACCOUNT-001(spec.md:54), 001b(:57), 002(:62), 002b(:65), 003(:70), 004(:75), 005(:80), 005b(:83). 주 번호 001~005 순차·무결번·무중복, 제로패딩 일관. `b` 접미 하위 요구사항 체계는 acceptance.md("AC-1-4 (REQ-ACCOUNT-001b)" 등)와 spec-compact.md에서 동일하게 참조되어 문서 간 정합.
- [FAIL] MP-2 EARS format compliance (proper type usage): 8개 REQ 전부 shall-진술이며 5패턴 중 하나의 구문 형태를 가지나, **타입 태그 오용 3건 + 단일 REQ 내 패턴 혼합 1건**:
  - spec.md:83-84 REQ-ACCOUNT-005b `[Optional]` + "Where 사용자가 회원 탈퇴 진입점을 선택하는 경우" — Optional 패턴은 기능 포함 조건("Where [feature exists]")용이며 사용자 액션 트리거가 아님. 동일 요구를 plan.md:39는 "When 사용자가 이를 선택하면"(Event-driven)으로 기술 — spec.md가 plan과 다른 타입으로 전환하며 오용 발생.
  - spec.md:57-58 REQ-ACCOUNT-001b `[Unwanted]` — "시스템은 …삭제하지 않는다(shall not delete)"는 If/Then 구조 부재. M3 정의상 Unwanted = "If [undesired condition], then the [system] shall [response]". 현재 형태는 Ubiquitous 부정 진술.
  - spec.md:65-66 REQ-ACCOUNT-002b `[Unwanted]` — 동일 문제(If/Then 부재, Ubiquitous 부정 진술).
  - spec.md:62-63 REQ-ACCOUNT-002 `[State-driven]` 단일 태그 아래 "While …, shall 이양" + "If …, then shall 삭제" 두 패턴 결합. plan.md:29는 같은 REQ를 `[State-driven / Unwanted]` 복합 태그로 표기 — spec.md에서 002b 분리 후에도 If/Then 분기가 002 본문에 잔존하는데 태그는 단일.
- [PASS] MP-3 YAML frontmatter validity: 요구 8필드 전부 존재·타입 정상 — id: SPEC-ACCOUNT-001(spec.md:2), version: "0.1.0"(:3), status: draft(:4), created: 2026-07-02(:5), updated: 2026-07-02(:6), author: hatae(:7), priority: critical(:8), issue_number: 0(:9).
- [N/A] MP-4 Section 22 language neutrality: N/A — 단일 프로젝트(NestJS/Next.js/Expo) 제품 SPEC. 멀티랭 툴링 대상 아님.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 (사소한 모호 1~2건, 합리적 엔지니어가 일관 해석 가능) | spec.md:88 섹션 참조 오류(§7→실제 제외 범위는 §8); "401/410"(spec.md:71, acceptance.md:55) 선택 미확정 대안 표기. 그 외 REQ는 단일 해석. |
| Completeness | 1.00 | 1.0 (필수 섹션 + frontmatter + 구체적 제외 항목) | HISTORY(spec.md:17-23), Goal(:25-27), 정책 매핑(:29-38), 가정(:40-46), REQUIREMENTS(:48-84), AC(acceptance.md 별도 파일 — 프로젝트 컨벤션), Exclusions 8개 구체 항목(:117-126), 의존/순서(:110-115). |
| Testability | 0.75 | 0.75 (1~2건이 경미한 해석 필요, 나머지 binary) | AC-1-1~AC-5-2 전부 mock 호출/응답코드/렌더 기준의 이진 판정(acceptance.md:10-85). 경미: AC-4-1 "일반화 오류"(acceptance.md:67) 판정 기준 서술 부족, AC-3-1 "null/도메인 예외" 대안 허용(acceptance.md:55). AC-4-2 device-gated 명시(:73)는 판정 조건 명확. |
| Traceability | 1.00 | 1.0 (전 REQ ≥1 AC, 전 AC가 실존 REQ 참조, 고아 없음) | 001→AC-1-1/2/3(spec.md:55), 001b→AC-1-4(:58), 002→AC-2-1/2(:63), 002b→AC-2-3(:66), 003→AC-3-1/2(:71), 004→AC-4-1/2(:76), 005→AC-5-1(:81), 005b→AC-5-2(:84). acceptance.md의 13개 AC 전수 확인 — 참조 REQ 전부 실존. |

## Defects Found

D1. spec.md:83-84 — REQ-ACCOUNT-005b가 사용자 액션 트리거("진입점을 선택하는 경우")에 `[Optional]`/"Where"를 사용. EARS Optional은 기능 존재 조건용 — Event-driven("When")으로 재태깅/재기술 필요. plan.md:39("When 사용자가 이를 선택하면")과도 불일치. — Severity: **critical** (MP-2)
D2. spec.md:57-58 — REQ-ACCOUNT-001b `[Unwanted]` 태그이나 If/Then 구조 부재(Ubiquitous 부정 진술). Unwanted로 유지하려면 "If 탈퇴 처리 중 원장 행 삭제가 시도되면, then …" 형태로 재구성하거나 태그를 Ubiquitous로 정정. — Severity: **critical** (MP-2)
D3. spec.md:65-66 — REQ-ACCOUNT-002b 동일 문제(`[Unwanted]` 태그 + If/Then 부재). — Severity: **critical** (MP-2)
D4. spec.md:62-63 — REQ-ACCOUNT-002 단일 `[State-driven]` 태그 아래 While절 + If/Then절 두 패턴 결합(plan.md:29는 복합 태그 `[State-driven / Unwanted]`). If/Then 분기를 별도 REQ로 분리하거나 복합 태그를 명시해 태그-본문 정합 확보. 추가로 "While … 인 동안 이양한다"는 지속 상태 행위가 아니라 탈퇴 이벤트 시점의 조건부 처리로, Event-driven + 전제조건 형태가 더 정확함. — Severity: major
D5. spec.md:88 — "realtime/`assertMember` 하드 회수는 제외 범위(**§7**)" — 제외 범위는 §8(spec.md:117). 잘못된 내부 섹션 참조. — Severity: minor
D6. spec.md:94 vs :99 — 동일 경로 `apps/backend/src/account/**`가 [NEW](:94)와 [MODIFY](:99)로 이중 마킹. SAFETY 선행 순서가 확정(§7)이라면 safety 정리는 최초 [NEW] 구현에 no-op 가드와 함께 포함되므로 별도 [MODIFY] 행은 모순/중복. spec-compact.md:25-38은 이 [MODIFY] 행을 누락해 spec.md §6(15행)과 compact(14행)의 델타 목록이 불일치. — Severity: minor
D7. spec.md:95 vs :96 — `apps/backend/prisma/schema.prisma`가 [NEW](:95, WithdrawnAccount 모델)와 [MODIFY](:96, withdrawnAt 컬럼)로 병기. 기존 파일에 모델 추가는 [MODIFY]이며 [NEW]는 마이그레이션 디렉터리에만 해당 — 마커 의미 불명확(plan.md §4, compact에도 동일 패턴이라 문서 간에는 일관). — Severity: minor
D8. spec.md:50 vs :55/:71/:76 — §4 서두에서 "엔드포인트 경로·DB 연산·라이브러리명 등 구현(HOW)은 plan.md/§6에 둔다"고 선언하나, REQ-001에 "Supabase Admin Client", REQ-003에 "`GET /me` → `upsertBySub`", REQ-004에 "`session:cleared`/SecureStore/`sb-*` 쿠키" 등 구현 식별자가 잔존 — 자체 선언과의 내적 모순(브라운필드 통합 지점 명명의 실익은 인정되나, L50 선언을 완화하거나 식별자를 괄호 참조로 강등해 정합 필요). — Severity: minor
D9. spec.md:33 — 정책 매핑 표의 "진입점 + 파괴적·불가역 확인 단계" 행이 REQ-ACCOUNT-005만 인용 — 확인 단계는 REQ-ACCOUNT-005b 소관이므로 "REQ-ACCOUNT-005/005b"로 병기 필요. — Severity: minor

## Chain-of-Verification Pass

Second-look findings: 1차 통과 후 전 섹션 재검토 수행.
- 전 REQ 엔트리 정독(스킴 아님): 8개 전부 shall-진술·응답 명세 확인. REQ 시퀀스 끝까지 검증(001~005b, 무결번).
- 전 REQ 트레이서빌리티 전수 검증(샘플 아님): 13 AC ↔ 8 REQ 양방향 무결.
- Exclusions 구체성: 8개 항목 전부 테이블명/기능명 단위로 구체적(spec.md:117-126) — 모호 항목 없음.
- 요구사항 간 모순 탐색: (a) REQ-001b 원장 보존 vs REQ-002 deleteMoim Cascade — "다른 (활성) 멤버의 기록" 한정으로 충돌 없음(유일 활성 owner 모임만 삭제, AC-2-2/2-3과 정합). (b) 제외 범위 "safety 필터 제외" vs REQ-001 "고아 행 정리 포함" — plan.md §9가 "(포함)"으로 명시 구분, 모순 아님. (c) 잔존 JWT 창(≤1h) 내 보존된 moim_member 행으로 assertMember 통과 가능 리스크 — research.md 갭 A-7에서 식별되었고 spec.md §5 R-2/§8에서 수용 리스크로 명시적 문서화(익명화로 PII 비노출) — 은폐된 홀 아님.
- research.md 인용 라인 스팟체크(15-17 FK 부재, 72 공유 표면, 116 sub-only, 124 fake Prisma, 142 트랜잭션 밖, 308 jwt_expiry, 353-354 poll 미렌더, 388-391 정원): 전부 실제 내용과 일치.
- 교차 SPEC 계약 검증: SPEC-SAFETY-001/plan.md:5, :157-168(§3.5), :258(R-10), :290, :301-302 — "정리 소유자 = ACCOUNT-001", "SAFETY 테이블 선행 + ACCOUNT no-op 가드" 명시. 본 SPEC의 "양쪽 plan 정합 확인" 주장(spec.md:23, plan.md:5/§10-1)은 사실로 검증됨. 계약 존중 확인.
- interview.md 정합: 확정 결정 2건(2-SPEC 분리, 즉시 삭제+UGC 익명화)이 Goal/REQ/Exclusions에 반영. 이후 3개 결정(report 삭제/SAFETY 선행/정리 소유자)은 plan.md §10에 승인일자와 함께 기록 — 추적 가능.
- notification actor 익명화 커버리지: research.md:317-323 — actor 닉네임은 렌더 시 moim_member에서 해석(행 보존+닉네임 UPDATE로 커버), 정적 텍스트 잔존 없음 — 커버리지 홀 아님.
- 2차 신규 발견: D9(정책 표 REQ 매핑 불완전) — 목록에 추가함.

## Regression Check (Iteration 2+ only)

N/A — iteration 1.

## Recommendation

FAIL 사유는 MP-2(EARS 타입 사용 적정성) 단독이며, 문서의 추적성·완결성·시나리오 구체성은 우수함. manager-spec 수정 지침:

1. **spec.md:83-84 (REQ-ACCOUNT-005b)**: `[Optional]`/"Where" → `[Event-driven]`/"When 사용자가 회원 탈퇴 진입점을 선택하면, 시스템은 파괴적·불가역 확인 단계를 거친 뒤에만 탈퇴 서버 액션을 호출한다(shall)". spec-compact.md:12도 동일 정정.
2. **spec.md:57-58 (REQ-ACCOUNT-001b)**: 태그를 `[Ubiquitous]`로 정정하거나, Unwanted 유지 시 If/Then으로 재구성(예: "If 탈퇴 처리가 원장 테이블(…)의 행 삭제를 시도하면, then 시스템은 해당 삭제를 수행하지 않고 표시명 익명화만 적용한다"). spec-compact.md:6 동기화.
3. **spec.md:65-66 (REQ-ACCOUNT-002b)**: 위와 동일 방식으로 정정(태그↔구조 정합). spec-compact.md:8 동기화.
4. **spec.md:62-63 (REQ-ACCOUNT-002)**: If/Then 분기(유일 활성 owner → deleteMoim)를 별도 REQ로 분리하거나 태그를 `[State-driven / Unwanted]` 복합으로 명시(plan.md:29와 정합). 권장: "When 탈퇴 확인이 제출되고 사용자가 활성 타 멤버가 있는 모임의 owner이면" 형태의 Event-driven + 전제조건 재기술 검토.
5. **spec.md:88**: "(§7)" → "(§8)".
6. **spec.md:94/:99 델타 중복**: :99 [MODIFY] 행을 삭제하고 :94 [NEW] 항목 설명에 safety 고아 정리(no-op 가드 포함)를 병기하거나, :99를 "[NEW에 포함]"으로 명시. spec-compact.md와 행 수 일치시킬 것.
7. **spec.md:95/:96**: schema.prisma 마커를 [MODIFY]로 통일하고 [NEW]는 마이그레이션 디렉터리에만 적용(plan.md §4·compact 동기화).
8. (선택) **spec.md:50**: HOW 배제 선언에 "기존 통합 지점 식별자(upsertBySub, session:cleared 등) 명명은 브라운필드 정밀성을 위해 허용" 단서를 추가하거나 해당 식별자를 각주/참조로 강등.
9. (선택) **spec.md:33**: REQ 열을 "REQ-ACCOUNT-005/005b"로 병기.

수정은 태깅/문구 수준으로 요구사항 실질(범위·계약·순서)은 변경 불요 — 교차 SPEC 계약(정리 소유자=ACCOUNT-001, SAFETY 선행+no-op 가드)은 검증 결과 정합하므로 유지할 것.
