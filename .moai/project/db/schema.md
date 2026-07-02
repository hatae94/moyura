---
engine: PostgreSQL 17.x (Supabase 관리형)
orm: Prisma 7.8.0
last_synced_at: 2026-07-02
manifest_hash: manual (db.yaml auto-sync 비활성 — enabled:false)
spec: SPEC-ACCOUNT-001 T-01 (withdrawn_account 툼스톤 테이블 + moim_member.withdrawn_at nullable 추가 — 회원 탈퇴 데이터 모델, additive 비파괴, withdrawn_account RLS default-deny)
---



# Database Schema

수동 갱신 기준: `apps/backend/prisma/schema.prisma` + 마이그레이션 파일. db.yaml auto-sync는 현재 비활성(`enabled: false`)이므로 SPEC sync 시 수동으로 갱신한다.

---

## Tables

| Table | Description |
|-------|-------------|
| `profile` | 앱 소유 사용자 프로필 — Supabase auth.users와 sub(uuid) 기반 연결. `name`(nullable) 추가(SPEC-MOBILE-004) |
| `withdrawn_account` | 계정 소멸 툼스톤 — sub PK-only(FK 없음), 부활 차단의 진실 공급원. RLS default-deny (SPEC-ACCOUNT-001 T-01) |
| `moim` | 모임 엔티티 — 모임 라이프사이클 루트 (SPEC-MOIM-001); `startsAt`(nullable) + `location`(nullable) 추가 (SPEC-MOIM-004) |
| `moim_member` | 멤버십 + 모임별 표시 이름(nickname) — moim_id + user_id 복합 PK (SPEC-MOIM-001); `withdrawnAt`(nullable) 추가 — 탈퇴 유령 멤버 표식(정원 필터/이양 대상 선정 소비, SPEC-ACCOUNT-001) |
| `moim_invite` | 초대 링크 — token PK, moim_id FK, 만료·폐기·사용 횟수 관리 (SPEC-MOIM-002) |
| `chat_message` | 모임 채팅 메시지 — BigInt PK, moim_id FK, RLS default-deny, content CHECK(1..2000) (SPEC-CHAT-001) |
| `device_token` | FCM 디바이스 토큰 레지스트리 — token PK, userId(=profile.id), platform, upsert 중복 없음 (SPEC-CHAT-002) |
| `poll` | 모임 투표 — uuid PK, moimId FK→moim Cascade, question, createdBy, createdAt, multiSelect(boolean, SPEC-MOIM-006), closesAt(nullable timestamp, SPEC-MOIM-007), kind(TEXT NOT NULL DEFAULT 'general', SPEC-MOIM-008) |
| `poll_option` | 투표 선택지 — uuid PK, pollId FK→poll Cascade, label, optionDate(nullable timestamp, SPEC-MOIM-008) |
| `poll_vote` | 투표 기록 — 복합 PK (pollId, optionId, userId), optionId FK→poll_option Cascade; 멤버당 옵션당 한 표 불변식(SPEC-MOIM-006 PK 변경) |
| `notification` | 인앱 알림 — BigInt keyset PK, recipient_id 수신자 sub, type String, moim_id FK Cascade, actor_id nullable, data JSONB, read_at 영속 읽음, RLS default-deny (SPEC-NOTIFICATIONS-001 M1) |
| `settlement_request` | 정산 요청(채권자→채무자) — id TEXT uuid PK, moim_id FK Cascade, requester_id·debtor_id·amount, RLS default-deny (SPEC-NOTIFICATIONS-001 M2) |
| `block` | 차단(전역 1-way UGC 모더레이션) — 복합 PK (blocker_id, blocked_user_id), FK 없음(soft-ref), `@@index([blockerId])`+`@@index([blockedUserId])`, RLS default-deny (SPEC-SAFETY-001 M1) |
| `report` | 신고(단일 PK 콘텐츠 4종) — id TEXT uuid PK, moim_id FK Cascade, reporter_id·target_user_id soft-ref, content_type CHECK(4종)·content_id TEXT, RLS default-deny (SPEC-SAFETY-001 M1) |

### profile

Prisma 모델명: `Profile` | 첫 도메인 마이그레이션: `20260602095934_init_profile` | name 추가 마이그레이션: `20260615000000_add_profile_name` (SPEC-MOBILE-004)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | Supabase JWT `sub` (uuid 문자열) — 별도 시퀀스 없음 |
| `name` | TEXT | NULLABLE | 사용자 표시 이름 — provider 비종속(이메일/Google/향후 Apple 공통). NULL = 온보딩 미완료 판별 기준(SPEC-MOBILE-004). `PATCH /me { name }` 으로 업데이트 |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |

### withdrawn_account

