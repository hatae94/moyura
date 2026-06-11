# SPEC Review Report: SPEC-CHAT-001
Iteration: 2/3
Verdict: PASS
Overall Score: 0.88

> 감사 입력: `.moai/specs/SPEC-CHAT-001/spec.md` v0.1.1 (1차), `acceptance.md`·`plan.md` (교차 참조), 이전 리포트 `SPEC-CHAT-001-review-1.md` (회귀 검사).
> `interview.md`·`research.md`는 작성자 추론 컨텍스트이므로 미열람 — Reasoning context ignored per M1 Context Isolation.
> 오케스트레이터 조정 계약(frontmatter 8필드 / AC는 acceptance.md 소재)은 **맹신하지 않고 독립 검증함**: 저장소 13개 SPEC frontmatter 전수 대조 결과, 12/13이 `created`/`updated` 키 사용 + `labels`·`created_at` 부재(유일 예외: SPEC-MOBILE-003가 양쪽 키를 중복 보유). Given/When/Then은 전 SPEC에서 acceptance.md에 소재. 조정 계약은 경험적으로 성립 → MP-3은 검증된 저장소 계약(id, version, status, created, updated, author, priority 소문자 enum, issue_number) 기준으로 평가.

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-CHAT-001(spec.md:L55) → 002(L60) → 003(L63) → 004(L68) → 005(L71) → 006(L74). 순차, 갭/중복 없음, 3자리 zero-padding 일관.
- [PASS] MP-2 EARS format compliance: 6개 REQ 전수 패턴 일치 —
  - L56 Event-driven: "**When** 모임 멤버가 메시지를 전송하면, 시스템은 … 발행한다(shall)"
  - L61 Event-driven: "**When** 새 메시지가 영속 저장되면, 시스템은 … 전파한다(shall)"
  - L64 Ubiquitous: "시스템은 keyset 페이지네이션 … 제공한다(shall)"
  - L69 State-driven: "**While** 구독자가 대상 모임의 멤버가 아닌 동안, … 거부한다(shall)"
  - L72 Unwanted: "**If** 비멤버가 메시지 전송을 시도하면, **then** … 403을 반환한다(shall)" — 1차 D8의 "(shall not 저장)" 마커가 "(shall)"로 통일됨
  - L75 Ubiquitous: "시스템은 모임 채팅 화면에서 … 제공한다(shall)"
  - acceptance.md AC-1~5는 "Given/When/Then 시나리오"(acceptance.md:L5)로 명시 라벨된 수락 시나리오 — EARS 오표기 아님(조정 계약상 정위치).
- [PASS] MP-3 YAML frontmatter validity (검증된 저장소 계약 기준): `id: SPEC-CHAT-001`(L2, 패턴 일치) / `version: "0.1.1"`(L3, string) / `status: draft`(L4, 유효 enum) / `created: 2026-06-11`(L5, ISO date) / `updated: 2026-06-11`(L6) / `author: hatae`(L7) / `priority: high`(L8, **소문자 정합 — 1차 D3 해소**) / `issue_number: 0`(L9, 존재). 8/8 필드 존재 + 타입 정합.
- [N/A] MP-4 Section 22 language neutrality: N/A — 단일 프로젝트(NestJS + Next.js + Supabase) 기능 SPEC. 멀티 언어 툴링/템플릿 바운드 콘텐츠 아님.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 — 1~2개 요구사항의 경미한 모호성, 합리적 엔지니어가 일관되게 해석 가능 | nickname 해석 위치가 §2:L39 + REQ-002:L61 + AC-1 Note(acceptance.md:L11)로 3중 고정(1차 D5 모호성 제거). 잔여: REQ-006(L75)의 "즉시 표시"는 시간 한도 부재(D12), REQ-006이 구독·표시·전송 3개 행위 복합으로 L51의 "각 REQ는 단일 행위" 선언과 불일치(D12). |
| Completeness | 1.00 | 1.0 — 필수 섹션 전부 존재, frontmatter 완전, Exclusions 구체 항목 보유 | HISTORY(L16), 목표/WHAT(L29), 배경/WHY(L33), REQUIREMENTS(L49, 6건), AC는 acceptance.md(L7–31, 5건) + spec.md 링크(L14) + REQ별 "— AC:" 매핑(L56/61/64/69/72/75), Exclusions 6건(L79–84), frontmatter 8/8(L1–L10). 1차 D4의 웹 UI REQ 공백이 REQ-CHAT-006(L74–75)으로 충전됨. |
| Testability | 0.75 | 0.75 — 1개 AC가 정밀 이진 판정 불가하나 경미한 해석으로 측정 가능 | AC-1~4 이진 판정 가능(레코드 수신 필드 명세 acceptance.md:L10 / 내림차순 K개+커서 L16 / 403+미저장+미발행 L21 / RLS 거부 L26). 엣지 "404 또는 403" 비결정성은 "**403** … 결정됨"(L37)으로 해소(1차 D7). 잔여: 엣지 "길이 초과 → 400"(L35)의 한도 수치 미정의(D13), AC-5 "즉시 렌더"(L31) 경미한 해석 필요. weasel word("적절한"/"appropriate" 등) 없음. |
| Traceability | 1.00 | 1.0 — 전 REQ가 AC 보유, 전 AC가 유효 REQ 참조, 고아 없음 | 전수 매핑: REQ-001→AC-1(L56), REQ-002→AC-1(L61), REQ-003→AC-2(L64), REQ-004→AC-4(L69), REQ-005→AC-3(L72), REQ-006→AC-5(L75). 역방향: AC-1→REQ-001·002(acceptance.md:L7), AC-2→REQ-003(L13), AC-3→REQ-005(L18), AC-4→REQ-004(L23), AC-5→REQ-006(L28) — 전부 실존 REQ. 1차 D4 고아 AC-5 해소. |

