---
id: SPEC-SAFETY-001
version: "0.1.0"
status: draft
created: 2026-07-02
updated: 2026-07-02
author: hatae
priority: critical
issue_number: 0
---

# SPEC-SAFETY-001 — 신고·차단 (UGC 모더레이션)

> 수락 기준(Given/When/Then): [acceptance.md](./acceptance.md) | 구현 계획: [plan.md](./plan.md) | 조사: [research.md](./research.md) | 인터뷰: [interview.md](./interview.md)

## HISTORY

- 2026-07-02 (v0.1.0): 최초 작성(draft). 인터뷰 4개 결정 + 계획 검토 게이트 승인 반영. 사용자 확정 결정 4건 반영(지출 행 유지+작성자 마스킹, 프로필 내 "차단한 멤버" 섹션, 고아 정리 소유권=ACCOUNT-001 + SAFETY 테이블 선행, 탈퇴 사용자 report 행 삭제).
  - 구조: 신규 `safety` 모듈(신고·차단 도메인 격리) + 뷰어 측 필터링(서버 쿼리 필터 + 클라이언트 실시간 필터). 삭제·익명화 아님 — per-viewer 1-way 숨김.
  - 신고 ≠ 차단(독립): 신고는 저장 + 신고자 측 숨김(report 소스) + 차단 유도(prompt)까지이며, 실제 `block` 행은 prompt 수락 시에만 생성. 뷰어 측 필터는 `BlockService.getHiddenUserIds`가 block∪report union으로 흡수.
  - FCM push 발신 경로 역방향 억제(REQ-FLT-006): 차단 대상 UGC이 잠금화면에 도달하지 않도록 `push.listener` 수신자 산정에서 발신자를 차단한 수신자를 차감(block만, report 미포함).
  - block/report 고아 행 정리 = SPEC-ACCOUNT-001 소관 확정(SAFETY 테이블 선행; ACCOUNT 선행 병합 시 후속 위임 태스크로 처리 — plan §3.5).

## 1. 목표 (Goal)

App Store / Google Play 출시를 위한 UGC 모더레이션 최소 요건 대응. 사용자가 부적절한 콘텐츠를 **신고**하고 가해 멤버를 **차단**하면, 신고·차단한 본인 화면에서만 해당 멤버의 UGC가 숨겨진다(per-viewer, 1-way). 콘텐츠는 전역적으로 보존되며 삭제·익명화하지 않는다. 관리자 검토 UI는 범위 밖이고, 신고 데이터 검토는 운영자 수동 DB 조회 절차(문서)로 대응한다.

## 2. 배경 (Context)

- 신규 `safety` 모듈이 신고(`report`)·차단(`block`) 도메인을 격리하고, `BlockService.getHiddenUserIds(sub)`를 뷰어 측 필터 주입의 **단일 출처**로 제공한다(block∪report union). 소비 도메인(chat/poll/expense/schedule/notification)이 `BlockService`를 주입받아 목록 쿼리 WHERE에 적용한다(단방향 — safety ↛ 도메인, 비순환).
- 신고와 차단은 독립적이다. 신고는 `report` 행을 만들어 신고자 측 숨김의 진실 공급원이 되고, `block` 행은 신고 후 유도(prompt) 수락 시 또는 멤버 목록에서 직접 차단할 때만 생성된다.
- 발신(FCM push) 경로는 읽기 경로와 별개로, `BlockService.getBlockersOf`가 발신자를 차단한 수신자를 역방향으로 차감해 차단 대상 UGC의 잠금화면 도달을 억제한다(block만).
- 모든 UGC 표면은 WebView 내부 웹 화면이 렌더한다(하이브리드 — web owns screen content). 신고·차단 진입점도 WebView 안 웹 UI이며 네이티브 브리지·라우트 변경은 없다.

상세: [research.md](./research.md), [plan.md](./plan.md).

## 3. 스토어 정책 근거 매핑

