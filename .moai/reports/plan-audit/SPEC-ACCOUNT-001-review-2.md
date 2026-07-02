# SPEC Review Report: SPEC-ACCOUNT-001
Iteration: 2/3
Verdict: PASS
Overall Score: 0.90

> Reasoning context ignored per M1 Context Isolation. 디스크상의 문서만 감사함:
> spec.md(주), acceptance.md / plan.md / spec-compact.md / interview.md(보조),
> 교차 SPEC 계약 검증을 위해 SPEC-SAFETY-001/spec.md·plan.md 확인.
> 이전 리포트: SPEC-ACCOUNT-001-review-1.md (회귀 검증 수행).

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-ACCOUNT-001(spec.md:54), 001b(:57), 002(:62), 002b(:65), 003(:70), 004(:75), 005(:80), 005b(:83). 주 번호 001~005 순차·무결번·무중복, 제로패딩 일관. `b` 접미 체계는 acceptance.md(:28 "AC-1-4 (REQ-ACCOUNT-001b)", :45, :82)와 spec-compact.md(:6/:8/:12)에서 동일 참조 — 4문서 간 ID 정합.
- [PASS] MP-2 EARS format compliance: 8개 REQ 전수 재검증 — 타입 태그와 구문 구조가 전부 정합.
  - 001 [Event-driven] "When 인증된 사용자가 탈퇴 확인을 제출하면, 시스템은 …한다(shall)"(spec.md:55) — 후속 문장(멱등·no-op 가드)은 동일 트리거 응답의 제약 상술로 적합.
  - 001b [Unwanted] "**If** …삭제를 시도하면, **then** …수행하지 않고 …적용한다"(:58) — If/Then 구조 확보(1차 D2 해소).
  - 002 [Event-driven] "When 탈퇴 확인이 제출되고 …owner이면, 시스템은 …수행한다(shall): (a)…(b)…"(:63) — 단일 When 트리거 + 열거형 응답(1차 권고안 그대로, D4 해소).
  - 002b [Unwanted] "**If** …선정하려 하면, **then** …수행하지 않는다"(:66) — If/Then 확보(D3 해소).
  - 003 [Unwanted] "**If** …호출하면, **then** …반환한다(shall not re-create profile)"(:71).
  - 004 [Event-driven] "When 탈퇴가 성공하면 …(shall)"(:76). 005 [Ubiquitous] "시스템은 …제공한다(shall)"(:81). 005b [Event-driven] "When 사용자가 …선택하면 …(shall)"(:84) — Optional/Where 오용 제거(D1 해소).
- [PASS] MP-3 YAML frontmatter validity: 요구 8필드 전부 존재·타입 정상 — id: SPEC-ACCOUNT-001(spec.md:2), version: "0.1.0"(:3), status: draft(:4), created: 2026-07-02(:5), updated: 2026-07-02(:6), author: hatae(:7), priority: critical(:8), issue_number: 0(:9).
- [N/A] MP-4 Section 22 language neutrality: N/A — 단일 프로젝트(NestJS/Next.js/Expo 모노레포) 제품 SPEC. 멀티랭 툴링 대상 아님.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.80 | 0.75 (사소한 모호 1~2건, 일관 해석 가능) | 잔존: "401/410" 미확정 대안(spec.md:71, acceptance.md:55 "401 또는 410"), "null 반환 또는 도메인 예외"(plan.md:88, acceptance.md:55). §참조 오류는 전부 정정됨(:15 §7, :46 §7, :88 §8 — 실제 섹션과 일치). 그 외 REQ는 단일 해석. |
| Completeness | 0.95 | 1.0 (필수 섹션 + frontmatter + 구체적 제외) | HISTORY(spec.md:17-23), Goal(:25-27), 정책 매핑(:29-38), 가정(:40-46), REQUIREMENTS(:48-84), AC 13건(acceptance.md — 프로젝트 컨벤션상 별도 파일), Exclusions 8개 구체 항목(:117-125), 의존/순서(:109-114). 감점: 2차 개정(EARS 재태깅·델타 통합)이 HISTORY에 미기록(N1). |
| Testability | 0.80 | 0.75 (경미한 해석 필요 1~2건, 나머지 binary) | AC 13건 전부 mock 호출/응답코드/렌더 기준 이진 판정(acceptance.md:10-85). 경미: AC-4-1 "일반화 오류"(:67) 판정 기준 서술 부족(N5), AC-1-4가 보호 원장 10개 중 5개만 시드(N3). AC-4-2 device-gated 판정 조건 명확(:73). weasel word 없음. |
| Traceability | 1.00 | 1.0 (전 REQ ≥1 AC, 전 AC 실존 REQ 참조, 고아 없음) | 001→AC-1-1/2/3(spec.md:55), 001b→AC-1-4(:58), 002→AC-2-1/2(:63), 002b→AC-2-3(:66), 003→AC-3-1/2(:71), 004→AC-4-1/2(:76), 005→AC-5-1(:81), 005b→AC-5-2(:84). acceptance.md 13개 AC 전수 역방향 확인 — 참조 REQ 전부 실존. |

