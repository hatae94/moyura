# SPEC-AUTH-001 독립 감사 보고서 (plan-auditor)

> M1 Context Isolation: 작성자(orchestrator/manager-spec)의 추론 컨텍스트는 무시했다. spec.md / acceptance.md / plan.md + 저장소(read-only)만 근거로 독립 판정한다.
> 적대적 입장(adversarial): "이 SPEC에는 결함이 있다"를 기본 가정으로 두고 증거로 반증을 시도했다.
> 검증 일자: 2026-06-02. 모든 저장소 인용은 실제 파일을 읽어 확인했다.

---

## Verdict

**CONDITIONAL PASS** — 구조/EARS/추적성/범위 규율은 양호하나, **인증의 핵심인 JWT 검증 보안 명세에 BLOCKER급 공백**(alg-confusion 방지, iss/aud 검증 강제, alg:none 거부)과 **가드 적용 지점 자체의 미정의**(no-op 가드는 현재 어디에도 wiring되어 있지 않음)가 존재한다. 이 두 BLOCKER를 명세에 반영하기 전에는 구현 착수 불가.

한 줄 요약: 흐름·범위·추적성은 잘 짜였으나, "어떻게 안전하게 검증하는가"의 보안 계약이 비어 있어 인증 SPEC의 본질이 미충족이다.

---

## 심각도별 카운트

- BLOCKER: 3
- MAJOR: 6
- MINOR: 5
- NIT: 3

---

## What's good (강점)

