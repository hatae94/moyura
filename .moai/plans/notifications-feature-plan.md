---
title: 인앱 알림(Notifications) 기능 구현 계획
status: approved-plan
created: 2026-07-01
updated: 2026-07-01
author: hatae
scope: multi-milestone (M1~M6, 각 마일스톤은 착수 시 별도 SPEC 로 승격)
---

# 인앱 알림(Notifications) 기능 구현 계획

> 이 문서는 구현 착수 전 **확정된 아키텍처·범위 계획**이다. 개별 마일스톤(M1~M6)은 착수 시
> `manager-spec` 으로 EARS SPEC(`.moai/specs/SPEC-NOTIFICATIONS-00N/`)으로 승격한다.

## 1. 배경 / 현재 상태

- 웹 알림 탭은 **순수 플레이스홀더**: `apps/web/app/(main)/notifications/page.tsx` → `PlaceholderTab`.
- 하단 탭 배지는 **mock 하드코딩**: `apps/web/app/(main)/layout.tsx` 의 `<BottomTabBar notificationCount={2} />`.
- 백엔드에 **알림 엔티티/피드/엔드포인트가 전혀 없음**. 유일한 도메인 이벤트는 `chat.message.created`
  (`apps/backend/src/chat/chat-events.ts` → EventEmitter2 → `apps/backend/src/push/push.listener.ts`
  `@OnEvent` → `FcmSender`), chat→push 단방향 느슨한 결합.
- 일정·초대·투표·경비·멤버 변동은 알림으로 승격되지 않음(일부는 realtime 방송으로 화면만 갱신).

### 계획 중 확인된 정정 3가지
1. 마이그레이션 위치는 **`apps/backend/prisma/migrations/`** (supabase/ 아님).
2. 이 코드베이스는 **Prisma enum 미사용** 컨벤션(`poll.kind`·`expense.category`·`device_token.platform` 모두 String) → 알림 `type` 도 **String 컬럼**.
3. 배지 mock 주입 지점은 `BottomTabBar` 가 아니라 **`layout.tsx` 의 하드코딩 `notificationCount={2}`**.

## 2. 확정된 제품 결정 (사용자)

| 항목 | 결정 | 영향 |
|---|---|---|
| 아키텍처 | **정식 백엔드 피드** (notification 테이블 + 이벤트 기반 + 영속 read/unread + 실시간 배지) | 기반 신설 |
| 알림 종류 | **참여·멤버 / 일정 / 투표 / 경비** (채팅 제외 — FCM + 채팅탭 배지 유지) | — |
| 읽음·배지 | **영속 read/unread + 실시간 미읽음 배지** | read_at + user:{id} 실시간 |
| 정산 | **'정산 요청' 액션 신규 추가** (요청→완료 2단계) | ⚠️ 백엔드 기능 추가: settlement 요청 상태/엔드포인트. 이벤트 `settlement.requested`(채무자에게)+`settlement.completed`(요청자에게) |
| 경비 추가 수신자 | **분담 참가자만** | 수신자 = `expense_share.userId − actor` |
| 방장 위임 수신자 | **모임 전체 공지** | 수신자 = 멤버 − actor (신 방장 강조) |
| 투표 마감 | **`poll.closed` 하나만** | 날짜·장소 확정 별도 알림 안 함(소음 방지) |
| 기본값 | 알림 보존 **90일**, 목록 **limit 20** | 정리 잡 + 페이지네이션 |

## 3. 데이터 모델

### fan-out(수신자당 1행) 채택
모임 정원이 작다(`moim.maxMembers` 기본 15·상한 존재) → 이벤트당 fan-out 쓰기 ≤15행으로 유계.
대신 read/unread·unread-count 가 단일 인덱스 O(log n). `read_at` 이 행 자체에 있어 per-item/mark-all-read 자명.
push.listener 의 수신자 fan-out 과 동형이라 리스너 로직 답습 가능.

