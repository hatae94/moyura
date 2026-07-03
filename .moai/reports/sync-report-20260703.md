# Sync Report — 2026-07-03

## 1. 범위

SPEC 2건 동기화:

| SPEC | 제목 | 커밋 |
|------|------|------|
| SPEC-SAFETY-001 | 신고·차단 (safety 모듈) | `150ea8e` |
| SPEC-ACCOUNT-001 | 회원 탈퇴 (account 모듈) | `88432e7` |

브랜치: `feature/SPEC-ACCOUNT-001`

---

## 2. SPEC 상태 전환

| SPEC | 이전 상태 | 이후 상태 | 비고 |
|------|----------|----------|------|
| SPEC-SAFETY-001 | draft | completed | 전 AC 자동 게이트 PASS. 신고·차단 REST API + DB 테이블 + RLS 구현 완료 |
| SPEC-ACCOUNT-001 | draft | in-progress | AC-4-2(iOS 시뮬레이터 탈퇴 플로우 검증) device-gated — 자동 게이트(tsc/lint/jest)는 PASS |

---

## 3. 갱신된 파일

### DB 문서 (`.moai/project/db/`)

| 파일 | 변경 내용 |
|------|----------|
| `erd.mmd` | BLOCK·REPORT·WITHDRAWN_ACCOUNT 엔티티 추가. MOIM_MEMBER에 `withdrawn_at` 컬럼 추가. MOIM→REPORT Cascade 관계 추가. 최종 갱신 날짜 2026-07-03으로 업데이트 |
| `migrations.md` | `20260702100000_add_safety` 항목 추가(block/report 2 테이블, 인덱스 6개, CHECK·RLS 수동 SQL). `20260702200000_add_withdrawn_account` 항목 추가(moim_member.withdrawn_at additive, withdrawn_account 툼스톤, RLS default-deny) |
| `schema.md` | 구현자가 이미 갱신 완료 — block/report/withdrawn_account 섹션 정확히 반영됨. 수정 없음(일관성 검증 PASS) |
| `rls-policies.md` | 구현자가 이미 갱신 완료 — block·report default-deny RLS 정책 행 정확히 반영됨. 수정 없음(일관성 검증 PASS) |

### 프로젝트 문서 (`.moai/project/`)

| 파일 | 변경 내용 |
|------|----------|
| `tech.md` | "구현됨 vs 계획됨" 표 상단에 SPEC-ACCOUNT-001(구현 완료·AC-4-2 잔여) + SPEC-SAFETY-001(구현 완료) 행 추가. `SUPABASE_SERVICE_ROLE_KEY` env var를 config 검증 항목에 추가(탈퇴 API 필수, 부재 시 fail-closed 500) |
| `structure.md` | `apps/backend/src/` 트리에 `safety/` + `account/` 모듈 디렉터리 한 줄씩 추가 |
| `product.md` | MVP 범위 구현 기능 나열 문장에 "신고/차단·회원 탈퇴(스토어 정책 대응)" 추가 |

---

## 4. 품질 게이트 증거

| 게이트 | 결과 |
|--------|------|
| `tsc` | 0 errors |
| `nx lint` (backend) | clean |
| `jest` | 635/635 PASS |
| evaluator-active | PASS ×2 (SPEC-SAFETY-001, SPEC-ACCOUNT-001 각각) |
| TRUST 5 | PASS ×2 |

---

## 5. 배포 노트

1. **prod DB 마이그레이션 2건 적용 필요**: `20260702100000_add_safety` + `20260702200000_add_withdrawn_account`. 순수 additive(기존 테이블/컬럼/PK/트리거 무변경) — 롤백 위험도 Low. `migrate-prod.yml` 워크플로우(`prisma migrate deploy`) 실행 또는 수동 `PROD_DIRECT_URL` 경유 적용.
2. **backend prod env 추가 필요**: `SUPABASE_SERVICE_ROLE_KEY`(Supabase 프로젝트 설정 → API → service_role key). **부재 시 `DELETE /me/account` 요청이 fail-closed 500을 반환**하므로 배포 전 Render Secrets에 반드시 설정.
3. **breaking change 없음**: 신규 엔드포인트(`POST /reports`, `POST/DELETE/GET /blocks`, `DELETE /me/account`)만 추가. 기존 API 시그니처·응답 형식 무변경.
4. **GitHub Issue 연동 스킵**: issue_number 0 — 로컬 전용 git 운영(push/PR 없음).
5. **백업 위치**: `.moai/backups/sync-20260703/`

---

## 6. 잔여 항목

- SPEC-ACCOUNT-001 AC-4-2: iOS 시뮬레이터에서 탈퇴 플로우(회원 탈퇴 → 로그아웃 → 재가입 차단·툼스톤 확인) 실검증 대기. 자동 게이트는 PASS 상태이므로 배포 블로커가 아님(device-gated).
