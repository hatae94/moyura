# Research: SPEC-SAFETY-001 (신고·차단)

> 조사 시점: 2026-07-02. 확정 범위: 신고 사유와 함께 저장, 신고자 측 즉시 숨김, 신고 후 차단 유도, 차단 시 차단 대상 멤버의 **모든 UGC를 내 화면에서만 숨김**(1-way), 차단 진입점은 신고 플로우 + 멤버 목록, 신고와 차단은 독립, 관리자 UI 없음.

---

## UGC 표면 목록

멤버가 작성해 다른 멤버에게 노출되는 콘텐츠 표면 전수 조사. 차단 필터가 커버해야 할 대상이다.

### 요약 테이블

| 콘텐츠 | DB 테이블 | 작성자 컬럼 | 백엔드 엔드포인트 | 웹 렌더링 컴포넌트 |
|---|---|---|---|---|
| 채팅 메시지 | `chat_message` | `sender_id` | `POST/GET /moims/:id/messages` | `apps/web/app/moims/[id]/chat/page.tsx` |
| 투표 질문·옵션 | `poll` | `created_by` | `POST /moims/:id/polls` | `apps/web/app/(main)/home/[id]/polls-section.tsx` |
| 투표(표) | `poll_vote` | `user_id` | `POST /moims/:id/polls/:pollId/vote` | polls-section.tsx (집계 수치) |
| 지출 항목·메모 | `expense` | `created_by` | `POST/PATCH /moims/:id/expenses` | `apps/web/app/moims/[id]/expenses/expenses-view.tsx` |
| 지출 분담 | `expense_share` | (부모 expense의 `created_by`에서 유도) | (expense 경유) | expenses-view.tsx |
| 일정 세션(설정) | `schedule_event` | `created_by` | `PUT /moims/:id/schedule` | schedule-view.tsx |
| 일정 가용 슬롯 | `schedule_slot` | `user_id` | `PUT /moims/:id/schedule/me` | schedule-view.tsx (히트맵) |
| 일정 날짜/시간대(협업 편집) | `schedule_event` | 작성자 추적 없음 | `PUT /moims/:id/schedule/dates`, `/window` | schedule-view.tsx |
| 전역 프로필 이름 | `profile` | (본인) | `PATCH /me` | `apps/web/app/(main)/profile/page.tsx` |
| 모임 내 닉네임 | `moim_member` | (가입 시) | (join 시에만, 수정 없음) | members-section.tsx, chat page.tsx |
| 초대 링크 | `moim_invite` | `created_by` | `POST /moims/:id/invites` | invite 페이지 |
| 알림(액터 기반) | `notification` | `actor_id` (nullable) | (backend PushListener) | notification-item.tsx |
| 정산 요청 | `settlement_request` | `requester_id` | (expense 경유) | expenses-view.tsx |

### 표면별 상세

**1) 채팅 메시지**
- 스키마: `apps/backend/prisma/schema.prisma:190-206` — `chat_message` 테이블, `sender_id`(TEXT, = profile.id), `content`(CHECK 1..2000), `moim_id` 스코프. 키셋 페이지네이션용 인덱스 `@@index([moimId, id(sort: Desc)])` (schema.prisma:195-208).
- API: `apps/backend/src/chat/chat.controller.ts:46-96` — `POST /moims/:id/messages`(line 46), `GET /moims/:id/messages?cursor=&limit=`(line 71), `ChatService`(line 24).
- 실시간: `chat_message_broadcast` 트리거가 private 채널 `moim:{moimId}`에 이벤트명 `'INSERT'`로 팬아웃 (`.moai/project/db/schema.md:212-224`).
- 웹: `apps/web/app/moims/[id]/chat/page.tsx:172-389` — 멤버 로드(line 231-232)로 `sender_id`→`nickname` 매핑, 말풍선에 발신자 닉네임 표시(line 114-115), `useChatChannel` 실시간 구독(line 282), 본인/타인 판별은 `currentUserId` vs `message.senderId`(line 73).

**2) 투표 (질문/옵션/표)**
- 스키마: `apps/backend/prisma/schema.prisma:319-338`(Poll, `created_by`, `question`, `kind`), `:340-352`(PollOption, `label`, `option_date`), `:355-373`(PollVote, 복합 PK `(poll_id, option_id, user_id)`).
- API: `apps/backend/src/poll/poll.controller.ts:40-150` — 생성(line 43, `body.question` 검증 line 63), 목록(line 99), 투표(line 121), `PollService`(line 29).
- 실시간: `poll_broadcast` + `poll_vote_broadcast` 트리거가 `moim:{moimId}` 채널 `'poll_change'` 이벤트로 팬아웃 (schema.md:226-240).
- 웹: `apps/web/app/(main)/home/[id]/polls-section.tsx:1-150` — question(line 29), option.label(line 78), 옵션별 득표 수(line 124), 내 투표 표시 `poll.myVotes.includes(option.id)`(line 70), `usePollChannel` 구독(line 36). 표 자체는 익명 집계로만 노출.
- 알림: notification-item.tsx:170-189 — 투표 생성 알림에 `dto.data.question`(line 173) 노출.

**3) 지출 (항목/메모/분담)**
- 스키마: `apps/backend/prisma/schema.prisma:75-93`(Expense, `created_by`, `payer_user_id`, `amount`, `category`, `memo`), `:95-108`(ExpenseShare, 복합 PK `(expense_id, user_id)`).
- API: `apps/backend/src/expense/expense.controller.ts:57-89` — 생성(line 57, memo는 멤버 작성 콘텐츠 line 84), 목록(line 92), 수정(line 112), `ExpenseService`(line 43).
- 웹: `apps/web/app/moims/[id]/expenses/expenses-view.tsx:1-150` — 금액/카테고리/결제자/메모/분담 내역 렌더링, 카테고리 도넛 차트(line 47), 소유자 편집/삭제(line 23-25), `useExpenseChannel` 구독(line 20).
- 알림: notification-item.tsx:190-200 — 금액·카테고리 노출(line 193-194).

