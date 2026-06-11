# SPEC-AUTH-002 — Acceptance Criteria

> 각 AC 는 spec.md 의 REQ 와 1:1 대응. Given/When/Then. **자동 가능 / 수동**을 명시적으로 분리한다(종단 OAuth 는 실제 IdP 키 + 사람 동의가 필요해 CI 자동화 불가).

## AC ↔ REQ 매핑 표

| AC | REQ | 검증 방식 |
|----|-----|-----------|
| AC-G1 | R-G1 | 자동 (config/grep) |
| AC-G2 | R-G2 | 자동 (config) |
| AC-G3 | R-G3 | 자동 (config) |
| AC-A1 | R-A1 | 자동 (config/grep) |
| AC-A2 | R-A2 | 자동 (config) |
| AC-A3 | R-A3 | 자동 (git) |
| AC-S1 | R-S1 | 자동 (git) |
| AC-S2 | R-S2 | 반자동 (CLI 출력 관찰) |
| AC-S3 | R-A4 (시크릿 위생) | 자동 (git) |
| AC-V1 | R-V1 | 자동 (CLI) |
| AC-V2 | R-V2 | 자동 (앱 동작) |
| AC-V3 | R-V3 | **수동** (사람 동의) |
| AC-U1 | R-U1 | 자동 (git diff) |
| AC-U2 | R-U2 | 자동 (앱 동작) |
| AC-U3 | R-U3 | 자동 (단위 테스트) |
| AC-U4 | R-U4 | 자동 (config) |

---

## Module G — Google config

### AC-G1 (R-G1, 자동)
- **Given** `supabase/config.toml` 의 `[auth.external.google]` 블록이 있을 때,
- **When** 그 블록을 검사하면,
- **Then** `client_id = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID)"`, `secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"` 형태의 `env(...)` 치환만 존재하고, 클라이언트 ID/시크릿 리터럴은 없다.

### AC-G2 (R-G2, 자동)
- **Given** config 변경이 적용된 상태에서,
- **When** `[auth.external.google].enabled` 값을 읽으면,
- **Then** `true` 다(기존 `false` 에서 전환).

### AC-G3 (R-G3, 자동)
- **Given** 로컬 Google 활성화 config 에서,
- **When** `[auth.external.google].skip_nonce_check` 를 읽으면,
- **Then** `true` 이고, 그 근거(로컬 전용, prod 미전파)가 OD-5 에 기록돼 있다.

## Module A — Apple config

### AC-A1 (R-A1, 자동)
- **Given** `[auth.external.apple]` 블록이 있을 때,
- **When** 그 블록을 검사하면,
- **Then** `client_id`(Services ID)/`secret`(client-secret JWT)이 `env(SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID)` / `env(SUPABASE_AUTH_EXTERNAL_APPLE_SECRET)` 치환으로만 참조되고 리터럴이 없다.

### AC-A2 (R-A2, 자동)
- **Given** config 변경 적용 후,
- **When** `[auth.external.apple].enabled` 를 읽으면,
- **Then** `true` 다.

### AC-A3 (R-A3, 자동)
- **Given** Apple 자산(`.p8` private key, Team ID, Key ID, 생성된 secret JWT)이 로컬에 준비된 상태에서,
- **When** `git ls-files` + 추적 파일 내용을 검사하면,
- **Then** 어떤 추적 파일에도 `.p8` 내용 / Team ID / Key ID / secret JWT 가 평문으로 존재하지 않는다(env 치환 + gitignore 된 `.p8` 위치).

## Module S — 시크릿 env 배선

### AC-S1 (R-S1, 자동)
- **Given** 4개 변수(`SUPABASE_AUTH_EXTERNAL_{GOOGLE,APPLE}_{CLIENT_ID,SECRET}`)의 실제 값이 로컬에 채워진 상태에서,
- **When** `git status` + 추적 파일을 검사하면,
- **Then** 실제 값은 git 추적되지 않는 env 파일/셸 env 에만 있고, 저장소에는 변수명 + placeholder + 채우기 절차만 있다.

