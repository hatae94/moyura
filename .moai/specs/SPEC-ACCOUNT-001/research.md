# Research: SPEC-ACCOUNT-001 (회원 탈퇴)

> 조사 시점: 2026-07-02. 확정 범위: Supabase auth 계정 + PII 즉시 삭제(프로필, 이메일, FCM 토큰), 작성 UGC는 "탈퇴한 사용자"로 익명화, 다른 멤버를 위한 모임 기록 무결성 보존.

---

## 사용자 모델과 삭제 영향도 (FK/RLS/realtime/FCM)

### 사용자 모델

- **Profile 테이블**: `apps/backend/prisma/schema.prisma:18-31` — PK `id`(TEXT) = Supabase JWT `sub`(UUID 문자열), `name`(nullable TEXT, SPEC-MOBILE-004), `createdAt`. 별도 UUID 컬럼 없는 app-owned profile 패턴. `auth.users`로의 FK 없음(Supabase 내부 스키마 접근 불가). 생성 마이그레이션: 20260602095934_init_profile, name 추가: 20260615000000_add_profile_name.
- **인증 통합**: `apps/backend/src/auth/supabase-auth.guard.ts` — Supabase 공개키로 JWT 검증 후 `sub` 추출. `apps/backend/src/profile/profile.service.ts:1-43` — `upsertBySub(sub)`가 프로필 생성 단일 진입점(첫 GET /me에서 호출), 클라이언트 입력 미수용.
- **Supabase Admin Client 미사용**: 현 백엔드 코드에 admin client 사용 흔적 없음(grep 0건). **auth.users 삭제를 위해 service-role 키 기반 Admin Client(`auth.admin.deleteUser(uuid)`) 도입이 신규 요구사항.**

### 사용자 ID 참조 전수 (soft-ref, FK 없음)

**핵심 발견: 어떤 테이블도 profile.id로의 FK가 없다.** 모든 사용자 참조는 TEXT soft-ref이며, profile 행 삭제는 **아무것도 캐스케이드하지 않는다**. 탈퇴 처리는 아래 전 테이블을 명시적으로 순회해야 한다.

| 테이블 | 사용자 컬럼 | 용도 | 마이그레이션 / 스키마 위치 |
|---|---|---|---|
| profile | id | Supabase sub PK (단일 auth 앵커) | 20260602095934_init_profile |
| moim | created_by | 모임 생성자 sub | 20260613155202_add_moim:6 (미인덱스) |
| moim_member | user_id (복합 PK) | 멤버 sub | 20260613155202_add_moim:14 |
| moim_invite | created_by | 초대 발행자 sub | 20260613171209_add_moim_invite (미인덱스) |
| chat_message | sender_id | 메시지 작성자 sub | 20260613175232_add_chat (FK 없음), schema.md:198 |
| device_token | user_id | 토큰 소유자 sub | 20260614_add_device_token, `@@index([userId])`, schema.md:287 |
| poll | created_by | 투표 생성자 sub | 20260619100000_add_poll (미인덱스), schema.md:227 |
| poll_vote | user_id (복합 PK) | 투표자 sub | 20260619100000_add_poll, schema.md:266 |
| notification | recipient_id | 수신자 sub | 20260701200000_add_notification, 인덱스 2개 `(recipient_id, id DESC)` + `(recipient_id, read_at)`, schema.md:359 |
| notification | actor_id (nullable) | 알림 액터 sub | 동일, schema.md:365 |
| settlement_request | requester_id / debtor_id | 채권자/채무자 sub | 20260701210000_add_settlement_request, schema.md:137, :139 |
| expense | created_by / payer_user_id | 기록자/결제자 sub | 20260624100000_add_expense, schema.md:85, :83 |
| expense_share | user_id | 분담자 sub, `@@index([userId])` | 20260624100000_add_expense, schema.md:100 |
| settlement | from_user_id / to_user_id / settled_by | 채권/채무/정산기록자 sub | 20260624100000_add_expense, schema.md:116, :117, :119 |
| schedule_event | created_by | 일정 세션 생성자 sub | 20260701000000_add_schedule, schema.md:310 |
| schedule_slot | user_id (복합 PK) | 가용 슬롯 소유자 sub | 20260701000000_add_schedule, schema.md:334 |

- 참고: 캐스케이드는 **moim 삭제 시**에만 존재 — moim.id 삭제 시 moim_member, moim_invite, chat_message, poll→poll_option→poll_vote, notification, settlement_request, expense→expense_share+settlement, schedule_event→schedule_slot 전부 연쇄 삭제 (`.moai/project/db/schema.md:262-273` + 각 마이그레이션 FK 정의).

### RLS / realtime 영향

- **채팅 브로드캐스트**: `realtime.messages` SELECT 정책 "members can receive moim broadcasts" — moim_member 존재 여부로 구독 승인. 마이그레이션 20260613175232_add_chat의 SECURITY DEFINER `broadcast_chat_message()`(search_path=''). 탈퇴 후 메시지 행은 남지만, 삭제된 사용자 auth 컨텍스트로는 구독 불가.
- **알림 브로드캐스트**: 정책 "users can receive own notifications" — `realtime.topic() = 'user:' || (SELECT auth.uid())::text`. 마이그레이션 20260702000000_add_notification_realtime_broadcast의 `broadcast_notification_new()`. per-user private 채널 `user:{recipientId}`.
- **테이블 RLS**: chat_message / notification / settlement_request — `ENABLE ROW LEVEL SECURITY` + 정책 없음 = default deny. Prisma는 postgres 롤로 RLS 우회, 인가는 NestJS 서비스 레이어.
- **auth 삭제 후 동작**: auth.users 행이 지워지면 클라이언트 JWT 디코드 실패 → realtime 구독(`moim:{id}`, `user:{id}`)이 RLS 게이트에서 조용히 실패(auth.uid()가 null). 정상적 열화(재로그인 유도)이며 데이터 누출 없음 — `.moai/project/db/rls-policies.md:34-36, 254-255` (원 조사에는 `apps/moai/...`로 표기되었으나 실제 경로는 `.moai/project/db/rls-policies.md`로 확인).

### 모임 소유자(owner) 모델과 고아화 리스크