- **범위 규율 우수**: Decision Table(#1~#9) ↔ Non-Goals ↔ Exclusions ↔ plan.md "단순성 가드레일"이 일관되게 authn-only를 강제. RBAC/RLS/email-confirm/reset/도메인 필드/DB 트리거 배제가 4개 문서에서 중복 확인됨(scope creep 거의 없음).
- **저장소 사실 검증 통과**: no-op 가드(`canActivate(): boolean { return true; }`), `SUPABASE_*` optional placeholder, `prisma.config.ts`의 `DIRECT_URL` 마이그레이션 패턴, `[auth.external.apple]` 기존 존재 + `[auth.external.google/kakao]` 부재 — 모두 SPEC 서술과 실제 파일이 일치(`apps/backend/src/auth/supabase-auth.guard.ts`, `apps/backend/src/config/env.validation.ts`, `apps/backend/prisma.config.ts`, `supabase/config.toml:322`).
- **EARS 패턴 분류 정확**: R-* 대부분이 Ubiquitous/Event-Driven/State-Driven/Unwanted/Optional 5패턴에 정확히 매핑되고 라벨도 옳다.
- **R→AC 1:1 추적성 완비**: R-A1~J3 전부 동명의 AC-* 보유. orphan AC 없음, uncovered R 없음(아래 MINOR-3의 경계 사례 제외).
- **bleeding-edge 정직성**: 검증 불가 항목을 "verify at implementation"으로 명시 격리, npm registry로 버전 검증, Sources에 실제 URL 기재. 추측 회피 태도 양호.
- **ground truth 오류 정정**: orchestrator의 "GoTrue on :54322"는 실제로는 DB 포트다(저장소 확인: `config.toml:10` api port=54321, `:35` db port=54322). SPEC은 본문/Sources에서 올바르게 `54321`을 사용 — 잘못된 입력을 맹종하지 않은 좋은 사례.
- **race 안전 명시**: R-B5/AC-B5에서 `sub` unique + 원자적 upsert로 동시성 처리, application-level lock 회피를 정확히 규정.

---

## Findings (심각도순)

### BLOCKER

#### B-1 — JWT alg-confusion / alg:none 방어 부재 (보안, group A / R-A2·A4·A5·A7)
- **위치**: spec.md R-A2, R-A4, R-A5, R-A7 / acceptance.md AC-A2, AC-A4, AC-A5
- **문제**: JWKS(ES256 비대칭) **와** 레거시 HS256 공유 시크릿을 **동시에** 수용하는 가드는 전형적인 **algorithm-confusion 공격면**이다. 명세 어디에도 (a) 토큰 `alg` 헤더를 **허용 목록으로 고정(pin)** 한다는 요구, (b) `alg:none` 거부, (c) "ES256 토큰을 HS256 경로로 우회 검증당하지 않게" 경로 분기를 잠근다는 요구가 없다. `jose`의 `jwtVerify`는 `algorithms` 옵션을 주지 않으면 광범위한 alg를 허용할 수 있어, 공격자가 JWKS 공개키(공개 정보)를 HMAC 키로 사용해 HS256 토큰을 위조하면 ES256 검증을 통과할 위험이 있다. R-A5는 "서명 검증 실패 시 401"만 말할 뿐 **어떤 alg를 신뢰하는지**를 규정하지 않는다.
- **수정안**: R-A 그룹에 신규 요구 추가 —
  - `R-A8 (Unwanted, If-then)`: *If a token's `alg` header is `none` or is not in the explicit allowlist {ES256 for the JWKS path, HS256 for the legacy path}, then the guard shall reject the request with HTTP 401 before any signature check.*
  - `R-A2` 수정: *...verify it against the JWKS using `jose` `jwtVerify` **with `algorithms: ['ES256']` pinned**, selecting the public key by `kid`...*
  - `R-A4` 수정: *...verify it using `SUPABASE_JWT_SECRET` **with `algorithms: ['HS256']` pinned**; the HS256 path shall never be attempted with a key derived from JWKS material.*
  - 경로 선택은 토큰 `alg`로 결정하되, ES256 토큰은 절대 HS256 검증기로 흘러가지 않도록 명시. 대응 AC(`AC-A8`: ES256 토큰을 HS256 시크릿으로 위조한 토큰 → 401; `alg:none` 토큰 → 401) 추가.

#### B-2 — `iss`/`aud` 검증이 요구가 아닌 "예시"로만 언급됨 (보안, R-A7 / AC-A7)
- **위치**: spec.md R-A7("standard claims such as `exp`/`aud`/`iss`"), AC-A7
- **문제**: 핵심 클레임 검증이 **정규 요구가 아니라 괄호 속 예시("such as")** 로만 등장한다. EARS 정규 요구로서 "issuer가 `<SUPABASE_URL>/auth/v1`과 일치하지 않으면 거부", "audience가 기대값(`authenticated`)이 아니면 거부", "`exp` 경과/`nbf` 미도래 시 거부"가 **명시적·테스트 가능 요구로 존재하지 않는다**. "such as"는 weasel이며, 구현자가 `iss`/`aud`를 건너뛰어도 SPEC 위반이 아니게 된다. 더불어 저장소 확인 결과 로컬 `config.toml`에 `jwt_issuer`가 비어 있고(`config.toml:167` 주석 처리) `aud` 커스텀 설정이 없어, **기대 iss/aud 값이 무엇인지 SPEC이 확정하지 않으면 검증을 켤 수도 끌 수도 없는 미결 상태**가 된다.
- **수정안**:
  - `R-A7`을 분리·강화: *The guard shall, on every request, verify the signature **and** assert (1) `exp` not in the past and `nbf`/`iat` not in the future (with bounded clock skew), (2) `iss` exactly equals the expected Supabase issuer, (3) `aud` equals the expected audience (`authenticated`), rejecting with 401 on any failure; the guard shall not call the Supabase Auth server per request.*
  - Open Decision 추가(OD-6): 기대 `iss`/`aud` 값의 출처(파생 vs env)와 로컬 GoTrue가 실제 발급하는 `iss`/`aud`를 M0 스파이크에서 관찰해 확정. 대응 AC: 잘못된 `iss` → 401, 잘못된 `aud` → 401, 만료 `exp` → 401(현재 AC-A5가 expired만 뭉뚱그림 — 분리 필요).

#### B-3 — no-op 가드가 현재 어디에도 적용되어 있지 않음 → "교체"만으로는 보호가 켜지지 않음 (정합성/feasibility, R-A1·R-C1·R-C2)
- **위치**: spec.md R-A1("replace the no-op guard"), R-C1/R-C2, AC-A1, AC-C2 / 저장소: `apps/backend/src/app.module.ts`, `app.controller.ts`, `health.controller.ts`
- **문제**: 저장소 전수 검색 결과 `SupabaseAuthGuard`는 **import/`UseGuards`/`APP_GUARD` 어디에도 wiring되어 있지 않은 dormant 클래스**다(grep: 정의 파일 외 참조 0건). SPEC은 R-A1에서 "no-op 가드를 실제 가드로 **교체**"라고만 서술하는데, **클래스 본문을 교체해도 적용 지점이 없으면 어떤 요청도 보호되지 않는다.** R-C2/AC-C2("유효 JWT 없는 `GET /me` → 401")가 성립하려면 가드를 `/me` 핸들러(또는 모듈)에 **부착**하고 `/health`는 명시적으로 제외하는 wiring이 신규 요구로 있어야 한다. 현재 SPEC에는 이 적용 메커니즘(`@UseGuards` per-route vs 글로벌 `APP_GUARD` + `@Public` 데코레이터)이 빠져 있어 구현자가 임의 해석하게 된다.
- **수정안**: group A 또는 C에 신규 요구 추가 — *The guard shall be applied to protected routes via an explicit application point (per-route `@UseGuards` on `/me`, or a global `APP_GUARD` with a `@Public()` opt-out for `/health`); `/health` shall be explicitly excluded.* 그리고 OD로 "per-route vs global+@Public" 결정 노출. AC-C3가 이미 public 경계를 검사하므로 그와 연결. (참고: 현재 `app.controller.ts`의 `GET /`(getHello)도 존재 — 이 라우트의 보호 여부도 명시 필요.)

---

### MAJOR

#### M-1 — `/health` public 보장: 글로벌 가드 도입 시 누수 위험 미명세 (보안/정합성, R-C3 / K9)
- **위치**: R-C3, AC-C3, Risks K9 / 저장소 `health.controller.ts`, `app.controller.ts`
- **문제**: B-3과 연동. 만약 구현이 글로벌 `APP_GUARD`를 택하면 `/health`와 `GET /`(getHello)가 **기본 보호되어** SPEC-ENV-SETUP-001의 public health 계약을 깨뜨린다(Render health check 경로 — `health.controller.ts`의 @MX:ANCHOR가 "Render health check path"라고 명시). K9는 위험을 인지하나 **public allowlist를 어떻게 구현하는지**(예: `@Public()` 메타데이터 + Reflector)를 요구로 못박지 않았다.
- **수정안**: R-C3를 "guard application point가 글로벌이면 `/health`와 기존 무인증 라우트(`GET /`)는 명시적 public opt-out을 가져야 한다"로 강화. AC-C3에 `GET /`(getHello)도 public 회귀 검사 대상으로 추가.

#### M-2 — Bearer 토큰 누출/로깅/HTTPS 보안 AC 전무 (보안, group A·D / OD-3)
- **위치**: R-D4, OD-3(Bearer 권장), R-A6 / acceptance.md 전반
- **문제**: OD-3가 Bearer 헤더를 권장하지만, **토큰 위생(hygiene) 요구가 0건**이다: (a) 토큰을 URL/쿼리스트링에 절대 싣지 않음, (b) 로그/에러 응답/APM에 토큰·`Authorization` 헤더를 기록하지 않음, (c) prod는 HTTPS 전송 강제, (d) 검증 실패 401 응답 본문에 토큰 내용/디코드 결과를 에코하지 않음. 인증 SPEC에서 이는 기본 방어선인데 누락됐다.
- **수정안**: group A에 신규 요구 — *The system shall never place the JWT in a URL/query string, shall never log the `Authorization` header or token payload, shall require HTTPS for token transport in production, and 401 responses shall not echo token contents.* 대응 AC(로그 grep로 토큰 부재 확인, URL에 토큰 부재 확인) 추가.

#### M-3 — JWKS fetch 실패/타임아웃 처리 미정의 — 폴백 다운그레이드 위험 (보안/feasibility, R-A3 / AC-H3·Edge Cases)
- **위치**: R-A3, AC-H3, acceptance.md Edge Cases("JWKS fetch 실패 시 HS256 폴백으로 전환")
- **문제**: **이것이 보안상 미묘하게 위험하다.** acceptance.md Edge Cases는 "JWKS fetch 실패 → HS256 폴백 전환"을 정상 동작처럼 적었다. 그러나 prod(비대칭 키 운영)에서 JWKS 엔드포인트가 일시 장애일 때 **자동으로 HS256 폴백으로 내려가면**, 공격자가 JWKS를 의도적으로 마비시켜(또는 네트워크 가로채기) HS256 위조 토큰 경로를 강제 활성화할 수 있는 **다운그레이드 공격**이 된다. fetch 실패는 "폴백 전환"이 아니라 "ES256 토큰은 일시적으로 503/401 처리(폴백 금지)"가 안전하다. 또한 fetch 타임아웃/재시도/회로차단 정책이 없다.
- **수정안**: R-A3에 명시 — *On JWKS fetch failure, the guard shall fail closed for ES256-signed tokens (reject, do NOT silently downgrade to the HS256 path); the HS256 path applies only to tokens actually signed HS256 when `SUPABASE_JWT_SECRET` is configured.* acceptance.md Edge Cases의 "JWKS fetch 실패 → HS256 폴백 전환" 문장을 정정. JWKS fetch 타임아웃/재시도 정책 명시(`createRemoteJWKSet` cooldown/timeout 옵션).

#### M-4 — config.toml redirect allowlist 호스트/스킴 불일치, SPEC 미반영 (정합성/feasibility, R-H2·R-D2 / config.toml)
- **위치**: spec.md R-H2, R-D2, OD-5, Env Matrix(`http://localhost:3000/auth/callback`) / 저장소 `config.toml:159,163`
- **문제**: SPEC은 콜백을 반복적으로 `http://localhost:3000/auth/callback`로 적지만, 실제 `config.toml`은 `site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls = ["https://127.0.0.1:3000"]`이다. GoTrue redirect allowlist는 **정확 일치(exact match)** 이며 `localhost` ≠ `127.0.0.1`(별개 origin), 게다가 기존 항목은 `https`(127.0.0.1에 TLS 없음 → 로컬 실패). SPEC R-H2는 "콜백 라우트를 allowlist에 포함"만 말할 뿐 **기존 127.0.0.1/https 항목과의 호스트·스킴 정합**을 다루지 않아, 구현자가 `localhost`로 적으면 PKCE 콜백이 조용히 실패한다.
- **수정안**: R-H2에 "콜백 URL의 host literal은 `config.toml` `site_url`과 동일 표기(127.0.0.1 또는 localhost 중 택1)로 통일하고, 로컬 콜백은 `http` 스킴 + 정확 경로(`/auth/callback`)로 `additional_redirect_urls`에 추가한다"를 명시. Env Matrix의 `http://localhost:3000/auth/callback`을 `http://127.0.0.1:3000/auth/callback`로 정정(또는 두 host 모두 등록).

#### M-5 — profile 모델 `id`/`sub` 관계 모호 — 클라이언트 위조 키 방지 계약 불명확 (보안/정합성, R-B1·R-B3 / plan.md M2)
- **위치**: R-B1("keyed by / referencing the `sub`... fields `id`, `createdAt`"), plan.md M2("`id`(= `sub` 또는 `sub` 참조 unique)")
- **문제**: profile의 키 모델이 **두 갈래로 모호**하다: `id`가 곧 `sub`인가, 아니면 별도 `id` + `sub` unique 컬럼인가. plan.md도 "`sub` 또는 `sub` 참조"로 미확정. 보안상 핵심은 **upsert 키가 반드시 검증된 JWT의 `sub`에서만 와야 하고 클라이언트 입력(본문/쿼리)에서 절대 오지 않아야 한다**는 점인데, R-B3/AC-B3는 "verified JWT의 `sub`로 upsert"라고 적지만 **"client-supplied sub 금지" 및 mass-assignment 금지**가 명시 요구로 없다. `GET /me`는 본문이 없어 당장은 안전하나, 계약으로 못박지 않으면 후속 라우트에서 누출된다.
- **수정안**: R-B1을 단일 해석으로 확정(권장: `id`를 PK로 두고 `sub`에 unique 제약, 또는 `sub` 자체를 PK). R-B3에 *The UPSERT key shall be sourced exclusively from the guard-attached verified `sub` (never from request body/query/header); no client-supplied field shall be mass-assigned to the profile.* 추가. 대응 AC(본문에 임의 `sub` 주입 시 무시되고 토큰 `sub`로만 upsert) 추가.

#### M-6 — PKCE state/code_verifier 검증이 AC 수준에서 falsifiable하지 않음 (보안, R-D2 / AC-D2)
- **위치**: R-D2, AC-D2
- **문제**: R-D2는 `exchangeCodeForSession(code)`만 말한다. PKCE의 보안 본질인 **code_verifier 보관/검증, state(CSRF) 일치 검증, 콜백에서 `error`/`error_description` 처리**가 요구·AC에 없다. `@supabase/ssr`가 내부 처리한다 해도, "콜백 라우트가 state 불일치/누락 code/error 파라미터를 거부한다"는 negative AC가 없으면 검증 불가. (E그룹 R-E4는 모바일 복귀 실패만 다룸 — 웹 콜백 음성 경로는 비어 있음.)
- **수정안**: R-D2에 음성 요구 추가 — *If the callback receives an `error` param, a missing/invalid `code`, or a state/PKCE mismatch, then the route shall not establish a session and shall surface a recoverable error.* 대응 AC(잘못된 code → 세션 미확립, error 파라미터 → 미확립) 추가.

---

### MINOR

#### m-1 — AC-A5가 4개 실패 케이스를 하나로 뭉침 — exp/aud/iss 음성 케이스 분리 필요 (testability, AC-A5)
- **위치**: AC-A5
- **문제**: "missing/expired/malformed/bad-signature"를 한 AC에 묶음. B-1/B-2 신설 요구(alg:none, 잘못된 iss/aud, nbf)에 대한 **개별 falsifiable AC**가 없으면 보안 회귀 테스트가 누락된다.
- **수정안**: AC-A5를 케이스별로 분해(각 케이스 → 독립 401 테스트)하고 alg:none/wrong-iss/wrong-aud/expired/nbf-future를 명시 항목으로 추가.

#### m-2 — R-A7 ↔ AC-A2 "round-trip 없음"의 측정 기준 모호 (testability, R-A2·A7 / AC-A2·A7)
- **위치**: AC-A2("네트워크 호출 횟수 단위테스트/관찰"), AC-A7
- **문제**: "per-request 라운드트립 없음"을 어떻게 PASS/FAIL 판정하는지 구체 기준이 약하다. JWKS 최초 fetch 1회는 허용, 요청당 추가 fetch 0회가 기준임을 명확히 해야 측정 가능.
- **수정안**: AC-A2/A7에 "N개 연속 요청 처리 시 JWKS fetch 호출 수 ≤ 1(+kid-miss 시 1회 갱신), Auth 서버 introspection 호출 = 0"으로 정량화.

#### m-3 — R-F4/AC-F4의 콜백 URI와 R-D2 웹 콜백 라우트 혼동 가능 (정합성, R-F4 vs R-D2)
- **위치**: R-F4(`<SUPABASE_URL>/auth/v1/callback`), R-D2(`/auth/callback` 웹 라우트)
- **문제**: GoTrue provider 콜백(`/auth/v1/callback`, Supabase가 IdP로부터 받는 곳)과 앱 PKCE 콜백(`/auth/callback`, 브라우저가 code를 받는 곳)은 **다른 두 URL**인데, 문서가 둘을 인접 배치해 구현자가 혼동하기 쉽다. 명시적 구분 문장이 없다.
- **수정안**: R-F4에 "이 URI는 provider→Supabase 콜백이며, 앱→브라우저 PKCE 콜백(R-D2 `/auth/callback`)과 구분된다"는 한 줄 추가.

#### m-4 — `GET /me` 응답 스키마/profile 필드 미정의로 OpenAPI 재생성 AC 모호 (testability, R-C1 / DoD)
- **위치**: R-C1, AC-C1("`sub` 기반 profile 포함"), DoD("OpenAPI 재emit")
- **문제**: `/me` 응답 본문 형태(어떤 필드를 노출하는지: `id`, `createdAt`, `sub` 에코 여부)가 미정의. AC-C1은 "profile 포함"만 말함. 보안 관점에서 토큰 원문/민감 클레임을 응답에 싣지 않는다는 제약도 없음.
- **수정안**: R-C1에 응답 DTO 필드 집합 명시(최소 필드), "토큰 원문/raw 클레임 비노출" 제약 추가.

#### m-5 — frontmatter `status: draft`인데 plan.md는 실행 준비 완료 톤 (정합성, frontmatter)
- **위치**: spec.md:3 `status: draft`
- **문제**: BLOCKER 미해결 상태에서 plan.md가 M0~M9 실행 분해를 확정 톤으로 제시. draft↔plan 성숙도 간 미세 불일치(감사 통과 전 run 착수 위험 신호).
- **수정안**: BLOCKER 반영 전까지 `draft` 유지, 반영 후 `active` 승격을 DoD에 연결.

---

### NIT

- **n-1** — frontmatter에 `labels` 필드 부재(다른 MoAI SPEC 규약 대비). `id/version/status/created/priority`는 존재. 영향 경미하나 규약 일관성 위해 `labels: [auth, supabase, backend, web, mobile]` 권장.
- **n-2** — Env Matrix에서 `SUPABASE_AUTH_EXTERNAL_*_SECRET`의 scope를 "backend/config (seam)"로 적었으나, 이 값은 GoTrue(config.toml `env()`)가 소비하며 NestJS backend는 소비하지 않음 → "supabase config (seam)"가 정확.
- **n-3** — HISTORY 항목이 단일 v0.1.0뿐이라 "verify at implementation" 결과를 기록할 자리만 예고됨. 감사 수정 반영 시 v0.2.0 HISTORY 라인 추가 권장.

---

## 우선순위 수정 리스트 (Prioritized Fix-List)

1. **(B-1)** alg pinning + alg:none 거부 + ES256/HS256 경로 분리 잠금 — R-A8 신설, R-A2/A4에 `algorithms` 고정.
2. **(B-2)** `iss`/`aud`/`exp`/`nbf` 검증을 "such as" 예시 → 정규 강제 요구로 승격 — R-A7 재작성 + OD-6(기대 iss/aud 출처) + 케이스별 AC.
3. **(B-3)** 가드 적용 지점 명세 — per-route `@UseGuards`(/me) vs 글로벌 `APP_GUARD`+`@Public`(/health, `GET /`) 결정을 요구·OD로 노출.
4. **(M-3)** JWKS fetch 실패 시 ES256 토큰 fail-closed(HS256 다운그레이드 금지) — R-A3 강화 + acceptance.md Edge Cases 정정.
5. **(M-5)** profile upsert 키는 검증된 `sub` 전용·client-supplied 금지·mass-assignment 금지 — R-B1 단일 해석 확정 + R-B3 보강.
6. **(M-2)** Bearer 토큰 위생(로그/URL/HTTPS/401 에코 금지) 요구 + AC 신설.
7. **(M-6)** 웹 PKCE 콜백 음성 경로(state/error/invalid code) 요구 + AC 신설.
8. **(M-4)** config.toml host/scheme 정합(127.0.0.1 vs localhost, https→http) — R-H2 정정 + Env Matrix 콜백 URL 정정.
9. **(M-1)** 글로벌 가드 채택 시 `/health`·`GET /` public opt-out 강제 — R-C3 강화 + AC-C3 확장.
10. **(m-1~m-5, n-1~n-3)** AC 분해/정량화, 응답 DTO 명시, 콜백 URI 구분, frontmatter/labels, scope 표기 정정.

---

감사자 메모: 본 SPEC은 "흐름·범위·문서 구조"는 상위 10% 수준이나, **인증 SPEC의 본질인 검증 보안 계약(alg/iss/aud/downgrade/적용지점)이 비어 있다.** 이는 문서 품질과 무관한 must-fix이며, 위 3개 BLOCKER 반영 전 `/moai run` 착수를 권하지 않는다.
