---
engine: PostgreSQL 17.x (Supabase 관리형)
orm: Prisma 7.8.0
last_synced_at: 2026-06-14
manifest_hash: manual (db.yaml auto-sync 비활성 — enabled:false)
---



# Database Schema

수동 갱신 기준: `apps/backend/prisma/schema.prisma` + 마이그레이션 파일. db.yaml auto-sync는 현재 비활성(`enabled: false`)이므로 SPEC sync 시 수동으로 갱신한다.

---

## Tables

| Table | Description |
|-------|-------------|
| `profile` | 앱 소유 사용자 프로필 — Supabase auth.users와 sub(uuid) 기반 연결 |
| `moim` | 모임 엔티티 — 모임 라이프사이클 루트 (SPEC-MOIM-001) |
| `moim_member` | 멤버십 + 모임별 표시 이름(nickname) — moim_id + user_id 복합 PK (SPEC-MOIM-001) |
| `moim_invite` | 초대 링크 — token PK, moim_id FK, 만료·폐기·사용 횟수 관리 (SPEC-MOIM-002) |
| `chat_message` | 모임 채팅 메시지 — BigInt PK, moim_id FK, RLS default-deny, content CHECK(1..2000) (SPEC-CHAT-001) |
| `device_token` | FCM 디바이스 토큰 레지스트리 — token PK, userId(=profile.id), platform, upsert 중복 없음 (SPEC-CHAT-002) |

### profile

Prisma 모델명: `Profile` | 첫 도메인 마이그레이션: `20260602095934_init_profile`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | Supabase JWT `sub` (uuid 문자열) — 별도 시퀀스 없음 |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |

### moim

Prisma 모델명: `Moim` | 마이그레이션: `20260613155202_add_moim`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | PK | uuid() 자동 생성 |
| `name` | TEXT | NOT NULL | 모임 이름 (최소 컬럼, 설명/이미지는 비범위) |
| `created_by` | TEXT | NOT NULL | 생성자 sub (= profile.id) |
| `created_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 생성 시각 |

### moim_member

Prisma 모델명: `MoimMember` | 마이그레이션: `20260613155202_add_moim`

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `moim_id` | TEXT | PK(복합), FK → moim.id onDelete Cascade | 소속 모임 id |
| `user_id` | TEXT | PK(복합) | 멤버 sub (= profile.id) |
| `nickname` | TEXT | NOT NULL | 모임별 표시 이름 — profile에 name 필드 부재를 보완(채팅 sender 해석 출처) |
| `role` | TEXT | NOT NULL DEFAULT 'member' | "owner" 또는 "member". owner = 탈퇴 불가, 삭제 전용. |
| `joined_at` | TIMESTAMP(3) | NOT NULL DEFAULT now() | 가입 시각 |

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

---

## Relationships

| From | To | Cardinality | FK Column | Notes |
|------|----|-------------|-----------|-------|
| `moim_member` | `moim` | N:1 | `moim_member.moim_id` | onDelete Cascade — 모임 삭제 시 멤버십 자동 정리 |
| `moim_invite` | `moim` | N:1 | `moim_invite.moim_id` | onDelete Cascade — 모임 삭제 시 초대 자동 정리 |
| `chat_message` | `moim` | N:1 | `chat_message.moim_id` | onDelete Cascade — 모임 삭제 시 채팅 메시지 자동 정리 |

> `profile.id`와 `moim.created_by` / `moim_member.user_id` / `moim_invite.created_by` / `device_token.user_id`는 모두 Supabase `sub`로 논리적으로 연결되나, 현재 schema에 외래 키 제약은 없다(auth.users는 Supabase 내부 스키마 — app-owned profile 패턴). `device_token`은 `moim`에도 FK가 없는 독립 레지스트리다(사용자-디바이스 등록, moim과 무관).

---

## Indexes

| Table | Columns | Type | Purpose |
|-------|---------|------|---------|
| `profile` | `id` | PK (기본) | 단일 PK 조회 |
| `moim` | `id` | PK (기본) | 단일 PK 조회 |
| `moim_member` | `(moim_id, user_id)` | PK 복합 (기본) | 멤버십 유일성 보장 — 한 사용자는 한 모임에 한 번만 |
| `moim_invite` | `token` | PK (기본) | 토큰 단일 조회 |
| `moim_invite` | `moim_id` | INDEX (`@@index([moimId])`) | 모임별 초대 목록 조회 최적화 |
| `chat_message` | `id` | PK (기본) | 메시지 단일 조회 |
| `chat_message` | `(moim_id, id)` | INDEX (`@@index([moimId, id])`) | 모임별 keyset 내림차순 히스토리 쿼리 최적화 |
| `device_token` | `token` | PK (기본) | 토큰 단일 조회 |
| `device_token` | `user_id` | INDEX (`@@index([userId])`) | 사용자별 토큰 목록 조회 최적화(PushListener 수신자 토큰 일괄 조회) |

---

## Constraints

| Table | Constraint | Type | Definition |
|-------|-----------|------|-----------|
| `profile` | `profile_pkey` | PK | `id` |
| `moim` | `moim_pkey` | PK | `id` |
| `moim_member` | `moim_member_pkey` | PK | `(moim_id, user_id)` |
| `moim_member` | `moim_member_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `moim_invite` | `moim_invite_pkey` | PK | `token` |
| `moim_invite` | `moim_invite_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `chat_message` | `chat_message_pkey` | PK | `id` (BIGSERIAL) |
| `chat_message` | `chat_message_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
| `chat_message` | `chat_message_content_length` | CHECK | `char_length(content) BETWEEN 1 AND 2000` |
| `device_token` | `device_token_pkey` | PK | `token` |
