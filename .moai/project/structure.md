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
│  │  │  ├─ auth/       # SupabaseAuthGuard(ES256 JWKS, jose) + TokenVerifierService + auth.config + @CurrentUser
│  │  │  ├─ profile/    # ProfileService(upsertBySub) + me.controller(GET /me 보호) + profile-response.dto
│  │  │  ├─ prisma/     # PrismaService (pg adapter, pingDatabase)
│  │  │  └─ generated/  # Prisma 7 source-emit 클라이언트 (gitignore, 재생성)
│  │  ├─ prisma/        # schema.prisma (Profile 모델) + migrations/20260602095934_init_profile (첫 도메인 마이그레이션)
│  │  ├─ prisma.config.ts  # Prisma 7 연결 URL 위치
│  │  ├─ openapi.ts     # OpenAPI emit 스크립트
│  │  └─ openapi.json   # 커밋된 OpenAPI 계약 산출물
│  ├─ mobile/           # @moyura/mobile  — Expo RN 56 (App.tsx, index.ts, assets/), app.json scheme "moyura"
│  │  ├─ components/    # WebViewShell.tsx(재사용 가능 WebView 셸), LoadingOverlay.tsx, WebViewErrorOverlay.tsx
│  │  ├─ hooks/         # useAppLifecycle.ts(Android 백/네비 이력), useAuthBridge.ts(OAuth 인터셉트 + 토큰 브리지 + 보안)
│  │  ├─ lib/           # env.ts(가드), api.ts(api-client 소비), auth/(oauth.ts·oauth-bridge.ts·bridge-protocol.ts·nonce-core.ts·token-store.ts·token-store-core.ts·auth-bridge-core.ts·app-lifecycle-core.ts + 보안/단위 테스트)
│  │  └─ eas.json       # EAS local/prod 프로파일 스켈레톤
│  └─ web/              # @moyura/web     — Next.js 16 (app/, public/)
│     ├─ lib/           # env.ts(가드), api.ts(api-client 소비), supabase/(browser·server 클라이언트, 세션 미들웨어), auth/(actions, callback), native-bridge/(bridge-client.ts·bridge-protocol.ts·NativeBridgeProvider.tsx·LogoutBridgeNotifier.tsx)
│     ├─ app/           # auth/callback/route.ts(PKCE 콜백), login/, me/
│     └─ proxy.ts       # @supabase/ssr updateSession + per-request CSP (Next 16 미들웨어 컨벤션)
├─ packages/
│  ├─ config/           # @moyura/config  — 공유 tsconfig base (현재 스텁)
│  └─ api-client/       # @moyura/api-client — openapi-typescript 타입 + fetch 클라이언트
├─ supabase/            # 로컬 Supabase CLI 스택 (config.toml — [auth.external.google|apple|kakao] enabled=false env() 스캐폴드, README.md, snippets/)
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
| `@moyura/mobile` | `apps/mobile` | 네이티브 앱 셸 — WebView 셸 + 토큰 기반 세션 브리지 구현됨 | Expo `~56.0.6`, react `19.2.3`, react-native `0.85.3`, TypeScript `~6.0.3`, `react-native-webview@13.16.1`, `expo-secure-store ~56.0.4`, `expo-splash-screen ~56.0.10` | **구현됨** (SPEC-MOBILE-001·SPEC-WEBVIEW-SHELL-001·SPEC-MOBILE-002 — 디바이스 검증 대기) |
| `@moyura/web` | `apps/web` | 메인 UI 표면 (App Router) | Next.js `16.2.6`, react `19.2.4`, Tailwind v4, TypeScript `^5` | 스캐폴드 |
| `@moyura/backend` | `apps/backend` | 백엔드 REST API | NestJS `11`(`@nestjs/common ^11`), TypeScript `^5.7.3`, Jest | 스캐폴드 |
| `@moyura/config` | `packages/config` | 공유 tsconfig base 의도 | 현재 `package.json`만 존재(`version 0.0.0`, private) | 스텁(빈 패키지) |
| `@moyura/api-client` | `packages/api-client` | OpenAPI 생성 타입드 API 클라이언트 | `openapi-typescript 7.13.0` 타입(`src/schema.d.ts`, gitignore) + 얇은 fetch 래퍼(`createApiClient`, `getHealth`, optional `getToken`→Bearer, `getMe`) | **구현됨** (SPEC-ENV-SETUP-001 + SPEC-AUTH-001) |

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
mobile (Expo 네이티브 셸 — WebViewShell + 훅 + 토큰 브리지, 구현됨)
   │  WebView 호스팅 (구현됨 — SPEC-MOBILE-001·SPEC-WEBVIEW-SHELL-001·SPEC-MOBILE-002)
   │  postMessage 토큰 브리지 (nonce 인증, versioned 스키마, specific targetOrigin)
   ▼