**4) 일정 조율 (세션/슬롯/협업 편집)**
- 스키마: `apps/backend/prisma/schema.prisma:440-470`(ScheduleEvent, `created_by`, `dates` TEXT[], `start_minute`/`end_minute`, `confirmed_at`, moim당 1개 UNIQUE), `:472-495`(ScheduleSlot, 복합 PK `(schedule_event_id, user_id, date, start_minute)`).
- API: `apps/backend/src/schedule/schedule.controller.ts:42-150` — 세션 설정(line 42, owner 전용), 조회(line 77), 내 슬롯(line 93), 날짜 편집(line 109), 윈도우 확장(line 132), `ScheduleService`(line 30).
- 협업 편집(`dates`, `window`)은 **작성자 추적이 없어** 개별 기여를 되돌릴 수 없다 → 차단 시 해당 멤버의 ScheduleSlot 제거만 가능.
- 알림: notification-item.tsx:130-169 — schedule.started/dates_changed/window_changed/confirmed(확정 일시 line 164).

**5) 멤버 정체성 (프로필 이름/닉네임)**
- 스키마: `apps/backend/prisma/schema.prisma:22-32`(Profile, `name` nullable), `:175-188`(MoimMember, `nickname` NOT NULL, 가입 시 설정 후 수정 엔드포인트 없음).
- API: `apps/backend/src/profile/me.controller.ts:65-78`(`PATCH /me`, 검증 line 70, `ProfileService` line 21), `apps/backend/src/moim/moim.controller.ts:106,115-121`(`GET /moims/:id/members`, nickname 반환 line 119), 닉네임 join-time 설정(moim.controller.ts line 58).
- 웹: `apps/web/app/(main)/home/[id]/members-section.tsx:133-250+`(멤버 목록, MoimMember 타입 line 16, `useMemberChannel` line 17), 채팅 말풍선 `nicknameOf()` 조회(chat page.tsx:208-214), 알림 액터 닉네임 `dto.actor?.nickname ?? "누군가"`(notification-item.tsx:86-91, 100-105), 프로필 페이지(profile/page.tsx:1-75 — name line 40, email line 16, 편집 폼 line 62, 아바타는 name/email에서 계산 line 25 — 별도 avatar 컬럼 없음).

**6) 초대 링크**
- 스키마: `apps/backend/prisma/schema.prisma:149-170`(MoimInvite, `token` PK, `created_by`, `expires_at`, `max_uses`, `used_count`, `revoked_at`). 초대별 커스텀 메시지 없음.
- 그룹 관리 아티팩트 성격이라 핵심 UGC 표면은 아님.

**7) 알림**
- 스키마: `apps/backend/prisma/schema.prisma:532-566`(Notification, `recipient_id`, `actor_id` nullable, `type`, `data` JSON, `read_at`, 인덱스 `(recipientId, id DESC)` + `(recipientId, readAt)`).
- 액터 기반 타입: member.joined, owner.delegated, member.kicked, poll.created, expense.added, settlement.requested. 시스템 타입(poll.closed, settlement.completed, schedule.dates_changed/window_changed)은 액터 귀속 없음 → 차단 대상 아님.
- 웹: notification-item.tsx:292-358(렌더링), `type`→`PRESENTATION` 매핑(lines 93-224, 아이콘/카피/딥링크 line 299-301). 수신자 본인만 열람(`user:` 채널 RLS, schema.md:253).

**8) 정산 요청**
- 스키마: `apps/backend/prisma/schema.prisma:127-147`(SettlementRequest, `requester_id`(채권자), `debtor_id`(채무자), `amount`, `@@index([moimId])`).
- 웹: expenses-view.tsx 정산 요약 + 거래 목록, notification-item.tsx:204-215(settlement.requested — 채무자에게만 노출).

### 범위 제외 (시스템 생성 또는 비노출)
- device_token(사용자 비노출), 파일 첨부 없음(어느 UGC 테이블에도 file_url 컬럼 없음), 읽음 확인은 per-message가 아님, 리액션/이모지 없음, 채팅 수정·삭제 없음(insert-only, SPEC-CHAT-001 §5).
- 모임 이름(`moim.name`)은 그룹 공유 속성 — `created_by`는 생성자 식별자일 뿐이며 멤버 개인의 UGC로 취급하지 않는다(숨김 대상 아님).

---

## 채팅 파이프라인과 차단 필터 훅 포인트

### 파이프라인 현황

