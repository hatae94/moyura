# SPEC-AUTH-002 — Implementation Plan

> 로컬 우선 소셜 OAuth 키 배선 (Google + Apple). 신규 코드 경로 없음 — 설정 + 시크릿 배선 + 검증.

## Technical Approach (기술 접근)

이 SPEC 은 **brownfield 설정 작업**이다. 코드는 SPEC-AUTH-001/SPEC-LOGIN-UI-001 에서 이미 완성됐고(`signInWithOAuthAction` → `signInWithOAuth({ provider, redirectTo })` → 기존 PKCE 콜백), 빠진 것은 **GoTrue 가 provider 키를 갖는 것**뿐이다. 따라서 접근은:

1. **config 활성화**: `supabase/config.toml` 의 google/apple 블록 `enabled = false → true`, `env(...)` 치환 유지(시크릿 인라인 절대 금지).
2. **provider 콘솔 자산 발급**(사용자 out-of-band): Google Cloud OAuth Web Client / Apple Services ID + ES256 secret JWT. 콘솔의 authorized redirect = GoTrue 콜백 `http://127.0.0.1:54321/auth/v1/callback`.
3. **시크릿 로컬 주입**: 4개 env 변수를 gitignore 된 로컬 env 파일에 채우고 `supabase start` 가 읽게 한다.
4. **검증**: 자동 가능(config 수용 / authorize redirect / 음성 경로 보존) + 수동(동의 → 세션 → `/me`)을 명확히 분리.

핵심 원칙: 기존 코드 파일 diff 는 비어 있어야 한다(R-U1). 변경은 사실상 `config.toml` 한 파일 + gitignore 된 env 파일 + 문서뿐이다.

## Files in Scope (대상 파일)

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `supabase/config.toml` | **[MODIFY]** | `[auth.external.google]` / `[auth.external.apple]`: `enabled = true`; google `skip_nonce_check = true`(OD-5); `client_id`/`secret` 은 기존 `env(...)` 유지. `[auth.external.kakao]` 는 불변(R-U4). |
| 로컬 env 파일 (OD-1: 1차 루트 `.env`, 폴백 `supabase/.env.local`) | **[ADD, gitignored]** | 4개 변수 실제 값. **커밋 금지** — gitignore 매칭 확인. |
| `supabase/.env.example` 또는 README 표 | **[ADD]** | 변수명 + placeholder + 채우기 절차(시크릿 없이). git 추적 가능한 안내. |
| `supabase/README.md` | **[MODIFY, optional]** | 소셜 OAuth 로컬 활성화 절차(콘솔 redirect URI, Apple JWT 회전) 섹션 추가. |
| `apps/web/lib/auth/actions.ts` | **[NO CHANGE]** | `CALLBACK_URL` 리터럴 + `signInWithOAuthAction` 변경 안 함(OD-4). diff 비어 있어야 함(R-U1). |
| `apps/web/app/auth/callback/route.ts`, `apps/web/lib/auth/callback.ts`, `apps/web/app/login/login-form.tsx` | **[NO CHANGE]** | 기존 콜백/UI 재사용. diff 비어 있어야 함(R-U1). |

## Milestones (우선순위 순 — 시간 추정 없음)