- owner 정의: `ROLE_OWNER = 'owner'` 상수(`apps/backend/src/moim/moim.service.ts:17-18`), `moim_member.role` 문자열 저장(schema:181-182). 모임 생성 트랜잭션에서 생성자가 자동 owner(schema:30-60).
- owner 제약: leave 불가(`leave()` — moim.service.ts:148-161, role='owner'면 ForbiddenException), 모임 삭제는 owner 전용(`deleteMoim()` — moim.service.ts:281-284, assertOwner 게이트 line 282), owner 강퇴 불가(kickMember — moim.service.ts:186-223, line 200 검사), 위임은 `transferOwner()`(moim.service.ts:227-277, 원자 트랜잭션, createdBy 불변).
- **탈퇴 전 위임 강제 로직이 없다.** owner가 위임 없이 계정을 삭제하면 모임은 접근 가능한 owner가 없는 상태가 된다(moim.created_by와 role='owner' 행이 모두 삭제된 사용자 지칭). 이후 owner 전용 작업(모임 삭제, 강퇴, 설정 변경)은 assertOwner에서 전부 실패. **SPEC 결정 사항**: 자동 위임(예: 최장 재직 멤버) vs 탈퇴 차단(owner 모임 보유 시) vs 고아 허용 — 확정 범위("다른 멤버를 위한 모임 기록 무결성 보존")를 만족하려면 고아 허용은 부적합.

### FCM / 푸시 인프라

- **device_token 테이블**: `apps/backend/prisma/schema.prisma:283-296` — `token`(TEXT PK), `user_id`, `platform`, `created_at`, `updated_at`, `@@index([userId])`(팬아웃 벌크 조회용, schema.prisma:109 언급). user_id FK 없음 → 탈퇴 전 등록 해제가 안 되면 고아 토큰 행 잔존.
- **알림 팬아웃**: Notification 모델(schema.prisma:356-378), AFTER INSERT → `broadcast_notification_new()` → `realtime.send()` to `user:{recipient_id}`. 트리거는 BEGIN...EXCEPTION...END로 감싸 best-effort(20260702000000_add_notification_realtime_broadcast) — 브로드캐스트 실패가 INSERT를 막지 않음.
- **PushListener**: 도메인 이벤트 수신 → 수신자 산출 → device_token을 userId IN (...)으로 조회 → FCM 발송. 삭제된 사용자는 조회 결과 공집합 → 조용한 무발송.

### 익명화 대상과 구현 옵션

작성 콘텐츠(chat_message, poll, notification, expense, settlement 등)는 작성자 sub만 저장하고 **작성자 이름 컬럼이 없다** — 표시 시점에 클라이언트가 profile/moim_member에서 이름을 해석한다. profile 삭제 시 이름 조회가 실패하므로 "탈퇴한 사용자" 표시를 위한 구현 옵션(원 조사 제시):
- **Option A**: sender_id/created_by를 NULL로 — nullable 컬럼 전환 + API 응답 coalesce 필요.
- **Option B**: 예약된 "탈퇴 사용자" sub(예: 'system:withdrawn')로 UPDATE — 특수 마커 행으로 기존 프로필 조회 재사용.
- **Option C**: 각 테이블에 author_name_snapshot(nullable TEXT) 추가, 삭제 시점에 채움.

---

## 설정 UI·로그아웃·네이티브 브리지

### 설정/프로필 UI (탈퇴 버튼이 들어갈 자리)

- **프로필 페이지(서버 컴포넌트)**: `apps/web/app/(main)/profile/page.tsx:1-75` — "마이 페이지"(웹 브라우저·모바일 WebView 공유). `requireNamedSession()` 가드, 이메일(읽기 전용)·가입일·이름 표시. **line 65-72에 로그아웃 버튼**(`<form action={signOutAction}>`).
- **프로필 폼(클라이언트)**: `apps/web/app/(main)/profile/profile-form.tsx:1-66` — `useActionState`, `updateProfileAction` 호출, uncontrolled input, 저장 피드백 "저장되었습니다".
- **서버 액션**: `apps/web/app/(main)/profile/actions.ts:1-58` — `updateProfileAction()`(lines 26-58): PATCH /me, revalidate, 세션 부재 시 /login 리다이렉트, 실패 시 일반화 에러.
- **자연스러운 배치**: `(main)` 라우트 그룹이 인증된 표면. "회원 탈퇴"는 (a) profile/page.tsx의 로그아웃 버튼(line 65-72) 옆, 또는 (b) 신규 `apps/web/app/(main)/profile/account-deletion.tsx`(확인 모달 포함 클라이언트 컴포넌트) + actions.ts 확장(`deleteAccountAction()`).

### 로그아웃 플로우 (탈퇴 후 세션 정리의 참조 구현)

1. **트리거**: profile/page.tsx:65-72의 폼 제출 → `signOutAction`.
2. **서버 사인아웃**: `apps/web/lib/auth/actions.ts:197-202` — `supabase.auth.signOut()`(line 200, SSR 미들웨어 세션 클리어, R-D5) 직후 `redirect("/login")`(line 201). **서버 리다이렉트가 클라이언트 JS보다 먼저 일어나므로 클라이언트 측 가로채기 불가** — 네이티브 통지는 /login 마운트 시점에 수행.
3. **네이티브 통지(WebView 한정)**: `apps/web/app/login/page.tsx`가 `<LogoutBridgeNotifier />` 마운트 → `apps/web/lib/native-bridge/LogoutBridgeNotifier.tsx:23-29` — 마운트 시 `notifyNativeSessionCleared()`(line 25), WebView 아니면 no-op, DOM 출력 없음.
4. **브리지 메시지**: `apps/web/lib/native-bridge/bridge-client.ts:346-352` — 브리지 부재 시 no-op(R-T4), `session:cleared` 메시지를 per-session nonce와 함께 postToNative(line 351). 직렬화 포맷: `apps/web/lib/native-bridge/bridge-protocol.ts:164-167`.

### 모바일 네이티브 측 (SecureStore / WebView)

- **nonce 검증**: `apps/mobile/hooks/auth-bridge-core.ts:140-167` — `verifyNonce()`(lines 151-153, 상수 시간 비교). 토큰은 SecureStore에 저장.
- **콜드스타트 핸드셰이크**: auth-bridge-core.ts:103-112 — `MAX_INJECTION_RETRIES = 5` 유계 재시도, 네이티브가 `session:restore` 주입 → 웹이 `session:synced`/`session:none` 응답.
- **`session:cleared` 수신 시 네이티브 의무**(useAuthBridge 훅에 암묵 정의, R-R2/OD-10): SecureStore의 access/refresh 토큰 삭제, `isSignedIn = false`, 로그인 화면 복귀, (선택) WKHTTPCookieStore 리셋.
- **쿠키 시딩**: 서버 액션이 Supabase SSR 미들웨어로 세션 쿠키를 설정/삭제하고, WebView가 이를 읽음. `announceSessionFromCookies()`(bridge-client.ts:305-334)가 쿠키를 읽어 네이티브에 토큰 공지. (`apps/web/app/(main)/layout.tsx`에 암묵적 연관)

### FCM 토큰 등록/해제 (탈퇴 시 삭제 대상 PII)

