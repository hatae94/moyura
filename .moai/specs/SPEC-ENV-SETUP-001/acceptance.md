---
id: SPEC-ENV-SETUP-001
version: 0.2.0
status: draft
created: 2026-05-31
updated: 2026-05-31
author: hatae
---

# Acceptance Criteria — SPEC-ENV-SETUP-001

각 요구사항에 대응하는 검증 가능한 인수 기준. Given-When-Then 또는 체크 가능한 불릿. EARS 키워드/식별자는 영어 유지.

## A. Monorepo Wiring

### AC-A1a (R-A1)
- Given moyura 모노레포에서, When `pnpm nx run backend:openapi`, `pnpm nx run api-client:generate`, `pnpm nx run backend:prisma-migrate`(또는 동등 타겟)를 실행하면, Then 각 명령이 0 exit code로 성공한다(인프라 작업이 nx로 실행 가능).

### AC-A1b (R-A4)
- Given 새 인프라 타겟이 추가될 때, When 해당 타겟을 등록하면, Then 소유 프로젝트의 `project.json` `targets`에 등록된다(`package.json` scripts에만 두지 않음).
- [ ] 검증: openapi emit / client generate / prisma 관련 타겟이 각 소유 `project.json`의 `targets`에 존재한다(예: `apps/backend/project.json`에 `openapi`/`prisma-generate`/`prisma-migrate`, `packages/api-client/project.json`에 `generate`).

### AC-A2 (R-A2)
- [ ] `packages/api-client/package.json`의 name이 `@moyura/api-client`이다.
- Given `@moyura/web`가 `@moyura/api-client`를 의존으로 선언하면, When `pnpm install` 후 web에서 import하면, Then 타입 해석이 성공한다.

### AC-A3 (R-A3)
- Given `.npmrc`에 `node-linker=hoisted`가 설정된 상태에서, When `pnpm nx run backend:prisma-generate` 후 `pnpm nx run backend:build`를 실행하면, Then 생성된 Prisma 클라이언트가 정상 해석되어 빌드가 성공한다(심링크된 `node_modules/.prisma` 의존 없이).

### AC-A3b (R-A3 / D1 폴백 게이트)
- Given Prisma 7(선택지 A)을 선택한 상태에서, When `prisma generate` → `nest build` 스파이크가 실패하면, Then 선택지 B(Prisma 6.x)로 폴백하고 그 결정과 사유를 spec.md HISTORY 섹션에 기록한다.
- [ ] 검증: M2 스파이크 결과(성공/폴백)가 spec.md HISTORY에 한 줄로 남아 있다.

## B. Backend Config + Prisma + Supabase

### AC-B1 / AC-B2 (R-B1, R-B2)
- Given 필수 env(`DATABASE_URL` 등)가 모두 설정된 상태에서, When 백엔드를 부팅하면, Then 정상 기동한다.
- Given 필수 env 중 하나(예: `DATABASE_URL`)가 누락된 상태에서, When 백엔드를 부팅하면, Then 설명 메시지와 함께 non-zero exit code로 즉시 종료한다(부분 기동 없음).
- [ ] Zod 스키마가 `DATABASE_URL`, `DIRECT_URL`, `PORT`, `NODE_ENV`, `CORS_ORIGINS`를 required로 검증한다.

### AC-B3 / AC-B4 / AC-B5 (R-B3, R-B4, R-B5)
- [ ] prod에서 Prisma 런타임 클라이언트가 pooled `DATABASE_URL`(포트 6543 Supavisor transaction-mode, `?pgbouncer=true`)을 사용한다.
- [ ] pooled 연결을 사용할 때 prepared statements가 비활성화되어 있다(로컬이 direct 5432로 운영되면 이 항목은 N/A).
- Given 마이그레이션 명령(`prisma migrate ...`)을, When 실행하면, Then 양 환경 모두 `DIRECT_URL`(포트 5432)을 사용한다(pooled URL 미사용).

### AC-B6 (R-B6)
- [ ] `apps/backend/src/main.ts`가 하드코딩 `3000` 대신 검증된 `PORT`로 listen한다.

### AC-B7 (R-B7)
- [ ] Prisma schema에 도메인 모델 정의가 없다(연결 프로브 `SELECT 1` 외 모델 0개).

## C. Local Supabase CLI Stack

### AC-C1 / AC-C2 / AC-C3 / AC-C4 (R-C1~R-C4)
- [ ] `supabase/config.toml`이 저장소에 커밋되어 있다.
- Given 로컬 환경에서, When `supabase start`를 실행하면, Then Postgres + Auth(GoTrue) + Studio 컨테이너가 기동되고 로컬 Postgres가 접속 가능하다.
- Given 로컬 Supabase 스택이 기동된 상태에서, When 백엔드를 `local`로 실행하면, Then 백엔드가 로컬 Supabase Postgres에 연결된다.
- [ ] M3 스파이크에서 로컬 스택의 6543 pooler 노출 여부를 검증했다. pooler가 없으면 로컬 `DATABASE_URL`은 direct(5432)로 설정되며, 이는 허용된 운영 모드다(local/prod 모드 불일치는 K8로 관리).
- Given 스택 기동 상태에서, When `supabase stop`을 실행하면, Then 스택이 정리되고 커밋된 소스에 변화가 없다.

## D. OpenAPI Client

### AC-D1 / AC-D2 (R-D1, R-D2)
- [ ] 백엔드가 `@nestjs/swagger`로 OpenAPI 문서를 노출한다.
- Given health 엔드포인트가 존재하는 상태에서, When openapi emit 타겟을 실행하면, Then 서버를 계속 띄우지 않고도 `apps/backend/openapi.json`(또는 지정 경로)이 생성된다.

