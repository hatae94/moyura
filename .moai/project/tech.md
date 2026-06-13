# Tech — moyura

> 본 문서는 **구현됨(IMPLEMENTED)** 과 **계획됨(PLANNED)** 을 명확히 구분한다.
> 환경/인프라 배선은 [`SPEC-ENV-SETUP-001`](../specs/SPEC-ENV-SETUP-001/spec.md)(status: `completed`, v0.3.0)에서 정의되었고 **구현 완료**되었다(`master`, 커밋 `7362e2a..1895e05`).
> 인증(authn)은 [`SPEC-AUTH-001`](../specs/SPEC-AUTH-001/spec.md)(status: `completed`, v0.3.0)에서 **구현 완료**되었다(`master`, 커밋 `6ca29fd..d54adb0`, evaluator-active PASS — security 0.97). 남은 PLANNED 항목은 prod 배포 파이프라인과 인증 후속 과제(소셜 키, 이메일 확인/재설정, RBAC, 프런트 테스트 타겟)뿐이다.
> 모임 도메인은 [`SPEC-MOIM-001`](../specs/SPEC-MOIM-001/spec.md)(status: `completed`, v0.2.0)에서 **구현 완료**되었다(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `cc37924`, evaluator-active PASS). Moim + MoimMember 테이블, 6개 REST 라우트, assertMember/assertOwner 인가 단일 출처(@MX:ANCHOR) 구현.

## 구현됨 vs 계획됨 (요약)

| 구분 | 내용 |
|------|------|
| **IMPLEMENTED (골격)** | 모노레포 골격(pnpm + Nx), 3개 앱 스캐폴드(mobile/web/backend), `@moyura/config` 스텁, 루트/앱별 Nx 타겟, hoisted node_modules |
| **IMPLEMENTED (SPEC-MOBILE-003, in-progress — iOS 핵심 플로우 검증 완료)** | expo-router(~56.2.10) 네이티브 네비게이션 골격(Root Stack + `(auth)`/`(tabs)` 그룹 + 네이티브 Tabs), 라우트별 WebView 래퍼, 웹 `(main)` 탭 라우트 그룹(BottomTabBar + HomeTab + 플레이스홀더), 네이티브 AuthContext(SecureStore + bridge 신호), route-map-core / auth-state-core 순수 결정 모듈, 셸 모드 탭바 숨김(ShellModeEffect + ShellSessionAnnouncer), redirect /me→/home. Google OAuth·Android·로그아웃 E2E 검증 대기 — status in-progress |
| **IMPLEMENTED (SPEC-MOIM-001, completed)** | 모임 도메인 첫 기능 모듈: Moim + MoimMember 모델(nickname, role, joined_at, 복합 PK, onDelete Cascade) + 마이그레이션 `20260613155202_add_moim`, 6개 REST 라우트(POST/GET 목록·단건·멤버/DELETE 모임·멤버십), assertMember/assertOwner 인가 단일 출처(@MX:ANCHOR), createMoim 원자 트랜잭션. jest 105/105, coverage 96.79%, evaluator-active PASS. 새 의존성 없음(@nestjs/common ^11, @prisma/client 7.8.0 재사용). |
| **IMPLEMENTED (SPEC-ENV-SETUP-001, completed)** | Supabase PostgreSQL 연결(Prisma 7 + `@prisma/adapter-pg` 듀얼 URL), Zod 4 환경검증(fail-fast), NestJS `@nestjs/swagger` OpenAPI → `packages/api-client`(`@moyura/api-client`) 타입드 클라이언트 생성, Supabase CLI 로컬 스택(direct `:54322`), CORS allowlist, `GET /health` 엔드포인트, CI/EAS 스켈레톤, 프런트 env 가드(web/mobile) |
| **IMPLEMENTED (SPEC-AUTH-001, completed)** | Supabase Auth **실제 인증**(authn-only): 백엔드 ES256 JWKS 검증 가드(jose), 첫 도메인 모델 `Profile` + UPSERT, 보호 라우트 `GET /me`, 웹 `@supabase/ssr` 쿠키 세션 + email/pw + PKCE 콜백, 소셜/모바일 OAuth 스캐폴드, `@moyura/api-client` Bearer 토큰 주입. evaluator-active PASS(security 0.97) |
| **PLANNED (follow-up, 미구현)** | prod 배포 파이프라인(자동 Prisma migrate + deploy, Render/Supabase 실 배포 및 prod e2e 증명), 인증 후속 과제(실제 소셜 provider 키, 모바일 런타임 OAuth 라운드트립, 이메일 확인/비밀번호 재설정, RBAC/인가, 프런트 자동 테스트 타겟, prod HTTPS 강제) |

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
| mobile | Expo (React Native) | expo `~56.0.6`, react `19.2.3`, react-native `0.85.3`, `react-native-webview 13.16.1`(Expo56 핀), `expo-secure-store ~56.0.4`, `expo-splash-screen ~56.0.10`, `expo-router ~56.2.10`(SPEC-MOBILE-003), `react-native-safe-area-context`, `react-native-screens`, `expo-constants` | `app.json` slug `app`, scheme `moyura`. expo-router 파일 기반 라우팅(`app/` 트리) — Root Stack + `(auth)`/`(tabs)` 그룹 + 네이티브 Tabs. `App.tsx` 제거(SPEC-MOBILE-003). `expo-secure-store` 기반 토큰 캐시 + nonce 인증 postMessage 브리지(SPEC-WEBVIEW-SHELL-001 + SPEC-MOBILE-002). @react-native-cookies jcenter()→mavenCentral() pnpm patch(Android Gradle 9 호환) |
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