| 스토어 요건 | 근거 | 본 SPEC 대응 |
|---|---|---|
| 콘텐츠 신고 메커니즘 | Apple App Review Guideline 1.2 (UGC), Google Play UGC(신고 요건) | `report` 저장 + 신고 즉시 신고자 측 숨김(모듈 1, REQ-RPT). |
| 가해 사용자 차단 수단 | Apple App Review Guideline 1.2 (UGC), Google Play UGC(차단 요건) | `block` + 뷰어 측 UGC 전면 필터(모듈 2·3, REQ-BLK/REQ-FLT). 진입점 = 신고 후 유도 + 멤버 목록. |
| 게시된 모더레이션/연락 프로세스 + 24시간 내 조치 | Apple App Review Guideline 1.2 | 관리자 UI 범위 제외. `report` 저장분을 운영자가 수동 DB 조회로 검토하는 절차를 **운영 문서**로 기술(모듈 5, REQ-STO). |
| 인앱 계정 삭제 | Apple App Review Guideline 5.1.1(v), Google Play(계정 삭제 요건) | **본 SPEC 범위 밖** — [SPEC-ACCOUNT-001](../SPEC-ACCOUNT-001/) 소관(§7 비범위 참조). |

## 4. 가정 (Assumptions)

- 기존 스택만 사용(신규 의존성 0). NestJS 백엔드 + Prisma + Supabase(RLS default-deny), apps/web은 Server Component + Server Action + `revalidatePath`(React Query 미사용, 채팅은 raw useState).
- 모든 user 참조 컬럼은 코드베이스 컨벤션대로 **FK 없는 TEXT soft-ref**(profile 삭제/게스트 무관). 차단·신고 매칭 키는 `userId`(sub)만 사용(게스트·명명 계정 동일 취급).
- 인가는 서비스 WHERE절 내장(`blockerId == sub` / `reporterId == sub`) — notification 선례. ValidationPipe 부재가 컨벤션이라 명시적 검증 헬퍼로 400 판정.
- block/report 테이블은 **SAFETY-001이 선행 생성**해야 SPEC-ACCOUNT-001이 고아 행 정리 대상을 가진다(구현 순서 고정).

## 5. 요구사항 (EARS Requirements)

요구사항 모듈: 5개(모듈 개수 ≤5 한도 준수). 각 REQ는 단일 응집 행위 묶음을 기술하며 커버 AC를 표기한다(일부 REQ는 멱등·자기차단·수락/거부 등 분리 불가한 부속 조건을 함께 명세). 엔드포인트 경로·DB 연산 세부는 plan.md/§6 Delta Markers에 둔다.

### 모듈 1 — REQ-RPT (신고)

#### REQ-RPT-001 [Event-driven] — 신고 저장
**When** 사용자가 특정 UGC 항목을 사유와 함께 신고하면, 시스템은 신고 행(신고자·대상 유저·모임·사유·콘텐츠 타입·콘텐츠 참조)을 저장한다(shall). — AC: AC-RPT-1

#### REQ-RPT-002 [Event-driven] — 신고자 측 즉시 숨김 (차단과 분리)
**When** 신고가 접수되면, 시스템은 신고자 본인 화면에서 해당 콘텐츠(및 동일 작성자 UGC)를 즉시 숨긴다(shall). 이 숨김의 진실 공급원은 신고(reporter=sub → target)이며 신고만으로는 차단 행을 생성하지 않는다(신고 ≠ 차단). — AC: AC-RPT-2

#### REQ-RPT-003 [Event-driven] — 신고 후 차단 유도 (prompt)
**When** 신고가 성공하면, 시스템은 신고자에게 "이 멤버를 차단할까요?" 후속 유도를 노출한다(shall). **If** 신고자가 수락하면, **then** 시스템은 이 시점에 비로소 차단 행을 생성한다(REQ-BLK-001 재사용). **If** 거부하면, **then** 신고자 측 숨김(신고 기반)은 유지되되 차단 행은 생성되지 않는다. — AC: AC-RPT-3

#### REQ-RPT-004 [Unwanted] — 복합 PK 콘텐츠 신고 거부
**If** 신고 대상이 복합 PK 콘텐츠(poll_vote / expense_share / schedule_slot)이면, **then** 시스템은 신고를 거부한다(400)(shall) — 단일 PK 콘텐츠만 신고 대상(chat_message / poll / expense / settlement_request). — AC: AC-RPT-4

#### REQ-RPT-005 [Ubiquitous] — 콘텐츠 참조 타입 통일
시스템은 신고 콘텐츠 참조를 TEXT로 저장하고, 콘텐츠 타입이 `chat_message`일 때만 필터 시 BigInt로 캐스팅한다(shall). — AC: AC-RPT-4

### 모듈 2 — REQ-BLK (차단)

#### REQ-BLK-001 [Event-driven] — 차단 생성 (멱등)
**When** 사용자가 멤버 목록 또는 신고 후 유도에서 특정 멤버를 차단하면, 시스템은 차단 행(차단자, 차단 대상)을 생성한다(shall). 이미 존재하면 멱등하게 성공을 유지한다(자기 차단은 400). — AC: AC-BLK-1