- **등록 API**: `POST /devices` — `apps/backend/src/push/device-token.controller.ts:36-51`: token/platform 비어있으면 400, userId는 guard 검증 sub만 사용, 201. 서비스: `apps/backend/src/push/device-token.service.ts:22-32` — token PK 기준 upsert(같은 토큰 재등록 시 userId/platform 갱신 = 기기 핸드오프).
- **해제 API**: `DELETE /devices/:token` — device-token.controller.ts:56-67(IDOR 보호 주석 line 55), 204. 서비스: device-token.service.ts:40-44 — `where: { token, userId: sub }` **둘 다 일치해야 삭제**(line 42), deleteMany라 미일치 시 count 0으로 멱등.
- **모바일 클라이언트**: `apps/mobile/lib/push/register-device.ts:78-107`(`registerDevice()` — 토큰 획득 lines 29-48, body 구성 line 88, POST lines 93-95, 모듈 스코프 `lastRegisteredToken` 캐시 line 99, best-effort 비차단), `:119-133`(`unregisterDevice()` — 캐시 토큰 사용 line 120, DELETE line 125, 성공 시 캐시 클리어/실패 시 유지 line 129). 로그아웃/세션 클리어 시 useAuthBridge에서 호출.

### 탈퇴 시 네이티브 셸이 해야 할 일 (조사 제안 시퀀스)

WebView 내 /profile에서 탈퇴 서버 액션이 성공하면: (1) 무효화 신호 수신(신규 브리지 메시지 예: `account:deleted`, 또는 로그아웃과 동일하게 /login의 LogoutBridgeNotifier 경유), (2) SecureStore 토큰 삭제(로그아웃과 동일, 멱등), (3) WKHTTPCookieStore의 `sb-*` 쿠키 삭제, (4) 앱 상태 리셋(isSignedIn=false, 프로필 캐시 클리어), (5) 로그인/온보딩 화면 이동(에러 다이얼로그 없이), (6) 딥링크 히스토리 클리어(예: /moims/123/chat 잔존 방지).

### 보안 관련 확인 사항

- 토큰 postMessage 경로: bridge-client.ts:207-237 — `lastAnnouncedAccessToken` dedup(lines 210-236), 토큰 값 미로깅(line 216), ReactNativeWebView 채널 한정, nonce 없으면 skip(line 228).
- 세션 고정 방어: bridge-client.ts:182-193 — origin + nonce 검증 후 setSession(lines 185-190), 상수 시간 비교, 외부 origin 메시지 무시.
- FCM 페이로드 최소화: `apps/backend/src/push/fcm-sender.ts:11-14` — `PushData = Record<string, string>`(line 12), userId/nickname/email 미포함(OD-4).

---

## 구현 컨벤션

신규 계정 삭제 로직(account 모듈 또는 profile 모듈 확장)이 따라야 할 코드베이스 컨벤션.

### NestJS 모듈 구조
- 파일 배치: `apps/backend/src/{domain}/` 아래 `{domain}.module.ts` / `{domain}.controller.ts` / `{domain}.service.ts` / 선택적 `{domain}.listener.ts` / `dto/` / `{domain}.service.spec.ts`. 실제 예: notification.module.ts:1-18, schedule.module.ts:1-14, expense.module.ts:1-15.
- 모듈 임포트: AuthModule(가드) 필수, assertOwner/assertMember가 필요할 때만 MoimModule(schedule.module.ts:7-8, expense.module.ts:7-9). 본인 리소스(sub==key) 인가면 moim 임포트 불필요(notification.module.ts:7-12). PrismaService는 글로벌.
- 컨트롤러: per-route 또는 클래스 레벨 `@UseGuards(SupabaseAuthGuard)`(notification.controller.ts:52, 76, 93 / schedule.controller.ts:38 / expense.controller.ts:53). **ValidationPipe 부재** — 헬퍼로 명시적 400(notification.controller.ts:41-43, parseMarkReadBody :130-148, requireInt/requireStringArray schedule.controller.ts:58-64, requirePositiveInt/requireCategory expense.controller.ts:73-76). 인가 키는 guard 검증 `user.sub`만(notification.controller.ts:64-68) — **탈퇴 대상 식별도 반드시 sub, body의 userId 금지**. BigInt는 `.toString()`(notification.controller.ts:168).
- 서비스 인가: WHERE절 내장 패턴(notification.service.ts:94-96 @MX:ANCHOR — "recipientId 필터가 격리의 단일 소스"), 도메인 검증은 서비스(expense.service.ts:97-99 @MX:ANCHOR — assertOwner + 원자 트랜잭션).

### DB 마이그레이션
- 위치: `apps/backend/prisma/migrations/YYYYMMDD*_description/migration.sql`, 전부 additive/비파괴(20260701200000_add_notification:1-34 신규 테이블, 20260624100000_add_expense:4-69 nullable 컬럼 + 신규 테이블). **익명화를 위해 컬럼을 nullable로 바꾸거나(Option A) 스냅샷 컬럼을 추가(Option C)하는 경우에도 기존 행이 영향받지 않는 additive 형태 유지.**
- RLS 패턴(20260701200000:24-34): ENABLE + 정책 없음 = default deny, Prisma는 postgres 롤이라 무관.
- FK가 대상 테이블 생성 이후에 오도록 마이그레이션 내 순서 유지.

### Jest 테스트 (inMemory fake Prisma)
- 패턴: notification.service.spec.ts:17-173, schedule.service.spec.ts:30-173 — fake 테이블 Map/배열(notification.service.spec.ts:40-44, schedule.service.spec.ts:30-34), jest.fn은 `async` 금지 + `Promise.resolve/reject`(notification.service.spec.ts:108-119, schedule.service.spec.ts:62-76), `as unknown as PrismaService` 합성(notification.service.spec.ts:161-165), args 타입 인터페이스(schedule.service.spec.ts:9-16), 헬퍼 팩토리(notification.service.spec.ts:54-90, schedule.service.spec.ts:26-27), mock 호출 검증(notification.service.spec.ts:175-199, line 193), 복사 변이로 테스트 격리(notification.service.spec.ts:139-141). **다중 테이블 순회 삭제 검증에 특히 유용 — 각 테이블 mock의 deleteMany/updateMany 호출을 개별 검증.**

### SPEC 문서
- frontmatter(SPEC-CHAT-002:spec.md:1-10, SPEC-MOIM-002:spec.md:1-10): id/version/status/created/updated/author/priority/issue_number.
- EARS(모듈당 ≤5): `REQ-PREFIX-NNN [Event-driven|State-driven|Ubiquitous|Unwanted]` + When/While…then…(shall) + AC 참조(SPEC-CHAT-002:spec.md:84-85, :100, SPEC-MOIM-002:spec.md:79-80).
- acceptance.md: Given/When/Then(SPEC-CHAT-002:acceptance.md:5-30), Edge Cases(:33-39), Quality Gates(백엔드 jest 85%+, 느슨한 결합 grep), DoD 체크리스트.
- plan.md: 접근 → 마일스톤(SPEC-MOIM-002:plan.md:21-41) → REQ 매핑 → 델타 마커 [NEW]/[MODIFY]/[REGEN](SPEC-MOIM-002:spec.md:96-104, plan.md:78-87).

