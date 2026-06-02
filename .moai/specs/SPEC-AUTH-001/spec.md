---
id: SPEC-AUTH-001
version: 0.3.0
status: completed
created: 2026-06-02
updated: 2026-06-02
author: hatae
priority: high
issue_number: null
---

# SPEC-AUTH-001: moyura Supabase 인증 (webview 하이브리드)

## HISTORY

- 2026-06-02 (v0.3.0): implementation completed — M0~M9 authn; ES256 JWKS guard; profile + upsert; web @supabase/ssr + email/pw; social/mobile scaffold; evaluator-active PASS (security 0.97); follow-ups: social keys, mobile runtime OAuth, email-confirm/reset, frontend test targets, prod HTTPS. 상세는 아래 "## Implementation Notes" 참조.
- 2026-06-02 (M0 spike): 로컬 GoTrue JWT 모드 + claims 관찰 완료(deps `jose` 6.2.3 + `@supabase/supabase-js` 2.106.2 설치). **OD-1 확정 = 로컬 모드 ES256-JWKS**: `<127.0.0.1:54321>/auth/v1/.well-known/jwks.json`가 비대칭 키 노출(`keys`=[{`kty:EC`,`crv:P-256`,`alg:ES256`,`kid:b81269f1-21d8-4f2e-b719-c2240a840d90`}]), 실제 발급된 user access_token 헤더도 `alg:ES256`+동일 `kid`(정적 anon/service_role 키는 별개의 HS256 `supabase-demo` 데모키). 폴백 경로 `/auth/v1/jwks`는 404 — canonical은 `.well-known/jwks.json`. **OD-6 확정**: expected `iss` = `http://127.0.0.1:54321/auth/v1`(로컬 `jwt_issuer` 비어 있으므로 `<SUPABASE_URL>/auth/v1` 기본 issuer 관찰값), `aud` = `authenticated`(문자열), `sub` = Supabase user uuid. **M1 함의**: 로컬에서 ES256-JWKS 경로가 1차 테스트 가능 검증 경로다(HS256 폴백은 실제 HS256 토큰 전용으로 유지, prod은 ES256 JWKS — 로컬/prod 동일 경로). 가드는 `createRemoteJWKSet` + `jwtVerify({ algorithms:['ES256'], issuer:'http://127.0.0.1:54321/auth/v1', audience:'authenticated' })`로 로컬 종단 검증 가능.
- 2026-06-02 (v0.2.0): security audit-driven revision — plan-auditor(security-weighted)의 CONDITIONAL PASS 결과 적용. 3 BLOCKER (B-1 alg pinning/`alg:none` 거부, B-2 `iss`/`aud`/`exp` 검증 normative화, B-3 가드 적용점 명시) + 6 MAJOR (M-1 global 가드 public 누수 방지, M-2 Bearer 토큰 위생, M-3 JWKS-fail fail-closed 다운그레이드 금지, M-4 redirect allowlist host/scheme 정합, M-5 profile 키 단일화 + mass-assignment 차단, M-6 웹 PKCE 음성 경로). 신규: R-A8(alg:none/비허용 alg 거부), R-A9(토큰 위생), R-A10(가드 적용점), OD-6(iss/aud 출처), OD-7(per-route vs global+@Public). 콜백 host를 `localhost`→`127.0.0.1`로 정정(GoTrue exact-match allowlist + `site_url` host 일치).
- 2026-06-02 (v0.1.0): 최초 작성 (draft). 2라운드 사용자 인터뷰로 확정된 요구사항 기반. SPEC-ENV-SETUP-001이 남긴 Auth seam(no-op `SupabaseAuthGuard` + optional `SUPABASE_*` env placeholder)을 실제 인증으로 대체/확장한다. 범위 = 인증(authentication) ONLY. 핵심 결정: 웹 레이어가 세션 소유(`@supabase/ssr` 쿠키 세션 + PKCE 콜백), 소셜 OAuth는 시스템 브라우저(임베디드 webview 금지), RN은 웹앱을 WebView로 호스팅하며 세션 공유, 백엔드는 비대칭 ES256 JWKS로 JWT 검증(`jose`) + 레거시 HS256 폴백, 첫 Prisma 도메인 모델(`profile`) + 최초 인증 요청 시 UPSERT, 샘플 보호 라우트 `GET /me`. 버전(@supabase/ssr 0.10.3, @supabase/supabase-js 2.106.2, jose 6.2.3, expo-auth-session 56.0.13, expo-web-browser 56.0.5, expo-secure-store 56.0.4)은 npm registry로 검증(Sources 참조). 검증 불가한 버전 특이 동작은 "구현 시 검증(verify at implementation)"으로 표기.

---

## Background (배경)

`moyura`는 SPEC-ENV-SETUP-001(completed)에서 환경/인프라 배선이 완료된 pnpm + Nx 모노레포다. 세 앱이 동작 가능한 상태로 존재한다:

- `apps/backend` — NestJS 11. `@nestjs/config` + Zod 4.4.3 fail-fast env 검증, `GET /health`(`PrismaService.pingDatabase` `SELECT 1` 프로브), `CORS_ORIGINS` allowlist CORS, `@nestjs/swagger` OpenAPI(`/api` + `openapi.json` emit). Prisma 7.8.0(`prisma-client` source-emit cjs + `@prisma/adapter-pg`, URL은 `prisma.config.ts`). **도메인 모델 없음.**
- `apps/web` — Next.js 16.2.6 (React 19, App Router, Tailwind v4). `@moyura/api-client` 소비, `NEXT_PUBLIC_API_BASE_URL` in-app 가드.
- `apps/mobile` — Expo 56 (react-native 0.85.3, TypeScript ~6.0.3). `@moyura/api-client` 소비, `EXPO_PUBLIC_API_BASE_URL` 가드.
- `packages/api-client` (`@moyura/api-client`) — openapi-typescript 타입 + 얇은 fetch 클라이언트.

**대체되는 seam (이 SPEC이 실제 구현으로 채움):**

- `apps/backend/src/auth/supabase-auth.guard.ts` — 현재 `canActivate(): boolean { return true; }` no-op pass-through 가드. 이 SPEC이 실제 검증 가드로 대체한다.
- `apps/backend/src/config/env.validation.ts` Zod 스키마 — 현재 `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET`이 모두 `.optional()` placeholder. 이 SPEC이 인증에 필요한 변수로 승격/추가한다.
- `supabase/config.toml` — 로컬 GoTrue 포함 스택이 이미 존재. `[auth.external.apple]` 스캐폴드는 있으나 `[auth.external.google]`/`[auth.external.kakao]`는 미정의(이 SPEC이 추가).

**제품 컨텍스트 — webview 하이브리드 인증 제약 (핵심):**

`moyura`는 B2C 생산성/유틸리티 제품으로, **RN-WEBVIEW 하이브리드** 아키텍처를 채택한다. RN 앱이 Next 웹앱을 WebView로 호스팅하며, 웹이 주 surface다. 결과적으로 인증 surface는 사실상 **하나(웹앱)**이며, 브라우저와 RN webview 양쪽에서 소비된다. 이 제약이 인증 설계를 규정한다:

- 세션 소유권은 **웹 레이어**에 있다(`@supabase/ssr` 쿠키 세션 + PKCE 콜백 라우트).
- 소셜 OAuth(Google/Apple/Kakao)는 **시스템 브라우저**에서 열린다. Google을 비롯한 대부분의 IdP는 임베디드 webview 내 OAuth를 차단하므로, RN webview 안에서 직접 OAuth를 띄울 수 없다. OAuth는 시스템 브라우저로 위임되고 redirect/deep link로 앱에 복귀한다.
- email/password는 임베디드 webview 안에서도 동작 가능하며, 로컬 Supabase CLI GoTrue 스택 대상으로 완전 테스트 가능한 경로다.

```
┌────────────────────────────── 인증 surface = 웹앱 (Next + @supabase/ssr) ──────────────────────────────┐
│                                                                                                          │
│  email/pw ── 웹 폼 ──▶ GoTrue (signInWithPassword)                                                       │
│  social   ── 시스템 브라우저 OAuth (Google/Apple/Kakao) ──▶ PKCE 콜백 라우트(/auth/callback) ──▶ 쿠키세션 │
│                                                                                                          │
└──────────────────────┬──────────────────────────────────┬──────────────────────────────────────────────┘
       in-browser 소비   │              RN webview 호스팅 소비 │ (시스템 브라우저 OAuth → deep link 복귀)
                        ▼                                  ▼
                  데스크톱/모바일 웹                   apps/mobile (Expo WebView)
                        │                                  │
                        └──── 인증된 요청(쿠키/Bearer JWT) ─┴──▶ NestJS Guard (JWKS ES256 검증, jose)
                                                                      │
                                                            profile UPSERT (Prisma, sub 기준) ──▶ Postgres
                                                                      │
                                                              GET /me (보호 라우트)
```

Next 16 + `@supabase/ssr` 0.10.3, Expo 56 + deep link OAuth는 bleeding-edge 조합이므로, 버전 특이 동작은 추측하지 않고 Sources의 공식 문서로 검증한 사실만 사용한다.

## Goal (목표)

웹앱(`@supabase/ssr` 쿠키 세션)이 소유하는 단일 인증 surface를 구축하고, 그 세션이 발급한 Supabase JWT를 NestJS가 비대칭 ES256 JWKS로 검증하여, 인증된 사용자에 대해 app-owned `profile`을 최초 요청 시 자동 생성(UPSERT)하고, 샘플 보호 라우트 `GET /me`로 "가드 + profile upsert"가 end-to-end 동작함을 증명한다. email/password 흐름은 로컬 GoTrue 스택 대상으로 완전 동작하며, 소셜(Google/Apple/Kakao)은 흐름(flow) + 설정 스캐폴드만 구축하고 실제 provider 키는 연기한다.

### 확정 결정 표 (Decision Table)