### Prisma 모델 (`apps/backend/prisma/schema.prisma` additive)
```prisma
model Notification {
  id          BigInt    @id @default(autoincrement())   // keyset 커서(chat_message 선례), DTO 는 id.toString()
  recipientId String    @map("recipient_id")            // 수신자 sub(가드-검증 sub 만)
  type        String                                    // enum 아님(컨벤션). 허용값은 리스너 상수
  moimId      String    @map("moim_id")                 // 컨텍스트 모임(현 전 타입 moim-scoped)
  actorId     String?   @map("actor_id")                // 유발자 sub(nullable — 무행위자 대비). nickname 미저장
  data        Json      @default("{}")                  // 타입별 미리보기 + 딥링크 타깃 id
  readAt      DateTime? @map("read_at")                 // nullable = 안읽음
  createdAt   DateTime  @default(now()) @map("created_at")
  moim        Moim      @relation(fields: [moimId], references: [id], onDelete: Cascade)

  @@index([recipientId, id(sort: Desc)])                // 피드 keyset
  @@index([recipientId, readAt])                        // unread-count / mark-all
  @@map("notification")
}
```
`Moim` 에 역참조 additive: `notifications Notification[]`.

### 마이그레이션 (prisma/migrations, 선례 답습)
- `prisma migrate` 로 테이블+인덱스 생성.
- 같은 SQL 파일 하단 수동 블록: (1) `ENABLE ROW LEVEL SECURITY`(정책 없음=default deny, PostgREST 직독 차단; Prisma=postgres 롤 무영향), (2) per-user 방송 트리거(§5), (3) `realtime.messages` SELECT RLS. `to_regnamespace('realtime')` 가드로 shadow DB 생략. 수동 SQL 은 `.moai/project/db/` 문서화.

### RLS
웹은 **백엔드 API 로만** 알림을 읽는다(전 도메인 동일) → notification 테이블은 RLS enable + 정책 없음(직독 차단만). 실시간 배지 구독만 `realtime.messages` RLS 게이트(§5). 근거: Supabase 직독을 열면 인가가 두 곳(백엔드+RLS)으로 분산 → 드리프트 위험.

## 4. 이벤트 분류 + 발행 지점

계약 스타일: 각 생산 도메인이 자신의 `events.ts` 소유·export(chat-events 미러), `NotificationListener` 가 `@OnEvent` 구독, **도메인은 알림을 인식하지 않음**(느슨한 결합). 페이로드는 식별자+미리보기만(nickname/모임명 제외). 영속(트랜잭션) **성공 후, 트랜잭션 완료 이후** emit + try/catch 격리(chat.service 선례). EventEmitter2 다중 구독으로 `NotificationListener`(인앱)와 `PushListener`(FCM, M6) 공존.

| 알림 type | 도메인 액션(메서드/파일) | 이벤트명 | 수신자 |
|---|---|---|---|
| `member.joined` | `InviteService.accept()` 신규 성공 경로만 (invite/invite.service.ts) | `moim.member.joined` | 기존 멤버 − 신규 |
| `owner.delegated` | `MoimService.transferOwner()` (moim/moim.service.ts) | `moim.owner.transferred` | **모임 전체 − actor**(신 방장 강조) |
| `member.kicked` | `MoimService.kickMember()` | `moim.member.kicked` | **퇴장자(targetId)만** |
| `schedule.started` | `ScheduleService.setSchedule()` create 경로 | `moim.schedule.started` | 멤버 − actor |
| `schedule.dates_changed` | `ScheduleService.updateDates()` | `moim.schedule.dates_changed` | 멤버 − actor |
| `schedule.window_changed` | `ScheduleService.updateWindow()` | `moim.schedule.window_changed` | 멤버 − actor |
| `schedule.confirmed` | `ScheduleService.confirmSchedule()` | `moim.schedule.confirmed` | 멤버 − actor |
| `poll.created` | `PollService.createPoll()` (poll/poll.service.ts) | `moim.poll.created` | 멤버 − actor |
| `poll.closed` | `PollService.closePoll()` | `moim.poll.closed` | 멤버 − actor (날짜·장소 확정 별도 알림 안 함) |
| `expense.added` | `ExpenseService.createExpense()` (expense/expense.service.ts) | `moim.expense.added` | **분담 참가자(expense_share.userId) − actor** |
| `settlement.requested` | **신규** `ExpenseService.requestSettlement()` (M2 추가) | `moim.settlement.requested` | **채무자(to-pay)** |
| `settlement.completed` | `ExpenseService.createSettlement()` | `moim.settlement.completed` | **요청자(counterparty)** |

