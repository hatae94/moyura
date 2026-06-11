# SPEC Review Report: SPEC-CHAT-001
Iteration: 1/3
Verdict: FAIL
Overall Score: 0.69

> 감사 입력: `.moai/specs/SPEC-CHAT-001/spec.md` (1차), `acceptance.md`·`plan.md` (교차 참조).
> `interview.md`·`research.md`는 작성자 추론 컨텍스트이므로 미열람 — Reasoning context ignored per M1 Context Isolation.

## Must-Pass Results

- [PASS] MP-1 REQ number consistency: REQ-CHAT-001(spec.md:L46) → 002(L49) → 003(L52) → 004(L55) → 005(L58). 순차, 갭/중복 없음, 3자리 zero-padding 일관.
- [PASS] MP-2 EARS format compliance: 5개 REQ 모두 EARS 패턴 일치 —
  - L47 Event-driven: "**When** 모임 멤버가 메시지를 전송하면, 시스템은 … 발행한다(shall)"
  - L50 Event-driven: "**When** `chat_message`에 row가 INSERT되면, Postgres 트리거는 … 팬아웃한다(shall)"
  - L53 Ubiquitous: "시스템은 keyset 페이지네이션 … 제공한다(shall)"
  - L56 State-driven: "**While** 구독자가 … 멤버가 아닌 동안, … 거부한다(shall)"
  - L59 Unwanted: "**If** 비멤버가 … 시도하면, **then** 시스템은 … 403을 반환한다"
  - acceptance.md의 AC-1~5는 "Given/When/Then 시나리오"(acceptance.md:L3)로 명시 라벨된 수락 시나리오이며 EARS로 오표기(mislabel)되지 않음. 단, REQ-CHAT-005의 "(shall not 저장)" 표기는 001–004의 "(shall)" 관례와 불일치 (D8, minor — 패턴 구조 자체는 충족).
- [FAIL] MP-3 YAML frontmatter validity: **`labels` 필드 부재**(frontmatter spec.md:L1–L10 전체에 없음), **`created_at` 부재**(L5에 `created: 2026-06-11`로 명명 — 키 이름 불일치). 필수 필드 누락 2건 = FAIL. 부가: `priority: High`(L8)는 허용 값 집합 {critical, high, medium, low}과 대소문자 불일치 (D3, minor).
- [N/A] MP-4 Section 22 language neutrality: N/A — 단일 프로젝트(NestJS + Next.js + Supabase) 기능 SPEC. 멀티 언어 툴링/템플릿 바운드 콘텐츠 아님.

## Category Scores (0.0-1.0, rubric-anchored)

| Dimension | Score | Rubric Band | Evidence |
|-----------|-------|-------------|----------|
| Clarity | 0.75 | 0.75 — 1~2개 요구사항의 경미한 모호성, 합리적 엔지니어가 일관되게 해석 가능 | L53 "커서 = 마지막 메시지 id"는 내림차순 명시 + acceptance.md AC-2(L10–13)로 해석 고정. L59 "(shall not 저장)"은 본문 "저장·발행 없이"와 이중 표현(D8). |
| Completeness | 0.50 | 0.50 — frontmatter 필수 필드 1~2개 누락 | 섹션 자체는 충실: HISTORY(L14), 배경/WHY(L26), 목표/WHAT(L22), REQUIREMENTS(L42), Exclusions(L61, 구체 항목 6건 L63–68), AC는 acceptance.md(L5–28). 그러나 frontmatter `labels`/`created_at` 누락(D1, D2) + 웹 구독 UI 산출물에 대응 REQ 부재(D4). |
| Testability | 0.75 | 0.75 — 1개 AC가 정밀 이진 판정 불가하나 경미한 해석으로 측정 가능 | AC-1~4는 이진 판정 가능(row 생성/403/RLS 거부/커서 결과). acceptance.md:L34 "404 **또는** 403"은 기대 동작 비결정(D7). AC-5의 "CSP 위반 없이 연결"(L28)은 수동 확인 필요하나 측정 가능. weasel word("appropriate"/"적절한" 등) 없음. |
| Traceability | 0.75 | 0.75 — 고아 AC 1건 | REQ 커버리지 완전: 001→AC-1, 002→AC-1, 003→AC-2, 004→AC-4, 005→AC-3 (acceptance.md:L5–23). 단 **AC-5(acceptance.md:L25–28)는 어떤 REQ도 참조하지 않는 고아 AC**(D4). AC-1의 "broadcast로 nickname 포함 수신"(L8)은 어떤 REQ도 보장하지 않는 속성(D5). |

