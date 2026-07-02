# Plan — SPEC-SAFETY-001 (신고·차단 — UGC 모더레이션)

> 조사: [research.md](./research.md) | 인터뷰: [interview.md](./interview.md)
> 확정 범위: 신고 사유 저장 + 신고자 측 즉시 숨김(report 소스) + 신고 후 차단 유도(prompt), 차단은 뷰어 측 1-way UGC 숨김(내 화면에서만) + 발신(FCM push) 역방향 억제, 진입점 = 신고 플로우 + 멤버 목록, 신고·차단 독립, 관리자 UI 없음.
> 교차-SPEC 결정(수정 반영): (1) 신고 ≠ 차단 — block은 prompt 수락 시에만 생성, 필터는 `getHiddenUserIds`가 block∪report union으로 흡수(R-7 해소). (2) FCM push 발신 경로 차단 우회 차단 — `push.listener.ts` 수신자 역방향 차감(REQ-FLT-006, R-14). (3) block/report 고아 행 정리 = SPEC-ACCOUNT-001 소유 확정(§3.5, R-10 상호 위임 홀 해소).

---

## 1. 개요 + 정책 근거

스토어 출시(App Store / Google Play)를 위한 UGC 모더레이션 최소 요건 대응. 삭제·익명화가 아닌 **뷰어 측 필터링**(서버 쿼리 필터 + 클라이언트 실시간 필터)으로 신고·차단을 구현한다. 콘텐츠는 전역적으로 보존되며, 차단자 본인 화면에서만 숨겨진다(per-viewer, 1-way).

### 정책 요건 → 설계 매핑

| 스토어 요건 | 근거 | 본 SPEC 대응 |
|---|---|---|
| 콘텐츠 신고 메커니즘 | Apple 1.2, Google Play UGC | `report` 테이블 저장 + `POST /reports`(모듈 1). 신고 즉시 신고자 화면에서 대상 콘텐츠 숨김(report 소스 — block 미생성, 신고·차단 독립). |
| 가해 사용자 차단 수단 | Apple 1.2, Google Play UGC | `block` 테이블 + 뷰어 측 UGC 전면 필터(모듈 2·3). 진입점 = 신고 후 유도 + 멤버 목록. |
| 게시된 모더레이션/연락 프로세스 | Apple 1.2 | 운영 문서화(24시간 내 조치는 DB 조회 기반 수동 프로세스로 대응 — 모듈 5, 문서 산출물). |
| 24시간 내 조치 약속 | Apple 1.2 | 관리자 UI는 범위 제외. `report` 저장분을 운영자가 수동 DB 조회로 검토하는 절차를 **문서로** 기술(코드 없음). |
| 인앱 계정 삭제 | Apple 5.1.1(v), Google Play | **본 SPEC 범위 밖** — [SPEC-ACCOUNT-001](../SPEC-ACCOUNT-001/) 소관(제외 범위 참조). |

---

## 2. EARS 요구사항 설계 (모듈 개수 5개 — spec.md §5와 동일 한도)

### 모듈 1 — REQ-RPT (신고)

- **REQ-RPT-001** [Event-driven] When 사용자가 특정 UGC 항목을 사유와 함께 신고하면, the system shall `report` 행(reporter_id, target_user_id, moim_id, reason, content_type, content_id)을 저장한다. (AC 참조)
- **REQ-RPT-002** [Event-driven] When 신고가 접수되면, the system shall 신고자 본인 화면에서 해당 콘텐츠(및 동일 작성자 UGC)를 즉시 숨긴다. **이 숨김은 `block` 행 생성과 분리된다** — 숨김의 진실 공급원은 `report`(reporterId=sub → targetUserId)이며, 신고만으로는 `block` 행을 생성하지 않는다(신고·차단 독립 유지). 뷰어 측 필터는 block 목록과 report 기반 숨김 목록을 **union**해 적용한다(REQ-CPL-001 참조). *결정 확정(구 열린 질문 §10-1 해소): 신고 ≠ 차단. 신고는 저장 + 신고자 측 숨김 + 차단 유도(prompt)까지만이고, 실제 `block` 행은 REQ-RPT-003의 사용자 수락 시에만 생성된다.*
- **REQ-RPT-003** [Event-driven] When 신고가 성공하면, the system shall 신고자에게 "이 멤버를 차단할까요?" 후속 **유도(prompt)**를 노출한다. If 신고자가 이를 수락하면, then the system shall 이 시점에 비로소 `block` 행을 생성한다(REQ-BLK-001 재사용). If 거부하면, then 신고자 측 숨김(report 기반)은 유지되되 `block` 행은 생성되지 않는다.
- **REQ-RPT-004** [Unwanted] If 신고 대상이 복합 PK 콘텐츠(poll_vote / expense_share / schedule_slot)이면, then the system shall 신고를 거부한다(400) — 단일 PK 콘텐츠만 신고 대상.
- **REQ-RPT-005** [Ubiquitous] The system shall `report.content_id`를 TEXT로 저장하고, content_type이 `chat_message`일 때만 필터 시 BigInt로 캐스팅한다.

### 모듈 2 — REQ-BLK (차단)

- **REQ-BLK-001** [Event-driven] When 사용자가 멤버 목록 또는 신고 후 안내에서 특정 멤버를 차단하면, the system shall `block(blocker_id, blocked_user_id)` 행을 생성한다(멱등 — 이미 존재 시 성공 유지).
- **REQ-BLK-002** [Event-driven] When 사용자가 차단을 해제하면, the system shall 해당 `block` 행을 삭제한다.
- **REQ-BLK-003** [Ubiquitous] The system shall 차단 매칭 키로 `userId`(sub)만 사용한다(profile/nickname 무관 — 게스트·명명 계정 동일 취급).
- **REQ-BLK-004** [Ubiquitous] The system shall 기존 프로필/설정 화면 내 "차단한 멤버" 섹션에서 내 차단 목록 조회 + 차단 해제 수단을 제공한다(전용 라우트 미신설 — 최소 배치). 섹션 위치는 배치 제약이지 기능 존재 조건이 아니다. *결정 확정(구 열린 질문 §10-2 해소).*
- **REQ-BLK-005** [State-driven] While 차단이 활성인 동안, the system shall 차단 대상 멤버를 멤버 목록에는 그대로 노출한다(차단 해제 진입점 겸용 — 닉네임 보존).