- **엔티티**: `apps/backend/src/generated/prisma/models/ChatMessage.ts:546-554`(생성 타입). 컬럼 정의는 `.moai/project/db/schema.md:87-94` — `id`(BIGINT PK, 커서), `moim_id`, `sender_id`, `content`, `created_at`. **차단 관련 컬럼(`is_hidden` 등)은 전무** → 조인/서브쿼리 기반 필터링 필요.
- **전송**: `apps/backend/src/chat/chat.controller.ts:57-69`(POST, 가드 line 42, DTO `apps/backend/src/chat/dto/send-message.dto.ts:6-12`, content 검증 lines 100-113) → `apps/backend/src/chat/chat.service.ts:48-80`(`assertChatAccess` line 54, 404→403 변환 lines 113-121, insert lines 57-59, `CHAT_MESSAGE_CREATED` 이벤트 발행 line 70 — 페이로드 `apps/backend/src/chat/chat-events.ts:13-22`, 닉네임 미포함). 응답 DTO: `apps/backend/src/chat/dto/message-response.dto.ts:6-35`.
- **히스토리**: `apps/backend/src/chat/chat.controller.ts:82-96`(GET, limit 정규화 1..100 기본 30 lines 117-126) → `chat.service.ts:83-108`(`assertChatAccess` line 88, 커서 파싱 lines 125-135, findMany 쿼리 lines 93-98 — 닉네임 join 없음, 클라이언트가 별도 멤버 목록으로 해석). 응답 DTO: `apps/backend/src/chat/dto/history-response.dto.ts:6-20`.
- **실시간**: `broadcast_chat_message()` SECURITY DEFINER 함수 + `chat_message_broadcast` AFTER INSERT 트리거(schema.md:212-224, 구현 위치 `apps/backend/prisma/migrations/20260613175232_add_chat/migration.sql`, schema.md:214). `realtime.messages` SELECT 정책 "members can receive moim broadcasts"(schema.md:222)가 구독 시점에 moim_member 멤버십을 게이트. **브로드캐스트는 채널(모임) 단위이며 수신자별 필터가 불가능** — RLS는 구독 승인 시점에만 작동.
- **웹 구독 훅**: `apps/web/lib/chat/useChatChannel.ts:37-73` — `setAuth(accessToken)`(line 51), `moim:{moimId}` private 채널 `'INSERT'` 구독(lines 53-66), 언마운트 시 해제(lines 69-71). 브로드캐스트 레코드 타입은 snake_case, 닉네임 없음(lines 17-23). **훅 자체에 필터 레이어가 없어** 필터링은 소비자(page.tsx `handleIncoming`) 몫이다.
- **웹 상태 관리**: `apps/web/app/moims/[id]/chat/page.tsx` — **React Query 미사용**, raw `useState`(messages line 182, members line 183, loading lines 187-189). 초기 로드 useEffect(lines 216-251: 세션 line 229, `loadMembers` line 231, `loadHistory` line 233, reverse line 240). 전송(lines 296-313: `sendMessage` line 305, 반영은 실시간 브로드캐스트 경유 line 307, id 중복 제거 line 263). 실시간 수신 `handleIncoming`(lines 258-282: `fromBroadcast` 변환 line 261, dedup+append lines 263-264, 미지의 발신자 시 멤버 재조회 lines 266-276). 렌더링(헤더 lines 80-92, 목록 lines 335-362, 스켈레톤 lines 340-341, MessageBubble lines 342-349, 빈 상태 lines 351-359, 말풍선 lines 96-139, 그룹핑 lines 64-77, 닉네임+시각 lines 113-116, 본인 스타일 lines 126-127, 타인 line 128, 입력 바 lines 365-386, 자동 스크롤 lines 285-288).
- **닉네임 해석**: 서버 join 없음(schema.md:91-92 "nickname은 moim_member에서 클라이언트 측 해석"). `loadMembers`는 `apps/web/lib/chat/api.ts:31-37`(응답 필드 lines 23-28), `nicknameOf(senderId)`는 page.tsx:207-214 — 미발견 시 `알 수 없음(sub 앞 8자)` 폴백, MessageBubble에서 호출(lines 346-348).

### 차단 필터 훅 포인트

| 단계 | 위치 | 유형 | 구현 |
|---|---|---|---|
| 히스토리 목록 | `apps/backend/src/chat/chat.service.ts:93-98` (`getHistory`의 `where`절, lines 94-95) | 서버 SQL 필터 | `senderId: { notIn: blockedIds }` 추가. 차단 테이블(예: `block_list(user_id, blocked_user_id)`)을 조회 후 조합 |
| 실시간 신규 메시지 | `apps/web/app/moims/[id]/chat/page.tsx:259-279` (`handleIncoming`) | 클라이언트 상태 필터 | `blockedUserIds.has(message.senderId)`이면 `setMessages` append 전에 조용히 드롭 |
| 마운트 시 히스토리 | `apps/web/app/moims/[id]/chat/page.tsx:231-240` (fetch 후, state 할당 전) | 클라이언트 메모리 필터 | `history.messages.filter(...)` 후 `setMessages` — 단, 서버 필터 없이는 devtools 네트워크 탭에 원본 노출 |
| 차단 액션 동기화 | 신규 엔드포인트 필요 (미구현) | API + 상태 갱신 | 차단 직후 `blockedUserIds` 갱신 + `setMessages([])` 후 히스토리 재조회 (React Query가 없어 수동 무효화) |
| 미지 발신자 멤버 재조회 | page.tsx:266-276 | 실시간 핸들러 부수효과 | 기존 패턴 재사용 — 차단은 멤버 목록 자체에는 영향 없음 |

**실시간 필터링 옵션 검토** (User A가 User B 차단 후 B가 새 메시지 전송 시나리오):
- **옵션 A (서버 트리거 필터)**: `broadcast_chat_message()`에서 차단 여부 검사 — **현 아키텍처에서 실현 불가**. 브로드캐스트는 per-moim 채널이고 RLS 게이트는 구독 시점이지 발행 시점이 아님.
- **옵션 B (클라이언트 필터)**: 실시간은 전 멤버에게 전달되고 클라이언트 `handleIncoming`에서 드롭. 한계: 네트워크 레이어에서는 페이로드가 관찰 가능.
- **옵션 C (하이브리드, 권고)**: 히스토리는 서버 필터(§훅 1) + 실시간은 클라이언트 필터(§훅 2) + 차단 액션 시 상태 초기화·재조회. 서버 필터와 클라이언트 필터를 **반드시 함께** 구현해야 히스토리·신규 양쪽에서 일관되게 숨겨진다.

