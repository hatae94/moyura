---
id: SPEC-ENV-SETUP-001
version: 0.2.0
status: draft
created: 2026-05-31
updated: 2026-05-31
author: hatae
priority: high
issue_number: null
---

# SPEC-ENV-SETUP-001: moyura 모노레포 환경/인프라 셋업

## HISTORY

- 2026-06-02 (D1 spike): Prisma 7 selected — prisma generate → nest build passed (Prisma 7.8.0 prisma-client generator, moduleFormat=cjs, source-emit client into apps/backend/src/generated/prisma, @prisma/adapter-pg driver adapter at runtime, URLs moved to prisma.config.ts since Prisma 7 dropped datasource url/directUrl in schema; generated client resolved under node-linker=hoisted via project-local require — R-A3 satisfied).
- 2026-05-31 (v0.2.0): audit-driven revision — plan-auditor의 5개 MAJOR finding (M-1~M-5) 적용. M-1: 프론트 env가 build/bundle 시점 정적 인라인됨을 반영하여, base URL env 미설정 시 명시적 in-app startup assertion(throw)을 요구하도록 R-E4/AC-E4 재작성. M-2: 로컬 Supabase 스택이 6543 pooler를 노출하지 않을 수 있음(direct 5432 운영 허용, 이 경우 prepared-statement 비활성은 N/A)을 env 매트릭스·R-C2에 반영, 리스크 K8 추가. M-3: 6543 = Supavisor transaction-mode pooler 명시 + transaction-mode trade-off(prepared statement·session state 불가) 명문화. M-4: 추적성 보강 — AC-A1을 A1a(R-A1)/A1b(R-A4)로 분리, R-G4의 prod e2e proof를 deployment follow-up으로 연기하고 AC-G prod는 config 확인만으로 한정, env 매트릭스 SUPABASE_* 행에 seam placeholder 주석. M-5: D1 Prisma 7을 "권장하나 미확정 — M-spike 결과에 종속"으로 톤다운 + AC-A3b 폴백 게이트 추가, Background에 apps/mobile TypeScript ~6.0.3 사실 추가.
- 2026-05-31 (v0.1.0): 최초 작성 (draft). 3라운드 사용자 인터뷰로 확정된 요구사항 기반. Prisma+Supabase 듀얼 URL 패턴, Supabase CLI 로컬 스택, NestJS OpenAPI 클라이언트 생성, Zod 환경검증, CORS, 헬스 엔드포인트, Auth seam, CI/EAS 스켈레톤 범위 확정. Prisma 7 / Postgres 17 / 포트(6543 pooled, 5432 direct) 사실은 공식 문서로 검증 (Sources 참조).

---

## Background (배경)

`moyura`는 pnpm 워크스페이스(pnpm@10.27.0) + Nx 21.6.7 기반 모노레포다. 현재 세 개의 앱이 프레임워크 스캐폴드 상태로만 존재하며(비즈니스 코드 없음), 패키지 이름은 `@moyura/*` 규칙을 따른다.

- `apps/mobile` — Expo RN 56 (react 19.2.3, react-native 0.85.3). devDependency로 TypeScript `~6.0.3`(TS 6)을 사용 — web/backend가 TS 5.x인 것과 다른 메이저 라인이므로, mobile의 타입 검사/생성 클라이언트 호환성은 구현 시 TS 6 기준으로 확인한다.
- `apps/web` — Next.js 16.2.6 (react 19.2.4, App Router, Tailwind v4)
- `apps/backend` — NestJS 11 (현재 기본 `app.controller`/`app.service`만 존재, `main.ts`는 포트 3000 하드코딩)
- `packages/config` — 공유 tsconfig base (현재 빈 패키지)

`.npmrc`는 `node-linker=hoisted`(Metro 호환), `nx.json`은 build/lint/test/typecheck에 대한 캐시 `targetDefaults`를 보유한다.

