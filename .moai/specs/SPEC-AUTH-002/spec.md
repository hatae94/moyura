---
id: SPEC-AUTH-002
version: 0.1.0
status: draft
created: 2026-06-05
updated: 2026-06-05
author: hatae
priority: medium
issue_number: null
---

# SPEC-AUTH-002: 실제 소셜 OAuth 키 배선 (로컬 우선, Google + Apple)

## HISTORY

- 2026-06-05 (v0.1.0): 최초 작성 (draft). SPEC-AUTH-001(completed)이 남긴 소셜 OAuth flow + config 스캐폴드(`[auth.external.google]`/`[auth.external.apple]` `enabled = false`, `env()` 치환만 배선)와 SPEC-LOGIN-UI-001(completed)이 만든 Google/Apple 버튼(`<form action={signInWithOAuthAction}>` + hidden `provider`)을 입력으로 받아, **실제 provider 키를 로컬 스택에 배선**해 두 버튼이 진짜 IdP authorize URL 로 진입하게 만든다. 범위 = **설정 + 시크릿 배선 + 종단 검증**(신규 코드 경로 없음). **로컬 개발 우선** — 로컬 Supabase CLI 스택(127.0.0.1) 대상. prod 키/배포 redirect 도메인은 범위 밖(follow-up). 핵심 사실: 로컬 GoTrue provider 콜백 = `http://127.0.0.1:54321/auth/v1/callback`(config.toml `[api] port = 54321`, SPEC-AUTH-001 spike 관찰값). Google 은 실제 Google Cloud OAuth 2.0 Web Client(client_id + secret) 필요 — "test" provider 없음. Apple 은 Apple Developer Program 멤버십 + Services ID(client_id) + Team ID + Key ID + `.p8` 키로 ES256 서명한 **client secret JWT**(6개월 만료) 필요. 로컬 CLI `[auth.external.apple]` 가 정적 JWT 를 받는지/키파일 기반 생성을 지원하는지는 공식 문서 미명시 → 구현 시 검증(OD-3).

---

## Background (배경)

`moyura`는 SPEC-AUTH-001(completed, v0.3.0)에서 웹 레이어가 소유하는 단일 인증 surface(`@supabase/ssr` 쿠키 세션 + PKCE 콜백)를 구축한 pnpm + Nx 모노레포다. 그 SPEC 은 소셜 OAuth 를 **flow + config 스캐폴드만** 구축하고 실제 provider 키는 named follow-up 으로 연기했다(SPEC-AUTH-001 R-F3). SPEC-LOGIN-UI-001(completed)은 그 위에 Google/Apple 버튼 UI 를 얹었다. 이 SPEC 이 그 연기된 follow-up 이다.

**입력으로 받는 기존 자산 (통합 surface — 변경 최소화 대상):**

- `apps/web/lib/auth/actions.ts:79` — `signInWithOAuthAction(formData: FormData)`. hidden `provider` 필드(union `"google"|"apple"|"kakao"`)를 읽어 `supabase.auth.signInWithOAuth({ provider, options: { redirectTo: CALLBACK_URL } })` 호출. `error || !data.url` 이면 `/login?error=oauth_${provider}_unavailable` 로 복구 redirect, 아니면 `data.url`(provider authorize URL)로 redirect. **[EXISTING] 이 SPEC 은 이 함수를 변경하지 않는다.**
- `apps/web/lib/auth/actions.ts:14` — `const CALLBACK_URL = "http://127.0.0.1:3000/auth/callback"`. 하드코딩된 로컬 리터럴(웹 PKCE 콜백 라우트, GoTrue `additional_redirect_urls` 와 exact-match). 로컬 우선 범위에서 이 리터럴은 **그대로 유효**하다. **[EXISTING] 변경 없음**(prod 일반화는 OD-4).
- `apps/web/app/auth/callback/route.ts` + `apps/web/lib/auth/callback.ts` (`resolveCallbackOutcome`) — 기존 PKCE 콜백 Route Handler + 순수 분기 함수. 음성 경로(error param / 누락 code / 교환 실패) + 정상 code 교환 처리. **[EXISTING] 이 SPEC 은 이 파일들을 변경하지 않는다.** 실제 키 배선 후 정상 경로(code 교환)가 처음으로 실행되지만, 코드 변경은 없다.
- `apps/web/app/login/login-form.tsx` (SPEC-LOGIN-UI-001) — Google/Apple 버튼을 `<form action={signInWithOAuthAction}>` + hidden `provider` 로 렌더. **[EXISTING] UI 변경 없음.** 이 SPEC 은 그 버튼이 "도달하는 곳"(미배선 → 실제 IdP)만 바꾼다.
- `supabase/config.toml` — `[auth]`(`site_url = "http://127.0.0.1:3000"`, `additional_redirect_urls` 에 웹 콜백 + 모바일 deep-link 등록), `[auth.external.google]`/`[auth.external.apple]`/`[auth.external.kakao]` 블록(현재 모두 `enabled = false`, `client_id`/`secret` 은 `env(...)` 치환). google/apple 둘 다 `skip_nonce_check = false`(config 주석: nonce skip 은 "로컬 Google 로그인에 필요"). **[MODIFY] 이 SPEC 의 주 변경 파일.**
- `supabase/README.md` + root `package.json` (`db:start` = `supabase start`, `db:status` = `supabase status`) — 로컬 스택 lifecycle. `supabase start` 출력에 API URL(54321) 등 표시.