주의: `setSchedule` 재설정(update) 경로도 알림할지 M2 확정(기본: create 만). accept 멱등/경합(P2002) 경로 emit 금지(유령/중복 주 위험).

## 5. NotificationListener + 실시간 배지

- **리스너**(`notification/notification.listener.ts`, push.listener 미러): 이벤트별 수신자 계산(moim-wide → `moimMember.findMany` 에서 actor 제외 / targeted → 페이로드 명시 id) → `notification.createMany`(수신자당 1행) → try/catch best-effort 격리. 배지 실시간은 리스너가 아니라 **DB 트리거**가 담당.
- **배지 트리거**: `notification` AFTER INSERT row 트리거 → `realtime.send(thin payload, 'notification_new', 'user:'||recipient_id, true)`, SECURITY DEFINER + `search_path=''`. fan-out N행 → 각기 다른 `user:{id}` 토픽으로 발화 → 사용자당 1회 수신(폭주 없음).
- **realtime RLS**(moim RLS 보다 단순, 조인 불필요):
  ```sql
  CREATE POLICY "users can receive own notifications" ON realtime.messages
    FOR SELECT TO authenticated
    USING ( realtime.topic() = 'user:' || (SELECT auth.uid())::text );
  ```
- **웹 구독**(`apps/web/lib/notifications/useNotificationChannel.ts`, useScheduleChannel 미러): `setAuth(access_token)` + `channel('user:'+sub, {private:true})` → `notification_new` 수신 시 unread-count 재조회(또는 낙관적 +1). 모임 무관 전역 1구독.

## 6. 백엔드 API (신규 NotificationModule, thin 컨트롤러 + 명시 검증)

**인가 = `recipientId === user.sub`**(assertMember 아님 — kick 당한 사용자도 자기 알림 열람). 모든 쿼리 `recipientId=sub` 필터 → 교차 접근 구조적 불가.

| 메서드/경로 | 설명 |
|---|---|
| `GET /notifications?cursor=&limit=` | keyset 페이지네이션(chat getHistory 미러). 페이지 행의 `(moimId, actorId)` 배치 조회로 nickname/moimName **응답 시점 해석**. `{ items, nextCursor }`, id/cursor 문자열 |
| `GET /notifications/unread-count` | `count({ recipientId:sub, readAt:null })` → `{ count }` |
| `POST /notifications/read` | body `{ ids?[] }` 또는 `{ all?:true }` → `updateMany({ recipientId:sub, readAt:null, ...ids }, { readAt:now })` |

`NotificationDto`: `{ id(string), type, moimId, moimName, actor:{id,nickname}|null, data, readAt(string|null), createdAt(string) }`.
검증 헬퍼: `requireInt(limit)`, cursor BigInt 파싱(실패 400), `requireStringArray(ids)`.
모듈: `NotificationModule = { imports:[AuthModule, MoimModule], controllers:[NotificationController], providers:[NotificationService, NotificationListener] }`. app.module 뒤쪽 등록(PushModule 처럼).

## 7. 웹 UI (플레이스홀더 교체)