### 모듈 3 — REQ-FLT (뷰어 측 필터)

- **REQ-FLT-001** [State-driven] While 멤버 B가 사용자 A에게 차단된 동안, the system shall A의 채팅 히스토리 응답에서 B의 메시지를 서버 쿼리로 제외하고(`senderId notIn`), A의 실시간 신규 메시지도 클라이언트에서 드롭한다(서버·클라이언트 동시).
- **REQ-FLT-002** [State-driven] While B가 A에게 차단된 동안, the system shall A의 투표 목록에서 B가 생성한 poll을 제외한다. 단, **표 집계 수치는 변경하지 않는다**(익명 집계 유지).
- **REQ-FLT-003** [State-driven] While B가 A에게 차단된 동안, the system shall A의 지출 **표시 목록**에서 B가 만든 expense 행 및 B가 요청자(`requester_id`)인 settlement_request 행을 제거하지 않고 **작성자/요청자 표시만 '차단한 멤버'로 마스킹**한다(금액·정산 무결성 유지). settlement_request도 신고 대상 타입이고 expenses-view 동일 표면에서 렌더되므로 expense와 동일 규칙 적용. 단, **정산 계산·합계(balance/transactions/total)에는 원본 그대로 포함**한다(원장 정합성 우선). *결정 확정(구 열린 질문 §10-1 해소): 완전 숨김이 아니라 행 유지 + 작성자 마스킹 — 표시 목록의 항목 합과 합계가 어긋나지 않도록.*
- **REQ-FLT-004** [State-driven] While B가 A에게 차단된 동안, the system shall A의 일정 히트맵 응답에서 B의 `schedule_slot`을 제외한다. dates/window 협업 편집은 작성자 추적이 없어 필터 불가(한계 명시).
- **REQ-FLT-005** [State-driven] While B가 A에게 차단된 동안, the system shall A의 알림 피드에서 `actor_id == B`인 알림을 제외한다(시스템 알림·actor 없는 알림은 무관).
- **REQ-FLT-006** [State-driven] While B가 A에게 차단된 동안(A가 B를 차단), the system shall B가 발신한 채팅 메시지의 **FCM 푸시 수신 대상에서 A를 제외**한다 — 차단 대상의 UGC(메시지 미리보기)가 A의 잠금화면에 도달하지 않도록 한다. 발신 경로 필터는 **역방향**(recipient가 sender를 차단)이며, `push.listener.ts`의 수신자 산정(moim_member − sender)에서 `getBlockersOf([senderId])`가 반환한 blocker 집합에 속한 수신자를 차감한다(§3.2). 이 발신 경로는 `getHiddenUserIds`(block∪report union, 읽기 경로용)를 사용하지 **않는다** — 신고 기반 숨김(report)은 이 발신 경로에 **적용하지 않으며**(신고자는 push 억제를 기대하지 않음), 오직 명시적 `block`만 push를 억제한다.

### 모듈 4 — REQ-CPL (모듈 경계 · 인가)

- **REQ-CPL-001** [Ubiquitous] The system shall 신규 `safety` 모듈에 신고·차단 도메인을 격리하고, `BlockService.getHiddenUserIds(sub)`를 뷰어 측 필터 주입의 단일 출처로 제공한다. 이 메서드는 `block`(blockerId=sub → blockedUserId)과 `report`(reporterId=sub → targetUserId)를 **union**해 "이 뷰어에게 숨겨야 할 userId 집합"을 반환한다(신고자 측 숨김 = report 소스, 차단 숨김 = block 소스 — 두 소스는 독립이며 차단 해제가 신고 숨김을 되살리지 않는다).
- **REQ-CPL-002** [Ubiquitous] The system shall safety 모듈이 생산 도메인(chat/poll/expense/schedule/notification/push)을 import하지 않도록 유지한다(비순환 — 소비 도메인이 `BlockService`를 import).
- **REQ-CPL-003** [Ubiquitous] The system shall 차단/신고 인가를 서비스 WHERE절의 `blockerId == sub` / `reporterId == sub` 내장으로 판정한다(notification 선례 — 컨트롤러 body/query 불신).
- **REQ-CPL-004** [Ubiquitous] The system shall `block`·`report` 테이블에 RLS enable + 정책 없음(default deny)을 적용해 PostgREST 직독을 차단한다.

### 모듈 5 — REQ-STO (스토어 정책 준수)

- **REQ-STO-001** [Ubiquitous] The system shall 신고 데이터를 운영자가 수동 DB 조회로 검토할 수 있도록 `report`에 검토에 필요한 필드(대상 유저·모임·사유·콘텐츠 참조·시각)를 보존한다.
- **REQ-STO-002** [Ubiquitous] The system shall 24시간 내 조치 요건을 **운영 절차 문서**로 대응한다(관리자 UI·자동 워크플로우는 미구축).

---

## 3. 기술 설계

### 3.1 DB 스키마 (additive 마이그레이션)

비파괴 additive 마이그레이션 1개(`YYYYMMDD000000_add_safety`). notification 선례(`20260701200000_add_notification`)의 RLS default-deny 패턴을 답습. user 참조 컬럼은 코드베이스 컨벤션대로 **FK 없는 TEXT soft-ref**(profile 삭제/게스트 무관).

