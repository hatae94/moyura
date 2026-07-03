# Sprint Contract — SPEC-SAFETY-001 (신고·차단 UGC 모더레이션)

> harness: thorough | evaluator: evaluator-active | negotiation round: 1
> 이 문서는 구현 시작 전 evaluator-active가 협의한 Done 기준이다. 평가자는 이 계약 외 기준으로 점수를 매기지 않으며, 구현자는 증거 없이 기준 충족을 주장할 수 없다.

---

## 1. 우선 평가 차원 (Priority Dimension)

**Functionality + Data-Isolation Correctness**

근거:
- 신고·차단 필터는 데이터 분리가 핵심 — 잘못된 union/역방향 로직이 다른 뷰어 데이터를 오염시킨다.
- 지출 계산 오염(R-2)은 정산 무결성을 깨는 silent bug로, Security 다음으로 위험한 기능 버그다.
- 웹 빌드/lint는 보조 검증이며, 백엔드 jest + 정적 검사가 이 SPEC의 주요 품질 증거다.

---

## 2. 마일스톤별 수락 체크리스트

### M1 — DB 데이터 모델 (T-001)

| # | 기준 | REQ/AC | 증거 |
|---|------|--------|------|
| M1-1 | `schema.prisma`에 `Block` 모델(`@@id([blockerId, blockedUserId])`, `@@index([blockerId])`, `@@index([blockedUserId])`) 추가 | REQ-BLK-001, REQ-FLT-006 | `prisma generate` 타입 반영 확인 |
| M1-2 | `schema.prisma`에 `Report` 모델(`uuid PK`, `contentId TEXT`, `@@index([targetUserId])`, `@@index([moimId])`) 추가 | REQ-RPT-001, REQ-RPT-005 | `prisma generate` 타입 반영 확인 |
| M1-3 | Additive 마이그레이션 SQL: `block`·`report` 테이블 `ENABLE ROW LEVEL SECURITY`(정책 없음 = default deny) | REQ-CPL-004, AC-CPL-3 | migration.sql 파일 내 해당 SQL 존재 |
| M1-4 | Additive 마이그레이션 SQL: `report.content_type CHECK IN ('chat_message','poll','expense','settlement_request')` | REQ-RPT-004, AC-RPT-4 | migration.sql 파일 내 CHECK 제약 존재 |
| M1-5 | Additive 마이그레이션 SQL: `report.moim_id → moim(id) ON DELETE CASCADE` FK | REQ-RPT-001, REQ-STO-001 | migration.sql 파일 내 FK 제약 존재 |
| M1-6 | `.moai/project/db/schema.md`에 Block·Report 테이블 추가 문서화(수동 SQL 포함) | REQ-STO-001 | 파일 내용 확인 |
| M1-7 | 비파괴 흐름 준수: 기존 테이블 DROP/ALTER 없음(additive only) | — | migration.sql에 destructive SQL 부재 |

---

### M2 — SafetyService + Controller + Module (T-002/T-003/T-004)