## Defects Found

- D11. spec.md:L66, L74 — REQ-CHAT-006(웹 구독 UI)이 "모듈 B — 접근 제어" 하위에 배치됨. 웹 구독 UI는 접근 제어 행위가 아님 — 모듈 분류 불일치. 기능 영향 없음 — Severity: minor
- D12. spec.md:L51 vs L75 — L51은 "각 REQ는 단일 행위를 기술"이라 선언하나 REQ-CHAT-006은 구독·수신 표시·전송 3개 행위를 복합 기술. 또한 "즉시 표시"의 시간 한도 부재(테스터는 '수동 새로고침 없이 렌더'로 판정 가능하므로 측정은 가능) — Severity: minor
- D13. acceptance.md:L35 — 엣지 케이스 "길이 초과 → 400"의 길이 한도 수치가 spec.md/acceptance.md 어디에도 미정의(plan.md:L49도 "길이 제한은 DTO + DB CHECK"만 명시). 테스터가 초과 입력을 구성할 기준 부재 — Severity: minor

치명/주요(critical/major) 결함: 없음. 위 3건은 모두 must-pass 기준에 비매핑되는 minor.

## Chain-of-Verification Pass

2차 패스 신규 발견: **D11, D12, D13** (3건 모두 2차 정독에서 발견 — 1차 패스는 회귀 확인에 집중했음).

재검증 항목:
- REQ 전수 재독(6건): 완료 — L55–L75 끝까지 확인, 추가 갭 없음. REQ-001의 `chat.message.created` 이벤트명·페이로드 필드는 CHAT-002가 의존하는 공개 계약(인터페이스)이므로 RQ-4 위반 아님으로 판정. 구현 힌트는 "비규정" 블록인용(L58)으로 격리됨.
- REQ 번호 시퀀스 끝까지: 001–006 완전, spot-check 아닌 전수.
- 추적성 전수: 6/6 REQ 커버 + 5/5 AC 유효 참조, 고아 0건 확정.
- Exclusions 구체성: 6건 전부 구체적(FCM 푸시 L79, 읽음 확인/타이핑 L80, 수정/삭제 L81, 첨부/리액션 L82, 네이티브 화면 L83, 웹 푸시 L84) — 모호 항목 없음.
- REQ 간 모순 스캔: 없음 — REQ-002 "페이로드는 메시지 레코드만"(L61) vs AC-1 수신 필드(acceptance.md:L10) 정합. REQ-001 이벤트 페이로드(미리보기 텍스트, L56) vs broadcast 페이로드(전체 content, L61)는 별개 채널로 §2:L36·L39와 정합. Exclusions vs REQ 충돌(CN-2): 없음 — 네이티브 화면 배제(L83)와 REQ-006 웹 UI는 양립(웹 UI를 WebView 호스팅). 가정 L46(Prisma RLS 우회)과 DoD default-deny RLS(acceptance.md:L52)도 용도 구분 정합(plan.md:L69 R-RLS).

## Regression Check (Iteration 2+ only)

이전 이터레이션(review-1) 결함 10건 전수 검증:

