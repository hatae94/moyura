# Research: 모임 도메인 + 모임 채팅 + FCM 백그라운드 푸시 (3-SPEC 체인)

> SPEC 체인: SPEC-MOIM-001 → SPEC-CHAT-001 → SPEC-CHAT-002
> 작성일: 2026-06-11 | 조사 도구: Explore agent (오케스트레이터 검수 교정 반영)
> 본 문서는 세 SPEC이 공유하는 단일 리서치 문서다. 각 SPEC의 plan.md가 이 문서를 참조한다.

## 1. 목표 요약

moyura 모노레포(pnpm + Nx, Node 22)에서 다음 3개 SPEC을 체인으로 구현하기 위한 사전 조사:

- **SPEC-MOIM-001**: 모임 도메인 — `moim` + `moim_member` Prisma 모델 + NestJS CRUD/멤버십 모듈(최소 범위)
- **SPEC-CHAT-001**: 모임별 채팅 — `chat_message` Prisma 모델 + NestJS REST API(send + keyset-paginated history) + Supabase Realtime Broadcast 팬아웃(Postgres 트리거, private channel `moim:{id}`) + 웹 Next.js 구독 UI
- **SPEC-CHAT-002**: FCM 백그라운드 푸시 — expo-notifications 클라이언트(Expo 56), 디바이스 토큰 레지스트리, NestJS firebase-admin 발송자(chat 도메인 이벤트를 @nestjs/event-emitter로 구독 — 느슨한 결합)

구현은 **TDD 모드** 강제(quality.yaml), 백엔드 jest 기존 패턴 유지. apps/web은 테스트 하니스 부재 — build/lint로 검증.

---

## 2. 백엔드 현황 (apps/backend)

### 2.1 NestJS 레이아웃 + 모듈 시스템

