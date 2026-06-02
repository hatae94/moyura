# SPEC-AUTH-001 Acceptance Criteria

> spec.md의 각 요구사항(R-*)에 1:1 매핑되는 Given-When-Then 시나리오. 각 AC는 관찰 가능한 증거(HTTP 상태/응답 본문, DB row, 파일/설정 존재, 테스트 출력)로 검증한다. "verify at implementation"으로 표기된 항목은 구현 시 공식 문서/스파이크 결과로 확정한다.

## A. Backend JWT Verification Guard

### AC-A1 (R-A1) — no-op seam 대체
- **Given** 기존 `supabase-auth.guard.ts`가 항상 `true`를 반환하는 pass-through였다
- **When** 가드가 실제 검증 가드로 대체된다
- **Then** 유효한 Supabase JWT가 없는 보호 라우트 요청은 거부된다(통과 불가). 단위 테스트로 "no token → reject" 확인.

### AC-A2 (R-A2) — JWKS ES256 검증 + algorithms 고정
- **Given** 백엔드가 `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`에서 JWKS를 fetch했다
- **When** ES256로 서명된 유효 JWT가 도착한다
- **Then** 가드는 토큰 `kid` 헤더로 공개키를 선택해 `algorithms: ['ES256']`를 고정한 채 서명을 검증하고 통과시키며, 검증 중 Auth 서버로 per-request 라운드트립을 하지 않는다(`jose` `createRemoteJWKSet`/`jwtVerify` 사용, 네트워크 호출 횟수 단위테스트/관찰). 헤더 `alg`를 신뢰하지 않고 검증기 옵션으로 고정함을 코드/테스트로 확인.

### AC-A3 (R-A3) — JWKS 캐시 + kid-miss 회전 + fail-closed
- **Given** JWKS가 이미 fetch되어 캐시되었다
- **When** 다수 요청이 도착하고, 그중 캐시에 없는 `kid`(키 회전)가 등장한다
- **Then** 가드는 캐시된 키셋을 재사용하되 `kid` miss 시 JWKS를 갱신한다(무기한 캐시하지 않음). 키 회전 시나리오 테스트로 갱신 동작 확인.
- **And (fail-closed)** JWKS fetch가 실패(timeout/네트워크/5xx)하면 ES256 서명 토큰은 401로 거부되고 **HS256 경로로 다운그레이드되지 않는다**(M-3). JWKS-실패 시뮬레이션 테스트로 "ES256 토큰 → 401, HS256 폴백 미발동" 확인.

### AC-A4 (R-A4) — 레거시 HS256 폴백 (HS256 전용 + algorithms 고정)
- **Given** `SUPABASE_JWT_SECRET`가 설정되어 있다
- **When** 실제로 HS256으로 서명된 토큰이 도착한다
- **Then** 가드는 `SUPABASE_JWT_SECRET`로 `algorithms: ['HS256']`를 고정해 검증·통과시킨다(폴백 경로). 단위 테스트로 HS256 토큰 통과 확인. ES256 토큰은 이 경로로 라우팅되지 않음을 확인(AC-A8 교차).

### AC-A5 (R-A5) — 검증 실패 → 401
- **Given** 보호 라우트
- **When** 토큰이 누락/만료/변형되었거나 서명 검증이 실패한다(ES256/JWKS·HS256/legacy 모두 불통)
- **Then** HTTP 401로 거부하고 어떤 user context도 부착하지 않는다. 각 실패 케이스(missing/expired/malformed/bad-signature)별 401 단위 테스트.

### AC-A6 (R-A6) — sub 추출 + context 부착
- **Given** 검증에 성공한 요청
- **When** 가드가 통과시킨다
- **Then** 토큰의 `sub`(Supabase user id)를 추출해 최소 `sub`를 포함한 user context를 요청에 부착하고, downstream 핸들러가 이를 읽을 수 있다.

