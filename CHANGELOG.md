# Changelog

이 프로젝트의 주요 변경 사항을 기록한다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)를 따르며,
버전 관리는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수한다.

## [Unreleased]

### Added

- **FCM 백그라운드 푸시** (SPEC-CHAT-002 — 자동 게이트 통과 — backend jest 206/206, mobile vitest 151/151, 느슨한 결합 검증, evaluator PASS / 실기기 FCM 수신·탭 device-gated 검증 대기 → in-progress): 앱 백그라운드 상태에서 새 메시지를 FCM 푸시로 수신하는 인프라 구현.
  - **DeviceToken 모델 + 마이그레이션 + 등록/해제 API(owner-scoped IDOR 차단)**: `apps/backend/prisma/schema.prisma`에 `DeviceToken`(token TEXT PK, userId, platform, createdAt, updatedAt; @@index userId) 추가, 마이그레이션 `20260614_add_device_token` 적용. `POST /devices`(upsert 등록) + `DELETE /devices/:token`(owner-scoped: `unregisterByOwner(userId, token)` — 타인 토큰 삭제 차단, OWASP A01 IDOR 대응).
  - **PushListener 단방향 이벤트 구독(sender/게스트 제외, 서버 측 nickname)**: `apps/backend/src/push/push.listener.ts`가 `@OnEvent('chat.message.created')` 단방향 구독. sender 제외 + 토큰 미등록 멤버(게스트) 자연 제외 + 서버 측 `moim_member.nickname` 조회로 알림 본문 구성. chat 모듈은 push 존재를 모름(chat↛push).
  - **FcmSender(firebase-admin, graceful no-op)**: `apps/backend/src/push/fcm-sender.ts` — firebase-admin singleton 초기화 + FIREBASE_CREDENTIALS 부재 시 경고 후 no-op(부팅/테스트 환경 차단 없음). firebase-admin@^13.10.0 신규 의존성(Node 20+ 호환).
  - **느슨한 결합(chat↛push)**: `chat/**` → push import 0건(grep + `loose-coupling.spec.ts` 정적 검증). push는 `chat-events.ts` 계약(@MX:ANCHOR)에만 단방향 의존.
  - **mobile expo-notifications(등록/수신/탭 + 로그아웃 해제)**: `apps/mobile/lib/push/` — `register-device-core`(토큰 획득+등록/해제 순수 로직, vitest) + `notification-core`(수신+탭 핸들러 순수 로직, vitest) + 얇은 Expo 의존 래퍼 2종. `AuthContext.tsx` 로그인 후 자동 등록 배선, `useAuthBridge.ts` `session:cleared` 시 해제 연동(orphan token 차단). expo-notifications@~56.0.17 신규 의존성.

- **모임 채팅 코어** (SPEC-CHAT-001 — 자동 게이트 통과 — jest 170/170, psql 존재 단언, evaluator PASS / realtime 종단·RLS 구독·브라우저 런타임 검증 대기 → in-progress): 모임 멤버 간 실시간 채팅 코어 구현.
  - **ChatMessage 모델 + 트리거/RLS 마이그레이션** (`apps/backend/prisma/schema.prisma`에 `ChatMessage`(BigInt PK auto-increment, moimId FK→moim onDelete Cascade, senderId, content, createdAt; @@index([moimId, id desc])) + `Moim.messages` 관계 추가, 마이그레이션 `20260613175232_add_chat` 적용). 수동 SQL 포함: content CHECK(`1..2000`자), `chat_message` RLS default-deny, `broadcast_chat_message()` SECURITY DEFINER 함수, `chat_message_broadcast` AFTER INSERT 트리거, `realtime.messages` SELECT 정책(멤버십 게이트).
  - **sendMessage (멤버 인가 + best-effort emit)**: `POST /moims/:id/messages` — `assertMember` 인가 후 insert, `chat.message.created` 이벤트 emit(try-catch best-effort 격리 — CHAT-002 리스너 예외가 201 응답 차단 불가), BigInt→string 직렬화. 비멤버/존재하지 않는 모임 → 403(모임 존재 여부 미노출).
  - **getHistory (keyset 내림차순)**: `GET /moims/:id/messages?cursor=&limit=` — BigInt keyset 페이지네이션(내림차순/최신순), nextCursor string 반환. 잘못된 cursor → 400.
  - **`chat.message.created` 이벤트 계약 (@nestjs/event-emitter)**: `apps/backend/src/chat/chat-events.ts`가 이벤트 이름/페이로드 계약을 소유·export(@MX:ANCHOR). push(CHAT-002)는 단방향 의존. `@nestjs/event-emitter@^3.1.0` 신규 의존성, `EventEmitterModule.forRoot()` 등록.
  - **웹 채팅 UI (private channel 구독 + nickname 클라이언트 해석)**: `apps/web/lib/chat/useChatChannel.ts`(Supabase Realtime private channel `moim:{id}` 구독 훅) + `apps/web/app/moims/[id]/chat/page.tsx`(히스토리 로드 + 실시간 수신 표시 + 전송). sender nickname은 이미 로드된 멤버 목록에서 클라이언트 측 해석(미지 sender 재조회 폴백).
  - **CSP wss 호스트 고정**: `apps/web/proxy.ts` `connect-src`를 `wss:` 전체 허용 → `wss://${supabaseHost}` 호스트 고정(OWASP A05 MEDIUM 완화).

