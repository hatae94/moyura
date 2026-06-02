# SPEC-AUTH-001 Implementation Plan

> 이 문서는 이후 `/moai run SPEC-AUTH-001`이 실행할 마일스톤 분해다. 시간 추정 없음 — 우선순위/단계 순서(Priority High → Medium → Low, "A 완료 후 B 시작")로만 표현한다. 각 마일스톤은 spec.md 요구사항(R-*) 및 acceptance.md AC와 매핑된다.

## 기술 접근 (Technical Approach)

- **세션 소유 = 웹(`@supabase/ssr`)**, 백엔드는 stateless JWT 검증자. 토큰 전달은 Bearer 헤더 권장(OD-3) — 토큰은 URL/query 금지, 로그/APM 미노출(R-A9).
- **가드 = JWKS-primary(ES256) + HS256-fallback(legacy 전용)** 단일 클래스. `jose` `createRemoteJWKSet`(캐시+`kid` 회전) + `jwtVerify`로 검증. **검증기 `algorithms` 화이트리스트 고정**(ES256/HS256 분리, 교차 금지 — alg-confusion·`alg:none` 거부), **`iss`/`aud`/`exp`/`nbf`/`iat` normative 검증**, **JWKS 실패 시 ES256 토큰 fail-closed**(HS256 다운그레이드 금지). no-op `SupabaseAuthGuard`를 대체 + **명시 적용점에 배선**(per-route `@UseGuards` 권장, OD-7).
- **profile = 첫 Prisma 도메인 모델**, `id`(= `sub`) PK 유일, 원자적 `upsert`. UPSERT 키는 가드가 부착한 검증된 `sub`만 사용(client-supplied 무시). 마이그레이션은 `DIRECT_URL`.
- **소셜 = flow + config 스캐폴드만**, 키 연기. email/pw가 로컬 종단 증명 경로. 콜백 host = `site_url` host(`127.0.0.1`) 정확 일치.
- 단순성 강제(TRUST 5 Readable): 인가/RLS/email-confirm/reset/도메인 필드 미도입.

## Milestones (우선순위 순서)

### M0. Spike — 로컬 JWT 모드 + iss/aud 확정 (Priority High, 선행)

- 로컬 Supabase CLI 스택을 `supabase start`로 기동, `<127.0.0.1:54321>/auth/v1/.well-known/jwks.json` 응답 여부 확인(비대칭 키 노출 여부). 미노출 시 HS256 폴백이 로컬 테스트 경로임을 확정.
- email/pw 더미 계정으로 로컬 GoTrue가 발급하는 JWT의 `alg`/`kid`/claims(`sub`/`exp`/`aud`/`iss`) 관찰. **로컬 `config.toml`의 `jwt_issuer`가 비어 있으므로 기본 issuer 형태를 반드시 관찰**하여 expected `iss`를 확정(OD-6), `aud = authenticated` 확인.
- 결과를 spec.md HISTORY에 기록(OD-1, OD-6 확정). 이후 M1 가드 구현의 1차 경로 + 검증값을 결정.
- 매핑: R-H3, R-A2/A4/A7, OD-1, OD-6.

### M1. Backend Verification Guard (Priority High)

- `jose` 6.2.3 추가. `SupabaseAuthGuard`를 검증 가드로 대체(R-A1~A10).
- `createRemoteJWKSet(<SUPABASE_URL>/auth/v1/.well-known/jwks.json)` + `jwtVerify`, **`algorithms: ['ES256']` 고정**, `kid` 선택/회전(R-A2/A3). HS256 경로는 `SUPABASE_JWT_SECRET` + **`algorithms: ['HS256']` 고정**, 실제 HS256 토큰 전용(R-A4). ES256↔HS256 교차 금지.
- **`alg:none`/비허용 alg는 서명 검사 전 401(R-A8)**. **JWKS fetch 실패 시 ES256 토큰 fail-closed(401, HS256 다운그레이드 금지), bounded timeout + cooldown(R-A3/M-3)**.
- **매 요청 `iss`(정확 일치, OD-6)/`aud`(`authenticated`)/`exp`/`nbf`/`iat`(clock skew) normative 검증, 실패 시 401(R-A7)**.
- 실패(누락/만료/위조/claims 불일치) → 401, user context 미부착(R-A5). 성공 → `sub` 등 user context 부착(R-A6). per-request Auth 서버 호출 없음(R-A7).
- **토큰 위생(R-A9)**: 토큰을 URL/query에 싣지 않음, `Authorization`/payload 로그·APM 미출력, prod HTTPS 요구, 401에 토큰 echo 금지.
- **가드 적용점 배선(R-A10/OD-7)**: per-route `@UseGuards(SupabaseAuthGuard)` on `/me` 권장(global+`@Public()` 대안). `/health`/`GET /` public 보장.
- env 스키마: `SUPABASE_URL`/`SUPABASE_ANON_KEY` required 승격, `SUPABASE_JWT_SECRET` 폴백 유지, JWKS URL 파생(OD-2) (R-I1~I3).
- 매핑: 그룹 A, R-I1~I3, OD-6/OD-7. 선행: M0.

