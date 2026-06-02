# Sync Report — SPEC-ENV-SETUP-001

- 일자: 2026-06-02
- 전략: main_direct (PR 없음)
- 대상 SPEC: SPEC-ENV-SETUP-001 (환경/인프라 셋업)
- 상태 전이: `draft` (v0.2.0) → `completed` (v0.3.0)

## 갱신/생성된 파일

| 파일 | 변경 |
|------|------|
| `.moai/specs/SPEC-ENV-SETUP-001/spec.md` | frontmatter `status: completed`, `version: 0.3.0`, `updated: 2026-06-02`; HISTORY v0.3.0 라인 추가; "## Implementation Notes" 섹션 추가(실제 구현 + 차이 + AC 충족/연기) |
| `.moai/specs/SPEC-ENV-SETUP-001/acceptance.md` | frontmatter `status: completed`, `version: 0.3.0`, `updated: 2026-06-02` |
| `.moai/specs/SPEC-ENV-SETUP-001/plan.md` | frontmatter `status: completed`, `version: 0.3.0`, `updated: 2026-06-02` |
| `.moai/project/tech.md` | 데이터/백엔드 스택을 PLANNED → IMPLEMENTED로 이동(실제 버전 반영); follow-up(prod 배포/인증) 노트; 설정 파일 표 갱신 |
| `.moai/project/structure.md` | 디렉터리 트리 확장(`supabase/`, `.github/workflows/`, `docs/`, backend `src/{config,health,auth,prisma,generated}`, web/mobile `lib/`); `@moyura/api-client` 구현됨으로 갱신; Nx 타겟 표 + 의존 방향 갱신 |
| `CHANGELOG.md` (신규) | Keep a Changelog 형식, `[Unreleased]`에 SPEC-ENV-SETUP-001 Added/Changed 엔트리 |
| `.moai/reports/sync-SPEC-ENV-SETUP-001.md` (신규) | 본 보고서 |

## 구현 사실 검증 (디스크 대조)

문서에 기록한 모든 사실은 실제 저장소 상태로 검증함:
- 의존성 버전: `prisma 7.8.0`, `@prisma/adapter-pg 7.8.0`, `@prisma/client 7.8.0`, `pg 8.21.0`, `zod 4.4.3`, `@nestjs/config 4.0.4`, `@nestjs/swagger 11.4.4`, `openapi-typescript 7.13.0`, `supabase 2.104.0` (package.json 확인).
- 디렉터리: `apps/backend/src/{config,health,auth,prisma,generated}`, `apps/{web,mobile}/lib`, `supabase/`, `.github/workflows/ci.yml`, `docs/deploy-render.md`, `packages/api-client/` 존재 확인.
- gitignore: `apps/backend/src/generated/`, `packages/api-client/src/schema.d.ts` 추적 제외 확인. `openapi.json`은 커밋 대상.
- 로컬 Supabase 포트: `config.toml` db `port = 54322` 확인.
- Nx 타겟: `backend:{prisma-generate, prisma-migrate, openapi, typecheck}`, `api-client:generate` 체인(dependsOn) 확인.

## 차이 요약 (plan vs actual)

- **plan을 넘어 추가**(Prisma 7 강제, 스코프 크리프 아님): `@prisma/adapter-pg` + `pg`(mandatory driver adapter), `prisma.config.ts`(Prisma 7 URL 위치), `openapi.json` 커밋. → 문서에 설계 결정으로 기록됨.
- **의도적 연기**(gap이 아님): prod e2e 증명(R-G4 prod), 풀 배포 파이프라인(자동 migrate+deploy), 인증 실제 구현(seam만). → 모두 named follow-up/Non-Goal로 spec.md·tech.md에 명시됨.

## 확인 사항

- 소스 코드 미수정 — 문서(`.moai/`, `CHANGELOG.md`)만 갱신.
- 커밋 미수행 — 오케스트레이터가 커밋.
- prod/auth 연기는 gap이 아닌 설계 결정으로 문서화됨.
- product.md 미수정(제품 비전 TBD 유지).