**스캐폴드가 이미 정의한 env 변수명 (config.toml `env(...)` — 이 SPEC 이 실제 값을 채울 대상):**

| provider | client_id env | secret env |
|----------|---------------|------------|
| google | `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` | `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` |
| apple | `SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID` | `SUPABASE_AUTH_EXTERNAL_APPLE_SECRET` |

**핵심 사실 — 로컬 GoTrue provider 콜백 URI (provider 콘솔의 authorized redirect 에 등록할 값):**

```
http://127.0.0.1:54321/auth/v1/callback
```

이것은 웹 앱 콜백(`http://127.0.0.1:3000/auth/callback`, `redirectTo`)과 **다르다**. OAuth 왕복은 2-홉이다:

```
[1] 브라우저 ── signInWithOAuth(redirectTo=127.0.0.1:3000/auth/callback) ──▶ data.url (IdP authorize URL)
[2] IdP 동의 완료 ──▶ http://127.0.0.1:54321/auth/v1/callback  (GoTrue, provider 콘솔에 등록)
[3] GoTrue ── ?code= ──▶ http://127.0.0.1:3000/auth/callback   (웹 PKCE 콜백, redirectTo)
[4] 웹 콜백 ── exchangeCodeForSession ──▶ 쿠키 세션 확립 ──▶ /me
```

provider 콘솔(Google Cloud / Apple Developer)의 "authorized redirect URI" 에는 **[2]의 GoTrue URI** 를 등록해야 하고, GoTrue `additional_redirect_urls`(이미 등록됨)는 **[3]의 웹 콜백**을 허용한다.

## Goal (목표)

로컬 Supabase CLI 스택(127.0.0.1)에서 `[auth.external.google]`/`[auth.external.apple]` 를 `enabled = true` 로 활성화하고, 실제 Google Cloud OAuth Web Client 와 실제 Apple Services ID + ES256 client-secret JWT 를 정의된 env 변수(`env(...)` 치환)로 주입해, SPEC-LOGIN-UI-001 의 Google/Apple 버튼이 **진짜 IdP authorize URL 로 진입**하고(미배선 시의 `?error=oauth_*_unavailable` 가 더 이상 발생하지 않음), 사람이 동의를 완료하면 기존 PKCE 콜백 경로를 거쳐 쿠키 세션이 확립되어 `/me` 로 도달함을 증명한다. **신규 server action / 세션 / 콜백 코드는 만들지 않는다** — 기존 `signInWithOAuthAction` + 기존 콜백을 그대로 재사용한다. 시크릿 실제 값은 사용자가 out-of-band 로 채우며, 이 SPEC 은 변수명 + 배선 + 채우기 절차 + 검증을 정의한다.

## Non-Goals (범위 밖)

IN SCOPE (이 SPEC 에서 구축):
- `supabase/config.toml` 의 `[auth.external.google]`/`[auth.external.apple]` `enabled = true` 활성화 + `env(...)` 치환 유지(시크릿 인라인 금지).
- 정의된 env 변수(GOOGLE/APPLE × CLIENT_ID/SECRET)의 로컬 주입 경로(gitignore 된 로컬 env 파일 + `supabase start` 가 이를 읽는 절차) 정의.
- provider 콘솔 설정 절차 문서화: Google Cloud OAuth Web Client 생성 + GoTrue 콜백 URI 등록, Apple Services ID + Team/Key ID + `.p8` → ES256 secret JWT 생성.
- 로컬 스택 검증(자동화 가능): `supabase start`/`supabase status` 가 활성화된 config 를 수용, 버튼이 IdP authorize redirect 를 개시, 미설정 시 음성 경로 유지, 콜백 음성 경로 불변.
- 종단 검증 절차(수동): Google/Apple 동의 → 쿠키 세션 → `/me`.