### M2. Profile Model + 첫 Prisma 마이그레이션 (Priority High)

- Prisma `profile` 모델 정의: **`id` = PK = Supabase `sub` 값(unique)** + `createdAt`. 별도 `userId`/`sub` 컬럼 없음, 최소 필드만(R-B1, M-5 단일 해석).
- 프로젝트 첫 도메인 마이그레이션 생성/적용, `DIRECT_URL` 사용(R-B2). `prisma.config.ts` 듀얼 URL 첫 실사용.
- `id`(= `sub`) PK 유일성(경쟁 안전 R-B5 + mass-assignment 차단 R-B3의 기반).
- 매핑: 그룹 B(R-B1/B2). M1과 병행 가능(파일 비중첩: 가드 vs prisma 스키마).

### M3. Profile UPSERT + `GET /me` (Priority High)

- 검증된 JWT의 `sub`(가드 부착, R-A6)로 profile 조회, 부재 시 원자적 `upsert`(R-B3/B4/B5). **UPSERT 키는 검증된 `sub`만 사용 — body/query/헤더의 `sub`/`id`는 무시, client-supplied mass-assign 금지(R-B3/M-5)**.
- `GET /me` 보호 라우트: 가드 실제 적용(R-A10), profile 반환(필요 시 upsert 후). 토큰 없는 `/me`는 실제 401(R-C2). `/health`/`GET /`는 public 유지(R-C1~C4/M-1).
- 매핑: 그룹 B(R-B3~B5), 그룹 C, K9/K13/K16. 선행: M1 + M2.

### M4. Web Session — `@supabase/ssr` + PKCE 콜백 (Priority High)

- `@supabase/ssr` 0.10.3 + `@supabase/supabase-js` 2.106.2 추가. `createServerClient`/`createBrowserClient` + 쿠키 핸들링(R-D1).
- `app/auth/callback/route.ts`(OD-5, **host = `127.0.0.1`/http, M-4**): 유효 `?code=` + error 없음 → `exchangeCodeForSession(code)` → 쿠키 세션 설정 → 앱 redirect(R-D2).
- **PKCE 음성 경로(R-D2a/M-6)**: `error` param / missing·invalid `code` / state·PKCE mismatch 시 세션 미확립, 쿠키 미설정, 복구 가능 에러 표시.
- 미들웨어/`updateSession` 세션 갱신(R-D3). 로그아웃 `signOut` 쿠키 클리어(R-D5).
- 백엔드 호출 시 Bearer 토큰 주입(OD-3, URL/query 금지) — `@moyura/api-client`에 토큰 주입 훅(R-D4).
- 웹 env: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` + `.env.example`(R-I4).
- 매핑: 그룹 D, R-I4(web), K17. 선행: M3(백엔드가 토큰 검증 준비됨).

### M5. Email/Password 핵심 흐름 + 로컬 종단 증명 (Priority High)

- 웹: signup(`signUp`)/login(`signInWithPassword`)/logout/session-refresh(R-G1~G4). 로컬 GoTrue 대상 완전 동작(R-G5, `enable_signup = true` 기존).
- 종단 증명: 로컬 email/pw 세션으로 웹 → 백엔드 `GET /me` 호출 → 가드 통과 → profile upsert → profile 반환 확인.
- email-confirm/reset 미구현(R-G6).
- 매핑: 그룹 G, AC 종단 증명. 선행: M3 + M4.

### M6. Social Provider Scaffold (Google/Apple/Kakao, 키 연기) (Priority Medium)

- `supabase/config.toml`: `[auth.external.google]`/`[auth.external.kakao]` 블록 추가(`[auth.external.apple]` 기존), `enabled = false` + `secret = "env(SUPABASE_AUTH_EXTERNAL_<P>_SECRET)"`(R-F1).
- 웹/모바일: `signInWithOAuth({ provider, options: { redirectTo: <web callback> } })` 진입점(`'google'`/`'apple'`/`'kakao'`)(R-F2).
- 콜백 URI 문서화: provider→Supabase canonical `<SUPABASE_URL>/auth/v1/callback`(로컬 `http://127.0.0.1:54321/auth/v1/callback`)(R-F4). redirect allowlist에 웹 콜백 `http://127.0.0.1:3000/auth/callback`(host = `site_url` host, http) 추가(R-H2/M-4).
- 실제 키 미주입 — flow + config만, 키는 named follow-up(R-F3).
- 매핑: 그룹 F, R-H2. 선행: M4.