- **초대 링크 + 게스트 참여** (SPEC-MOIM-002 — 자동 게이트 통과 — jest 148/148, evaluator Security PASS / 백엔드+웹, 디바이스 게이트 없음 → completed): 모임 host가 발급한 초대 링크로 회원가입 없이 게스트가 모임에 참여하는 가입 경로 구현.
  - **MoimInvite 모델 + 마이그레이션** (`apps/backend/prisma/schema.prisma`에 `MoimInvite`(token TEXT PK, moimId FK→moim onDelete Cascade, createdBy, expiresAt, maxUses?, usedCount DEFAULT 0, revokedAt?, createdAt; @@index moimId) 추가, 마이그레이션 `20260613171209_add_moim_invite` 적용).
  - **토큰 발급/목록/폐기 (owner 전용)**: `POST /moims/:id/invites`(201, CSPRNG ≥128-bit 토큰, 기본 만료 +7일, 상한 30일, 선택적 maxUses), `GET /moims/:id/invites`(200, 목록 + 상태, owner 전용 — live 토큰 유출 방지), `DELETE /moims/:id/invites/:inviteId`(200, revokedAt 설정). 비-owner 요청은 모두 403 거부. `assertOwner`(MOIM-001 @MX:ANCHOR) 재사용.
  - **게스트 accept (익명 로그인 + 멱등 + 원자 usedCount)**: `POST /invites/:token/accept { nickname }`(200) — 토큰 검증(미지 404 / 만료·폐기 410 / maxUses 초과 409) + 멤버십 생성(role=member, nickname) + usedCount 원자 조건부 증가. 이미 멤버인 경우 멱등 반환(P2002 idempotent, usedCount 불변). TOCTOU 경쟁 안전.
  - **고정 실패 코드 (404/410/409/403)**: 미지 토큰 404, 만료·폐기 토큰 410(`GoneException`), maxUses 초과 409(`ConflictException`), 비-owner 403.
  - **웹 `/invite/[token]` 랜딩** (`apps/web/app/invite/[token]/page.tsx` + `apps/web/lib/invite/accept.ts`): 세션 없는 방문자 진입 시 `signInAnonymously()` 익명 세션 확보 → nickname 입력 → accept 제출 → `/moims/[id]/chat` 리다이렉트(CHAT-001 미구현, 경로 문자열만).
  - **`enable_anonymous_sign_ins = true`** (`supabase/config.toml`): Supabase 익명 로그인 활성화 + `anonymous_users = 30` 시간당 IP별 rate limit.