Expo 56 / Next 16은 bleeding-edge 버전이므로, 이 SPEC에서 버전 특이적 동작은 추측하지 않고 공식 문서(Sources 섹션)로 검증한 사실만 사용한다. 검증되지 않은 마이너 버전 번호는 "구현 시 검증(verify at implementation)"으로 표기한다.

## Goal (목표)

세 앱(mobile/web/backend)과 PostgreSQL(Supabase) 사이의 **환경/인프라 배선(wiring)만** 완성하여, "프론트엔드 → 백엔드 → DB"가 `local`/`prod` 두 환경에서 end-to-end로 동작함을 최소 헬스 엔드포인트로 증명한다. 미래의 Supabase Auth 도입을 위한 **seam(접합점)만** 남기고, 도메인 기능과 인증 로직은 만들지 않는다.

확정 아키텍처:

```
mobile (Expo) ─┐
               ├─ HTTP REST ─▶ NestJS (backend) ─ Prisma ─▶ PostgreSQL (Supabase)
web (Next)    ─┘                    │
                        (future) Supabase Auth JWT 검증 — 이 SPEC에서는 SEAM ONLY
```

### 확정 결정 표 (Decision Table)

| # | 영역 | 결정 |
|---|------|------|
| 1 | 환경 | `local`, `prod` 2개 |
| 2 | DB (prod) | Supabase 관리형 PostgreSQL. Supabase가 PG 버전을 고정하므로 "latest stable" = Supabase 현재 제공 버전 (현재 PG 17.x — 구현 시 마이너 검증) |
| 3 | ORM | Prisma. 듀얼 URL 패턴: `DATABASE_URL`(pooled, 6543, `?pgbouncer=true`, prepared statements 비활성) = 런타임 Client / `DIRECT_URL`(direct, 5432) = 마이그레이션 CLI. 버전은 Open Decision (D1) |
| 4 | 백엔드 prod 호스팅 | Render (Web Service). build `pnpm nx build backend`, start = 빌드된 `dist` 엔트리 실행, health check path `/health`, env는 Render 대시보드 secrets 주입 |
| 5 | 백엔드 config/검증 | `@nestjs/config` + Zod 부팅 시 검증 (누락/불일치 시 fail-fast) |
| 6 | CORS | 환경별 web + mobile origin 허용 |
| 7 | API 계약 | NestJS가 `@nestjs/swagger`로 OpenAPI 노출. `packages/api-client`에 타입드 클라이언트 생성. 생성 도구는 Open Decision (D2), 권장 = `openapi-typescript` |
| 8 | 프론트 API base URL | web=`NEXT_PUBLIC_API_BASE_URL`(Next env 파일), mobile=`EXPO_PUBLIC_API_BASE_URL`(Expo app config/env), EAS 프로파일(`local`/`prod`)은 스켈레톤만 |
| 9 | 로컬 스택 | Supabase CLI 로컬 개발 스택 (Docker 기반: Postgres + Auth/GoTrue + Studio). `supabase/config.toml` + `supabase start/stop` |
| 10 | Auth | 구현은 OUT OF SCOPE. 미래 방향 = Supabase Auth. 이 SPEC은 NestJS Guard seam + Supabase env 플레이스홀더만 남김 |
| 11 | 범위 경계 | 환경/인프라 배선 ONLY (아래 Non-Goals 참조) |
| 12 | 자동화 | configuration-first. CI(GitHub Actions) + EAS 프로파일은 스켈레톤. 풀 배포 파이프라인은 named follow-up |

## Non-Goals (범위 밖 — 결정 11)

IN SCOPE (이 SPEC에서 구축):
- Prisma + Supabase 연결 (local + prod)
- 환경변수 관리 + Zod 검증
- OpenAPI 클라이언트 생성 + 공유 (`packages/api-client`)
- CORS (환경별 origin)
- 최소 헬스/핑 엔드포인트 `GET /health` (status + DB 연결 확인) — end-to-end 배선 증명용
- 위 작업을 위한 Nx 스크립트
- env 파일용 `.gitignore`
- Supabase CLI 로컬 스택