Prisma 모델명: `WithdrawnAccount` | 마이그레이션: `20260702200000_add_withdrawn_account` (SPEC-ACCOUNT-001 T-01)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `sub` | TEXT | PK | 삭제된 Supabase auth user id(= 구 profile.id). FK 없음(profile 행은 이미 삭제됨). PK만으로 존재 여부 조회 → 부활 차단 게이트 |
| `withdrawn_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 탈퇴 처리 시각 |

**용도**: 계정 소멸 툼스톤(REQ-ACCOUNT-003 부활 차단의 진실 공급원). `deleteAccount` 오케스트레이션이 profile 행을 삭제한 뒤, 잔존 JWT(유예 창 ≤1h)가 `GET /me`(`upsertBySub`)로 profile을 재생성하지 못하도록 이 테이블의 sub 존재 여부로 부활을 차단한다. auth 재가입 시 Supabase가 새 sub를 발급하므로 구 sub 툼스톤과 충돌하지 않는다(R-7).

**RLS**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny(notification/block/report 선례). PostgREST 직독 차단(탈퇴 계정 목록 노출 방지). Prisma(postgres 롤)는 영향 없음(부활 차단 조회 = NestJS 서비스 레이어).

**FK 없음**: profile 행은 삭제 시점에 이미 정리되므로 참조 무결성 대상이 없다(soft tombstone). 삭제·수정 대상 아님(insert-only 툼스톤 — deleteAccount의 upsert로만 기록).

### moim

Prisma 모델명: `Moim` | 마이그레이션: `20260613155202_add_moim` | 이벤트 필드 마이그레이션: `20260619000000_add_moim_event_fields` (SPEC-MOIM-004)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | uuid() 자동 생성 |
| `name` | TEXT | NOT NULL | 모임 이름 (최소 컬럼, 설명/이미지는 비범위) |
| `created_by` | TEXT | NOT NULL | 생성자 sub (= profile.id) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |
| `starts_at` | TIMESTAMP(3) | NULLABLE | 이벤트 시작 일시 — NULL = 일정 미정. 생성 시 optional 입력, ISO-8601 직렬화(`startsAt`). additive nullable 추가(기존 row NULL, SPEC-MOIM-004) |
| `location` | TEXT | NULLABLE | 이벤트 장소 — 자유 텍스트(예: "강남역 스타벅스"). NULL = 장소 미정. additive nullable 추가(기존 row NULL, SPEC-MOIM-004) |

### moim_member

Prisma 모델명: `MoimMember` | 마이그레이션: `20260613155202_add_moim`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `moim_id` | TEXT | PK(복합), FK → moim.id onDelete Cascade | 소속 모임 id |
| `user_id` | TEXT | PK(복합) | 멤버 sub (= profile.id) |
| `nickname` | TEXT | NOT NULL | 모임별 표시 이름(채팅 sender 해석 출처). profile.name은 전역 이름이고 nickname은 모임 내 표시 이름으로 역할이 다름(SPEC-MOBILE-004 이후 profile.name 존재) |
| `role` | TEXT | NOT NULL DEFAULT 'member' | "owner" 또는 "member". owner = 탈퇴 불가, 삭제 전용. |
| `joined_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 가입 시각 |
| `withdrawn_at` | TIMESTAMP(3) | NULLABLE | 탈퇴 마킹 — NULL = 활성 멤버. 탈퇴 시 멤버 행은 원장 무결성 보존을 위해 삭제하지 않고 nickname='탈퇴한 사용자'로 익명화하되 이 컬럼을 now()로 세팅해 "유령 멤버"로 표식한다. 정원 count(`withdrawnAt:null` 필터, R-6)와 소유권 이양 대상 선정(활성만, R-4b)이 소비. 기존 row 모두 NULL(additive 비파괴, 마이그레이션: `20260702200000_add_withdrawn_account`, SPEC-ACCOUNT-001) |

### moim_invite

Prisma 모델명: `MoimInvite` | 마이그레이션: `20260613171209_add_moim_invite`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `token` | TEXT | PK | CSPRNG 생성 불투명 토큰(≥128-bit 엔트로피) — URL-safe |
| `moim_id` | TEXT | NOT NULL, FK → moim.id onDelete Cascade | 소속 모임 id |
| `created_by` | TEXT | NOT NULL | 발급자 sub (= profile.id) |
| `expires_at` | TIMESTAMP(3) | NOT NULL | 만료 시각 (기본 발급 +7일, 상한 30일) |
| `max_uses` | INT | NULLABLE | 최대 수락 횟수 — NULL = 무제한 |
| `used_count` | INT | NOT NULL DEFAULT 0 | 현재까지 수락된 횟수 |
| `revoked_at` | TIMESTAMP(3) | NULLABLE | 폐기 시각 — NULL = 유효 |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |

### chat_message

Prisma 모델명: `ChatMessage` | 마이그레이션: `20260613175232_add_chat`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 단조 증가 메시지 ID — keyset 커서 기준(BigInt → DTO에서 string 직렬화) |
| `moim_id` | TEXT | NOT NULL, FK → moim.id onDelete Cascade | 소속 모임 id |
| `sender_id` | TEXT | NOT NULL | 발신자 sub (= profile.id) — nickname은 moim_member에서 클라이언트 측 해석 |
| `content` | TEXT | NOT NULL, CHECK(1..2000) | 메시지 본문. `chat_message_content_length` CHECK 제약(DB 최종 방어선) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 전송 시각 |

**RLS 설정**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny. Prisma(postgres 롤)는 직접 연결로 영향 없음(쓰기 인가 = NestJS 서비스 레이어). anon/authenticated PostgREST 직접 접근 차단 용도.

### device_token

Prisma 모델명: `DeviceToken` | 마이그레이션: `20260614_add_device_token`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `token` | TEXT | PK | FCM/Expo 푸시 토큰 — 디바이스별 고유 문자열 |
| `user_id` | TEXT | NOT NULL | 소유자 sub (= profile.id). 논리적 연결(FK 없음 — profile과 auth.users 경계 동일 사유) |
| `platform` | TEXT | NOT NULL | 플랫폼 구분 — "ios" \| "android" |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 최초 등록 시각 |
| `updated_at` | TIMESTAMP(3) | NOT NULL | 마지막 upsert 시각 (Prisma @updatedAt) |

**인덱스**: `@@index([userId])` — 사용자별 토큰 목록 조회(PushListener에서 수신자 토큰 일괄 조회) 최적화.

**IDOR 차단**: `DELETE /devices/:token` — `unregisterByOwner(userId, token)` 메서드가 `where: { token, userId }` 조건으로 owner-scoped 삭제. 타인 토큰 삭제 불가(OWASP A01:2021 대응).

