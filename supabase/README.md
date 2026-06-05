# 로컬 Supabase 스택 (SPEC-ENV-SETUP-001, R-C1~R-C4)

`apps/backend` 의 표준(canonical) 로컬 DB 는 Supabase CLI 로컬 스택이다. 별도의
docker-compose Postgres 는 사용하지 않는다(R-C4 — 미래 Supabase Auth 방향과 parity 유지).

## 시작 / 종료

```bash
pnpm supabase start   # Postgres + Auth(GoTrue) + Studio 컨테이너 기동
pnpm supabase stop    # 스택 정리(커밋된 소스에는 영향 없음 — R-C3)
```

`supabase start` 출력에 로컬 DB URL, API URL, anon key, JWT secret 이 표시된다.
백엔드 seam 용 env(`SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_JWT_SECRET`)는 이
출력값을 `apps/backend/.env` 에 채워 넣는다(런타임 미사용 — placeholder, R-H2).

## 연결 URL (로컬)

로컬 스택은 `supabase/config.toml` 기준 다음 포트를 노출한다:

| 구성 요소 | 포트 |
|-----------|------|
| Postgres (direct) | `54322` |
| API (REST/GoTrue) | `54321` |
| Studio | `54323` |
| Connection pooler | **비활성** (`[db.pooler] enabled = false`) |

로컬은 Supavisor pooler(6543 transaction-mode)를 노출하지 **않으므로**, `DATABASE_URL`
과 `DIRECT_URL` 모두 direct(54322)를 가리킨다(K8, AC-C2). 이 경우 pooled 전용 설정인
prepared-statement 비활성(R-B4)은 로컬에서 N/A 다.

```dotenv
# apps/backend/.env (로컬)
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
DIRECT_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

## prod 대비 (참고)

prod(Supabase 관리형)에서는 듀얼 URL 패턴을 사용한다:

- `DATABASE_URL` = **pooled** 6543 (Supavisor transaction-mode, `?pgbouncer=true`) — 런타임 PrismaClient
- `DIRECT_URL` = **direct** 5432 — 마이그레이션 CLI(R-B5)

마이그레이션은 로컬/ prod 양쪽 모두 `DIRECT_URL` 을 사용하므로(R-B5) local(54322)/prod(5432)
direct 포트 차이만 흡수하면 된다. prod 값은 Render 대시보드 secrets 로 주입한다(결정 4).

## 소셜 OAuth — 로컬 Google 로그인 (SPEC-AUTH-002)

로그인 화면(`apps/web/app/login`)의 Google 버튼을 로컬에서 실제 동작시키는 절차다.
**Apple 은 Apple Developer Program 확보 후 follow-up 으로 활성화한다(현재 `enabled = false`).**

### 1. Google Cloud OAuth 클라이언트

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID
2. Application type: **Web application** (Android 아님 — 이 흐름은 GoTrue 웹 OAuth, SHA-1 불필요)
3. OAuth consent screen 이 Testing 이면 본인 Google 계정을 **Test users** 에 추가(없으면 access_blocked)
4. **Authorized redirect URIs** 에 GoTrue 콜백을 정확히 등록(exact-match):

   ```
   http://127.0.0.1:54321/auth/v1/callback
   ```

   웹 앱 콜백(`http://127.0.0.1:3000/auth/callback`)이 아니라 **GoTrue 콜백(:54321)** 이다.
   `localhost` ≠ `127.0.0.1`, http/포트까지 정확히 일치해야 한다.

### 2. 시크릿 주입 (커밋 금지)

`supabase/.env.example` 를 참고해 실제 값을 git 비추적 env 파일에 넣는다:

- 1순위: 모노레포 루트 `.env` (루트 `.gitignore` 가 무시 — Supabase docs 기본값)
- 폴백: `supabase/.env.local` (`supabase/.gitignore` 가 무시)

```dotenv
SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=<Web client id>
SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=<Web client secret>
```

`config.toml` 의 `[auth.external.google]` 가 이 값을 `env(...)` 치환으로 읽는다(이미 `enabled = true`,
`skip_nonce_check = true` — 로컬 Google 로그인 전용, prod 로 전파 금지).

### 3. 재기동 + 검증

```bash
pnpm supabase stop && pnpm supabase start
```

- `supabase start` 출력에서 env 치환이 적용됐는지 확인(루트 `.env` 가 안 읽히면 `supabase/.env.local`
  로 폴백 — OD-1).
- 로그인 화면 Google 버튼 → `?error=oauth_google_unavailable` 대신 Google 동의 화면으로 진입하면
  배선 성공(R-V2). 동의 완료 → GoTrue 콜백 → 웹 PKCE 콜백 → 쿠키 세션 → `/me`(R-V3, 수동).

> 주의: 시크릿이 없는 상태로 `enabled = true` 인 채 `supabase start` 하면 GoTrue 가 기동에 실패할
> 수 있다. 위 Google 시크릿을 먼저 채운 뒤 재기동한다.