OUT OF SCOPE (이 SPEC에서 만들지 않음):
- 도메인 기능 (실제 비즈니스 로직)
- 인증 로직 (로그인, 토큰 발급/검증 구현)
- 실제 데이터 모델 (헬스체크에 필요한 최소 항목 외 user 테이블 등)
- config를 넘어선 프로덕션 하드닝 (레이트리밋, WAF, APM 등)
- 풀 배포 파이프라인 (자동 Prisma migrate + deploy)
- 투기적 추상화(speculative abstraction) — 단순성 강제 (TRUST 5 Readable)

## Exclusions (What NOT to Build)

- 사용자 로그인/회원가입 UI 및 백엔드 인증 로직 — seam(빈 Guard + env 플레이스홀더)만 남긴다.
- Supabase JWT 실제 검증 구현 — `SUPABASE_JWT_SECRET` 환경변수 자리만 정의하고 검증 코드는 작성하지 않는다.
- 도메인 엔티티/Prisma 모델 (헬스체크용 `SELECT 1` 외 모델 정의 금지).
- GitHub Actions 풀 배포 잡(자동 마이그레이션/배포) — install/build/lint/test/typecheck 검증 워크플로 스켈레톤만.
- EAS 빌드/제출 실제 실행 — `eas.json`의 `local`/`prod` 프로파일 골격만.
- 캐싱/큐/로드밸런싱/관측성(observability) 등 인프라 확장.

---

## Requirements (EARS 형식)

각 요구사항은 영역별로 그룹화한다. EARS 키워드(The system shall / When / While / Where / If-then)는 영어로 유지한다. `system` = moyura 모노레포 인프라 전체를 가리킨다.

### A. Monorepo Wiring (모노레포 배선)

- **R-A1 (Ubiquitous)**: The system shall expose every infrastructure task (Prisma generate/migrate, OpenAPI emit, client generate, health check) as an Nx-runnable target so that `pnpm nx run <project>:<target>` executes it consistently across `local` and CI.
- **R-A2 (Ubiquitous)**: The `packages/api-client` package shall be a first-class `@moyura/*` workspace package consumable by `@moyura/web` and `@moyura/mobile` via workspace dependency.
- **R-A3 (State-Driven)**: While `node-linker=hoisted` is configured in `.npmrc`, the system shall keep Prisma's generated client compatible with the hoisted layout (generated client emitted into a project-local source path, not relying on a symlinked `node_modules/.prisma`).
- **R-A4 (Event-Driven)**: When a new infrastructure script is added, the system shall register it in the owning project's `project.json` `targets` (not only in `package.json` scripts) so Nx affected/caching applies.

### B. Backend Config + Prisma + Supabase

- **R-B1 (Ubiquitous)**: The backend shall load configuration through `@nestjs/config` and validate it with a Zod schema at bootstrap.
- **R-B2 (Unwanted, If-then)**: If any required environment variable is missing or fails Zod validation, then the backend shall fail fast at startup with a descriptive error and a non-zero exit code (no partial boot).
- **R-B3 (Ubiquitous)**: The Prisma schema shall declare a `datasource` whose runtime client uses the pooled connection and whose migration CLI uses the direct connection (dual-URL pattern).
- **R-B4 (State-Driven)**: While the backend runs against Supabase pooled connection (port 6543, `?pgbouncer=true`), the system shall disable prepared statements on that connection to avoid Supavisor/PgBouncer prepared-statement conflicts. 참고: 6543 = Supavisor **transaction-mode** pooler이며, 마이그레이션 및 session-bound 작업은 `DIRECT_URL`(5432)을 사용한다(R-B5). transaction-mode의 제약(prepared statements 불가, session state 유지 불가)은 의도된 trade-off다 — "6543은 항상 안전"하지 않다.
- **R-B5 (Event-Driven)**: When a Prisma migration is executed (`prisma migrate`), the system shall use `DIRECT_URL` (port 5432) rather than the pooled URL.
- **R-B6 (Ubiquitous)**: The backend `main.ts` shall read the listen port from validated config (`PORT`) instead of the hardcoded `3000`.
- **R-B7 (Ubiquitous)**: The backend shall not define any domain Prisma model beyond what a connectivity check requires (a raw `SELECT 1`-style probe is sufficient).