**Supabase Realtime/PostgREST 미노출**: device_token은 PostgREST 접근 불필요. RLS 미적용(NestJS 서비스 레이어가 인가 경계).

**트리거**: `broadcast_chat_message()` SECURITY DEFINER 함수(`search_path=""`) + `chat_message_broadcast` AFTER INSERT FOR EACH ROW 트리거. Supabase Realtime `moim:{moimId}` private channel로 메시지 레코드만 fanout(nickname 미포함 — thin trigger).

**Realtime 구독 정책**: `realtime.messages` SELECT `members can receive moim broadcasts` — `moim_member` 멤버십 확인으로 구독 인가. 비멤버 구독 거부(AC-4).

**인덱스**: `@@index([moimId, id])` — keyset 내림차순 히스토리 쿼리 최적화(`id DESC`).

### poll

Prisma 모델명: `Poll` | 마이그레이션: `20260619100000_add_poll` (SPEC-MOIM-005) | multiSelect 추가 마이그레이션: `add_poll_multi_select` (SPEC-MOIM-006) | closesAt 추가 마이그레이션: `20260620200000_add_poll_closes_at` (SPEC-MOIM-007) | kind 추가 마이그레이션: `20260621000000_add_poll_kind_option_date` (SPEC-MOIM-008)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | uuid() 자동 생성 |
| `moim_id` | TEXT | NOT NULL, FK → moim.id onDelete Cascade | 소속 모임 id |
| `question` | TEXT | NOT NULL | 투표 질문 (trim 후 빈 값 → 400) |
| `created_by` | TEXT | NOT NULL | 생성자 sub (= profile.id, 가드 검증) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |
| `multi_select` | BOOLEAN | NOT NULL DEFAULT false | poll별 다중 선택 opt-in 플래그. false = 단일 교체(MOIM-005 동작 보존), true = 토글(0..N 선택). 기존 모든 poll row는 false(additive 추가, SPEC-MOIM-006) |
| `closes_at` | TIMESTAMP(3) | NULLABLE | 마감 시각 — deadline(생성 시 설정) + 수동 마감(closePoll이 now로 설정) 모두 이 컬럼 하나로 표현. null = 마감 없음(영구 열림, MOIM-005/006 기본 동작 보존). CLOSED 판정: closesAt != null AND closesAt <= now(서버 계산 isClosed로 노출). @default 없음 → 기존 poll row 모두 null(additive 비파괴, SPEC-MOIM-007) |
| `kind` | TEXT | NOT NULL DEFAULT 'general' | 투표 종류 — `"general"`(자유 텍스트 옵션, MOIM-005/006/007 그대로), `"date"`(날짜 옵션, SPEC-MOIM-008), `"place"`(장소명 자유 텍스트 옵션, SPEC-MOIM-010). Prisma enum 아님(string 컬럼 — CREATE TYPE 회피, 컨트롤러 parseKind 검증). `@default("general")` → 기존 poll row 모두 "general"(additive 비파괴). 미지 값 → 컨트롤러 400. **"place" 추가는 DDL 불필요** — string 컬럼의 허용 VALUE 확장이므로 마이그레이션 없이 컨트롤러 parseKind 한 줄 확장으로 완결(MOIM-010 마이그레이션 없음 — 13 마이그레이션 그대로). finalize: kind="place" close 시 단일 최다 득표 옵션의 `label`이 `Moim.location`으로 자동 확정(`MoimService.setLocation` 단일 출처). |

### poll_option

Prisma 모델명: `PollOption` | 마이그레이션: `20260619100000_add_poll` (SPEC-MOIM-005) | optionDate 추가 마이그레이션: `20260621000000_add_poll_kind_option_date` (SPEC-MOIM-008)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | uuid() 자동 생성 |
| `poll_id` | TEXT | NOT NULL, FK → poll.id onDelete Cascade | 소속 투표 id |
| `label` | TEXT | NOT NULL | 선택지 텍스트. 날짜 투표 옵션의 경우 파싱된 ISO 문자열(정규화 — 웹이 optionDate를 포맷해 렌더, raw label 노출 금지). 일반 투표는 자유 텍스트(MOIM-005 그대로) |
| `option_date` | TIMESTAMP(3) | NULLABLE | 날짜 투표 옵션의 시각 — kind="date" 생성 시 ISO 파싱값을 저장, finalize 판정의 출처(label ISO 재파싱 금지). kind="general" 이면 null(additive 비파괴, 기존 option row 모두 null, SPEC-MOIM-008) |

**정렬 주의**: `position` 컬럼 없음(SPEC-MOIM-005 Exclusions). 선택지는 결정적 키(`id`)로 정렬해 안정 표시.

### poll_vote

Prisma 모델명: `PollVote` | 마이그레이션: `20260619100000_add_poll` (SPEC-MOIM-005) | PK 변경 마이그레이션: `add_poll_multi_select` (SPEC-MOIM-006)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `poll_id` | TEXT | PK(복합), FK → poll.id onDelete Cascade | 소속 투표 id |
| `option_id` | TEXT | PK(복합), FK → poll_option.id onDelete Cascade | 선택한 옵션 id |
| `user_id` | TEXT | PK(복합) | 투표자 sub (= profile.id) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 투표 시각 |

**복합 PK `(poll_id, option_id, user_id)`** (SPEC-MOIM-006 변경): 멤버당 옵션당 한 표 불변식을 DB 레벨에서 강제. 단일 선택 poll — 서비스 레이어(deleteMany+create)가 한 멤버의 기존 표를 모두 삭제 후 새 표를 생성해 최대 1표 유지(교체 동작). 다중 선택 poll — findUnique(pollId,optionId,userId) 토글: 없으면 create, 있으면 delete(0..N 표). **비파괴 PK 변경 근거**: 기존 (pollId,userId) PK는 멤버당 정확히 1 row를 강제했으므로 그 (pollId,optionId,userId)도 자동 유일 → 신규 PK 위반 0 → row 손실 0.