**`block` 테이블** — 복합 PK, 전역(모임 무관 — 차단은 userId 매칭이며 UGC는 모든 모임에서 숨김):
```prisma
model Block {
  blockerId     String   @map("blocker_id")      // profile.id (sub)
  blockedUserId String   @map("blocked_user_id") // profile.id (sub) — FK 없음(soft-ref)
  createdAt     DateTime @default(now()) @map("created_at")
  @@id([blockerId, blockedUserId])
  @@index([blockerId])                            // getHiddenUserIds(sub) 정방향 조회용
  @@index([blockedUserId])                        // getBlockersOf(userIds) 역방향 조회용(REQ-FLT-006 발신 필터)
  @@map("block")
}
```

**`report` 테이블** — 단일 PK 콘텐츠만 참조:
```prisma
model Report {
  id           String   @id @default(uuid())
  reporterId   String   @map("reporter_id")      // soft-ref
  targetUserId String   @map("target_user_id")   // soft-ref
  moimId       String   @map("moim_id")          // FK → moim ON DELETE CASCADE
  reason       String
  contentType  String   @map("content_type")     // CHECK: chat_message|poll|expense|settlement_request
  contentId    String   @map("content_id")       // TEXT 통일(chat_message BigInt는 필터 시 캐스팅)
  createdAt    DateTime @default(now()) @map("created_at")
  @@index([targetUserId])
  @@index([moimId])
  @@map("report")
}
```

**수동 SQL(Prisma 미표현 — add_notification 선례대로 마이그레이션에 직접 기술 + `.moai/project/db/`에 문서화)**:
- `ALTER TABLE "block" ENABLE ROW LEVEL SECURITY;` (정책 없음 = default deny)
- `ALTER TABLE "report" ENABLE ROW LEVEL SECURITY;` (정책 없음 = default deny)
- `report.content_type` CHECK 제약(`IN ('chat_message','poll','expense','settlement_request')`).
- FK: `report.moim_id → moim(id) ON DELETE CASCADE`(notification FK 선례). `block`은 FK 없음(양쪽 user soft-ref).

**Realtime 영향: 없음.** 브로드캐스트는 per-moim 채널이며 발행 시점 수신자별 필터 불가(research §채팅 파이프라인). 차단 신규 트리거·채널·RLS 방송 정책을 추가하지 않는다 — 실시간 필터는 클라이언트 측에서 수행.

### 3.2 백엔드 API (NestJS)

**신규 모듈** `apps/backend/src/safety/` — AuthModule import(가드). PrismaService는 global. MoimModule 불필요(인가는 `blockerId == sub` WHERE 내장 — notification 패턴). `SafetyModule`이 `BlockService`를 **exports**해 소비 도메인이 주입.

| 라우트 | 서비스 | 인가 | 검증 |
|---|---|---|---|
| `POST /reports` | `SafetyService.createReport(sub, dto)` | reporter=sub 강제 | content_type ∈ 화이트리스트(미지 400), reason 비어있으면 400. **`report` 행만 생성 — `block` 생성 안 함(신고·차단 독립, REQ-RPT-002).** 신고자 측 숨김은 report 소스로 달성. |
| `POST /blocks` | `SafetyService.createBlock(sub, blockedUserId)` | blocker=sub | 자기 차단 400, 멱등(P2002 → 200). REQ-RPT-003 prompt 수락 시에도 이 경로 재사용. |
| `DELETE /blocks/:blockedUserId` | `SafetyService.unblock(sub, blockedUserId)` | blocker=sub | 없는 행 삭제 멱등(204). **`block` 행만 삭제 — report 기반 숨김은 불변**(차단 해제 ≠ 신고 취소). |
| `GET /blocks` | `SafetyService.listBlocks(sub)` | blocker=sub | 내 차단 목록 반환(block 행만 — 신고 숨김은 별도). |
| (내부) | `BlockService.getHiddenUserIds(sub): Promise<string[]>` | — | `block(blockerId=sub → blockedUserId)` ∪ `report(reporterId=sub → targetUserId)` → 중복 제거 userId[]. **뷰어 측 읽기 경로 필터 단일 출처**(요청당 각 1회 조회, N+1 회피). |
| (내부) | `BlockService.getBlockersOf(userIds[]): Promise<Set<string>>` | — | `block.findMany({ where: { blockedUserId: { in: userIds } } })` → 발신자를 차단한 blockerId 집합. **발신(push/notification) 경로 역방향 필터 단일 출처**. report는 미포함(REQ-FLT-006 — 명시적 차단만 push 억제). |

컨벤션: per-route `@UseGuards(SupabaseAuthGuard)`, ValidationPipe 부재 → 명시적 검증 헬퍼(notification.controller.ts:130-148 스타일), `user.sub`만 인가 키. BigInt 응답 없음(모두 TEXT).

**필터 주입(소비 도메인 5곳)** — 각 목록 서비스가 `BlockService.getHiddenUserIds(sub)`를 1회 호출(요청당 단일 조회, N+1 회피) 후 WHERE에 적용. 반환 집합(`hiddenIds`)은 block∪report union이므로 소비 도메인은 차단·신고 구분 없이 동일하게 필터한다:

| 서비스 | 지점 | 변경 |
|---|---|---|
| `chat.service.ts:93-98` `getHistory` | findMany where | `senderId: { notIn: hiddenIds }` 추가. notIn으로 페이지 부족 → over-fetch 후 trim(keyset 커서 보존). |
| `poll.service.ts:299` `listPolls` | findMany where | `createdBy: { notIn: hiddenIds }` 추가. `aggregatePolls`의 표 집계는 무변경(REQ-FLT-002). |
| `expense.service.ts:170-242` `listExpenses` | 계산/표시 분리 | 전체 `expenses`로 balance/transactions/total 계산(원장 정합). 반환 `expenses` 배열은 **행을 제거하지 않고** `createdBy ∈ hiddenIds`인 항목의 작성자 표면(예: creator nickname/식별 필드)을 **'차단한 멤버'로 마스킹**해 반환(REQ-FLT-003 — 행 유지). 동일 표면에서 렌더되는 `settlement_request`(요청자 `requester_id ∈ hiddenIds`)도 행 유지 + 요청자 표시 '차단한 멤버' 마스킹(REQ-FLT-003 — settlement_request 포함). **[WARN] 계산 입력에 마스킹을 적용하면 정산 수치가 뷰어별로 어긋남 — 마스킹은 표시 반환 직전에만**. |
| `schedule.service.ts` `getSchedule`(슬롯 조회) | 슬롯 응답 매핑 | `schedule_slot`을 `userId notIn hiddenIds`로 제외. dates/window 무변경(필터 불가 한계). |
| `notification.service.ts:86-100` `listForRecipient` | findMany where | `actorId: { notIn: hiddenIds }` 추가(actorId null은 자연 통과). |