**페이지네이션 주의**: `notIn` 필터로 결과 수가 줄어들어 keyset 페이지에서 `take: N`보다 적게 반환될 수 있음 — over-fetch 후 trim 또는 재쿼리 필요(커서 인지 오프셋은 까다로움).

---

## 참조 구현 (멤버 강퇴·게스트 모델)

per-member 액션(강퇴/위임)이 신고·차단 UI와 백엔드의 직접적인 참조 구현이다.

### 강퇴 (kick)
- 라우트: `DELETE /moims/:moimId/members/:userId` (204) — `apps/backend/src/moim/moim.controller.ts:151-167`.
- 서비스: `MoimService.kickMember(sub, moimId, targetUserId)` — `apps/backend/src/moim/moim.service.ts:186-223`.
  - 권한: `assertOwner`(비소유자 403, 모임 없음 404), 대상 존재 확인(복합 PK findUnique → 404), 대상이 owner면 403(moim.service.ts:200-202).
  - 구현: `moim_member` 복합 PK(moimId, userId) 단건 DELETE. **채팅/투표/지출로의 캐스케이드 없음** — 강퇴된 멤버의 UGC는 원래 userId 그대로 남는다.
  - 이벤트: DELETE 성공 후 `MOIM_MEMBER_KICKED` 발행(best-effort, 리스너 실패가 삭제를 막지 않음).

### 소유권 위임 (transfer)
- 라우트: `POST /moims/:moimId/owner` (204) — `apps/backend/src/moim/moim.controller.ts:201-215`.
- 서비스: `MoimService.transferOwner` — `apps/backend/src/moim/moim.service.ts:227-277`. `assertOwner`, 빈 대상 400, 자기 위임 400, 대상 미존재 404. 원자적 트랜잭션으로 두 UPDATE(현 owner→member, 대상→owner). `moim.createdBy`는 불변(원 생성자 추적 전용) — isOwner 판정은 `MoimMember.role`(SPEC-MOIM-012).

### 웹 UI 진입점 (차단 버튼이 들어갈 자리)
- 서버 컴포넌트: `apps/web/app/(main)/home/[id]/page.tsx:39-100` — `Promise.all([getMoim, getMoimMembers])`, isOwner 판정 line 99(`m.role === "owner"` 기준, createdBy 아님).
- `MembersSection`: `apps/web/app/(main)/home/[id]/members-section.tsx:131-141`(진입점). 컨트롤 노출 로직 line 305-306: `isOwner && member.role !== "owner" && member.userId !== currentUserId`. 멤버 행별 버튼(lines 327-349): 위임(Crown, lines 329-337), 강퇴(UserMinus destructive, lines 339-347). 확인 다이얼로그(lines 368-389). 실시간 `useMemberChannel`(lines 153-169): 본인 DELETE → `router.replace("/home")`, 그 외 → `router.refresh()`.
  - **차단/신고 진입점 권고**: 이 행별 액션 패턴을 따르되, 차단은 owner 전용이 아니므로 `showControls` 조건과 별개로 "본인 제외 모든 멤버 행"에 노출.
- 서버 액션: `apps/web/app/(main)/home/[id]/member-actions.ts` — `kickMemberAction`(lines 39-64, API 헬퍼 `apps/web/lib/moim/members.ts:13-20`, 성공 시 `revalidatePath`), `transferOwnerAction`(lines 70-95, members.ts:27-37), `updateMaxMembersAction`(lines 101-126, members.ts:44-54). 반환은 `{ok: true}` 또는 일반화된 `{error}` (HTTP 상태 비노출).

### 게스트(익명 로그인) 모델 — 신고·차단 대상 적격성
- 게스트 = Supabase **anonymous login** 사용자. `is_anonymous: true` JWT 보유(SupabaseAuthGuard 검증), Profile 행 없음, moim_member에서는 이름 있는 계정과 **완전히 동일 취급**(같은 복합 PK, role, nickname).
- 초대 수락: `POST /invites/:token/accept` — `apps/backend/src/invite/invite.controller.ts:137-159` → `InviteService.accept` `apps/backend/src/invite/invite.service.ts:108-231`. 멱등 처리(이미 멤버면 200, usedCount 미증가, lines 134-139), 원자 트랜잭션(lines 165-209), P2002 경합 → 멱등 200(lines 180-185), 실패 코드 404/410/409/400(lines 128-143, 닉네임 검증 line 114).
- 멤버 목록 응답(`apps/web/lib/moim/api.ts:22-28`)에 `is_anonymous` 미노출 — UI에서 게스트 구분 불가.
- **결론**: 게스트도 강퇴·신고·차단 모두 가능. 차단/신고 매칭 키는 `userId`(sub)이며 profile 필드가 아니므로 게스트 특수 처리 불필요. `moim_member`에 is_guest 류 컬럼 없음(schema.prisma:175-187).

### 권한 모델 요약
- owner는 leave 불가(403, moim.service.ts:148-161), 강퇴 불가, 위임만 가능. `assertMember`/`assertOwner`(fan_in ≥3)가 단일 인가 소스, 라우트 가드는 SupabaseAuthGuard(401).

---

## 구현 컨벤션

신규 `safety`(또는 `report`/`block`) 모듈이 따라야 할 코드베이스 컨벤션.