### DTO
- Swagger 패턴(notification-response.dto.ts:1-95, schedule-response.dto.ts:1-66, :20-56): BigInt→string, Date→ISO-8601, `@ApiPropertyOptional({ nullable, type })`, `type: [Item]`, `!` definite assignment.

---

## 리스크와 암묵적 계약

1. **모임 owner 고아화** (schema.prisma:43-44, moim.service.ts:281-284, :148-161): owner 자동 위임 메커니즘 부재. 탈퇴 시 role='owner' 행이 삭제된 사용자를 가리키면 이후 owner 전용 작업 전부 실패. **결정 필요**: 자동 위임 vs 사전 경고 vs 탈퇴 차단(비어있지 않은 모임의 owner인 경우). 확정 범위의 "모임 기록 무결성 보존"과 직결.
2. **FK 부재로 인한 수동 정리 의무** (schema.prisma 전반, 전 마이그레이션): 모든 사용자 참조가 TEXT soft-ref — profile 삭제는 캐스케이드 없음. 영향 반경은 사용자 컬럼 보유 테이블 전체(moim.created_by, moim_member.user_id, chat_message.sender_id, device_token.user_id, poll.created_by, poll_vote.user_id, notification.recipient_id/actor_id, settlement_request.requester_id/debtor_id, expense.created_by/payer_user_id, expense_share.user_id, settlement.from_user_id/to_user_id/settled_by, schedule_event.created_by, schedule_slot.user_id — 원 조사는 "20+ 테이블"로 집계했으나 위 표 기준 사용자 컬럼 보유 테이블은 16종/컬럼 20개 내외로, 수치 표현에 차이가 있음을 명시).
3. **원자성 부재 리스크** (`apps/web/app/(main)/profile/actions.ts` 신규 액션 필요): auth 계정 삭제 + 앱 데이터 삭제/익명화가 동일 트랜잭션이 아니면, 중간 실패 시(auth 삭제 후 Profile 삭제 실패) auth는 사라지고 앱 데이터가 고아로 남는 레이스. auth.users는 Supabase 관리 영역이라 DB 트랜잭션에 포함 불가 — **순서 설계**(앱 데이터 먼저 정리 → auth 삭제, 또는 재시도 가능한 순서)와 실패 복구 방침 필요.
4. **고아 device_token** (schema.prisma:287, FK 없음): 등록 해제 없이 탈퇴하면 토큰 행 잔존. PushListener는 userId 조회 공집합으로 무발송(조용한 실패, 누출은 아님). **탈퇴 시 userId 기준 device_token 전체 삭제 필수**(확정 범위의 FCM 토큰 삭제). 관련: 토큰 PK upsert 특성상 같은 토큰이 새 사용자에게 재등록되면 이전 소유자 등록이 덮임(device-token.service.ts:22-32, push.listener.ts:63-70) — 탈퇴 삭제는 `userId` 조건 벌크 삭제로 처리(단건 unregister의 owner 검증 경로 device-token.service.ts:40-44와 구분).
5. **notification 잔존 누적** (schema.prisma:359, 20260701200000_add_notification:34): 삭제된 recipient_id의 알림 행은 영원히 읽히지 않음(JWT 디코드 불가로 user:{id} 구독 불가). 기능 리스크는 낮고 저장 낭비 — recipient_id 기준 삭제 권고.
6. **realtime RLS 열화** (rls-policies.md:34-36, 254-255): auth 삭제 후 구독이 조용히 실패 — 프론트가 재로그인 유도를 처리해야 함(정상적 열화, 데이터 누출 없음).
7. **정산 상호 참조** (20260701210000_add_settlement_request:12-13, schema.md:137-139): requester 탈퇴 시 요청 행 고아화, debtor는 죽은 사용자로부터의 요청을 계속 봄(혼란 UX). **결정 필요**: 탈퇴 사용자가 관련된 settlement_request를 익명화할지 삭제할지.
8. **삭제 중 트리거 레이스** (브로드캐스트 마이그레이션 전반: 20260613175232_add_chat, 20260622000000_add_poll_realtime_broadcast, 20260702000000_add_notification_realtime_broadcast, 20260624000000_add_moim_max_members_and_member_realtime 등): 탈퇴 진행 중 사용자 액션이 INSERT/UPDATE를 유발하면 broadcast_* 함수가 삭제된 user_id를 참조 — 트리거는 실패하지 않지만 구독자가 고아 actor_id를 수신. 탈퇴를 원자적 트랜잭션으로 묶거나 사전 구독 정리 권고.
9. **로그아웃 통지 레이스** (apps/web/lib/auth/actions.ts:197-202): 서버 리다이렉트가 클라이언트 통지보다 먼저 — /login의 LogoutBridgeNotifier 마운트 실패 시 네이티브가 session:cleared를 못 받음(네이티브 측 유계 재시도 R-T7로 완화되나 엣지 케이스 잔존). 탈퇴도 동일 경로를 쓰면 동일 리스크 상속.
10. **LogoutBridgeNotifier 마운트 의존** (apps/web/app/login/page.tsx, LogoutBridgeNotifier.tsx:1-30): 라우팅이 컴포넌트를 건너뛰거나 SSR 하이드레이션 실패 시 네이티브 미통지 — 네이티브 측 유계 재시도 + 타임아웃 폴백(R-N6)이 방어선.
11. **모바일 토큰 캐시 수명** (apps/mobile/lib/push/register-device.ts:26, 99, 129): unregister 실패 후 강제 종료되면 고아 토큰이 다음 registerDevice()까지 잔존(upsert로 완화되나 시간 갭 존재). 서버 측 userId 벌크 삭제가 최종 방어선.
12. **FCM best-effort 계약** (apps/backend/src/push/fcm-sender.ts:62-84): 발송은 fire-and-forget(큐/재시도/전달 보장 없음) — 토큰 해제가 실패하면 탈퇴 사용자 기기에 푸시가 갈 수 있음. 서버 측 토큰 삭제로 차단.
13. **WKHTTPCookieStore 정리 암묵 계약** (LogoutBridgeNotifier.tsx — 네이티브 브리지 책임): 네이티브가 쿠키를 명시적으로 지우지 않으면 잔존 세션 쿠키로 WebView 재인증 가능성.
14. **닉네임 익명화 충돌** (조사 간 충돌 지점): UGC 표면 조사는 "moim_member.nickname은 과거 기록 맥락 유지를 위해 보존"을 권고했으나, 확정 범위는 "작성 UGC를 '탈퇴한 사용자'로 익명화"다. 채팅 발신자 이름은 클라이언트가 moim_member.nickname으로 해석하므로(schema.md:91-92), 닉네임을 보존한 채 멤버십 행을 지우면 표시 폴백은 `알 수 없음(sub 앞 8자)`(chat page.tsx:207-214)이지 "탈퇴한 사용자"가 아니다. **"탈퇴한 사용자" 표시를 위해서는 (a) moim_member 행을 남기고 nickname을 "탈퇴한 사용자"로 UPDATE하거나, (b) 각 표시 지점의 폴백 문구를 변경하는 구현 결정이 필요** — 두 조사 결과가 상충하므로 plan 단계에서 명시적으로 해소할 것.
15. **모듈 순환 의존 함정**: account 정리 로직이 safety 모듈(SPEC-SAFETY-001의 block/report 행 정리)과 상호 호출하면 순환 임포트 — EventEmitter 기반 분리(SPEC-CHAT-002 §4 REQ-PUSH-004의 grep 검증 컨벤션 준용). 차단 테이블이 생기면 탈퇴 시 blocker/blocked 양방향 행 정리도 대상에 포함.
16. **BigInt 직렬화**: notification id 등 BigInt 반환 필드는 `.toString()` 누락 시 응답에서 조용히 깨짐(notification.controller.ts:168 패턴 준수).

