# Sync Report — SPEC-MOIM-002 (초대 링크 + 게스트 참여)

**Date**: 2026-06-13
**Branch**: feature/SPEC-MOBILE-004
**Commit (run)**: acc6fe8
**Synced by**: manager-docs

---

## 상태 전이

| 항목 | 이전 | 이후 |
|------|------|------|
| spec.md status | `draft` | `completed` |
| spec.md version | `0.1.1` | `0.2.0` |
| spec.md updated | `2026-06-11` | `2026-06-13` |

---

## 동기화된 파일

| 파일 | 변경 내용 |
|------|-----------|
| `.moai/specs/SPEC-MOIM-002/spec.md` | frontmatter status/version/updated 갱신, HISTORY v0.2.0 항목 추가, "Implementation Notes (as-implemented)" 섹션 신규 추가(생성 파일, 수정 파일, X-1~X-4 수정 사항, 사후 수정, 크로스 SPEC 참고, 남용 완화, evaluator INFO) |
| `.moai/specs/SPEC-MOIM-002/acceptance.md` | 변경 없음 — `api-client:build` 오류 참조 없음(이미 올바름) |
| `CHANGELOG.md` | [Unreleased] > Added 최상단에 MOIM-002 항목 추가(MOIM-001 위) |
| `.moai/project/structure.md` | `apps/backend/src/invite/` 모듈 항목 추가, prisma/ migrations 목록에 `20260613171209_add_moim_invite` 추가, `apps/web/lib/` invite/accept.ts 추가, `apps/web/app/` invite/[token]/ 랜딩 페이지 추가 |
| `.moai/project/tech.md` | 도입부 MOIM-002 완료 선언 추가, 구현됨/계획됨 표 최상단에 MOIM-002 행 추가, 주요 설정 파일 표에 invite/ + web invite pages + supabase anon 항목 추가 |
| `.moai/project/db/schema.md` | Tables 표에 `moim_invite` 추가, moim_invite 컬럼 상세 문서화, Relationships에 moim→moim_invite Cascade 관계 추가, Indexes에 moim_invite PK + moimId INDEX 추가, Constraints에 moim_invite PK + FK 추가 |
| `.moai/project/db/erd.mmd` | `MOIM_INVITE` 엔티티 추가, `MOIM ||--o{ MOIM_INVITE` Cascade 관계 추가, last_synced_at 주석 갱신 |
| `.moai/project/db/migrations.md` | Applied Migrations에 `20260613171209_add_moim_invite` 추가, Pending Migrations에 prod 배포 필요 항목 추가, Rollback Notes에 moim_invite 롤백 절차 추가 |

---

## 검증 결과 (run 단계에서 확인됨)

| 항목 | 결과 |
|------|------|
| jest | 148/148 PASS |
| invite 모듈 stmt 커버리지 | 100% |
| invite 모듈 branch 커버리지 | 85.29% (임계값 85% 충족) |
| backend:typecheck | 0 에러 |
| api-client:generate + typecheck | PASS |
| nx build web | PASS (invite/[token] 경로 등록 확인) |
| nx run api-client:typecheck | PASS |
| prisma migrate status | 드리프트 없음 (3 migrations, up to date) |
| supabase enable_anonymous_sign_ins | true (로컬 적용 확인) |

---

## TRUST 5

| 차원 | 결과 |
|------|------|
| Tested | PASS — jest 148/148, branch 85.29% |
| Readable | PASS — NestJS 표준 예외 계층(GoneException/ConflictException) 사용 |
| Unified | PASS — MOIM-001 패턴 준수 |
| Secured | PASS — CSPRNG 토큰 / owner 전용 인가 / usedCount TOCTOU 경쟁 안전 / mass-assignment 없음 |
| Trackable | PASS — Conventional Commits, acc6fe8 |

---

## DB 수동 갱신 (manual refresh)

- `moim_invite` 테이블 schema.md / erd.mmd / migrations.md 수동 갱신 완료.
- db.yaml auto-sync는 `enabled: false` 유지.
- 다음 SPEC sync 시도 시 동일 방식으로 수동 갱신 필요.
