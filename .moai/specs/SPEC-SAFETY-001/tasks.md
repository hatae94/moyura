# Task Decomposition — SPEC-SAFETY-001

SPEC: SPEC-SAFETY-001 (신고·차단 — UGC 모더레이션)
Mode: TDD (RED-GREEN-REFACTOR, backend test-first) / web = `next build` + lint only (no test harness)
Harness: thorough · Scale: Full Pipeline

> 마일스톤 매핑: M1→T-001 · M2→T-002/T-003/T-004 · M3→T-005/T-006/T-007/T-008 · M4→T-009 · M5→T-010
> 게이트(전 백엔드 태스크 공통): `nx lint backend` clean, jest fake는 `Promise.resolve/reject`, unknown 검증은 명시 캐스팅.

## Task Table

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | DB 데이터 모델: `Block`(복합 PK, `@@index([blockerId])`+`@@index([blockedUserId])`) + `Report`(uuid PK, TEXT soft-ref) 추가 → additive 마이그레이션. 수동 SQL: `block`·`report` RLS enable(정책 없음=default deny), `report.content_type` CHECK(4종), `report.moim_id` FK CASCADE. `.moai/project/db/`에 스키마 문서화(add_notification 선례). 검증: `prisma migrate` + `prisma generate` 성공, 비파괴 흐름 준수. | REQ-RPT-001, REQ-RPT-004, REQ-RPT-005, REQ-BLK-001, REQ-CPL-004, REQ-STO-001 | — | `apps/backend/prisma/schema.prisma` [MODIFY], `apps/backend/prisma/migrations/<ts>_add_safety/migration.sql` [NEW], `.moai/project/db/schema.md` [MODIFY] | complete |
| T-002 | SafetyService 조회 계약(ANCHOR 2종) jest test-first: `getHiddenUserIds(sub)` = block(blockerId=sub→blockedUserId) ∪ report(reporterId=sub→targetUserId) 중복 제거 string[](요청당 1회, N+1 회피); `getBlockersOf(userIds[])` = `block.findMany({where:{blockedUserId:{in}}})` → blocker Set(**block만**, report 미포함). 테스트: union 중복 제거·차단 해제가 report 항 불변·getBlockersOf가 report 무시. | REQ-CPL-001, REQ-RPT-002, REQ-BLK-003, REQ-FLT-006 | T-001 | `apps/backend/src/safety/safety.service.ts` [NEW], `apps/backend/src/safety/safety.service.spec.ts` [NEW] | complete |
| T-003 | SafetyService 변이 4종 jest test-first: `createReport`(content_type 화이트리스트 미지 400·빈 reason 400·**block 미생성**), `createBlock`(자기 차단 400·멱등 P2002→200), `unblock`(없는 행 멱등·**report 숨김 불변**), `listBlocks`(block 행만, 신고 숨김 별도). 인가 = WHERE 내장(`reporterId==sub`/`blockerId==sub`, body 불신). | REQ-RPT-001, REQ-RPT-003, REQ-RPT-004, REQ-BLK-001, REQ-BLK-002, REQ-BLK-004, REQ-CPL-003 | T-001 | `apps/backend/src/safety/safety.service.ts` [MODIFY], `apps/backend/src/safety/safety.service.spec.ts` [MODIFY], `apps/backend/src/safety/dto/*.dto.ts` [NEW] | complete |
| T-004 | SafetyController(per-route `@UseGuards(SupabaseAuthGuard)` + 명시적 검증 헬퍼, notification.controller 스타일) — `POST /reports`·`POST /blocks`·`DELETE /blocks/:blockedUserId`·`GET /blocks`. `SafetyModule`(AuthModule import, `BlockService` **exports**). `app.module.ts`에 SafetyModule 등록(PushModule 뒤). 검증: 라우트·export 배선, 컨트롤러 spec 최소. | REQ-CPL-002, REQ-CPL-003, REQ-BLK-004 | T-002, T-003 | `apps/backend/src/safety/safety.controller.ts` [NEW], `apps/backend/src/safety/safety.controller.spec.ts` [NEW], `apps/backend/src/safety/safety.module.ts` [NEW], `apps/backend/src/app.module.ts` [MODIFY] | complete |
| T-005 | 읽기 필터(단순 notIn-in-where 3곳) jest test-first: chat `getHistory` where에 `senderId:{notIn:hiddenIds}`(**over-fetch 후 trim**로 keyset 페이지 크기 보존, `content_id`가 chat일 때만 BigInt 캐스팅) + poll `listPolls` where에 `createdBy:{notIn}`(**aggregatePolls 표 집계 불변**) + notification `listForRecipient` where에 `actorId:{notIn}`(actorId null 자연 통과). 각 소비 `*.module.ts`에 SafetyModule import(BlockService 주입). 테스트: hidden 목록이 where에 반영(mock 호출 검증) + 집계 불변 + trim 페이지 크기. | REQ-FLT-001(서버), REQ-FLT-002, REQ-FLT-005, REQ-RPT-005, REQ-CPL-002 | T-004 | `apps/backend/src/chat/chat.service.ts` [MODIFY], `apps/backend/src/chat/chat.service.spec.ts` [MODIFY], `apps/backend/src/chat/chat.module.ts` [MODIFY], `apps/backend/src/poll/poll.service.ts` [MODIFY], `apps/backend/src/poll/poll.service.spec.ts` [MODIFY], `apps/backend/src/poll/poll.module.ts` [MODIFY], `apps/backend/src/notification/notification.service.ts` [MODIFY], `apps/backend/src/notification/notification.service.spec.ts` [MODIFY], `apps/backend/src/notification/notification.module.ts` [MODIFY] | complete |
| T-006 | 읽기 필터(지출·정산 — 행 유지 + 작성자 마스킹) jest test-first: `listExpenses` **계산=전체 원본**(balance/transactions/total 불변) vs **표시=행 유지 + `createdBy∈hiddenIds`인 expense 작성자 + `requester_id∈hiddenIds`인 settlement_request 요청자를 '차단한 멤버'로 마스킹**. [WARN] 마스킹을 계산 입력에 적용 금지 — 표시 반환 직전만. 선행 확인: `listExpenses` 반환 shape에 settlement_request 행 포함 여부. 테스트: 정산 수치 불변 + 차단 대상 행 유지 + 작성자만 마스킹 + 표시 항목 합=합계 정합. **선행 확인 결과: `listExpenses` 반환 shape는 settlement_request 행을 포함하지 않음(SettlementRequest는 requestSettlement create 전용, 읽기 경로 없음) → 요청자 마스킹은 이 표면에서 vacuous(마스킹 대상 부재). expense 작성자(createdBy) 마스킹만 실구현.** | REQ-FLT-003 | T-004 | `apps/backend/src/expense/expense.service.ts` [MODIFY], `apps/backend/src/expense/expense.service.spec.ts` [MODIFY], `apps/backend/src/expense/expense.module.ts` [MODIFY] | complete |
| T-007 | 읽기 필터(일정 슬롯 — 중첩 배열 필터) jest test-first: `getSchedule`는 `include:{slots:true}`로 슬롯을 이벤트에 중첩 로드하므로 top-level where가 아니라 **응답 매핑 시 `event.slots`를 `userId notIn hiddenIds`로 제외**. dates/window 협업 편집은 작성자 추적 없어 필터 불가(한계 명시). 테스트: 차단 대상 슬롯 제외 + dates/window 무변경. | REQ-FLT-004 | T-004 | `apps/backend/src/schedule/schedule.service.ts` [MODIFY], `apps/backend/src/schedule/schedule.service.spec.ts` [MODIFY], `apps/backend/src/schedule/schedule.module.ts` [MODIFY] | complete |
| T-008 | 발신 역방향 필터(REQ-FLT-006) jest test-first: `push.listener.ts` `handleChatMessageCreated` 수신자 산정(`recipientUserIds` = moim_member − sender) 직후 `getBlockersOf([senderId])` 반환 blocker에 속한 recipient 차감(A가 sender B 차단 → A FCM 미발신). **best-effort try/catch 내부**(safety 조회 실패가 발송 미차단). `push.module.ts`에 SafetyModule import. 테스트: block 시 차감 + **report만 있고 block 없으면 push 유지**(report는 push 억제 안 함). | REQ-FLT-006 | T-004 | `apps/backend/src/push/push.listener.ts` [MODIFY], `apps/backend/src/push/push.listener.spec.ts` [MODIFY], `apps/backend/src/push/push.module.ts` [MODIFY] | complete |
| T-009 | 웹 UI(build/lint 검증만 — 테스트 하네스 부재): 신고 플로우(**채팅 말풍선 진입 한정** — poll/expense UI는 v1 제외) 사유 폼 + `POST /reports`(report만, **block 미생성**) + "이 멤버를 차단할까요?" 유도(prompt) + **수락 시에만** `POST /blocks`(REQ-RPT-003) + 채팅 `setMessages([])`+재조회; 멤버 목록 차단 버튼(본인 제외 전 멤버, owner `showControls` 밖) + 확인 다이얼로그 + `blockAction`(revalidatePath); 프로필 "차단한 멤버" 섹션(`GET /blocks` + 해제 Server Action, 멤버 목록엔 닉네임 보존 노출 유지); 채팅 `handleIncoming` 클라이언트 실시간 필터(hidden=block∪report, 미지 발신자 재조회 경로 동일 검사). `apps/web/lib/safety/*` fetch 헬퍼(polls.ts 미러). 검증: `nx run web:build` + `nx lint web` 0 error. | REQ-RPT-002, REQ-RPT-003, REQ-BLK-001, REQ-BLK-004, REQ-BLK-005, REQ-FLT-001(클라) | T-004 | `apps/web/app/moims/[id]/chat/page.tsx` [MODIFY], `apps/web/app/(main)/home/[id]/members-section.tsx` [MODIFY], `apps/web/app/(main)/home/[id]/member-actions.ts` [MODIFY], `apps/web/app/(main)/profile/**` [MODIFY], `apps/web/lib/safety/*` [NEW] | complete |
| T-010 | 계약 재생성 + 정적 검사 + 문서 + 위임: `openapi.ts` emit → `openapi.json` → api-client `schema.d.ts` 재생성 + typecheck; 느슨한 결합 grep(safety ↛ chat/poll/expense/schedule/notification/push — push→safety 단방향만); 운영 절차 문서(신고 수동 DB 조회 검토 + 24h 조치 절차, 코드 없음); **고아 정리 위임 통지**(ACCOUNT-001 `deleteAccount`에 block/report `deleteMany` 2줄 — SAFETY 테이블 선행 병합 전제, prisma 직접 접근으로 순환 회피). 최종 게이트: `nx lint backend` + jest 85%+. | REQ-CPL-002, REQ-STO-001, REQ-STO-002 | T-004, T-005, T-006, T-007, T-008 | `apps/backend/openapi.json` [REGEN], `packages/api-client/src/schema.d.ts` [REGEN], `.moai/project/` 운영 문서 [NEW] | complete |