### C. Local Supabase CLI Stack

- **R-C1 (Ubiquitous)**: The system shall provide a `supabase/config.toml` so that `supabase start` brings up a local Docker stack (Postgres + Auth/GoTrue + Studio) mirroring prod Supabase.
- **R-C2 (Event-Driven)**: When the developer runs the documented `supabase start` workflow, the system shall make a local Postgres reachable, and the backend's `local` `DATABASE_URL`/`DIRECT_URL` shall point at that local Supabase Postgres. 참고: 로컬 Supabase CLI 스택은 prod과 달리 6543 Supavisor pooler를 노출하지 않을 수 있다(흔히 direct PG만 제공). 로컬에서 6543 pooler가 없으면 direct(5432)로 운영하며, 이 경우 prepared-statement 비활성 설정(R-B4)은 로컬에서 무해/N/A다. pooler 노출 여부는 M3 첫 스파이크에서 포트를 검증한다.
- **R-C3 (Event-Driven)**: When the developer runs `supabase stop`, the system shall tear the local stack down without affecting committed source.
- **R-C4 (Ubiquitous)**: The Supabase local stack shall be the canonical local DB (superseding any plain docker-compose Postgres) to keep parity with the future Supabase Auth direction.

### D. OpenAPI Client

- **R-D1 (Ubiquitous)**: The backend shall expose an OpenAPI document via `@nestjs/swagger`.
- **R-D2 (Event-Driven)**: When the OpenAPI emit target runs, the system shall write the backend's OpenAPI spec to a deterministic file (e.g. `apps/backend/openapi.json`) without requiring the server to stay running.
- **R-D3 (Event-Driven)**: When the client-generation target runs, the system shall generate a typed API client into `packages/api-client` from the emitted OpenAPI spec.
- **R-D4 (Ubiquitous)**: The generated client artifacts shall be reproducible from the OpenAPI spec (generation is idempotent; regenerating produces no spurious diff beyond spec changes).

### E. Frontend Env Injection (web + mobile)

- **R-E1 (Ubiquitous)**: The web app shall read its API base URL from `NEXT_PUBLIC_API_BASE_URL` via Next.js env files per environment.
- **R-E2 (Ubiquitous)**: The mobile app shall read its API base URL from `EXPO_PUBLIC_API_BASE_URL` via Expo app config / env.
- **R-E3 (Where, Optional)**: Where EAS build profiles exist, the mobile app shall define `local` and `prod` profiles as skeleton only (no real build/submit credentials wired).
- **R-E4 (Unwanted, If-then)**: If `NEXT_PUBLIC_API_BASE_URL` or `EXPO_PUBLIC_API_BASE_URL` is unset (resolving to `undefined`/empty) for a given environment, then the respective app shall execute an explicit in-app startup assertion that throws a descriptive configuration error. 근거: `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`는 build/bundle 시점에 정적으로 인라인되며, 미설정 시 자동으로 throw하지 않고 `undefined`/빈 문자열이 되어 silent하게 잘못된 호스트로 동작할 수 있다. 특히 mobile은 build-time 인라인 때문에 런타임 환경 감지가 더 어려우므로, 프레임워크의 자동 실패에 의존하지 않고 앱 부팅 경로에서 명시적 assert/throw 가드를 둔다.

### F. CORS

