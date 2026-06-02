# SPEC-AUTH-001 평가 보고서 (Independent / Security-Weighted)

> 평가자: evaluator-active (skeptical, strict). 작성일: 2026-06-02.
> 코드를 fresh 하게 읽고, 백엔드 테스트(53개)를 직접 실행했으며, 독립적인 적대적 토큰 공격(14종)을
> 자체 스크립트로 작성·실행하고, 라이브 Supabase 스택 대상 종단 증명을 직접 수행했다.
> 어떤 요약도 신뢰하지 않고 모든 핵심 주장을 코드/런타임 증거로 재검증했다.

## 종합 판정: PASS (security gate 통과)

보안 차원에서 실제 우회(bypass)를 찾지 못했다 — 14종 적대적 공격이 모두 차단됨을 독립 실행으로 확인했다.
기능/일관성도 라이브 종단 증명으로 입증되었다. 다만 craft 차원에서 web/mobile/api-client의 자동화
테스트 부재(MAJOR)와 HTTPS-in-prod 강제 미구현(MINOR)이 있으나, 어느 것도 보안 우회나 AC 미충족이
아니므로 overall FAIL을 유발하지 않는다.

## 차원별 점수

| 차원 | 점수 | 판정 | 핵심 증거 |
|------|------|------|-----------|
| Functionality (40%) | 0.95 | PASS | 백엔드 53 테스트 그린 + 라이브 종단 증명(no-token→401, 라이브 ES256→200+profile, public 경계 유지) 직접 실행 확인 |
| Security (25%, HARD) | 0.97 | PASS | 독립 적대적 14종(alg-confusion 2종/alg:none 2종/tamper/wrong-key/JWKS fail-closed/wrong iss·aud/expired/forged-HS256/secret-unset) 전부 null 거부 확인 |
| Craft (20%) | 0.78 | PASS(경계) | 백엔드 커버리지 95.71% stmt / 86.66% branch (>85% 게이트 충족). 단 web/mobile/api-client 자동 테스트 0개 |
| Consistency (15%) | 0.93 | PASS | NestJS guard/module 패턴, Prisma 7 dual-URL, Zod env 게이트, @MX 태그, Next 16 proxy.ts 컨벤션 정확 준수 |

## 1. Functionality (0.95 / PASS)

직접 실행한 증거:

- `pnpm --filter @moyura/backend test` → 9 suites / 53 tests 전부 PASS (직접 실행).
- 라이브 종단 증명(`test/me.live.mts`)을 가동 중인 Supabase 스택 대상으로 직접 실행:
  - `GET /me` (no token) → 401 (가드 실제 enforce)
  - `GET /me` (라이브 GoTrue ES256 토큰) → 200, body.id = 검증된 sub(`15ebe4ba-...`), DB-backed createdAt
  - `GET /` → 200 "Hello World!", `GET /health` → 200 {db:up} (public 경계 보존)
- 라이브 DB 직접 쿼리(docker exec): profile row 정확히 1개 / 비내부 트리거 0개 / 컬럼 = {id, createdAt}만.
  → AC-B1(단일 키 최소 모델), AC-B3(Nest UPSERT, 트리거 아님), AC-B4(멱등) 라이브 입증.
- 가드 배선(AC-A10/C2): per-route `@UseGuards(SupabaseAuthGuard)` on `MeController` (me.controller.ts:27),
  global APP_GUARD 미사용(auth.module.ts) → /health·GET / 구조적 public(fail-safe).
- env fail-fast(AC-I3): env.validation.spec.ts가 누락/잘못된 SUPABASE_URL/ANON_KEY/DB_URL 등 throw 검증.
- OpenAPI 재emit: openapi.json에 `/me` + `ProfileResponseDto` 존재(직접 grep 확인).

미세 감점 사유: web/mobile 흐름(D/E/G)은 코드상 올바르나(아래 일관성 참조) 자동 테스트로 회귀 보호되지
않아 "구현됨"은 코드 리뷰 + 라이브 백엔드로만 입증된다(웹 PKCE 음성 경로는 순수 함수로 분리되어 있으나
테스트 미작성).

## 2. Security (0.97 / PASS) — HARD gate 통과

독립 적대적 검증 (자체 작성 스크립트로 실제 `TokenVerifierService`를 공격, 실행 후 삭제):