| # | 기준 | REQ/AC | 증거 |
|---|------|--------|------|
| M2-1 | `getHiddenUserIds(sub)`: `block`(blockerId=sub) ∪ `report`(reporterId=sub) union, 중복 제거 string[] 반환 | REQ-CPL-001, AC-CPL-1 | jest: 중복 제거 테스트 PASS |
| M2-2 | `getHiddenUserIds(sub)`: 차단 해제 후에도 report 항이 union에 유지됨 | REQ-BLK-002, AC-BLK-2 | jest: 해제 후 report 항 잔존 테스트 PASS |
| M2-3 | `getBlockersOf(userIds[])`: `block.findMany(blockedUserId in userIds)` — report 항 미포함 | REQ-FLT-006, AC-FLT-6 | jest: report만 있으면 blocker Set 미반환 테스트 PASS |
| M2-4 | `createReport`: content_type 화이트리스트 외 → 400, 빈 reason → 400, **block 행 미생성** | REQ-RPT-001~004, AC-RPT-1/4 | jest: 복합 PK 타입 400 테스트 + block 미생성 검증 PASS |
| M2-5 | `createBlock`: 자기 차단(blocker==blocked) → 400 | REQ-BLK-001, AC-BLK-1 | jest: 자기 차단 400 테스트 PASS |
| M2-6 | `createBlock`: P2002(unique 충돌) → 200 멱등 처리 | REQ-BLK-001, AC-BLK-1 | jest: 2회 연속 호출 모두 성공 테스트 PASS |
| M2-7 | `unblock`: block 행 삭제, report 기반 숨김은 `getHiddenUserIds`에서 불변 | REQ-BLK-002, AC-BLK-2 | jest: 해제 후 getHiddenUserIds 여전히 B 포함 PASS |
| M2-8 | `listBlocks`: block 행만 반환(report 기반 숨김 미포함) | REQ-BLK-004, AC-BLK-3 | jest: listBlocks = block 행만 테스트 PASS |
| M2-9 | 인가: 모든 서비스 메서드가 WHERE 내장(`blockerId==sub`/`reporterId==sub`)으로 판정, body/query 불신 | REQ-CPL-003, AC-CPL-3 | 코드 리뷰: sub가 service 인자로 전달, DTO userId 필드를 WHERE 조건으로 사용 안 함 |
| M2-10 | `SafetyController`: `POST /reports`, `POST /blocks`, `DELETE /blocks/:blockedUserId`, `GET /blocks` — per-route `@UseGuards(SupabaseAuthGuard)` | REQ-CPL-003, AC-CPL-3 | 코드 확인 + controller spec PASS |
| M2-11 | `SafetyModule`이 `BlockService`를 exports | REQ-CPL-002, AC-CPL-2 | 모듈 파일 exports 배열 확인 |
| M2-12 | `app.module.ts`에 `SafetyModule` 등록 | REQ-CPL-002 | app.module.ts imports 배열 확인 |

---

### M3 — 읽기·발신 필터 주입 (T-005/T-006/T-007/T-008)

| # | 기준 | REQ/AC | 증거 |
|---|------|--------|------|
| M3-1 | `chat.service.ts getHistory`: `senderId: { notIn: hiddenIds }` WHERE 적용 | REQ-FLT-001, AC-FLT-1 | jest: hiddenIds에 있는 senderId 메시지 제외 mock 호출 검증 PASS |
| M3-2 | `getHistory` over-fetch/trim: notIn으로 페이지 부족 시 over-fetch 후 trim, 커서는 반환분 마지막 id | REQ-FLT-001, AC-FLT-1(edge R-1) | jest: take=N, hiddenIds=[1개 sender] → 반환 < N이지만 커서 정합 테스트 PASS |
| M3-3 | `chat.service.ts`: `content_id`가 chat_message일 때만 BigInt 캐스팅 | REQ-RPT-005, AC-RPT-4 | 코드 확인 + jest PASS |
| M3-4 | `poll.service.ts listPolls`: `createdBy: { notIn: hiddenIds }` WHERE 적용 | REQ-FLT-002, AC-FLT-2 | jest: hidden poll 제외 mock 호출 검증 PASS |
| M3-5 | `aggregatePolls` 표 집계: hiddenIds 필터 미적용(집계 불변) | REQ-FLT-002, AC-FLT-2 | jest: hidden creator의 표가 집계에 포함됨 PASS |
| M3-6 | `notification.service.ts listForRecipient`: `actorId: { notIn: hiddenIds }` WHERE 적용 | REQ-FLT-005, AC-FLT-5 | jest: hidden actor 알림 제외 PASS |
| M3-7 | actorId null 알림: hiddenIds 필터 통과(자연 통과 — null notIn 미적용) | REQ-FLT-005, AC-FLT-5 | jest: actorId=null 알림 반환 유지 PASS |
| M3-8 | `expense.service.ts listExpenses`: balance/transactions/total 계산은 **전체 expense 원본** 기반 | REQ-FLT-003, AC-FLT-3 | jest: masked expense 포함 계산값 불변 테스트 PASS |
| M3-9 | `listExpenses`: hidden creator의 expense 행 **제거 없이** 작성자 표시만 '차단한 멤버' 마스킹 반환 | REQ-FLT-003, AC-FLT-3 | jest: expense 행 count 불변 + 작성자 필드 마스킹 PASS |
| M3-10 | `listExpenses`: hidden requester의 settlement_request 행도 **제거 없이** 요청자 표시만 마스킹 | REQ-FLT-003, AC-FLT-3 | jest: settlement_request 행 count 불변 + 요청자 마스킹 PASS |
| M3-11 | `listExpenses` 표시 항목 합 == 합계(∑ 정합): 마스킹 후에도 표시된 expense 항목 금액 합 = total | REQ-FLT-003, AC-FLT-3(edge R-2) | jest: sum(expenses.amount) == response.total 검증 PASS |
| M3-12 | `schedule.service.ts getSchedule`: `event.slots`에서 `userId notIn hiddenIds` 슬롯 제외(응답 매핑 시점) | REQ-FLT-004, AC-FLT-4 | jest: hidden userId 슬롯 제외 PASS |
| M3-13 | `getSchedule`: dates/window 협업 편집 필드는 필터 없음(한계 — 무변경) | REQ-FLT-004, AC-FLT-4 | jest: dates/window 필드 값 불변 PASS |
| M3-14 | `push.listener.ts handleChatMessageCreated`: `getBlockersOf([senderId])` 역방향 차감 — blocker recipient FCM 미발신 | REQ-FLT-006, AC-FLT-6 | jest: block 시 recipient 차감 mock 호출 검증 PASS |
| M3-15 | push.listener: report만 있고 block 없으면 push 유지(report ≠ push 억제) | REQ-FLT-006, AC-FLT-6 | jest: report-only → recipientUserIds 미차감 PASS |
| M3-16 | push.listener: safety 조회 실패해도 발송 차단 없음(best-effort try/catch 내부) | REQ-FLT-006 | jest: getBlockersOf throw → FCM 정상 발송(차단 없음) PASS |
| M3-17 | 각 소비 `*.module.ts` + `push.module.ts`에 `SafetyModule` import 추가 | REQ-CPL-002, AC-CPL-2 | 모듈 파일 imports 배열 확인(6개 모듈) |