### AC-A7 (R-A7) — iss/aud/exp normative 검증 + 로컬 검증
- **Given** 보호 라우트, expected `iss`/`aud`가 결정됨(OD-6)
- **When** 인증 요청이 처리된다
- **Then** 매 요청에서 서명 AND (1) `exp` 미경과 + `nbf`/`iat` 미래 아님(clock skew 허용) (2) `iss` 정확 일치 (3) `aud = authenticated`를 단언하고, 하나라도 실패하면 401. 각 위반 케이스별 단위 테스트:
  - 잘못된 `iss`(타 프로젝트 issuer) → **401**
  - 잘못된 `aud`(≠ `authenticated`) → **401**
  - 만료된 `exp`(과거) → **401**
- **And** per-request로 Supabase Auth 서버를 호출하지 않는다(JWKS fetch는 캐시되어 요청당 1회가 아님).

### AC-A8 (R-A8, B-1) — alg-confusion / alg:none 거부
- **Given** 보호 라우트, JWKS가 fetch됨
- **When** (a) JWKS의 ES256 **공개키를 HMAC 시크릿으로 사용해 HS256으로 위조한 토큰**이 도착, 또는 (b) `alg: none` 토큰이 도착, 또는 (c) 허용 집합 밖 alg 토큰이 도착
- **Then** 모든 경우 **HTTP 401**로 거부된다. (a)는 ES256 토큰이 HS256 경로로 절대 검증되지 않아(R-A4 교차) 위조가 성립하지 않고, (b)/(c)는 서명 검증 단계 **이전**에 알고리즘 화이트리스트에서 거부됨을 테스트로 확인.

### AC-A9 (R-A9, M-2) — 토큰 위생
- **Given** 인증된 요청/실패 응답/로그/APM
- **When** 시스템이 토큰을 다룬다
- **Then** (1) JWT가 URL/query string에 실리지 않음(코드 grep로 확인 — Bearer 헤더만), (2) `Authorization` 헤더/토큰 payload가 로그·에러·APM에 출력되지 않음(로그 grep로 토큰 부재 확인), (3) prod에서 auth 요청은 HTTPS 요구, (4) 401 응답 본문이 토큰 내용을 echo하지 않음.

### AC-A10 (R-A10, B-3) — 가드 적용점 실제 배선
- **Given** `SupabaseAuthGuard`가 실제 가드로 구현됨
- **When** 적용점(per-route `@UseGuards` on `/me`, 또는 global `APP_GUARD` + `@Public()` — OD-7)을 검토한다
- **Then** 가드가 정의 파일에만 머무르지 않고 보호 라우트에 실제 적용되어, 토큰 없는 `/me` 호출이 실제로 401이 된다(AC-C2 교차). `/health`/`GET /`는 public 유지(AC-C3 교차). 적용점 존재를 코드/통합 테스트로 확인.

## B. Profile Model + UPSERT

### AC-B1 (R-B1) — profile 모델 단일 키 + 최소 필드
- **Given** Prisma 스키마
- **When** `profile` 모델이 정의된다
- **Then** `id`가 primary key이며 Supabase `sub` 값을 저장(`id = sub`, unique) + `createdAt`만 존재하고, 별도 `userId`/`sub` 컬럼이나 투기적 도메인 컬럼은 없다(스키마 리뷰로 확인 — M-5 단일 해석).

### AC-B2 (R-B2) — 첫 도메인 마이그레이션
- **Given** SPEC-ENV-SETUP-001 시점에 도메인 모델이 0개였다
- **When** `profile` 마이그레이션을 생성/적용한다
- **Then** 프로젝트 첫 도메인 마이그레이션 파일이 생성되고 `DIRECT_URL`로 적용되며, 로컬 DB에 `profile` 테이블 + `id`(= `sub`) primary-key 유일성이 존재한다(`\d profile` 또는 마이그레이션 산출물로 확인).