- **R-F1 (Event-Driven)**: When the backend receives a cross-origin request, the system shall allow it only if the request origin is in the environment's allowlist (web + mobile origins).
- **R-F2 (Ubiquitous)**: The CORS allowlist shall be sourced from validated config (per-environment), not hardcoded.
- **R-F3 (Unwanted, If-then)**: If a request originates from an origin not in the allowlist, then the backend shall not emit permissive `Access-Control-Allow-Origin: *` for that request.

### G. Health Endpoint

- **R-G1 (Event-Driven)**: When a client sends `GET /health`, the backend shall respond with a JSON payload containing an overall status and a database connectivity result.
- **R-G2 (State-Driven)**: While the database is reachable, `GET /health` shall report status `ok` with `db: up`.
- **R-G3 (Unwanted, If-then)**: If the database connectivity probe fails, then `GET /health` shall report a degraded/unhealthy status with `db: down` and an appropriate HTTP status code (e.g. 503).
- **R-G4 (Ubiquitous)**: The `/health` endpoint shall be the designated end-to-end proof artifact for frontend → backend → DB wiring. Local proof is verified within this SPEC (actual request against the local Supabase stack); prod proof is deferred to the deployment follow-up (이 SPEC에는 prod 배포가 없으므로 prod에서는 Render health check path가 `/health`로 설정/존재함만 확인한다).

### H. Auth Seam (구현 없음)

- **R-H1 (Optional, Where)**: Where future Supabase Auth will be added, the backend shall expose a placeholder NestJS Guard wiring point (a no-op or pass-through guard) so a real JWT guard can later be dropped in without restructuring.
- **R-H2 (Ubiquitous)**: The config schema shall include placeholders for `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET`, marked optional, with no verification logic implemented.
- **R-H3 (Unwanted)**: The system shall not implement login, token issuance, token verification, or user persistence in this SPEC.

### I. CI / EAS Skeleton

- **R-I1 (Event-Driven)**: When a push or pull request occurs, the GitHub Actions workflow shall install dependencies and run build/lint/test/typecheck across affected Nx projects (`nx affected`) — skeleton only.
- **R-I2 (Ubiquitous)**: The CI workflow shall not include automatic Prisma migration or deployment steps (those are a named follow-up).
- **R-I3 (Where, Optional)**: Where EAS configuration exists, the system shall provide `eas.json` `local`/`prod` profile skeletons only.

---

## Environment Variable Matrix

| Variable | Scope | local value source | prod value source | required? |
|----------|-------|--------------------|-------------------|-----------|
| `DATABASE_URL` | backend | `supabase start` 출력 (local Supabase Postgres). 로컬 스택이 6543 pooler를 노출하면 pooled, 아니면 direct(5432)로 운영 — direct 운영 시 prepared-statement 비활성은 N/A | Supabase pooled URL (6543 Supavisor transaction-mode, `?pgbouncer=true`), Render secrets | yes |
| `DIRECT_URL` | backend | local Supabase Postgres direct (5432) | Supabase direct URL (5432), Render secrets | yes |
| `PORT` | backend | `.env` (예: 3000) | Render-injected `PORT` | yes |
| `NODE_ENV` | backend | `.env` (`development`) | Render env (`production`) | yes |
| `CORS_ORIGINS` | backend | `.env` (예: `http://localhost:3000,http://localhost:8081`) | Render secrets (web prod URL + mobile scheme) | yes |
| `NEXT_PUBLIC_API_BASE_URL` | web | `.env.local` (예: `http://localhost:3000`) | Next prod env / 호스팅 env | yes |
| `EXPO_PUBLIC_API_BASE_URL` | mobile | `.env` / app config (예: `http://localhost:3000`) | EAS profile env / app config | yes |
| `SUPABASE_URL` | backend (seam) | `supabase start` 출력 API URL | Supabase 프로젝트 URL | no — seam placeholder (정의만, 런타임 미사용) |
| `SUPABASE_ANON_KEY` | backend (seam) | `supabase start` 출력 anon key | Supabase anon key | no — seam placeholder (정의만, 런타임 미사용) |
| `SUPABASE_JWT_SECRET` | backend (seam) | `supabase start` 출력 JWT secret | Supabase JWT secret | no — seam placeholder (정의만, 런타임 미사용) |