#### REQ-BLK-002 [Event-driven] — 차단 해제
**When** 사용자가 차단을 해제하면, 시스템은 해당 차단 행을 삭제한다(shall). 신고 기반 숨김은 불변이다(차단 해제 ≠ 신고 취소). — AC: AC-BLK-2

#### REQ-BLK-003 [Ubiquitous] — 매칭 키는 userId
시스템은 차단 매칭 키로 `userId`(sub)만 사용한다(profile/nickname 무관 — 게스트·명명 계정 동일 취급)(shall). — AC: AC-BLK-1

#### REQ-BLK-004 [Ubiquitous] — 차단 목록 조회·해제 (프로필 내 섹션)
시스템은 기존 프로필/설정 화면 내 "차단한 멤버" 섹션에서 내 차단 목록 조회 + 차단 해제 수단을 제공한다(shall). 전용 라우트는 신설하지 않는다(최소 배치 — 섹션 위치는 배치 제약이지 기능 선택이 아니다). — AC: AC-BLK-3

#### REQ-BLK-005 [State-driven] — 멤버 목록 노출 유지
**While** 차단이 활성인 동안, 시스템은 차단 대상 멤버를 멤버 목록에는 그대로 노출한다(닉네임 보존, 차단 해제 진입점 겸용)(shall). — AC: AC-BLK-3

### 모듈 3 — REQ-FLT (뷰어 측 필터)

#### REQ-FLT-001 [State-driven] — 채팅 필터 (서버+클라이언트)
**While** 멤버 B가 사용자 A에게 차단된 동안, 시스템은 A의 채팅 히스토리 응답에서 B의 메시지를 서버 쿼리로 제외하고, A의 실시간 신규 메시지도 클라이언트에서 드롭한다(서버·클라이언트 동시)(shall). — AC: AC-FLT-1

#### REQ-FLT-002 [State-driven] — 투표 필터 (집계 불변)
**While** B가 A에게 차단된 동안, 시스템은 A의 투표 목록에서 B가 생성한 poll을 제외한다(shall). 단, 표 집계 수치는 변경하지 않는다(익명 집계 유지). — AC: AC-FLT-2

#### REQ-FLT-003 [State-driven] — 지출·정산 필터 (행 유지 + 작성자 마스킹)
**While** B가 A에게 차단된 동안, 시스템은 A의 지출 표시 목록에서 B가 만든 expense 행 및 B가 요청자(`requester_id`)인 settlement_request 행을 제거하지 않고 작성자/요청자 표시만 '차단한 멤버'로 마스킹한다(shall). settlement_request도 동일 expenses-view 표면에서 렌더되고 신고 대상 타입이므로 expense와 동일 규칙(행 유지+작성자 마스킹)을 적용한다. 단, 정산 계산·합계(balance/transactions/total)에는 원본 그대로 포함한다(원장 정합성 우선 — 완전 숨김이 아니라 행 유지+작성자 마스킹). 마스킹 라벨 '차단한 멤버'는 hidden 집합(block∪report union)의 **두 소스 모두**에 적용된다 — 신고만 하고 차단하지 않은 대상의 행도 동일 라벨로 마스킹된다(union 필터 특성상 소스 구분 없음, 사용자 확정 라벨 유지). — AC: AC-FLT-3

#### REQ-FLT-004 [State-driven] — 일정 슬롯 필터 (협업 편집 제외)
**While** B가 A에게 차단된 동안, 시스템은 A의 일정 히트맵 응답에서 B의 가용 슬롯을 제외한다(shall). 날짜/시간대 협업 편집(dates/window)은 작성자 추적이 없어 필터 불가(한계 명시). — AC: AC-FLT-4

#### REQ-FLT-005 [State-driven] — 알림 액터 필터
**While** B가 A에게 차단된 동안, 시스템은 A의 알림 피드에서 액터가 B인 알림을 제외한다(shall). 시스템 알림·액터 없는 알림은 무관. — AC: AC-FLT-5

#### REQ-FLT-006 [State-driven] — FCM 발신 경로 역방향 억제
**While** B가 A에게 차단된 동안(A가 B를 차단), 시스템은 B가 발신한 채팅 메시지의 FCM 푸시 수신 대상에서 A를 제외한다(shall) — 차단 대상 UGC(메시지 미리보기)가 A의 잠금화면에 도달하지 않도록. 이 발신 필터는 역방향(recipient가 sender를 차단)이며 명시적 차단(block)만 억제한다(신고 기반 숨김은 push를 억제하지 않는다). — AC: AC-FLT-6