### AC-D3 / AC-D4 (R-D3, R-D4)
- Given emit된 OpenAPI spec이 존재하는 상태에서, When client-generate 타겟을 실행하면, Then `packages/api-client`에 타입드 클라이언트가 생성된다.
- Given 동일 spec으로, When 클라이언트를 재생성하면, Then spec 변경 외 불필요한 diff가 없다(idempotent).

## E. Frontend Env Injection

### AC-E1 / AC-E2 (R-E1, R-E2)
- [ ] web이 `NEXT_PUBLIC_API_BASE_URL`을 Next env 파일에서 읽는다.
- [ ] mobile이 `EXPO_PUBLIC_API_BASE_URL`을 Expo app config/env에서 읽는다.

### AC-E3 (R-E3)
- [ ] `eas.json`에 `local`/`prod` 프로파일 골격만 존재한다(실제 build/submit 자격증명 미배선).

### AC-E4 (R-E4)
- Given `NEXT_PUBLIC_API_BASE_URL`(또는 `EXPO_PUBLIC_API_BASE_URL`)이 미설정(`undefined`/빈 문자열)인 환경에서, When 해당 앱을 시작하면, Then 잘못된 호스트로 silent fallback하지 않고 명시적 설정 에러를 throw한다.
- [ ] explicit in-app guard (assert/throw) present — 앱 부팅 경로에 base URL 미설정 시 설명 메시지와 함께 throw하는 in-app 가드가 존재한다(`NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`가 build-time 인라인되어 자동 실패하지 않으므로 필수).

## F. CORS

### AC-F1 / AC-F2 / AC-F3 (R-F1~R-F3)
- Given allowlist에 포함된 origin(예: web local)에서, When cross-origin 요청을 보내면, Then 허용된다.
- Given allowlist에 없는 origin에서, When 요청을 보내면, Then 허용되지 않으며 `Access-Control-Allow-Origin: *`를 반환하지 않는다.
- [ ] allowlist가 검증된 config(`CORS_ORIGINS`)에서 환경별로 주입된다(하드코딩 아님).

## G. Health Endpoint

### AC-G1 / AC-G2 / AC-G3 / AC-G4 (R-G1~R-G4)
- Given DB가 접속 가능한 상태에서, When `GET /health`를 호출하면, Then 200과 함께 `{ status: "ok", db: "up" }` 형태 JSON을 반환한다.
- Given DB가 접속 불가한 상태에서, When `GET /health`를 호출하면, Then 503과 함께 `{ status: <degraded>, db: "down" }` 형태를 반환한다.
- [ ] local proof: `local`에서 `/health`를 로컬 Supabase 스택 대상으로 실제 호출하여 `ok`/`db: up`을 확인한다(이 SPEC 범위 내 검증).
- [ ] prod proof (config only): Render health check path = `/health`가 설정/존재함을 확인한다. 실제 prod 요청 검증은 deployment follow-up으로 연기한다(이 SPEC에 prod 배포 없음).

## H. Auth Seam

### AC-H1 / AC-H2 / AC-H3 (R-H1~R-H3)
- [ ] no-op/pass-through NestJS Guard 배선점이 존재한다(미래 JWT guard 드롭인 가능 구조).
- [ ] config 스키마에 `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET`가 optional placeholder로 존재한다.
- [ ] 로그인/토큰 발급/토큰 검증/유저 영속화 코드가 없다.

## I. CI / EAS Skeleton

### AC-I1 / AC-I2 / AC-I3 (R-I1~R-I3)
- Given push 또는 PR 이벤트에서, When GitHub Actions가 실행되면, Then install 후 affected Nx 프로젝트에 대해 build/lint/test/typecheck가 실행된다.
- [ ] CI에 자동 Prisma migration 또는 배포 스텝이 없다.
- [ ] `eas.json`에 `local`/`prod` 프로파일 골격만 존재한다.

## Edge Cases

- pooled 연결로 마이그레이션 시도 시(오용) 실패가 명확해야 함 → 마이그레이션은 `DIRECT_URL` 전용(AC-B5).
- Render cold start 후 첫 `/health` 호출 지연은 실패가 아님(인프라 config 범위, 하드닝은 Non-Goal).
- env 미설정 시 어느 앱도 silent로 잘못된 호스트에 붙지 않음(AC-E4 in-app guard, AC-B2 Zod fail-fast).
- 로컬 Supabase 스택이 6543 pooler를 노출하지 않을 수 있음 → 로컬은 direct(5432) 허용, prod만 pooled (K8, AC-B4/AC-C2).
- Supabase가 PG 마이너 버전을 고정 → 스키마/connection이 특정 마이너에 하드 의존하지 않음.

## Quality Gate / Definition of Done

- [ ] spec.md의 모든 R-* 요구사항에 대응 AC가 존재하고 충족됨.
- [ ] `pnpm nx run-many -t build lint test typecheck`가 affected 범위에서 통과.
- [ ] `GET /health`가 local Supabase 스택 대상으로 `ok`/`db: up` 반환(local end-to-end 증명; prod는 health check path 설정 확인만 — deployment follow-up).
- [ ] 잘못된/누락 env로 fail-fast 동작 확인(backend Zod + 프론트 in-app guard).
- [ ] Non-Goals/Exclusions 위반 없음(도메인 모델·인증 로직·배포 잡·투기적 추상화 미포함).
- [ ] 모든 `.env*` 비밀이 `.gitignore` 처리, `.env.example`만 커밋.
- [ ] Open Decision D1/D2가 구현 시점에 확정·기록됨. D1은 M2 spike 결과로 게이트(권장 Prisma 7 + cjs, 실패 시 Prisma 6.x 폴백 + HISTORY 기록 — AC-A3b). D2 권장 `openapi-typescript`.