### AC-B3 (R-B3) — 최초 인증 요청 시 UPSERT
- **Given** `sub=X`에 대한 profile row가 없다
- **When** 검증된 JWT(`sub=X`)로 보호 라우트를 호출한다
- **Then** 백엔드가 `sub=X` profile row를 UPSERT(생성)한다. 호출 후 DB에 정확히 1개 row 존재(Supabase 트리거가 아니라 Nest가 생성했음을 확인).

### AC-B4 (R-B4) — 멱등 재사용
- **Given** `sub=X` profile row가 이미 존재한다
- **When** 같은 `sub=X`로 재호출한다
- **Then** 중복 row 없이 기존 row를 재사용한다(호출 후에도 row 수 = 1).

### AC-B5 (R-B5) — 경쟁(race) 안전
- **Given** `sub=X` profile row가 없다
- **When** 동일 `sub=X` 인증 요청 2건이 동시에 도착한다
- **Then** 중복 row가 생기지 않고(최종 row 수 = 1) 두 요청 모두 실패하지 않는다(`id`(= `sub`) PK 유일성 + 원자적 upsert). 동시성 테스트로 확인.

### AC-B6 (R-B3, M-5) — mass-assignment 차단
- **Given** `sub=A`로 검증된 JWT를 가진 클라이언트
- **When** 요청 body/query/커스텀 헤더에 `sub=B` 또는 `id=B`(타인 식별자)를 함께 보낸다
- **Then** UPSERT 키는 가드가 부착한 검증된 `sub=A`만 사용하고 body/query/헤더의 `sub`/`id`는 무시되어, `sub=A` 행만 생성/조회되고 `sub=B` 행은 생성되지 않는다. client-supplied 필드가 `profile`에 mass-assign되지 않음을 테스트로 확인.

## C. Protected Route `GET /me`

### AC-C1 (R-C1) — 인증 사용자 profile 반환
- **Given** 유효 JWT를 가진 클라이언트
- **When** `GET /me`를 호출한다
- **Then** 200으로 해당 사용자의 profile(필요 시 upsert 후)을 반환한다(응답 본문에 `sub` 기반 profile 포함).

### AC-C2 (R-C2, B-3) — 미인증 거부 실제 강제
- **Given** 유효 JWT가 없다, 가드가 `/me`에 실제 배선됨(R-A10/AC-A10)
- **When** `GET /me`를 호출한다
- **Then** HTTP 401로 **실제로** 거부한다(가드가 적용점에 배선되어 있어 통합 테스트에서 401이 관찰됨 — 정의만 되고 미적용인 상태가 아님).

### AC-C3 (R-C3, M-1) — public 계약 보존
- **Given** seam이 실제 가드로 대체됨
- **When** 토큰 없이 `GET /health`와 `GET /`(`getHello`)를 각각 호출한다
- **Then** 둘 다 토큰 없이 도달 가능하다 — `GET /health`는 200(또는 503 degraded), `GET /`는 200으로 응답한다(가드가 이들을 보호하지 않음, public/protected 경계 e2e).
- **And (regression, global guard 선택 시)** 적용점이 global `APP_GUARD`라면 `/health`와 `GET /`에 `@Public()` opt-out이 존재해 토큰 없이 200이 유지됨을 확인한다(SPEC-ENV-SETUP-001 public 계약 회귀 방지 — M-1).

### AC-C4 (R-C4) — 종단 증명 아티팩트
- **Given** 가드 + profile upsert가 구현됨
- **When** 신규 `sub`로 `GET /me` 1회 호출
- **Then** 한 번의 호출로 (1) 가드 검증 통과 (2) profile 생성 (3) profile 반환이 모두 일어남을 e2e로 증명한다.

## D. Web Session — `@supabase/ssr` + PKCE

### AC-D1 (R-D1) — 쿠키 세션 소유
- **Given** 웹앱에 `@supabase/ssr` 도입
- **When** 사용자가 로그인한다
- **Then** 세션이 쿠키에 저장되고, `createServerClient`(서버)/`createBrowserClient`(클라이언트)로 동일 세션을 읽는다(쿠키 존재 + 서버 컴포넌트에서 세션 인식 확인).