### 모듈 4 — REQ-CPL (모듈 경계 · 인가)

#### REQ-CPL-001 [Ubiquitous] — 필터 단일 출처
시스템은 신규 `safety` 모듈에 신고·차단 도메인을 격리하고, `getHiddenUserIds(sub)`를 뷰어 측 필터 주입의 단일 출처로 제공한다(shall). 이 메서드는 차단(blocker=sub → blocked)과 신고(reporter=sub → target)를 union해 "이 뷰어에게 숨겨야 할 userId 집합"을 반환하며, 두 소스는 독립이라 차단 해제가 신고 숨김을 되살리지 않는다. — AC: AC-CPL-1

#### REQ-CPL-002 [Ubiquitous] — 비순환 경계
시스템은 safety 모듈이 생산 도메인(chat/poll/expense/schedule/notification/push)을 import하지 않도록 유지한다(shall not import) — 소비 도메인이 `BlockService`를 import(단방향). — AC: AC-CPL-2

#### REQ-CPL-003 [Ubiquitous] — WHERE 내장 인가
시스템은 차단/신고 인가를 서비스 WHERE절의 `blockerId == sub` / `reporterId == sub` 내장으로 판정한다(shall) — 컨트롤러 body/query 불신(notification 선례). — AC: AC-CPL-3

#### REQ-CPL-004 [Ubiquitous] — RLS default-deny
시스템은 `block`·`report` 테이블에 RLS enable + 정책 없음(default deny)을 적용해 PostgREST 직독을 차단한다(shall). — AC: AC-CPL-3

### 모듈 5 — REQ-STO (스토어 정책 준수)

#### REQ-STO-001 [Ubiquitous] — 신고 데이터 보존
시스템은 신고 데이터를 운영자가 수동 DB 조회로 검토할 수 있도록 검토에 필요한 필드(대상 유저·모임·사유·콘텐츠 참조·시각)를 보존한다(shall). — AC: AC-STO-1

#### REQ-STO-002 [Ubiquitous] — 24시간 조치 운영 절차
시스템은 24시간 내 조치 요건을 운영 절차 문서로 대응한다(shall) — 관리자 UI·자동 워크플로우는 미구축. — AC: AC-STO-1

## 6. 변경 마커 (Delta Markers — Brownfield)

| 모듈 | 산출물 | 마커 |
|---|---|---|
| 1·2 | `apps/backend/src/safety/**` (module/controller/service/dto/spec) | [NEW] |
| 1·2 | `apps/backend/prisma/schema.prisma` (Block, Report 모델) | [MODIFY] |
| 1·2 | `apps/backend/prisma/migrations/<ts>_add_safety/migration.sql` | [NEW] |
| 1·2 | `apps/backend/src/app.module.ts` (SafetyModule 등록) | [MODIFY] |
| 3 (읽기) | `chat.service.ts` / `poll.service.ts` / `expense.service.ts` / `schedule.service.ts` / `notification.service.ts` | [MODIFY] |
| 3 (발신) | `push.listener.ts` (수신자 산정 역방향 차감 — REQ-FLT-006) | [MODIFY] |
| 3 | 각 소비 도메인 `*.module.ts` + `push.module.ts` (SafetyModule import → BlockService 주입) | [MODIFY] |
| 3 | `apps/web/app/moims/[id]/chat/page.tsx` (신고 진입 + 실시간 필터 + state 초기화) | [MODIFY] |
| 2·4 | `apps/web/app/(main)/home/[id]/members-section.tsx` (차단 버튼) + `member-actions.ts` (blockAction) | [MODIFY] |
| 2·4 | `apps/web/app/(main)/profile/**` ("차단한 멤버" 섹션 — 목록·해제) | [MODIFY] |
| 2·4 | `apps/web/lib/safety/*` (신규 fetch 헬퍼 — polls.ts 패턴 미러) | [NEW] |
| 4 | `apps/backend/openapi.json` + `packages/api-client/src/schema.d.ts` | [REGEN] |
| 3·5 | chat/poll/expense/schedule/notification 응답 DTO·타입(작성자 표면) | [EXISTING] (스키마 무변경 — 서버 필터·마스킹만) |

## 7. 비범위 (Exclusions — What NOT to Build)