### M1 — Google config + env 배선 (Priority: High)
- `[auth.external.google]`: `enabled = true`, `skip_nonce_check = true`(OD-5), `env(...)` 유지(R-G1/R-G2/R-G3).
- Google Cloud Console: OAuth 2.0 Client(Web application) 생성 → client_id + client_secret 획득; authorized redirect URI 에 `http://127.0.0.1:54321/auth/v1/callback` 등록(OD-2 콘솔에서 127.0.0.1+http 허용 여부 검증).
- `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `..._GOOGLE_SECRET` 를 로컬 env 파일에 주입(R-S1).
- 검증: `supabase start` 후 Google 버튼 제출 → authorize URL redirect(R-V2), git 추적 파일에 시크릿 없음(R-S1).

### M2 — Apple config + client-secret JWT (Priority: High, 복잡도 최고)
- Apple Developer: App ID + **Services ID**(= client_id) 생성, Team ID / Key ID 확보, Keys 에서 Sign in with Apple `.p8` 키 생성(`.p8` 는 gitignore 된 위치 보관, R-A3).
- `.p8` + Team ID + Key ID + Services ID 로 **ES256 client-secret JWT** 생성(OD-3: 정적 JWT 가 기본 가정; 로컬 CLI 가 키파일 생성 지원 시 그 경로도 검증). **JWT 6개월 만료 → 회전 절차 기록**(OD-3).
- Apple Services ID 의 return URL 에 GoTrue 콜백 `http://127.0.0.1:54321/auth/v1/callback` 등록.
- `[auth.external.apple]`: `enabled = true`, `env(...)` 유지(R-A1/R-A2). `SUPABASE_AUTH_EXTERNAL_APPLE_CLIENT_ID`(Services ID) / `..._APPLE_SECRET`(JWT) 를 로컬 env 파일에 주입.
- 검증: Apple 버튼 제출 → authorize URL redirect(R-V2); `.p8`/Team ID/Key ID/JWT 가 git 추적 안 됨(R-A3).

### M3 — 로컬 스택 검증 (자동 가능) (Priority: Medium)
- `pnpm db:start` → `pnpm db:status` 로 활성화된 config 수용 확인(R-V1).
- google/apple 미설정 시 음성 경로 회귀 검증: 빈 env 로 버튼 제출 시 여전히 `?error=oauth_*_unavailable`(R-U2).
- 콜백 음성 경로 불변 검증(`resolveCallbackOutcome` 단위 테스트 SPEC-AUTH-001 그대로 통과, R-U3).
- 기존 코드 파일 diff 비어 있음 확인(R-U1).

### M4 — 종단 수동 검증 절차 (Priority: Medium, CI 자동화 불가)
- 문서화된 수동 절차: 로컬 웹앱 기동(`pnpm dev:web`) + 로컬 스택 → Google 버튼 → 동의 → `127.0.0.1:54321/auth/v1/callback` → `127.0.0.1:3000/auth/callback` → 쿠키 세션 → `/me`(R-V3). Apple 동일.
- 결과 기록 위치(예: 이 SPEC 의 후속 검증 노트). 실패 시 OD-2(redirect mismatch)/OD-3(JWT 만료)/OD-1(env 미로드) 체크리스트 참조.

## Risks (리스크)

- **Apple client-secret JWT 만료/생성(OD-3)** — 6개월 만료 + 로컬 CLI 입력 형식 미문서. 가장 큰 미지수. M2 에서 정적 JWT 기본 가정으로 진행, 키파일 경로는 구현 시 검증. 회전 절차를 README 에 남겨 "조용한 실패" 방지.
- **Google redirect URI mismatch(OD-2)** — 콘솔 등록값과 GoTrue 콜백이 exact-match 여야 함(`localhost` ≠ `127.0.0.1`, http/https 정합). Google Cloud 가 `127.0.0.1` http 루프백을 authorized redirect 로 허용하는지 콘솔에서 확인 필요.
- **env 미로드(OD-1)** — CLI 가 잘못된 경로의 env 를 보면 `env()` 가 빈 문자열로 치환되어 provider 가 조용히 미설정. R-V2 가 신호(여전히 `?error=...`)를 주므로 잡힌다. `supabase status`/`start` 출력으로 실제 치환 검증.
- **시크릿 커밋 사고(R-S1/R-A3)** — 로컬 env 파일/`.p8` 가 gitignore 매칭되는지 M1/M2 에서 `git status` 로 확인. 사고 시 키 회전 필요.
- **종단 자동화 불가** — 실제 IdP 키 + 사람 동의 → CI 불가. 검증 신뢰도는 M3(자동) + M4(수동)로 분리해 정직하게 보고.