---

## 구현 접근 권고

조사 결과를 종합한 권고안 (확정 범위 기준):

1. **삭제 오케스트레이션 서비스** (신규, 예: `apps/backend/src/account/`):
   - 순서: **(1) 사전 검증** — 소유 모임 존재 여부 확인(owner 고아화 방지: 위임 유도 또는 자동 위임/탈퇴 차단 중 SPEC 결정 반영) → **(2) 앱 데이터 정리(단일 Prisma 트랜잭션)** — PII 삭제(device_token by userId 벌크 삭제, notification by recipient_id 삭제)와 UGC 익명화 → **(3) Supabase Admin Client로 `auth.admin.deleteUser(sub)`** (service-role 키, 환경변수 신규 도입 — 현 코드베이스에 admin client 부재).
   - (2)와 (3)은 같은 트랜잭션에 못 묶이므로, (2) 성공 후 (3) 실패 시 재시도 가능하도록 (2)를 멱등하게 설계.
2. **PII 삭제 대상 (확정 범위)**: profile 행(이름), auth.users(이메일/자격증명 — Admin API), device_token 전 행(FCM 토큰). 추가로 recipient_id 기준 notification, 본인이 만든 moim_invite 정리.
3. **UGC 익명화 ("탈퇴한 사용자")**: 원 조사의 Option A(NULL화)/B(예약 sub)/C(스냅샷 컬럼) 중, **모임 기록 무결성 보존**(확정 범위)과 additive 마이그레이션 컨벤션을 고려하면 — 작성자 컬럼(정산 계산에 쓰이는 expense/settlement의 user 컬럼 포함)을 유지한 채 **표시명 해석 경로를 바꾸는 방식**이 안전하다. 구체적으로 moim_member.nickname을 "탈퇴한 사용자"로 UPDATE하고 행을 보존하면(리스크 14의 옵션 a) 채팅/멤버 목록의 기존 해석 경로(schema.md:91-92, chat page.tsx:207-214)가 그대로 동작한다. 멤버십 행 보존 vs 삭제(멤버 정원·목록 노출에 영향)는 plan 단계에서 리스크 14와 함께 확정할 것.
4. **모임 무결성 보존**: 지출/정산/투표/일정 데이터는 삭제하지 않는다 — 다른 멤버의 원장·기록이므로 작성자 표시만 익명화. moim 자체와 캐스케이드 체인(schema.md:262-273)은 건드리지 않음.
5. **웹 UI**: profile/page.tsx의 로그아웃 버튼(line 65-72) 아래 "회원 탈퇴" 섹션 — 확인 모달(파괴적 액션 경고) → `deleteAccountAction()` 서버 액션(actions.ts 확장) → 성공 시 signOut + `redirect("/login")` 재사용.
6. **네이티브 브리지**: 로그아웃 플로우 재사용 — 탈퇴 성공 후 /login 리다이렉트 시 LogoutBridgeNotifier가 `session:cleared` 발신(bridge-client.ts:346-352), 네이티브는 SecureStore 토큰 삭제 + WKHTTPCookieStore `sb-*` 쿠키 삭제 + 상태 리셋. 별도 `account:deleted` 메시지 타입 추가는 네이티브 동작이 로그아웃과 동일하면 불필요 — 최소 변경 원칙.
7. **FCM 토큰**: 클라이언트 unregisterDevice()는 best-effort(register-device.ts:119-133)이므로 신뢰하지 않고, **서버 측 `deviceToken.deleteMany({ where: { userId: sub } })`를 삭제 트랜잭션에 포함**해 최종 보장.
8. **테스트**: fake Prisma 패턴으로 삭제 오케스트레이션 단위 테스트 — 각 테이블 mock의 deleteMany/updateMany 호출 검증, Admin Client는 인터페이스로 추상화해 mock. 백엔드 85%+ 커버리지, `nx lint backend` 통과. acceptance에는 auth 삭제 후 realtime 구독 실패의 정상 열화(재로그인 유도)와 owner 모임 처리 시나리오를 Given/When/Then으로 명시.

---

## 추가 조사 (갭 보강)

plan 단계 진입 전 갭 보강을 위해 수행한 추가 조사 결과. 특히 갭 A는 본문 "RLS / realtime 영향"의 "조용한 실패" 가정(research.md:45)과 리스크 6(realtime RLS 열화)의 결론을 정정한다.

### 갭 A. 탈퇴 계정의 JWT 유예 창 + GET /me 프로필 부활

#### 요약

문서화된 "조용한 실패" 가정과 실제 코드 동작 사이에 세 가지 구현 갭을 확인했다. 탈퇴한 사용자가 접근을 유지하고 삭제된 프로필을 부활시킬 수 있다:

1. **JWT 검증 갭**: 백엔드 가드는 JWT 서명을 오프라인으로만 검증하며, 삭제 후에도 auth.users 행이 여전히 존재하는지에 대한 검증이 전혀 없다.
2. **프로필 부활**: GET /me 엔드포인트가 upsertBySub를 호출해, 유효한 JWT sub라면 삭제된 계정이라도 Profile 행을 무조건 재생성한다.
3. **RLS 우회 리스크**: realtime 구독은 라이브 DB 상태가 아니라 JWT 클레임(auth.uid())에 의존 — jwt_expiry=3600으로 1시간 접근 창이 생긴다.

#### A-1. JWT 검증: 오프라인 서명 전용, auth.users 조회 없음

**apps/backend/src/auth/token-verifier.service.ts:87-121** — verify() 메서드:
- line 91-101: alg 추출 및 화이트리스트(ES256/HS256만 허용)
- line 103-110: jwtVerify()로 issuer/audience/만료 규범 검증(jose 라이브러리)
- line 112-115: sub 클레임 존재(비어있지 않은 문자열) 검증
- line 117-120: VerifiedUser { sub, role } 반환
- **auth.users.id가 sub와 일치하는 행이 존재하는지 확인하는 DB 조회 없음**

