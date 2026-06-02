# Structure — moyura

> 본 문서는 실제 저장소(repo) 상태를 검증하여 작성되었다. 미생성 항목은 "계획(planned)"으로 명시한다.

## 모노레포 개요

- **워크스페이스 관리자**: pnpm workspaces (`pnpm@10.27.0`)
- **빌드 오케스트레이터**: Nx `21.6.7`
- **워크스페이스 글롭** (`pnpm-workspace.yaml`): `apps/*`, `packages/*`
- **node_modules 레이아웃** (`.npmrc`): `node-linker=hoisted` (Metro/Nest/Next가 npm·yarn과 동일하게 의존성을 해석하도록 평탄화)
- **단일 git 저장소**: remote `git@github.com:hatae94/moyura.git`, 브랜치 `master` (모노레포 통합 과정에서 중첩 `.git`은 제거됨)

## 디렉터리 트리

검증 기준: 루트, `apps/`, `packages/` 실제 리스팅 (node_modules 제외).

```
moyura/
├─ apps/
│  ├─ backend/          # @moyura/backend — NestJS 11
│  │  ├─ src/
│  │  │  ├─ config/     # @nestjs/config + Zod fail-fast env 검증
│  │  │  ├─ health/     # GET /health (PrismaService SELECT 1 프로브)
│  │  │  ├─ auth/       # no-op SupabaseAuthGuard seam (검증 로직 없음)
│  │  │  ├─ prisma/     # PrismaService (pg adapter, pingDatabase)
│  │  │  └─ generated/  # Prisma 7 source-emit 클라이언트 (gitignore, 재생성)
│  │  ├─ prisma/        # schema.prisma (prisma-client 제너레이터)
│  │  ├─ prisma.config.ts  # Prisma 7 연결 URL 위치
│  │  ├─ openapi.ts     # OpenAPI emit 스크립트
│  │  └─ openapi.json   # 커밋된 OpenAPI 계약 산출물
│  ├─ mobile/           # @moyura/mobile  — Expo RN 56 (App.tsx, index.ts, assets/)
│  │  ├─ lib/           # env.ts(가드), api.ts(api-client 소비)
│  │  └─ eas.json       # EAS local/prod 프로파일 스켈레톤
│  └─ web/              # @moyura/web     — Next.js 16 (app/, public/)
│     └─ lib/           # env.ts(가드), api.ts(api-client 소비)
├─ packages/
│  ├─ config/           # @moyura/config  — 공유 tsconfig base (현재 스텁)
│  └─ api-client/       # @moyura/api-client — openapi-typescript 타입 + fetch 클라이언트
├─ supabase/            # 로컬 Supabase CLI 스택 (config.toml, README.md, snippets/)
├─ docs/                # deploy-render.md (Render 배포 가이드)
├─ .github/workflows/   # ci.yml (install/build/lint/test/typecheck, migrate/deploy 없음)
├─ .moai/               # MoAI 설정·SPEC·프로젝트 문서
│  ├─ specs/SPEC-ENV-SETUP-001/
│  ├─ project/          # 본 문서 위치
│  └─ config/, brand/, db/ ...
├─ .nx/                 # Nx 캐시/데몬 작업 디렉터리
├─ nx.json              # Nx targetDefaults (build/lint/test/typecheck 캐시)
├─ pnpm-workspace.yaml  # 워크스페이스 글롭 + built-deps 정책
├─ pnpm-lock.yaml
├─ package.json         # 루트(private) — nx run-many 스크립트
├─ tsconfig.base.json   # 루트 공유 TS 컴파일러 옵션
├─ .npmrc               # node-linker=hoisted
├─ .mcp.json
└─ CLAUDE.md
```

> `packages/api-client/`는 **SPEC-ENV-SETUP-001(completed)에서 생성되어 디스크에 존재**한다(아래 표 참조). `apps/backend/src/generated/`와 `packages/api-client/src/schema.d.ts`는 gitignore되며 Nx 타겟으로 재생성된다.

## 워크스페이스 패키지 표

| 패키지 이름 | 경로 | 역할 | 스택 / 핵심 버전 | 상태 |
|-------------|------|------|------------------|------|
| `@moyura/mobile` | `apps/mobile` | 네이티브 앱 셸 (WebView 하이브리드 의도) | Expo `~56.0.6`, react `19.2.3`, react-native `0.85.3`, TypeScript `~6.0.3` | 스캐폴드 |
| `@moyura/web` | `apps/web` | 메인 UI 표면 (App Router) | Next.js `16.2.6`, react `19.2.4`, Tailwind v4, TypeScript `^5` | 스캐폴드 |
| `@moyura/backend` | `apps/backend` | 백엔드 REST API | NestJS `11`(`@nestjs/common ^11`), TypeScript `^5.7.3`, Jest | 스캐폴드 |
| `@moyura/config` | `packages/config` | 공유 tsconfig base 의도 | 현재 `package.json`만 존재(`version 0.0.0`, private) | 스텁(빈 패키지) |
| `@moyura/api-client` | `packages/api-client` | OpenAPI 생성 타입드 API 클라이언트 | `openapi-typescript 7.13.0` 타입(`src/schema.d.ts`, gitignore) + 얇은 fetch 래퍼(`createApiClient`, `getHealth`) | **구현됨** (SPEC-ENV-SETUP-001 completed) |