**발신 경로 필터(push/notification fan-out) — REQ-FLT-006**: 읽기 경로(위)와 별개로, UGC가 **발신 시점에** 차단자 기기/피드에 도달하는 경로를 역방향으로 차단한다. `getBlockersOf([senderId])`를 1회 조회해 반환된 blocker 집합을 recipient 집합과 대조하고, 그 교집합(= 발신자를 차단한 수신자)을 차감한다(report는 미포함 — 명시적 block만):

| 지점 | 변경 |
|---|---|
| `push.listener.ts:41-43` `handleChatMessageCreated` 수신자 산정 | `recipientUserIds`(moim_member − sender) 계산 직후, `getBlockersOf([senderId])`가 반환한 blocker 집합에 속한 recipient를 차감한다(A가 sender B를 차단했으면 A 제외). best-effort try/catch 내부에서 수행 — safety 조회 실패가 발송을 막지 않도록 격리. |
| `notification.listener.ts` moim-wide fan-out (`moimMembersExcept` 결과) | 채팅 외 이벤트도 actor UGC이 차단자 피드에 신규 생성되는 것을 막기 위해 동일 역방향 차감을 검토. **최소 범위 결정**: 인앱 피드는 이미 읽기 경로(REQ-FLT-005 `listForRecipient`)가 필터하므로 fan-out 시점 차감은 저장 절감(중복) 목적일 뿐 필수는 아님 → **채팅 push(REQ-FLT-006)만 필수 구현**, notification fan-out 역방향 차감은 §9 제외(읽기 경로가 이미 커버, 잠금화면 노출은 push 한정 문제). |

소비 배선: `PushModule`(및 필요 시 `NotificationModule`)이 `SafetyModule`을 import해 `BlockService` 주입(단방향 — safety ↛ push/notification, R-8 비순환 유지).

### 3.3 웹 UI 변경 (apps/web — 빌드/린트 검증만)

> apps/web은 React Query 미사용(Server Component + Server Action + `revalidatePath` + 채팅 raw useState). 캐시 무효화 = `revalidatePath`(서버) + 채팅 수동 state 초기화(클라이언트).

- **신고 플로우**(신규): v1 신고 진입점은 **채팅 메시지 말풍선 한정**(`chat/page.tsx`) — poll/expense/settlement_request 표면 신고 UI는 v1 범위 밖(§9 제외, 백엔드는 4종 수용). 말풍선에서 신고 진입 → 사유 입력 → `POST /reports`(report만 생성, block 미생성) → 신고자 측 즉시 숨김(report 기반) + "이 멤버를 차단할까요?" **유도(prompt)**. prompt 수락 시에만 `POST /blocks`(REQ-RPT-003) 별도 호출. 채팅은 `revalidatePath` 대상이 아니므로(raw state) 신고/차단 직후 `setMessages([])` + 히스토리 재조회(수동 무효화, 서버가 union 필터 적용 — REQ-FLT-001 연계).
- **멤버 목록 차단 버튼**(`members-section.tsx:326-349`): 기존 행별 액션 패턴(강퇴/위임 line 339-347)에 **차단** 버튼 추가. 단 owner 전용 `showControls`(line 305-306) **밖** — "본인 제외 모든 멤버 행"에 노출. 확인 다이얼로그(line 368-389 패턴) + Server Action(`member-actions.ts` 패턴, `revalidatePath`).
- **차단 목록/해제**(`(main)/profile/`): SPEC-PROFILE-001 프로필 페이지에 "차단한 멤버" 섹션 최소 추가 — Server Component가 `GET /blocks` 조회 + 해제 Server Action. 별도 라우트 미신설(최소 배치).
- **채팅 클라이언트 실시간 필터**(`chat/page.tsx:259-279` `handleIncoming`): 마운트 시 hidden 목록 로드(서버 `getHiddenUserIds` 결과 = block∪report 반영) → `fromBroadcast` 직후 `setMessages` append 전 `hiddenUserIds.has(message.senderId)` 드롭(REQ-FLT-001). 미지 발신자 재조회 경로(line 266-276)도 동일 검사(research risk 10).

### 3.4 모바일 브리지 영향

**없음.** 모든 UGC 표면은 WebView 내부 웹 화면이 렌더(하이브리드 — web owns screen content). 신고·차단 진입점은 WebView 안 웹 UI. 네이티브 라우트·브리지 커맨드·SecureStore 변경 0.

### 3.5 고아 행 정리 소유권 + 구현 순서 (SPEC-ACCOUNT-001 연계)

탈퇴(SPEC-ACCOUNT-001)한 blocker/reporter/피대상 sub의 `block`·`report` 잔존 행 정리는 **ACCOUNT-001 소관으로 확정**한다(상호 위임 커버리지 홀 R-10 해소). 근거: ACCOUNT의 `deleteAccount(sub)`가 유일하게 "이 sub가 탈퇴한다"는 시점을 안다.

- **정리 위치**: ACCOUNT `deleteAccount` (2)단계 멱등 `$transaction`에 다음 2줄 추가(prisma 직접 접근 — `SafetyModule` import 아님이라 account↔safety 순환 의존 R-15 미발생):
  - `block.deleteMany({ where: { OR: [{ blockerId: sub }, { blockedUserId: sub }] } })`
  - `report.deleteMany({ where: { OR: [{ reporterId: sub }, { targetUserId: sub }] } })`
