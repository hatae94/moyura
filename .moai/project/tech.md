# Tech — moyura

> 본 문서는 **구현됨(IMPLEMENTED)** 과 **계획됨(PLANNED)** 을 명확히 구분한다.
> 계획 항목은 모두 [`SPEC-ENV-SETUP-001`](../specs/SPEC-ENV-SETUP-001/spec.md)(status: `draft`)에서 정의되며, 아직 코드로 구현되지 않았다.

## 구현됨 vs 계획됨 (요약)

| 구분 | 내용 |
|------|------|
| **IMPLEMENTED** | 모노레포 골격(pnpm + Nx), 3개 앱 스캐폴드(mobile/web/backend), `@moyura/config` 스텁, 루트/앱별 Nx 타겟, hoisted node_modules |
| **PLANNED** (SPEC-ENV-SETUP-001, draft, 미구현) | Supabase PostgreSQL, Prisma ORM(듀얼 URL), Zod 환경검증, NestJS OpenAPI → `packages/api-client` 클라이언트 생성, Supabase CLI 로컬 스택, Render 호스팅, CORS allowlist, `/health` 엔드포인트, Supabase Auth seam |

---

## 1. 언어 / 런타임 (IMPLEMENTED)

- **TypeScript**:
  - `apps/mobile`: TypeScript `~6.0.3` (**TS 6** 라인) — web/backend와 메이저 라인이 다름. 타입 검사/생성 클라이언트 호환성은 TS 6 기준으로 확인 필요.
  - `apps/web`: TypeScript `^5`
  - `apps/backend`: TypeScript `^5.7.3`