### AC-D2 (R-D2) — PKCE 콜백 코드 교환 (정상 경로)
- **Given** 소셜 OAuth가 유효 `?code=`를 콜백 라우트로 반환한다(error 없음)
- **When** 콜백 라우트 핸들러(`app/auth/callback/route.ts`, host = `127.0.0.1`, OD-5/M-4)가 실행된다
- **Then** `exchangeCodeForSession(code)`로 세션을 확립하고 쿠키를 설정한 뒤 앱으로 redirect한다(콜백 후 인증 상태 확인). 콜백 host가 `site_url` host(`127.0.0.1`)와 일치함을 확인. 핸들러 정확 시그니처는 `@supabase/ssr` 0.10.3 기준 verify at implementation.

### AC-D3 (R-D3) — 세션 갱신
- **Given** 세션 쿠키 존재
- **When** 액세스 토큰이 만료에 근접/만료한다
- **Then** 미들웨어/`updateSession` 패턴으로 세션이 갱신되어 백엔드에 보내는 JWT가 유효 상태를 유지한다.

### AC-D4 (R-D4) — 백엔드로 JWT 전달
- **Given** 인증된 사용자
- **When** 웹앱이 NestJS 백엔드를 호출한다
- **Then** Supabase JWT를 전달한다(권장: `Authorization: Bearer <token>`, OD-3) — 백엔드 가드가 검증 가능. 요청 헤더/네트워크 관찰로 확인.

### AC-D5 (R-D5) — 로그아웃
- **Given** 활성 세션
- **When** 사용자가 로그아웃한다
- **Then** `signOut`으로 세션 쿠키가 제거되고, 이후 백엔드 호출이 미인증(401) 처리된다.

### AC-D6 (R-D2a, M-6) — PKCE 음성 경로: error param
- **Given** 콜백 라우트
- **When** OAuth가 `?error=...`/`error_description=...`를 반환한다(코드 없음)
- **Then** 세션을 확립하지 않고 쿠키를 설정하지 않으며, 복구 가능한 에러 상태(에러/로그인 화면 redirect)를 표시한다. 콜백 후 미인증 상태 + 세션 쿠키 부재 확인.

### AC-D7 (R-D2a, M-6) — PKCE 음성 경로: invalid/missing code · state mismatch
- **Given** 콜백 라우트
- **When** `code`가 없거나/유효하지 않거나/state·PKCE verifier 불일치로 `exchangeCodeForSession`이 실패한다
- **Then** 세션을 확립하지 않고(쿠키 미설정) 복구 가능한 에러를 표시한다(silent half-authenticated 없음). 각 케이스(missing code / invalid code / state mismatch)별로 세션 부재 확인.

## E. Mobile Deep-Link OAuth

### AC-E1 (R-E1) — webview 호스팅 + 세션 공유
- **Given** RN 앱
- **When** 앱이 실행된다
- **Then** 웹 auth surface를 WebView로 호스팅하고 웹 세션을 공유한다(별도 네이티브 email/pw UI 없음 — 코드/화면 확인).

### AC-E2 (R-E2) — 시스템 브라우저 OAuth
- **Given** 모바일 컨텍스트에서 소셜 로그인 시작
- **When** OAuth 흐름이 개시된다
- **Then** provider 인증 페이지가 임베디드 webview가 아니라 **시스템 브라우저**에서 열린다(`expo-web-browser` 사용 확인). 근거: Google 등이 임베디드 webview OAuth 차단.

### AC-E3 (R-E3) — deep link 복귀 + 세션 확립
- **Given** 시스템 브라우저 OAuth 완료
- **When** redirect가 등록된 deep link로 앱에 복귀한다
- **Then** WebView가 호스팅하는 웹 세션에 인증이 확립된다. 정확한 redirect/세션 확립 메커니즘(`expo-auth-session`/`expo-web-browser`/WebView 네비게이션)은 verify at implementation.