검증 경로(line 104-106):
- ES256 → verifyEs256()(line 124-144): jose jwtVerify + JWKS resolver, issuer/audience/clock-tolerance
- HS256 → verifyHs256()(line 147-164): HMAC secret 검증만 수행

**핵심 갭**: 두 경로 모두 JWT의 암호학적 유효성만 인증하고, Supabase auth.users 테이블은 확인하지 않는다. auth.admin.deleteUser(sub)로 계정이 삭제되어도, 삭제 전 발급된 JWT는 최대 jwt_expiry=3600초(supabase/config.toml:171) 동안 유효하다.

**apps/backend/src/auth/supabase-auth.guard.ts:35-52** — 가드 계층에 2차 검증 없음:
- line 37: Bearer 토큰 추출
- line 43: verifier.verify(token) 호출, VerifiedUser 또는 null 수신
- line 44-48: VerifiedUser면 request.user에 부착하고 true 반환
- **auth.users 존재를 확인하는 추가 가드 없음** — TokenVerifierService가 VerifiedUser { sub }를 반환하면 가드는 이를 전적으로 신뢰하고 라우트 접근을 허용한다.

#### A-2. GET /me 프로필 부활: upsertBySub의 무조건 행 생성

**apps/backend/src/profile/me.controller.ts:35-51** — GET /me 엔드포인트:
- line 36: @UseGuards(SupabaseAuthGuard)로 라우트 보호
- line 42: @CurrentUser()로 가드의 VerifiedUser 수신
- line 44: **profileService.upsertBySub(user.sub) 호출** — Profile 행 생성 또는 갱신

**apps/backend/src/profile/profile.service.ts:21-29** — upsertBySub():

```typescript
async upsertBySub(sub: string): Promise<Profile> {
  return this.prisma.profile.upsert({
    where: { id: sub },
    create: { id: sub },
    update: {},
  });
}
```

- line 23: where id=sub 조건의 Prisma upsert
- line 26: 행이 없으면 create { id: sub } (name 없이 id만)
- line 27: 있으면 갱신 없음(name 보존)

**핵심 취약점**: auth.admin.deleteUser(sub)로 계정이 삭제되고 Profile 행도 지워진 뒤, 잔존 JWT의 GET /me 호출이 upsertBySub를 타면 **Profile(id=sub)이 name NULL 상태로 무조건 재생성된다**. "즉시 삭제" 인수 기준 위반.

