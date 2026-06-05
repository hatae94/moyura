# SPEC-AUTH-002 (compact)

**제목**: 실제 소셜 OAuth 키 배선 (로컬 우선, Google + Apple)
**status**: draft · **priority**: medium · **확장**: SPEC-AUTH-001 (follow-up R-F3), 입력 UI = SPEC-LOGIN-UI-001

## 한 줄 요약
로컬 Supabase 스택(127.0.0.1)에서 google/apple provider 를 실제 키로 활성화해, 기존 로그인 버튼이 진짜 IdP authorize URL 로 진입하고 동의 후 기존 PKCE 콜백으로 세션을 확립하게 한다. **신규 코드 경로 없음** — 설정 + 시크릿 배선 + 검증.

## Requirements (REQ)
- **R-G1** [Ubiquitous] google `client_id`/`secret` 은 항상 `env(...)` 치환만(리터럴 금지).
- **R-G2** [Event] config 적용 시 google `enabled = true`.
- **R-G3** [State] 로컬 Google 사용 중 `skip_nonce_check = true`(로컬 전용, OD-5).
- **R-A1** [Ubiquitous] apple `client_id`(Services ID)/`secret`(ES256 JWT)은 항상 `env(...)` 치환만.
- **R-A2** [Event] config 적용 시 apple `enabled = true`.
- **R-A3** [Unwanted] `.p8`/Team ID/Key ID/secret JWT 를 커밋 금지.
- **R-S1** [Ubiquitous] 4개 env 실제 값은 git 비추적 위치에만; 저장소엔 변수명+절차+placeholder.
- **R-S2** [Event] `supabase start` 가 로컬 env 에서 4개 변수를 읽어 `env(...)` 치환(경로는 OD-1 검증).
- **R-A4** [Unwanted] 로컬 env 파일은 gitignore 매칭(추적 후보로 안 나타남).
- **R-V1** [Event, 자동] `supabase start`/`status` 가 활성 config 수용.
- **R-V2** [Event, 자동] 키 배선 후 버튼 제출 → provider authorize URL redirect(미배선의 `?error=` 가 사라짐).
- **R-V3** [Event, 수동] 동의 완료 → GoTrue 콜백 → 웹 PKCE 콜백 → 쿠키 세션 → `/me`.
- **R-U1** [Unwanted] 기존 코드(`actions.ts`, `callback/route.ts`, `callback.ts`, `login-form.tsx`) 변경 0.
- **R-U2** [State] 미설정 provider 제출 시 여전히 `?error=oauth_${provider}_unavailable`.
- **R-U3** [State] 콜백 음성 경로(error/누락 code/교환 실패) SPEC-AUTH-001 동일 유지.
- **R-U4** [Optional] Kakao 블록 불변, `enabled = false` 유지.

## Acceptance (핵심, REQ 1:1)
- **자동**: config(google/apple `enabled=true` + `env()` 유지 + kakao 불변); git 위생(시크릿/`.p8`/JWT 비커밋, env gitignore); `supabase start/status` 수용; 버튼→authorize URL redirect; 미설정 시 `?error=oauth_*_unavailable`; 콜백 음성 경로 단위 테스트 통과; 기존 4개 파일 diff 비어 있음.
- **수동**: Google 동의→세션→`/me`; Apple 동의→세션→`/me`; env 실제 치환 `supabase start` 출력 확인.

## Files to modify
- `supabase/config.toml` **[MODIFY]** — google/apple `enabled=true`, google `skip_nonce_check=true`, `env(...)` 유지, kakao 불변.
- 로컬 env 파일 **[ADD, gitignored]** — 1차 루트 `.env`(이미 ignore), 폴백 `supabase/.env.local`. 4개 변수 실제 값.
- `supabase/.env.example` / `supabase/README.md` **[ADD/MODIFY]** — 변수명 + 채우기 절차 + Apple JWT 회전.
- `apps/web/lib/auth/actions.ts`, `app/auth/callback/route.ts`, `lib/auth/callback.ts`, `app/login/login-form.tsx` — **[NO CHANGE]**.

## Exclusions (제외 — ≥1 필수)
1. 신규 server action / 세션 / 콜백 코드 없음(기존 재사용).
2. prod OAuth 키 / 배포 redirect 도메인 / HTTPS / 호스팅 없음(로컬 우선, OD-4).
3. Kakao 없음(블록 불변).
4. `CALLBACK_URL`(`actions.ts:14`) 하드코딩 일반화 없음(로컬에서 유효, OD-4).
5. UI 변경 없음(버튼 이미 존재).
6. 이메일 확인 / 비밀번호 재설정 / RBAC 없음.
7. CI 완전 자동 종단 OAuth 검증 없음(IdP 키 + 사람 동의 필요).

## Top Open Decisions / Risks
- **OD-3 Apple client-secret JWT**: Services ID + Team/Key ID + `.p8` 로 ES256 서명, **6개월 만료**. 로컬 CLI 가 정적 JWT vs 키파일 생성을 받는지 미문서 → 구현 시 검증(정적 JWT 기본). 회전 절차 필수.
- **OD-2 Google 로컬 redirect**: 콘솔 authorized redirect = `http://127.0.0.1:54321/auth/v1/callback`(exact-match, `localhost`≠`127.0.0.1`). 콘솔의 127.0.0.1+http 허용 여부 검증.
- **OD-1 env 로드 경로**: CLI 가 루트 `.env` 자동 감지(공식 docs), 다만 monorepo/supabase 디렉터리 차이 → `supabase start` 출력으로 실제 치환 검증. 잘못되면 조용히 미설정(R-V2 가 신호).