### AC-E4 (R-E4) — 복귀 실패 복구
- **Given** deep-link 복귀
- **When** 취소/redirect 불일치/코드 만료로 세션이 확립되지 않는다
- **Then** 앱은 미인증 상태를 유지하고 복구 가능한 에러를 표시한다(크래시 없음, silent half-authenticated 없음).

## F. Social Provider Scaffold

### AC-F1 (R-F1) — config.toml 스캐폴드
- **Given** `config.toml`에 `[auth.external.apple]`만 존재
- **When** 스캐폴드를 추가한다
- **Then** `[auth.external.google]`/`[auth.external.apple]`/`[auth.external.kakao]` 세 블록이 `enabled = false` + `secret = "env(...)"` 형태로 존재하고, 실제 시크릿은 커밋되지 않는다(config 파일 확인 + grep로 평문 시크릿 부재 확인).

### AC-F2 (R-F2) — signInWithOAuth 진입점
- **Given** 소셜 로그인 버튼
- **When** Google/Apple/Kakao 로그인을 호출한다
- **Then** `signInWithOAuth`가 provider 문자열 `'google'`/`'apple'`/`'kakao'` + 웹 PKCE 콜백을 가리키는 `redirectTo`로 호출된다(코드 확인).

### AC-F3 (R-F3) — 키 없이 완료 가능
- **Given** 실제 provider 키 미주입
- **When** 이 SPEC 완료 판정
- **Then** 소셜은 flow + config 스캐폴드까지만으로 완료로 간주되고(키는 named follow-up), email/pw가 로컬 종단 증명 경로임을 확인한다.

### AC-F4 (R-F4) — canonical 콜백 URI 문서화
- **Given** provider 콜백 설정
- **When** 콜백 URI를 문서화한다
- **Then** `<SUPABASE_URL>/auth/v1/callback`(로컬 `http://127.0.0.1:54321/auth/v1/callback`) canonical 형식을 사용해, 이후 키 배선 follow-up이 flow 변경 없이 동작 가능하다.

## G. Email/Password Core Flows

### AC-G1 (R-G1) — signup
- **Given** 로컬 Supabase 스택 + `enable_signup = true`
- **When** 유효 가입 정보를 제출한다
- **Then** `signUp`으로 GoTrue에 계정이 생성된다(로컬 GoTrue에 사용자 생성 확인).

### AC-G2 (R-G2) — login
- **Given** 가입된 계정
- **When** 유효 로그인 정보를 제출한다
- **Then** `signInWithPassword`로 세션이 확립되고 그룹 D대로 쿠키에 저장된다.

### AC-G3 (R-G3) — logout
- **Given** 활성 세션
- **When** 로그아웃한다
- **Then** R-D5대로 세션이 종료된다.

### AC-G4 (R-G4) — 세션 갱신
- **Given** 활성 세션
- **When** 토큰이 만료에 근접한다
- **Then** 투명하게 갱신되어 백엔드 JWT가 유효를 유지한다(그룹 D R-D3).

### AC-G5 (R-G5) — 외부 키 없이 로컬 완전 동작
- **Given** 외부 provider 키 없음
- **When** signup → login → `GET /me` → logout 전체를 로컬 GoTrue 대상으로 수행한다
- **Then** 외부 키 없이 흐름 전체가 동작하고 `/me`가 profile을 반환한다(로컬 종단 증명).

### AC-G6 (R-G6) — confirm/reset 미구현
- **Given** 이 SPEC 범위
- **When** 코드/라우트를 검토한다
- **Then** email-confirmation/password-reset 흐름이 구현되어 있지 않다(named follow-up).

## H. Local GoTrue / Config

### AC-H1 (R-H1) — 로컬 GoTrue canonical
- **Given** 기존 로컬 Supabase CLI 스택
- **When** `supabase start`
- **Then** GoTrue Auth가 기동되어 개발용 canonical Auth 백엔드로 동작한다.