## Defects Found

- D1. spec.md:L1–L10 — frontmatter에 `labels` 필드 부재 (MP-3 필수 필드) — Severity: **critical**
- D2. spec.md:L5 — `created_at` 부재, `created`로 명명됨 (MP-3 필수 필드 키 불일치). 참고: 저장소 내 13개 SPEC 전부 동일 패턴 → 템플릿 차원의 시스템적 문제로 추정되나, 감사 계약상 FAIL — Severity: **critical**
- D3. spec.md:L8 — `priority: High` — 허용 값 집합(critical/high/medium/low)과 대소문자 불일치. 저장소 다수(9/13)는 소문자 사용 — Severity: minor
- D4. spec.md:L24, L78 + acceptance.md:L25–28 — 목표(Goal)와 Delta Marker, DoD(acceptance.md:L51)에 명시된 **웹 구독 UI(`/moims/[id]/chat` + `useChatChannel`) 산출물에 대응하는 REQ가 없음**. AC-5가 REQ 미참조 고아 AC로 떠 있음 — Severity: **major**
- D5. acceptance.md:L8 vs spec.md:L50, L32 — **AC-1은 broadcast 수신 메시지에 "sender nickname 포함"을 요구하나, REQ-CHAT-002의 메커니즘(`realtime.broadcast_changes()` row 팬아웃)은 nickname을 포함할 수 없음**: `chat_message` 테이블에 nickname 컬럼이 없고(plan.md:L45–54 모델 초안), L32는 nickname을 `moim_member` join으로 해석한다고 명시. plan.md:L71도 "preview 페이로드에도 senderNickname 포함 **고려**"로 미해결 표기. AC-1이 현 REQ 체계로 충족 불가능할 수 있는 모순 — Severity: **major**
- D6. spec.md:L50, L56 — 요구사항 정규 텍스트에 구현 세부 하드코딩: REQ-CHAT-002에 함수명 `realtime.broadcast_changes()`·트리거 메커니즘, REQ-CHAT-004에 `realtime.messages` 테이블명 (RQ-4 위반 — WHAT이 아닌 HOW). 메커니즘은 §2 배경(L28–32)·plan.md에 이미 존재 — Severity: major
- D7. acceptance.md:L34 — 엣지 케이스 "존재하지 않는 모임으로 전송 → **404 또는 403**" — 기대 동작 비결정적, 테스터가 단일 정답을 판정할 수 없음 — Severity: minor
- D8. spec.md:L59 — REQ-CHAT-005 정규 마커 "(shall not 저장)" — 001–004의 "(shall)" 관례와 불일치, 본문 "저장·발행 없이"와 부정 의미 이중 표현 — Severity: minor
- D9. spec.md:L24 + acceptance.md:L50 — `chat-events.ts` 계약 export + `@nestjs/event-emitter` 선행 도입이 목표·DoD에 있으나 이를 규정하는 REQ 없음 (REQ-CHAT-001은 이벤트 "발행"만 규정) — Severity: minor
- D10. spec.md:L9 — `issue_number: 0` — 저장소 관례는 `null`(완료된 SPEC 7건 기준) — Severity: minor

## Chain-of-Verification Pass

