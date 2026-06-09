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
- **로그인 화면 디자인 이식** (SPEC-LOGIN-UI-001): Figma Make "Meetup" LoginScreen 디자인을 `apps/web` 로그인 화면(`app/login`)에 그대로 이식하고 기존 SPEC-AUTH-001 server action에 배선. 신규 인증 로직 없이 UI만 교체.
  - **2뷰 LoginScreen**: 소셜 랜딩(로고/타이틀 "Meetup", Google/Apple/Email 버튼, "또는" 디바이더, 약관 푸터)과 이메일 폼(로그인/회원가입 토글, 이름 필드 조건부)을 client component 로컬 state(`showEmailForm`/`isSignUp`)로 전환.
  - **기존 액션 배선**: Google/Apple은 form+hidden `provider` 패턴으로 `signInWithOAuthAction`, 이메일/비번은 `useActionState`로 `signInAction`/`signUpAction` 호출, 성공 시 기존 `/me` 리다이렉트. `supabase.auth` 직접 호출·edge-function·`alert`·`console.log` 미사용.
  - **에러 통합**: `useActionState` 에러와 서버 `?error=` 초기값을 폼 상단 에러 박스에 통합 표시(OAuth 실패 시 이메일 폼 자동 오픈).
  - **의존성**: `lucide-react`(`Mail`/`Apple`) 런타임 추가, `GoogleIcon`은 인라인 SVG. Kakao 버튼 미노출.
  - 검증: SPEC 기준(테스트 하네스 미설치) — `next build`/`tsc --noEmit`/`eslint` 통과 + 금지패턴 grep 0건. RN WebView 풀스크린·Figma 픽셀 일치는 미검증(시각 확인 권고).
- **로컬 소셜 로그인(Google)** (SPEC-AUTH-002): 로컬 Supabase 스택에 실제 Google OAuth 키를 배선해 로그인 화면 Google 버튼이 종단 동작(동의 → 세션 → `/me`). Apple은 follow-up.
  - **provider 활성화**: `supabase/config.toml` `[auth.external.google]` `enabled=true` + `skip_nonce_check=true`(로컬 전용), client_id/secret은 `env()` 치환만(시크릿 비커밋). `supabase/.env.example` + README 절차 추가.
  - **호스트 통일(localhost)**: PKCE `code_verifier` 쿠키 호스트 바인딩으로 인한 `exchange_failed` 해결 — 웹 앱(포트 3000) `site_url`/`additional_redirect_urls`/`CALLBACK_URL`을 `http://localhost:3000`으로 통일. GoTrue(54321)는 `127.0.0.1` 유지(Google 콘솔 redirect URI 불변).
  - **소셜 로그인 성공 → `/me`**: `signInWithOAuthAction` `redirectTo`에 `?next=/me` 추가(비번 로그인과 일관).
- **모바일 WebView 셸 + Google OAuth 브리지** (SPEC-MOBILE-001, M1~M3 구현 / 디바이스 종단 검증 대기): `apps/mobile`(Expo 56)가 `apps/web`을 풀스크린 WebView로 호스팅하는 씬 셸 + WebView 안 웹 로그인의 Google OAuth를 시스템 브라우저로 브리지.
  - **풀스크린 WebView 셸**: `react-native-webview@13.16.1`(Expo 56 핀), `App.tsx` 단일 WebView(SafeAreaView, 로딩 인디케이터, 복구 가능 에러+재시도, Android 하드웨어 백). `EXPO_PUBLIC_WEB_URL` env 가드(`lib/web-url.ts`, `lib/env.ts` 패턴, 미설정 시 부팅 throw) + 환경별 호스트 매핑(Android emu `10.0.2.2`, iOS sim `localhost`, 실기기 LAN IP).
  - **Google OAuth 브리지**: `onShouldStartLoadWithRequest`로 GoTrue authorize URL 인터셉트(임베디드 로드 차단 — Google의 webview OAuth 차단 회피) → `redirect_to`를 `moyura://auth-callback`로 재작성(브라우저 쿠키 half-auth 회피, OD-5) → `openAuthSessionAsync` 시스템 브라우저 → deep-link 복귀 → WebView가 웹 콜백(`?code=`) 로드 → WebView 쿠키 컨텍스트로 세션 확립. **웹 코드 변경 0**(기존 `signInWithOAuthAction`/`auth/callback` 재사용). 순수 URL 로직은 `lib/auth/oauth-bridge.ts`로 분리.
  - **모바일 테스트 하네스 도입**: vitest(node-env) — `resolveWebUrl` + oauth-bridge 헬퍼 순수 함수 12 테스트. nx `test` 타겟 추가.
  - 검증: typecheck 0 / vitest 12/12 / expo export 번들 OK. **디바이스 종단(R-P2)·에뮬레이터 호스트↔OAuth 허용목록(OD-2)은 미검증** — Android 우선 수동 검증 follow-up. SPEC-LOGIN-UI-001 OD-5/AC-H1(WebView 풀스크린 렌더)은 디바이스 검증 시 닫힘.

### Changed

- **`apps/backend/main.ts`**: 하드코딩된 포트 `3000` 대신 validated config(`PORT`)에서 listen 포트를 읽도록 변경.
- **`packages/api-client`** (`@moyura/api-client`): 계획 단계에서 실제 워크스페이스 패키지로 생성되어 web/mobile이 소비. SPEC-AUTH-001에서 optional `getToken`→`Authorization: Bearer` 주입(토큰 URL/query 금지)과 `getMe()` 편의 메서드 추가.

[Unreleased]: https://github.com/hatae94/moyura/compare/HEAD
