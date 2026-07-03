# Migrations

수동 갱신 기준: `apps/backend/prisma/migrations/`. db.yaml auto-sync는 현재 비활성(`enabled: false`)이므로 SPEC sync 시 수동으로 갱신한다.

---

## Applied Migrations

로컬 Supabase(`:54322`) 적용 기준. 적용 시각은 `prisma migrate status` 기준(Checksum은 Prisma 내부 관리).

| Filename | Applied At | Summary |
|----------|-----------|---------|
| `20260602095934_init_profile` | 2026-06-02 | `profile` 테이블 생성 — Supabase sub PK, SPEC-AUTH-001 |
| `20260613155202_add_moim` | 2026-06-13 | `moim` + `moim_member` 테이블 생성, moim_member → moim FK onDelete Cascade, SPEC-MOIM-001 |
| `20260613171209_add_moim_invite` | 2026-06-13 | `moim_invite` 테이블 생성 — token PK, moim_id FK onDelete Cascade, @@index(moimId), SPEC-MOIM-002 |
| `20260613175232_add_chat` | 2026-06-14 | `chat_message` 테이블(BigInt PK, moim_id FK Cascade, @@index(moimId, id desc)) + **수동 SQL**: content CHECK(1..2000), chat_message RLS enable(default deny), `broadcast_chat_message()` security-definer 함수, `chat_message_broadcast` AFTER INSERT 트리거, `realtime.messages` SELECT 정책(멤버십 게이트). SPEC-CHAT-001 |
| `20260614_add_device_token` | 2026-06-14 | `device_token` 테이블(token TEXT PK, user_id TEXT, platform TEXT, created_at, updated_at; @@index(userId)). SPEC-CHAT-002 — FCM 디바이스 토큰 레지스트리. Prisma 표준 타임스탬프 없음(파일명에 시간 부분 미포함 — 로컬 개발 단계 마이그레이션. 적용은 `db execute` + `migrate resolve --applied`로 체크섬 드리프트 우회). |
| `20260615000000_add_profile_name` | 2026-06-15 | `profile` 테이블에 `name TEXT` 컬럼(nullable) 추가. SPEC-MOBILE-004 — provider 비종속 이름 온보딩. NULL = 온보딩 미완료 판별 기준. `PATCH /me { name }` 으로 업데이트. |
| `20260619000000_add_moim_event_fields` | 2026-06-19 | `moim` 테이블에 `starts_at TIMESTAMP(3)` + `location TEXT` 컬럼(모두 nullable) 추가. SPEC-MOIM-004 — 모임 이벤트 일정/장소 필드. 기존 row는 두 값 모두 NULL(additive 무중단 마이그레이션). |
| `20260619100000_add_poll` | 2026-06-19 | `poll`(id TEXT PK uuid, moim_id FK→moim Cascade, question, created_by, created_at) + `poll_option`(id TEXT PK uuid, poll_id FK→poll Cascade, label) + `poll_vote`(복합 PK(poll_id,user_id), option_id FK→poll_option Cascade, created_at) 신규 3 테이블 CREATE. 비파괴 additive(기존 테이블 무변경). SPEC-MOIM-005 — 모임 투표/단일 투표/결과 집계. |
| `add_poll_multi_select` | 2026-06-20 | `poll` 테이블에 `multi_select BOOLEAN NOT NULL DEFAULT false` 컬럼 additive 추가(기존 poll row 모두 false). `poll_vote` 복합 PK `(poll_id,user_id)` → `(poll_id,option_id,user_id)` 비파괴 변경(`poll_vote_pkey` DROP + ADD — 기존 단일 선택 표는 (pollId,userId) 유일이므로 (pollId,optionId,userId)도 자동 유일 → row 손실 0). `@@index([optionId])` 보존. 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean). SPEC-MOIM-006 — 투표 다중 선택. |
| `20260620200000_add_poll_closes_at` | 2026-06-20 | `poll` 테이블에 `closes_at TIMESTAMP(3)` 컬럼 nullable additive 추가(`@default` 없음 — 기존 poll row 모두 null = 마감 없음, MOIM-005/006 동작 보존). `poll_vote` PK/FK/인덱스 무변경. SQL: `ALTER TABLE poll ADD COLUMN closes_at TIMESTAMP(3);` — 비파괴(데이터 손실 0). 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean). SPEC-MOIM-007 — 투표 마감(deadline + 수동 마감). |
| `20260621000000_add_poll_kind_option_date` | 2026-06-21 | `poll` 테이블에 `kind TEXT NOT NULL DEFAULT 'general'` 컬럼 additive 추가(기존 poll row 모두 kind="general" = 일반 투표, @default로 비파괴). `poll_option` 테이블에 `option_date TIMESTAMP(3)` 컬럼 nullable additive 추가(기존 option row 모두 null = 날짜 없음). `poll_vote` PK/FK/인덱스 무변경. SQL: `ALTER TABLE poll ADD COLUMN kind TEXT NOT NULL DEFAULT 'general'; ALTER TABLE poll_option ADD COLUMN option_date TIMESTAMP(3);` — 비파괴(row 손실 0, Prisma enum 아님 — CREATE TYPE 없음). 비파괴 패턴(migrate diff → db execute → migrate resolve --applied → migrate status clean). SPEC-MOIM-008 — 일정 투표 자동 확정(날짜 투표 종류 + 옵션 시각). |
| `20260622000000_add_poll_realtime_broadcast` | 2026-06-22 | **순수 트리거 추가 — 테이블/컬럼/PK/FK/인덱스 무변경**. `broadcast_poll_change()` plpgsql 함수(`SECURITY DEFINER`, `SET search_path=''`) 신규 정의: `realtime.send(jsonb_build_object('moimId',...,'pollId',...), 'poll_change', 'moim:'||moimId, true)`를 호출해 경량 신호를 CHAT-001과 같은 private 채널에 전파. `poll` 트리거는 `NEW.moim_id` 직접 사용, `poll_vote` 트리거는 `poll_id` → `public.poll.moim_id` 조회로 moimId 해소. `DROP TRIGGER IF EXISTS` 멱등 가드 포함. 비파괴 패턴(hand-authored migration.sql → db execute → migrate resolve --applied → migrate status clean). SPEC-MOIM-009 — 투표 결과 실시간 갱신(CHAT-001 채널·RLS 재사용). |
| `20260701200000_add_notification` | 2026-07-01 | `notification` 테이블 생성(BIGSERIAL PK, recipient_id TEXT, type TEXT, moim_id TEXT FK→moim Cascade, actor_id TEXT nullable, data JSONB NOT NULL DEFAULT '{}', read_at TIMESTAMP(3) nullable, created_at). 인덱스: `(recipient_id, id DESC)` (피드 keyset) + `(recipient_id, read_at)` (unread-count/mark-all). 수동 SQL: `ENABLE ROW LEVEL SECURITY` + 정책 없음(default deny — PostgREST 직독 차단, Prisma postgres 롤 무영향). 순수 additive. prod 적용 완료(2026-07-02). SPEC-NOTIFICATIONS-001 M1 |
| `20260701210000_add_settlement_request` | 2026-07-01 | `settlement_request` 테이블 신규 생성(id TEXT PK uuid, moim_id TEXT FK→moim Cascade, requester_id TEXT, debtor_id TEXT, amount INT, created_at). 인덱스: `(moim_id)`. 수동 SQL: `ENABLE ROW LEVEL SECURITY` + 정책 없음(notification 선례 default deny). 순수 additive(기존 테이블 무변경). prod 적용 완료(2026-07-02). SPEC-NOTIFICATIONS-001 M2 |
| `20260702000000_add_notification_realtime_broadcast` | 2026-07-02 | **순수 트리거·RLS 추가 — 테이블/컬럼/PK/FK 무변경**. `broadcast_notification_new()` plpgsql 함수(`SECURITY DEFINER`, `SET search_path=''`) 신규 정의: `realtime.send(jsonb_build_object('type', NEW.type), 'notification_new', 'user:'||NEW.recipient_id, true)`. `BEGIN...EXCEPTION WHEN OTHERS THEN NULL END` 으로 감싸 best-effort(방송 실패가 notification INSERT를 절대 중단시키지 않음 — 알림 영속 우선). `notification_broadcast` AFTER INSERT FOR EACH ROW 트리거. `realtime.messages` SELECT 정책 `"users can receive own notifications"` 신설(`moim:` 정책과 OR 공존). Shadow DB 가드(`to_regnamespace`) + DROP-THEN-CREATE 멱등. prod 적용 완료(2026-07-02). SPEC-NOTIFICATIONS-001 M4a |
| `20260702100000_add_safety` | 2026-07-02 | `block`(복합 PK (blocker_id, blocked_user_id), FK 없음 soft-ref) + `report`(id TEXT PK uuid, moim_id FK→moim Cascade, reporter_id·target_user_id soft-ref, content_type·content_id TEXT) 신규 2 테이블 CREATE. 인덱스 6개(`block_blocker_id_idx`·`block_blocked_user_id_idx`, `report_reporter_id_idx`·`report_target_user_id_idx`·`report_moim_id_idx`). 수동 SQL: `report_content_type_check` CHECK(`content_type IN ('chat_message','poll','expense','settlement_request')`, REQ-RPT-004) + `block`/`report` RLS enable + 정책 없음(default deny, REQ-CPL-004). 트리거 없음. 순수 additive(기존 테이블 무변경). SPEC-SAFETY-001 M1 |
| `20260702200000_add_withdrawn_account` | 2026-07-02 | `moim_member.withdrawn_at TIMESTAMP(3)` nullable 컬럼 additive 추가(기존 row 모두 NULL, 복합 PK/FK/인덱스 불변). `withdrawn_account`(sub TEXT PK, withdrawn_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP) 신규 테이블 CREATE(sub PK-only, FK 없음 soft tombstone). 수동 SQL: `withdrawn_account` RLS enable + 정책 없음(default deny — PostgREST 직독 차단, notification/block/report 선례). 순수 additive(고아 행 없음). SPEC-ACCOUNT-001 T-01 |

