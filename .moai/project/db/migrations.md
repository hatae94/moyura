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

---

## Rollback Notes

| Migration | Risk Level | Rollback Steps | Data Loss? |
|-----------|-----------|----------------|------------|
| `20260619100000_add_poll` | Low | `DROP TABLE poll_vote; DROP TABLE poll_option; DROP TABLE poll;` | poll/poll_option/poll_vote 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260619000000_add_moim_event_fields` | Low | `ALTER TABLE moim DROP COLUMN starts_at; ALTER TABLE moim DROP COLUMN location;` | starts_at/location 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260615000000_add_profile_name` | Low | `ALTER TABLE profile DROP COLUMN name;` | name 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260614_add_device_token` | Low | `DROP TABLE device_token;` | device_token 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260613175232_add_chat` | Low | `DROP TRIGGER chat_message_broadcast ON chat_message; DROP FUNCTION broadcast_chat_message(); DROP POLICY "members can receive moim broadcasts" ON realtime.messages; DROP TABLE chat_message;` | chat_message 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260613171209_add_moim_invite` | Low | `DROP TABLE moim_invite;` | moim_invite 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260613155202_add_moim` | Low | `DROP TABLE moim_member; DROP TABLE moim;` | moim/moim_member 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260602095934_init_profile` | Low | `DROP TABLE profile;` | profile 데이터 손실 |