### NestJS 모듈 구조
- 파일 배치: `apps/backend/src/{domain}/` 아래 `{domain}.module.ts`, `{domain}.controller.ts`, `{domain}.service.ts`, 선택적 `{domain}.listener.ts`, `dto/`, `{domain}.service.spec.ts`. 실제 예: notification.module.ts:1-18, schedule.module.ts:1-14, expense.module.ts:1-15.
- 모듈 임포트 규칙: AuthModule(가드) 필수. 도메인이 `assertOwner`/`assertMember`를 호출할 때만 MoimModule 임포트(schedule.module.ts:7-8, expense.module.ts:7-9). recipientId==sub 방식 인가면 moim 임포트 불필요(notification.module.ts:7-12). PrismaService는 글로벌이라 재임포트 금지.
- 컨트롤러: per-route `@UseGuards(SupabaseAuthGuard)`(notification.controller.ts:52, 76, 93) 또는 클래스 레벨(schedule.controller.ts:38, expense.controller.ts:53). **ValidationPipe 부재가 코드베이스 컨벤션** — 헬퍼로 명시적 400(notification.controller.ts:41-43). body/query를 절대 신뢰하지 말고 guard 검증된 `user.sub`만 인가 키로 사용(notification.controller.ts:64-68). BigInt는 JSON 직렬화 전 `.toString()`(notification.controller.ts:168).
- 입력 검증 헬퍼 예: parseMarkReadBody(notification.controller.ts:130-148), requireInt/requireStringArray(schedule.controller.ts:58-64), requirePositiveInt/requireCategory(expense.controller.ts:73-76).
- 인가 패턴: 서비스 WHERE절에 소유 조건 내장(notification.service.ts:94-96 — "recipientId 필터가 격리의 단일 소스") 또는 assertMember/assertOwner 재사용(schedule.controller.ts:32-34). **차단 목록 조회는 `blockerId == sub`를 WHERE에 내장하는 notification 패턴이 적합.**