- **report 행 삭제 확정(구 열린 질문 §10-4 해소)**: 탈퇴 사용자 연관 `report` 행은 위 `deleteMany`로 **삭제**한다 — **감사 보존 테이블로 이관하지 않는다**. 탈퇴 후에는 대상(targetUserId) 또는 신고자(reporterId)가 부재해 운영자 수동 검토(REQ-STO-001)가 조치 불능이므로 보존 가치가 없다.
- **구현 순서 의존**: `block`/`report` 테이블은 **SAFETY-001이 선행 생성**해야 ACCOUNT가 정리 대상을 가진다. 두 경우 처리:
  - SAFETY 선행 병합 시: ACCOUNT run 단계에서 위 2줄을 바로 포함.
  - ACCOUNT 선행 병합 시: ACCOUNT plan §9/§2에 "block/report 정리는 SAFETY 테이블 병합 후 후속 태스크로 추가"를 **후속 위임 태스크**로 명시(테이블 부재 시 컴파일/런타임 오류 회피).
- **문구 정합**: 본 plan R-10 + §9와 ACCOUNT-001 §9의 위임 문구를 **동일 방향(정리 소유자 = ACCOUNT)**으로 수정한다. 이 변경은 ACCOUNT plan에도 반영 필요(오케스트레이터가 별도 태스크로 처리 — 본 plan 편집 범위 밖).
- **순서 고정**: frontmatter 스키마는 8개 고정 필드라 의존성 필드를 담지 않으므로, 두 SPEC의 **본문(spec.md §8 Dependencies + plan.md §3.5)**에 상호 참조 + 구현 순서(SAFETY 테이블 선행)를 명시해 run 단계 순서 혼동을 차단한다.

---

## 4. 델타 마커 (모듈별)

| 모듈 | 산출물 | 마커 |
|---|---|---|
| 1·2 (신고·차단) | `apps/backend/src/safety/**`(module/controller/service/dto/spec) | [NEW] |
| 1·2 | `apps/backend/prisma/schema.prisma`(Block, Report 모델) | [MODIFY] |
| 1·2 | `apps/backend/prisma/migrations/<ts>_add_safety/migration.sql` | [NEW] |
| 1·2 | `apps/backend/src/app.module.ts`(SafetyModule 등록) | [MODIFY] |
| 3 (읽기 필터) | `chat.service.ts` / `poll.service.ts` / `expense.service.ts` / `schedule.service.ts` / `notification.service.ts` | [MODIFY] |
| 3 (발신 필터) | `push.listener.ts`(수신자 산정 역방향 차감 — REQ-FLT-006) | [MODIFY] |
| 3 | 각 소비 도메인 `*.module.ts` + `push.module.ts`(SafetyModule import → BlockService 주입) | [MODIFY] |
| 3 | `apps/web/app/moims/[id]/chat/page.tsx`(신고 진입 + 실시간 필터 + state 초기화) | [MODIFY] |
| 2·4 | `apps/web/app/(main)/home/[id]/members-section.tsx`(차단 버튼) + `member-actions.ts`(blockAction) | [MODIFY] |
| 2·4 | `apps/web/app/(main)/profile/**`(차단 목록·해제 섹션) | [MODIFY] |
| 2·4 | `apps/web/lib/safety/*`(신규 fetch 헬퍼 — polls.ts 패턴 미러) | [NEW] |
| 4 | `apps/backend/openapi.json` + `packages/api-client/src/schema.d.ts` | [REGEN] |
| 3·5 | chat/poll/expense/schedule/notification 응답 DTO·타입(작성자 표면) | [EXISTING] (스키마 무변경 — 서버 필터만) |

---

## 5. 태스크 분해 (run 단계 — 백엔드 TDD test-first / 웹 build·lint 검증)

### M1 — 데이터 모델 (RED→GREEN)
- `schema.prisma`에 `Block`·`Report` 추가 → `prisma migrate dev --name add_safety`.
- 마이그레이션 SQL에 RLS enable(정책 없음) + `report.content_type` CHECK + `report.moim_id` FK CASCADE 수동 기술.
- `.moai/project/db/`에 수동 SQL 문서화(드리프트 방지, add_notification 선례).

### M2 — safety 서비스·컨트롤러 (jest test-first)
- `SafetyService` 단위 테스트 선작성(fake Prisma — jest.fn + `Promise.resolve`, notification.service.spec.ts 패턴): `getHiddenUserIds`(block∪report union + 중복 제거), `getBlockersOf`(역방향 blocker 집합), `createReport`(화이트리스트/빈 사유 400 + **block 미생성** 검증), `createBlock`(자기 차단 400 + 멱등), `unblock`(멱등 + report 숨김 불변), `listBlocks`.
- `SafetyController` 라우트(가드) + 검증 헬퍼. `SafetyModule`이 `BlockService` export.
- `app.module.ts`에 `SafetyModule` 등록.

### M3 — 필터 주입 (서비스별 jest test-first)
- **읽기 경로**: chat/poll/expense/schedule/notification 각 목록 서비스 테스트에 "hidden 목록(block∪report)이 where절에 반영"(mock 호출 검증, notification.service.spec.ts:193 스타일) 케이스 추가 → GREEN.
- **발신 경로(REQ-FLT-006)**: `push.listener.spec.ts`에 "A가 sender B를 차단 → A가 recipientUserIds에서 차감(FCM 미발신)" + "report만 있고 block 없으면 push 유지(report는 push 억제 안 함)" 케이스 추가 → GREEN. `getBlockersOf` mock 호출 검증.
- expense: 계산용 전체 로드(원본) vs 표시용 작성자 마스킹 분리 테스트(정산 수치 불변 + 차단 대상 행 유지 + 작성자만 '차단한 멤버' 마스킹 + 표시 항목 합=합계 정합).
- chat: over-fetch/trim로 keyset 페이지 크기 보존 테스트.
- 각 `*.module.ts` + `push.module.ts`에 `SafetyModule` import(BlockService 주입) — 비순환 정적 검사(chat/poll/expense/schedule/notification/push ↛ 역방향 없음, safety ↛ 도메인 grep).