---

### M4 — 웹 UI (T-009)

| # | 기준 | REQ/AC | 증거 |
|---|------|--------|------|
| M4-1 | 채팅 말풍선 신고 진입: 사유 입력 → `POST /reports` 호출(report만, block 미생성) | REQ-RPT-001~003, AC-RPT-1/2 | `nx run web:build` 0 error |
| M4-2 | 신고 성공 후 "이 멤버를 차단할까요?" 유도(prompt) → 수락 시에만 `POST /blocks` 별도 호출 | REQ-RPT-003, AC-RPT-3 | `nx run web:build` + 코드 확인 |
| M4-3 | 채팅: 신고/차단 액션 후 `setMessages([])` + 히스토리 재조회(수동 무효화) | REQ-FLT-001, R-5 | `nx run web:build` + 코드 확인 |
| M4-4 | 채팅 `handleIncoming`: 마운트 시 hidden 목록 로드 → 신규 메시지 append 전 `hiddenUserIds.has(senderId)` 드롭 | REQ-FLT-001(클라), AC-FLT-1 | `nx run web:build` + 코드 확인 |
| M4-5 | 멤버 목록: 차단 버튼(본인 제외 전 멤버, owner showControls 밖) + 확인 다이얼로그 + `blockAction`(revalidatePath) | REQ-BLK-001, REQ-BLK-005, AC-BLK-1/3 | `nx run web:build` 0 error |
| M4-6 | 프로필 "차단한 멤버" 섹션: `GET /blocks` 조회 + 해제 Server Action(전용 라우트 미신설) | REQ-BLK-004, AC-BLK-3 | `nx run web:build` 0 error |
| M4-7 | `apps/web/lib/safety/*` fetch 헬퍼 신규 생성 | REQ-CPL-001 | 파일 존재 확인 |
| M4-8 | `nx lint web` 0 error | — | lint 출력 확인 |

---

### M5 — 계약 재생성 + 정적 검사 + 문서 (T-010)