**`@@index([optionId])` 보존**: PK 변경 후에도 option_id 기반 집계/조회 최적화 인덱스 유지.

**Cascade 체인**: moim 삭제 → poll Cascade → poll_option Cascade, poll_vote Cascade. poll 삭제 → poll_option/poll_vote Cascade.

### notification

Prisma 모델명: `Notification` | 마이그레이션: `20260701200000_add_notification` (SPEC-NOTIFICATIONS-001 M1) | 실시간 트리거: `20260702000000_add_notification_realtime_broadcast` (SPEC-NOTIFICATIONS-001 M4a)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | BIGINT | PK, AUTO_INCREMENT | 단조 증가 알림 ID — keyset 커서 기준(chat_message 선례). DTO에서 string 직렬화 |
| `recipient_id` | TEXT | NOT NULL | 수신자 sub (= profile.id). 모든 알림 조회는 recipient_id = 요청자 sub로 필터(IDOR 구조적 차단) |
| `type` | TEXT | NOT NULL | 알림 종류(Prisma enum 아님 — String 컬럼 컨벤션). 허용값은 리스너 상수(예: `'member.joined'`, `'poll.closed'`, `'settlement.requested'`) |
| `moim_id` | TEXT | NOT NULL, FK → moim.id onDelete Cascade | 컨텍스트 모임 id. 모임 삭제 시 알림도 Cascade 정리 |
| `actor_id` | TEXT | NULLABLE | 유발자 sub(nullable — 무행위자 알림 대비). nickname 미저장(응답 시점에 조회) |
| `data` | JSONB | NOT NULL DEFAULT '{}' | 타입별 미리보기 + 딥링크 타깃 id. 타입에 따라 구조 다름(예: `{pollId}`, `{scheduleId}`, `{amount}`). member.joined는 `{}` |
| `read_at` | TIMESTAMP(3) | NULLABLE | nullable = 안읽음. 읽음 처리 시 now로 갱신(per-item/mark-all-read). unread-count는 readAt IS NULL로 집계 |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |

**인덱스**:
- `@@index([recipientId, id(sort: Desc)])` — `notification_recipient_id_id_idx`: 피드 keyset 페이지네이션(수신자별 최신순)
- `@@index([recipientId, readAt])` — `notification_recipient_id_read_at_idx`: 미읽음 카운트 / mark-all-read (WHERE recipientId=sub AND readAt IS NULL)

**RLS**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny(SPEC-NOTIFICATIONS-001 M1 수동 SQL). Prisma(postgres 롤)는 영향 없음. 웹은 백엔드 API로만 알림 열람(PostgREST 직독 차단). 실시간 배지 구독 인가는 `realtime.messages` `"users can receive own notifications"` 정책(M4a)이 별도 담당.

### settlement_request

Prisma 모델명: `SettlementRequest` | 마이그레이션: `20260701210000_add_settlement_request` (SPEC-NOTIFICATIONS-001 M2)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | uuid() 자동 생성 |
| `moim_id` | TEXT | NOT NULL, FK → moim.id onDelete Cascade | 소속 모임 id. 모임 삭제 시 요청도 Cascade 정리 |
| `requester_id` | TEXT | NOT NULL | 채권자 sub (= profile.id, 돈을 받을 사람). 가드-검증 sub만(mass-assignment 차단) |
| `debtor_id` | TEXT | NOT NULL | 채무자 sub (= profile.id, 돈을 낼 사람). `settlement.requested` 알림 수신 대상 |
| `amount` | INT | NOT NULL | 요청 금액 (원 단위) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 요청 생성 시각 |

**인덱스**: `@@index([moimId])` — `settlement_request_moim_id_idx`: 모임별 정산 요청 목록 조회 최적화.

**RLS**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny(notification 선례). PostgREST 직독 차단. Prisma(postgres 롤)는 영향 없음(인가 = NestJS 서비스 레이어).

**설계 근거**: 정산 완료(`Settlement`)와 분리한 별도 테이블. `Settlement`는 (from,to,amount) 매칭으로 `settled=true`를 계산하는 완료 스냅샷이므로, 이 테이블에 요청(pending) 행을 합치면 매칭 로직이 오염된다(회귀 위험). 요청·완료를 분리해 인가·수명주기·이벤트가 각각 독립적.

### block

Prisma 모델명: `Block` | 마이그레이션: `20260702100000_add_safety` (SPEC-SAFETY-001 M1)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `blocker_id` | TEXT | PK(복합) | 차단자 sub (= profile.id). 가드-검증 sub만(WHERE 내장 인가 — mass-assignment 차단) |
| `blocked_user_id` | TEXT | PK(복합) | 차단 대상 sub (= profile.id). FK 없음(soft-ref) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 차단 시각 |

**인덱스**: `@@index([blockerId])` — `block_blocker_id_idx`: `getHiddenUserIds(sub)` 정방향 조회(blockerId=sub → blockedUserId). `@@index([blockedUserId])` — `block_blocked_user_id_idx`: `getBlockersOf(userIds)` 역방향 조회(blockedUserId in → blockerId 집합, REQ-FLT-006 발신 push 필터).

**RLS**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny(notification 선례, REQ-CPL-004). PostgREST 직독 차단. Prisma(postgres 롤)는 영향 없음(인가 = NestJS 서비스 레이어).

