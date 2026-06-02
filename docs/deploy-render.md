# Render 백엔드 배포 가이드 (SPEC-ENV-SETUP-001, 결정 4 / R-I1·R-I2)

> 문서 전용. 이 SPEC 범위에는 실제 prod 배포가 없다(R-I2 — CI 에 배포/마이그레이션 잡 없음).
> 아래는 Render Web Service 를 구성할 때의 설정값 레퍼런스다. prod `/health` 실제 검증은
> deployment follow-up 으로 연기한다(R-G4 / AC-G prod = config 확인만).

## Web Service 설정

| 항목 | 값 |
|------|-----|
| Runtime | Node |
| Root Directory | (모노레포 루트 — 기본값) |
| Build Command | `pnpm install --frozen-lockfile && pnpm exec prisma generate --schema apps/backend/prisma/schema.prisma && pnpm nx build backend` |
| Start Command | `node apps/backend/dist/src/main.js` |
| Health Check Path | `/health` |

참고:
- 시작 엔트리는 중첩 경로 `dist/src/main.js` 다. `prisma.config.ts` 가 rootDir 을 넓혀
  `dist/main.js` 가 아니라 `dist/src/main.js` 로 빌드된다(`apps/backend` 기준이면
  `dist/src/main.js`, 루트 기준이면 `apps/backend/dist/src/main.js`).
- 생성 Prisma 클라이언트는 gitignore 되므로 build 단계에서 `prisma generate` 가 선행돼야 한다.
- `prisma migrate` 는 Render build/start 에 **넣지 않는다**. 마이그레이션은 별도 수동/후속
  단계에서 `DIRECT_URL`(5432)로 수행한다(R-B5, R-I2).

## 환경변수 (Render 대시보드 secrets 로 주입)

| Variable | prod 값 출처 | 필수 |
|----------|--------------|------|
| `DATABASE_URL` | Supabase pooled URL (6543 Supavisor transaction-mode, `?pgbouncer=true`) | yes |
| `DIRECT_URL` | Supabase direct URL (5432) | yes |
| `PORT` | Render 자동 주입 | yes (Render 제공) |
| `NODE_ENV` | `production` | yes |
| `CORS_ORIGINS` | web prod URL + mobile scheme (콤마 구분) | yes |
| `SUPABASE_URL` | Supabase 프로젝트 URL | no — seam placeholder |
| `SUPABASE_ANON_KEY` | Supabase anon key | no — seam placeholder |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret | no — seam placeholder |

`PORT` 는 Render 가 주입하며 백엔드는 검증된 config 에서 이를 읽어 listen 한다(R-B6).
누락/불일치 env 는 부팅 시 Zod fail-fast 로 즉시 종료된다(R-B2).

## Cold start (참고)

무료/저티어 인스턴스는 슬립 후 첫 요청이 지연될 수 있다(K5). `/health` 를 Render health
check path 로 지정해 워밍/감시한다. cold-start 하드닝(상시 워밍 등)은 이 SPEC 의 Non-Goal 이다.