### AC-H2 (R-H2, M-4) — redirect allowlist host/scheme 정합
- **Given** PKCE 콜백 라우트, 현재 `config.toml`이 `site_url = "http://127.0.0.1:3000"` + `additional_redirect_urls = ["https://127.0.0.1:3000"]`(https, 콜백과 불일치)
- **When** `config.toml` `[auth]` 설정을 갱신/검토한다
- **Then** 정확한 로컬 콜백 `http://127.0.0.1:3000/auth/callback`(host = `site_url` host `127.0.0.1`, http scheme)이 `additional_redirect_urls` allowlist에 추가되어 로컬 PKCE 콜백이 성공한다. `localhost`(≠`127.0.0.1`)나 `https`(로컬 TLS 없음) 콜백은 GoTrue exact-match에서 거부됨을 확인.

### AC-H3 (R-H3) — 로컬 JWKS/HS256 적응
- **Given** 로컬 GoTrue가 비대칭 키 또는 HS256 시크릿(혹은 둘 다)을 제공
- **When** 가드가 로컬 토큰을 검증한다
- **Then** JWKS-primary + HS256-fallback 설계가 로컬 스택이 제공하는 쪽으로 동작한다. 로컬이 비대칭 키를 미노출하면 HS256 폴백이 로컬 테스트 경로(M0 스파이크로 확정, verify at implementation).

## I. Environment Additions

### AC-I1 (R-I1) — env 승격
- **Given** 기존 `SUPABASE_*`가 optional placeholder
- **When** Zod 스키마를 갱신한다
- **Then** `SUPABASE_URL`/`SUPABASE_ANON_KEY`가 auth 런타임 required로 승격되고 `SUPABASE_JWT_SECRET`(레거시/폴백)이 유지된다(스키마 + 테스트 확인).

### AC-I2 (R-I2) — JWKS URL 파생/명시
- **Given** JWKS 소스 필요
- **When** 백엔드가 JWKS URL을 결정한다
- **Then** 명시 env 또는 `SUPABASE_URL` 파생(`<URL>/auth/v1/.well-known/jwks.json`)으로 얻는다(기본 = 파생, OD-2).

### AC-I3 (R-I3) — fail-fast
- **Given** 필수 auth env 누락/불일치
- **When** 백엔드 부팅
- **Then** 설명 메시지 + non-zero exit로 fail-fast하며 부분 기동하지 않는다(SPEC-ENV-SETUP-001 R-B2 일관, 단위 테스트).

### AC-I4 (R-I4) — public env 분리 + 시크릿 비노출
- **Given** 프런트 공개 설정 + provider 시크릿
- **When** env 배선을 검토한다
- **Then** 웹/모바일은 `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`로 `SUPABASE_URL`/`SUPABASE_ANON_KEY`만 읽고, provider 시크릿은 `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`에 절대 노출되지 않는다(grep로 확인).

## J. CORS for Auth

### AC-J1 (R-J1) — origin allowlist
- **Given** 웹앱 + RN webview-hosted 웹 origin
- **When** 인증 요청을 백엔드로 보낸다
- **Then** `CORS_ORIGINS`에 해당 origin이 포함되어 허용된다.

### AC-J2 (R-J2) — credentials (쿠키 포워딩 선택 시)
- **Given** OD-3가 쿠키 포워딩을 선택한 경우
- **When** allowlist origin이 credentials 요청을 보낸다
- **Then** `Access-Control-Allow-Credentials`가 allowlist origin에만 허용되고 와일드카드 origin과 병용되지 않는다. (Bearer 선택 시 본 AC는 N/A.)

### AC-J3 (R-J3) — 와일드카드 금지
- **Given** allowlist에 없는 origin
- **When** 요청이 도착한다
- **Then** `Access-Control-Allow-Origin: *`를 내지 않는다(SPEC-ENV-SETUP-001 R-F3 일관).

## Edge Cases (교차 검증)