## Defects Found

(신규 — 전부 minor, 차단 아님)

N1. spec.md:17-23 — 2차 개정(REQ 4건 재태깅 D1~D4, 델타 마커 통합 D6/D7, §4 서두 개정 D8)이 반영되었으나 HISTORY에 개정 엔트리가 없고 version이 "0.1.0" 유지. draft 승인 전 반복이라 관례상 허용 여지는 있으나 재태깅은 요구사항 표기 실질 변경이므로 이력 기록 권장. — Severity: minor
N2. spec.md:71 / acceptance.md:55 — 계정 소멸 응답 "401/410" 및 신호 "null/도메인 예외"가 미확정 대안으로 병기(1차 Clarity 각주에서 지적, 번호 결함 아님 → 회귀 아님). 이진 판정("401 또는 410")은 가능하나 구현 착수 전 단일 확정 권장. — Severity: minor
N3. acceptance.md:29-31 — AC-1-4의 Given이 보호 원장 5개(chat_message/schedule_slot/expense/settlement/poll_vote)만 시드하고 Then이 "위 원장 테이블"로 한정 — REQ-ACCOUNT-001b(spec.md:58)는 10개 테이블(schedule_event, expense_share, settlement_request, poll 포함) 열거. fake Prisma에서는 전 모델 delete 미호출 단언이 가능하므로 Then을 "REQ-001b 열거 테이블 전체에 delete 미기록"으로 확장 권장. — Severity: minor
N4. plan.md:17 — 스토어 매핑 표가 REQ-ACCOUNT-005만 인용(spec.md:33은 005/005b 병기). plan.md §2가 모듈 단위 5개 항목([Ubiquitous / Event-driven] 복합 태그, plan.md:38)으로 기술하는 내부 관례상 자체 모순은 아니나 문서 간 입도 차이. — Severity: minor
N5. acceptance.md:67 — AC-4-1 "실패 시 자격증명 비노출 일반화 오류"의 판정 기준(예: 오류 메시지에 토큰/키 문자열 미포함 단언) 미서술. — Severity: minor

## Chain-of-Verification Pass

Second-look findings: 1차 통과 후 전 섹션 재정독 수행 — 신규 발견 N1~N5를 목록에 추가함(스킴 아님 확인).
- 전 REQ 엔트리 정독: 8개 전부 태그·구문·shall 표기 대조(위 MP-2 증거). REQ 시퀀스 끝까지 재검증(001~005b 무결번·무중복).
- 트레이서빌리티 전수(샘플 아님): 13 AC ↔ 8 REQ 양방향 재확인 — 고아 0.
- 델타 목록 행 단위 대조: spec.md §6(:94-107) 14행 = spec-compact.md(:25-38) 14행 = plan.md §4(:111-124) 14행 — 마커([NEW]/[MODIFY]/[EXISTING]/[REGEN])·대상 경로 전부 일치. plan.md:45의 "[NEW] withdrawn_account 테이블"은 DB 오브젝트 단위 표기로 파일 단위 [MODIFY](schema.prisma)와 충돌 없음.
- Exclusions 구체성: 8개 항목 전부 테이블명/기능명 단위(spec.md:117-125), plan.md §9(:208-215)와 항목·내용 정합.
- 요구사항 간 모순 재탐색: (a) REQ-001b 원장 보존 vs REQ-002(b) deleteMoim Cascade — 삭제 경로는 "다른 활성 멤버 0" 판정 시에만 진입(spec.md:63 "조건 판정은 모두 활성 멤버 기준"), AC-2-2/2-3과 정합. REQ-001b의 "다른 멤버의" 표현에 유령(탈퇴 마킹) 멤버 기록의 Cascade 소멸 여부 해석 여지가 미세하게 남으나(접근 주체 부재로 실질 무해) 1차와 동일 판단 유지 — Clarity 반영. (b) 제외 "safety 필터 제외"(spec.md:122) vs REQ-001 "고아 행 정리 포함"(:55) — 정리(정합성)와 필터(기능)의 소관 구분이 §8과 plan §9(:211 "(포함)")에서 명시 — 모순 아님.
- 인터뷰 정합: 확정 결정 2건(2-SPEC 분리 / 즉시 삭제+UGC 익명화, interview.md:13/:16)이 Goal(:27)·REQ-001/001b·Exclusions(유예/복구 없음, :120)에 반영. 이후 3개 결정(report 삭제·SAFETY 선행·정리 소유자)은 HISTORY(:23)와 plan §10(:217-223)에 승인일자와 함께 기록.
- 교차 SPEC 계약 재검증(양방향): SPEC-SAFETY-001 spec.md:22("정리 = SPEC-ACCOUNT-001 소관, SAFETY 테이블 선행"), :51, :165 + plan.md:5, §3.5(:157-168), R-10(:258), :292, §10-3(:303) ↔ 본 SPEC spec.md:15/:23/:46/:55/§7(:111)/§8(:122), plan.md:5/§10-1(:221). "정리 소유자 = ACCOUNT-001, SAFETY 선행 + no-op 가드" 계약이 양쪽 문서에서 동일 방향 — 존중 확인. AC-1-3(acceptance.md:20-26)이 배포/미배포(no-op 가드) 양 경로를 테스트로 고정.
- interview.md에 없는 스코프 팽창 여부: REQ-003(부활 차단)/004(세션)/005(진입점)는 결정 2("즉시 삭제")의 실효성 파생 요건 + 스토어 정책 근거(spec.md:29-38)로 정당화 — 무단 팽창 아님.