## 실행 순서 (의존성 그래프)

```
T-001 (schema/migration — 기반)
  ├─ T-002 (조회 계약: getHiddenUserIds / getBlockersOf)
  └─ T-003 (변이: createReport / createBlock / unblock / listBlocks)
        └─ T-004 (Controller + Module export + app.module 등록)
              ├─ T-005 (읽기 필터: chat + poll + notification)
              ├─ T-006 (읽기 필터: expense/settlement 마스킹)
              ├─ T-007 (읽기 필터: schedule 슬롯)
              ├─ T-008 (발신 역방향: push.listener)
              └─ T-009 (웹 UI — API 소비)
                    ... (T-005~T-008 모두 완료)
                          └─ T-010 (계약 재생성 + grep + 문서 + 위임 + 최종 게이트)
```

T-005·T-006·T-007·T-008·T-009는 T-004 완료 후 상호 독립(병렬 가능, 단 파일 겹침 없음 — 각 도메인 격리). T-010은 백엔드 전 태스크(T-004~T-008) 완료 후 실행.

## 마일스톤별 TDD 테스트 전략

- **M1(T-001)**: 스키마·마이그레이션은 TDD 대상 아님 — `prisma migrate` 성공 + `prisma generate` 타입 반영 + 비파괴 흐름으로 검증.
- **M2(T-002/T-003/T-004)**: fake Prisma(Map/배열, jest.fn+`Promise.resolve/reject`, notification.service.spec 패턴). RED: 계약별 실패 테스트(union 중복 제거, 자기 차단 400, 멱등, report 숨김 불변, block 미생성) → GREEN: 최소 구현 → REFACTOR.
- **M3(T-005~T-008)**: 서비스별 "hidden 목록이 where절에 반영"을 mock 호출 검증(notification.service.spec:193 스타일). expense는 계산/표시 분리 정합, chat은 over-fetch/trim 페이지 크기, push는 block-only 억제·report 유지 대조 케이스.
- **M4(T-009)**: 테스트 없음 — `nx run web:build` + `nx lint web` 0 error로만 검증. 채팅 서버(T-005)·클라(T-009) 필터는 반드시 짝으로 완료(계층 정합).
- **M5(T-010)**: grep 정적 검사 + typecheck + 커버리지 85% + lint clean 게이트.