- **모임 도메인 (Moim CRUD + 멤버십 인가)** (SPEC-MOIM-001 — 자동 게이트 통과 — jest 105/105, coverage 96.79%, evaluator PASS / 백엔드 도메인, 디바이스 게이트 없음 → completed): 모임 라이프사이클(생성·조회·삭제)과 멤버십 데이터를 책임지는 백엔드 첫 기능 도메인 모듈 구현.
  - **Moim + MoimMember 모델 + 마이그레이션** (`apps/backend/prisma/schema.prisma`에 `Moim`(id, name, created_by, created_at) + `MoimMember`(moim_id + user_id 복합 PK, nickname, role default 'member', joined_at; moim_id → moim onDelete Cascade) 추가, 마이그레이션 `20260613155202_add_moim` 적용).
  - **6개 REST 라우트 + per-route 인증 가드**: `POST /moims`(201, 생성), `GET /moims`(200, 내 모임 목록), `GET /moims/:id`(200, 단건), `GET /moims/:id/members`(200, 멤버 목록 + nickname), `DELETE /moims/:id`(204, owner 전용 삭제 + Cascade), `DELETE /moims/:id/membership`(204, 일반 멤버 탈퇴 / owner 탈퇴 금지). `MoimController` class 레벨 `@UseGuards(SupabaseAuthGuard)` — 누락 없이 6개 라우트 전체 적용.
  - **assertMember/assertOwner 인가 단일 출처 (@MX:ANCHOR, 하위 SPEC 재사용 계약)**: `MoimService`에 `assertMember` + `assertOwner` 두 헬퍼를 단일 출처로 구현하고 `@MX:ANCHOR`로 표기. SPEC-CHAT-001/CHAT-002/MOIM-002가 이 인가 경계를 재사용할 계획. `MoimService`는 module에서 export됨(하위 SPEC 소비 가능).
  - **createMoim 원자 트랜잭션**: 모임 생성과 생성자 owner 멤버십 생성을 Prisma 인터랙티브 `$transaction(async tx => {...})` 콜백으로 단일 원자 단위로 처리 — 부분 성공 방지.
  - **owner 탈퇴 금지 / owner 전용 삭제(Cascade)**: owner는 자기 모임의 멤버십을 탈퇴할 수 없음(403); 퇴장 경로는 모임 삭제 전용. 모임 삭제 시 `MoimMember` Cascade 자동 정리.
  - **수동 입력 검증**: class-validator 미사용, `requireNonEmpty` 헬퍼로 nickname/name 빈 문자열 수동 400 검증.
  - **openapi/api-client 재생성**: 6개 라우트 포함 `openapi.json` 재생성 + `nx run api-client:generate` + `nx run api-client:typecheck` 통과.