> **SPEC-MOIM-010 마이그레이션 없음** — 장소 투표(`Poll.kind="place"`) 기능은 신규 마이그레이션을 추가하지 않는다. `Poll.kind`는 MOIM-008이 추가한 `TEXT NOT NULL DEFAULT 'general'` string 컬럼이고 `"place"`는 허용 VALUE 확장일 뿐(DDL 불필요). `Moim.location`(MOIM-004)과 `PollOption.optionDate`(MOIM-008)도 이미 존재한다. 따라서 MOIM-010 구현 후에도 `prisma migrate status`는 변경 없이 clean이고 마이그레이션 총수는 13개 그대로다. MOIM-008이 enum을 피하고 string `@default` 컬럼을 택한 결정이 이 무비용 확장을 만들었다.

> **Applied 표 드리프트 주의**: 마이그레이션 파일 시스템(`apps/backend/prisma/migrations/`)에는 위 Applied 표에 미기재된 마이그레이션이 7개 더 존재한다(`add_moim_max_members_and_member_realtime`, `add_expense`, `add_expense_realtime_broadcast`, `add_schedule`, `add_schedule_realtime_broadcast` 등). 이 항목들의 Applied 표 백필은 별도 sync 작업으로 남긴다.

### SPEC-CHAT-001 수동 SQL 주의 (R-6 드리프트)