- `apps/backend/src/app.module.ts` — 루트 모듈: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`(Zod 4.4.3 fail-fast), `PrismaModule`, `HealthModule`, `ProfileModule`
- `apps/backend/src/main.ts` — CORS origin 화이트리스트(env `CORS_ORIGINS`, wildcard 금지), `@nestjs/swagger` 11.4.4 → `/api` + `openapi.json` emit(project.json `openapi` 타겟)

**신규 모듈 통합점:** `AppModule.imports`에 `MoimModule` → `ChatModule` → `PushModule` 순서로 추가. 각 모듈은 독립 폴더(`src/moim/`, `src/chat/`, `src/push/`). chat → moim은 FK 의존, push는 chat의 도메인 이벤트 구독만(chat은 push 존재 미인식).

### 2.2 인증 가드 + JWT 검증 (SPEC-AUTH-001/002 완료 자산)

- `apps/backend/src/auth/supabase-auth.guard.ts` — per-route `@UseGuards(SupabaseAuthGuard)`
- `apps/backend/src/auth/current-user.decorator.ts` — `@CurrentUser()` → `VerifiedUser { sub, role? }`
- `apps/backend/src/auth/token-verifier.service.ts` — jose 6.2.3, alg pinning(ES256 JWKS / HS256 레거시 폴백), iss/aud/exp 검증, fail-closed

신규 모듈은 가드를 **재사용만** 하면 된다. 신규 Guard 불필요. 멤버십 인가는 각 도메인 서비스에서 `user.sub` 기반 검증.

### 2.3 Prisma 7 설정 + 마이그레이션 워크플로우

- `apps/backend/prisma/schema.prisma` — 현재 `Profile` 모델만 존재(id = Supabase sub)
- `apps/backend/prisma.config.ts` — 마이그레이션은 `DIRECT_URL`(non-pooled), 런타임은 `PrismaPg({ connectionString: DATABASE_URL })` 어댑터
- 생성 클라이언트: `src/generated/prisma` (cjs, node-linker hoisted 호환)

**신규 모델 워크플로우:**
1. `schema.prisma`에 모델 추가
2. `pnpm --filter @moyura/backend prisma:generate`
3. `pnpm --filter @moyura/backend prisma:migrate dev --name <name>` (로컬 54322)
4. `nx run backend:typecheck` → `pnpm --filter @moyura/backend test`

기존 패턴: `@@map()` snake_case 테이블명, PK 명시, `@default(now())`.

### 2.4 테스트 설정 (TDD)

- jest config: `apps/backend/package.json`(rootDir src, `.spec.ts`, ts-jest, jose transformIgnorePatterns), `test/jest-setup.ts`로 env 로드
- 참고 패턴: `apps/backend/src/profile/profile.service.spec.ts` — Prisma를 jest.Mock 스텁, mass-assignment 차단 검증 스타일
- 커버리지 85%+ 의무(TRUST 5)

### 2.5 라이브러리 현황

설치됨: `@nestjs/*`, `@prisma/adapter-pg` 7.8.0, `@prisma/client` 7.8.0, `jose` 6.2.3, `pg` 8.21.0, `zod` 4.4.3
**부재(SPEC에서 추가)**: `@nestjs/event-emitter`(CHAT-001), `firebase-admin`(CHAT-002)

---

## 3. 웹 현황 (apps/web)

### 3.1 Next.js 16 App Router

- `next` 16.2.6, `react` 19.2.4, `tailwindcss` 4.0, `@moyura/api-client`(workspace)
- 라우트: `app/page.tsx`, `app/login/page.tsx`, `app/auth/callback/route.ts`(OAuth PKCE), `app/me/page.tsx`(protected)
- **테스트 하니스 없음** — build/lint 검증 (기존 합의)

### 3.2 Supabase 클라이언트 구성

- `apps/web/lib/supabase/client.ts` — `createBrowserClient(url, anonKey)` (Client Component)
- `apps/web/lib/supabase/server.ts` — `createServerClient(..., { cookies })` (RSC/Route Handler)
- `apps/web/lib/supabase/middleware.ts` + `proxy.ts` — 매 요청 세션 갱신 + CSP nonce 주입

**Realtime private channel 구독 전제:** 브라우저 클라이언트가 쿠키 기반 인증 세션을 보유 → `supabase.realtime.setAuth()` 경유로 채널 인가 토큰 전달 가능. WebView 내에서도 동일 세션이 쿠키로 유지됨(SPEC-MOBILE-002 토큰 브리지로 세션 동기화 완료).

### 3.3 proxy.ts CSP 제약

- prod CSP: `script-src 'self' 'nonce-{value}' 'strict-dynamic'`, `connect-src 'self' ${NEXT_PUBLIC_SUPABASE_URL}`
- Supabase Realtime WebSocket(`wss://`)이 `connect-src`의 Supabase URL 도메인에 포함되는지 **구현 시 검증 필요** — http(s) 스킴만 명시된 경우 `wss:` 명시 추가가 필요할 수 있음 (리스크 R-CSP)

---

## 4. 모바일 현황 (apps/mobile)

### 4.1 WebView 셸 + 토큰 브리지

- `apps/mobile/App.tsx` — WebView 오케스트레이션
- `apps/mobile/components/WebViewShell.tsx` — 재사용 WebView(SPEC-WEBVIEW-SHELL-001)
- `apps/mobile/hooks/useAuthBridge.ts` / `auth-bridge-core.ts` — OAuth 인터셉트 + 토큰 동기화(SPEC-MOBILE-002)
- `apps/mobile/lib/auth/bridge-protocol.ts` — 버전드 메시지 v1: `session:restore/synced/none/cleared`, `resume:revalidate`. 페이로드는 access/refresh 토큰만. per-session nonce + constant-time 비교

### 4.2 Expo 56 설정

- `expo` 56.0.6, `react-native` 0.85.3, `expo-secure-store`, `expo-auth-session`, `expo-web-browser`, `expo-linking`, `react-native-webview` 13.16.1
- `app.json`: `"scheme": "moyura"`, plugins: expo-secure-store, expo-splash-screen
- `eas.json` 존재(local-sim / local 프로필)
- **부재**: `expo-notifications`, google-services 파일, Firebase 프로젝트 설정 — 모두 SPEC-CHAT-002 범위

### 4.3 SPEC-MOBILE-003 (expo-router) 와의 관계

- SPEC-MOBILE-003은 로그인 후 네이티브 `/home` 라우트 전환을 추진 중(research 단계)
- 본 체인의 채팅 UI는 **웹(/me 이후 화면) 우선 구현** — 네이티브 채팅 화면은 본 체인 비범위
- 푸시 탭 시 딥링크 네비게이션은 SPEC-MOBILE-003의 라우터 도입 여부에 따라 달라짐 → CHAT-002에서 "앱 열기 + 대상 모임 채팅으로 이동"은 최소 구현(웹뷰 URL 지정)으로 한정하고, 네이티브 라우트 연동은 후속

---

## 5. Supabase 현황

### 5.1 로컬 스택 (supabase/config.toml)

- API 54321, DB 54322(PostgreSQL 17), Realtime **enabled**
- auth: site_url `http://localhost:3000`, redirect `http://localhost:3000/auth/callback` + `moyura://auth-callback`, jwt_expiry 3600s

### 5.2 Realtime Broadcast 패턴 (오케스트레이터 교정 반영)

**DB 트리거는 래퍼 함수로 작성한다** (`realtime.broadcast_changes()`를 트리거 함수 내부에서 호출):

```sql
create or replace function broadcast_chat_message() returns trigger
language plpgsql security definer as $$
begin
  perform realtime.broadcast_changes(
    'moim:' || new.moim_id::text,  -- topic
    'INSERT', 'INSERT',            -- event, operation
    'chat_message', 'public',      -- table, schema
    new, null                      -- new record, old record
  );
  return new;
end $$;

create trigger chat_message_broadcast
  after insert on chat_message
  for each row execute function broadcast_chat_message();
```

**웹 클라이언트는 broadcast 이벤트를 구독한다** (postgres_changes 아님):

```typescript
supabase
  .channel(`moim:${moimId}`, { config: { private: true } })
  .on('broadcast', { event: 'INSERT' }, ({ payload }) => addMessage(payload))
  .subscribe();
```

**private 채널 인가는 `realtime.messages` RLS가 담당한다:**

```sql
create policy "members can receive moim broadcasts"
  on realtime.messages for select to authenticated
  using (
    exists (
      select 1 from moim_member m
      where 'moim:' || m.moim_id::text = realtime.topic()
        and m.user_id = (select auth.uid())::text
    )
  );
```

**중요한 구분:** Prisma는 postgres 롤로 직접 연결되므로 `chat_message` 테이블 RLS의 영향을 받지 않는다(쓰기 인가는 NestJS 서비스 레이어가 담당). RLS는 (1) realtime.messages의 **구독 인가**, (2) anon/authenticated 롤의 PostgREST 직접 접근 차단 — 두 용도로만 설계한다. `chat_message`에 RLS enable + 정책 없음(default deny)을 적용해 PostgREST 우회 접근을 차단하는 것을 권장.

### 5.3 DB 문서 상태

`.moai/project/db/*.md` 전부 TBD 템플릿. 본 체인 구현 시 `/moai db refresh`로 동기화 필요.

---

## 6. 공유 패키지 + 워크스페이스

- `packages/api-client/` — 백엔드 `openapi.json` → `openapi-typescript` 생성 → 얇은 fetch 클라이언트(TokenProvider Bearer 주입). **신규 DTO는 OpenAPI 재생성으로 자동 타입화** → moim/chat API의 웹 호출은 이 경로 사용(느슨한 결합 충족)
- `packages/config/` — 미사용
- nx 타겟: `build`(캐시), `test`(jest), `typecheck`(prisma-generate 의존), `openapi`

---

## 7. 통합 지점 및 리스크

### (a) NestJS 신규 모듈 ↔ 인증 가드

기존 `SupabaseAuthGuard` + `@CurrentUser()` 재사용. 멤버십 인가(모임 멤버인지)는 서비스 레이어에서 `moim_member` 조회로 구현. 401(미인증)과 403(비멤버) 구분.

### (b) FCM 누락 항목 (SPEC-CHAT-002 범위)

1. `firebase-admin` (backend), `@nestjs/event-emitter` (backend, CHAT-001에서 선행 설치), `expo-notifications` (mobile)
2. Firebase 프로젝트 + 서비스 계정 키 — env `FIREBASE_CREDENTIALS`(JSON) 또는 파일 경로, Zod env 검증에 추가
3. `app.json`에 expo-notifications config plugin + `google-services.json`(Android). iOS는 APNs 키 + EAS credentials
4. Expo Go에서 원격 푸시 불가 — **dev build 필수** (알려진 제약, acceptance에 명시)

**느슨한 결합 구조:**

```
ChatService.sendMessage()
  └─ prisma.chatMessage.create()
  └─ eventEmitter.emit('chat.message.created', { messageId, moimId, senderId, preview })
       └─ (구독) PushListener → 수신 대상 조회(moim_member - sender, device_token join)
            └─ FcmSender.send(tokens, notification)   // firebase-admin
```

chat 모듈은 push 모듈을 import하지 않는다. 이벤트 이름/페이로드 계약만 공유(상수 + 타입은 chat 모듈이 export, push가 단방향 의존).

### (c) Supabase Broadcast private channel 제약

- 웹 클라이언트가 인증 세션 보유 시 채널 인가 가능. 구독 직전 `supabase.realtime.setAuth(accessToken)` 호출이 필요한지 supabase-js 2.106 기준 확인 필요(자동 전달이 기본이나 SSR 쿠키 세션에서는 명시 호출이 안전)
- WebView 내 웹도 동일 쿠키 세션이므로 추가 작업 없음
- CSP `connect-src`에 wss 스킴 허용 검증 (R-CSP)

### (d) Prisma 신규 모델 초안

```prisma
model Moim {
  id        String   @id @default(uuid())
  name      String
  createdBy String   // Supabase user uuid (profile.id)
  createdAt DateTime @default(now())
  members   MoimMember[]
  @@map("moim")
}

model MoimMember {
  moimId   String
  userId   String   // profile.id
  role     String   @default("member") // "owner" | "member"
  joinedAt DateTime @default(now())
  moim     Moim @relation(fields: [moimId], references: [id], onDelete: Cascade)
  @@id([moimId, userId])
  @@map("moim_member")
}

model ChatMessage {
  id        BigInt   @id @default(autoincrement())
  moimId    String
  senderId  String   // profile.id
  content   String   // length 제한은 DTO + DB CHECK
  createdAt DateTime @default(now())
  moim      Moim @relation(fields: [moimId], references: [id], onDelete: Cascade)
  @@index([moimId, id(sort: Desc)])
  @@map("chat_message")
}

model DeviceToken {  // SPEC-CHAT-002
  token     String   @id
  userId    String   // profile.id
  platform  String   // "android" | "ios"
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([userId])
  @@map("device_token")
}
```

주의: Postgres 트리거/RLS 정책은 Prisma 스키마로 표현 불가 → **마이그레이션 SQL 수동 추가**(`prisma migrate dev --create-only` 후 SQL 편집) 워크플로우 채택.

### (e) 암묵적 계약 + 부작용 위험

| # | 리스크 | 내용 | 대응 |
|---|--------|------|------|
| R-1 | bridge 프로토콜 | FCM 토큰의 native→backend 전달. bridge 메시지 추가는 web/mobile 동기 수정 필요 | **REST 직접 등록 권장**: native가 `POST /devices` 호출(SecureStore의 access token 사용). bridge 무수정 |
| R-2 | CSP | Realtime wss 연결이 connect-src에 막힐 가능성 | 구현 시 검증, 필요 시 proxy.ts 1줄 수정 |
| R-3 | 로그아웃 | 로그아웃 시 device_token 미삭제 → orphan token으로 로그아웃 후 푸시 수신 | CHAT-002 요구사항에 토큰 해제(DELETE /devices/:token) 포함, 로그아웃 흐름에 연결 |
| R-4 | SPEC-MOBILE-003 | 푸시 탭 네비게이션이 라우터 구조에 의존 | 최소 구현(앱 열기 + WebView URL)으로 한정, 네이티브 라우트 연동은 후속 |
| R-5 | onDelete: Cascade | 모임 삭제 시 메시지 전체 삭제 | MVP는 Cascade 채택, 아카이빙 요구 발생 시 별도 SPEC |
| R-6 | 트리거-Prisma 드리프트 | 수동 SQL(트리거/RLS)이 prisma migrate diff에 안 잡힘 | 마이그레이션 파일에 SQL 포함 + `.moai/project/db/` 문서화 |

---

## 8. 권고 구현 접근

### 8.1 SPEC 체인 순서

1. **SPEC-MOIM-001**: `moim`/`moim_member` 모델 + 마이그레이션, MoimModule(CRUD + 멤버십), 전 라우트 SupabaseAuthGuard, jest TDD
2. **SPEC-CHAT-001**: `chat_message` 모델 + broadcast 트리거 + realtime.messages RLS, ChatModule(send/history API + `chat.message.created` 이벤트 발행), 웹 채팅 UI(broadcast 구독), api-client 재생성
3. **SPEC-CHAT-002**: `device_token` 모델, PushModule(이벤트 구독 + firebase-admin 발송 + 토큰 레지스트리 API), mobile expo-notifications 통합(토큰 등록/해제, 수신 핸들러, 탭 시 앱 열기)

### 8.2 검증 포인트 (TDD/품질 게이트)

- MOIM-001: 마이그레이션 적용, CRUD + 401/403 구분, jest 커버리지 85%+
- CHAT-001: 트리거 동작(insert → broadcast 수신), keyset pagination, 비멤버 403, 웹 build/lint 통과
- CHAT-002: 이벤트 발행→발송 흐름 단위 테스트(firebase-admin mock), 토큰 등록/해제, 로그아웃 연동, 실기기 백그라운드 수신은 **디바이스 게이트**(기존 모바일 SPEC 관례에 따라 자동 게이트만으로 complete 처리 금지)

### 8.3 환경 변수 (신규)

- Backend: `FIREBASE_CREDENTIALS`(또는 `FIREBASE_CREDENTIALS_PATH`), Zod env 스키마 확장
- Mobile: Firebase 프로젝트 설정(google-services.json), EAS credentials(iOS APNs)