`notifications/page.tsx` 서버 컴포넌트 전환: `requireNamedSession()` → 첫 페이지 `GET /notifications`+unread-count 서버 fetch → 클라 `NotificationFeed`.
- **헤더**: "알림" + unread>0 시 "모두 읽음"(`POST /read {all:true}` → 낙관적 0).
- **날짜 그룹**: 오늘/어제/이전(createdAt KST).
- **무한 스크롤**: nextCursor(IntersectionObserver), limit 20.
- **아이템**: 타입 아이콘(lucide) 또는 actor 아바타 + 카피 + 상대시간 + 모임명 + 안읽음 점(`bg-gradient-brand`) + 탭 → 딥링크.
- **읽음**: 탭 시 `POST /read {ids:[id]}` 후 이동 + "모두 읽음"(스크롤-자동읽음은 후속).
- **빈 상태**: 아이콘 + "아직 알림이 없어요".
- **디자인 주의**: `text-gradient-brand` 는 배경 유틸과 같은 요소 금지(background-image 충돌) — 별도 요소 분리. unread dot 은 bg-gradient(텍스트 아님)라 안전.
- **BottomTabBar**: layout 의 하드코딩 `notificationCount={2}` 제거 → `NotificationCountProvider`(context, 초기 count 서버 fetch + useNotificationChannel 구독)에서 실카운트 소비.

### 타입별 카피·아이콘·딥링크 (전 타입)
| type | 카피 | 아이콘 | 라우트 |
|---|---|---|---|
| `member.joined` | `{닉}님이 {모임}에 참여했어요` | UserPlus | `/home/[id]` |
| `owner.delegated` | `{모임}의 방장이 {닉}님에게 위임됐어요` | Crown | `/home/[id]` |
| `member.kicked` | `{모임}에서 내보내졌어요` | UserMinus | `/home` |
| `schedule.started` | `{모임} 일정 조율이 시작됐어요` | CalendarClock | `/moims/[id]/schedule` |
| `schedule.dates_changed` | `{모임} 후보 날짜가 바뀌었어요` | CalendarDays | `/moims/[id]/schedule` |
| `schedule.window_changed` | `{모임} 조율 시간대가 넓어졌어요` | Clock | `/moims/[id]/schedule` |
| `schedule.confirmed` | `{모임} 일정이 {startsAt}로 확정됐어요` | CalendarCheck | `/moims/[id]/schedule` |
| `poll.created` | `{닉}님이 투표를 만들었어요: {질문}` | BarChart3 | `/home/[id]` |
| `poll.closed` | `투표가 마감됐어요: {질문}` | CheckCircle2 | `/home/[id]` |
| `expense.added` | `{모임}에 경비 {금액}원({분류})이 추가됐어요` | Receipt | `/moims/[id]/expenses` |
| `settlement.requested` | `{닉}님이 {금액}원 정산을 요청했어요` | HandCoins | `/moims/[id]/expenses` |
| `settlement.completed` | `정산 {금액}원이 완료됐어요` | HandCoins | `/moims/[id]/expenses` |

> 모임 라우팅 비대칭: 허브 = `/home/[id]`(멤버·투표 인라인), 일정·경비 = `/moims/[id]/*`.

## 8. 모바일 / FCM

**단계 분리**: M1~M5 는 FCM 무변경(채팅 전용). M6 에서 도메인 무변경으로 `PushListener`(또는 신규 리스너)에 **고신호 3종**(`member.joined`·`schedule.confirmed`·`settlement.completed`) `@OnEvent` 추가 → FCM 멀티캐스트. `data` 페이로드에 `{ type, moimId, targetId }` 실어 탭 시 §7 라우트 딥링크. 근거: 인앱 피드는 로컬 완전 검증 가능, FCM 만 실기기/자격증명 게이트라 뒤로.

## 9. 마일스톤

