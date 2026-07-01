# Sync Report: 인앱 알림(Notifications) M1~M6

| 항목 | 값 |
|---|---|
| 날짜 | 2026-07-02 |
| 머지 커밋 | d707420 (master) |
| 관련 마일스톤 | M1 5867ee2 · M2 127190f · M3 e96857f · M4a ec5196a · M4b 04e51fa · M5 8739711 · M6 4aaa33c |
| 담당 SPEC | SPEC-NOTIFICATIONS-001 (계획: `.moai/plans/notifications-feature-plan.md`) |

---

## 개요

인앱 알림의 전체 스택을 신설했다. 주요 구성 요소는 다음과 같다.

**notification 테이블** — 수신자당 1행 fan-out, BigInt keyset PK(chat_message 선례), `read_at` 영속 읽음, `user:{recipient_id}` per-user private 채널 실시간 배지. 정원 상한(≈15)으로 fan-out 쓰기가 유계라 unread-count/mark-all 인덱스 O(log n)으로 충분.

**도메인 이벤트 12종** — `member.joined` · `owner.delegated` · `member.kicked` · `schedule.started` · `schedule.dates_changed` · `schedule.window_changed` · `schedule.confirmed` · `poll.created` · `poll.closed` · `expense.added` · `settlement.requested` · `settlement.completed`. 각 도메인이 자신의 `events.ts`를 소유하고 `NotificationListener`가 `@OnEvent` 구독. 도메인은 알림을 인식하지 않음(느슨한 결합, PushListener 선례 미러).

**읽음 API 3종** — `GET /notifications` (keyset 목록 + moimName/actorNickname 배치 해석), `GET /notifications/unread-count`, `POST /notifications/read` (per-item `{ids}` / all `{all:true}`). 인가 = `recipientId === user.sub` (assertMember 아님 — 퇴장자도 자기 알림 열람 가능).

**실시간 배지** — `notification` AFTER INSERT FOR EACH ROW 트리거 → `realtime.send({type}, 'notification_new', 'user:{recipientId}', private)`. SECURITY DEFINER + `search_path=''`. best-effort EXCEPTION WHEN 감싸기로 방송 실패가 fan-out INSERT를 절대 중단시키지 않음. 웹은 `useNotificationChannel`(전역 1구독) → `notification_new` 수신 시 unread-count 재조회.

**웹 알림 탭** — 12 타입 딥링크·카피·아이콘, 날짜 그룹(오늘/어제/이전), 무한 스크롤(nextCursor), 모두읽음, `NotificationCountProvider`(context, 초기 count 서버 fetch + 실시간 구독 연결). `BottomTabBar` 하드코딩 `notificationCount={2}` 제거 → 실카운트 소비.

**FCM 고신호 3종** — `member.joined` · `schedule.confirmed` · `settlement.completed`. `PushListener` 기존 채팅 전용 구조 위에 `@OnEvent` 추가. `data` 페이로드에 `{type, moimId}` 실어 딥링크 대응.

---

## 배포 상태

| 항목 | 상태 |
|---|---|
| master 머지 | d707420 완료 + push 완료 |
| CI (verify) | 그린 |
| Prod DB 마이그레이션 | 완료 (`add_notification` · `add_settlement_request` · `add_notification_realtime_broadcast` 3종) |
| Render 백엔드 | 자동 배포 완료 (`moyura-backend.onrender.com`) |
| Vercel 웹 | 자동 배포 완료 |

---

## 계획 대비 Divergence

### 1. 정산 요청 기능 신설 (순수 알림 범위 초과)

계획에 `settlement.requested` · `settlement.completed` 이벤트가 포함되어 있었으나, 이벤트를 발행하려면 **정산 요청 액션 자체**가 필요했다. 구현 결과 `SettlementRequest` 테이블 신설 + `POST /moims/:id/settlements/request` 엔드포인트 추가가 scope에 포함됐다. 기존 `Settlement`(정산 완료 스냅샷)와 별도 테이블로 분리 — `Settlement`의 `(from,to,amount)` 매칭 로직에 요청(pending) 행이 섞이면 `settled` 계산이 오염되는 회귀 위험을 방지.

### 2. owner.delegated 카피 분기

계획 상 `owner.delegated` 카피: `{모임}의 방장이 {닉}님에게 위임됐어요` 단일 포맷. 그런데 새 방장의 닉네임을 DTO에 포함하려면 actor(구 방장)의 sub밖에 없고 신 방장 닉네임이 부재했다. 결과적으로 **currentUserId 분기**(자신이 신 방장인 경우 vs 일반 멤버 뷰)로 카피를 달리 구성하는 방식으로 구현.

---

## 품질