- **expo-router 네비게이션 골격 + 라우트별 WebView 하이브리드** (SPEC-MOBILE-003 — 자동 게이트 통과 / 핵심 플로우 iOS 디바이스 검증 완료 / Google OAuth·Android·로그아웃 검증 대기): `apps/mobile`에 expo-router(SDK 56) 네이티브 네비게이션 골격을 도입하고, `apps/web`에 `(main)` 탭 라우트 그룹을 신설하여 동일 라우트 트리(`/home`/`/explore`/`/notifications`/`/profile`)를 웹·앱이 공유하는 하이브리드 아키텍처 완성.
  - **expo-router 네이티브 네비게이션 골격**: `app/_layout.tsx`(Root Stack + SplashScreen/useAppLifecycle/useAuthBridge/AuthContext 오케스트레이션), `app/index.tsx`(auth-state-core 결정 기반 Redirect), `app/(auth)/_layout.tsx`+`login.tsx`(기존 WebViewShell 이메일 로그인 in-WebView 흐름 보존), `app/(tabs)/_layout.tsx`(expo-router Tabs, emoji-glyph 아이콘, notifications 배지 mock, Tabs.Protected 가드), `app/(tabs)/{home,explore,notifications,profile}.tsx`(각 탭 = `${WEB_URL}/<route>` 호스팅 얇은 WebView 래퍼). `App.tsx` 제거 — `app/` 트리 단일 진입.
  - **웹 `(main)` 탭 라우트 그룹 + HomeTab**: `apps/web/app/(main)/layout.tsx`(공유 BottomTabBar + 인증 가드), `(main)/_components/BottomTabBar.tsx`(lucide-react + Tailwind v4, Figma 적응), `(main)/home/page.tsx`+`HomeTab.tsx`+`_mock.ts`(시간대별 인사말·아바타, 모임 생성 CTA, 필터 칩, 모임 카드 mock, 빈 상태), `(main)/{explore,notifications,profile}/page.tsx`(플레이스홀더). `apps/web/lib/auth/actions.ts` redirect `/me`→`/home`(이메일/가입/OAuth 3곳), mobile `oauth-bridge.ts` `DEFAULT_NEXT` `/home` 변경.
  - **네이티브 인증 상태 + 가드**: `lib/auth/auth-state-core.ts`(`{tokens, lastBridgeSignal}→{isSignedIn, redirectTo}` 순수 결정, @MX:ANCHOR, vitest 10종), `lib/auth/AuthContext.tsx`(SecureStore + bridge 신호 단일 소스). `Stack.Protected`/`Tabs.Protected` SDK 56 표준 가드.
  - **라우트별 WebView 래퍼 + 네비게이션 계약**: `lib/route-map-core.ts`(URL↔네이티브 라우트 1:1 매핑, @MX:ANCHOR, vitest 17종), `components/BridgedWebView.tsx`(공유 WebView seam). `decideWebViewLoad` 교차 라우트 차단+dispatch 확장(cross-route vitest 10종, 기존 origin 잠금 단언 보존). `decideBackPress` 라우트 컨텍스트 확장(app-lifecycle vitest +3).
  - **셸 모드 탭바 숨김**: `(main)/_components/ShellModeEffect.tsx`(soft-nav 안전 client component, `data-shell` 감지), inline shell-detect script 병행(full-load flash 방지). 셸 모드에서 웹 BottomTabBar 숨김 — 이중 탭바 방지. `x-nonce` 헤더 → inline script nonce(CSP 호환).
  - **디바이스 검증 수정 (ShellSessionAnnouncer)**: `(main)/_components/ShellSessionAnnouncer.tsx` — (main) 마운트 시 `getSession()`으로 쿠키 토큰 읽어 `session:synced`(v1 프로토콜, nonce, access_token dedup) 전송. 서버 액션 쿠키 세션 로그인 후 웹→네이티브 토큰 핸드오버 구현(D-V2 해소). 로그인→`/(tabs)/home` 네이티브 전환 + 콜드 재시작 세션 지속(AC-1/4 디바이스 PASS).
  - **의존성**: `expo-router ~56.2.10`, `react-native-safe-area-context`, `react-native-screens`, `expo-constants`(apps/mobile 스코프). `@react-native-cookies` jcenter()→mavenCentral() pnpm patch(`patches/@react-native-cookies__cookies.patch`, Android Gradle 9 호환).
  - **테스트**: mobile vitest 134/134(94 기존 baseline + 40 신규: route-map-core 17, auth-state-core 10, crossroute 10, app-lifecycle +3). web tsc 0 + next build. mobile tsc 0 + expo export.
  - 검증: 자동 게이트 전부 통과. iOS 시뮬레이터 디바이스 검증: AC-1(로그인→네이티브 (tabs)/home) PASS, AC-4(콜드 재시작 세션 지속) PASS, AC-5(셸 모드 탭바 숨김 + 데스크톱 /home) PASS, AC-7(moyura:// 딥링크 공존) PASS. AC-2/3/8 자동 PASS. Google OAuth 라운드트립(실계정 수동 검증 대기), 로그아웃 E2E(탭 플로우 밖), AC-6 Android back(Android 제외) 미검증 — status in-progress 유지.

- **WebView 셸 컴포넌트화** (SPEC-WEBVIEW-SHELL-001 — 자동 게이트 통과 / 디바이스 검증 대기): 모놀리식 `App.tsx`를 재사용 가능한 컴포넌트·훅으로 행위 보존 추출(회귀 0).
  - `components/WebViewShell.tsx`: source URL prop + 이벤트 핸들러 prop을 받는 재사용 가능 WebView 셸 컴포넌트.
  - `components/LoadingOverlay.tsx`, `components/WebViewErrorOverlay.tsx`: 분리된 오버레이 presentational 컴포넌트.
  - `hooks/useAppLifecycle.ts`: Android 하드웨어 백/네비 이력 관리 훅.
  - `hooks/useAuthBridge.ts`: OAuth 인터셉트→시스템 브라우저 브리지 훅 (SPEC-MOBILE-002 토큰 브리지 확장 지점).
  - 검증: typecheck 0 / vitest(훅 특성화 테스트 포함) 통과 / expo export OK. 디바이스 종단(AC-S3) 수동 검증 대기.
- **토큰 기반 느슨한 결합 세션 + 보안 강화 네이티브↔웹 브리지** (SPEC-MOBILE-002 — 자동 게이트 통과 / 디바이스 검증 대기): 세션 권위는 웹에 두고 네이티브가 토큰을 캐시하는 느슨한 결합 파운데이션 + 보안 강화.
  - `apps/mobile/lib/auth/token-store.ts` + `token-store-core.ts`: `expo-secure-store`(`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) 기반 access+refresh 토큰 캐시.
  - `apps/mobile/lib/auth/bridge-protocol.ts` + `nonce-core.ts`: 버전드 postMessage 스키마(v1), per-session nonce 인증, 콜드스타트/resume/로그아웃/clear 5종 메시지 타입.
  - `apps/mobile/lib/auth/auth-bridge-core.ts` + `app-lifecycle-core.ts`: 콜드스타트 핸드셰이크(SecureStore 토큰 → 웹 `setSession()` 검증/갱신 → synced/none 회신 → SecureStore 갱신) + resume 재검증 + 스플래시 타임아웃 폴백(R-N6).
  - `apps/web/lib/native-bridge/`: `NativeBridgeProvider.tsx`(인바운드 메시지 수신 + origin/nonce 검증), `bridge-protocol.ts`(웹 측 브리지 스키마), `bridge-client.ts`(setSession 배선), `LogoutBridgeNotifier.tsx`(로그아웃 시 `session:cleared` emit).
  - 보안: WebView `originWhitelist` + `onShouldStartLoadWithRequest` origin 잠금, specific `targetOrigin`(NOT `"*"`), per-request CSP(`proxy.ts`/`middleware.ts`). expert-security re-review CRITICAL/HIGH 모두 closed.
  - 검증: mobile vitest 89/89 pass / web typecheck 0 + `next build` pass. 디바이스 종단 OAuth/핸드셰이크 검증(AC-V3) 수동 검증 대기.

- **환경/인프라 배선** (SPEC-ENV-SETUP-001): mobile/web/backend 세 앱과 Supabase PostgreSQL 사이의 환경/인프라 wiring을 완성하여 "프런트엔드 → 백엔드 → DB" end-to-end 동작을 `GET /health`로 증명.
  - **Prisma 7.8.0 + Supabase 연결**: `prisma-client` 제너레이터(source-emit, `moduleFormat=cjs`), `@prisma/adapter-pg` driver adapter, `pg`. 듀얼 URL 패턴(런타임 pooled `DATABASE_URL` / 마이그레이션 `DIRECT_URL`)을 `prisma.config.ts`에 구성.
  - **로컬 Supabase CLI 스택**: `supabase/config.toml` + `README.md`. direct Postgres `:54322`(로컬은 pooler 미노출, pooler는 prod 전용).
  - **환경변수 검증**: NestJS `@nestjs/config` + Zod 4 부팅 시 fail-fast 검증(누락/불일치 시 non-zero exit).
  - **OpenAPI 타입드 클라이언트**: `@nestjs/swagger`로 `/api`에 OpenAPI 노출 + `openapi.json` emit → `@moyura/api-client`(`openapi-typescript` 타입 + 얇은 fetch 래퍼). Nx 타겟 `backend:openapi` → `api-client:generate` 체인(멱등, 캐시).
  - **헬스 엔드포인트**: `GET /health` — `SELECT 1` DB 프로브로 200(ok/up) / 503(degraded/down) 반환.
  - **CORS allowlist**: `CORS_ORIGINS`(validated config)에서 환경별 web + mobile origin 로드, 와일드카드 금지.
  - **프런트 env 가드**: web `NEXT_PUBLIC_API_BASE_URL`, mobile `EXPO_PUBLIC_API_BASE_URL`. 미설정 시 앱 부팅 경로(`lib/env.ts`)에서 명시적 throw.
  - **Auth seam**: no-op `SupabaseAuthGuard` + `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_JWT_SECRET` env 플레이스홀더(optional). 실제 인증 로직은 미구현.
  - **CI / EAS 스켈레톤**: `.github/workflows/ci.yml`(install → prisma generate → `nx affected` build/lint/test/typecheck, migrate/deploy 없음), `apps/mobile/eas.json` local/prod 프로파일, `docs/deploy-render.md` Render 배포 가이드.
- **Supabase 인증(authn)** (SPEC-AUTH-001): 웹 레이어가 세션을 소유하고 백엔드가 ES256 JWKS로 JWT를 검증하는 단일 인증 surface. email/pw 종단 동작 + 소셜/모바일 스캐폴드. evaluator-active PASS(security 0.97).
  - **백엔드 JWKS 검증 가드**: `SupabaseAuthGuard`(jose `createRemoteJWKSet` + `jwtVerify`, ES256 algorithms 고정, `alg:none`/alg-confusion 거부, `iss`/`aud`/`exp`/`nbf` normative, JWKS 실패 시 fail-closed, HS256-only 레거시 폴백). 보호 라우트(`/me`)에 per-route `@UseGuards` — `/health`·`GET /`는 public 유지.
  - **profile 모델 + UPSERT**: 첫 Prisma 도메인 모델 `Profile`(`id = sub` PK, `createdAt`), 마이그레이션 `20260602095934_init_profile`. `ProfileService.upsertBySub`(검증된 sub만, mass-assignment 차단).
  - **보호 라우트 `GET /me`**: 인증 사용자의 profile 반환 — 가드 + upsert 종단 증명.
  - **웹 세션(`@supabase/ssr` 0.10.3)**: browser/server 클라이언트, `proxy.ts` updateSession(Next 16 미들웨어), email/pw signup/login/logout, PKCE 콜백 라우트(`app/auth/callback`, 음성 경로 가드), `app/login`·`app/me`.
  - **소셜/모바일 OAuth 스캐폴드**: `supabase/config.toml` `[auth.external.google|apple|kakao]`(enabled=false, `env()` 시크릿), `apps/mobile` app scheme `"moyura"` + 시스템 브라우저 OAuth 헬퍼, deep-link redirect(`moyura://auth-callback`). 실제 provider 키·런타임 OAuth는 named follow-up.
- **로그인 화면 디자인 이식** (SPEC-LOGIN-UI-001): Figma Make "Meetup" LoginScreen 디자인을 `apps/web` 로그인 화면(`app/login`)에 그대로 이식하고 기존 SPEC-AUTH-001 server action에 배선. 신규 인증 로직 없이 UI만 교체.
  - **2뷰 LoginScreen**: 소셜 랜딩(로고/타이틀 "Meetup", Google/Apple/Email 버튼, "또는" 디바이더, 약관 푸터)과 이메일 폼(로그인/회원가입 토글, 이름 필드 조건부)을 client component 로컬 state(`showEmailForm`/`isSignUp`)로 전환.
  - **기존 액션 배선**: Google/Apple은 form+hidden `provider` 패턴으로 `signInWithOAuthAction`, 이메일/비번은 `useActionState`로 `signInAction`/`signUpAction` 호출, 성공 시 기존 `/me` 리다이렉트. `supabase.auth` 직접 호출·edge-function·`alert`·`console.log` 미사용.
  - **에러 통합**: `useActionState` 에러와 서버 `?error=` 초기값을 폼 상단 에러 박스에 통합 표시(OAuth 실패 시 이메일 폼 자동 오픈).
  - **의존성**: `lucide-react`(`Mail`/`Apple`) 런타임 추가, `GoogleIcon`은 인라인 SVG. Kakao 버튼 미노출.
  - 검증: SPEC 기준(테스트 하네스 미설치) — `next build`/`tsc --noEmit`/`eslint` 통과 + 금지패턴 grep 0건. RN WebView 풀스크린·Figma 픽셀 일치는 미검증(시각 확인 권고).
- **로컬 소셜 로그인(Google)** (SPEC-AUTH-002): 로컬 Supabase 스택에 실제 Google OAuth 키를 배선해 로그인 화면 Google 버튼이 종단 동작(동의 → 세션 → `/me`). Apple은 follow-up.
  - **provider 활성화**: `supabase/config.toml` `[auth.external.google]` `enabled=true` + `skip_nonce_check=true`(로컬 전용), client_id/secret은 `env()` 치환만(시크릿 비커밋). `supabase/.env.example` + README 절차 추가.
  - **호스트 통일(localhost)**: PKCE `code_verifier` 쿠키 호스트 바인딩으로 인한 `exchange_failed` 해결 — 웹 앱(포트 3000) `site_url`/`additional_redirect_urls`/`CALLBACK_URL`을 `http://localhost:3000`으로 통일. GoTrue(54321)는 `127.0.0.1` 유지(Google 콘솔 redirect URI 불변).
  - **소셜 로그인 성공 → `/me`**: `signInWithOAuthAction` `redirectTo`에 `?next=/me` 추가(비번 로그인과 일관).
- **모바일 WebView 셸 + Google OAuth 브리지** (SPEC-MOBILE-001, M1~M3 구현 / 디바이스 종단 검증 대기): `apps/mobile`(Expo 56)가 `apps/web`을 풀스크린 WebView로 호스팅하는 씬 셸 + WebView 안 웹 로그인의 Google OAuth를 시스템 브라우저로 브리지.
  - **풀스크린 WebView 셸**: `react-native-webview@13.16.1`(Expo 56 핀), `App.tsx` 단일 WebView(SafeAreaView, 로딩 인디케이터, 복구 가능 에러+재시도, Android 하드웨어 백). `EXPO_PUBLIC_WEB_URL` env 가드(`lib/web-url.ts`, `lib/env.ts` 패턴, 미설정 시 부팅 throw) + 환경별 호스트 매핑(Android emu `10.0.2.2`, iOS sim `localhost`, 실기기 LAN IP).
  - **Google OAuth 브리지**: `onShouldStartLoadWithRequest`로 GoTrue authorize URL 인터셉트(임베디드 로드 차단 — Google의 webview OAuth 차단 회피) → `redirect_to`를 `moyura://auth-callback`로 재작성(브라우저 쿠키 half-auth 회피, OD-5) → `openAuthSessionAsync` 시스템 브라우저 → deep-link 복귀 → WebView가 웹 콜백(`?code=`) 로드 → WebView 쿠키 컨텍스트로 세션 확립. **웹 코드 변경 0**(기존 `signInWithOAuthAction`/`auth/callback` 재사용). 순수 URL 로직은 `lib/auth/oauth-bridge.ts`로 분리.
  - **모바일 테스트 하네스 도입**: vitest(node-env) — `resolveWebUrl` + oauth-bridge 헬퍼 순수 함수 12 테스트. nx `test` 타겟 추가.
  - 검증: typecheck 0 / vitest 12/12 / expo export 번들 OK. **디바이스 종단(R-P2)·에뮬레이터 호스트↔OAuth 허용목록(OD-2)은 미검증** — Android 우선 수동 검증 follow-up. SPEC-LOGIN-UI-001 OD-5/AC-H1(WebView 풀스크린 렌더)은 디바이스 검증 시 닫힘.

### Changed

- **`apps/backend/main.ts`**: 하드코딩된 포트 `3000` 대신 validated config(`PORT`)에서 listen 포트를 읽도록 변경.
- **`packages/api-client`** (`@moyura/api-client`): 계획 단계에서 실제 워크스페이스 패키지로 생성되어 web/mobile이 소비. SPEC-AUTH-001에서 optional `getToken`→`Authorization: Bearer` 주입(토큰 URL/query 금지)과 `getMe()` 편의 메서드 추가.

[Unreleased]: https://github.com/hatae94/moyura/compare/HEAD
