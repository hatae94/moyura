---
id: SPEC-ENV-SETUP-001
version: 0.3.0
status: completed
created: 2026-05-31
updated: 2026-06-02
author: hatae
---

# Implementation Plan — SPEC-ENV-SETUP-001

`/moai run SPEC-ENV-SETUP-001`이 실행 가능한 단계별 작업 분해. 시간 추정 없음 — 우선순위/순서로만 표기.

## Technical Approach (기술 접근)

- 백엔드는 `@nestjs/config` + Zod로 부팅 시 env를 검증(fail-fast)하고, Prisma는 듀얼 URL(pooled 런타임 / direct 마이그레이션) 패턴으로 Supabase에 연결한다.
- 로컬은 Supabase CLI Docker 스택(Postgres + GoTrue + Studio)으로 prod와 패리티를 맞춘다.
- API 계약은 NestJS `@nestjs/swagger`로 OpenAPI를 emit하고, Nx 타겟으로 `packages/api-client`에 타입드 클라이언트를 생성한다(권장: `openapi-typescript`).
- 모든 인프라 스크립트는 `project.json` Nx 타겟으로 등록해 affected/캐시가 적용되게 한다.
- Auth는 seam만: no-op Guard 배선점 + Supabase env optional placeholder. 검증 로직 없음.

## Milestones (우선순위 순서)

### M1 — Backend Config + Zod 검증 골격 (Priority: High, 먼저)
- `@nestjs/config` + `zod` 의존성 추가.
- env Zod 스키마 작성: `DATABASE_URL`, `DIRECT_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`(필수) + `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET`(optional placeholder).
- 부팅 시 검증 실패하면 fail-fast(non-zero exit).
- `main.ts`를 검증된 `PORT` 사용으로 변경(하드코딩 3000 제거).
- `apps/backend/.env.example` 커밋.
- 충족: R-B1, R-B2, R-B6, R-H2, R-E(부분: 변수 정의), 환경변수 매트릭스.

### M2 — Prisma + Supabase 연결 (Priority: High)
- **[게이트] 첫 작업 = D1 스파이크**: Prisma 7(권장하나 미확정) + `moduleFormat = "cjs"`로 `prisma generate` → `nest build` 동작을 검증한다. 실패하면 즉시 Prisma 6.x(선택지 B)로 폴백하고, 선택 결과(성공/폴백)를 spec.md HISTORY에 한 줄로 기록한다(AC-A3b). D1은 이 스파이크 전에는 settled로 취급하지 않는다.
- `schema.prisma`(또는 Prisma 7 `prisma.config.ts`): 런타임 `url` = pooled `DATABASE_URL`, 마이그레이션 `directUrl`/config = `DIRECT_URL`.
- prod pooled 연결 `?pgbouncer=true` + prepared statements 비활성(6543 = Supavisor transaction-mode). 로컬이 direct(5432)면 prepared-statement 비활성은 N/A.
- 도메인 모델 없이 `SELECT 1` 연결 프로브만.
- 충족: R-B3, R-B4, R-B5, R-B7, R-A3.

### M3 — Supabase CLI 로컬 스택 (Priority: High)
- **[게이트] 첫 작업 = 포트 검증 스파이크**: `supabase start` 후 로컬 스택이 6543 Supavisor pooler를 노출하는지 확인한다. pooler가 없으면(흔한 경우) 로컬 `DATABASE_URL`을 direct(5432)로 설정하고 prepared-statement 비활성은 로컬에서 생략(N/A). prod와의 연결 모드 차이는 K8로 관리.
- `supabase init` → `supabase/config.toml` 커밋.
- `supabase start`/`stop` 워크플로 문서화.
- local `DATABASE_URL`/`DIRECT_URL`을 로컬 Supabase Postgres로 연결(포트 검증 결과 반영).
- 충족: R-C1, R-C2, R-C3, R-C4.

