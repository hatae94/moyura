# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 관리는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수한다.

## [Unreleased]

### Added

- **환경/인프라 배선** (SPEC-ENV-SETUP-001): mobile/web/backend 세 앱과 Supabase PostgreSQL 사이의 환경/인프라 wiring을 완성하여 "프런트엔드 → 백엔드 → DB" end-to-end 동작을 `GET /health`로 증명.
  - **Prisma 7.8.0 + Supabase 연결**: `prisma-client` 제너레이터(source-emit, `moduleFormat=cjs`), `@prisma/adapter-pg` driver adapter, `pg`. 듀얼 URL 패턴(런타임 pooled `DATABASE_URL` / 마이그레이션 `DIRECT_URL`)을 `prisma.config.ts`에 구성.
  - **로컬 Supabase CLI 스택**: `supabase/config.toml` + `README.md`. direct Postgres `:54322`(로컬은 pooler 미노출, pooler는 prod 전용).
  - **환경변수 검증**: NestJS `@nestjs/config` + Zod 4 부팅 시 fail-fast 검증(누락/불일치 시 non-zero exit).
  - **OpenAPI 타입드 클라이언트**: `@nestjs/swagger`로 `/api`에 OpenAPI 노출 + `openapi.json` emit → `@moyura/api-client`(`openapi-typescript` 타입 + 얇은 fetch 래퍼). Nx 타겟 `backend:openapi` → `api-client:generate` 체인(멱등, 캐시).
  - **헬스 엔드포인트**: `GET /health` — `SELECT 1` DB 프로브로 200(ok/up) / 503(degraded/down) 반환.
  - **CORS allowlist**: `CORS_ORIGINS`(validated config)에서 환경별 web + mobile origin 로드, 와일드카드 금지.
  - **프런트 env 가드**: web `NEXT_PUBLIC_API_BASE_URL`, mobile `EXPO_PUBLIC_API_BASE_URL`. 미설정 시 앱 부팅 경로(`lib/env.ts`)에서 명시적 throw.
  - **Auth seam**: no-op `SupabaseAuthGuard` + `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET` env 플레이스홀더(optional). 실제 인증 로직은 미구현.
  - **CI / EAS 스켈레톤**: `.github/workflows/ci.yml`(install → prisma generate → `nx affected` build/lint/test/typecheck, migrate/deploy 없음), `apps/mobile/eas.json` local/prod 프로파일, `docs/deploy-render.md` Render 배포 가이드.

### Changed

- **`apps/backend/main.ts`**: 하드코딩된 포트 `3000` 대신 validated config(`PORT`)에서 listen 포트를 읽도록 변경.
- **`packages/api-client`** (`@moyura/api-client`): 계획 단계에서 실제 워크스페이스 패키지로 생성되어 web/mobile이 소비.

[Unreleased]: https://github.com/hatae94/moyura/compare/HEAD