2차 패스 신규 발견: **D5** (AC-1 nickname-in-broadcast vs REQ-CHAT-002 row 팬아웃 메커니즘 모순) — 1차 패스에서는 AC-1의 REQ 참조 유효성만 확인했고, Then 절의 페이로드 속성이 REQ가 보장하는 범위를 초과함을 놓쳤음. plan.md:L71 리스크 표와 plan.md 모델 초안(L45–54)을 재대조하여 확정.

재검증 항목:
- REQ 전수 재독(5건): 완료 — 추가 갭 없음
- REQ 번호 시퀀스 끝까지 확인: 001–005 완전
- REQ별 추적성 전수 확인: 5/5 커버, 고아 AC는 AC-5 1건뿐임을 확정
- Exclusions 구체성: 6개 항목 모두 구체적(FCM 푸시, 읽음 확인/타이핑, 수정/삭제, 첨부/리액션, 네이티브 화면, 웹 푸시) — 모호 항목 없음
- REQ 간 모순: 없음. Exclusions vs REQ 충돌(CN-2): 없음 — "insert-only"(L65)는 REQ 체계와 정합. 가정 L39(Prisma RLS 우회)와 DoD의 default-deny RLS(acceptance.md:L48)도 용도 구분(구독 인가/PostgREST 차단)으로 정합

## Regression Check (Iteration 2+ only)

해당 없음 — iteration 1.

## Recommendation

manager-spec 수정 지시 (우선순위순):

1. **(D1, 필수)** frontmatter에 `labels` 추가. 예: `labels: [chat, realtime, backend, web]` (spec.md:L1–L10).
2. **(D2, 필수)** L5 `created` → `created_at`으로 키 변경 (`updated`도 정합 검토 권장). 저장소 13개 SPEC 전부 동일 패턴이므로 SPEC 템플릿 자체의 스키마 정합 확인 필요 — 본 SPEC 통과를 위해서는 `created_at` 필수.
3. **(D4)** 웹 구독 UI에 대한 REQ 신설 (예: REQ-CHAT-006 Ubiquitous — "시스템은 `/moims/[id]/chat`에서 broadcast 구독으로 신규 메시지를 실시간 표시한다(shall)") 후 AC-5를 해당 REQ에 연결. 단 L44 "요구사항 모듈: 5개 (한도 준수)" 제약이 hard cap이라면, 대안으로 AC-5를 acceptance.md의 "품질 게이트 기준" 섹션(L38–44)으로 재분류하되 수신/표시 책임을 기존 REQ에 흡수할 것.
4. **(D5)** AC-1과 REQ-CHAT-002의 nickname 모순 해소 — 둘 중 하나: (a) broadcast 페이로드에 senderNickname 포함을 REQ 차원에서 보장(트리거 페이로드 설계 변경 수반), 또는 (b) AC-1에서 broadcast 수신분의 nickname 요구를 제거하고 클라이언트 측 해석(REST 응답/히스토리 join)으로 명시. plan.md:L71의 "고려"를 결정으로 확정할 것.
5. **(D6)** REQ-CHAT-002/004의 정규 텍스트에서 `realtime.broadcast_changes()` 함수명·`realtime.messages` 테이블명을 제거하고 결과 중심으로 재서술 (예: "멤버 구독자의 private channel에 신규 메시지가 전파된다"). 메커니즘은 §2 배경과 plan.md가 이미 보유.
6. **(D3)** L8 `priority: High` → `high` (소문자, 허용 값 집합 정합).
7. **(D7)** acceptance.md:L34 "404 또는 403" → 단일 기대 동작으로 확정 (비멤버 처리와 동일하게 403 권장 — 모임 존재 여부 노출 방지).
8. **(D8)** L59 마커를 "(shall)"로 통일 — 부정 의미는 본문 "저장·발행 없이"가 이미 전달.
9. **(D9, 선택)** chat-events.ts 계약 export를 REQ-CHAT-001에 명시 흡수하거나 Delta/plan 책임으로 명확히 구분.
10. **(D10, 선택)** L9 `issue_number: 0` → `null` (저장소 관례 정합).