| 게이트 | 결과 |
|---|---|
| 백엔드 jest | 523 테스트 통과 |
| 백엔드 lint / typecheck | 클린 |
| 웹 lint / build | 클린 |
| 로컬 E2E — 실시간 배지 | 검증 완료 (user:{id} private 채널, RLS 격리 확인) |
| 로컬 E2E — 알림 피드 | 검증 완료 (목록·날짜그룹·카피·딥링크) |
| 로컬 E2E — 읽음 / 모두읽음 | 검증 완료 |
| 로컬 E2E — RLS 격리 | 검증 완료 (타 사용자 알림 미노출) |
| 모두읽음 배지 레이스 | 발견 → 수정 완료 (아래 Context 참조) |
| FCM 실배달 | 미검증 (기기 게이트 — 아래 참조) |

---

## 마이그레이션 / 배포 전제

prod에 반영된 마이그레이션 3종:

| 마이그레이션 | 내용 |
|---|---|
| `20260701200000_add_notification` | `notification` 테이블 + 인덱스 2종 + RLS enable(default deny) |
| `20260701210000_add_settlement_request` | `settlement_request` 테이블 + 인덱스 + RLS enable(default deny) |
| `20260702000000_add_notification_realtime_broadcast` | `broadcast_notification_new()` 함수 + `notification_broadcast` 트리거 + `realtime.messages` `"users can receive own notifications"` 정책 |

**파괴적 변경 없음** — 3종 모두 순수 additive(신규 테이블/트리거, 기존 컬럼·PK·FK 무변경). 롤백 없이 배포.

**신규 환경변수 없음** — FCM `FIREBASE_CREDENTIALS`는 이전부터 존재하는 값 그대로.

---

## 미검증 (게이트)

| 항목 | 게이트 조건 |
|---|---|
| FCM 실제 배달 — `member.joined` · `schedule.confirmed` · `settlement.completed` | `FIREBASE_CREDENTIALS` 서비스 계정 JSON + 실기기 `device_token` 등록 필요 |

로컬 jest(`POST /devices` → `PushListener @OnEvent` 발화)는 검증 완료. 실기기 FCM 배달은 별도 기기 게이트.

---

## Context (AI-Developer Memory)

**비파괴 마이그레이션 플로우** — 이번에도 `prisma migrate diff` → `db execute --sql migration.sql` → `migrate resolve --applied` 패턴 사용. `add_chat` 마이그레이션 때와 동일하게, 수동 SQL 블록(트리거/RLS)은 `prisma migrate diff`에 잡히지 않아 체크섬 드리프트 없이 처리해야 한다. Shadow DB(realtime/auth 스키마 부재)에서 트리거/RLS 생성 블록이 오류 없이 생략되도록 `to_regnamespace('realtime') IS NOT NULL` 가드 필수. `DROP POLICY IF EXISTS` → `CREATE POLICY` 패턴으로 재실행 멱등 확보(`CREATE POLICY`는 `IF NOT EXISTS` 미지원).

**모두읽음 배지 레이스** — 웹에서 "모두 읽음" 버튼 클릭 시 `markAllAsRead()` POST 완료 전에 배지 카운트를 낙관적으로 0 reset하면, 요청 실패 시 배지가 잘못 0이 된다. `await markAllAsRead()` 이후에 카운트를 reset하는 순서로 수정 완료.

**구현 중 로그인 루프 교훈** — 백엔드 `nest start --watch` 프로세스가 파일 감지 루프로 다운되고 좀비 프로세스가 3001 포트를 점유한 상태에서 웹이 401을 반환하며 로그인 루프가 발생했다. 원인은 포트 점유 좀비 프로세스. 해결: `lsof -ti:3001 | xargs kill -9` 후 서버 재시작. `--watch` 모드보다 `nest build` 후 별도 `node` 실행이 더 안정적.

---

## 후속 권장

1. **migrations.md 드리프트 백필** — `add_moim_max_members_and_member_realtime` · `add_expense` · `add_expense_realtime_broadcast` · `add_schedule` · `add_schedule_realtime_broadcast` 등 Applied 표에 미기재된 7개 마이그레이션을 별도 sync에서 추가.

2. **FCM 실기기 검증** — `FIREBASE_CREDENTIALS` 서비스 계정 + 실기기 `device_token` 등록 후 3종 고신호(`member.joined` · `schedule.confirmed` · `settlement.completed`) 실 배달 확인.

3. **네이티브 딥링크 매핑** — 웹 알림 탭의 `type + moimId → route` 매핑(`member.kicked → /home`, `schedule.* → /moims/[id]/schedule`, `expense.* → /moims/[id]/expenses` 등)을 iOS/Android 네이티브 딥링크 스킴으로 매핑하는 작업 필요.