| 공격 | 결과 |
|------|------|
| valid ES256 (control) | PASS(통과) |
| alg-confusion: 공개 JWK 바이트를 HMAC 시크릿으로 HS256 위조 | 차단(null) |
| alg-confusion: raw x\|\|y 좌표 바이트를 HMAC 시크릿으로 | 차단(null) |
| alg:none unsecured 토큰 | 차단(null) |
| alg:None (대문자 변형) | 차단(null) |
| payload tamper (서명 후 sub 교체) | 차단(null) |
| 다른 ES256 키로 서명 + 동일 kid 재사용 | 차단(null) |
| JWKS fetch 실패 + ES256 토큰 (HS256 시크릿 설정됨) | 차단(null) — fail-closed, 다운그레이드 없음 |
| wrong iss / wrong aud / expired(skew 초과) | 각각 차단(null) |
| forged HS256 (틀린 시크릿) | 차단(null) |
| correct HS256 (control) | 통과 |
| ES256 + HS256 시크릿 미설정 | 차단(null) |

근거 코드:
- alg 화이트리스트가 서명 검증 **이전**에 동작(token-verifier.service.ts:98-101). ES256/HS256만 통과.
- `verify()`가 alg 헤더로 경로를 라우팅(L103-106) → ES256 토큰은 절대 HS256 경로로 가지 않음 →
  공개키-as-HMAC alg-confusion 원천 차단(R-A4). HS256 경로는 실제 SUPABASE_JWT_SECRET만 사용(L153).
- ES256 경로는 `algorithms:['ES256']` + issuer + audience + clockTolerance 고정(L126-131).
- JWKS 실패는 catch에서 무조건 null 반환(L133-143) — HS256 폴백 미발동(fail-closed, R-A3/M-3).
  라이브 로그 "JWKS verification failed — failing closed (no HS256 downgrade)"로 동작 확인.
- 토큰 read는 Authorization Bearer 전용(supabase-auth.guard.ts:56-63). request.query/params 미사용
  (token-hygiene.spec.ts grep 검증 + 직접 grep 재확인).
- 토큰/Authorization 헤더 미로깅: logger 호출은 고정 문자열만(L99, L137), 토큰 보간 없음.
  401은 `new UnauthorizedException()` 기본 메시지 — 토큰 echo 없음(L41,47).
- mass-assignment 차단: profile.service.ts:21-28 upsert는 `{ where:{id:sub}, create:{id:sub}, update:{} }`만.
  me.controller.ts:35는 가드-부착 `user.sub`만 전달. body/query/header의 sub/id는 닿지 않음.
  통합 테스트(me.controller.spec.ts:123-143)가 query+body+header 동시 poisoning을 검증된 sub만 사용함을 증명.
- 시크릿 비커밋: config.toml의 google/apple/kakao 전부 `enabled=false` + `env(...)` (직접 read).
  .env 3종 모두 gitignore(git check-ignore 확인) + 값은 공개 supabase-demo 로컬 디폴트(실 시크릿 아님).
  public env(NEXT_PUBLIC/EXPO_PUBLIC)에 SECRET/JWT 노출 0건(소스 grep).
- 웹 PKCE 음성 경로: callback/route.ts가 error param/누락 code(resolveCallbackOutcome)/교환 실패에
  세션 미확립 + /login?error 복구 redirect. open-redirect 방지(safeNextPath, L15-24)까지 포함.

보안 결론: 실제 bypass 미발견. 가드는 실제로 배선되어 enforce하며, 검증 경계는 적대적 입력에 견고하다.

## 3. Craft (0.78 / PASS 경계)

- 백엔드 커버리지(직접 측정): auth/profile/env 단위 95.71% stmt, 86.66% branch, 95.31% line — 85% 게이트 충족.
  미커버 라인은 onModuleInit/buildAuthConfig boot 경로(L58-63, L42-44)로, 테스트 seam(configureForTest)이
  의도적으로 우회 → live 스크립트가 그 경로를 별도 입증. 합리적.
- 에러 핸들링: 검증 실패는 사유 비노출 null 반환, 가드가 401 throw로 일원화. 웹 actions/callback는
  try/error 분기로 음성 경로 처리. 모바일 oauth는 cancel/error를 throw 아닌 결과 분류(R-E4).
- 코드 명료성: 단일 책임 분리(verifier=검증 경계, guard=enforce, service=upsert), 과한 추상화 없음.
  test-tokens.helper.ts로 적대적 픽스처를 결정적으로 구성 — 우수.
- 감점: web/mobile/api-client 자동 테스트 0개(project.json에 test 타깃 부재 확인). `resolveCallbackOutcome`,
  `resolveSupabaseConfig`/`resolveApiBaseUrl`, `launchSocialOAuth` 결과 분류, api-client Bearer 주입은 모두
  순수/테스트 가능하게 설계되었으나 테스트가 없어 회귀 보호 부재.

## 4. Consistency (0.93 / PASS)

- NestJS: Module/Guard/ParamDecorator/DTO 패턴 정석. AuthModule이 provider export → ProfileModule이
  per-route 주입(OD-7 선택지 A) — SPEC 결정과 일치.
- Prisma 7: schema.prisma generator(cjs)/datasource 분리, dual-URL(prisma.config.ts), 첫 도메인 마이그레이션
  생성·적용. id PK = sub 단일 키(M-5) 일관.
