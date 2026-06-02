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