- 만료 직전 토큰 + 동시 갱신: 갱신 경합에도 백엔드 401이 발생하지 않거나, 발생 시 클라이언트가 갱신 후 재시도로 복구(AC-A5/AC-D3/AC-G4 교차).
- `sub` 동일 + 다른 디바이스(브라우저 + webview) 동시 첫 요청: profile row 1개 유지(AC-B5).
- **JWKS fetch 실패(timeout/네트워크/5xx) + ES256 서명 토큰: 가드는 FAIL CLOSED로 401을 반환하며 HS256 폴백으로 다운그레이드하지 않는다(M-3, AC-A3 fail-closed). HS256 폴백은 실제 HS256 서명 토큰 + `SUPABASE_JWT_SECRET` 설정 시에만 발동한다(AC-A4).** (로컬이 비대칭 키를 미노출하는 경우는 발급 토큰 자체가 HS256이므로 HS256 경로가 정상 경로다 — JWKS 실패로 인한 다운그레이드가 아님, AC-H3 구분.)
- 잘못된 `kid`(회전된 구키) 토큰: JWKS 갱신 후에도 불일치면 401(AC-A3/AC-A5).
- alg-confusion(JWKS 공개키로 HS256 위조) / `alg:none`: 401(AC-A8).
- 잘못된 `iss`/`aud`/만료 `exp`: 401(AC-A7).
- body/query로 타인 `sub`/`id` 주입: 검증된 `sub`만 사용, 위조 행 미생성(AC-B6).
- public(`/health`/`GET /`)와 protected(`/me`) 동시 트래픽: 가드가 public 라우트를 막지 않음(AC-C3).

## Quality Gate Criteria (Definition of Done)

- [ ] AC-A1~A10, B1~B6, C1~C4, D1~D7, E1~E4, F1~F4, G1~G6, H1~H3, I1~I4, J1~J3 충족(또는 N/A 명시: AC-J2는 OD-3 결과에 종속).
- [ ] (보안) AC-A8 alg-confusion/`alg:none` 401, AC-A7 `iss`/`aud`/`exp` 위반 401, AC-A3 JWKS-fail fail-closed(HS256 다운그레이드 금지), AC-A9 토큰 위생(URL/로그 미노출) 충족.
- [ ] no-op `SupabaseAuthGuard`가 실제 검증 가드로 대체되고 **명시 적용점에 배선**되어 토큰 없는 `/me`가 실제 401(AC-A10/AC-C2, B-3).
- [ ] `profile` 첫 도메인 마이그레이션 생성/적용, `id`(= `sub`) PK 유일성 존재. body/query `sub`/`id` 무시(AC-B6, M-5).
- [ ] 로컬 email/pw 종단 증명: signup → login → `GET /me`(가드 통과 + profile 생성/반환) → logout 성공(AC-G5/AC-C4).
- [ ] `/health`와 `GET /` public 유지 e2e(AC-C3, M-1); global guard 선택 시 `@Public()` opt-out 회귀 확인.
- [ ] 웹 PKCE 음성 경로(error param / invalid code / state mismatch) 시 세션 미확립 + 복구 가능 에러(AC-D6/D7, M-6).
- [ ] redirect allowlist host/scheme 정합: `http://127.0.0.1:3000/auth/callback`가 `additional_redirect_urls`에 추가(AC-H2, M-4).
- [ ] 단위/e2e 테스트 그린, 커버리지 게이트 통과, `nx affected` build/lint/typecheck 그린.
- [ ] OpenAPI 재emit + `@moyura/api-client` 재생성(`/me` 반영, 멱등).
- [ ] 시크릿 비커밋/비노출 확인(config.toml `env()`, public env 미포함), 토큰 로그/URL 미노출(AC-A9).
- [ ] Exclusions 준수: RBAC/인가/RLS/email-confirm/reset/도메인필드/Supabase 트리거 미구현(코드 리뷰).
- [ ] verify-at-implementation 항목(OD-1 로컬 JWT 모드, OD-6 expected iss/aud, OD-5/OD-7 콜백·가드 적용점, R-E3 모바일 deep-link, app scheme) 확정 결과를 spec.md HISTORY에 기록.