### M4 — 웹 UI (build/lint 검증)
- 신고 플로우(**채팅 말풍선 진입 한정** — poll/expense/settlement_request UI는 v1 범위 밖, §9 제외 + 사유 폼 + `POST /reports` Server Action, **block 미생성**) + 신고 후 "이 멤버를 차단할까요?" 유도(prompt) + prompt 수락 시에만 `POST /blocks`(REQ-RPT-003, `blockAction` 재사용) + 채팅 state 초기화.
- 멤버 목록 차단 버튼(본인 제외 전 멤버) + 확인 다이얼로그 + `blockAction`(revalidatePath).
- 프로필 "차단한 멤버" 섹션(`GET /blocks` + 해제 Server Action). 신고 숨김은 목록에 나타나지 않음(block 행만 조회).
- 채팅 `handleIncoming` 클라이언트 실시간 필터(hidden=block∪report) + 미지 발신자 경로 동일 검사.
- `apps/web/lib/safety/*` 헬퍼(polls.ts 미러). `nx run web:build` + `nx lint web` 0 error.

### M5 — 계약 재생성 + 운영 문서 + 고아 정리 위임
- `apps/backend/openapi.ts` emit → `openapi.json` → api-client `schema.d.ts` 재생성.
- 느슨한 결합 정적 검사(safety ↛ 생산 도메인/push import grep — push→safety 단방향만 허용).
- 운영 절차 문서(신고 DB 조회 기반 수동 검토 + 24h 조치 절차) 기술.
- **고아 정리 위임(§3.5)**: SAFETY 테이블이 병합됨을 전제로 ACCOUNT-001 `deleteAccount`에 block/report `deleteMany` 2줄을 추가하도록 오케스트레이터에 통지(ACCOUNT plan §9 문구 동일 방향 수정 유발 — 본 SPEC 편집 범위 밖, §10-3 확인 항목). SAFETY 선행 병합 시 즉시 반영, ACCOUNT 선행 시 후속 태스크.
- `nx lint backend` + jest 85%+ 게이트 통과.

---

## 6. 참조 구현 (Reference)

- Reference: `apps/backend/src/notification/notification.module.ts:13-18` — AuthModule만 import, PrismaService global 재사용, MoimModule 불필요(WHERE 내장 인가) 모듈 구조.
- Reference: `apps/backend/src/notification/notification.service.ts:86-100` — `recipientId == sub` WHERE 내장 = 격리 단일 소스. `getHiddenUserIds`·필터가 답습할 패턴.
- Reference: `apps/backend/src/push/push.listener.ts:37-52` — `handleChatMessageCreated` 수신자 산정(moim_member − sender ⋈ device_token). REQ-FLT-006 역방향 차감(`getBlockersOf`) 삽입 지점. best-effort try/catch 내부에서 safety 조회.
- Reference: `apps/backend/prisma/migrations/20260701200000_add_notification/migration.sql:1-35` — additive 테이블 + FK CASCADE + RLS default-deny + 수동 SQL 문서화 컨벤션.
- Reference: `apps/backend/src/chat/chat.service.ts:93-98` — `getHistory` findMany where절(`senderId notIn` 훅 + keyset 커서).
- Reference: `apps/backend/src/poll/poll.service.ts:295-304` — `listPolls` where절(`createdBy notIn` 훅), `aggregatePolls` 집계 무변경 경계.
- Reference: `apps/backend/src/expense/expense.service.ts:170-242` — `listExpenses` 계산(balance/transactions/markers) vs 표시(expenses 배열) 분리 지점(@MX:ANCHOR line 168).
- Reference: `apps/web/app/(main)/home/[id]/members-section.tsx:300-358` — 행별 액션 버튼 + owner 조건(line 305-306) 밖 차단 버튼 배치.
- Reference: `apps/web/app/(main)/home/[id]/member-actions.ts` — kick/transfer Server Action(`revalidatePath`, 일반화 오류) → blockAction 미러.
- Reference: `apps/web/app/moims/[id]/chat/page.tsx:259-279` — `handleIncoming` 실시간 필터 훅 + state 수동 무효화.
- Reference (테스트): `apps/backend/src/notification/notification.service.spec.ts` — fake Prisma(jest.fn+Promise.resolve) + mock 호출 검증 패턴.
- Reference: [research.md](./research.md) §채팅 파이프라인·§추가 조사(§2·§4·§5) — 훅 좌표·다형 참조·차단 목록 조회 예시(plan에서 `getHiddenUserIds` block∪report union으로 확장).

---

## 7. 리스크 분석 및 완화