## 4. 데이터 / 백엔드 스택 (IMPLEMENTED — SPEC-ENV-SETUP-001, completed v0.3.0)

아래 항목은 **구현 완료**되어 `master`에 존재한다(품질 게이트 green). 버전은 실제 설치된 의존성 기준.

- **DB (prod)**: Supabase 관리형 **PostgreSQL** (PG `17.x` stable — 마이너는 Supabase 고정). SPEC 결정 #2.
- **ORM**: **Prisma `7.8.0`** — D1 스파이크 통과로 Prisma 7 확정 (선택지 A). 듀얼 URL 패턴 (R-B3~R-B5):
  - `prisma-client` 제너레이터, `moduleFormat = "cjs"`(NestJS CommonJS), 클라이언트를 `apps/backend/src/generated/prisma`로 **source-emit**(gitignore — `prisma generate`로 재생성). hoisted 레이아웃에서 심링크 의존 없음(R-A3 충족).
  - Prisma 7는 **driver adapter 필수** → `@prisma/adapter-pg 7.8.0` + `pg 8.21.0` 사용.
  - 연결 URL은 schema가 아닌 **`apps/backend/prisma.config.ts`**에 위치 (Prisma 7가 schema `datasource`에서 `url`/`directUrl` 제거).
  - `DATABASE_URL` = 런타임 pooled (prod: 포트 `6543`, Supavisor transaction-mode, `?pgbouncer=true`, prepared statements 비활성) → pg adapter 경유 Client.
  - `DIRECT_URL` = direct (포트 `5432`) → 마이그레이션 CLI(`prisma migrate`, 양 환경 공통).
- **config 검증**: `@nestjs/config 4.0.4` + **Zod `4.4.3`** 부팅 시 검증, 누락/불일치 시 fail-fast(non-zero exit). R-B1/R-B2.
- **API 계약**: `@nestjs/swagger 11.4.4`로 OpenAPI를 `/api`에 노출 → `apps/backend/openapi.ts` emit 스크립트가 `apps/backend/openapi.json` 생성(서버 미기동) → `packages/api-client`에 타입드 클라이언트 생성.
  - **생성 도구(D2 확정)**: `openapi-typescript 7.13.0` 타입 생성(`src/schema.d.ts`, gitignore — 재생성) + 얇은 타입드 fetch 래퍼(`createApiClient`, `getHealth`). openapi.json 계약 산출물은 커밋된다.
- **로컬 DB**: **Supabase CLI `2.104.0` 로컬 스택**(Docker: Postgres + Auth/GoTrue + Studio), `supabase/config.toml` + `supabase/README.md`(start/stop). canonical 로컬 DB. R-C1~R-C4.
  - 로컬 스택은 `6543` pooler를 노출하지 않음 → 로컬은 **direct Postgres `:54322`** 운영(pooler는 prod 전용). 이 경우 prepared-statement 비활성은 N/A(R-C2, K8). prod에서만 pooled(6543) 적용.