**설계 근거**: 전역(모임 무관) 1-way 차단 — 차단은 userId(sub) 매칭이며 대상의 UGC를 차단자 화면에서만 숨긴다(게스트·명명 계정 동일 취급, REQ-BLK-003). 복합 PK가 "차단자당 대상당 한 행" 불변식을 강제해 `createBlock`이 P2002를 멱등(200)으로 흡수한다. FK 없음 — 탈퇴 사용자 고아 행 정리는 SPEC-ACCOUNT-001 `deleteAccount`가 prisma 직접 접근(`block.deleteMany`)으로 담당(모듈 import 아님 → 순환 의존 회피).

### report

Prisma 모델명: `Report` | 마이그레이션: `20260702100000_add_safety` (SPEC-SAFETY-001 M1)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | uuid() 자동 생성 |
| `reporter_id` | TEXT | NOT NULL | 신고자 sub (= profile.id). 가드-검증 sub만(WHERE 내장 인가). FK 없음(soft-ref) |
| `target_user_id` | TEXT | NOT NULL | 신고 대상(피신고 콘텐츠 작성자) sub. FK 없음(soft-ref) |
| `moim_id` | TEXT | NOT NULL, FK → moim.id onDelete Cascade | 신고 컨텍스트 모임 id. 모임 삭제 시 신고도 Cascade 정리 |
| `reason` | TEXT | NOT NULL | 신고 사유(자유 텍스트). 빈 값은 컨트롤러가 400으로 거른다 |
| `content_type` | TEXT | NOT NULL, CHECK(4종) | 신고 콘텐츠 타입. 허용값 = `chat_message`\|`poll`\|`expense`\|`settlement_request`(DB CHECK 제약, REQ-RPT-004) |
| `content_id` | TEXT | NOT NULL | 신고 콘텐츠 id(TEXT 통일). chat_message(BigInt PK)는 필터 시 BigInt 캐스팅(REQ-RPT-005) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 신고 시각 |

**인덱스**: `@@index([reporterId])` — `report_reporter_id_idx`: `getHiddenUserIds(sub)`의 신고 항 정방향 조회(reporterId=sub → targetUserId). `@@index([targetUserId])` — `report_target_user_id_idx`: 대상 유저별 신고 조회(운영자 수동 검토, REQ-STO-001). `@@index([moimId])` — `report_moim_id_idx`: 모임별 신고 조회.

**RLS**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny(REQ-CPL-004). 운영자 수동 DB 조회(REQ-STO-001)는 postgres 롤(RLS 미적용) 경유이며, anon/authenticated 직독은 차단.

**설계 근거**: 단일 PK 콘텐츠 4종만 참조(복합 PK poll_vote/expense_share/schedule_slot은 단일 content_id 참조 불가라 CHECK로 거부, REQ-RPT-004). 신고는 차단과 독립(신고 ≠ 차단, REQ-RPT-002) — `createReport`는 report 행만 만들고 block은 만들지 않으며, 신고자 측 숨김의 진실 공급원이다(`getHiddenUserIds`의 report 항). content_id를 TEXT로 통일해 이질적 PK(BigInt/uuid)를 흡수한다.

---

## Triggers & Realtime (수동 SQL — Prisma diff 비가시)

Prisma 스키마로 표현 불가한 트리거·RLS·CHECK를 기록한다. 스키마 변경 시 수동 동기화 대상.

### SPEC-CHAT-001 broadcast 트리거 (add_chat 마이그레이션)

`apps/backend/prisma/migrations/20260613175232_add_chat/migration.sql`에 포함된 수동 SQL:

| 항목 | 내용 |
|------|------|
| **함수** | `broadcast_chat_message()` — `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`. `realtime.broadcast_changes('moim:'||moim_id, 'INSERT', 'INSERT', 'chat_message', 'public', NEW, NULL)` 7-arg 호출(private 채널, thin trigger — nickname 미포함). |
| **트리거** | `chat_message_broadcast` — `AFTER INSERT FOR EACH ROW` on `chat_message`. |
| **이벤트명** | `'INSERT'` |
| **채널** | `moim:{moimId}` (private) |
| **RLS 재사용** | `realtime.messages` SELECT 정책 `"members can receive moim broadcasts"` — `moim_member` 멤버십 확인으로 구독 인가. 비멤버 구독 거부. |
| **Shadow DB 가드** | `to_regnamespace('realtime') IS NOT NULL` 가드 DO 블록으로 감싸 Prisma shadow DB 검증 통과(실 DB에서만 생성). |
| **검증** | 2026-06-14 psql 존재 단언(함수·트리거·RLS·RLS enable·CHECK 모두 확인). |

### SPEC-MOIM-009 broadcast 트리거 (add_poll_realtime_broadcast 마이그레이션)

`apps/backend/prisma/migrations/20260622000000_add_poll_realtime_broadcast/migration.sql`에 포함된 수동 SQL:

| 항목 | 내용 |
|------|------|
| **함수** | `broadcast_poll_change()` — `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`. `realtime.send(jsonb_build_object('moimId', v_moim_id, 'pollId', v_poll_id), 'poll_change', 'moim:'||v_moim_id, true)` 호출(private 채널, 경량 신호 — 집계/표 정보 미포함). |
| **트리거 1** | `poll_broadcast` — `AFTER INSERT OR UPDATE FOR EACH ROW` on `poll`. `TG_TABLE_NAME='poll'` 분기 — `NEW.moim_id`/`NEW.id` 직접 사용. |
| **트리거 2** | `poll_vote_broadcast` — `AFTER INSERT OR DELETE FOR EACH ROW` on `poll_vote`. `TG_TABLE_NAME` 분기 후 `TG_OP='DELETE'`이면 `OLD.poll_id`, `INSERT`이면 `NEW.poll_id`로 poll_id 결정 → `SELECT moim_id FROM public.poll WHERE id = poll_id`로 moimId 해소(`poll_vote`에 moim_id 컬럼 없음). |
| **이벤트명** | `'poll_change'` — 채팅 `'INSERT'`와 구별(교차 수신 방지). |
| **채널** | `moim:{moimId}` (private) — CHAT-001과 동일 채널 재사용. |
| **RLS 재사용** | CHAT-001의 `realtime.messages` SELECT 정책 `"members can receive moim broadcasts"` 그대로 재사용. poll broadcast도 `realtime.messages`를 거치므로 멤버십 게이트가 자동 적용(비멤버 차단). 신규 RLS 정책 추가 없음. |
| **멱등 가드** | `DROP TRIGGER IF EXISTS poll_broadcast ON "poll"; DROP TRIGGER IF EXISTS poll_vote_broadcast ON "poll_vote";` 선행 실행. |
| **페이로드** | `{moimId, pollId}` — 경량 신호. 집계(voteCount)/myVotes/표 내용 미포함. 각 클라이언트가 `router.refresh()`로 서버 재조회해 자신의 뷰를 얻는다(서버 = 단일 진실 출처). |
| **검증** | 2026-06-22 poll-realtime.live.mts 7/7 PASS(실 Supabase 스택 — 멤버 수신·비멤버 RLS 차단·경량 페이로드 확인). |

> **문서 드리프트 주의**: `add_moim_max_members_and_member_realtime`(member_change), `add_expense_realtime_broadcast`(expense_change), `add_schedule_realtime_broadcast`(schedule_change) 트리거는 모두 CHAT-001 의 `moim:` 채널·`realtime.messages` 정책을 재사용하는 동형 패턴(SECURITY DEFINER + search_path='' + realtime.send)이며 위 CHAT-001/MOIM-009 표와 구조가 동일하다. 별도 표는 아직 미기재(신규 RLS 정책이 없어 재사용). 아래 NOTIFICATIONS-001 M4a 는 **신규 `user:` 채널 + 신규 realtime RLS 정책**을 도입하므로 별도 기재한다.

### SPEC-NOTIFICATIONS-001 M4a broadcast 트리거 (add_notification_realtime_broadcast 마이그레이션)

`apps/backend/prisma/migrations/20260702000000_add_notification_realtime_broadcast/migration.sql`에 포함된 수동 SQL:

| 항목 | 내용 |
|------|------|
| **함수** | `broadcast_notification_new()` — `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = ''`. `realtime.send(jsonb_build_object('type', NEW.type), 'notification_new', 'user:'||NEW.recipient_id, true)` 호출(per-user private 채널, 경량 페이로드 — 알림 종류만). `realtime.send` 를 `BEGIN...EXCEPTION WHEN OTHERS THEN NULL END` 로 감싸 방송 실패가 fan-out INSERT 를 절대 중단시키지 않는다(best-effort, 알림 영속 우선). |
| **트리거** | `notification_broadcast` — `AFTER INSERT FOR EACH ROW` on `notification`. INSERT-only(NEW 만 사용). 수신자당 1행 fan-out → 각 행이 서로 다른 `user:{id}` 토픽으로 1회 발화 → 사용자당 정확히 1회 수신(collapse 하지 않음 — member_change per-row 트리거와 동형). |
| **이벤트명** | `'notification_new'` — 다른 도메인 방송(`'INSERT'`/`'poll_change'`/`'member_change'`/`'expense_change'`/`'schedule_change'`, 모두 `moim:` 토픽)과 이벤트·토픽 모두 구별(교차 수신 방지). |
| **채널** | `user:{recipientId}` (private) — 모임 무관 per-user 전역 채널. `moim:` 와 달리 조인 불필요(recipient_id 직접 보유). |
| **신규 RLS 정책** | `realtime.messages` SELECT `"users can receive own notifications"` — `USING (realtime.topic() = 'user:'||(SELECT auth.uid())::text)`. add_chat 의 `moim:` 정책과 **공존**(둘 다 authenticated SELECT → OR 결합). 조인 없이 자기 `user:` 토픽만 수신 허용(남의 토픽 구독 거부). |
| **Shadow DB 가드** | `to_regnamespace('realtime') IS NOT NULL` 가드 DO 블록으로 정책 생성을 감싸 Prisma shadow DB 검증 통과(실 DB에서만 생성). `DROP POLICY IF EXISTS` 선행으로 재실행 멱등(CREATE POLICY 는 IF NOT EXISTS 미지원 → drop-then-create). |
| **페이로드** | `{type}` — 경량 신호(알림 종류만). unread-count/목록 상세는 각 클라이언트가 수신을 신호로 서버 재조회(서버 = 단일 진실 출처, poll 선례). |
| **검증** | 2026-07-02 node+pg 존재 단언(함수 SECURITY DEFINER·search_path='', `notification_broadcast` AFTER INSERT ROW 트리거, `realtime.messages` user: 정책, test INSERT 성공→트리거 미중단→cleanup 확인). |

### SPEC-SAFETY-001 M1 RLS + CHECK 수동 SQL (add_safety 마이그레이션)

`apps/backend/prisma/migrations/20260702100000_add_safety/migration.sql`에 포함된 수동 SQL(트리거 없음 — RLS enable + CHECK만). Realtime 영향 없음(차단 신규 채널·트리거·방송 정책 미추가 — 실시간 필터는 클라이언트 측):

