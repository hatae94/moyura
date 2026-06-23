# moyura 배포 런북 (LOCAL → PRODUCTION)

이 문서는 moyura 모노레포(web · backend · mobile + Supabase)를 prod 로 올리는 절차를 정리한다.
실값은 각자 채워 넣어야 하며, 채워진 실값/시크릿은 **절대 커밋하지 않는다**(맨 아래 "보안 주의" 참고).

---

## 개요 — 하이브리드 구조

moyura 의 Supabase 사용은 **하이브리드**다. 두 가지를 명확히 구분한다.

| 책임 | 소유자 | 배포 방법 |
| --- | --- | --- |
| DB 스키마 / 트리거 / RLS | **Prisma** (`apps/backend/prisma/migrations/`, 12개) | `prisma migrate deploy` |
| 플랫폼 설정 (auth / providers / realtime / storage) | **Supabase** (`supabase/config.toml` + 대시보드) | `supabase config push` 또는 대시보드 |

> [!IMPORTANT]
> **`supabase db push` 를 쓰지 않는다.** `supabase/migrations/` 디렉터리는 비어 있다(존재하지 않음).
> 스키마는 전적으로 Prisma 마이그레이션이 소유한다. prod 스키마는 항상 `prisma migrate deploy` 로만 배포한다.
> Realtime broadcast 트리거와 RLS 정책도 Prisma 마이그레이션에 포함되어 있어 `migrate deploy` 한 번으로 같이 적용된다.

---

## A. Supabase 클라우드 프로젝트 생성