| # | 리스크 | 완화 |
|---|--------|------|
| R-1 | 채팅 keyset 페이지 축소(`notIn`으로 take보다 적게 반환) | over-fetch 후 trim, 커서는 반환분 마지막 id 유지. 커버 테스트. |
| R-2 | 지출 필터가 정산 계산 오염(expense.service.ts:181-241 단일 쿼리 공유) | **계산은 전체 expenses(원본), 표시는 행 유지 + 작성자 마스킹**으로 분리(REQ-FLT-003 개정 — 행 제거 아님). 정산 수치 불변 + 표시 항목 합=합계 정합 테스트. [WARN 태그]. |
| R-3 | 서버·클라이언트 필터 계층 불일치(한쪽만 구현 시 리로드 후 노출) | 채팅은 서버(히스토리)+클라이언트(실시간) **동시** 구현 강제(REQ-FLT-001). AC로 양경로 검증. |
| R-4 | 실시간 브로드캐스트 네트워크 레이어 노출(채널 단위) | 아키텍처 한계 — acceptance에 "네트워크 페이로드는 관찰 가능, UI 숨김이 목표" 명시. 서버 트리거 필터는 불가(research 옵션 A 기각). |
| R-5 | React Query 부재 → 차단 직후 잔존 메시지 | 차단/신고 액션 후 `setMessages([])`+재조회(수동), Server Action은 `revalidatePath`. |
| R-6 | 일정 협업 편집(dates/window) 필터 불가(작성자 추적 없음) | 슬롯만 필터 가능함을 한계로 명시(REQ-FLT-004). |
| R-7 | 신고와 차단의 결합/독립 경계 혼동(구 결정: 신고 시 block 자동 생성) | **해소**: 신고 ≠ 차단으로 확정(REQ-RPT-002/003). report는 자체 숨김 소스, block은 REQ-RPT-003 prompt 수락 시에만 생성. 필터는 `getHiddenUserIds`가 block∪report union으로 흡수 → 인프라 1벌 유지하면서 "신고했지만 차단 원치 않음" 케이스도 커버. 차단 해제(REQ-BLK-002)가 report 숨김을 되살리지 않음(union의 report 항 불변). |
| R-8 | 순환 의존(safety ↔ 도메인) | safety는 도메인 import 안 함, 도메인이 `BlockService` 주입(단방향). grep 정적 검사(SPEC-CHAT-002 loose-coupling 방식). |
| R-9 | `getHiddenUserIds`/`getBlockersOf` N+1(목록·발신 호출마다 실행) | 요청/이벤트당 1회 조회 후 재사용. `@@index([blockerId])`(정방향)로 저비용. 발신 역방향(`blockedUserId` in)은 `@@index([blockedUserId])` 추가로 저비용화(스키마 §3.1). |
| R-10 | 계정 삭제 시 block/report 고아 행 정리 책임의 상호 위임(SAFETY↔ACCOUNT 커버리지 홀) | **해소**: 정리 소유자를 **ACCOUNT-001로 확정**. ACCOUNT `deleteAccount` (2)단계 트랜잭션에 `block.deleteMany({ OR: [{blockerId:sub},{blockedUserId:sub}] })` + `report.deleteMany({ OR: [{reporterId:sub},{targetUserId:sub}] })`를 **prisma 직접 접근**으로 추가(모듈 import 아님 → 순환 의존 R-15 미발생). 본 SPEC이 후행 구현이면 ACCOUNT에 "후속 위임 태스크"로 명시. 잔존 행이 필터에 무해함(존재하지 않는 userId 자연 무시)은 유지되나, report.targetUserId가 삭제된 sub를 가리켜 REQ-STO-001 운영자 수동 검토가 조치 불능이 되는 문제를 정리로 차단. 구현 순서는 본문(spec.md §8 + plan.md §3.5)에 고정. |
| R-11 | 복합 PK 콘텐츠 신고 불가(poll_vote/expense_share/schedule_slot) | 신고 대상을 단일 PK 4종으로 한정(REQ-RPT-004, CHECK 제약). |
| R-12 | 게스트 특수 처리 유혹 | 매칭은 userId(sub)만 — 게스트/명명 계정 동일(REQ-BLK-003). is_guest 컬럼 없음. |
| R-13 | 차단이 owner/타 멤버 뷰에 영향 없음(의도) | acceptance에 "per-viewer only, DB/API 직접 접근은 차단 무관" 명시(확정 범위). |
| R-14 | FCM 푸시 발신 경로가 차단 우회 → 차단 대상 UGC(메시지 미리보기)가 잠금화면 도달(범위 구멍) | **해소**: `push.listener.ts` 수신자 산정에 `getBlockersOf([senderId])` 역방향 차감 추가(REQ-FLT-006). block만 억제(report 미포함). notification fan-out 역방향 차감은 읽기 경로가 이미 커버하므로 §9 제외(push 한정 문제). 잔여 한계: 차단 **전** 이미 발송된 push 리보크 불가(수용). |
| R-15 | account↔safety 순환 의존(ACCOUNT가 고아 정리 위해 SafetyModule import 시) | **회피**: ACCOUNT `deleteAccount`가 `SafetyModule`을 import하지 않고 **prisma 직접 접근**(`block.deleteMany`/`report.deleteMany`)으로 정리 — 모듈 의존 그래프에 account→safety 엣지가 생기지 않아 순환 미발생(§3.5, R-10). |

---

## 8. MX 태그 계획 (mx_plan)

- `@MX:ANCHOR` (+`@MX:REASON`) — `BlockService.getHiddenUserIds(sub)`: fan_in ≥5(chat/poll/expense/schedule/notification 읽기 소비) 뷰어 측 필터 단일 계약. 불변식: block∪report union 반환, 시그니처(`sub → string[]`), 차단 해제가 report 항을 되살리지 않음.
- `@MX:ANCHOR` (+`@MX:REASON`) — `BlockService.getBlockersOf(userIds)`: 발신(push) 경로 역방향 필터 단일 계약(REQ-FLT-006). 불변식: block만 포함(report 미포함 — 신고는 push 억제 안 함).
- `@MX:WARN` (+`@MX:REASON`) — `expense.service.ts` `listExpenses` 계산/표시 분리 지점: 표시 필터를 계산 입력에 잘못 적용하면 정산 수치가 뷰어마다 달라지는 원장 훼손(R-2).
- `@MX:NOTE` — 각 소비 서비스 필터 주입 지점: "뷰어 측 필터(삭제/익명화 아님), hidden 목록 = block∪report, 요청자=sub" 의도.
- `@MX:NOTE` — `push.listener.ts` 수신자 역방향 차감(REQ-FLT-006): 차단 대상 UGC이 잠금화면에 도달하지 않도록 발신 시점 차감. report는 미적용(block만).
- `@MX:NOTE` — `SafetyModule` 경계: safety→도메인/push 역방향 import 금지(비순환 계약, R-8). ACCOUNT의 block/report 정리는 prisma 직접 접근(모듈 import 아님, R-10/R-15).
- `@MX:NOTE` — `chat/page.tsx` `handleIncoming` 실시간 드롭: 서버 히스토리 필터와 반드시 짝(계층 정합 R-3).