- **루트 공유 컴파일러 옵션** (`tsconfig.base.json`): `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `declaration`, `sourceMap`.
- **Node**: 개발 환경 Node v25.x. backend `engines`는 `node >=20.0.0`, `npm >=10.0.0` 요구.
- **패키지 매니저**: pnpm `10.27.0` (`packageManager` 필드로 고정).

## 2. 프레임워크 (IMPLEMENTED — 스캐폴드)

| 앱 | 프레임워크 | 핵심 버전 | 특이사항(검증됨) |
|----|------------|-----------|------------------|
| mobile | Expo (React Native) | expo `~56.0.6`, react `19.2.3`, react-native `0.85.3` | `app.json` slug `app`, 기본 Expo 스캐폴드(App.tsx/index.ts) |
| web | Next.js | `16.2.6`, react/react-dom `19.2.4` | App Router(`app/`), Tailwind v4(`@tailwindcss/postcss`), `reactCompiler: true`, `turbopack.root`를 모노레포 루트로 고정(stray lockfile 워크스페이스 오탐 방지) |
| backend | NestJS | `@nestjs/common ^11`, `@nestjs/core ^11`, platform-express `^11` | 현재 기본 `app.controller`/`app.service`만 존재. `main.ts` 포트 `3000` 하드코딩(SPEC에서 config화 예정) |

> Expo 56 / Next 16은 bleeding-edge이므로 버전 특이 동작은 추측하지 않는다. `apps/mobile/AGENTS.md`, `apps/web/AGENTS.md`가 "학습 데이터와 다를 수 있으니 버전별 공식 문서를 먼저 읽으라"고 명시한다.

## 3. 빌드 / 패키지 도구 (IMPLEMENTED)

- **Nx `21.6.7`** — 빌드 오케스트레이션/캐시.
  - 모든 프로젝트 타겟이 `nx:run-commands`로 각 앱의 **네이티브 CLI**(`next`, `expo`, `nest build`, `eslint`, `jest`, `tsc`)를 래핑한다.
  - **@nx 공식 플러그인(`@nx/next`, `@nx/expo`, `@nx/nest` 등)은 채택하지 않음** — run-commands 래핑 방식. (캐시 입력/출력 미스로 인한 stale 산출물 리스크는 SPEC K2에서 명시.)
  - 캐시 정책은 `nx.json` `targetDefaults` + 프로젝트별 `outputs`로 관리(상세: [structure.md](./structure.md)).
- **pnpm workspaces** — `apps/*`, `packages/*`. `node-linker=hoisted`(Metro 호환).
  - `onlyBuiltDependencies`: `@nestjs/core`, `@swc/core`, `nx`, `msgpackr-extract` (설치 시 빌드 스크립트 허용).
  - `ignoredBuiltDependencies`: `sharp`, `unrs-resolver`.

## 4. 데이터 / 백엔드 스택 (PLANNED — SPEC-ENV-SETUP-001, draft, 미구현)

아래 항목은 전부 **계획**이며 현재 코드/의존성에 존재하지 않는다. 근거는 SPEC 결정 표/요구사항.

- **DB (prod)**: Supabase 관리형 **PostgreSQL** (현재 PG `17.x` stable — 마이너는 구현 시 검증). SPEC 결정 #2.
- **ORM**: **Prisma** — 듀얼 URL 패턴 (SPEC 결정 #3, R-B3~R-B5):
  - `DATABASE_URL` = pooled (포트 `6543`, Supavisor **transaction-mode** pooler, `?pgbouncer=true`, prepared statements 비활성) → 런타임 Client.
  - `DIRECT_URL` = direct (포트 `5432`) → 마이그레이션 CLI.
  - **버전 미확정(Open Decision D1)**: Prisma 7(권장, `moduleFormat = "cjs"`) vs Prisma 6.x — **M2 스파이크(`prisma generate` → `nest build`)** 결과로 게이트. 실패 시 6.x로 폴백.
- **config 검증**: `@nestjs/config` + **Zod** 부팅 시 검증, 누락/불일치 시 fail-fast(non-zero exit). SPEC 결정 #5, R-B1/R-B2.
- **API 계약**: NestJS `@nestjs/swagger`로 OpenAPI 노출 → `apps/backend/openapi.json` emit → `packages/api-client`에 타입드 클라이언트 생성.
  - **생성 도구 권장(Open Decision D2)**: `openapi-typescript` + 얇은 fetch 래퍼(최소 의존). 대안: `swagger-typescript-api`, `@openapitools/openapi-generator-cli`.
- **로컬 DB**: **Supabase CLI 로컬 스택**(Docker: Postgres + Auth/GoTrue + Studio), `supabase/config.toml` + `supabase start/stop`. canonical 로컬 DB. SPEC 결정 #9, R-C1~R-C4.
  - 주의: 로컬 스택이 `6543` pooler를 노출하지 않을 수 있음 → 로컬은 direct(5432) 운영 허용, 이 경우 prepared-statement 비활성은 N/A(R-C2, K8).
- **백엔드 prod 호스팅**: **Render** (Web Service). build `pnpm nx build backend`, health check path `/health`, env는 Render secrets 주입. SPEC 결정 #4.
- **CORS**: 환경별 web + mobile origin allowlist, validated config 출처(하드코딩 금지). R-F1~R-F3.
- **헬스 엔드포인트**: `GET /health` — status + DB 연결 확인(`SELECT 1` 수준). end-to-end 배선 증명용. R-G1~R-G4.
- **프런트 env 주입**: web `NEXT_PUBLIC_API_BASE_URL`, mobile `EXPO_PUBLIC_API_BASE_URL`. 미설정 시 앱 부팅 경로에서 명시적 throw 가드(R-E4 — `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`는 build/bundle 시점 정적 인라인되므로).
- **Auth**: 구현 OUT OF SCOPE. 미래 = **Supabase Auth**. 이 SPEC은 NestJS Guard **seam**(no-op/pass-through) + `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET` env 플레이스홀더(optional, 검증 로직 없음)만 남김. R-H1~R-H3.
- **CI / EAS**: GitHub Actions(install/build/lint/test/typecheck on `nx affected`) + EAS `local`/`prod` 프로파일은 **스켈레톤만**. 자동 마이그레이션/배포 잡은 named follow-up. R-I1~R-I3.

## 5. 품질 / 테스트

### 프로젝트 기본 정책 (`.moai/config/sections/quality.yaml`)

- **개발 방법론**: TDD (`development_mode: tdd`, RED-GREEN-REFACTOR).
- **커버리지 목표**: `test_coverage_target: 85` (%), 커밋당 최소 `min_coverage_per_commit: 80`.
- **TRUST 5 enforce**: `enforce_quality: true`. LSP quality gates `enabled: true`.
- **세션 effort 기본값**: `xhigh` (Opus 4.7+).

### 인프라 SPEC의 실용적 하이브리드 (주의)

- 위 85% 목표는 **도메인 기능 코드** 기준이다. 인프라 배선 SPEC([`SPEC-ENV-SETUP-001`](../specs/SPEC-ENV-SETUP-001/spec.md))은 환경/배선 검증 성격상 **실용적 하이브리드(pragmatic hybrid)** 접근을 취하며, end-to-end 증명은 `/health` 엔드포인트(실제 요청) 같은 통합 검증으로 한다 — 단위 커버리지 85%를 기계적으로 강제하지 않는다.

### 현재 앱별 테스트 도구 (IMPLEMENTED 스캐폴드)

- `apps/backend`: **Jest**(`jest`, `ts-jest`), e2e(`supertest`, `jest-e2e.json`), 커버리지 타겟 설정 존재. lint = ESLint 9 flat config + Prettier.
- `apps/web`: ESLint 9(`eslint-config-next`), `babel-plugin-react-compiler`.
- `apps/mobile`: 테스트 러너 미구성(기본 스캐폴드). typecheck = `tsc --noEmit`.

> 참고: 사용자 글로벌 선호(vitest/oxlint 등)는 다른 프로젝트 기준이며, 본 저장소는 위 도구 구성을 그대로 사용한다.

## 6. 주요 설정 파일 위치

| 파일 | 역할 |
|------|------|
| `package.json` (루트) | private, `nx run-many` 스크립트, `packageManager: pnpm@10.27.0`, devDep `nx 21.6.7` |
| `nx.json` | `targetDefaults`(build/lint/test/typecheck 캐시), `namedInputs`, `sharedGlobals` |
| `pnpm-workspace.yaml` | 워크스페이스 글롭 + `onlyBuiltDependencies`/`ignoredBuiltDependencies` |
| `.npmrc` | `node-linker=hoisted` |
| `tsconfig.base.json` | 루트 공유 TS 컴파일러 옵션 |
| `apps/web/next.config.ts` | `reactCompiler`, `turbopack.root` 고정 |
| `apps/web/project.json` 등 | 프로젝트별 Nx 타겟 |
| `apps/backend/nest-cli.json`, `.prettierrc`, `eslint.config.mjs` | backend 빌드/포맷/린트 |
| `apps/mobile/app.json` | Expo 앱 config |
| `.moai/config/sections/quality.yaml` | 품질/방법론(TDD, 85%) 설정 |
| (계획) `apps/backend/prisma/schema.prisma`, `prisma.config.ts`, `supabase/config.toml`, `eas.json`, `.github/workflows/*` | SPEC-ENV-SETUP-001에서 생성 예정 |

## 참조

- 계획 스택 상세/근거: [`.moai/specs/SPEC-ENV-SETUP-001/`](../specs/SPEC-ENV-SETUP-001/) (`spec.md`, `acceptance.md`, `plan.md`, `audit.md`)
- 디렉터리/패키지 구조: [structure.md](./structure.md)
- 제품 비전: [product.md](./product.md)