| # | 영역 | 결정 |
|---|------|------|
| 1 | 인증 방식 (v1) | email/password(완전 동작) + Google/Apple/Kakao 소셜(flow + config 스캐폴드만, provider 키 연기). email/pw는 로컬 GoTrue 대상 테스트 가능 |
| 2 | 세션 소유권 | **웹 레이어**(Next + `@supabase/ssr`). 쿠키 세션 + PKCE 콜백 라우트. 소셜 OAuth는 **시스템 브라우저**(임베디드 webview 금지), redirect/deep link로 복귀 |
| 3 | 인증 surface | 사실상 하나(웹앱). 브라우저 + RN webview 양쪽에서 소비. RN 작업 = 시스템 브라우저 OAuth deep link 복귀 + webview-hosted 웹 인증 동작 보장(Expo deep linking) |
| 4 | 백엔드 JWT 검증 | 비대칭 ES256 **JWKS** 엔드포인트(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`)를 `jose`로 fetch+캐시, `kid`로 검증, per-request 라운드트립 없음, 키 회전 지원, **`algorithms` 화이트리스트 고정**(ES256/HS256 분리, alg-confusion·`alg:none` 거부 — B-1), **`iss`/`aud`/`exp` normative 검증**(B-2), **JWKS 실패 시 ES256 토큰 fail-closed**(HS256 다운그레이드 금지 — M-3). **레거시 HS256 `SUPABASE_JWT_SECRET` 폴백**은 실제 HS256 서명 토큰 전용. no-op `SupabaseAuthGuard` seam을 실제 가드로 대체하고 **명시 적용점**(per-route `@UseGuards` 또는 global+`@Public()` — OD-7)에 배선(B-3) |
| 5 | profile 모델 | app-owned Prisma `profile` 모델. Supabase auth user id(`sub`)를 키로/참조. 최소 필드(`id`, `createdAt`; 앱 필드 TBD). **이 프로젝트의 첫 Prisma 마이그레이션** |
| 6 | profile 동기화 | 백엔드 UPSERT-on-first-authenticated-request. 검증된 JWT 도착 + `sub`에 대한 profile row 부재 시 Nest가 UPSERT. **Supabase DB 트리거 미사용** |
| 7 | 보호 라우트 | 샘플 `GET /me` — 인증 사용자의 profile 반환. 가드 + upsert 종단 증명. `/health`는 public 유지 |
| 8 | 범위 | 인증(authentication) ONLY (아래 Non-Goals/Exclusions 참조) |
| 9 | 플랫폼 | web + mobile + backend |

## Non-Goals (범위 밖)

IN SCOPE (이 SPEC에서 구축):
- email/password 핵심 흐름: signup / login / logout / session-refresh (로컬 GoTrue 대상 동작)
- 소셜 OAuth flow + config 스캐폴드 (Google/Apple/Kakao) — provider 키는 env placeholder + `config.toml` `env()` 치환으로 연기
- 백엔드 JWKS ES256 검증 가드(`jose`) + 레거시 HS256 폴백 (no-op seam 대체)
- app-owned Prisma `profile` 모델 (첫 도메인 마이그레이션) + 최초 인증 요청 시 UPSERT
- 샘플 보호 라우트 `GET /me`
- 웹 `@supabase/ssr` 쿠키 세션 + PKCE 콜백 라우트
- 모바일 deep-link OAuth 복귀(시스템 브라우저) + webview-hosted 웹 인증 동작
- 로컬 GoTrue/`config.toml` 설정 + provider 스캐폴드
- 인증에 필요한 env 추가 + 인증 흐름을 위한 CORS

OUT OF SCOPE (named follow-ups — 이 SPEC에서 만들지 않음):
- RBAC / 인가(authorization) — 역할/권한 모델, 라우트별 권한 정책
- 이메일 확인(email confirmation) + 비밀번호 재설정(password reset) 흐름
- 실제 소셜 provider 키 발급/배선 (Google/Apple/Kakao 콘솔 등록 + 시크릿 주입)
- owner-level 접근 제어(소유자 단위 리소스 권한)
- 제품/도메인 기능 (실제 비즈니스 로직, `profile` 앱 필드 확정)
- RLS (Row Level Security) — 프런트는 DB에 직접 접근하지 않으며 Nest가 gatekeeper다
- 투기적 추상화(speculative abstraction) — 단순성 강제 (TRUST 5 Readable)

## Exclusions (What NOT to Build)

- **RBAC / 인가 로직** — 가드는 "인증되었는가(authenticated)"만 판정한다. "무엇을 할 수 있는가(authorized)"는 만들지 않는다.
- **이메일 확인 / 비밀번호 재설정 흐름** — GoTrue가 기능을 제공하더라도 이 SPEC에서는 UI/라우트/검증을 만들지 않는다(`config.toml`의 `enable_confirmations` 등은 기본값 유지).
- **실제 소셜 provider 키** — `config.toml`은 `enabled = false` + `env()` 치환 스캐폴드만, env는 placeholder만. 키 발급/배선은 named follow-up.
- **RLS 정책** — 프런트가 Supabase DB에 직접 쿼리하지 않으므로 RLS를 구성하지 않는다. 데이터 게이트는 NestJS다.
- **`profile`의 도메인 필드** — `id`/`createdAt` 외 앱 비즈니스 필드는 정의하지 않는다(제품 도메인 TBD).
- **Supabase DB 트리거 / Edge Function 기반 profile 생성** — 동기화는 백엔드 UPSERT로만 한다.
- **다중 세션/디바이스 관리, MFA, 패스키, 매직링크 UI** — `config.toml` 기본값 유지, 이 SPEC에서 surface하지 않는다.

---

## Requirements (EARS 형식)

각 요구사항은 영역별로 그룹화한다. EARS 키워드(The system shall / When / While / Where / If-then)는 영어로 유지한다. `system` = moyura 인증 surface + 백엔드 가드 전체를 가리킨다. 각 요구사항은 acceptance.md에 1:1 매핑되는 테스트 가능한 Acceptance Criteria를 가진다.

### A. Backend JWT Verification Guard (JWKS ES256 + 레거시 HS256 폴백)

- **R-A1 (Ubiquitous)**: The backend shall replace the no-op pass-through `SupabaseAuthGuard` with a real guard that rejects requests lacking a valid Supabase JWT.
- **R-A2 (Event-Driven, JWKS 경로)**: When a request carries a Supabase-issued JWT signed with an asymmetric key (ES256), the guard shall verify it against the JWKS fetched from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` using `jose`, selecting the public key by the token's `kid` header, **pinning `algorithms: ['ES256']`** on the verification call, without a per-request round-trip to the Auth server. 가드는 토큰 헤더의 `alg`를 신뢰하지 않고 검증기에 허용 알고리즘을 명시 고정한다.
- **R-A3 (State-Driven, fail-closed)**: While JWKS has been fetched, the guard shall reuse the cached key set across requests and refresh it on `kid` miss (key rotation) rather than caching indefinitely. **If the JWKS fetch fails (network/timeout/5xx) for an ES256-signed token, then the guard shall FAIL CLOSED — reject the request with HTTP 401 and shall NOT silently downgrade to the HS256 path.** JWKS fetch는 bounded timeout(권장 ~2s, verify at implementation)을 가지며, 실패 시 짧은 cooldown 후 재시도하되(thundering-herd 방지) 그 사이 ES256 토큰은 거부된다. 근거: Supabase는 JWKS의 장기 캐싱을 권장하지 않으며(키 회전 시 정당한 토큰 거부 위험 — Sources 참조), JWKS 불가 시 HS256 폴백으로 다운그레이드하면 공개키-as-HMAC 위조 공격면을 연다(M-3). `jose`의 `createRemoteJWKSet`이 캐시/회전/cooldown을 담당한다.
- **R-A4 (Event-Driven, 폴백 — HS256 전용)**: When a token is **actually signed with the legacy shared secret (HS256)** AND `SUPABASE_JWT_SECRET` is set, the guard shall verify it using `SUPABASE_JWT_SECRET` with **`algorithms: ['HS256']`** pinned. The HS256 path applies ONLY to tokens whose verified `alg` is `HS256`; an ES256 token shall NEVER be routed to or be verifiable via the HS256 (shared-secret) path. 근거: ES256 토큰을 HS256 검증기에 넣어 JWKS 공개키를 HMAC 키로 사용하는 alg-confusion 위조를 원천 차단한다(B-1).
- **R-A5 (Unwanted, If-then)**: If the token is missing, expired, malformed, or fails signature verification (neither the ES256/JWKS path nor the HS256/legacy path validates it), then the guard shall reject the request with HTTP 401 and shall not attach any user context.
- **R-A6 (Event-Driven)**: When verification succeeds, the guard shall extract the `sub` claim (the Supabase user id) and attach the authenticated user context (at minimum `sub`) to the request for downstream handlers.
- **R-A7 (Ubiquitous, normative claims 검증)**: On every request the guard shall verify the signature AND assert all of: (1) `exp` is not past AND `nbf`/`iat` are not in the future, within a bounded clock skew (권장 <= 60s, verify at implementation); (2) `iss` **exactly equals** the expected Supabase issuer; (3) `aud` **equals** the expected audience (`authenticated`). If any of these assertions fails, the guard shall reject the request with HTTP 401. The guard shall perform this verification locally and shall not call the Supabase Auth server on each request. expected `iss`/`aud` 출처는 OD-6 참조.
- **R-A8 (Unwanted, If-then — alg:none/비허용 alg)**: If a token's `alg` header is `none` or is not in the allowed algorithm set (`ES256` for the JWKS path, `HS256` for the legacy path), then the guard shall reject the request with HTTP 401 **before any signature-verification step**. 근거: `alg:none`/비허용 alg는 서명 검증을 우회하려는 전형적 공격이므로, 알고리즘 화이트리스트 거부가 서명 검사보다 먼저 일어나야 한다(B-1).
- **R-A9 (Ubiquitous, 토큰 위생)**: The system shall never place the JWT in a URL or query string (Bearer header only — see R-D4/OD-3), shall never log the `Authorization` header or any token/payload contents in logs, error messages, or APM traces, shall require HTTPS in production for any auth-bearing request, and shall ensure 401 responses do not echo token contents. 근거: 토큰이 URL/로그/APM에 누출되면 재사용 공격면이 생긴다(M-2).
- **R-A10 (Ubiquitous, 가드 적용점)**: The guard shall be wired to an explicit application point so that it actually enforces protection (현재 `SupabaseAuthGuard`는 정의 파일에서만 참조되고 어느 라우트에도 적용되어 있지 않음 — B-3). 적용 방식은 (a) 보호 라우트(`/me`)에 per-route `@UseGuards(SupabaseAuthGuard)`, 또는 (b) global `APP_GUARD` + `@Public()` opt-out 데코레이터 중 하나로 한다(OD-7). 어느 방식이든 `GET /health`와 `GET /`(`getHello`)는 명시적으로 public/excluded여야 한다(SPEC-ENV-SETUP-001의 public 계약 보존 — R-C3/M-1).

### B. Profile Model + UPSERT (첫 Prisma 도메인 마이그레이션)

- **R-B1 (Ubiquitous, 단일 키 해석)**: The backend shall define an app-owned Prisma `profile` model where **`id` is the primary key and equals the Supabase auth user id (`sub`)** (i.e. `id` stores the `sub` value, with a unique constraint), plus `createdAt`; additional app fields are out of scope (TBD). 단일 해석 확정: `sub` = `profile.id`(PK). 별도 `userId`/`sub` 컬럼을 추가로 두지 않는다(컬럼 모호성 제거 — M-5). UPSERT 키는 `id`(= `sub`)다.
- **R-B2 (Ubiquitous)**: The `profile` model shall be introduced via the project's first Prisma migration (SPEC-ENV-SETUP-001 left zero domain models), using `DIRECT_URL` for the migration per the established dual-URL pattern.
- **R-B3 (Event-Driven, mass-assignment 차단)**: When a request with a verified JWT arrives and no `profile` row exists for its `sub`, the backend shall UPSERT a `profile` row keyed on `id = sub` (no Supabase DB trigger). **The UPSERT key (`sub`) shall be sourced EXCLUSIVELY from the guard-attached, signature-verified `sub` (R-A6), never from the request body, query string, or any client-supplied header; no client-supplied field shall be mass-assigned into the `profile` row.** 근거: 클라이언트가 body/query로 보낸 `sub`/`id`를 신뢰하면 타 사용자 행 위조/탈취가 가능하다(M-5).
- **R-B4 (State-Driven)**: While a `profile` row already exists for the `sub` (`id = sub`), the backend shall reuse it without creating a duplicate (idempotent UPSERT keyed on `id`).
- **R-B5 (Unwanted, If-then)**: If two authenticated requests for the same new `sub` arrive concurrently, then the UPSERT shall not produce duplicate rows nor fail the request (rely on the `id` primary-key uniqueness + UPSERT semantics, not application-level locking).

### C. Protected Route `GET /me`

- **R-C1 (Event-Driven)**: When an authenticated client sends `GET /me`, the backend shall return the authenticated user's `profile` (after performing the upsert of R-B3 if needed).
- **R-C2 (Unwanted, If-then)**: If `GET /me` is called without a valid JWT, then the backend shall reject it with HTTP 401 (the guard from group A is actually applied to this route per R-A10).
- **R-C3 (Ubiquitous, public 계약 보존)**: `GET /health` and `GET /` (`getHello`) shall remain public. If the application point chosen in R-A10/OD-7 is global `APP_GUARD`, then `/health` and `GET /` MUST carry an explicit `@Public()` opt-out so they remain reachable without a token (preserving the SPEC-ENV-SETUP-001 public contract — M-1). Only `/me` (and future domain routes) are protected.
- **R-C4 (Ubiquitous)**: `GET /me` shall be the designated end-to-end proof artifact that the verification guard and profile upsert work together.

### D. Web Session — `@supabase/ssr` 쿠키 세션 + PKCE 콜백

- **R-D1 (Ubiquitous)**: The web app shall own the auth session using `@supabase/ssr`, with `createServerClient` (Server Components / Route Handlers / Server Actions) and `createBrowserClient` (Client Components), persisting the session in cookies.
- **R-D2 (Event-Driven)**: When a social OAuth flow returns with a valid authorization code (PKCE flow) and no error, the web app shall exchange it for a session in a server-side callback route handler via `exchangeCodeForSession(code)` and set the session cookies. The callback route host literal shall match `site_url`'s host (local = `http://127.0.0.1:3000/auth/callback`, NOT `localhost` — see R-H2/M-4).
- **R-D2a (Unwanted, If-then — PKCE 음성 경로)**: If the callback receives an `error`/`error_description` query param, OR a missing/invalid/empty `code`, OR a state/PKCE verifier mismatch (so `exchangeCodeForSession` fails), then the system shall NOT establish a session, shall not set session cookies, and shall surface a recoverable error to the user (redirect to an error/login state). 근거: 음성 경로를 무시하면 silent half-authenticated 상태/오류 은폐가 발생한다(M-6).
- **R-D3 (State-Driven)**: While a session cookie is present, the web app shall refresh the session as needed (middleware / `updateSession` pattern) so the JWT sent to the backend stays valid.
- **R-D4 (Event-Driven)**: When the web app calls the NestJS backend on behalf of an authenticated user, it shall present the Supabase JWT (Bearer token or forwarded cookie session) so the backend guard (group A) can verify it. (정확한 전달 메커니즘 — Bearer vs cookie forward — 은 Open Decision OD-3.)
- **R-D5 (Event-Driven)**: When the user logs out, the web app shall clear the Supabase session cookies (`signOut`) so subsequent backend calls are unauthenticated.

### E. Mobile Deep-Link OAuth (시스템 브라우저)

- **R-E1 (Ubiquitous)**: The mobile app shall host the web auth surface in a WebView and share the web session; it shall not implement a separate native login UI for email/password.
- **R-E2 (Event-Driven)**: When a social OAuth flow is initiated from the mobile context, the system shall open the provider authorization page in the **system browser** (not an embedded webview), because major IdPs (e.g. Google) block embedded-webview OAuth.
- **R-E3 (Event-Driven)**: When the system browser completes OAuth, the redirect shall return to the app via a registered deep link, and the resulting session shall be established in the web session that the WebView hosts. (Expo deep linking; exact redirect/session-establishment mechanism — `expo-web-browser` / `expo-auth-session` / WebView navigation — is verify at implementation, see OD-3.)
- **R-E4 (Unwanted, If-then)**: If the deep-link return does not produce a valid session (cancelled, mismatched redirect, expired code), then the app shall remain unauthenticated and surface a recoverable error (no crash, no silent half-authenticated state).

### F. Social Provider Scaffold (Google / Apple / Kakao — 키 연기)

- **R-F1 (Ubiquitous)**: The system shall scaffold `[auth.external.google]`, `[auth.external.apple]`, and `[auth.external.kakao]` blocks in `supabase/config.toml` with `enabled = false` and secrets referenced via environment substitution (`env(...)`), never committing real secrets. (`[auth.external.apple]` 블록은 이미 존재 — google/kakao 추가 + 일관 형태 정리.)
- **R-F2 (Where, Optional)**: Where a social login is invoked, the system shall call `signInWithOAuth` with the provider string `'google'`, `'apple'`, or `'kakao'` and a `redirectTo` pointing at the web PKCE callback route (R-D2).
- **R-F3 (Ubiquitous)**: The social flows shall be wired as flow + config scaffold only; the system shall not require real provider keys for this SPEC to be considered complete (keys are a named follow-up). The email/password path (group G) is the locally-testable proof path.
- **R-F4 (Ubiquitous)**: The redirect/callback URIs documented for each provider shall use the canonical Supabase callback format (`<SUPABASE_URL>/auth/v1/callback`; local `http://127.0.0.1:54321/auth/v1/callback`) so a later key-wiring follow-up needs no flow changes. (로컬 host 는 `site_url`/JWKS host 와 동일하게 `127.0.0.1` 로 통일 — M-4 정합, M6에서 `config.toml` 문서 주석으로 확정.)

### G. Email/Password Core Flows (로컬 GoTrue 동작)

- **R-G1 (Event-Driven)**: When a user submits valid signup credentials, the web app shall create the account via Supabase GoTrue (`signUp`) against the configured Supabase stack (local CLI stack for development).
- **R-G2 (Event-Driven)**: When a user submits valid login credentials, the web app shall establish a session via `signInWithPassword` and persist it per group D.
- **R-G3 (Event-Driven)**: When a user logs out, the session shall be terminated per R-D5.
- **R-G4 (State-Driven)**: While a session exists, the web app shall transparently refresh it (session-refresh) so the JWT presented to the backend remains valid (group D R-D3).
- **R-G5 (Ubiquitous)**: The email/password flow shall be fully exercisable against the local Supabase CLI GoTrue stack without any external provider keys (`[auth.email] enable_signup = true` is already set in `config.toml`).
- **R-G6 (Unwanted)**: The system shall not implement email-confirmation or password-reset flows in this SPEC (named follow-up).

### H. Local GoTrue / Config

- **R-H1 (Ubiquitous)**: The local Supabase CLI stack (already present from SPEC-ENV-SETUP-001) shall serve as the canonical GoTrue Auth backend for development; `supabase start` brings it up.
- **R-H2 (Ubiquitous, allowlist host/scheme 정합)**: The `supabase/config.toml` `[auth]` settings (`site_url`, `additional_redirect_urls`, `jwt_expiry`) shall include the web app's callback route in the redirect allowlist so PKCE callbacks succeed locally. GoTrue의 redirect allowlist는 **exact-match**이며 `localhost` ≠ `127.0.0.1`, scheme(`http`/`https`)도 정확히 일치해야 한다. 현재 로컬 `config.toml`은 `site_url = "http://127.0.0.1:3000"` + `additional_redirect_urls = ["https://127.0.0.1:3000"]`(https, 로컬 TLS 없음)로 콜백과 불일치한다. 따라서 **콜백 host 리터럴을 `site_url`의 host(`127.0.0.1`)와 일치**시키고, 정확한 로컬 콜백 `http://127.0.0.1:3000/auth/callback`을 `additional_redirect_urls`에 추가한다(http scheme). SPEC 전반의 콜백 참조도 `http://localhost:3000/auth/callback` → `http://127.0.0.1:3000/auth/callback`으로 정정한다(M-4).
- **R-H3 (State-Driven)**: While running locally, the backend's JWKS source shall point at the local Supabase Auth URL; the local stack may serve the legacy HS256 secret and/or asymmetric keys — the guard's JWKS-primary + HS256-fallback design (group A) shall work against whichever the local stack provides. 참고: 로컬 GoTrue가 비대칭 키를 노출하지 않으면 HS256 폴백 경로가 로컬 테스트 경로가 된다(verify at implementation, OD-1).

### I. Environment Additions (인증)

- **R-I1 (Ubiquitous)**: The backend Zod env schema shall promote `SUPABASE_URL` and `SUPABASE_ANON_KEY` from optional seam placeholders to variables required for the auth runtime, and shall keep `SUPABASE_JWT_SECRET` (legacy/fallback).
- **R-I2 (Ubiquitous)**: The backend shall obtain the JWKS URL either from an explicit env var or by deriving it from `SUPABASE_URL` (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`); the chosen approach is OD-2.
- **R-I3 (Unwanted, If-then)**: If a required auth env var is missing or fails Zod validation at bootstrap, then the backend shall fail fast (consistent with SPEC-ENV-SETUP-001 R-B2), with no partial boot.
- **R-I4 (Ubiquitous)**: The web and mobile apps shall read public Supabase config (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) via their framework-standard public env mechanisms (`NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`), and provider secrets shall live only in `config.toml` `env(...)` substitution / server env (never `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`).

### J. CORS for Auth

- **R-J1 (Event-Driven)**: When the web app (and the RN webview-hosted web origin) calls the backend with credentials for auth-bearing requests, the CORS allowlist (`CORS_ORIGINS`, established in SPEC-ENV-SETUP-001) shall include those origins.
- **R-J2 (State-Driven)**: While cookie-forwarded sessions are used (if OD-3 selects cookie forwarding), the CORS config shall allow credentials (`Access-Control-Allow-Credentials`) for allowlisted origins only, never with a wildcard origin.
- **R-J3 (Unwanted, If-then)**: If a request originates from an origin not in the allowlist, then the backend shall not emit a permissive `Access-Control-Allow-Origin: *` (consistent with SPEC-ENV-SETUP-001 R-F3).

---

## Environment Variable Matrix

| Variable | Scope | local value source | prod value source | required? |
|----------|-------|--------------------|-------------------|-----------|
| `SUPABASE_URL` | backend (+ public) | `supabase start` 출력 API URL (예: `http://localhost:54321`) | Supabase 프로젝트 URL | **yes** (auth runtime — seam에서 승격, R-I1) |
| `SUPABASE_ANON_KEY` | backend (+ public) | `supabase start` 출력 anon key | Supabase anon key | **yes** (auth runtime — seam에서 승격, R-I1) |
| `SUPABASE_JWT_SECRET` | backend | `supabase start` 출력 JWT secret | Supabase JWT secret (legacy) | no — 레거시 HS256 폴백 전용(R-A4). JWKS-primary 운영 시 미설정 가능 |
| `SUPABASE_JWKS_URL` (OD-2) | backend | `SUPABASE_URL`에서 파생 또는 명시 (`<URL>/auth/v1/.well-known/jwks.json`) | 동일 | no — 미설정 시 `SUPABASE_URL`에서 파생(R-I2) |
| `NEXT_PUBLIC_SUPABASE_URL` | web | `.env.local` = `supabase start` API URL | Next prod env | yes (웹 `@supabase/ssr` 클라이언트) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | `.env.local` = anon key | Next prod env | yes (웹 `@supabase/ssr` 클라이언트) |
| `EXPO_PUBLIC_SUPABASE_URL` | mobile | `.env` / app config = API URL | EAS profile env | yes (모바일 OAuth 진입 시) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile | `.env` / app config = anon key | EAS profile env | yes (모바일 OAuth 진입 시) |
| 웹 콜백 URL (예: `<web-origin>/auth/callback`) | web (config) | `http://127.0.0.1:3000/auth/callback` (host = `site_url` host `127.0.0.1`, http scheme; config.toml `additional_redirect_urls`에 추가 + signInWithOAuth `redirectTo`). `localhost`/`https` 사용 금지 — GoTrue exact-match (M-4) | prod web origin + `/auth/callback` | yes (config 값, R-D2/R-D2a/R-H2) |
| 모바일 deep-link redirect (예: `moyura://auth-callback`) | mobile (config) | app scheme deep link (config.toml `additional_redirect_urls`) | 동일 | yes (config 값, R-E3) — 정확한 scheme verify at implementation |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | backend/config (seam) | 미설정 (placeholder) | provider 키 발급 후 주입 | no — provider 키 연기(R-F1/F3) |
| `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` | backend/config (seam) | 미설정 (placeholder, config.toml 기존 `env()` 참조) | provider 키 발급 후 주입 | no — provider 키 연기 |
| `SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET` | backend/config (seam) | 미설정 (placeholder) | provider 키 발급 후 주입 | no — provider 키 연기 |

참고: 모든 `.env*`는 `.gitignore` 추적 제외(루트 규칙 기존). provider 시크릿은 절대 `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`로 노출하지 않는다(R-I4). 기존 SPEC-ENV-SETUP-001의 `DATABASE_URL`/`DIRECT_URL`/`PORT`/`NODE_ENV`/`CORS_ORIGINS` + 프런트 base URL은 그대로 유지된다.

---

## Open Decisions (권장 기본값 포함)

### OD-1. JWKS-primary vs 레거시 HS256 secret 롤아웃 전략

- **배경(검증됨)**: Supabase는 비대칭 ES256 + JWKS를 권장하며 로컬 검증이 빠르다. 레거시 HS256 공유 시크릿은 backward-compat로 남아 있으나 "더 이상 권장되지 않음". 신규 Supabase 프로젝트는 비대칭 키가 기본일 수 있으나, **로컬 CLI 스택이 비대칭 키를 노출하는지는 버전 의존적**이다(verify at implementation).
- **선택지 A — JWKS primary + HS256 fallback 동시 지원 (권장)**: 가드가 토큰 `alg`/`kid`로 경로를 선택. JWKS 검증 우선, HS256 시크릿이 설정되어 있으면 폴백. 로컬이 비대칭 키를 내주면 JWKS 경로, HS256만 내주면 폴백 경로로 자연스럽게 동작.
- **선택지 B — 환경별 하드 스위치(로컬=HS256, prod=JWKS)**: 단순하나 로컬/prod 코드 경로가 갈려 회귀 위험.
- **권장: 선택지 A**. 근거: 가드 한 곳에서 두 경로를 모두 지원하면 로컬(스택이 무엇을 내주든)·prod(비대칭)·키 회전·점진 마이그레이션을 코드 변경 없이 흡수한다. 브리프의 확정 결정 4와 일치. M1 첫 스파이크에서 로컬 GoTrue가 `/auth/v1/.well-known/jwks.json`을 내주는지 검증하고, 결과를 HISTORY에 기록한다.

### OD-2. JWKS URL: 명시 env vs `SUPABASE_URL`에서 파생

- **선택지 A — `SUPABASE_URL`에서 파생 (권장)**: `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`을 코드에서 조립. env 표면 최소화, 단일 진실 공급원(`SUPABASE_URL`).
- **선택지 B — 별도 `SUPABASE_JWKS_URL` env**: self-host/프록시/커스텀 issuer 시 유연하나 변수 추가 + 불일치 위험.
- **권장: 선택지 A** (파생). 셀프호스트/커스텀 issuer가 필요해질 때만 B로 승격. R-I2가 양쪽을 허용하되 기본은 파생.

### OD-3. 백엔드로의 JWT 전달 메커니즘: Bearer 헤더 vs 쿠키 포워딩

- **선택지 A — Bearer Authorization 헤더 (권장)**: 웹/webview에서 백엔드 호출 시 `Authorization: Bearer <access_token>`로 명시 전달. CORS-credentials 불필요, 가드 구현 단순(헤더에서 토큰 추출), `@moyura/api-client`에 토큰 주입 훅만 추가.
- **선택지 B — 쿠키 세션 포워딩**: 브라우저가 자동으로 쿠키 전송. CORS `credentials: true` + 도메인/SameSite 설정 필요, webview/크로스도메인에서 취약, RN webview에서 쿠키 공유 복잡.
- **권장: 선택지 A** (Bearer 헤더). 근거: webview 하이브리드 + 크로스오리진(웹앱 origin ≠ 백엔드 origin) 환경에서 Bearer가 SameSite/도메인 함정을 회피하고, 가드(group A)가 헤더에서 토큰만 뽑으면 되어 가장 단순하다(TRUST 5 Readable). R-D4/R-J2가 이 결정에 종속.

### OD-4. 모바일 세션 저장소: `expo-secure-store` vs AsyncStorage

- **배경**: webview 하이브리드에서 세션 소유는 웹(쿠키)이므로 모바일 네이티브 토큰 저장은 OAuth deep-link 복귀 처리에 한정될 수 있다. 그럼에도 네이티브 측이 토큰/세션 조각을 보관해야 하는 경로가 생기면 저장소가 필요하다.
- **선택지 A — `expo-secure-store` (권장, 56.0.4 검증됨)**: OS 키체인/키스토어 기반 암호화 저장. 토큰 같은 민감정보에 적합.
- **선택지 B — AsyncStorage (`@react-native-async-storage/async-storage`, 3.1.1)**: Supabase RN 퀵스타트 기본. 평문 저장이라 민감 토큰엔 부적합.
- **권장: 선택지 A** (`expo-secure-store`) — 네이티브 측 토큰 보관이 필요한 경로에 한해. 단, webview가 웹 쿠키 세션을 공유하면 네이티브 저장 자체가 불필요할 수 있다 — M5 스파이크에서 "네이티브 토큰 보관이 실제로 필요한가"를 먼저 검증(불필요하면 저장소 미도입이 가장 단순).

### OD-5. PKCE 콜백 라우트 형태

- **선택지 A — `/auth/callback` Route Handler (권장)**: Next App Router의 `app/auth/callback/route.ts`에서 `?code=`를 받아 `exchangeCodeForSession(code)` 후 앱으로 redirect. Supabase SSR 표준 패턴.
- **선택지 B — Server Action 기반**: 가능하나 OAuth redirect 진입점은 GET 라우트가 자연스럽다.
- **권장: 선택지 A** (`app/auth/callback/route.ts`). 라우트 경로/host는 `config.toml` redirect allowlist(`site_url` host = `127.0.0.1`, M-4) + `signInWithOAuth` `redirectTo`와 정확히 일치해야 한다(R-D2/R-D2a/R-F2/R-H2). 로컬 콜백 = `http://127.0.0.1:3000/auth/callback`. 정확한 핸들러 시그니처는 `@supabase/ssr` 0.10.3 기준 구현 시 검증.

### OD-6. expected `iss`/`aud` 출처 (R-A7 normative 검증값)

- **배경**: R-A7은 `iss`가 expected Supabase issuer와 정확히 일치하고 `aud` = `authenticated`임을 단언한다. expected 값의 출처가 명확해야 검증이 결정적이다. 현재 로컬 `config.toml`의 `jwt_issuer`는 비어 있음(주석 처리, `# jwt_issuer = ""`) → 기본값은 `auth.external_url`/`SUPABASE_URL` 기반 issuer가 된다.
- **선택지 A — `SUPABASE_URL`에서 expected issuer 파생 + `aud` 상수 `authenticated` (권장)**: issuer = `<SUPABASE_URL>/auth/v1`(또는 GoTrue가 발급하는 정확한 iss — M0 스파이크에서 실제 토큰 `iss` 관찰로 확정), `aud` = `authenticated` 고정. env 표면 최소.
- **선택지 B — expected `iss`/`aud`를 명시 env로 주입**: 셀프호스트/커스텀 issuer에 유연하나 변수 추가 + 불일치 위험.
- **권장: 선택지 A**. M0 스파이크에서 로컬 GoTrue가 발급한 실제 토큰의 `iss`/`aud`를 관찰해 expected 값을 확정하고 HISTORY에 기록한다(현재 로컬 `jwt_issuer`가 비어 있으므로 기본 issuer 형태를 반드시 관찰). 커스텀 issuer가 필요해질 때만 B로 승격.

### OD-7. 가드 적용점: per-route `@UseGuards` vs global `APP_GUARD` + `@Public()` (R-A10)

- **배경**: 현재 `SupabaseAuthGuard`는 정의 파일에서만 참조되고 어느 라우트에도 적용되어 있지 않다(B-3). 적용점을 명시 결정해야 한다.
- **선택지 A — per-route `@UseGuards(SupabaseAuthGuard)` (권장)**: 보호 라우트(`/me`)에만 명시 부착. `/health`/`GET /`는 데코레이터를 달지 않으므로 자연히 public — opt-out 누락에 의한 누수 위험이 구조적으로 없다(fail-safe). 보호 대상이 소수(현재 `/me` 하나)인 인증-only 범위에 가장 단순(TRUST 5 Readable).
- **선택지 B — global `APP_GUARD` + `@Public()` opt-out**: 신규 라우트가 기본 보호되어 누락 시 fail-closed라는 장점이 있으나, `/health`/`GET /`에 `@Public()`를 빠뜨리면 기존 public 계약이 깨진다(M-1 리스크). `@Public()` 데코레이터 + 가드의 reflector 처리 추가 구현 필요.
- **권장: 선택지 A** (per-route `@UseGuards`). 근거: 보호 라우트가 1개뿐이고, public 누수 리스크(M-1)를 구조적으로 회피하며, 데코레이터/reflector 보일러플레이트가 없다. 도메인 라우트가 다수가 되어 "기본 보호"가 안전상 필요해지면 B(global + `@Public()`)로 승격하고, 그때 `/health`/`GET /` `@Public()` opt-out + 경계 테스트(AC-C3)를 의무화한다. 어느 선택이든 R-C3/M-1대로 `/health`/`GET /`는 public을 유지한다.

---

## Risks & Mitigations

| # | 리스크 | 완화 |
|---|--------|------|
| K1 | 임베디드 webview OAuth 차단 — Google 등 IdP가 RN webview 내 OAuth를 거부 | 소셜 OAuth는 **시스템 브라우저**로 위임(R-E2) + deep link 복귀(R-E3). email/pw는 webview 내 동작 가능 + 로컬 테스트 경로(R-G5) |
| K2 | Supabase JWT 마이그레이션 상태 불확실 — 로컬/prod이 비대칭 키를 내주는지 버전 의존 | 가드를 JWKS-primary + HS256-fallback로 설계(OD-1, group A). M1 스파이크에서 로컬이 `/auth/v1/.well-known/jwks.json`을 내주는지 검증, 결과 HISTORY 기록 |
| K3 | 로컬에서 소셜 동작에 실제 키 필요 → 로컬 검증 막힘 | email/pw를 로컬 테스트 가능 경로로 확정(R-G5/F3). 소셜은 flow+config 스캐폴드만, 키 연기. 종단 증명(`/me`)은 email/pw 세션으로 수행 |
| K4 | `@supabase/ssr` 0.10.3 + Next 16 / Expo 56 deep link bleeding-edge — API 형태가 문서와 다를 수 있음 | 버전 특이 동작 추측 금지, 구현 시 Context7/공식 문서 재검증. 콜백 라우트/redirect/세션 확립 정확 시그니처는 verify at implementation(OD-5/R-E3) |
| K5 | 첫 Prisma 도메인 마이그레이션 도입 — 마이그레이션 워크플로/`prisma.config.ts` 듀얼 URL 첫 실사용 | 마이그레이션은 `DIRECT_URL`로만 수행(SPEC-ENV-SETUP-001 R-B5 재사용, R-B2). `profile`은 최소 필드만(투기적 컬럼 금지) |
| K6 | profile upsert 경쟁(race) — 동일 신규 `sub` 동시 요청 시 중복 row/실패 | `id`(= `sub`) PK 유일성 + Prisma `upsert`(원자적) 사용, 애플리케이션 락 미사용(R-B4/B5) |
| K7 | JWKS 장기 캐싱으로 키 회전 시 정당 토큰 거부 | `jose` `createRemoteJWKSet`의 캐시+`kid`-miss 갱신에 위임(R-A3), 무기한 캐시 금지 |
| K8 | 토큰 전달 메커니즘 혼선(쿠키 vs Bearer)로 CORS/SameSite 함정 | Bearer 헤더 권장(OD-3)으로 credentials/SameSite 회피. 쿠키 포워딩 선택 시에만 R-J2 credentials 설정 적용. 토큰은 URL/query 금지(R-A9) |
| K9 | seam 대체 시 회귀 — no-op 가드를 실제 가드로 바꾸며 `/health`/`GET /` 등 public 라우트 보호 누수 | `/health`/`GET /`는 명시적으로 public 유지(R-C3/M-1). per-route `@UseGuards` 권장(OD-7)으로 누수 구조적 회피, global 선택 시 `@Public()` opt-out 의무, 단위/e2e로 public/protected 경계 검증(AC-C3) |
| K10 | 인증 범위가 RBAC/email-confirm/reset로 번질 위험(scope creep) | Exclusions로 명시 차단. 가드는 authenticated 여부만 판정(인가 아님), email-confirm/reset는 named follow-up |
| K11 | alg-confusion / `alg:none` — JWKS 공개키를 HMAC 키로 사용한 위조, 서명 우회 (B-1) | 검증기에 `algorithms` 화이트리스트 고정(ES256 JWKS / HS256 legacy 분리, 교차 금지, R-A2/A4), `alg:none`·비허용 alg는 서명 검사 전 401 거부(R-A8) |
| K12 | `iss`/`aud`/`exp` 미검증 — 타 프로젝트/타 audience 토큰 수용 (B-2) | 매 요청 서명 + `exp`/`nbf`/`iat`(clock skew) + `iss` 정확 일치 + `aud=authenticated` normative 단언, 실패 시 401(R-A7). expected 값 출처 OD-6, M0에서 실제 토큰 관찰 |
| K13 | 가드 미배선 — `SupabaseAuthGuard`가 정의만 되고 어디에도 적용 안 됨 → 보호 라우트가 실제로 무방비 (B-3) | 명시 적용점 의무화(R-A10/OD-7), `/me`에 가드 실제 적용, AC-C2(미인증 401 실제 강제)로 검증 |
| K14 | JWKS fetch 실패 시 HS256 다운그레이드 → 공개키-as-HMAC 위조면 개방 (M-3) | ES256 토큰은 JWKS 실패 시 fail-closed(401), HS256 폴백은 실제 HS256 토큰 + 시크릿 설정 시에만(R-A3/A4). JWKS bounded timeout + cooldown |
| K15 | redirect allowlist host/scheme 불일치 — `localhost`≠`127.0.0.1`, https/http 불일치로 PKCE 콜백 거부 또는 오설정 (M-4) | 콜백 host를 `site_url` host(`127.0.0.1`)와 일치, `http://127.0.0.1:3000/auth/callback`를 `additional_redirect_urls`에 추가(R-H2), SPEC 전반 콜백 참조 정정 |
| K16 | profile mass-assignment — 클라이언트가 body/query로 `sub`/`id` 주입해 타 사용자 행 위조 (M-5) | UPSERT 키는 가드가 부착한 검증된 `sub`만 사용, client-supplied 필드 mass-assign 금지(R-B3), AC-B6로 검증 |
| K17 | 웹 PKCE 음성 경로 미처리 — error param/invalid code에도 세션 확립 시도 → silent half-auth (M-6) | error/invalid code/state mismatch 시 세션 미확립 + 복구 가능 에러(R-D2a), 음성 AC(AC-D6/D7) |

---

## Sources (실제 사용한 URL)

- Supabase 비대칭 JWT signing keys + JWKS(ES256, zero-downtime 키 회전, 레거시 HS256 backward-compat): https://supabase.com/docs/guides/auth/signing-keys — JWKS 발견 엔드포인트가 `<project>/auth/v1/.well-known/jwks.json`임을 확인(브리프의 `/auth/v1/jwks`를 canonical 경로로 정정). 비대칭 검증은 Auth 서버 라운드트립 불요, 레거시 HS256은 추출만 가능하며 비권장.
- Supabase JWTs — `sub` claim = 사용자 고유 ID, 백엔드 검증 권장, JWKS 장기 캐싱 비권장: https://supabase.com/docs/guides/auth/jwts — `sub`("subject") = the unique ID of the user 확인 → profile 키 결정(R-B1) 근거. JWKS 장기 캐싱 시 키 회전 문제 경고(R-A3 근거).
- JWT 서명 키 블로그(설계 배경): https://supabase.com/blog/jwt-signing-keys
- Supabase Server-Side Auth (Next.js, `@supabase/ssr`) — `createServerClient`/`createBrowserClient`, 쿠키 핸들링, PKCE `exchangeCodeForSession(code)`: https://supabase.com/docs/guides/auth/server-side/nextjs — 함수명/PKCE 코드 교환 확인. `getClaims()`로 보호하고 server 코드에서 `getSession()` 신뢰 금지 권고.
- Next.js + Supabase 퀵스타트(쿠키 기반 Auth 컨텍스트): https://supabase.com/docs/guides/auth/quickstarts/nextjs
- Supabase Kakao provider(`signInWithOAuth` provider `'kakao'`, redirect URI 형식, SSR PKCE 코드 교환): https://supabase.com/docs/guides/auth/social-login/auth-kakao — provider 문자열/메서드/콜백 URI(`<URL>/auth/v1/callback`, 로컬 `http://localhost:54321/auth/v1/callback`) 확인.
- Expo/React Native Supabase auth + deep linking(네이티브 OAuth/세션 저장): https://supabase.com/docs/guides/auth/quickstarts/react-native , https://docs.expo.dev/guides/using-supabase/ — RN 의존성(`@supabase/supabase-js`, AsyncStorage) 확인. deep link/`expo-web-browser`/`expo-auth-session` 구체 구현은 페이지 fetch로 추출 불가 → verify at implementation.
- 라이브러리 버전(npm registry 검증, 2026-06-02): `@supabase/ssr` 0.10.3, `@supabase/supabase-js` 2.106.2, `jose` 6.2.3(`createRemoteJWKSet`/`jwtVerify` 제공), `expo-auth-session` 56.0.13, `expo-web-browser` 56.0.5, `expo-secure-store` 56.0.4, `@react-native-async-storage/async-storage` 3.1.1.

검증 불가(구현 시 검증): (1) 로컬 Supabase CLI 스택이 `/auth/v1/.well-known/jwks.json`(비대칭 키)을 노출하는지(OD-1, M1 스파이크), (2) Expo 56 deep-link OAuth의 정확한 redirect/세션 확립 시그니처(`expo-web-browser`/`expo-auth-session`/WebView 네비게이션, R-E3/OD-4), (3) `@supabase/ssr` 0.10.3 콜백 핸들러 정확 시그니처(OD-5), (4) 모바일 app scheme deep-link 정확 형태.

---

## Implementation Notes (v0.3.0, 2026-06-02)

이 SPEC의 인증(authn-only) 범위가 `master`에 **구현 완료 + 품질 게이트 통과 + 독립 평가 PASS**되었다(커밋 `6ca29fd`, `87e74ea`, `841f35e`, `d54adb0`). 아래는 실제 구현 사실, AC 충족/연기 매핑, 평가 결과 요약이다.

### 품질/평가 결과

- **품질 게이트**: run-many 4개 프로젝트 전부 green. 백엔드 보안 테스트 53건. statement 커버리지 95.71%.
- **독립 평가(evaluator-active) = PASS**: Functionality 0.95, **Security 0.97**(HARD gate 통과 — 14개 적대적 공격 토큰 전부 차단), Craft 0.78, Consistency 0.93. 평가 리포트: `.moai/specs/SPEC-AUTH-001/evaluation.md`.

### 실제 구현 사실 (디스크 검증)

- **M0 스파이크**: 로컬 GoTrue = ES256-JWKS(local==prod 경로). `iss = http://127.0.0.1:54321/auth/v1`, `aud = authenticated`. OD-1/OD-6 확정(HISTORY 기재).
- **백엔드(NestJS)**: `SupabaseAuthGuard`(jose `createRemoteJWKSet` + `jwtVerify`, ES256 algorithms 고정, `alg:none`/alg-confusion은 서명 검증 전 거부, `iss`/`aud`/`exp`/`nbf` normative, HS256-only 토큰 전용 레거시 폴백, JWKS 실패 시 fail-closed 무다운그레이드, 토큰 위생). 가드는 **`/me`에 per-route `@UseGuards`**(global 아님). 부속: `TokenVerifierService`, `auth.config.ts`, `@CurrentUser()`. Prisma `Profile` 모델(`id = sub` PK, `createdAt`) — **첫 도메인 마이그레이션** `20260602095934_init_profile`. `ProfileService.upsertBySub`(검증된 sub만, mass-assignment 없음). `GET /me` 보호 / `/health` + `GET /` public. 필수 env `SUPABASE_URL`/`SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`는 레거시 폴백.
- **웹(Next 16)**: `@supabase/ssr` 0.10.3 + supabase-js 2.106.2. browser/server 클라이언트(`lib/supabase/`), `proxy.ts`의 updateSession(Next 16 미들웨어 컨벤션), `app/auth/callback/route.ts`(PKCE + 음성 경로 가드), `lib/auth/actions.ts`(signup/login/logout/OAuth 진입), `app/login` + `app/me`. `NEXT_PUBLIC_SUPABASE_*` env. `@moyura/api-client`에 optional `getToken`→Bearer(+`getMe`) 추가. LIVE e2e 검증: 웹 세션 ES256 토큰 → `GET /me` → 200 profile(`id === sub`).
- **소셜/모바일 스캐폴드**: `supabase/config.toml` `[auth.external.google|kakao]`(+ apple 정규화) — `enabled = false`, `env()` 시크릿(평문 키 없음). `additional_redirect_urls = http://127.0.0.1:3000/auth/callback + moyura://auth-callback`. `apps/mobile`: app.json scheme `"moyura"`, `lib/auth/oauth.ts`(시스템 브라우저 OAuth 헬퍼), `EXPO_PUBLIC_SUPABASE_*` env. OD-4: 네이티브 토큰 저장소 미도입(webview가 웹 세션 공유). expo-web-browser/auth-session/linking 추가.

### AC 충족 vs 연기

- **충족(구현 + 검증)**: A 그룹 가드 전체(R-A1~A10), B 그룹 profile + UPSERT(R-B1~B5), C 그룹 `GET /me` + public 계약(R-C1~C4), D 그룹 웹 세션 + PKCE 콜백 + 음성 경로(R-D1~D5), F 그룹 소셜 config 스캐폴드(R-F1~F4 — 코드/설정), G 그룹 email/pw(R-G1~G5), H/I/J(로컬 GoTrue/env/CORS). email/pw 경로는 LIVE e2e로 종단 증명됨.
- **설계상 연기(named follow-up — gap 아님)**: 실제 소셜 provider 키(R-F3), 모바일 런타임 OAuth 라운드트립(디바이스/시뮬레이터 필요 — 코드+config 스캐폴드만, R-E2~E4의 런타임 검증), 이메일 확인 + 비밀번호 재설정(R-G6), RBAC/인가, prod HTTPS 강제(평가 MINOR). 모두 Exclusions/Non-Goals에 명시된 의도적 연기.

### Evaluator MAJOR follow-up (문서화된 후속 과제)

- **프런트 자동 테스트 타겟 부재**: web/mobile/api-client에 자동화된 테스트 타겟이 없다. 테스트 가능한 순수 함수들(`resolveCallbackOutcome` PKCE 음성 경로, `resolveSupabaseConfig`, api-client Bearer 주입, `launchSocialOAuth` 분류)이 회귀 보호되지 않는다 — 빌드 시점 node sanity로만 검증되었고 자동화 테스트는 아니다. 별도 후속 SPEC/작업으로 프런트 테스트 타겟을 도입할 것(평가 MAJOR).
- 그 외 beyond-plan 실질 차이 없음: `proxy.ts`는 Next 16의 올바른 미들웨어 컨벤션이며 이탈이 아니다.