### DB 마이그레이션
- 위치: `apps/backend/prisma/migrations/YYYYMMDD*_description/migration.sql`. 전부 additive(브라운필드 안전) — 예: 20260701200000_add_notification:1-34(신규 테이블), 20260624100000_add_expense:4-69(nullable 컬럼 추가 + 신규 테이블).
- RLS 패턴(20260701200000_add_notification:24-34): `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny. Prisma는 postgres 롤 직결이라 RLS 미적용, 인가는 NestJS 서비스 레이어.
- 인덱스: keyset용 `(recipient_id, id DESC)` 류, 정션 테이블은 복합 PK(expense_share `(expense_id, user_id)`). 차단 테이블도 `(blocker_id, blocked_id)` 복합 PK가 자연스럽다.

### Jest 테스트 (inMemory fake Prisma)
- 패턴: notification.service.spec.ts:17-173, schedule.service.spec.ts:30-173.
  - fake 테이블은 Map/배열(notification.service.spec.ts:40-44, schedule.service.spec.ts:30-34).
  - **jest.fn은 `async`가 아니라 `Promise.resolve/reject` 반환**(require-await 린트 규칙, notification.service.spec.ts:108-119, schedule.service.spec.ts:62-76).
  - mock 합성 `as unknown as PrismaService`(notification.service.spec.ts:161-165), args 타입 인터페이스(schedule.service.spec.ts:9-16), 헬퍼 팩토리(notification.service.spec.ts:54-90, schedule.service.spec.ts:26-27).
  - mock 호출 검증(notification.service.spec.ts:175-199, line 193), 입력 객체 직접 변이 대신 복사 변이(notification.service.spec.ts:139-141).

### SPEC 문서
- frontmatter(SPEC-CHAT-002:spec.md:1-10, SPEC-MOIM-002:spec.md:1-10): id/version/status/created/updated/author/priority/issue_number.
- EARS 요구사항(모듈당 ≤5): `REQ-PREFIX-NNN [Event-driven|State-driven|Ubiquitous|Unwanted]` + When/While…then…(shall) + AC 참조. 예: SPEC-CHAT-002:spec.md:84-85(REQ-PUSH-001), :100(REQ-PUSH-006), SPEC-MOIM-002:spec.md:79-80(REQ-INV-005).
- acceptance.md: Given/When/Then(SPEC-CHAT-002:acceptance.md:5-30), Edge Cases(:33-39), Quality Gates(백엔드 jest 85%+, 느슨한 결합 grep 검증), Definition of Done 체크리스트.
- plan.md: 접근 설명 → 마일스톤(SPEC-MOIM-002:plan.md:21-41) → REQ 매핑 테이블 → 델타 마커 [NEW]/[MODIFY]/[REGEN](SPEC-MOIM-002:spec.md:96-104, plan.md:78-87).

### DTO
- Swagger 데코레이터 패턴(notification-response.dto.ts:1-95, schedule-response.dto.ts:1-66): BigInt→string, Date→ISO-8601, 중첩은 `@ApiPropertyOptional({ nullable, type })`, 컬렉션은 `type: [Item]`, 필드는 `!` definite assignment.

---

## 리스크와 암묵적 계약

### 범위 확정으로 해소·재해석되는 리스크 (조사 결과와 확정 범위의 충돌)

**[충돌 1] 삭제/익명화 vs 뷰어 측 필터링.** UGC 표면 조사(위 §UGC 표면 목록)의 표면별 "Content Hiding Strategy"는 대부분 **삭제 또는 익명화**(글로벌 변이: 채팅 삭제, 투표 캐스케이드 삭제, 지출 삭제, 일정 세션 삭제)를 제안한다. 반면 채팅 딥다이브 조사와 **확정 SPEC 범위**("차단은 내 화면에서만 숨김", 1-way)는 **뷰어 측 필터링**(서버 쿼리 필터 + 클라이언트 필터)이다. 두 접근은 양립 불가 — 확정 범위에 따라 **필터링 접근을 채택**하고, 삭제 기반 전략은 기각한다. 이에 따라 아래 리스크 2·3·4의 "삭제로 인한 데이터 훼손" 우려는 대부분 소멸하고, 대신 "필터로 인한 집계 불일치" 문제로 전환된다.

**[충돌 2] 1-way vs 2-way.** Risk 8(원 조사)은 차단의 방향성을 SPEC에서 결정하라고 요구했다 — 확정 범위는 **1-way**(차단자가 자기 화면에서 차단 대상 콘텐츠를 숨김, 상호 숨김 아님)로 결론.

### 잔존 리스크

1. **채팅 히스토리 맥락 단절** (chat/page.tsx:114-115): 차단 멤버의 메시지를 내 화면에서 숨기면 대화 흐름에 공백·고아 답장이 생긴다. 필터 접근에서는 나만 겪는 문제이므로 삭제 대비 영향이 작지만, "N개의 메시지가 숨겨짐" 류 표시 여부는 UX 결정 사항.
2. **투표 집계 불일치** (poll.controller.ts:121-149): 차단 멤버의 표를 내 화면에서 제외하면 다른 멤버가 보는 집계와 달라진다. 반대로 집계에 포함하면 차단 대상의 흔적이 수치로 남는다 — 표는 익명 집계라 **집계는 그대로 두고 투표 생성물(poll 자체)만 숨기는** 절충이 단순하다.
3. **지출·정산 원장 정합성** (expense.controller.ts:57-110): 지출을 내 화면에서 숨겨도 정산 계산(ExpenseService.listExpenses의 (from,to,amount) ↔ Settlement 매칭)에는 포함되어야 금액이 맞는다. **정산 수치는 필터 대상에서 제외**하고 항목 목록 표시만 숨기거나 익명 표시("차단한 멤버")로 대체할지 결정 필요. 결제자(payer_user_id)가 차단 대상인 경우의 표시(Risk 7, expenses-view.tsx)도 동일 계열.
4. **일정 히트맵 해석** (schedule.controller.ts:93-107): 차단 멤버의 슬롯을 히트맵에서 제외하면 소유자가 가용 인원을 오판할 수 있다. 협업 편집(dates/window)은 작성자 추적이 없어 필터 불가 — 슬롯만 필터 가능.
5. **알림 액터 필터 비일관성** (notification-item.tsx:93-224): 차단 액터의 알림만 숨기면 동일 유형의 다른 액터 알림은 남는다 — "그 액터의 이벤트만 숨긴다"를 문서화하면 충분. 시스템 알림(actor 없음)은 차단 무관.
6. **닉네임 소급 처리** (members-section.tsx:120-250): `moim_member.nickname`을 차단 시 익명화하면 과거 기록 전반의 귀속이 깨진다 — 닉네임은 유지하고 콘텐츠만 숨기는 것이 안전(조사 권고 Option 1).
7. **차단 테이블 부재**: 현 스키마에 block_list류 테이블이 없다(schema.md에 언급 없음). SPEC에서 테이블(blocker/blocked/created_at)과 report 테이블(신고자/대상/사유/대상 콘텐츠 참조)을 신규 정의해야 서버 필터가 가능하다.
8. **채팅 필터의 계층 정합**: 서버 히스토리 필터(chat.service.ts:93-98)와 클라이언트 실시간 필터(page.tsx:259-279)를 **함께** 구현하지 않으면 한쪽 경로로 노출된다. 실시간 브로드캐스트는 채널 단위라 네트워크 레이어 노출은 불가피(클라이언트 필터의 본질적 한계). dedup(page.tsx:263)은 차단을 모름 — 필터는 append 검사보다 앞단(변환 직후)에서 수행.
9. **React Query 부재로 수동 캐시 무효화**: 차단 액션 후 `setMessages([])` + 재조회를 하지 않으면 리로드 전까지 기존 메시지가 남는다.
10. **미지 발신자 멤버 재조회 경로** (page.tsx:266-276): 재조회 로직이 차단을 검사하지 않으면 신규 멤버 경로로 차단이 우회될 수 있다.
11. **계정 삭제와의 상호작용** (SPEC-ACCOUNT-001 연계): 차단자 또는 차단 대상이 탈퇴하면 block_list 행 처리(잔존 시 고아 참조) 방침 필요 — 모든 user 참조가 soft-ref(FK 없음)이므로 명시적 정리 로직이 요구된다.
12. **필터는 UI 관점** — 차단해도 owner/다른 멤버는 여전히 콘텐츠를 보며, DB 직접 조회나 API로는 접근 가능하다(확정 범위상 의도된 동작이지만 acceptance에 명시할 것).
13. **게스트 향후 확장**: 게스트에 profile.name이 추가되더라도 차단/신고 매칭은 userId 기반을 유지해야 게스트 특수 행이 안 생긴다(schema.prisma:175-187).
14. **이벤트 리스너 best-effort** (moim.service.ts:215-222): 신고/차단에 알림을 붙일 경우, 리스너 실패가 본 액션을 롤백하지 않는 기존 계약을 따른다.
15. **모듈 순환 의존 함정**: safety 모듈이 account 모듈을 부르고 역방향도 생기면 순환 임포트. EventEmitter 기반 느슨한 결합(SPEC-CHAT-002 §4 REQ-PUSH-004의 grep 검증 방식)으로 분리.

---

## 구현 접근 권고

조사 결과를 종합한 권고안 (확정 범위 기준):

1. **데이터 모델 (additive 마이그레이션)**
   - `report` 테이블: id, reporter_id, target_user_id, moim_id(스코프), reason(TEXT), 신고 대상 콘텐츠 참조(type + id), created_at. RLS enable + 정책 없음(default deny) — notification 패턴(20260701200000_add_notification:24-34).
   - `block` 테이블: 복합 PK `(blocker_id, blocked_user_id)`, created_at. 신고와 독립(확정 범위). 모든 user 컬럼은 기존 컨벤션대로 FK 없는 TEXT soft-ref.
2. **백엔드 모듈**: `apps/backend/src/safety/` 신설 — AuthModule 임포트, 차단 목록 조회는 `blockerId == user.sub` WHERE절 내장(notification.service.ts:94-96 패턴). 엔드포인트: 신고 생성, 차단 생성/해제, 내 차단 목록 조회. 기존 도메인 모듈(chat/poll/expense/schedule/notification)의 목록 서비스에 "요청자의 차단 목록 제외" 필터를 주입 — safety 모듈을 직접 임포트하지 말고 공용 헬퍼 또는 서비스 주입으로 순환 의존 회피.
3. **숨김 방식은 뷰어 측 필터링** (삭제·익명화 아님):
   - 채팅: `chat.service.ts:93-98` where절에 `senderId notIn`, 페이지 부족분은 over-fetch 후 trim.
   - 투표: 차단 대상이 만든 poll을 목록에서 제외. 표 집계는 유지(익명 집계, 단순성 우선).
   - 지출/정산: 목록 표시는 숨기되 **정산 계산·합계에는 포함** — 원장 정합성 우선. 표시 대체 문구 검토.
   - 일정: 차단 대상의 슬롯을 내 히트맵 응답에서 제외. dates/window 협업 편집은 필터 불가(작성자 추적 없음)를 acceptance에 한계로 명시.
   - 알림: `actor_id`가 차단 대상인 알림을 피드에서 제외.
   - 닉네임/멤버 목록: 유지 — 차단 대상도 멤버 목록에는 보인다(차단 해제 진입점 겸용).
4. **웹 진입점 2곳** (확정 범위):
   - 신고 플로우: UGC 항목(우선 채팅 메시지)에서 신고 → 사유 입력 → 저장 → **신고자 측 즉시 숨김** → "이 멤버를 차단할까요?" 프롬프트.
   - 멤버 목록: members-section.tsx의 행별 액션 패턴(lines 327-349)에 차단 버튼 추가 — 단 owner 전용 조건(line 305-306) 밖, "본인 제외 모든 멤버" 노출. 확인 다이얼로그(lines 368-389 패턴) + server action(member-actions.ts 패턴, `revalidatePath`).
5. **클라이언트 실시간 필터**: 차단 목록을 페이지 마운트 시 로드해 `handleIncoming`(page.tsx:259-279)에서 드롭. 차단 직후 `setMessages([])` + 히스토리 재조회(수동 무효화). 서버 필터와 반드시 동시 구현.
6. **테스트**: fake Prisma(jest.fn + Promise.resolve) 패턴으로 서비스 단위 테스트 — 차단 필터가 각 목록 쿼리 where절에 반영되는지 mock 호출 검증(notification.service.spec.ts:193 스타일). 백엔드 85%+ 커버리지 게이트, `nx lint backend` 통과.
7. **관리자 UI 없음** (확정 범위): report는 저장만 하고 소비 UI는 만들지 않는다. 추후 운영 도구는 별도 SPEC.

---

## 추가 조사 (갭 보강)

plan 단계 진입 전 갭 보강을 위해 수행한 추가 조사 결과 — 신고 콘텐츠의 다형 참조 설계 및 서버 필터 훅 분석.

### 1. 신고 가능 콘텐츠 타입의 PK 이질성 문제

research.md:210에서 제안한 report 테이블 스키마는 "신고 대상 콘텐츠 참조(type + id)"만 언급하지만, 실제 코드베이스의 신고 가능 콘텐츠들은 다음과 같은 PK 타입 불일치를 가짐:

**단일 PK 콘텐츠 (신고 수용 가능)**:
- chat_message: BigInt autoincrement (schema.prisma:195), senderId TEXT (line 198)
- poll: String uuid (schema.prisma:212), createdBy TEXT (line 227)
- expense: String uuid (schema.prisma:79), createdBy TEXT (line 85)
- settlement_request: String uuid (schema.prisma:134), requester_id TEXT (line 137)

**복합 PK 콘텐츠 (신고 구조상 불가능)**:
- poll_vote: (pollId, optionId, userId) — schema.prisma:274, 단일 id 컬럼 없음
- expense_share: (expenseId, userId) — schema.prisma:105, 단일 id 컬럼 없음
- schedule_slot: (scheduleEventId, userId, date, startMinute) — schema.prisma:345, 단일 id 컬럼 없음

**결정 필요**: research.md:189의 절충안("표는 익명 집계라 표는 유지, poll 자체만 숨기기")과 일관성 있게, plan.md는 신고 대상 콘텐츠를 단일 PK만으로 한정(chat_message, poll, expense, settlement_request)해야 함.

### 2. 신고자 측 즉시 숨김의 서버 필터 훅 포인트

#### 2.1 채팅 메시지 — chat.service.ts:93-98

**현재 구현**:
```typescript
const messages = await this.prisma.chatMessage.findMany({
  where: cursorId === undefined ? { moimId } : { moimId, id: { lt: cursorId } },
  orderBy: { id: 'desc' },
  take: input.limit,
});
```

**훅 위치**: line 95의 `where` 조건에 `senderId: { notIn: blockedUserIds }` 추가 필요.

**BigInt 캐스팅**: report.target_id를 TEXT로 저장 후 필터 시 `BigInt(targetId)` 캐스팅(chat_message만 해당, 타 콘텐츠는 TEXT).

#### 2.2 투표 목록 — poll.service.ts:299

**현재 구현**:
```typescript
const polls = await this.prisma.poll.findMany({ where: { moimId } });
```

**훅 위치**: line 299의 where에 `createdBy: { notIn: blockedUserIds }` 추가 필요.

#### 2.3 지출 목록 — expense.service.ts:181-185

**현재 구현**:
```typescript
const expenses = await this.prisma.expense.findMany({
  where: { moimId },
  include: { shares: true },
  orderBy: { createdAt: 'asc' },
});
```

**훅 위치**: line 182의 where에 `createdBy: { notIn: blockedUserIds }` 추가 필요.

**리스크**: research.md:189 "지출 목록은 숨기되 정산 계산에는 포함" — listExpenses는 balance/settlement 계산용 expenses도 로드하므로, 목록 필터와 계산용 쿼리를 분리해야 함.

### 3. 클라이언트 측 실시간 필터 훅

#### 3.1 웹 handleIncoming — chat/page.tsx:259-279

**현재 구현** (line 259-279):
```typescript
const handleIncoming = useCallback(
  (record: ChatBroadcastRecord) => {
    const message = fromBroadcast(record);
    setMessages((prev) =>
      prev.some((m) => m.id === message.id) ? prev : [...prev, message],
    );
    // ...멤버 재조회 폴백
  },
  [api, moimId],
);
```

**훅 위치**: line 262의 `fromBroadcast(record)` 직후, `setMessages` append 이전에 차단 여부 검사 필요:
```typescript
if (blockedUserIds.has(message.senderId)) return; // 조용히 드롭
```

**계층 정합성**: research.md:195 "서버 필터와 클라이언트 필터를 함께 구현하지 않으면 한쪽 경로로 노출" — 히스토리 로드(서버) + 신규 메시지(클라이언트) 모두 필터해야 리로드 후에도 일관됨.

### 4. 차단 목록 조회 패턴 (notification.service 선례)

research.md:152에서 권고한 패턴은 notification.service.ts:94-96을 답습.

**notification 선례** (차단과 동형):
- `findMany`에서 `where` 절에 `recipientId: sub` 내장
- "수신자별 필터가 격리의 단일 소스" (line 152 주석)

**차단 목록 조회 구현 예상**:
```typescript
async getBlockList(sub: string): Promise<string[]> {
  const rows = await this.prisma.block.findMany({
    where: { blockerId: sub },
  });
  return rows.map(r => r.blockedUserId);
}
```

이를 chat.service/poll.service/expense.service 각각에 주입 후 findMany where 절에 적용.

### 5. report 테이블 설계의 다형 참조 해결 방안

**research.md:210의 제안**: "report 테이블: id, reporter_id, target_user_id, moim_id, reason, 신고 대상 콘텐츠 참조(type + id), created_at"

**구체 스키마 (plan.md 확정 필요)**:
```sql
CREATE TABLE report (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  moim_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('chat_message', 'poll', 'expense', 'settlement_request')),
  content_id TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  FOREIGN KEY (moim_id) REFERENCES moim(id) ON DELETE CASCADE
);
```

**target_id 타입 통일**: 모든 content_id를 TEXT로 저장. chat_message 필터 시만 `BigInt(contentId)` 캐스팅(schema.prisma:195 주석 참조).

### 6. 미확정 범위 사항

- research.md:216 "지출 표시 방식" — 목록에서 차단 대상 지출을 숨길지, 익명("차단한 멤버")으로 표시할지 미결정. plan.md acceptance.md에서 명시 필요.
- research.md:217 "일정 슬롯 필터 불가" — 협업 편집(dates/window)은 작성자 추적이 없으므로 ScheduleSlot만 필터 가능. plan.md에서 한계 명시.
- research.md:221 신고 후 "이 멤버를 차단할까요?" 프롬프트 — UI 플로우 상세(웹/모바일) 미정의.

### 추가 조사 리스크

1. **PK 이질성**: chat_message BigInt vs poll/expense/settlement_request UUID로 report.content_id 타입 불일치 — migration 스키마에서 TEXT로 통일 필수(schema.prisma:195 주석 확인 후 타입 확정). 파일: schema.prisma 라인 194-206, 211-236, 78-93, 133-147.
2. **신고자 히스토리 필터와 실시간 필터의 계층 분리 부재**: chat.service.ts:93-98 where 절에만 추가하면 클라이언트 페이지의 handleIncoming(chat/page.tsx:259-279)은 여전히 차단 대상 메시지를 표시. 둘 다 구현하지 않으면 리로드 후 노출. 파일: chat.service.ts 라인 93-98, chat/page.tsx 라인 259-279.
3. **지출 정산 계산 오염**: expense.service.ts:181-185에서 createdBy 필터 시, listExpenses의 balance 계산(line 206-220)도 차단 대상을 제외하면 다른 멤버가 보는 정산 수치와 달라짐. research.md:189 "정산 계산에는 포함" 정책이 명시되었지만 구현 분리 미결정. 파일: expense.service.ts 라인 168-241.
4. **poll_vote/expense_share 복합 PK는 단일 id 참조 불가**: report 테이블이 이들을 신고 대상으로 수용하도록 설계되면, content_type='poll_vote' + content_id 하이브리드 참조 불가능. plan.md에서 신고 범위를 chat_message/poll/expense/settlement_request로 명시하지 않으면 마이그레이션 scope 충돌. 파일: schema.prisma 라인 262-276(poll_vote), 98-108(expense_share).
5. **차단 목록 조회 성능**: safety 모듈의 getBlockList()를 chat/poll/expense 각 listXXX 호출 시마다 실행하면 N+1 쿼리. 공용 helper로 캐싱하거나 where 절에 직접 임베드해야 함. research.md:152 패턴은 "notification 내 단일 WHERE" 구조이므로 chat/poll/expense 간 순환 의존 위험. 파일: research.md 라인 152, 212.