프론트엔드 트리거 — 보호 라우트 렌더마다 자동 GET /me:
- **apps/web/lib/auth/require-named-session.ts:36-75**: line 36의 requireNamedSession(React cache() 함수), line 58에서 api.getMe() — access_token을 가진 createApiClient로 HTTP GET /me 호출, line 69-71에서 name 존재 검증(없으면 /onboarding 리다이렉트)
- **apps/web/app/moims/layout.tsx:14-24**: line 18에서 await requireNamedSession() — moims/* 라우트 렌더마다 GET /me 실행

시나리오:
1. 사용자 탈퇴 → auth.users 삭제, Profile 삭제
2. WebView가 (main) 또는 moims 라우트 내 이동
3. requireNamedSession()이 잔존 JWT로 GET /me 발사
4. 백엔드 가드가 JWT 수락(서명 유효, auth.users 존재 미확인)
5. upsertBySub가 Profile 행 재생성(PII 부활)
6. 탈퇴 요청에도 사용자에게 프로필이 복원된 것처럼 보임

#### A-3. realtime RLS: 라이브 DB 상태가 아닌 JWT 클레임 검증

**.moai/project/db/rls-policies.md:34** — "members can receive moim broadcasts" 정책:

```sql
EXISTS (SELECT 1 FROM moim_member m
  WHERE 'moim:'||m.moim_id = realtime.topic()
  AND m.user_id = auth.uid())
```

정책이 검증하는 것은 (a) jose 검증된 클레임에서 디코드한 auth.uid()와 (b) user_id가 일치하는 moim_member 행 존재뿐이다. auth.uid()는 JWT 클레임의 **무상태 추출**이므로, auth.admin.deleteUser(sub) 이후에도:
- Supabase는 기발급 JWT를 회수(revoke)하지 않는다
- 클라이언트는 삭제 전 토큰으로 WebSocket/구독을 계속 전송한다
- auth.uid() 추출은 성공한다(JWT 클레임은 읽기 전용)
- moim_member 행 존재 검사만이 실질 게이트 — 삭제된 사용자의 auth 컨텍스트는 JWT 만료 또는 명시적 블랙리스트(표준 Supabase 동작 아님) 전까지 유효하다

**기존 가정의 정정 (research.md:45)**: "auth.users 행이 지워지면 클라이언트 JWT 디코드 실패 → realtime 구독이 RLS 게이트에서 조용히 실패(auth.uid()가 null)" 가정은 **사실과 다르다**. JWT 디코드는 암호학적 검증이지 auth.users 조회가 아니므로 성공한다. RLS 게이트도 실패하지 않는다 — auth.uid()는 삭제된 사용자의 sub(JWT 클레임에 잔존)로 평가되고, (권고안 3대로 행 보존 + 익명화 시) moim_member 행이 존재하면 구독은 **성공**한다.

#### A-4. 종합: 3중 충돌 지점

| 단계 | 발견 | 근거 |
|------|------|------|
| Auth | deleteUser 후 auth.users 존재 확인 없음 | token-verifier.service.ts:87-121 |
| Guard | JWT VerifiedUser를 2차 검증 없이 신뢰 | supabase-auth.guard.ts:35-52 |
| Endpoint | GET /me가 삭제된 Profile 행을 무조건 upsert | profile.service.ts:21-29 |
| Frontend | 보호 라우트 렌더마다 GET /me 자동 호출 | require-named-session.ts:58; moims/layout.tsx:18 |
| RLS | 라이브 auth.users 상태가 아닌 JWT 클레임 검증 | rls-policies.md:34 |
| Config | jwt_expiry=3600초(1시간) 잔존 창 | supabase/config.toml:171 |

#### A-5. 멤버십 삭제 vs 보존의 모순

본문 리스크 14(research.md:153 "닉네임 익명화 충돌")와 권고안 3(research.md:167)은 moim_member 행 보존 + nickname "탈퇴한 사용자" UPDATE를 권고하지만, realtime RLS 정책(rls-policies.md:34)은 `EXISTS (SELECT 1 FROM moim_member m WHERE ... AND m.user_id = auth.uid())`로 구독을 승인한다. 권고안 3대로 행을 보존하면 잔존 JWT를 가진 탈퇴 사용자가:
1. realtime RLS 통과(moim_member 행 존재)
2. assertMember(sub, moimId) 검사 통과(moim.service.ts:97-105에서 멤버십 발견)
3. 채팅 메시지 송수신 지속
4. realtime 브로드캐스트 참여 지속

**잔존 토큰 접근을 차단하지 않은 채 멤버십 행 보존안을 채택하면 즉시 삭제 계약을 위반한다.**

#### A-6. 인수 기준 모순 정리

본문 리스크 절(research.md:140-154)에서 식별한 긴장 관계의 구체화:

- **요구 A (확정 범위)**: "즉시 삭제" — PII 즉시 제거
- **요구 B (권고안 3)**: moim_member 행 보존 + 닉네임 익명화("탈퇴한 사용자")
- **실제 동작**: JWT 토큰은 삭제 후 1시간 유효 / 명시적으로 막지 않으면 GET /me가 Profile 재생성 / moim_member 보존 시 realtime RLS가 접근 허용

즉시 삭제 의도를 달성하려면 다음 중 하나가 필요:
1. moim_member 행 삭제(멤버 수·이력 상실, "무결성 보존" 목표와 충돌)
2. 가드에서 auth.users 미삭제 검증(오프라인 검증 아키텍처 파기, DB 왕복 필요)
3. 발급 토큰의 명시적 블랙리스트/회수(토큰 denylist 저장소 필요, 표준 Supabase 아님)
4. 1시간 잔존 접근 창 수용 + Profile 부활의 명시적 차단

#### 갭 A 리스크

1. **token-verifier.service.ts:87-121** — JWT 서명 검증이 auth.users 존재를 확인하지 않음; 오프라인 검증은 서명이 유효한 토큰을 만료 전까지 전부 수락.
2. **profile.service.ts:21-29** — upsertBySub가 유효 JWT sub면 삭제된 계정이라도 Profile 행을 무조건 재생성; 즉시 삭제 계약 위반.
3. **require-named-session.ts:58 + moims/layout.tsx:18** — 보호 라우트 렌더마다 자동 GET /me 호출 → 1시간 JWT 만료 창 내 프로필 부활 트리거.
4. **supabase-auth.guard.ts:35-52** — 가드가 TokenVerifierService.verify() 반환값을 auth.users 존재에 대한 2차 검증 없이 신뢰.
5. **rls-policies.md:34** — realtime RLS "members can receive moim broadcasts"가 라이브 DB 상태가 아니라 JWT 추출 auth.uid() 클레임에 의존; 권고안 3대로 moim_member 행을 보존하면 삭제 계정의 구독은 실제로 실패하지 않음.
6. **supabase/config.toml:171** — jwt_expiry=3600(1시간) 잔존 접근 창; 프로덕션 Supabase의 JWT 만료 설정은 미확인이며 로컬 config와 다를 수 있음.
7. **research.md:153** — 멤버십 행 보존 + 닉네임 익명화는 논리적 비일관을 만든다: 잔존 JWT의 탈퇴 사용자가 assertMember(sub, moimId) 검사(moim.service.ts:97-105)를 통과해 JWT 만료 전까지 realtime 참여를 지속할 수 있음.
8. **research.md:45** — "auth 삭제 후 realtime 구독이 조용히 실패" 가정은 사실과 다름; JWT 디코드는 암호학적 검증 전용으로 auth.users 조회를 수행하지 않으며, moim_member 행이 존재하면 RLS 정책 평가가 성공함.

### 갭 B. 비-채팅 표면의 작성자 표시명 해석 경로·폴백 실태 및 멤버십 행 삭제 영향

#### B-1. 알림(Notification) 액터 표시명 해석 경로

**백엔드 조인 로직** — apps/backend/src/notification/notification.service.ts:118-139:
- listForRecipient() 메서드가 반환 행의 actorId들을 resolveActorNicknames(moimIds, actorIds)로 배치 조회
- 복합키 memberKey(moimId, userId)를 이용해 moimMember 테이블에서 nickname 검색
- **폴백**: actorId는 있으나 nickname을 찾을 수 없으면 UNKNOWN_ACTOR_NICKNAME = '알 수 없음' 대체(line 8, 133-134)
- actorId === null이면 actor: null(무행위자 알림, 닉네임 미렌더링)

**멤버십 행 삭제 시 영향**: 멤버가 탈퇴/강퇴되어 moimMember 행이 DELETE되면 —
- actorId는 Notification.actorId에 여전히 저장되어 있음
- resolveActorNicknames()의 moimMember.findMany()(line 193-194)가 **해당 행을 찾지 못함**
- nicknameByKey.get()(line 133) 조회 불가 → UNKNOWN_ACTOR_NICKNAME = '알 수 없음' 반환
- 후속 조회 시 해당 사용자의 모든 액터명이 '알 수 없음'으로 렌더링됨

**행 보존 선택 시**: moimMember 행을 DELETE하지 않고 nickname을 '탈퇴한 사용자'로 UPDATE하면 resolveActorNicknames()가 해당 행을 찾아 nickname = '탈퇴한 사용자'를 반환 — 후속 모든 조회에서 일관 표시(동형성 보장).

#### B-2. 경비(Expense) 결제자 표시명 해석 경로

**프론트엔드 렌더링 로직** — apps/web/app/moims/[id]/expenses/expenses-view.tsx:525-526, 705:

```typescript
const nickname = (userId: string) =>
  nicknameMap[userId] ?? `사용자(${userId.slice(0, 6)})`;
// 지출 내역 렌더링: nickname(expense.payerUserId)
```

- nicknameMap(line 452, ExpensesViewProps)은 백엔드가 제공하는 Record<string, string>(userId → nickname 매핑)
- **폴백**: nicknameMap에 없으면 `사용자(userId_앞6자)` 표시

**nicknameMap 구성 지점**: ExpensesView 컴포넌트가 page.tsx(Server)로부터 nicknameMap props를 받음. page.tsx가 data API 응답에서 members 배열을 포함시켜야 함(**VERIFY 필요** — page.tsx 직접 검증 필요). ExpenseListResponse 타입이 nicknameMap을 포함하는지 확인 필요.

**멤버십 행 삭제 시 영향**: 결제자의 moimMember 행이 DELETE되면 — Expense.payerUserId는 저장되어 있으나, 다음 조회 시 page.tsx의 members fetch가 **그 멤버를 포함하지 않음** → nicknameMap[payerUserId] = undefined → `사용자(userId_앞6자)` 표시.

**행 보존 선택 시**: members fetch가 그 멤버를 계속 포함 → nicknameMap[payerUserId] = '탈퇴한 사용자' → 일관된 표시.

#### B-3. 투표(Poll) 생성자 표시명 해석 경로

**프론트엔드 로직 (미구현 — 폴백 미정)** — apps/web/app/(main)/home/[id]/polls-section.tsx:
- poll 생성자(createdBy)를 렌더링하는 UI가 **보이지 않음**
- line 159-160에서 poll.createdBy === currentUserId만 사용(마감하기 버튼 노출 조건)
- **결론**: 투표 생성자명을 웹에서 표시하지 않으므로 멤버십 삭제의 직접 영향 없음

**향후 추가 UI 대비**: poll.createdBy를 표시하게 되면 ExpensesView의 nicknameMap 패턴을 따를 것으로 예상 — 행 삭제: `사용자(userId_앞6자)` 폴백, 행 보존: '탈퇴한 사용자' 일관 표시.

#### B-4. 일정 조율(Schedule) 멤버 가능시간 표시명 해석

**프론트엔드 로직** — apps/web/app/moims/[id]/schedule/schedule-view.tsx:1132, 1224, 1274, 1288:
- 구현: nicknameMap[userId] ?? "멤버"
- **폴백**: nicknameMap에 없으면 "멤버" 텍스트 표시(아바타는 "멤")

**nicknameMap 구성**: ScheduleView 컴포넌트가 page.tsx(Server)로부터 nicknameMap props를 받고, page.tsx가 members 배열을 fetch해 구성.

**멤버십 행 삭제 시 영향**: ScheduleSlot.userId는 저장되어 있으나(Cascade DELETE 없음), 다음 조회 시 members fetch에서 그 멤버가 빠짐 → nicknameMap[userId] = undefined → "멤버"/"멤" 표시(정확한 이름 손실).

**행 보존 선택 시**: members fetch에 계속 포함 → nicknameMap[userId] = '탈퇴한 사용자' → 일관 표시.

#### B-5. 멤버 목록(Members) 표시

**프론트엔드 로직** — apps/web/app/(main)/home/[id]/members-section.tsx:320-321:
- member.nickname 직접 렌더링(nicknameMap 미사용)
- **폴백 없음** — MoimMember 객체가 있으면 nickname 필드가 있음

**멤버십 행 삭제 시 영향**: 행이 DELETE되면 members 배열에서 완전히 제거 → 멤버 목록에 더 이상 표시되지 않음(데이터 손실).

**행 보존 선택 시**: 멤버 목록에 nickname = '탈퇴한 사용자'로 표시. 우려사항:
- 아바타 생성 로직이 nickname.charAt(0)에 의존(line 307) — '탈퇴한 사용자'[0] = '탈'로 일관성은 있음
- 하지만 owner 컨트롤(방장 위임, 강퇴)에서 탈퇴 멤버를 조작할 수 없으므로 UX 혼란 위험
- 대안: UI에서 탈퇴 멤버를 시각적으로 구분하거나 별도 섹션으로 분리

#### B-6. 멤버십 행 삭제/보존 시 maxMembers 정원 영향

**정원 계산 로직** — apps/backend/src/invite/invite.service.ts:152-157:
- currentCount = await moimMember.count({ where: { moimId } })
- 신규 가입 시 현재 멤버 수 >= moim.maxMembers이면 409 Conflict

**행 삭제 시**: count() 결과 감소 — 정원 5명 중 1명 탈퇴 시 count=3→4 흐름으로 신규 가입 정상 허용.

**행 보존 시**: count() 결과 불변 — 탈퇴 멤버를 "행으로 카운트"하므로 정원 5명 중 1명 탈퇴해도 count=4(탈퇴자 포함). 신규 가입은 1명만 추가 가능. **우려**: 정원의 의미가 "활성 멤버 수"가 아니라 "가입했던 모든 멤버"를 포함하게 됨.

#### B-7. 재가입(Rejoin) 시 닉네임 충돌 분석

탈퇴 후 재가입 시나리오: 멤버가 탈퇴(DELETE) → moimMember.accept()로 초대 재수락.

- **행 삭제 경로**: 닉네임 충돌 없음 — moimMember 행이 없으므로 create() 성공, 새 nickname 설정 가능.
- **행 보존 경로**: moimMember 행이 nickname='탈퇴한 사용자'로 유지 —
  - accept()의 upsert 로직 확인 필요(현재 코드에 명시 안 됨)
  - create-only라면: 복합 PK(moimId, userId) 충돌로 실패 → 멱등 처리 여부 불명
  - upsert라면: nickname을 새 값으로 갱신 가능(DELETE 불필요)

**VERIFY 필요**: invite.service.ts의 accept()가 moimMember를 create vs upsert 중 어느 방식으로 처리하는지 확인.

#### 갭 B 결론 및 권고

**행 삭제 선택 시 (갭 시나리오 1)** — 폴백 렌더링:
- 알림: '알 수 없음'(UNKNOWN_ACTOR_NICKNAME)
- 경비 결제자: '사용자(userId_앞6자)'
- 투표: 미표시(현재 UI 미구현)
- 일정: '멤버'(과도하게 일반적)
- 멤버 목록: 제외됨(데이터 손실)

문제점: 표면마다 다른 폴백 문구로 비일관성(사용자 혼란), 멤버 목록에서의 완전 소실. 정원 계산은 정상 작동(장점).

**행 보존 선택 시 (권고안 3 시나리오)** — 모든 표면에서 '탈퇴한 사용자' 일관 표시.

문제점: 멤버 목록에서 탈퇴 멤버가 활성 멤버처럼 표시(시각적 혼동), 정원 의미 모호(정원=가입 기록 수), 재가입 시 복합 PK 충돌 위험(upsert 여부 확인 필수).

**SPEC-ACCOUNT-001 의사결정 선행 필요사항**:
1. **멤버 목록 UI 설계**: 탈퇴 멤버를 시각적으로 어떻게 구분할 것인가
2. **행 보존 시 정원 의미**: "총 가입자" vs "활성 멤버" 정의 필요
3. **재가입 멤버십 로직**: invite.service.accept()가 create vs upsert 중 어느 것인지 확인

#### 갭 B 리스크

1. **apps/backend/src/notification/notification.service.ts:133-134** — 행 삭제 시 모든 actor 닉네임이 '알 수 없음'으로 폴백되어 알림의 출처가 불명확해지는 리스크.
2. **apps/web/app/moims/[id]/expenses/expenses-view.tsx:525-526** — 행 삭제 시 결제자가 '사용자(userId_앞6자)'로 표시되어 경비 내역 추적이 곤란해지는 리스크.
3. **apps/backend/src/invite/invite.service.ts:152-157** — 행 보존 선택 시 정원 카운트에 탈퇴 멤버가 포함되어 정원의 의미가 모호해지는 리스크.
4. **apps/web/app/(main)/home/[id]/members-section.tsx:303-306** — 행 보존 선택 시 멤버 목록에 탈퇴 멤버(nickname='탈퇴한 사용자')가 표시되어 사용자가 활성 멤버로 오해할 리스크.
5. **apps/backend/src/invite/invite.service.ts:160-210** — 행 보존 선택 시 재가입 멤버가 기존 moimMember 행과 복합 PK 충돌할 경우 create 실패 리스크(upsert 여부 미확인).