### M4 — Health 엔드포인트 (Priority: High)
- `GET /health` 컨트롤러: overall status + DB 연결(`SELECT 1`) 결과 JSON.
- DB up → `ok`/`db: up`. DB down → 503/`db: down`.
- Render health check path로 사용.
- 충족: R-G1, R-G2, R-G3, R-G4.

### M5 — CORS (Priority: Medium)
- 검증된 `CORS_ORIGINS`로 환경별 allowlist 적용(web + mobile origin). 와일드카드 금지.
- 충족: R-F1, R-F2, R-F3.

### M6 — OpenAPI + 클라이언트 생성 (Priority: Medium)
- `@nestjs/swagger`로 OpenAPI 노출 + `DocumentBuilder` 셋업.
- Nx 타겟 `backend:openapi`(서버 미기동으로 `apps/backend/openapi.json` emit).
- Nx 타겟 `api-client:generate`(spec → `packages/api-client` 타입드 클라이언트, 권장 `openapi-typescript` + 얇은 fetch 래퍼). `openapi` → `generate` 의존성 명시.
- `packages/api-client`를 `@moyura/api-client` 워크스페이스 패키지로.
- 충족: R-D1~R-D4, R-A1, R-A2, R-A4.

### M7 — 프론트 env 주입 (web + mobile) (Priority: Medium)
- web: `NEXT_PUBLIC_API_BASE_URL` env 파일 + 부팅 경로에 explicit in-app assertion(미설정 시 throw). `.env.example` 커밋. (build-time 인라인이라 자동 실패하지 않으므로 명시 가드 필수)
- mobile: `EXPO_PUBLIC_API_BASE_URL` app config/env + 부팅 경로에 explicit in-app assertion(미설정 시 throw). `.env.example` 커밋.
- (선택) web/mobile에서 `@moyura/api-client`로 local `/health` 호출하여 local end-to-end 배선 증명.
- 충족: R-E1, R-E2, R-E4, R-G4(local proof).

### M8 — Auth Seam (Priority: Low)
- no-op/pass-through NestJS Guard 배선점만(미래 JWT guard 드롭인 가능 구조).
- 검증/로그인/유저 테이블 없음.
- 충족: R-H1, R-H3.

### M9 — CI / EAS 스켈레톤 (Priority: Low, 마지막)
- GitHub Actions: install → `nx affected -t build lint test typecheck`. 마이그레이션/배포 잡 없음.
- `eas.json` `local`/`prod` 프로파일 골격(자격증명 미배선).
- Render Web Service 설정 문서: build `pnpm nx build backend`, start = `dist` 엔트리, health check `/health`, env=대시보드 secrets.
- 충족: R-I1, R-I2, R-I3, 결정 4·8·12.

## Technical Approach Notes (의존성/순서)
- M1 → M2 → M4가 백엔드 코어 경로(config → DB → health). M3는 M2의 local 연결 대상 제공이므로 M2와 병행/직후.
- M6(openapi)는 M4(health 엔드포인트)가 존재해야 의미 있는 spec을 emit.
- M7은 M6의 `@moyura/api-client` 산출에 의존(선택적 end-to-end 호출).
- M8·M9는 코어 동작에 비의존이라 마지막.

## Risks (spec.md Risks 섹션 요약 참조)
- K3(pnpm hoisted + prisma generate), K4(pooled prepared-statement)가 가장 높은 기술 리스크 — M2 첫 작업(D1 스파이크)에서 조기 검증.
- K8(로컬 스택 6543 pooler 미노출 → local/prod 모드 불일치) — M3 첫 작업(포트 검증 스파이크)에서 확인, 로컬 direct 모드 허용으로 흡수.

## Named Follow-up (이 SPEC 범위 밖)
- 풀 배포 파이프라인: prod push 시 자동 `prisma migrate deploy` + Render 자동 배포. 별도 SPEC으로 분리.