| # | 기준 | REQ/AC | 증거 |
|---|------|--------|------|
| M5-1 | `openapi.json` 재생성 + `packages/api-client/src/schema.d.ts` 재생성 | — | 파일 변경 확인 |
| M5-2 | typecheck 통과(tsc 0 error) | REQ-CPL-002 | tsc 출력 확인 |
| M5-3 | 비순환 grep: `apps/backend/src/safety/**`에서 chat/poll/expense/schedule/notification/push 도메인 import 없음 | REQ-CPL-002, AC-CPL-2 | grep 출력: 결과 없음 |
| M5-4 | 운영 절차 문서: 신고 수동 DB 조회 검토 + 24h 조치 절차(코드 없음) | REQ-STO-001, REQ-STO-002, AC-STO-1 | 문서 파일 존재 + 내용 확인 |
| M5-5 | `nx lint backend` clean(0 error) | — | lint 출력 확인 |
| M5-6 | jest 커버리지 85%+ (safety 모듈 신규 코드 기준) | — | jest --coverage 출력 확인 |
| M5-7 | 고아 정리 위임 통지: ACCOUNT-001 `deleteAccount`에 block/report deleteMany 추가 위임 문구 기록 | REQ-STO-001, R-10 | 문서/주석 확인 |

---

## 3. 반드시 커버해야 할 엣지 케이스 (plan 리스크 기반 + evaluator 추가)

아래 케이스는 jest 테스트로 반드시 구현해야 한다. 테스트 없이 "동작한다"는 주장을 평가자는 인정하지 않는다.

### E-1 [plan R-1] keyset 페이지 축소 with notIn → over-fetch + trim
- 시나리오: `getHistory(take=10, hiddenIds=[userB])`, DB에 14개 메시지 중 userB 3개 포함 → DB 쿼리는 N+α 요청, 최종 반환은 10개 trim, 커서는 반환분 마지막 id
- 검증: 반환 메시지 count=10, 커서=반환분 마지막 id
- **[ADDED BY EVALUATOR]** 추가 케이스: hiddenIds=[] (차단 없음) 시 일반 keyset 페이지네이션 동작 불변

### E-2 [plan R-2] 지출 계산 오염 방지 (expense-calculation contamination)
- 시나리오: hiddenIds=[userB], expense E1(createdBy=userB, amount=5000), E2(createdBy=userC, amount=3000), total=8000
- 검증: 계산 balance/total=8000 불변, E1 행 유지(미제거), E1 createdBy='차단한 멤버' 마스킹
- **[ADDED BY EVALUATOR]** 추가 케이스: settlement_request(requester=userB)도 동일 로직 적용 — 행 유지 + requester 마스킹, 정산 합계 불변
- **[ADDED BY EVALUATOR]** ∑ 정합: 표시된 expense 항목 금액 합 == response.total (마스킹 후 금액은 변경하지 않음)

### E-3 [plan R-3] 채팅 서버·클라이언트 2-layer 필터 계층 불일치
- 시나리오: T-005(서버 히스토리 필터)와 T-009(클라이언트 실시간 필터)는 반드시 짝으로 구현
- 검증: 서버 필터만 있으면 실시간 신규 메시지에서 차단 대상 메시지 노출(계약 위반)
- **평가 방법**: T-005 구현 증거(jest) + T-009 구현 증거(빌드/코드 확인) 모두 필요

### E-4 [plan R-14] FCM 역방향 차감 — block만, report는 미억제
- 시나리오 A: A→B block + B 채팅 발신 → A FCM 미발신
- 시나리오 B: A→B report만(block 없음) + B 채팅 발신 → A FCM 유지(report는 push 억제 안 함)
- 검증: 두 시나리오 모두 jest 검증 필수(대조 케이스 존재해야 함)

### E-5 [plan R-8] 모듈 경계 비순환 정적 검사
- 검증: `grep -r "from.*chat\|from.*poll\|from.*expense\|from.*schedule\|from.*notification\|from.*push" apps/backend/src/safety/` → 결과 0건
- **[ADDED BY EVALUATOR]** push→safety 단방향: `grep -r "from.*safety" apps/backend/src/push/` → BlockService import 존재 확인(단방향 허용)

### E-6 [ADDED BY EVALUATOR] getHiddenUserIds 중복 제거
- 시나리오: A가 B를 block하고 동시에 report한 경우
- 검증: `getHiddenUserIds(A)` 결과에 B가 1번만 등장(Set/unique 처리)

### E-7 [ADDED BY EVALUATOR] block+unblock 사이클에서 report 숨김 불변
- 시나리오: A→B report, A→B block 생성, A→B unblock(block 삭제)
- 검증: unblock 후 `getHiddenUserIds(A)`에 B가 여전히 포함(report 항 불변)
- 검증: unblock 후 `listBlocks(A)`에 B 미포함(block 행 삭제 확인)