- **백엔드 prod 호스팅**: **Render** (Web Service). build `pnpm nx build backend`, start `node dist/src/main.js`, health check path `/health`, env는 Render secrets 주입. 가이드: `docs/deploy-render.md`. SPEC 결정 #4.
- **CORS**: 환경별 web + mobile origin allowlist를 `CORS_ORIGINS`(validated config)에서 로드, 와일드카드(`*`) 금지. R-F1~R-F3.
- **헬스 엔드포인트**: `GET /health` — `PrismaService.pingDatabase()`(`SELECT 1`)로 DB 연결 확인. 200(`ok`/`up`) / 503(`degraded`/`down`). end-to-end 배선 증명용(로컬 e2e 검증 완료). R-G1~R-G4.
- **프런트 env 주입**: web `NEXT_PUBLIC_API_BASE_URL`(`apps/web/lib/env.ts` 가드, 루트 레이아웃에서 실행), mobile `EXPO_PUBLIC_API_BASE_URL`(`apps/mobile/lib/env.ts` 가드, `index.ts`에서 실행). 미설정 시 명시적 throw(R-E4 — `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`는 build/bundle 시점 정적 인라인). web은 api-client를 `transpilePackages`로 처리.
- **Auth**: **실제 인증 구현 완료**(SPEC-AUTH-001 completed, authn-only). 환경/인프라 SPEC이 남긴 no-op seam을 실제 인증으로 대체/확장.
  - **백엔드 JWT 검증**: `SupabaseAuthGuard`가 **jose `^6.2.3`** `createRemoteJWKSet` + `jwtVerify`로 ES256 JWKS 검증(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, `kid` 선택, algorithms 화이트리스트 고정, `alg:none`/alg-confusion은 서명 검증 전 거부, `iss`/`aud`/`exp`/`nbf` normative, JWKS 실패 시 fail-closed 무다운그레이드). HS256-only 토큰 전용 레거시 폴백(`SUPABASE_JWT_SECRET`). 가드는 보호 라우트(`/me`)에 **per-route `@UseGuards`**(global 아님) — `/health`·`GET /`는 public 유지.
  - **profile 모델**: 첫 Prisma 도메인 모델 `Profile`(`id = sub` PK, `createdAt`), 마이그레이션 `20260602095934_init_profile`(`DIRECT_URL`). `ProfileService.upsertBySub`는 가드가 부착한 검증된 `sub`만 사용(mass-assignment 차단).
  - **웹 세션**: **`@supabase/ssr` `0.10.3`** + `@supabase/supabase-js` `2.106.2`. browser/server 클라이언트(`lib/supabase/`), `proxy.ts` updateSession(Next 16 미들웨어 컨벤션), PKCE 콜백 라우트(`app/auth/callback/route.ts`, 음성 경로 가드), email/pw signup/login/logout(`lib/auth/actions.ts`). `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - **api-client Bearer**: `@moyura/api-client`에 optional `getToken`→`Authorization: Bearer` 주입(토큰은 URL/query 금지) + `getMe()` 편의 메서드.
  - **소셜/모바일 스캐폴드**: `supabase/config.toml` `[auth.external.google|kakao|apple]`(`enabled = false`, `env()` 시크릿). `apps/mobile` app scheme `"moyura"` + 시스템 브라우저 OAuth 헬퍼(`lib/auth/oauth.ts`), `EXPO_PUBLIC_SUPABASE_*`. 네이티브 토큰 저장소 미도입(webview가 웹 세션 공유 — OD-4).
  - 검증: 백엔드 보안 테스트 53건(14개 적대적 공격 토큰 차단), statement 커버리지 95.71%, 웹 세션→`GET /me`→200 profile LIVE e2e, evaluator-active PASS(Functionality 0.95 / Security 0.97 / Craft 0.78 / Consistency 0.93). R-A1~R-J3.
- **CI / EAS**: `.github/workflows/ci.yml`(install → prisma generate → `nx affected` build/lint/test/typecheck; **migrate/deploy 없음**) + `apps/mobile/eas.json` `local`/`prod` 프로파일 **스켈레톤**. R-I1~R-I3.

### follow-up (PLANNED — 의도적으로 연기)

- **prod 배포 파이프라인**(SPEC-ENV-SETUP-001 연기): 자동 Prisma migrate + deploy, Render/Supabase 실 배포, prod e2e 증명(R-G4 prod — 현재는 Render health check path가 `/health`임만 확인). named follow-up.
- **인증 후속 과제**(SPEC-AUTH-001 연기): 실제 소셜 provider 키 발급/배선(Google/Apple/Kakao 콘솔), 모바일 런타임 OAuth 라운드트립(디바이스/시뮬레이터 — 현재 코드+config 스캐폴드만), 이메일 확인 + 비밀번호 재설정, RBAC/인가, prod HTTPS 강제. 모두 named follow-up(Non-Goal로 spec.md에 명시).
- **프런트 자동 테스트 타겟**(SPEC-AUTH-001 evaluator MAJOR): web/mobile/api-client에 자동화 테스트 타겟 부재. 테스트 가능한 순수 함수(`resolveCallbackOutcome`/`resolveSupabaseConfig`/api-client Bearer 주입/`launchSocialOAuth`)가 회귀 보호되지 않음(빌드 시점 node sanity로만 검증). 별도 후속 작업으로 도입.

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
- `apps/mobile`: **vitest**(node-env, SPEC-MOBILE-001 도입) — 순수 함수 단위 테스트(`resolveWebUrl`, oauth-bridge 헬퍼)만 대상(RN/expo import 없는 모듈). nx `test` 타겟. typecheck = `tsc --noEmit`. 린터 미구성(품질 게이트는 strict tsc).

> 참고: 사용자 글로벌 선호(vitest/oxlint 등)는 다른 프로젝트 기준이나, mobile은 SPEC-MOBILE-001에서 순수 로직 회귀 보호를 위해 vitest를 도입했다(web/backend 도구 구성은 불변).

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
| `apps/backend/prisma/schema.prisma` | Prisma 7 스키마(`prisma-client` 제너레이터, source-emit, `Profile` + `Moim` + `MoimMember` 모델) |
| `apps/backend/prisma/migrations/20260602095934_init_profile/` | 첫 도메인 마이그레이션(`Profile`) |
| `apps/backend/prisma/migrations/20260613155202_add_moim/` | 모임 도메인 마이그레이션(`Moim` + `MoimMember`, onDelete Cascade) |
| `apps/backend/src/auth/`, `apps/backend/src/profile/` | 인증 가드/검증/config + profile 모듈·서비스·`GET /me` |
| `apps/backend/src/moim/` | 모임 도메인 모듈(SPEC-MOIM-001) — MoimService/MoimController/MoimModule + dto + spec/integration 테스트 |
| `apps/web/lib/supabase/`, `apps/web/lib/auth/`, `apps/web/proxy.ts` | 웹 `@supabase/ssr` 클라이언트·세션 미들웨어·auth 액션·PKCE 콜백 |
| `apps/mobile/App.tsx` | 풀스크린 WebView 셸 + Google OAuth 인터셉트/복귀(SPEC-MOBILE-001) |
| `apps/mobile/lib/web-url.ts` | `EXPO_PUBLIC_WEB_URL` 가드 + `WEB_URL`(@MX:ANCHOR) — WebView source·OAuth 콜백 호스트 단일 출처 |
| `apps/mobile/lib/auth/oauth.ts` | 모바일 시스템 브라우저 OAuth 헬퍼 + Google authorizeUrl 브리지 배선(R-F3 완성) |
| `apps/mobile/lib/auth/oauth-bridge.ts` | OAuth 브리지 순수 URL 헬퍼(인터셉트 판별/redirect_to 재작성/콜백 조립) — vitest 단위 테스트 |
| `apps/backend/prisma.config.ts` | Prisma 7 연결 URL(`DATABASE_URL`/`DIRECT_URL`) 위치 |
| `apps/backend/openapi.ts`, `openapi.json` | OpenAPI emit 스크립트 + 커밋된 계약 산출물 |
| `supabase/config.toml`, `supabase/README.md` | 로컬 Supabase CLI 스택(direct `:54322`) |
| `apps/web/lib/env.ts`, `apps/mobile/lib/env.ts` | 프런트 env 가드(미설정 시 throw) |
| `apps/mobile/eas.json` | EAS `local`/`prod` 프로파일 스켈레톤 |
| `.github/workflows/ci.yml` | CI(install/build/lint/test/typecheck, migrate/deploy 없음) |
| `docs/deploy-render.md` | Render 배포 가이드 |

## 참조

- 계획 스택 상세/근거: [`.moai/specs/SPEC-ENV-SETUP-001/`](../specs/SPEC-ENV-SETUP-001/) (`spec.md`, `acceptance.md`, `plan.md`, `audit.md`)
- 디렉터리/패키지 구조: [structure.md](./structure.md)
- 제품 비전: [product.md](./product.md)