| MS | 범위 | 수용 기준 |
|---|---|---|
| **M1** | notification 모델·마이그(테이블/인덱스/RLS enable), NotificationModule 골격, NotificationListener, **member.joined 수직 관통** | jest(fake Prisma): accept 신규 성공 시 수신자당 1행 + 멱등/경합 미발행; nx lint backend |
| **M2** | 5개 도메인 events.ts + EventEmitter2 주입 + emit 전체, **정산 요청 액션 신규**, 이벤트별 수신자(moim-wide/targeted/share) | 각 액션 spec: 이벤트 발행 + fan-out 수신자 집합; kick/settlement/expense 타깃 검증 |
| **M3** | 읽음 API(GET 목록 keyset+해석, unread-count, POST read), recipient==sub 인가 | spec: 남의 알림 미노출·미갱신, 커서, read_at, count 정확성 |
| **M4** | INSERT 트리거(user:{id}) + realtime RLS, useNotificationChannel, NotificationCountProvider, BottomTabBar 실카운트 | 로컬 Supabase+minted JWT: 방송·RLS(자기 토픽만); nx build/lint web |
| **M5** | 웹 알림 탭(피드·날짜그룹·카피/아이콘/딥링크·모두읽음·무한스크롤·빈상태·읽음) | 로컬 웹 E2E(테스트 계정): 표시·딥링크·읽음·배지 감소; build/lint |
| **M6** | FCM 확장(고신호 3종 + data 딥링크) — 디바이스 게이트 | jest 로컬; 실배달은 FIREBASE_CREDENTIALS+실기기 게이트 |

의존: M1→M2→M3→M4→M5, M6 은 M2 이후 병렬(게이트).

## 10. 추천 진행안
백엔드 우선 수직슬라이스: **M1 `member.joined`** 로 fan-out·트랜잭션후-emit·RLS 스캐폴딩 확정(수신자 계산이 가장 단순 + 체감가치 높음) → 이후 도메인 복붙 확장(M2). M3 읽음 → M4 배지까지 오면 "백엔드가 낳고 웹이 실시간 반영" 성립 → M5 웹 탭 → M6 FCM 마지막.

## 11. 리스크
| 리스크 | 완화 |
|---|---|
| Fan-out 쓰기량 | 정원 상한(≈15) 유계, createMany 배치, best-effort 격리 |
| per-user 실시간 RLS/auth | `realtime.topic()=='user:'||auth.uid()` 정책 + setAuth 필수, 로컬 minted JWT 검증 |
| 마이그 순서/드리프트 | to_regnamespace 가드(shadow DB 생략), `.moai/project/db/` 문서화 |
| 발행 중복/유령 | 성공 경로만·트랜잭션 완료 후 emit(chat.service 선례) |
| 수신자 전략 혼선 | 페이로드 명시 target id, spec 고정(테스트) |
| BigInt 직렬화 | DTO id.toString() + 커서 문자열 |
| 웹 테스트 하네스 부재 | 백엔드 jest(fake Prisma) 커버, 웹 build/lint + 로컬 E2E(owner-test 계정) |
| CI 게이트 | 각 MS 완료 시 `nx lint backend` 필수 |

## 12. 참조 파일
- backend: `prisma/schema.prisma`, `prisma/migrations/`, `src/chat/chat-events.ts`·`chat.service.ts`, `src/push/push.listener.ts`·`fcm-sender.ts`·`push.module.ts`, `src/moim/moim.service.ts`, `src/invite/invite.service.ts`, `src/schedule/schedule.service.ts`·`schedule.controller.ts`·`schedule.service.spec.ts`, `src/poll/poll.service.ts`, `src/expense/expense.service.ts`, `app.module.ts`
- web: `app/(main)/notifications/page.tsx`, `app/(main)/_components/BottomTabBar.tsx`, `app/(main)/layout.tsx`, `app/(main)/home/[id]/page.tsx`, `lib/schedule/useScheduleChannel.ts`, `lib/auth/require-named-session.ts`, `packages/api-client/src/index.ts`