| 항목 | 내용 |
|------|------|
| **CHECK** | `report_content_type_check` — `CHECK (content_type IN ('chat_message','poll','expense','settlement_request'))`. 단일 PK 콘텐츠 4종만 신고 대상(REQ-RPT-004). 컨트롤러 화이트리스트(400)와 이중 강제 — 복합 PK 콘텐츠(poll_vote/expense_share/schedule_slot)는 단일 content_id 참조 불가라 DB 레벨에서도 거른다. |
| **RLS (block)** | `ALTER TABLE "block" ENABLE ROW LEVEL SECURITY;` + 정책 없음 = default deny(REQ-CPL-004). anon/authenticated PostgREST 직독 차단. Prisma(postgres 롤)는 영향 없음. |
| **RLS (report)** | `ALTER TABLE "report" ENABLE ROW LEVEL SECURITY;` + 정책 없음 = default deny(REQ-CPL-004). 운영자 수동 DB 조회(REQ-STO-001)는 postgres 롤 경유이며 직독은 차단. |
| **FK** | `report_moim_id_fkey` — `moim_id → moim(id) ON DELETE CASCADE`(Prisma diff 가시 — relation 선언). `block`은 FK 없음(양쪽 user soft-ref). |
| **검증** | 2026-07-02 node+pg 존재 단언: `pg_tables.rowsecurity=true`(block/report), `pg_policies` 0건(default deny), `report_content_type_check`/`report_moim_id_fkey` constraint 정의, 6개 인덱스, 생성 클라이언트 `Block.ts`/`Report.ts` 방출. `migrate status` up-to-date + `diff --exit-code` 0(드리프트 없음). |

### SPEC-ACCOUNT-001 T-01 RLS 수동 SQL (add_withdrawn_account 마이그레이션)

`apps/backend/prisma/migrations/20260702200000_add_withdrawn_account/migration.sql`에 포함된 수동 SQL(트리거 없음 — RLS enable만. Realtime 영향 없음):

| 항목 | 내용 |
|------|------|
| **RLS (withdrawn_account)** | `ALTER TABLE "withdrawn_account" ENABLE ROW LEVEL SECURITY;` + 정책 없음 = default deny(notification/block/report 선례). anon/authenticated PostgREST 직독 차단(탈퇴 계정 목록 노출 방지). Prisma(postgres 롤)는 영향 없음(부활 차단 조회 = NestJS 서비스 레이어). |
| **AlterTable** | `ALTER TABLE "moim_member" ADD COLUMN "withdrawn_at" TIMESTAMP(3);`(Prisma diff 가시 — nullable, DEFAULT 없음, 기존 row NULL). 복합 PK/FK/인덱스 불변(순수 additive). |
| **검증** | 2026-07-02 node+pg 존재 단언: `withdrawn_account.rowsecurity=true`, `pg_policies` 0건(default deny), PK=`sub`(단일, FK 없음), `withdrawn_at` NOT NULL DEFAULT CURRENT_TIMESTAMP, `moim_member.withdrawn_at` nullable. `WithdrawnAccount.ts` 클라이언트 방출, `migrate status` up-to-date + `diff --exit-code` 0(드리프트 없음), `nx build backend` 성공. |

---

## Relationships

| From | To | Cardinality | FK Column | Notes |
|------|----|-------------|-----------|-------|
| `moim_member` | `moim` | N:1 | `moim_member.moim_id` | onDelete Cascade — 모임 삭제 시 멤버십 자동 정리 |
| `moim_invite` | `moim` | N:1 | `moim_invite.moim_id` | onDelete Cascade — 모임 삭제 시 초대 자동 정리 |
| `chat_message` | `moim` | N:1 | `chat_message.moim_id` | onDelete Cascade — 모임 삭제 시 채팅 메시지 자동 정리 |
| `poll` | `moim` | N:1 | `poll.moim_id` | onDelete Cascade — 모임 삭제 시 투표 자동 정리 (SPEC-MOIM-005) |
| `poll_option` | `poll` | N:1 | `poll_option.poll_id` | onDelete Cascade — 투표 삭제 시 선택지 자동 정리 (SPEC-MOIM-005) |
| `poll_vote` | `poll` | N:1 | `poll_vote.poll_id` | onDelete Cascade — 투표 삭제 시 표 자동 정리 (SPEC-MOIM-005) |
| `poll_vote` | `poll_option` | N:1 | `poll_vote.option_id` | onDelete Cascade — 선택지 삭제 시 표 자동 정리 (SPEC-MOIM-005) |
| `notification` | `moim` | N:1 | `notification.moim_id` | onDelete Cascade — 모임 삭제 시 알림 자동 정리 (SPEC-NOTIFICATIONS-001 M1) |
| `settlement_request` | `moim` | N:1 | `settlement_request.moim_id` | onDelete Cascade — 모임 삭제 시 정산 요청 자동 정리 (SPEC-NOTIFICATIONS-001 M2) |
| `report` | `moim` | N:1 | `report.moim_id` | onDelete Cascade — 모임 삭제 시 신고 자동 정리 (SPEC-SAFETY-001 M1). `block`은 모임 무관·FK 없음(전역 soft-ref) |

> `profile.id`와 `moim.created_by` / `moim_member.user_id` / `moim_invite.created_by` / `device_token.user_id`는 모두 Supabase `sub`로 논리적으로 연결되나, 현재 schema에 외래 키 제약은 없다(auth.users는 Supabase 내부 스키마 — app-owned profile 패턴). `device_token`은 `moim`에도 FK가 없는 독립 레지스트리다(사용자-디바이스 등록, moim과 무관).

---

## Indexes