OUT OF SCOPE (이 SPEC 에서 제외 — Exclusions):
- **신규 server action / 세션 로직 / 콜백 코드 없음.** 기존 `signInWithOAuthAction`(`actions.ts:79`) + 기존 콜백(`route.ts`, `callback.ts`) 재사용. 신규 코드 경로 0.
- **prod OAuth 키 / 배포 redirect 도메인 / 호스팅 config 없음.** 로컬 우선만(127.0.0.1, http). prod authorize/redirect 도메인 + HTTPS + 키 vault 는 follow-up SPEC(OD-4).
- **Kakao 없음.** SPEC-LOGIN-UI-001 UI 에서도 Kakao 는 제외됐다. `[auth.external.kakao]` 는 손대지 않고 `enabled = false` 유지.
- **`CALLBACK_URL` 리터럴 일반화 없음.** `actions.ts:14` 의 `http://127.0.0.1:3000/auth/callback` 하드코딩은 로컬 범위에서 유효하므로 변경하지 않는다(OD-4 로 연기).
- **UI 변경 없음.** login-form.tsx 버튼은 이미 존재. 시각/마크업 변경 0.
- **이메일 확인 / 비밀번호 재설정 / RBAC / 신규 provider scope·claim 없음.** 별도 follow-up.
- **CI 에서의 완전 자동 종단 OAuth 검증 없음.** 실제 IdP 키 + 사람의 동의 화면 완료가 필요하므로 종단 PASS 는 수동(AC-V1/AC-V2 의 manual 분류 참조).

## Requirements (EARS)

요구사항은 5개 모듈로 묶는다: G(Google config 배선), A(Apple config 배선), S(시크릿 env 배선), V(검증), U(불변/음성 경로 보존). 각 REQ 는 acceptance.md 의 AC 와 1:1 대응한다.

### Module G — Google provider config 배선 [MODIFY: supabase/config.toml]

- **R-G1 (Ubiquitous)**: `supabase/config.toml` 의 `[auth.external.google]` 블록은 항상 `client_id`/`secret` 을 `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)` / `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)` 치환으로만 참조하며, 시크릿/클라이언트 ID 리터럴을 인라인하지 않는다.
- **R-G2 (Event-Driven)**: WHEN 이 SPEC 의 config 변경이 적용되면 THEN `[auth.external.google]` 의 `enabled` 는 `true` 로 설정된다(기존 `false` 에서 전환).
- **R-G3 (State-Driven)**: WHILE 로컬 스택이 Google provider 를 사용해 인증하는 동안, `[auth.external.google].skip_nonce_check` 는 `true` 로 설정되어야 한다(config 주석: "로컬 Google 로그인에 필요"; 로컬에서 nonce mismatch 로 인한 실패를 방지). 이 변경은 로컬 전용 결정으로 OD-5 에 근거를 기록한다.

### Module A — Apple provider config 배선 [MODIFY: supabase/config.toml]

- **R-A1 (Ubiquitous)**: `[auth.external.apple]` 블록은 항상 `client_id`(= Apple **Services ID**)/`secret`(= ES256 서명 **client-secret JWT**)을 `env(SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID)` / `env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)` 치환으로만 참조하며, 인라인하지 않는다.
- **R-A2 (Event-Driven)**: WHEN config 변경이 적용되면 THEN `[auth.external.apple].enabled` 는 `true` 로 설정된다.
- **R-A3 (Unwanted Behavior)**: 이 SPEC 은 Apple `.p8` private key, Team ID, Key ID, 또는 생성된 secret JWT 를 저장소에 커밋하지 않는다(`secret` 은 env 치환으로만 주입, `.p8` 는 gitignore 된 위치 보관). `git` 추적 파일에 이 값들이 평문으로 나타나서는 안 된다.

### Module S — 시크릿 env 배선 (로컬 주입 경로) [ADD: gitignore 된 로컬 env 파일 + 채우기 절차]