1. [Supabase Dashboard](https://supabase.com/dashboard) → **New project** 생성.
2. 입력값:
   - **Region**: 사용자/백엔드 호스팅과 가까운 리전 선택.
   - **Database password**: 강한 비밀번호 설정 후 안전한 곳에 보관(연결 문자열에 들어간다).
3. 생성 후 확보할 값(이후 단계에서 사용):
   - **Project ref**: 프로젝트 URL `https://<ref>.supabase.co` 의 `<ref>` 부분.
   - **API URL / anon key**: Settings → API.
   - **Connection strings**: Settings → Database (pooler 6543 / direct 5432).

---

## B. Supabase CLI 링크

이 레포는 Supabase CLI 를 backend 워크스페이스 devDependency 로 들고 있다.
`pnpm --filter @moyura/backend exec supabase ...` 형태로 호출한다.

```bash
# 1) 로그인 (브라우저에서 access token 발급)
pnpm --filter @moyura/backend exec supabase login

# 2) 클라우드 프로젝트와 로컬 config 링크
pnpm --filter @moyura/backend exec supabase link --project-ref <ref>
```

---

## C. DB 스키마 배포 (Prisma)

prod 연결 문자열 두 개를 환경변수로 주입한 뒤 `migrate deploy` 를 돌린다.
`apps/backend/.env.production.example` 참고 — 두 URL 의 차이가 핵심이다.

- `DATABASE_URL` = **pooler, 포트 6543**, transaction-mode, 끝에 `?pgbouncer=true` (런타임용)
- `DIRECT_URL` = **direct, 포트 5432** (마이그레이션 CLI 전용)

```bash
# 예: 셸에 prod 값을 export 한 상태로 (실값은 커밋 금지)
export DATABASE_URL="postgresql://postgres.<ref>:<db_password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
export DIRECT_URL="postgresql://postgres.<ref>:<db_password>@aws-0-<region>.pooler.supabase.com:5432/postgres"

pnpm --filter @moyura/backend exec prisma migrate deploy
```

> 현재 12개 마이그레이션(profile/moim/chat/poll … 그리고 `..._add_poll_realtime_broadcast` 의
> Realtime broadcast 트리거 + RLS 포함)이 한 번에 적용된다.

---

## D. Auth / Provider 설정 (Supabase)

`supabase/config.toml` 의 redirect 설정을 prod 도메인에 맞게 바꾼다.
**모바일 deep-link `moyura://auth-callback` 은 그대로 유지**한다(앱 복귀 경로).

1. `config.toml` 수정:
   - `site_url` → prod 웹 도메인 (`https://<prod-web-domain>`)
   - `additional_redirect_urls` → prod 웹 콜백 + 모바일 scheme 유지:
     ```toml
     site_url = "https://<prod-web-domain>"
     additional_redirect_urls = [
       "https://<prod-web-domain>/auth/callback",
       "moyura://auth-callback",
     ]
     ```
2. 적용:
   - `pnpm --filter @moyura/backend exec supabase config push`, **또는**
   - Supabase Dashboard → Authentication → URL Configuration 에서 직접 설정.

> Google **secret** 은 `config push` 보다 **대시보드**(Authentication → Providers → Google)에서
> 설정하는 것을 권장한다 — 시크릿이 셸/파일에 남지 않는다.

---

## E. Google OAuth 설정

세 곳의 client_id 가 **하나로 일치**해야 한다(불일치 시 토큰 교환 거부).

1. **Google Cloud Console** → APIs & Services → Credentials:
   - OAuth 2.0 Client (Web application) 의 **Authorized redirect URI** 에 prod GoTrue 콜백 등록:
     ```
     https://<ref>.supabase.co/auth/v1/callback
     ```
   - **Authorized JavaScript origins** 에 prod 웹 origin(`https://<prod-web-domain>`) 등록.
   - iOS 네이티브 로그인용 iOS client 도 별도 생성(번들 ID 기준).
2. **Supabase Dashboard** → Authentication → Providers → Google:
   - 위 Web client 의 **client_id / secret** 입력.
3. **모바일**(`apps/mobile/eas.json` production 프로파일):
   - `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` == **Supabase Google provider 의 client_id** (= 위 Web client id).
     `signInWithIdToken` 의 audience 가 이 값과 같아야 한다.
   - `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` == 위에서 만든 iOS client id.

---

## F. 앱 env 채우기

각 `.env.production.example` 를 보고 호스팅 환경변수 / EAS 프로파일에 실값을 채운다.

| 변수 | 어디에 넣나 | 값 출처 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | 웹 호스팅(Vercel) env | prod 백엔드 도메인 |
| `NEXT_PUBLIC_SUPABASE_URL` | 웹 호스팅 env | Supabase Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 웹 호스팅 env | Supabase Settings → API → anon public |
| `DATABASE_URL` | 백엔드 호스팅(Render) env | Supabase Database → Transaction pooler(6543, `?pgbouncer=true`) |
| `DIRECT_URL` | 백엔드 호스팅 env | Supabase Database → Direct connection(5432) |
| `PORT` | (보통 불필요) | 호스트가 자동 주입 |
| `NODE_ENV` | 백엔드 호스팅 env | `production` |
| `CORS_ORIGINS` | 백엔드 호스팅 env | prod 웹 origin(콤마 구분, 와일드카드 금지) |
| `SUPABASE_URL` | 백엔드 호스팅 env | Supabase Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | 백엔드 호스팅 env | Supabase Settings → API → anon public |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID/SECRET` | Supabase 대시보드(권장) 또는 셸 env | Google Cloud OAuth Web client |
| `EXPO_PUBLIC_*` (6개) | `apps/mobile/eas.json` production 프로파일 `env` | API/웹 도메인, Supabase URL/anon, Google client id 2개 |

> 웹/모바일의 PUBLIC 값(anon key, client id)은 공개 전제다. 백엔드의 연결 문자열·OAuth secret·JWT secret 은
> 시크릿이므로 호스팅 대시보드 env 에만 입력하고 파일로 커밋하지 않는다.

---

## G. Realtime 검증

- 클라우드 Supabase 는 Realtime 이 기본 ON 이다.
- broadcast 트리거는 **Prisma `migrate deploy` 로 이미 적용**된다(별도 publication 추가 불필요).
- 배포 후 체크리스트:
  - [ ] DB 테이블이 모두 생성됐다(profile / moim / chat / poll …).
  - [ ] RLS 정책이 적용돼 있다(Supabase Dashboard → Database → Policies).
  - [ ] 이메일/비번 로그인 동작.
  - [ ] Google 로그인 동작(웹 + 모바일 네이티브).
  - [ ] 투표(poll) 변경이 다른 클라이언트에 실시간 반영된다(broadcast 트리거 정상).

---

## H. 호스팅 배포 (web = Vercel · backend = Render · mobile = EAS)

### 백엔드 → Render (`render.yaml`)

백엔드는 `app.listen()` 으로 떠 있는 **영속 NestJS 서버**라 serverless 전용인 **Vercel 에 맞지 않는다**(어댑터 없이는 요청을 못 받는다). 영속 Node 호스트인 **Render** 를 쓴다.

1. Render Dashboard → **New → Blueprint** → 이 레포 연결 → 루트 `render.yaml` 자동 감지 → **Apply**.
2. Apply 시 `sync:false` 시크릿을 대시보드에서 입력: `DATABASE_URL`(pooler 6543 `?pgbouncer=true`), `DIRECT_URL`(direct 5432), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `CORS_ORIGINS`(prod 웹 origin). 선택: `SUPABASE_JWT_SECRET`, `FIREBASE_CREDENTIALS`. `PORT` 는 Render 가 자동 주입한다.
3. 빌드 `corepack enable && pnpm install --frozen-lockfile && pnpm exec nx build backend` → 시작 `node apps/backend/dist/src/main.js` → 헬스 `GET /` (전부 `render.yaml` 에 정의됨). prisma generate 는 Render 의 `DIRECT_URL` 로 통과한다(Vercel 에서 났던 PrismaConfigEnvError 없음).
4. **스키마는 빌드에 포함되지 않는다** — C 단계 `prisma migrate deploy` 를 prod DB 에 선행한다(또는 유료 플랜의 `preDeployCommand` 로 자동화).

> Render 무료 플랜은 비활성 시 슬립(콜드스타트 ~50s). 실서비스는 starter 이상 권장.

### 웹 → Vercel

- 빌드는 `nx build web` = `next build` **단독**이다(백엔드/Prisma 체인 디커플 — `packages/api-client/src/schema.d.ts` 커밋됨). 따라서 **`DIRECT_URL` 을 web Vercel 프로젝트에 넣지 않는다**(불필요).
- 빌드타임에 **`NEXT_PUBLIC_*` 3개**(`NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`)가 인라인되므로 Vercel env 에 설정 후 **redeploy** 한다(기존 빌드엔 소급 안 됨, Production/Preview 스코프 주의).
- 백엔드 API(openapi) 변경 시: `pnpm exec nx run api-client:generate` 재실행 → `schema.d.ts` 재커밋(typecheck 가 드리프트 감지).

### 모바일 → EAS

- `apps/mobile/eas.json` 의 `production` 프로파일 `env`(EXPO_PUBLIC_* 6개: web/API 도메인, Supabase URL/anon, Google client id 2개)를 prod 값으로 채운 뒤 `eas build --profile production`.

---

## 보안 주의

- 실 시크릿을 **절대 커밋하지 않는다**: `.env`, `.env.local`, `.env.production`(실값), DB 연결 문자열, OAuth client secret, JWT secret.
- 커밋되는 것은 `*.env.production.example`(placeholder만)과 `eas.json`(public 값: anon key + client id)뿐이다.
- `supabase/config.toml` 에는 시크릿을 직접 쓰지 않는다 — 반드시 `env()` 치환만 사용한다.
- Google provider secret 은 가능하면 Supabase **대시보드**에서 설정(셸/파일에 남기지 않음).