- D1 (labels 부재, critical): **RESOLVED (계약 조정 + 독립 검증)** — 저장소 13개 SPEC 전수 대조 결과 12/13이 `labels` 미보유. 검증된 frontmatter 계약(8필드)에 `labels` 없음 → 1차 판정은 잘못된 계약 전제에 기인한 false positive. spec 변경 불요.
- D2 (created_at 부재, critical): **RESOLVED (계약 조정 + 독립 검증)** — 검증된 계약의 날짜 키는 `created`이며 spec.md:L5에 존재. 동일하게 false positive 정정.
- D3 (priority: High 대소문자, minor): **RESOLVED** — spec.md:L8 `priority: high`.
- D4 (웹 UI REQ 부재 + 고아 AC-5, major): **RESOLVED** — REQ-CHAT-006 신설(L74–75), AC-5가 REQ-CHAT-006 참조(acceptance.md:L28). HISTORY L19에 개정 기록.
- D5 (AC-1 nickname vs REQ-002 메커니즘 모순, major): **RESOLVED** — 게이트 결정 확정: broadcast 페이로드는 row만 운반(L61, §2:L36), nickname은 소비 측 해석(§2:L39), AC-1에서 broadcast 수신분 nickname 요구 제거 + Note 명시(acceptance.md:L10–11). plan.md:L71의 "고려"가 "**결정(게이트)**"으로 확정됨.
- D6 (REQ 정규 텍스트 구현 세부, major): **RESOLVED** — REQ-002(L61)에서 `realtime.broadcast_changes()` 함수명·트리거 메커니즘 제거, REQ-004(L69)에서 `realtime.messages` 테이블명 제거 — 결과 중심 재서술. 메커니즘은 §2(L36–38)·plan.md로 이동.
- D7 ("404 또는 403" 비결정, minor): **RESOLVED** — acceptance.md:L37 "**403** (비멤버 처리와 동일 — 모임 존재 여부 노출 방지, 결정됨)".
- D8 ("(shall not 저장)" 마커, minor): **RESOLVED** — spec.md:L72 "(shall)" 통일, 부정 의미는 본문 "저장·발행 없이"가 전달.
- D9 (이벤트 계약 REQ 부재, minor): **RESOLVED** — 이벤트 발행 책임이 REQ-CHAT-001 정규 텍스트에 흡수(L56: "`chat.message.created` 도메인 이벤트 … 발행한다(shall)"), chat-events.ts 소유권은 비규정 힌트(L58)로 구분.
- D10 (issue_number: 0 vs null, minor/선택): **INVALIDATED (증거 기반 무효화)** — 2026-06-11 생성 SPEC 6건(CHAT-001, CHAT-002, MOIM-001, MOIM-002, MOBILE-003, MOBILE-004) 전부 `issue_number: 0` 사용. 1차의 "null 관례" 판정은 구세대 SPEC(2026-06-09 이전) 기준이었음 → 현행 템플릿 관례와 정합하므로 결함 아님. 정체(stagnation) 플래그 비해당 — 미해결이 아니라 판정 자체를 증거로 철회.

미해결 결함: **0건** → 자동 FAIL 조건 비발동.

## Recommendation

**PASS** — 근거:
1. MP-1: REQ-CHAT-001~006 순차 완전(spec.md:L55/60/63/68/71/74).
2. MP-2: 6개 REQ 전수 EARS 5패턴 일치(L56 When / L61 When / L64 Ubiquitous / L69 While / L72 If-then / L75 Ubiquitous), 전부 "(shall)" 마커.
3. MP-3: 검증된 저장소 계약 8필드 전부 존재 + 타입·enum 정합(L1–L10), `priority: high` 소문자(L8).
4. MP-4: N/A — 단일 프로젝트 기능 SPEC.
5. 회귀: 1차 결함 10건 중 8건 spec 개정으로 해소, 2건(D1·D2)은 잘못된 계약 전제의 false positive로 독립 검증 후 정정. 미해결 0건.

후속 권고 (비차단, manager-spec 재량 — 본 verdict에 영향 없음):
1. (D11) REQ-CHAT-006을 별도 모듈(예: "모듈 C — 웹 클라이언트") 또는 모듈 A로 재배치.
2. (D12) REQ-CHAT-006을 구독/표시/전송으로 분리하거나, L51의 "단일 행위" 문구를 "단일 책임"으로 완화. "즉시 표시"에 판정 기준 1줄 추가(예: "수동 새로고침 없이").
3. (D13) content 길이 한도 수치를 acceptance.md 엣지 케이스 또는 REQ-CHAT-001에 명시(예: 2,000자).