- Zod env 게이트: 기존 SPEC-ENV-SETUP-001 패턴 계승, SUPABASE_URL/ANON_KEY required 승격(R-I1).
- Next 16: server/client/proxy.ts 컨벤션 정확(middleware.ts→proxy.ts 변경 반영 — AGENTS.md 지침 준수).
  cookies() async, setAll 2-인자(0.10.3) 정확. proxy.ts matcher로 updateSession 실제 배선 확인.
- @MX 태그: ANCHOR(보안 경계/upsert/env/health), NOTE, WARN(REASON 포함) 적절. code_comments=ko 준수.
- 네이밍/스타일: lint(eslint) + typecheck(tsc) 백엔드·웹 모두 exit 0(직접 실행).

## Findings (severity별)

### BLOCKER
- 없음.

### MAJOR
- **[MAJOR] web/mobile/api-client 자동화 테스트 전무** — `apps/web/project.json`, `apps/mobile/project.json`,
  `packages/api-client/project.json`에 test 타깃 자체가 없음. 테스트 가능하게 분리된 순수 함수
  (`apps/web/lib/auth/callback.ts:resolveCallbackOutcome`, `apps/web/lib/env.ts:resolveSupabaseConfig/resolveApiBaseUrl`,
  `apps/mobile/lib/auth/oauth.ts:launchSocialOAuth` 결과 분류, `packages/api-client/src/index.ts` Bearer 주입)이
  회귀 보호되지 않는다. AC-D6/D7(PKCE 음성 경로), AC-I4(public env 분리), AC-D4(Bearer 주입)는 코드상 충족이나
  자동 검증 부재.
  - Fix: vitest/jest 테스트 타깃 추가. 최소: `resolveCallbackOutcome`(error param / 누락 code / 정상 code),
    `resolveSupabaseConfig`(누락 throw), `ApiClient.request`(getToken→Bearer 주입, 토큰 부재 시 헤더 미부착,
    Authorization 직접 지정 시 미덮어쓰기), `launchSocialOAuth`(success/cancel/error 분류).

### MINOR
- **[MINOR] HTTPS-in-production 미강제 (AC-A9 point 3 / R-A9)** — R-A9는 "prod에서 auth 요청 HTTPS 요구"를
  명시하나, `apps/backend/src/main.ts`·app.module.ts 어디에도 HSTS/secure-cookie/forceHttps/x-forwarded-proto
  강제가 없다(직접 grep 확인: helmet/trust proxy/Strict-Transport 0건). 로컬은 http가 설계상 정상이지만,
  prod 가드(예: NODE_ENV==='production'일 때 x-forwarded-proto!=='https' 거부 또는 helmet HSTS)가 없어
  R-A9 4개 항목 중 3번이 명시적으로 충족되지 않는다(나머지 1·2·4는 충족).
  - Fix: main.ts에서 prod일 때 helmet() + HSTS 적용, 또는 TLS-terminating proxy 가정 시 그 사실을
    spec HISTORY/배포 문서에 기록(verify-at-implementation 항목으로 명문화).
- **[MINOR] me.live.mts에 service_role 키 하드코딩** — `apps/backend/test/me.live.mts:22`에 로컬
  service_role JWT가 리터럴로 박혀 있다. 값 자체는 공개 supabase-demo 로컬 키(실 시크릿 아님)이고 테스트
  스크립트 한정이라 위험은 낮으나, 패턴상 env 참조가 바람직하다.
  - Fix: `process.env.SUPABASE_SERVICE_ROLE_KEY ?? <fallback>`로 치환.

## What's solid (잘 된 점)

- JWT 검증 경계가 실제로 견고하다 — 독립 적대적 14종 전부 차단. alg-confusion을 alg-라우팅으로 구조적
  차단하고, JWKS 실패를 진짜 fail-closed로 처리(HS256 다운그레이드 유혹을 시크릿 설정 상태에서도 거부).
- 가드가 dormant가 아니라 실제 enforce — 라이브 no-token→401로 입증. B-3(미배선) 결함이 실제 해소됨.
- mass-assignment가 구조적으로 불가능 — service가 sub 외 어떤 클라이언트 필드도 받지 않고, 통합 테스트가
  query+body+header 동시 poisoning을 막아냄을 증명.
- 토큰 위생 철저 — Bearer 전용, 미로깅, 401 미echo, live 스크립트조차 토큰 redact.
- 라이브 종단 증명이 실재 — 가동 스택 대상 실제 GoTrue ES256 토큰으로 /me 200 + DB row 1개 입증.
- Next 16 breaking change(proxy.ts)를 정확히 반영하고 updateSession을 실제 배선.
- 시크릿 비커밋/비노출 일관 — config.toml env(), .env gitignore, public-env 누출 0.
