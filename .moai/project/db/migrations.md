# Migrations

수동 갱신 기준: `apps/backend/prisma/migrations/`. db.yaml auto-sync는 현재 비활성(`enabled: false`)이므로 SPEC sync 시 수동으로 갱신한다.

---

## Applied Migrations

로컬 Supabase(`:54322`) 적용 기준. 적용 시각은 `prisma migrate status` 기준(Checksum은 Prisma 내부 관리).

| Filename | Applied At | Summary |
|----------|-----------|---------|
| `20260602095934_init_profile` | 2026-06-02 | `profile` 테이블 생성 — Supabase sub PK, SPEC-AUTH-001 |
| `20260613155202_add_moim` | 2026-06-13 | `moim` + `moim_member` 테이블 생성, moim_member → moim FK onDelete Cascade, SPEC-MOIM-001 |

---

## Pending Migrations

현재 미적용(로컬 적용 완료, prod 미배포 — prod 배포 파이프라인은 SPEC-ENV-SETUP-001 follow-up).

| Filename | Created At | Description | Blocking? |
|----------|-----------|-------------|-----------|
| `20260613155202_add_moim` | 2026-06-13 | prod DB에 모임 테이블 추가 필요 | Yes (prod 배포 시) |

---

## Rollback Notes

| Migration | Risk Level | Rollback Steps | Data Loss? |
|-----------|-----------|----------------|------------|
| `20260613155202_add_moim` | Low | `DROP TABLE moim_member; DROP TABLE moim;` | moim/moim_member 데이터 손실 (현재 로컬 개발 데이터만 해당) |
| `20260602095934_init_profile` | Low | `DROP TABLE profile;` | profile 데이터 손실 |