### AC-S2 (R-S2, 반자동)
- **Given** 로컬 env 파일에 4개 변수가 채워진 상태에서,
- **When** `pnpm db:start`(= `supabase start`)를 실행하면,
- **Then** CLI 가 env 파일 값으로 config.toml 의 `env(...)` 자리를 치환하고, provider 가 활성으로 기동한다(치환 실패 시 AC-V2 가 미설정 신호로 잡아냄). 정확한 env 파일 경로/로드 규칙은 OD-1 에 따라 구현 시 검증.

### AC-S3 (R-A4 시크릿 위생, 자동)
- **Given** 로컬 env 파일 경로가 정해진 상태에서,
- **When** 그 경로를 `.gitignore`(루트) / `supabase/.gitignore` 패턴과 대조하고 `git status` 를 보면,
- **Then** 그 경로는 무시 패턴에 매칭되어 추적 후보로 나타나지 않는다(루트 `.env`/`.env.*` 또는 `supabase/.env.local` 등).

## Module V — 검증

### AC-V1 (R-V1, 자동)
- **Given** 활성화된 config(google/apple `enabled = true`)에서,
- **When** `pnpm db:start` 후 `pnpm db:status` 를 실행하면,
- **Then** 스택이 오류 없이 기동하고 외부 provider 활성 config 가 수용된다(잘못된 config 면 `supabase start` 가 실패하므로, 성공 자체가 config 유효성 증명).

### AC-V2 (R-V2, 자동)
- **Given** Google(또는 Apple) 키가 배선되고 스택이 떠 있는 상태에서,
- **When** 로컬 웹앱(`pnpm dev:web`)에서 해당 소셜 버튼을 제출하면,
- **Then** 브라우저는 `/login?error=oauth_*_unavailable` 가 **아니라** provider authorize URL(`accounts.google.com/...` 또는 `appleid.apple.com/...`, = `data.url`)로 redirect 된다.

### AC-V3 (R-V3, **수동**)
- **Given** 실제 Google/Apple 키 + 콘솔 redirect 등록(`127.0.0.1:54321/auth/v1/callback`)이 완료되고 스택+웹앱이 떠 있는 상태에서,
- **When** 사람이 소셜 버튼 → IdP 동의 화면을 완료하면,
- **Then** 흐름은 GoTrue 콜백 → 웹 PKCE 콜백(`127.0.0.1:3000/auth/callback`) → `exchangeCodeForSession` 으로 쿠키 세션을 확립하고 `/me` 로 도달한다.
- **참고**: 실제 IdP 키 + 사람 상호작용 필요 → CI 자동화 불가. 수동 절차로 1회 이상 통과 확인 후 결과 기록.

## Module U — 기존 동작 보존

### AC-U1 (R-U1, 자동)
- **Given** 이 SPEC 작업 완료 후,
- **When** `git diff` 를 `apps/web/lib/auth/actions.ts`, `apps/web/app/auth/callback/route.ts`, `apps/web/lib/auth/callback.ts`, `apps/web/app/login/login-form.tsx` 에 대해 보면,
- **Then** 변경이 없다(이 파일들의 diff 가 비어 있다). 변경은 `config.toml` + gitignore 된 env + 문서로 한정된다.

### AC-U2 (R-U2, 자동)
- **Given** 어떤 provider 가 미설정/잘못 배선된 상태에서(예: 빈 env),
- **When** 그 버튼을 제출하면,
- **Then** 여전히 `/login?error=oauth_${provider}_unavailable` 로 복구 redirect 된다(R-F3 회귀 없음).

### AC-U3 (R-U3, 자동)
- **Given** 콜백이 error param / 누락 code / 교환 실패를 받을 때,
- **When** `resolveCallbackOutcome` + Route Handler 동작을 검증하면(SPEC-AUTH-001 단위 테스트 재실행),
- **Then** 세션 미확립 + `/login?error=...` 복구 redirect 가 SPEC-AUTH-001 과 동일하게 유지된다.

