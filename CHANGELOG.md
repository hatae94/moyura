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
- **Supabase 인증(authn)** (SPEC-AUTH-001): 웹 레이어가 세션을 소유하고 백엔드가 ES256 JWKS로 JWT를 검증하는 단일 인증 surface. email/pw 종단 동작 + 소셜/모바일 스캐폴드. evaluator-active PASS(security 0.97).
  - **백엔드 JWKS 검증 가드**: `SupabaseAuthGuard`(jose `createRemoteJWKSet` + `jwtVerify`, ES256 algorithms 고정, `alg:none`/alg-confusion 거부, `iss`/`aud`/`exp`/`nbf` normative, JWKS 실패 시 fail-closed, HS256-only 레거시 폴백). 보호 라우트(`/me`)에 per-route `@UseGuards` — `/health`·`GET /`는 public 유지.
  - **profile 모델 + UPSERT**: 첫 Prisma 도메인 모델 `Profile`(`id = sub` PK, `createdAt`), 마이그레이션 `20260602095934_init_profile`. `ProfileService.upsertBySub`(검증된 sub만, mass-assignment 차단).
  - **보호 라우트 `GET /me`**: 인증 사용자의 profile 반환 — 가드 + upsert 종단 증명.
  - **웹 세션(`@supabase/ssr` 0.10.3)**: browser/server 클라이언트, `proxy.ts` updateSession(Next 16 미들웨어), email/pw signup/login/logout, PKCE 콜백 라우트(`app/auth/callback`, 음성 경로 가드), `app/login`·`app/me`.
  - **소셜/모바일 OAuth 스캐폴드**: `supabase/config.toml` `[auth.external.google|apple|kakao]`(enabled=false, `env()` 시크릿), `apps/mobile` app scheme `"moyura"` + 시스템 브라우저 OAuth 헬퍼, deep-link redirect(`moyura://auth-callback`). 실제 provider 키·런타임 OAuth는 named follow-up.

### Changed

- **`apps/backend/main.ts`**: 하드코딩된 포트 `3000` 대신 validated config(`PORT`)에서 listen 포트를 읽도록 변경.
- **`packages/api-client`** (`@moyura/api-client`): 계획 단계에서 실제 워크스페이스 패키지로 생성되어 web/mobile이 소비. SPEC-AUTH-001에서 optional `getToken`→`Authorization: Bearer` 주입(토큰 URL/query 금지)과 `getMe()` 편의 메서드 추가.

[Unreleased]: https://github.com/hatae94/moyura/compare/HEAD