web (Next.js 메인 UI 표면 — @supabase/ssr 세션 권위, native-bridge 수신)
   │
   ├─ web   ── HTTP REST ─┐
   └─ mobile ── HTTP REST ─┴──▶ backend (NestJS API) ──▶ PostgreSQL (Supabase, 구현됨 — Prisma 7 + pg adapter)
```

- `mobile shell → WebView → web surface → REST → backend` 가 데이터/제어 흐름.
- 두 프런트엔드(`web`, `mobile`)는 동일 backend API를 소비한다.
- **현 시점 구현 상태 (SPEC-WEBVIEW-SHELL-001 + SPEC-MOBILE-002, 자동 게이트 통과 / 디바이스 종단 검증 대기)**:
  - `apps/mobile`: `App.tsx`가 `components/WebViewShell.tsx` + `LoadingOverlay.tsx` + `WebViewErrorOverlay.tsx` + `hooks/useAppLifecycle.ts` + `hooks/useAuthBridge.ts`를 합성(SPEC-WEBVIEW-SHELL-001, 행위 보존 추출).
  - 토큰 기반 느슨한 결합 세션: 웹(`apps/web`)이 세션 권위(`@supabase/ssr` + `supabase.auth.setSession()`); 네이티브는 access+refresh 토큰을 `expo-secure-store`에 캐시(`apps/mobile/lib/auth/token-store.ts`); 버전드 nonce 인증 postMessage 브리지(`apps/mobile/lib/auth/bridge-protocol.ts`); 콜드스타트 핸드셰이크 + resume 재검증 + 로그아웃 클리어(SPEC-MOBILE-002).
  - 보안: nonce 인증 + WebView origin 잠금(`originWhitelist` + `onShouldStartLoadWithRequest`) + specific targetOrigin + per-request CSP(`apps/web/proxy.ts` / `middleware.ts`).
  - CRITICAL/HIGH 보안 이슈 모두 closed(expert-security re-review PASS-WITH-FIXES). LOW follow-up 잔존: 모바일 nonce 폴백(N-2), prod HTTPS 강제(M-2).
  - 디바이스 종단 OAuth/핸드셰이크 검증(AC-V3) 대기 — 실기기/에뮬레이터 수동 검증 후 completed로 전환 예정.

## 인증 흐름 (SPEC-AUTH-001, 구현됨)

웹 레이어가 세션을 소유하고, 백엔드가 stateless JWT 검증자가 되는 단일 인증 surface:

```
웹/모바일(시스템 브라우저 OAuth or email/pw)
   │  @supabase/ssr 쿠키 세션 (proxy.ts updateSession, PKCE 콜백 app/auth/callback)
   ▼
Supabase 세션 access_token (ES256)
   │  @moyura/api-client getToken → Authorization: Bearer (토큰 URL/query 금지)
   ▼
NestJS SupabaseAuthGuard (jose createRemoteJWKSet, ES256 JWKS 검증, @UseGuards on /me)
   │  검증된 sub
   ▼
ProfileService.upsertBySub (Prisma Profile, id=sub PK, 멱등 UPSERT)
   │
   ▼
GET /me → 200 profile (id === sub) — 가드 + upsert 종단 증명
```

- 세션 소유 = 웹(`apps/web/lib/supabase` + `proxy.ts`). 소셜 OAuth는 시스템 브라우저(모바일 `lib/auth/oauth.ts`), email/pw는 webview 내 동작 + 로컬 종단 테스트 경로.
- 백엔드 가드는 `/me`에 per-route `@UseGuards`(global 아님) — `/health`·`GET /`는 public 유지.
- 소셜 provider 키·모바일 런타임 OAuth는 named follow-up(스캐폴드만). 상세: [`SPEC-AUTH-001/spec.md`](../specs/SPEC-AUTH-001/spec.md) Implementation Notes.

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