## 리스크 → 태스크 배정

| 리스크 | 태스크 | 완화 |
|--------|--------|------|
| R-2 지출 계산 오염(정산 뷰어별 상이) | T-006 | 계산=전체 원본, 마스킹은 표시 반환 직전만. 항목 합=합계 테스트. WARN 태그. |
| R-3 채팅 서버·클라 계층 불일치 | T-005+T-009 | 두 경로 반드시 짝 구현(AC-FLT-1 양경로). 웹은 무테스트라 추가 검토. |
| R-1 keyset 페이지 축소(notIn) | T-005 | over-fetch 후 trim, 커서=반환분 마지막 id. |
| R-14 FCM 발신 차단 우회 | T-008 | getBlockersOf 역방향 차감(block만, report 유지). best-effort try/catch. |
| R-8 순환 의존(safety↔도메인) | T-004+T-010 | 단방향 배선 + grep 정적 검사. |

## Requirement → Task Coverage Map

- REQ-RPT-001 → T-001, T-003
- REQ-RPT-002 → T-002, T-003, T-009
- REQ-RPT-003 → T-003, T-009
- REQ-RPT-004 → T-001, T-003
- REQ-RPT-005 → T-001, T-005
- REQ-BLK-001 → T-001, T-003, T-009
- REQ-BLK-002 → T-003
- REQ-BLK-003 → T-002, T-003
- REQ-BLK-004 → T-003, T-004, T-009
- REQ-BLK-005 → T-009
- REQ-FLT-001 → T-005(서버), T-009(클라)
- REQ-FLT-002 → T-005
- REQ-FLT-003 → T-006
- REQ-FLT-004 → T-007
- REQ-FLT-005 → T-005
- REQ-FLT-006 → T-002, T-008
- REQ-CPL-001 → T-002
- REQ-CPL-002 → T-004, T-005, T-010
- REQ-CPL-003 → T-003, T-004
- REQ-CPL-004 → T-001
- REQ-STO-001 → T-001, T-010
- REQ-STO-002 → T-010

모든 21개 REQ가 ≥1 태스크로 커버됨. 5개 수락 모듈(RPT/BLK/FLT/CPL/STO) 전체 매핑 완료.

coverage_verified: true