| Table | Columns | Type | Purpose |
|-------|---------|------|---------|
| `profile` | `id` | PK (기본) | 단일 PK 조회 |
| `withdrawn_account` | `sub` | PK (기본) | 툼스톤 존재 여부 단일 조회(부활 차단 게이트, SPEC-ACCOUNT-001) |
| `moim` | `id` | PK (기본) | 단일 PK 조회 |
| `moim_member` | `(moim_id, user_id)` | PK 복합 (기본) | 멤버십 유일성 보장 — 한 사용자는 한 모임에 한 번만 |
| `moim_invite` | `token` | PK (기본) | 토큰 단일 조회 |
| `moim_invite` | `moim_id` | INDEX (`@@index([moimId])`) | 모임별 초대 목록 조회 최적화 |
| `chat_message` | `id` | PK (기본) | 메시지 단일 조회 |
| `chat_message` | `(moim_id, id)` | INDEX (`@@index([moimId, id])`) | 모임별 keyset 내림차순 히스토리 쿼리 최적화 |
| `device_token` | `token` | PK (기본) | 토큰 단일 조회 |
| `device_token` | `user_id` | INDEX (`@@index([userId])`) | 사용자별 토큰 목록 조회 최적화(PushListener 수신자 토큰 일괄 조회) |
| `poll` | `id` | PK (기본) | 단일 PK 조회 |
| `poll_option` | `id` | PK (기본) | 단일 PK 조회 |
| `poll_vote` | `(poll_id, option_id, user_id)` | PK 복합 (기본) | 멤버당 옵션당 한 표 불변식 — 한 사용자는 한 poll의 한 옵션에 한 표(SPEC-MOIM-006 PK 변경, 비파괴) |
| `poll_vote` | `option_id` | INDEX (`@@index([optionId])`) | 옵션 기반 집계/조회 최적화 (SPEC-MOIM-006 PK 변경 후 보존) |
| `notification` | `id` | PK (기본) | 단일 PK 조회 |
| `notification` | `(recipient_id, id DESC)` | INDEX (`@@index([recipientId, id(sort: Desc)])`) | 수신자별 최신순 피드 keyset 페이지네이션 |
| `notification` | `(recipient_id, read_at)` | INDEX (`@@index([recipientId, readAt])`) | 미읽음 카운트 / mark-all-read 필터 최적화 |
| `settlement_request` | `id` | PK (기본) | 단일 PK 조회 |
| `settlement_request` | `moim_id` | INDEX (`@@index([moimId])`) | 모임별 정산 요청 목록 조회 최적화 |
| `block` | `(blocker_id, blocked_user_id)` | PK 복합 (기본) | 차단자당 대상당 한 행 불변식(멱등 — 중복 차단 방지, SPEC-SAFETY-001 M1) |
| `block` | `blocker_id` | INDEX (`@@index([blockerId])`) | `getHiddenUserIds(sub)` 정방향 조회(blockerId=sub) |
| `block` | `blocked_user_id` | INDEX (`@@index([blockedUserId])`) | `getBlockersOf(userIds)` 역방향 조회(blockedUserId in — REQ-FLT-006 발신 push 필터) |
| `report` | `id` | PK (기본) | 단일 PK 조회 |
| `report` | `reporter_id` | INDEX (`@@index([reporterId])`) | `getHiddenUserIds(sub)`의 신고 항 정방향 조회(reporterId=sub) |
| `report` | `target_user_id` | INDEX (`@@index([targetUserId])`) | 대상 유저별 신고 조회(운영자 수동 검토, REQ-STO-001) |
| `report` | `moim_id` | INDEX (`@@index([moimId])`) | 모임별 신고 조회 |

---

## Constraints

| Table | Constraint | Type | Definition |
|-------|-----------|------|-----------|
| `profile` | `profile_pkey` | PK | `id` |
| `withdrawn_account` | `withdrawn_account_pkey` | PK | `sub` (SPEC-ACCOUNT-001 T-01, FK 없음 — soft tombstone) |
| `moim` | `moim_pkey` | PK | `id` |
| `moim_member` | `moim_member_pkey` | PK | `(moim_id, user_id)` |
| `moim_member` | `moim_member_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `moim_invite` | `moim_invite_pkey` | PK | `token` |
| `moim_invite` | `moim_invite_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `chat_message` | `chat_message_pkey` | PK | `id` (BIGSERIAL) |
| `chat_message` | `chat_message_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `chat_message` | `chat_message_content_length` | CHECK | `char_length(content) BETWEEN 1 AND 2000` |
| `device_token` | `device_token_pkey` | PK | `token` |
| `poll` | `poll_pkey` | PK | `id` |
| `poll` | `poll_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `poll_option` | `poll_option_pkey` | PK | `id` |
| `poll_option` | `poll_option_poll_id_fkey` | FK | `poll_id → poll(id) ON DELETE CASCADE` |
| `poll_vote` | `poll_vote_pkey` | PK | `(poll_id, option_id, user_id)` (SPEC-MOIM-006 변경 — 기존 `(poll_id, user_id)`) |
| `poll_vote` | `poll_vote_poll_id_fkey` | FK | `poll_id → poll(id) ON DELETE CASCADE` |
| `poll_vote` | `poll_vote_option_id_fkey` | FK | `option_id → poll_option(id) ON DELETE CASCADE` |
| `notification` | `notification_pkey` | PK | `id` (BIGSERIAL) |
| `notification` | `notification_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `settlement_request` | `settlement_request_pkey` | PK | `id` |
| `settlement_request` | `settlement_request_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `block` | `block_pkey` | PK | `(blocker_id, blocked_user_id)` (SPEC-SAFETY-001 M1) |
| `report` | `report_pkey` | PK | `id` |
| `report` | `report_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `report` | `report_content_type_check` | CHECK | `content_type IN ('chat_message','poll','expense','settlement_request')` (REQ-RPT-004) |