- **관리자 검토 UI / 자동 모더레이션 워크플로우** — report는 저장만. 운영 검토는 수동 DB 조회 절차(문서). 추후 별도 SPEC.
- **글로벌 콘텐츠 삭제·익명화** — 차단은 뷰어 측 필터일 뿐. 원 콘텐츠·닉네임·집계는 전역 보존(삭제 전략 기각).
- **차단 대상 지출 행의 표시 목록 완전 제거** — 지출은 금액·정산 무결성을 위해 행을 유지하고 작성자 표시만 마스킹한다(REQ-FLT-003 확정). 채팅/투표/일정/알림과 달리 지출은 행 제거가 아니라 작성자 마스킹.
- **양방향(2-way) 차단** — 1-way 확정. 차단 대상은 차단자 콘텐츠를 계속 본다.
- **복합 PK 콘텐츠 신고**(poll_vote / expense_share / schedule_slot) — 단일 PK 4종만 신고 대상.
- **poll / expense / settlement_request 신고 진입점 UI** — v1 웹 신고 진입점은 **채팅 메시지 말풍선 한정**. 백엔드 `POST /reports`는 4종(chat_message / poll / expense / settlement_request)을 모두 수용하나, poll·expense·settlement_request 표면의 신고 버튼 UI는 v1 범위 밖(추후 확장). Delta Markers는 chat/page.tsx 신고 진입만 포함.
- **일정 협업 편집(dates/window) 필터** — 작성자 추적 부재로 필터 불가(슬롯만).
- **실시간 브로드캐스트 서버 측 수신자별 필터** — per-moim 채널 아키텍처상 불가(클라이언트 필터로 대체). 네트워크 페이로드는 관찰 가능하며 UI 숨김이 목표.
- **notification fan-out(인앱 알림 생성) 발신 시점 역방향 차감** — 읽기 경로(REQ-FLT-005)가 이미 커버하므로 비필수. 채팅 FCM push(REQ-FLT-006)만 발신 필터 대상(잠금화면 노출은 push 한정 문제).
- **차단 전 이미 발송된 push의 리보크** — REQ-FLT-006은 차단 이후 신규 발신만 억제(기발송 회수 수용).
- **차단 목록 전용 설정 라우트** — 프로필/설정 화면 내 "차단한 멤버" 섹션으로 대체(REQ-BLK-004).
- **모바일 네이티브 변경** — 브리지/라우트/SecureStore 무변경(전 표면 WebView 웹 UI).
- **회원 탈퇴 / 인앱 계정 삭제** — [SPEC-ACCOUNT-001] 소관. **block/report 고아 행 정리는 ACCOUNT-001이 소유**(본 SPEC은 테이블·필터만 제공, 정리 로직은 ACCOUNT `deleteAccount` 트랜잭션에 prisma 직접 접근으로 추가). 탈퇴 사용자 연관 report 행은 ACCOUNT 탈퇴 트랜잭션에서 **삭제**(감사 보존 테이블 이관 없음). 구현 순서: SAFETY 테이블 선행.
- **신규 의존성** — 0개. 기존 스택만 사용.

## 8. 의존성 (Dependencies)

- 선행/연계 SPEC: [SPEC-CHAT-002](../SPEC-CHAT-002/)(push.listener 발신 경로 — REQ-FLT-006 삽입 지점), [SPEC-ACCOUNT-001](../SPEC-ACCOUNT-001/)(block/report 고아 행 정리 소유 — SAFETY 테이블 선행 전제).
- 소비 도메인: chat / poll / expense / schedule / notification(각 목록 서비스에 `BlockService` 주입), push(발신 역방향 차감).
- 기존 자산: `SupabaseAuthGuard`, Prisma global, EventEmitter(chat.message.created 계약), RLS default-deny 마이그레이션 선례(`20260701200000_add_notification`).

## 9. 품질 게이트 (Quality Gate)

- 백엔드: jest TDD test-first, 커버리지 85%+ (getHiddenUserIds union / getBlockersOf 역방향 / createReport 화이트리스트·빈 사유·block 미생성 / createBlock 자기차단·멱등 / unblock 멱등·신고 숨김 불변 / 각 소비 서비스 필터 반영 / push 역방향 차감).
- 느슨한 결합 정적 검사: safety ↛ 생산 도메인/push import 부재(grep). push → safety 단방향만 허용.
- apps/web: **테스트 프레임워크 부재** — `nx run web:build` + `nx lint web` 0 error로만 검증(웹 테스트 하네스 설치하지 않음).
- `nx lint backend` clean(백엔드 ESLint strict). openapi.json + api-client 재생성 후 typecheck 통과.
