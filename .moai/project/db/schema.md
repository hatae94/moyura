---
engine: PostgreSQL 17.x (Supabase 관리형)
orm: Prisma 7.8.0
last_synced_at: 2026-06-13
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

---

## Relationships

| From | To | Cardinality | FK Column | Notes |
|------|----|-------------|-----------|-------|
| `moim_member` | `moim` | N:1 | `moim_member.moim_id` | onDelete Cascade — 모임 삭제 시 멤버십 자동 정리 |

> `profile.id`와 `moim.created_by` / `moim_member.user_id`는 모두 Supabase `sub`로 논리적으로 연결되나, 현재 schema에 외래 키 제약은 없다(auth.users는 Supabase 내부 스키마 — app-owned profile 패턴).

---

## Indexes

| Table | Columns | Type | Purpose |
|-------|---------|------|---------|
| `profile` | `id` | PK (기본) | 단일 PK 조회 |
| `moim` | `id` | PK (기본) | 단일 PK 조회 |
| `moim_member` | `(moim_id, user_id)` | PK 복합 (기본) | 멤버십 유일성 보장 — 한 사용자는 한 모임에 한 번만 |

---

## Constraints

| Table | Constraint | Type | Definition |
|-------|-----------|------|-----------|
| `profile` | `profile_pkey` | PK | `id` |
| `moim` | `moim_pkey` | PK | `id` |
| `moim_member` | `moim_member_pkey` | PK | `(moim_id, user_id)` |
| `moim_member` | `moim_member_moim_id_fkey` | FK | `moim_id → moim(id) ON DELETE CASCADE` |