참고: 모든 `.env*` 파일은 `.gitignore`로 추적 제외 (루트 `.gitignore`에 이미 `.env`, `.env.*`, `!.env.example` 규칙 존재 — 앱별 `.env.example`만 커밋).

---

## Open Decisions (권장 기본값 포함)

### D1. Prisma 7 vs Prisma 6.x

- 배경(검증됨): Prisma 7에서 `prisma-client` 제너레이터가 기본이며, 생성 클라이언트의 `output` 경로가 **필수**(클라이언트가 `node_modules/.prisma`가 아닌 프로젝트 소스로 emit)이고, `moduleFormat`(`cjs`/`esm`) 옵션으로 모듈 형식을 선택할 수 있다. 마이그레이션 CLI는 `prisma.config.ts`로 `DIRECT_URL`을 가리킨다. (Sources: Prisma schema reference, Prisma+Supabase, Prisma+NestJS)
- **선택지 A — Prisma 7**: cutting-edge. NestJS는 CommonJS이므로 `moduleFormat = "cjs"` 명시 필요, 런타임 driver-adapter 구성 필요. `node-linker=hoisted`와 잘 맞음(클라이언트가 소스로 emit되어 심링크 의존 없음 — R-A3 충족 용이).
- **선택지 B — Prisma 6.x**: `prisma-client-js` 제너레이터, NestJS CommonJS와의 통합이 더 매끄럽고 예제/문서가 풍부. driver-adapter 강제 없음.
- **권장(미확정) — 선택지 A (Prisma 7) + `moduleFormat = "cjs"`. 단, 이 권장은 settled가 아니며 M2 spike 결과에 종속된다.** 근거: (1) 신규 스캐폴드 프로젝트라 마이그레이션 부채가 없다, (2) Prisma 7의 소스-emit 클라이언트가 `node-linker=hoisted` 환경에서 R-A3을 자연스럽게 만족할 것으로 기대된다, (3) Supabase pooled 연결은 driver-adapter 경로와 호환된다. 그러나 Prisma 7 + NestJS CJS(ESM 기본값/driver-adapter) 조합은 cutting-edge라 통합 리스크가 있다(K3). 따라서 **최종 선택은 M2 첫 스파이크(`prisma generate` → `nest build` 성공 여부)로 게이트**한다 — 스파이크가 실패하면 즉시 선택지 B(Prisma 6.x)로 폴백하고 그 결정을 spec.md HISTORY에 기록한다(AC-A3b). `moduleFormat = "cjs"` 지정은 선택지 A를 택할 때의 필수 조건이다.

### D2. OpenAPI 클라이언트 생성 도구

- **선택지 A — `openapi-typescript` (+ 얇은 fetch 래퍼)**: 타입만 생성 후 경량 fetch 래퍼. 단순·가벼움·의존성 최소. (권장)
- **선택지 B — `swagger-typescript-api`**: 풀 클라이언트(메서드 포함) 생성.
- **선택지 C — `@openapitools/openapi-generator-cli`**: 가장 기능 풍부하나 Java 런타임 의존, 무거움.
- **권장: 선택지 A**. 근거: 이 SPEC의 유일한 엔드포인트는 `/health` 한 개이며 범위가 인프라 배선이다. 투기적 추상화 금지 원칙(TRUST 5 Readable)에 따라 타입 + 얇은 fetch 래퍼가 충분하고 유지보수가 가장 가볍다. 엔드포인트가 늘어나면 그때 B로 승격 검토.

---

## Risks & Mitigations