- **R-S1 (Ubiquitous)**: 4개 변수(`SUPABASE_AUTH_EXTERNAL_{GOOGLE,APPLE}_{CLIENT_ID,SECRET}`)의 실제 값은 항상 git 추적되지 않는 로컬 env 파일(또는 셸 env)에만 존재하며, 저장소는 변수명 + 채우기 절차 + 빈 예시(placeholder)만 포함한다.
- **R-S2 (Event-Driven)**: WHEN `supabase start`(= `pnpm db:start`)가 실행되면 THEN CLI 는 정의된 로컬 env 파일에서 4개 변수를 읽어 config.toml 의 `env(...)` 자리를 치환한다. (env 파일의 정확한 경로/CLI 로드 규칙은 OD-1 에서 구현 시 검증.)
- **R-A4 (Unwanted Behavior, 시크릿 위생)**: 로컬 env 파일 경로는 저장소 `.gitignore`(루트) 또는 `supabase/.gitignore` 의 무시 패턴에 매칭되어야 하며, `git status` 에 추적 후보로 나타나서는 안 된다. (현재 `supabase/.gitignore` 는 `.env.local`/`.env.*.local`/`.env.keys` 를 무시; 루트 `.gitignore` 는 `.env`/`.env.*`(단 `!.env.example`)를 무시.)

### Module V — 검증 (자동 가능 / 수동 분리)

- **R-V1 (Event-Driven, 자동 가능)**: WHEN 활성화된 config 로 `supabase start`/`supabase status` 를 실행하면 THEN 스택은 오류 없이 기동하고 `[auth.external.google]`/`[auth.external.apple]` 가 활성으로 인식되어야 한다(config 수용 = config 유효성 검증).
- **R-V2 (Event-Driven, 자동 가능)**: WHEN 사용자가 키가 배선된 상태에서 Google(또는 Apple) 버튼을 제출하면 THEN `signInWithOAuthAction` 은 `?error=oauth_*_unavailable` 가 아니라 provider authorize URL(`data.url`)로 redirect 해야 한다(즉, 미배선 → 배선 전환의 관찰 가능 신호).
- **R-V3 (Event-Driven, 수동)**: WHEN 사람이 Google/Apple 동의 화면을 완료하면 THEN 흐름은 GoTrue 콜백(`127.0.0.1:54321/auth/v1/callback`) → 웹 PKCE 콜백(`127.0.0.1:3000/auth/callback`) → `exchangeCodeForSession` 을 거쳐 쿠키 세션을 확립하고 `/me` 로 도달해야 한다. (실제 IdP 키 + 사람 상호작용 필요 → CI 자동화 불가, 수동 절차로 검증.)

### Module U — 기존 동작 보존 (불변식 / 음성 경로)

- **R-U1 (Unwanted Behavior)**: 이 SPEC 은 `signInWithOAuthAction`(`actions.ts:79`), `CALLBACK_URL`(`actions.ts:14`), `app/auth/callback/route.ts`, `lib/auth/callback.ts`, `login-form.tsx` 의 코드를 변경하지 않는다. 이 파일들의 git diff 는 비어 있어야 한다.
- **R-U2 (State-Driven, 음성 경로 보존)**: WHILE 어떤 provider 가 미설정/잘못 배선된 동안, 그 버튼을 제출하면 시스템은 여전히 `/login?error=oauth_${provider}_unavailable` 로 복구 redirect 해야 한다(R-F3 동작 회귀 없음).
- **R-U3 (State-Driven, 콜백 음성 경로 불변)**: WHILE 콜백이 error param / 누락 code / 교환 실패를 받는 동안, `resolveCallbackOutcome` + Route Handler 는 세션 미확립 + `/login?error=...` 복구 redirect 동작을 SPEC-AUTH-001 과 동일하게 유지해야 한다.
- **R-U4 (Optional)**: WHERE Kakao 블록(`[auth.external.kakao]`)이 존재하는 한, 이 SPEC 은 그것을 손대지 않고 `enabled = false` 로 유지한다.

## Open Decisions & Risks (열린 결정 / 리스크)