### E-8 [ADDED BY EVALUATOR] actorId null 알림 통과
- 시나리오: hiddenIds=[userB], 알림 a1(actorId=userB), a2(actorId=null)
- 검증: listForRecipient 결과에 a2 포함, a1 미포함(null은 notIn 조건 통과)

### E-9 [ADDED BY EVALUATOR] RLS default-deny 검증
- DB 레벨: `block`·`report` 테이블에 ENABLE ROW LEVEL SECURITY + 정책 없음
- 검증: migration.sql 파일에 `ENABLE ROW LEVEL SECURITY` 문 존재, `CREATE POLICY` 문 부재
- 의미: PostgREST 직접 접근 불가(NestJS 경유만 허용)

### E-10 [ADDED BY EVALUATOR] schedule 슬롯 제거, dates/window 무변경
- 시나리오: getSchedule, event에 userB 슬롯 3개 + dates/window(collaboratively edited)
- 검증: 응답 slots에서 userB 슬롯 미존재, dates/window 값 원본 불변

---

## 4. 하드 임계값 (Hard Thresholds)

| 항목 | 임계값 | 판정 조건 |
|------|--------|-----------|
| 백엔드 jest 커버리지 (safety 모듈 신규 코드) | **85%+** | `jest --coverage` 출력 확인 — 미달 시 FAIL |
| `nx lint backend` | **0 error** | lint 출력 확인 — 1건 이상 시 FAIL |
| TypeScript type errors | **0** | tsc 출력 확인 — 1건 이상 시 FAIL |
| `nx run web:build` | **0 error** | build 출력 확인 — 1건 이상 시 FAIL |
| `nx lint web` | **0 error** | lint 출력 확인 — 1건 이상 시 FAIL |
| jest fake 패턴 | `Promise.resolve/reject` 사용 | `jest.fn(() => Promise.resolve(...))` — sync return 사용 시 FAIL |
| unknown 타입 검증 | 명시 캐스팅 필수 | bare catch(e) 사용 또는 unknown → any 캐스팅 시 warning |
| 비순환 grep 결과 | **0건** | safety→도메인 import grep 결과 — 1건 이상 시 FAIL |

---

## 5. 평가 규칙 (Scoring Rules)

1. **평가자는 이 계약에 없는 기준으로 점수를 매기지 않는다.** 구현자가 이 계약 외 기능을 추가해도 가산점 없음.
2. **구현자는 증거 없이 기준 충족을 주장할 수 없다.** 각 체크리스트 항목에 대해 지정된 증거(jest PASS, lint 출력, 파일 확인)가 필요하다.
3. **하드 임계값은 절대적이다.** 임계값 미달 시 다른 차원의 높은 점수로 상쇄 불가.
4. **엣지 케이스 E-1~E-10은 선택이 아니다.** 특히 E-2(지출 계산 오염), E-3(2-layer 계층 불일치), E-4(FCM report 비억제 대조 케이스)는 미구현 시 해당 REQ가 FAIL 처리된다.
5. **MX 태그(plan §8)**: `@MX:ANCHOR` 2개(`getHiddenUserIds`, `getBlockersOf`) + `@MX:WARN`(expense 계산/표시 분리 지점) + `@MX:NOTE` 4개는 구현 완료로 인정받기 위한 필수 항목은 아니나, Craft 차원 점수에 반영한다.

---

## 6. 제외 명시 (Out of Contract Scope)

아래 항목은 이 계약에서 평가하지 않는다(SPEC 제외 범위 §9 참조):
- 관리자 UI / 자동 모더레이션
- poll/expense/settlement_request 신고 진입점 웹 UI (백엔드 수용 여부는 별개)
- 양방향 차단
- 일정 dates/window 협업 편집 필터
- 차단 전 발송된 push 리보크
- notification fan-out 발신 시점 역방향 차감(읽기 경로 커버)
- 모바일 네이티브 변경
- SPEC-ACCOUNT-001 deleteAccount 트랜잭션 직접 수정 (위임 통지만 필요)

---

> Contract version: 1.0 | Evaluator: evaluator-active | Date: 2026-07-02
> 다음 평가 단계: Phase 2.8a post-implementation evaluation (harness=thorough)