### AC-U4 (R-U4, 자동)
- **Given** `[auth.external.kakao]` 블록이 있을 때,
- **When** 이 SPEC 작업 후 그 블록을 검사하면,
- **Then** 변경 없이 `enabled = false` 다.

---

## Edge Cases (엣지 케이스)

- **EC-1 (미설정 provider)**: env 가 비어 `env()` 가 빈 문자열로 치환 → provider 미설정 → 버튼 제출 시 `?error=oauth_*_unavailable`(AC-U2). 키 배선 전/후의 명확한 신호.
- **EC-2 (Google redirect mismatch)**: 콘솔 등록 redirect 가 GoTrue 콜백과 불일치(`localhost` vs `127.0.0.1`, http vs https) → IdP 동의 후 `redirect_uri_mismatch`. authorize redirect(AC-V2)는 성공하지만 종단(AC-V3)에서 실패 → OD-2 체크리스트.
- **EC-3 (Apple JWT 만료)**: secret JWT 가 6개월 경과로 만료 → Apple 버튼은 authorize redirect 까지 가지만(AC-V2 통과 가능) 종단 인증 실패. "조용한 실패" → OD-3 회전 절차로 대응.
- **EC-4 (시크릿 커밋 사고)**: 로컬 env/`.p8` 가 gitignore 누락으로 추적되면 AC-S3/AC-A3 가 실패로 잡아냄. 사고 시 키 회전.
- **EC-5 (Kakao 회귀)**: Kakao 블록을 실수로 활성화/변경하면 AC-U4 실패. 손대지 않음 확인.
- **EC-6 (skip_nonce_check prod 누수)**: 로컬에서 켠 `skip_nonce_check = true` 가 prod config 로 전파되면 보안 약화 → OD-4(prod 환경 분리 follow-up)에서 차단. 이 SPEC 범위에서는 로컬 전용임을 OD-5 에 기록.

## Quality Gate Criteria (품질 게이트 — 자동 vs 수동 정직 분리)

### 자동화 가능 (이 SPEC 완료의 필수 게이트)
1. `config.toml` 검사: google/apple `enabled = true`, `env(...)` 치환 유지, kakao 불변 (AC-G1/G2/G3, AC-A1/A2, AC-U4).
2. git 위생: 시크릿/`.p8`/JWT 가 추적 파일에 없음, 로컬 env 가 gitignore 매칭 (AC-A3, AC-S1, AC-S3).
3. `supabase start`/`status` 가 활성 config 수용 (AC-V1).
4. 키 배선 후 버튼이 provider authorize URL 로 redirect (AC-V2).
5. 미설정 시 `?error=oauth_*_unavailable` 음성 경로 보존 (AC-U2).
6. 콜백 음성 경로 단위 테스트 SPEC-AUTH-001 그대로 통과 (AC-U3).
7. 기존 코드 4개 파일 diff 비어 있음 (AC-U1).

### 수동 (CI 자동화 불가 — 1회 이상 사람 검증)
8. Google 동의 → 세션 → `/me` (AC-V3, Google).
9. Apple 동의 → 세션 → `/me` (AC-V3, Apple).
10. env 실제 치환이 `supabase start` 출력에서 확인됨 (AC-S2, 반자동).

## Definition of Done (완료 정의)
- [ ] 자동 게이트 1~7 전부 통과.
- [ ] 수동 게이트 8~9 가 사람에 의해 1회 이상 통과 + 결과 기록.
- [ ] OD-1(env 경로)/OD-2(Google redirect)/OD-3(Apple JWT) 구현 시 검증 결과가 SPEC HISTORY 또는 검증 노트에 기록됨.
- [ ] 어떤 시크릿도 커밋되지 않음(git 이력 포함 확인).
- [ ] status 는 작업 완료까지 `draft` → 사용자 리뷰 후 전환(이 SPEC 은 구현 전 단계).