검증 메모:
- `@moyura/web`의 `version`은 `0.1.0`, 나머지 앱은 `1.0.0`(루트도 `1.0.0`).
- `@moyura/config`는 현재 `tsconfig` 파일을 포함하지 않은 스텁이다. "공유 tsconfig base" 역할은 의도이며, 실제 루트 공유 옵션은 `tsconfig.base.json`이 담당한다(현재 각 앱 tsconfig가 이를 참조하는지는 구현 시 정리 대상).

## Nx 타겟 / 캐시 개요

루트 스크립트(`package.json`)는 Nx로 위임한다:

| 루트 스크립트 | 명령 |
|---------------|------|
| `build` | `nx run-many -t build` |
| `lint` | `nx run-many -t lint` |
| `test` | `nx run-many -t test` |
| `typecheck` | `nx run-many -t typecheck` |
| `graph` | `nx graph` |

`nx.json` `targetDefaults` — 모두 `cache: true`:

| 타겟 | 캐시 입력(inputs) | 출력(outputs) |
|------|-------------------|----------------|
| `build` | `production`, `^production` | `{projectRoot}/dist`, `.next`, `build` |
| `lint` | `default` + eslint 설정 파일 | — |
| `test` | `default`, `^production` | — |
| `typecheck` | `default`, `^production` | — |

`sharedGlobals`: `tsconfig.base.json`, `pnpm-workspace.yaml` 변경 시 캐시 무효화.

프로젝트별 타겟(`project.json`, 모두 `nx:run-commands`로 앱 CLI 래핑):

| 프로젝트 | 정의된 타겟 |
|----------|-------------|
| `web` | `dev`, `build`(→`.next`), `start`, `lint`, `typecheck`(`tsc --noEmit`) |
| `mobile` | `start`, `android`, `ios`, `web`(Expo web), `typecheck`(`tsc --noEmit`) |
| `backend` | `prisma-generate`, `prisma-migrate`, `build`(→`dist`, `dependsOn: prisma-generate`), `openapi`(`dependsOn: build`), `typecheck`(`dependsOn: prisma-generate`), `start`, `start:dev`, `lint`, `test`(jest, `dependsOn: prisma-generate`) |
| `api-client` | `generate`(openapi.json → `openapi-typescript` 타입 생성), `build`(`dependsOn: generate`) |

> 인프라 타겟은 체인으로 연결된다: `backend:build` → `backend:openapi`(openapi.json emit) → `api-client:generate`(타입 재생성). 생성은 멱등이며 캐시된다(R-A1/R-A4/R-D4).
> Nx는 공식 플러그인(`@nx/next` 등)을 쓰지 않고 `nx:run-commands`로 각 앱의 네이티브 CLI(`next`, `expo`, `nest`, `prisma`)를 래핑한다. 자세한 내용은 [tech.md](./tech.md) 참조.

## RN 웹뷰 하이브리드 — 앱 간 관계

```
mobile (Expo 네이티브 셸)
   │  WebView 호스팅 (계획 — 현재 미배선)
   ▼
web (Next.js 메인 UI 표면)
   │
   ├─ web   ── HTTP REST ─┐
   └─ mobile ── HTTP REST ─┴──▶ backend (NestJS API) ──▶ PostgreSQL (Supabase, 구현됨 — Prisma 7 + pg adapter)
```

- `mobile shell → WebView → web surface → REST → backend` 가 의도된 데이터/제어 흐름.
- 두 프런트엔드(`web`, `mobile`)는 동일 backend API를 소비한다.
- **현 시점 검증**: WebView 통합 코드/의존성은 `apps/mobile`에 아직 없다(기본 Expo 스캐폴드). 하이브리드 배선은 향후 SPEC으로 구현된다.

## 모듈 경계 / 의존 방향

권장 의존 방향(단방향):

```
@moyura/api-client ────────────┐
  ▲ (openapi.json 계약 생성)     ├──▶ @moyura/web    ──┐
@moyura/backend ────────────────┤    @moyura/mobile  ─┴──▶ (런타임) @moyura/backend API
@moyura/config (공유 tsconfig) ─┘
```

- `@moyura/web`, `@moyura/mobile`은 `@moyura/api-client`를 워크스페이스 의존으로 **소비한다**(구현됨, R-A2). web은 `transpilePackages`, mobile은 직접 import.
- 계약 흐름: `@moyura/backend`가 OpenAPI(`openapi.json`)를 emit → `@moyura/api-client`가 그로부터 타입을 생성 → web/mobile이 api-client를 소비. 즉 **web/mobile → @moyura/api-client → (계약) backend openapi**.
- `@moyura/backend`는 프런트엔드 패키지에 의존하지 않는다(역방향 의존 금지). backend → api-client는 코드 의존이 아니라 openapi.json 계약 산출물 관계다.
- 프런트엔드 ↔ 백엔드의 **런타임** 결합은 컴파일 의존이 아니라 HTTP REST로만 이루어진다.
- `@moyura/config`는 빌드 타임 tsconfig 공유 용도이며 런타임 코드 의존이 아니다.