| # | 항목 | 상태 / 기본 가정 (안전 선택) | 리스크 |
|---|------|------------------------------|--------|
| **OD-1** | 로컬 env 파일 경로 + `supabase start` 의 env 로드 규칙 | **기본 가정**: Supabase CLI 는 **프로젝트 루트의 `.env`** 를 자동 감지해 `env(...)` 치환에 사용한다(공식 docs: "detect values stored in an `.env` file at the **root of your project directory**"). 다만 루트 `.gitignore` 는 `.env` 를 무시하므로 루트 `.env` 는 커밋 위험 없이 사용 가능. **단, monorepo 루트와 supabase 디렉터리 기준의 차이**(`supabase/.env` 도 일부 CLI 버전에서 로드됨)는 구현 시 `supabase start` 출력/`supabase status` 로 실제 치환 여부를 검증한다. 안전 기본값: **루트 `.env`(이미 gitignore)** 를 1차로 쓰되, 동작하지 않으면 `supabase/.env.local`(`supabase/.gitignore` 에 의해 무시) 로 폴백. | 잘못된 경로면 `env()` 가 빈 문자열로 치환되어 provider 가 조용히 미설정 상태가 됨 → R-V2 가 이를 잡아냄(여전히 `?error=oauth_*_unavailable`). |
| **OD-2** | Google 로컬 redirect URI 정확값 | **확정**: provider 콘솔(Google Cloud)의 authorized redirect URI = `http://127.0.0.1:54321/auth/v1/callback`(GoTrue 콜백, config.toml `[api] port = 54321` + SPEC-AUTH-001 spike 관찰값). Google Cloud 가 `127.0.0.1` 루프백 + http 를 authorized redirect 로 허용하는지(일부 콘솔은 `localhost` 만/ http 제약) 구현 시 콘솔에서 검증. exact-match 이므로 `localhost` ≠ `127.0.0.1`. | redirect_uri_mismatch 는 OAuth 종단의 가장 흔한 실패. 콘솔 등록값과 GoTrue 콜백이 정확히 일치해야 함. |
| **OD-3** | **Apple client-secret JWT 생성/만료** | **기본 가정**: Apple `secret` 은 Services ID(client_id) + Team ID + Key ID + `.p8` 로 ES256 서명한 **정적 JWT** 이며 `[auth.external.apple].secret = env(...)` 로 주입한다(Supabase 표준). **로컬 CLI 가 정적 JWT 를 받는지 vs 키파일 기반 자동 생성을 지원하는지는 공식 문서 미명시 → 구현 시 검증**(정적 JWT 가 안전 기본값). | **JWT 는 최대 6개월 만료** — 만료 시 Apple 인증이 조용히 실패. 로컬에서도 재생성 필요. 로컬-우선이라 빈도는 낮지만 "왜 갑자기 안 되지" 함정. 회전 절차를 plan/acceptance 에 명시. |
| **OD-4** | `CALLBACK_URL` 하드코딩 + prod 일반화 | **연기**: `actions.ts:14` 의 `http://127.0.0.1:3000/auth/callback` 로컬 리터럴은 로컬 범위에서 유효 → 변경하지 않음. prod 도메인 + HTTPS + env 기반 redirect 일반화는 별도 follow-up SPEC. | 지금 일반화하면 범위 확장 + 신규 코드 경로 → Non-Goal 위반. |
| **OD-5** | `skip_nonce_check` 로컬 전용 변경 | **확정**: Google(및 필요 시 Apple) 블록의 `skip_nonce_check = true` 는 **로컬 전용**. config 주석이 "로컬 Google 로그인에 필요"라 명시. prod 에서는 nonce 검증을 켜야 하므로 OD-4 의 prod follow-up 에서 환경 분기 필요(로컬 config.toml 변경이 prod 로 새지 않도록). | 로컬에서 켠 nonce skip 이 prod 로 전파되면 보안 약화. prod 분리가 OD-4 에 종속. |

## Sources (출처)

- 로컬 자산 직접 관찰: `apps/web/lib/auth/actions.ts`(L14 `CALLBACK_URL`, L79 `signInWithOAuthAction`), `apps/web/app/auth/callback/route.ts`, `apps/web/lib/auth/callback.ts`, `apps/web/app/login/login-form.tsx`(L90/L102 OAuth form), `supabase/config.toml`(L155 `[auth]`, L335 `[auth.external.apple]`, L351 `[auth.external.google]`, L363 `[auth.external.kakao]`, L7 `[api] port = 54321`), `supabase/README.md`, `supabase/.gitignore`, 루트 `.gitignore`, 루트 `package.json`(`db:start`/`db:status`).
- SPEC-AUTH-001 spec.md HISTORY(L17): 로컬 GoTrue API 54321 + provider 콜백 `127.0.0.1:54321/auth/v1/callback` 관찰값, `site_url` host = 127.0.0.1.
- Supabase 로컬 config 문서: env() 치환은 프로젝트 루트 `.env` 자동 감지(`supabase.com/docs/guides/local-development/managing-config`) — 정확 경로는 OD-1 에서 구현 시 검증.
- Supabase Apple social login 문서: `secret` = `.p8` 로 생성한 JWT(Team ID + Key ID + Services ID), **6개월 만료**, 회전 필요(`supabase.com/docs/guides/auth/social-login/auth-apple`) — 로컬 CLI 입력 형식은 OD-3 에서 구현 시 검증.