## Regression Check (Iteration 2+ only)

이전 이터레이션(review-1) 결함 9건 전수 검증:

- D1 (critical, MP-2): REQ-005b `[Optional]`/Where 오용 — [RESOLVED]: spec.md:83-84 `[Event-driven]` "When 사용자가 회원 탈퇴 진입점을 선택하면"으로 재기술. spec-compact.md:12 동기화 확인.
- D2 (critical, MP-2): REQ-001b If/Then 부재 — [RESOLVED]: spec.md:57-58 "**If** …시도하면, **then** …" 구조 확보. spec-compact.md:6 동기화.
- D3 (critical, MP-2): REQ-002b If/Then 부재 — [RESOLVED]: spec.md:65-66 If/Then 구조 확보. spec-compact.md:8 동기화.
- D4 (major): REQ-002 태그-본문 불일치(While+If/Then 혼합) — [RESOLVED]: spec.md:62-63 단일 `[Event-driven]` When 트리거 + (a)/(b) 열거 응답(1차 권고 형태). plan.md:29 복합 태그도 `[Event-driven / Unwanted]`로 갱신되어 정합.
- D5 (minor): §7→§8 참조 오류 — [RESOLVED]: spec.md:88 "(§8)".
- D6 (minor): account/** [NEW]/[MODIFY] 이중 마킹 + compact 행 수 불일치 — [RESOLVED]: spec.md:94 단일 [NEW]에 safety 정리 포함 명기, §6 14행 = compact 14행 = plan §4 14행.
- D7 (minor): schema.prisma [NEW]/[MODIFY] 병기 — [RESOLVED]: spec.md:95 단일 [MODIFY](모델+컬럼), [NEW]는 마이그레이션 디렉터리만(:96). plan.md:112, compact:26 정합.
- D8 (minor): §4 서두 HOW 배제 선언 vs 식별자 잔존 모순 — [RESOLVED]: spec.md:50에 기존 식별자(브라운필드 앵커) 허용 단서 명문화.
- D9 (minor): 정책 표 REQ 매핑 불완전 — [RESOLVED]: spec.md:33 "REQ-ACCOUNT-005/005b" 병기.

미해소 회귀: **0건**. 정체(stagnation) 결함: 없음.

## Recommendation

**PASS.** 근거:
- MP-1: REQ 001~005b 순차·무결번·무중복(spec.md:54-84), 4문서 ID 정합.
- MP-2: 1차 FAIL 사유였던 태그 오용 3건 + 패턴 혼합 1건이 전부 권고 형태로 정정됨 — 8개 REQ 전수 태그↔구문 정합(위 인용).
- MP-3: frontmatter 8/8 필드 존재·타입 정상(spec.md:2-9).
- MP-4: N/A(단일 프로젝트 SPEC).
- 이전 결함 9/9 해소, 신규 발견 5건은 전부 minor(차단 아님).

run 단계 진입 전 정리 권장(비차단): (1) N2 — 401 vs 410, null vs 도메인 예외를 구현 착수 시 단일 확정하고 AC-3-1에 반영. (2) N3 — AC-1-4 Then을 REQ-001b 열거 10개 테이블 전체 delete 미기록 단언으로 확장. (3) N1 — 승인 시점에 HISTORY 개정 엔트리 추가(재태깅 기록). (4) N5 — AC-4-1 일반화 오류 판정 기준 1줄 보강. 교차 SPEC 계약(정리 소유자=ACCOUNT-001, SAFETY 선행+no-op 가드)은 양방향 정합 검증 완료 — 그대로 유지할 것.