### M7. Mobile Deep-Link OAuth (시스템 브라우저) (Priority Medium)

- RN이 웹 auth surface를 WebView로 호스팅, 세션 공유. 별도 네이티브 email/pw UI 없음(R-E1).
- 소셜 OAuth는 시스템 브라우저로 위임(R-E2), deep link 복귀 후 webview 세션 확립(R-E3) — `expo-web-browser` 56.0.5 / `expo-auth-session` 56.0.13, 정확 시그니처 verify at implementation.
- deep-link 복귀 실패 시 unauthenticated 유지 + 복구 가능 에러(R-E4).
- 모바일 env: `EXPO_PUBLIC_SUPABASE_URL`/`EXPO_PUBLIC_SUPABASE_ANON_KEY` + `.env.example`(R-I4). app scheme deep-link `config.toml` `additional_redirect_urls` 등록.
- (OD-4) 네이티브 토큰 저장 필요성 먼저 검증 — 불필요하면 미도입, 필요하면 `expo-secure-store` 56.0.4.
- 매핑: 그룹 E, R-I4(mobile), OD-4. 선행: M6.

### M8. CORS for Auth + 경계 검증 (Priority Medium)

- `CORS_ORIGINS`에 웹앱 origin(+ RN webview-hosted 웹 origin) 포함(R-J1). Bearer 사용 시(OD-3) credentials 불필요; 쿠키 포워딩 선택 시에만 credentials allowlist 설정(R-J2). 와일드카드 금지(R-J3, 기존 R-F3 일관).
- public(`/health`/`GET /`)/protected(`/me`) 경계 단위/e2e 검증(K9/M-1).
- 매핑: 그룹 J, K9. M1~M5와 병행/직후.

### M9. Quality Gate + 문서/스캐폴드 정리 (Priority Low)

- TRUST 5 (보안 테스트 포함): 단위/e2e — 가드 401/200, **alg-confusion·`alg:none` 401(AC-A8)**, **`iss`/`aud`/`exp` 위반 401(AC-A7)**, **JWKS-fail fail-closed(AC-A3)**, **토큰 위생 grep(AC-A9)**, **mass-assignment 차단(AC-B6)**, upsert 멱등·경쟁, public/protected 경계(`/health`/`GET /`, AC-C3), **PKCE 음성 경로(AC-D6/D7)**, redirect host 정합(AC-H2). 커버리지 게이트, lint/typecheck/build(`nx affected`).
- OpenAPI 재emit + `@moyura/api-client` 재생성(`/me` 추가 반영, 멱등).
- `config.toml` provider 스캐폴드 / env `.env.example` / redirect allowlist(`127.0.0.1`) 문서화. named follow-up(키 발급, email-confirm/reset, RBAC) 명시.
- 매핑: 전 그룹 검증, verify-at-implementation 항목(OD-1/OD-6/OD-7 포함) HISTORY 확정.

## 의존성 그래프 (요약)

```
M0(spike) ─▶ M1(guard) ─┐
                         ├─▶ M3(upsert + /me) ─▶ M4(web ssr) ─▶ M5(email/pw 종단 증명)
M2(profile model) ──────┘                                │
                                                         └─▶ M6(social scaffold) ─▶ M7(mobile deep-link)
M8(CORS/경계)  ─ M1~M5 병행/직후
M9(quality/docs) ─ 최종
```

## 단순성 가드레일 (Scope Discipline)

- 가드는 authenticated 여부만 판정 — 역할/권한(RBAC) 분기 추가 금지(Exclusions). 단, 보안 검증(alg 화이트리스트·`iss`/`aud`/`exp`·fail-closed)은 인증 정확성의 일부이므로 scope creep이 아니다.
- `profile`에 투기적 도메인 컬럼 추가 금지 — `id`(= `sub`, PK)/`createdAt`만.
- email-confirm/reset, RLS, Supabase DB 트리거, MFA/패스키 UI 미도입.
- 소셜 실제 키 배선 금지 — flow + config 스캐폴드까지만.
- 토큰 전달은 Bearer 단일 경로 권장(OD-3) — 쿠키 포워딩은 명확한 필요 시에만. 토큰은 URL/query/로그에 절대 노출 금지(R-A9).
- 가드 적용점은 per-route `@UseGuards` 권장(OD-7) — global+`@Public()`은 보호 라우트가 다수가 될 때만.