`20260613175232_add_chat/migration.sql`은 Prisma 스키마로 표현 불가한 수동 SQL을 포함한다(트리거/RLS/CHECK). `prisma migrate diff`에 잡히지 않으므로 스키마 변경 시 수동으로 동기화한다:

- **content CHECK**: `chat_message_content_length` — `char_length(content) BETWEEN 1 AND 2000`. DTO 400 검증과 이중 강제(최종 방어선).
- **chat_message RLS**: `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny. Prisma는 postgres 롤로 직접 연결되어 영향 없음(쓰기 인가 = NestJS 서비스 레이어). 용도: anon/authenticated PostgREST 직접 접근 차단.
- **broadcast_chat_message()**: `SECURITY DEFINER`, `realtime.broadcast_changes('moim:'||moim_id, 'INSERT','INSERT','chat_message','public', NEW, NULL)` 7-arg 호출. private 토픽으로 메시지 레코드만 전파(nickname 미포함 — thin trigger).
- **chat_message_broadcast**: `AFTER INSERT FOR EACH ROW` 트리거.
- **realtime.messages SELECT 정책**: `moim_member` 조회로 구독 인가(토픽 `moim:`||moim_id 일치 + `auth.uid()` 멤버). 비멤버 구독 거부(AC-4).
- **shadow DB 가드**: `realtime`/`auth` 스키마는 Supabase 스택 DB에만 존재하고 Prisma shadow DB(vanilla Postgres)에는 없다. `realtime.messages` 정책은 `to_regnamespace('realtime')` 가드 DO 블록으로 감싸 shadow 검증을 통과시킨다(실 DB에서만 생성).

검증(psql 존재 단언): `broadcast_chat_message` 함수, `chat_message_broadcast` 트리거, `realtime.messages` SELECT 정책, `chat_message.relrowsecurity=true`, `chat_message_content_length` CHECK 모두 존재 확인(2026-06-14).

---

## Pending Migrations

현재 미적용(로컬 적용 완료, prod 미배포 — prod 배포 파이프라인은 SPEC-ENV-SETUP-001 follow-up).

| Filename | Created At | Description | Blocking? |
|----------|-----------|-------------|-----------|
| `20260613155202_add_moim` | 2026-06-13 | prod DB에 모임 테이블 추가 필요 | Yes (prod 배포 시) |
| `20260613171209_add_moim_invite` | 2026-06-13 | prod DB에 초대 테이블 추가 필요 | Yes (prod 배포 시) |
| `20260613175232_add_chat` | 2026-06-14 | prod DB에 채팅 테이블 + 트리거/RLS 추가 필요 (prod realtime/auth 스키마 존재 전제) | Yes (prod 배포 시) |
| `20260614_add_device_token` | 2026-06-14 | prod DB에 device_token 테이블 추가 필요 | Yes (prod 배포 시) |
| `20260615000000_add_profile_name` | 2026-06-15 | prod DB에 profile.name(nullable) 컬럼 추가 필요 | Yes (prod 배포 시) |
| `20260619000000_add_moim_event_fields` | 2026-06-19 | prod DB에 moim.starts_at(nullable) + moim.location(nullable) 컬럼 추가 필요 | Yes (prod 배포 시) |
| `20260619100000_add_poll` | 2026-06-19 | prod DB에 poll/poll_option/poll_vote 테이블 추가 필요 | Yes (prod 배포 시) |
| `add_poll_multi_select` | 2026-06-20 | prod DB에 poll.multi_select 컬럼 추가 + poll_vote PK 변경 필요 | Yes (prod 배포 시) |
| `20260620200000_add_poll_closes_at` | 2026-06-20 | prod DB에 poll.closes_at(nullable) 컬럼 추가 필요 | Yes (prod 배포 시) |
| `20260621000000_add_poll_kind_option_date` | 2026-06-21 | prod DB에 poll.kind(TEXT NOT NULL DEFAULT 'general') + poll_option.option_date(nullable) 컬럼 추가 필요 | Yes (prod 배포 시) |
| `20260622000000_add_poll_realtime_broadcast` | 2026-06-22 | prod DB에 broadcast_poll_change 함수 + poll_broadcast/poll_vote_broadcast 트리거 추가 필요(prod realtime 스키마 존재 전제) | Yes (prod 배포 시) |

---

## Rollback Notes

| Migration | Risk Level | Rollback Steps | Data Loss? |
|-----------|-----------|----------------|------------|
| `20260702000000_add_notification_realtime_broadcast` | Low | `DROP TRIGGER IF EXISTS notification_broadcast ON "notification"; DROP FUNCTION IF EXISTS broadcast_notification_new(); DROP POLICY IF EXISTS "users can receive own notifications" ON realtime.messages;` | 트리거·함수·RLS 정책 제거만 — 테이블/행 데이터 손실 없음. 롤백 후 notification INSERT가 더 이상 user: 채널로 방송되지 않으나 notification row 자체에는 영향 없음(배지 실시간 소실, 영속 알림 보존). prod 적용 완료 — prod 롤백 필요 시 위 SQL을 prod DB에 직접 실행 |
| `20260701210000_add_settlement_request` | Low | `DROP TABLE settlement_request;` | settlement_request 데이터 손실. prod 적용 완료 — prod 롤백 시 서비스 영향(정산 요청 기능 불능, settlement.requested 알림 발송 불가) |
| `20260701200000_add_notification` | Low | `ALTER TABLE notification DISABLE ROW LEVEL SECURITY; DROP TABLE notification;` | notification 데이터 손실. prod 적용 완료 — prod 롤백 시 서비스 영향(인앱 알림 전체 소실). M4a 트리거도 함께 무효화됨 |
| `20260622000000_add_poll_realtime_broadcast` | Low | `DROP TRIGGER IF EXISTS poll_broadcast ON "poll"; DROP TRIGGER IF EXISTS poll_vote_broadcast ON "poll_vote"; DROP FUNCTION IF EXISTS broadcast_poll_change();` | 트리거·함수 제거만 — 테이블/행 데이터 손실 없음. 롤백 후 투표 변경이 더 이상 broadcast되지 않으나 poll/poll_vote row 자체에는 영향 없음 |
| `20260621000000_add_poll_kind_option_date` | Low | `ALTER TABLE poll DROP COLUMN kind; ALTER TABLE poll_option DROP COLUMN option_date;` | kind 데이터 손실(현재 로컬 개발 데이터만 해당, @default='general'이라 실질적 데이터 없음). option_date 데이터 손실(날짜 투표 옵션 시각 — 현재 로컬 개발 데이터만 해당). poll/option/vote row 자체에는 영향 없음 |
| `20260620200000_add_poll_closes_at` | Low | `ALTER TABLE poll DROP COLUMN closes_at;` | closes_at 데이터 손실(현재 로컬 개발 데이터만 해당). poll/option/vote row에는 영향 없음 |
| `add_poll_multi_select` | Low | `ALTER TABLE poll DROP COLUMN multi_select; ALTER TABLE poll_vote DROP CONSTRAINT poll_vote_pkey; ALTER TABLE poll_vote ADD PRIMARY KEY (poll_id, user_id);` | 다중 선택 표 손실 가능(단일 선택 표는 (pollId,userId) 유일이므로 PK 복구 시 row 손실 없음 — 단, 다중 선택으로 추가된 표는 (pollId,userId) 기준으로 충돌 가능성 있음) |
| `20260619100000_add_poll` | Low | `DROP TABLE poll_vote; DROP TABLE poll_option; DROP TABLE poll;` | poll/poll_option/poll_vote 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260619000000_add_moim_event_fields` | Low | `ALTER TABLE moim DROP COLUMN starts_at; ALTER TABLE moim DROP COLUMN location;` | starts_at/location 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260615000000_add_profile_name` | Low | `ALTER TABLE profile DROP COLUMN name;` | name 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260614_add_device_token` | Low | `DROP TABLE device_token;` | device_token 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260613175232_add_chat` | Low | `DROP TRIGGER chat_message_broadcast ON chat_message; DROP FUNCTION broadcast_chat_message(); DROP POLICY "members can receive moim broadcasts" ON realtime.messages; DROP TABLE chat_message;` | chat_message 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260613171209_add_moim_invite` | Low | `DROP TABLE moim_invite;` | moim_invite 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260613155202_add_moim` | Low | `DROP TABLE moim_member; DROP TABLE moim;` | moim/moim_member 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260602095934_init_profile` | Low | `DROP TABLE profile;` | profile 데이터 손실 |