| # | 리스크 | 완화 |
|---|--------|------|
| K1 | Expo 56 / Next 16 bleeding-edge — API 형태가 문서와 다를 수 있음 | 버전 특이 동작은 추측 금지, 구현 시 Context7/공식 문서로 재검증. 환경변수 주입은 프레임워크 표준 메커니즘(`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`)만 사용해 노출면 최소화 |
| K2 | Nx `nx:run-commands` 래핑 — 캐시 입력/출력 미스로 stale 산출물 | 새 타겟은 `inputs`/`outputs`를 명시(특히 openapi emit → client generate 의존), `nx.json` `targetDefaults` 정합성 유지 |
| K3 | pnpm `node-linker=hoisted` + `prisma generate` — 심링크 미사용 레이아웃에서 클라이언트 해석 실패 | Prisma 7 소스-emit `output` 사용(R-A3), 구현 첫 스파이크에서 generate→build 동작 검증, 실패 시 D1 선택지 B 폴백 |
| K4 | Supabase pooled 연결 prepared-statement 충돌 (Supavisor/PgBouncer transaction mode) | pooled `DATABASE_URL`에 `?pgbouncer=true` + prepared statements 비활성(R-B4), 마이그레이션은 `DIRECT_URL`(5432)로만 수행(R-B5) |
| K5 | Render cold start — 무료/저티어 인스턴스 슬립 후 첫 요청 지연 | `/health`를 Render health check path로 지정(결정 4), cold-start는 인프라 SPEC 범위에서 config로만 대응(하드닝은 Non-Goal) |
| K6 | env 누락으로 silent 오동작 | Zod fail-fast(R-B2) + 프론트 env 미설정 시 명시적 에러(R-E4), `.env.example` 커밋으로 필수 변수 가시화 |
| K7 | Auth seam이 과설계로 번질 위험 | Guard는 no-op/pass-through만(R-H1), 검증 로직 금지(R-H3), env는 optional placeholder만(R-H2) |
| K8 | 로컬 Supabase 스택이 6543 pooler를 노출하지 않음 → local/prod 연결 모드 불일치(local direct vs prod pooled) | M3 첫 스파이크에서 포트 노출 여부 검증, 로컬은 direct(5432) 모드 허용(R-C2). prod pooled에서만 prepared-statement 비활성(R-B4) 적용하고 마이그레이션은 양 환경 모두 `DIRECT_URL` 사용(R-B5)으로 모드 차이를 흡수 |

---

## Sources (실제 사용한 URL)

- Prisma + Supabase 듀얼 URL 풀링 (pooled 6543 `?pgbouncer=true` 런타임 + direct 5432 마이그레이션): https://www.prisma.io/docs/orm/overview/databases/supabase — `prisma.config.ts`가 `DIRECT_URL`을 가리키고 런타임은 pooled `DATABASE_URL` + driver adapter 사용 확인.
- Supabase Postgres 연결 포트 (direct 5432, Supavisor transaction pooler 6543): https://supabase.com/docs/guides/database/connecting-to-postgres — 포트 번호 확인.
- Prisma 7 변경점 (`prisma-client` 기본 제너레이터, `output` 필수, `moduleFormat` cjs/esm): https://www.prisma.io/docs/orm/reference/prisma-schema-reference — Prisma 7 제너레이터/`moduleFormat` 확인.
- Prisma + NestJS 통합 가이드: https://www.prisma.io/docs/guides/frameworks/nestjs — NestJS 통합 컨텍스트.
- Supabase 현재 Postgres 메이저 버전 (PostgreSQL 17.x stable, 15 레거시 지원): https://github.com/supabase/postgres — `postgresql-17.6` 확인. 마이너 버전은 Supabase가 고정하므로 구현 시 재검증.
- NestJS OpenAPI/Swagger introduction: https://docs.nestjs.com/openapi/introduction — `@nestjs/swagger` 사용(상세 셋업은 구현 시 문서 재참조).

검증 불가 항목: Supabase가 신규 프로젝트에 할당하는 정확한 PG 마이너 버전 → "구현 시 검증". NestJS Swagger의 구체 setup 코드 → 구현 시 공식 문서 재참조.