---

## 9. 제외 범위 (What NOT to Build)

- **관리자 검토 UI / 자동 모더레이션 워크플로우** — report는 저장만. 운영 검토는 수동 DB 조회 절차(문서). 추후 별도 SPEC.
- **글로벌 콘텐츠 삭제·익명화** — 차단은 뷰어 측 필터일 뿐. 원 콘텐츠·닉네임·집계는 전역 보존(삭제 전략 기각, research 충돌 1).
- **차단 대상 지출 행의 표시 목록 완전 제거** — 지출은 금액·정산 무결성을 위해 행을 유지하고 작성자 표시만 마스킹한다(REQ-FLT-003 확정). 채팅/투표/일정/알림과 달리 지출은 행 제거가 아니라 작성자 마스킹으로 처리.
- **양방향(2-way) 차단** — 1-way 확정. 차단 대상은 차단자 콘텐츠를 계속 본다.
- **복합 PK 콘텐츠 신고**(poll_vote / expense_share / schedule_slot) — 단일 PK 4종만 신고 대상.
- **poll / expense / settlement_request 신고 진입점 UI** — v1 웹 신고 진입점은 **채팅 메시지 말풍선 한정**. 백엔드 `POST /reports`는 4종을 모두 수용하나, poll·expense·settlement_request 표면의 신고 버튼 UI는 v1 범위 밖(추후 확장). Delta Markers·M4는 chat/page.tsx 신고 진입만 포함.
- **일정 협업 편집(dates/window) 필터** — 작성자 추적 부재로 필터 불가(슬롯만).
- **실시간 브로드캐스트 서버 측 수신자별 필터** — per-moim 채널 아키텍처상 불가(클라이언트 필터로 대체).
- **notification fan-out(인앱 알림 생성) 발신 시점 역방향 차감** — 읽기 경로(REQ-FLT-005 `listForRecipient`)가 이미 차단 대상 알림을 필터하므로 fan-out 저장 절감은 비필수. 채팅 **FCM push**(REQ-FLT-006)만 발신 필터 대상(잠금화면 노출은 push 한정 문제).
- **차단 전 이미 발송된 push의 리보크** — REQ-FLT-006은 차단 **이후** 신규 발신만 억제. 기발송 알림 회수는 범위 밖(수용).
- **모바일 네이티브 변경** — 브리지/라우트/SecureStore 무변경(전 표면 WebView 웹 UI).
- **회원 탈퇴 / 인앱 계정 삭제** — [SPEC-ACCOUNT-001] 소관. **block/report 고아 행 정리는 ACCOUNT-001이 소유**(본 SPEC은 테이블·필터만 제공, 정리 로직은 ACCOUNT `deleteAccount` 트랜잭션에 prisma 직접 접근으로 추가 — §3.5, R-10). 구현 순서: SAFETY 테이블 선행.
- **신규 의존성** — 0개. 기존 스택만 사용.

---

## 10. 열린 질문 → 확정 결정 (전원 해소)

> **해소됨 (구 #1) — 신고 ↔ 차단 결합**: 신고 ≠ 차단으로 **확정**(REQ-RPT-002/003, R-7). 신고는 저장+report 기반 신고자 측 숨김+차단 유도(prompt)까지이고, 실제 `block` 행은 prompt 수락 시에만 생성. 뷰어 측 필터는 `getHiddenUserIds`가 block∪report union으로 흡수. 차단 해제가 신고 숨김을 되살리지 않음. → run 진입 전 이미 결정, 별도 확인 불필요.

1. **[해소] 지출 표시 방식**: 차단 대상 expense 행을 **완전 숨김하지 않는다**. 금액·정산 무결성 유지를 위해 지출 행은 목록에 **유지하되 작성자 표시만 '차단한 멤버'로 마스킹**한다(익명 라벨 대체). 표시 목록에서 행 자체를 제거하면 뷰어가 보는 합계와 항목 목록의 합이 어긋나 원장 정합성 혼란을 유발하므로, 행 유지 + 작성자 마스킹으로 확정(REQ-FLT-003 개정). 정산 계산(balance/transactions/total)은 종전대로 전체 expense 포함 — 이 결정으로 계산·표시 분기가 "계산=전체, 표시=행 유지+작성자 마스킹"으로 단순화된다.
2. **[해소] 차단 해제 UI 배치**: 전용 설정 라우트를 **신설하지 않는다**. 기존 프로필/설정 화면 내 **"차단한 멤버" 섹션**으로 조회+해제를 제공한다(REQ-BLK-004 개정). 최소 배치로 확정.
3. **[해소] 고아 정리 소유권**: block/report 고아 행 정리 소유권은 **SPEC-ACCOUNT-001로 확정**하고, 구현 순서는 **SAFETY 테이블 선행**으로 한다. ACCOUNT 선행 병합 시에는 §3.5의 **후속 위임 태스크**(SAFETY 테이블 병합 후 `deleteMany` 2줄 추가)로 처리한다(테이블 부재 시 컴파일/런타임 오류 회피 — §3.5와 동일 메커니즘). 양쪽 plan이 이미 동일 방향(정리 소유자=ACCOUNT, SAFETY 테이블 선행)으로 정합함을 확인 — 상호 위임 홀 없음(§3.5, R-10). 별도 문구 재수정 불필요.
4. **[해소] 탈퇴 사용자 report 행 처리**: 탈퇴(ACCOUNT-001) 사용자와 연관된 `report` 행(reporterId 또는 targetUserId = 탈퇴 sub)은 ACCOUNT `deleteAccount` 트랜잭션에서 **삭제**한다(감사 보존 테이블 이관 없음). §3.5의 `report.deleteMany({ OR: [{reporterId:sub},{targetUserId:sub}] })`가 이 삭제를 수행한다. REQ-STO-001 운영자 수동 검토는 탈퇴 전 신고에만 유효하며, 탈퇴 후에는 대상이 부재하므로 조치 불능 행을 보존하지 않는다.
