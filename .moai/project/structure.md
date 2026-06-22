# Structure — moyura

> 본 문서는 실제 저장소(repo) 상태를 검증하여 작성되었다. 미생성 항목은 "계획(planned)"으로 명시한다.

## 모노레포 개요

- **워크스페이스 관리자**: pnpm workspaces (`pnpm@10.27.0`)
- **빌드 오케스트레이터**: Nx `21.6.7`
- **워크스페이스 글롭** (`pnpm-workspace.yaml`): `apps/*`, `packages/*`
- **node_modules 레이아웃** (`.npmrc`): `node-linker=hoisted` (Metro/Nest/Next가 npm·yarn과 동일하게 의존성을 해석하도록 평탄화)
- **단일 git 저장소**: remote `git@github.com:hatae94/moyura.git`, 브랜치 `master` (모노레포 통합 과정에서 중첩 `.git`은 제거됨)

## 디렉터리 트리

검증 기준: 루트, `apps/`, `packages/` 실제 리스팅 (node_modules 제외).

```
moyura/
├─ apps/
│  ├─ backend/          # @moyura/backend — NestJS 11
│  │  ├─ src/
│  │  │  ├─ config/     # @nestjs/config + Zod fail-fast env 검증
│  │  │  ├─ health/     # GET /health (PrismaService SELECT 1 프로브)
│  │  │  ├─ auth/       # SupabaseAuthGuard(ES256 JWKS, jose) + TokenVerifierService + auth.config + @CurrentUser
│  │  │  ├─ profile/    # ProfileService(upsertBySub + updateName — SPEC-MOBILE-004) + me.controller(GET /me 보호 + PATCH /me 이름 업데이트 — SPEC-MOBILE-004) + profile-response.dto(name 포함) + update-name.dto
│  │  │  ├─ moim/       # 첫 기능 도메인 모듈 (SPEC-MOIM-001) — MoimModule/MoimService/MoimController + dto(create/response/member) + *.spec.ts + integration.spec.ts. assertMember/assertOwner 인가 단일 출처(@MX:ANCHOR). MoimService export — 하위 SPEC(CHAT-001/CHAT-002/MOIM-002) 재사용 계약. Moim.startsAt(DateTime?)+location(String?) additive nullable 추가(SPEC-MOIM-004 — 마이그레이션 20260619000000_add_moim_event_fields). CreateMoimDto optional startsAt/location. MoimResponseDto startsAt/location 직렬화. POST /moims optional 영속 + startsAt 무효 400. GET /moims·GET /moims/:id 응답에 두 필드 포함.
│  │  │  ├─ invite/     # 초대 도메인 모듈 (SPEC-MOIM-002) — InviteModule/InviteService/InviteController + dto(create-invite/accept-invite/response) + *.spec.ts + invite.integration.spec.ts. MoimModule import(assertOwner 재사용). 발급/목록/폐기(owner 전용) + accept(멱등/원자 usedCount).
│  │  │  ├─ chat/       # 채팅 도메인 모듈 (SPEC-CHAT-001) — ChatModule/ChatService/ChatController + chat-events.ts(이벤트 계약 소유·export, @MX:ANCHOR) + dto(send-message/get-history/message-response) + *.spec.ts + chat.integration.spec.ts. MoimModule import(assertMember 재사용). EventEmitterModule 인프라 선행 도입(CHAT-002가 구독할 chat.message.created 이벤트 계약).
│  │  │  ├─ poll/       # 투표 도메인 모듈 (SPEC-MOIM-005/006/007/008/010) — PollModule/PollService/PollController + dto(create-poll/vote/poll-response) + *.spec.ts. @Controller('moims/:id/polls'): POST /(생성, 멤버 전용, question+옵션≥2, optional multiSelect(기본 false) + optional closesAt(ISO, 무효→400) + optional kind("general"|"date"|"place", 미지→400, SPEC-MOIM-008/010) — kind="date"이면 options[]를 ISO 날짜로 파싱(parseOptionDates, 무효→400); kind="place"이면 options[]를 자유 텍스트 normalizeOptions(일반과 동일, ISO 파싱 안 함 — SPEC-MOIM-010); 빈 question/옵션<2→400, 비멤버→403), POST /:pollId/vote(마감 검사(closesAt<=now → 409) → poll.multiSelect 분기: 단일=deleteMany+create 교체/다중=findUnique 토글, 잘못된 optionId→400), POST /:pollId/close(생성자 전용: assertMember→poll 일관성(404)→비생성자 403→closesAt=now, 멱등 200; kind="date"이면 finalize: 단일 최다 득표→MoimService.setStartsAt(moimId,winner.optionDate)/동점→tie skip/무표→no_votes skip — SPEC-MOIM-008; **kind="place"이면 finalize: 단일 최다 득표→MoimService.setLocation(moimId,winner.label)/동점→tie skip/무표→no_votes skip — SPEC-MOIM-010**; kind="general"이면 finalize 없음), GET /(kind+옵션 optionDate(ISO|null)+closesAt+isClosed(서버계산)+voteCount+myVotes[]+multiSelect+비멤버→403). close 응답: finalizedStartsAt(ISO|null)+**finalizedLocation(string|null — SPEC-MOIM-010)**+finalizeSkippedReason("tie"|"no_votes"|null); vote/list 응답은 항상 null. PollService가 MoimService.assertMember 재사용(단일 출처 불변). Poll/PollOption/PollVote 3 테이블(SPEC-MOIM-005). Poll.multiSelect Boolean @default(false) 추가 + PollVote 복합 PK `(pollId,optionId,userId)` 비파괴 변경(SPEC-MOIM-006). Poll.closesAt DateTime? additive nullable 추가 — deadline+수동 마감 단일 컬럼(SPEC-MOIM-007). Poll.kind String @default("general") + PollOption.optionDate DateTime? additive 추가(SPEC-MOIM-008). myVote(string|null) → myVotes(string[]) 읽기 모델 변경(SPEC-MOIM-006). **MoimService.setLocation(moimId, location) 신규(location 쓰기 단일 출처 — setStartsAt 미러, SPEC-MOIM-010)**. jest 308/308.
│  │  │  ├─ push/       # FCM 푸시 도메인 모듈 (SPEC-CHAT-002) — PushModule/PushListener(@OnEvent 단방향, chat↛push 의존 방향 없음) + FcmSender(firebase-admin, graceful no-op) + DeviceTokenService(upsert/unregisterByOwner owner-scoped) + DeviceTokenController(POST /devices, DELETE /devices/:token) + dto(register-device/device-token-response) + *.spec.ts + loose-coupling.spec.ts. chat 모듈은 push 존재 미인지 — push는 chat-events.ts(@MX:ANCHOR) 계약에만 단방향 의존.
│  │  │  ├─ prisma/     # PrismaService (pg adapter, pingDatabase)
│  │  │  └─ generated/  # Prisma 7 source-emit 클라이언트 (gitignore, 재생성)
│  │  ├─ prisma/        # schema.prisma (Profile(name? — SPEC-MOBILE-004) + Moim(startsAt?/location? — SPEC-MOIM-004, polls Poll[] 역참조 — SPEC-MOIM-005) + MoimMember + MoimInvite + ChatMessage + DeviceToken + Poll(multiSelect Boolean @default(false) — SPEC-MOIM-006 / closesAt DateTime? — SPEC-MOIM-007 / kind String @default("general") — SPEC-MOIM-008)/PollOption(optionDate DateTime? — SPEC-MOIM-008)/PollVote(복합 PK (pollId,optionId,userId) — SPEC-MOIM-006) 모델) + migrations/20260602095934_init_profile + 20260613155202_add_moim + 20260613171209_add_moim_invite + 20260613175232_add_chat + 20260614_add_device_token + 20260615000000_add_profile_name(SPEC-MOBILE-004) + 20260619000000_add_moim_event_fields(SPEC-MOIM-004) + 20260619100000_add_poll(SPEC-MOIM-005 — Poll/PollOption/PollVote 신규 3 테이블) + add_poll_multi_select(SPEC-MOIM-006 — Poll.multiSelect 추가 + PollVote PK 비파괴 변경) + 20260620200000_add_poll_closes_at(SPEC-MOIM-007 — Poll.closesAt nullable additive 추가) + 20260621000000_add_poll_kind_option_date(SPEC-MOIM-008 — Poll.kind TEXT NOT NULL DEFAULT 'general' + PollOption.option_date nullable additive 추가) + 20260622000000_add_poll_realtime_broadcast(SPEC-MOIM-009 — broadcast_poll_change 함수 + poll_broadcast/poll_vote_broadcast 트리거 additive 추가, 테이블/컬럼 무변경, 순수 트리거)
│  │  ├─ test/          # 수동 통합 검증 스크립트 — chat.live.mts(SPEC-CHAT-001 AC-1c/4/5 정식 수동 검증 스크립트, 라이브 E2E 2026-06-15 완료) + poll-finalize.live.mts(SPEC-MOIM-008 날짜 투표 자동 확정 라이브 E2E 검증 스크립트, 실 Supabase 스택 15/15 PASS 2026-06-21 — me.live.mts/chat.live.mts 패턴 미러) + poll-realtime.live.mts(SPEC-MOIM-009 투표 실시간 broadcast 라이브 E2E 검증 스크립트, 실 Supabase 스택 7/7 PASS 2026-06-22 — chat.live.mts/poll-finalize.live.mts 패턴 미러; 멤버 2명 수신 + 비멤버 RLS 차단 + 경량 페이로드 {moimId,pollId} 확인) + poll-place-finalize.live.mts(SPEC-MOIM-010 장소 투표 자동 확정 라이브 E2E 검증 스크립트, 실 Supabase 스택 13/13 PASS 2026-06-22 — poll-finalize.live.mts 미러; 단일 승자→location 설정/동점 skip/무표 skip/일반 투표/비생성자 403/미지 kind 400 확인)
│  │  ├─ prisma.config.ts  # Prisma 7 연결 URL 위치
│  │  ├─ openapi.ts     # OpenAPI emit 스크립트
│  │  └─ openapi.json   # 커밋된 OpenAPI 계약 산출물
│  ├─ mobile/           # @moyura/mobile  — Expo RN 56, expo-router 파일 기반 라우팅, index.ts 커스텀 엔트리(env 가드 → expo-router/entry), app.json scheme "moyura"
│  │  ├─ app/           # expo-router 파일 기반 라우트 트리 (SPEC-MOBILE-003)
│  │  │  ├─ _layout.tsx         # Root Stack + SplashScreen·useAppLifecycle·useAuthBridge·AuthContext 오케스트레이션. **<Stack.Screen name="invite/[token]" /> 추가(SPEC-MOIM-011 — moyura://invite/{token} 딥링크 라우트 배선; 기존 (auth)·(tabs)·index Screen 보존)**
│  │  │  ├─ index.tsx           # auth-state-core 결정 기반 Redirect 분기
│  │  │  ├─ +not-found.tsx      # 404 폴백
│  │  │  ├─ (auth)/             # 비인증 그룹
│  │  │  │  ├─ _layout.tsx      # (auth) Stack 레이아웃
│  │  │  │  └─ login.tsx        # 기존 WebViewShell 재사용(이메일 로그인 in-WebView 흐름 보존)
│  │  │  ├─ invite/             # **SPEC-MOIM-011 신규 — 초대 딥링크 공개 랜딩 트리((tabs)·(auth) 그룹 밖)**
│  │  │  │  └─ [token].tsx     # **신규 — ${WEB_URL}/invite/${encodeURIComponent(token)} BridgedWebView 호스팅(MOIM-003 detail-in-WebView 패턴 미러). useLocalSearchParams 로 token 읽기. (tabs)·(auth) 가드 미상속(공개 랜딩 — 미인증 게스트 진입 가능). 수락은 WebView 안 웹 수락 페이지에 위임. moyura://invite/{token} → 이 라우트로 expo-router 자동 링크.**
│  │  │  └─ (tabs)/             # 인증 그룹 — 네이티브 Tabs
│  │  │     ├─ _layout.tsx      # expo-router Tabs(emoji-glyph 아이콘, notifications 배지 mock, Tabs.Protected)
│  │  │     ├─ home/            # 홈 탭 디렉터리 (SPEC-MOIM-003 — flat home.tsx 대체)
│  │  │     │  ├─ _layout.tsx  # expo-router Stack (네이티브 back → 목록 복귀 보장)
│  │  │     │  ├─ index.tsx    # ${WEB_URL}/home 호스팅 WebView 래퍼 (기존 home.tsx 이전)
│  │  │     │  └─ [id].tsx     # ${WEB_URL}/home/{id} 호스팅 BridgedWebView (상세 네이티브 라우트)
│  │  │     ├─ explore.tsx      # ${WEB_URL}/explore 호스팅 WebView 래퍼
│  │  │     ├─ notifications.tsx # ${WEB_URL}/notifications 호스팅 WebView 래퍼
│  │  │     └─ profile.tsx      # ${WEB_URL}/profile 호스팅 WebView 래퍼
│  │  ├─ components/    # WebViewShell.tsx, LoadingOverlay.tsx, WebViewErrorOverlay.tsx, BridgedWebView.tsx(탭 공유 seam + router.push (tabs)/home/[id] — SPEC-MOIM-003)
│  │  ├─ hooks/         # useAppLifecycle.ts(Android 백/네비 이력), useAuthBridge.ts(auth:google-request bridge command → 네이티브 Google Sign-In 경로(SPEC-MOBILE-004 v0.3.0 설계 변경) + onDetailPush 콜백(SPEC-MOIM-003) + 토큰 브리지 + 보안 + session:cleared 시 FCM 토큰 해제 연동 — SPEC-CHAT-002)
│  │  ├─ lib/           # env.ts(가드), api.ts(api-client 소비), route-map-core.ts(@MX:ANCHOR, URL↔라우트 매핑 + detailRouteForUrl/urlForDetailRoute 순수 함수 — SPEC-MOIM-003), auth/(oauth.ts·oauth-bridge.ts·bridge-protocol.ts(auth:google-request 커맨드 추가 — SPEC-MOBILE-004 v0.3.0)·nonce-core.ts·token-store.ts·token-store-core.ts·auth-bridge-core.ts(decideWebViewLoad detail-push 변형 추가 — SPEC-MOIM-003)·app-lifecycle-core.ts·auth-state-core.ts(@MX:ANCHOR)·AuthContext.tsx(로그인 후 FCM registerDevice 배선 — SPEC-CHAT-002)·google-signin-core.ts(순수 vitest 코어 — SPEC-MOBILE-004)·google-signin.ts(SDK 래퍼)·signin-id-token-core.ts(순수 vitest 코어 — SPEC-MOBILE-004)·supabase-mobile.ts(SDK 래퍼) + 보안/단위 테스트), push/(register-device-core.ts·register-device-core.test.ts·notification-core.ts·notification-core.test.ts·register-device.ts·notification-handler.ts — SPEC-CHAT-002)
│  │  ├─ plugins/       # withModularHeaders.js(Expo config plugin — use_modular_headers! Podfile 주입, GoogleSignin 8.x AppCheckCore 정적 통합 pod install 오류 해소 — SPEC-MOBILE-004 v0.3.0)
│  │  ├─ patches/       # @react-native-cookies__cookies.patch(jcenter→mavenCentral, Android Gradle 9 호환)
│  │  └─ eas.json       # EAS local/prod 프로파일 스켈레톤
│  └─ web/              # @moyura/web     — Next.js 16 (app/, public/)
│     ├─ lib/           # env.ts(가드), api.ts(api-client 소비), supabase/(browser·server 클라이언트, 세션 미들웨어), auth/(actions, callback, require-named-session.ts(공유 서버 가드 — SPEC-MOBILE-004)), native-bridge/(bridge-client.ts·bridge-protocol.ts(auth:google-request 커맨드 추가 — SPEC-MOBILE-004 v0.3.0)·NativeBridgeProvider.tsx·LogoutBridgeNotifier.tsx), invite/accept.ts(초대 수락 클라이언트 로직), chat/useChatChannel.ts(Supabase Realtime private channel 구독 훅 — SPEC-CHAT-001), poll/usePollChannel.ts(신규 — 모임 투표 실시간 구독 훅, useChatChannel 미러 — SPEC-MOIM-009; `moim:{id}` private 채널 `'poll_change'` 이벤트 구독, 수신 시 onChange(router.refresh) 호출, 언마운트 removeChannel, 토큰 가드), moim/api.ts(신규 — getMoim/getMoimMembers 헬퍼, chat/api.ts 패턴 미러 — SPEC-MOIM-003; MoimDetail 인터페이스에 startsAt/location nullable 추가 — SPEC-MOIM-004), moim/polls.ts(신규 — listPolls/createPoll/votePoll 구체-경로 헬퍼 — SPEC-MOIM-005; PollWithResults 타입 multiSelect+myVotes[] 갱신·myVote 제거 — SPEC-MOIM-006; PollWithResults closesAt/isClosed 추가 + closePoll 헬퍼 신규 — SPEC-MOIM-007; PollWithResults kind/옵션 optionDate 추가 + close 결과 타입 finalizedStartsAt/finalizeSkippedReason — SPEC-MOIM-008; **PollWithResults kind union "place" 확장 + close 결과 타입 finalizedLocation 추가 — SPEC-MOIM-010**), **moim/invites.ts(신규 — createInvite(api, moimId, body?) 구체-경로 헬퍼(POST /moims/:moimId/invites, lib/moim/polls.ts 패턴 미러) + InviteResult { token; expiresAt } 로컬 미러 타입 — SPEC-MOIM-011)**
│     ├─ app/           # auth/callback/route.ts(PKCE 콜백), login/, me/(require-named-session 가드 적용 — SPEC-MOBILE-004), invite/[token]/(초대 랜딩 — Server Component page.tsx[로그인 회원이면 GET /me Profile.name 을 input prefill, 게스트/익명 빈 값 — v0.5.0] + Client invite-accept-form.tsx[익명 로그인 → nickname → accept → /moims/[id]/chat]; **모바일 자동 열기 — useSyncExternalStore 로 모바일/앱 셸 판정, 모바일 브라우저(앱 셸 아님) 로드 시 useEffect+useRef 가드로 moyura://invite/{token} 1회 자동 발화(v0.4.0); "앱에서 열기" 버튼은 수동 재시도 폴백(데스크톱·앱 셸 미노출), 기존 닉네임 폼 보존 — SPEC-MOIM-011**), onboarding/(이름 입력 온보딩 — SPEC-MOBILE-004, (main) 그룹 외부, 루프 안전)
│     │  ├─ (main)/     # 탭 라우트 그룹 (SPEC-MOBILE-003) — layout.tsx(BottomTabBar·인증가드·ShellSessionAnnouncer·ShellModeEffect·require-named-session 가드 — SPEC-MOBILE-004) + _components/(BottomTabBar·PlaceholderTab·ShellModeEffect·ShellSessionAnnouncer) + home/(page·HomeTab·[id]/page) + explore/notifications/profile(플레이스홀더)
│     │  │  └─ home/   # 홈 탭 라우트 (SPEC-MOIM-003)
│     │  │     ├─ page.tsx       # 서버 컴포넌트 — GET /moims 실 데이터 조회 → HomeTab prop 전달
│     │  │     ├─ HomeTab.tsx    # mock→real 배선(MOCK_MEETUPS 제거), 카드 /home/{id} 링크; "새 모임 만들기" → /moims/new Link(비기능 → 기능형 — SPEC-MOIM-004); 카드에 일정/장소 정직 표시(SPEC-MOIM-004)
│     │  │     └─ [id]/          # 모임 상세 라우트 (SPEC-MOIM-003/004/005)
│     │  │        ├─ page.tsx         # 모임 상세 Server Component — GET /moims/:id + /members + GET /moims/:id/polls(SPEC-MOIM-005); (main) 가드 상속; 일정/장소 정직 표시(SPEC-MOIM-004); PollsSection Client 섬 마운트(+currentUserId prop 전달 — SPEC-MOIM-007). accessToken prop 추가(SPEC-MOIM-009 — session.access_token을 PollsSection에 전달; 기존 moimId/polls/currentUserId 보존, startsAt은 revalidatePath/router.refresh 재렌더로 자동 반영). **isOwner = moim.createdBy === session.user.id 계산 + <InviteButton isOwner={isOwner} moimId={id} accessToken={accessToken} /> 렌더(SPEC-MOIM-011 — owner 전용 초대 어포던스, 기존 섹션 무변경)**
│     │  │        ├─ polls-section.tsx # Client 컴포넌트(SPEC-MOIM-005/006/007/008/010) — 투표 목록(질문+옵션 득표 막대/퍼센트+내 표 강조)+단일/다중 선택 분기(PollCard — multiSelect 분기: 단일=버튼 교체/다중=체크박스형 토글+여러 강조)+마감 분기(isClosed: "마감됨" 배지+컨트롤 disabled+결과 유지 / 열림: MOIM-005/006 그대로)+생성자 "마감하기" 버튼(createdBy===currentUserId && !isClosed)+날짜 투표 분기(kind="date": 옵션 optionDate 포맷 날짜 렌더(raw ISO 금지)/확정 힌트("마감 시 최다 득표 날짜가 모임 일정으로 확정돼요")/동점·무표 notice — SPEC-MOIM-008)+**장소 투표 분기(kind="place": 옵션 label 텍스트 렌더(날짜 포맷 없음)/확정 힌트("마감하면 최다 득표 장소가 모임 장소로 확정돼요")/동점 notice("동점이라 장소가 자동 확정되지 않았어요") — SPEC-MOIM-010)**+생성 폼(useActionState+"여러 개 선택 허용" 토글+"마감 시각" datetime-local+**투표 종류 3-way 선택(일반/날짜/장소, name="kind" — 이진 "일정 투표" 토글 대체 — SPEC-MOIM-010)**)+빈 상태. OptionRow isMine = myVotes.includes(option.id). Meetup 오렌지 토큰
│     │  │        ├─ poll-actions.ts  # Server Action(SPEC-MOIM-005/006/007/008/010, "use server") — createPollAction(질문/옵션/multiSelect/closesAt/kind 검증→세션→createPoll→revalidatePath/오류; kind="date"이면 옵션을 toIsoOrUndefined로 ISO 변환 — SPEC-MOIM-008; **kind="place"이면 옵션 텍스트 그대로 전달(ISO 변환 없음) — SPEC-MOIM-010**) + voteAction(optionId→세션→votePoll→revalidatePath) + closePollAction(moimId/pollId→세션→closePoll→revalidatePath; close 결과 finalizedStartsAt/finalizeSkippedReason 반환 — SPEC-MOIM-008; **close 결과 finalizedLocation 반환 추가 — SPEC-MOIM-010**; SPEC-MOIM-007 신규)
│     │  │        ├─ invite-actions.ts # Server Action(SPEC-MOIM-011, "use server") — createInviteAction(moimId, accessToken → createInvite 헬퍼 호출 → InviteResult 반환; poll-actions.ts 패턴 미러)
│     │  │        └─ invite-button.tsx # Client 섬(SPEC-MOIM-011) — isOwner prop 기반 owner 전용 노출(비-owner null). "초대하기" 클릭 → createInviteAction → {origin}/invite/{token} 링크 표시 + navigator.clipboard 복사 + "복사됨" 피드백 + 오류 일반화. Meetup 오렌지
│     │  └─ moims/            # moims 서브트리 — (main) 라우트 그룹 밖
│     │     ├─ layout.tsx     # 서버 가드 (SPEC-WEB-GUARD-001) — requireNamedSession() await → children. 탭바 없음(chat 풀스크린)
│     │     ├─ new/           # 모임 생성 라우트 (SPEC-MOIM-004) — moims 그룹 가드 상속
│     │     │  ├─ page.tsx            # Server Component — 세션 access_token 도출 후 CreateMoimForm에 전달
│     │     │  ├─ create-moim-form.tsx # Client Component, useActionState — 이름/닉네임/일정(datetime-local)/장소. Meetup 오렌지 토큰+실시간 구독(accessToken prop+usePollChannel — SPEC-MOIM-009: router.refresh on poll_change)
│     │     │  └─ actions.ts          # createMoimAction Server Action — FormData → api-client createMoim → redirect("/home/{id}") / 실패 시 폼 머무름+일반화 오류
│     │     └─ [id]/chat/     # 모임 채팅 페이지 (SPEC-CHAT-001) — page.tsx(히스토리 로드 + useChatChannel 구독 + 실시간 수신 표시 + 메시지 전송). Meetup 디자인 시스템 리디자인(orange 토큰, 말풍선 own/other, sticky 헤더/입력바 — v0.3.1)
│     └─ proxy.ts       # @supabase/ssr updateSession + per-request CSP (Next 16 미들웨어 컨벤션). connect-src: 호스트-핀 wss/ws(Supabase Realtime) + 백엔드 API origin + Supabase REST — SPEC-CHAT-001 v0.3.1 수정
├─ packages/
│  ├─ config/           # @moyura/config  — 공유 tsconfig base (현재 스텁)
│  └─ api-client/       # @moyura/api-client — openapi-typescript 타입 + fetch 클라이언트. 기본 fetch를 `globalThis.fetch.bind(globalThis)`로 바인딩(브라우저 Illegal invocation 방지 — SPEC-CHAT-001 v0.3.1 수정)
├─ supabase/            # 로컬 Supabase CLI 스택 (config.toml — [auth.external.google|apple|kakao] enabled=false env() 스캐폴드, README.md, snippets/)
├─ docs/                # deploy-render.md (Render 배포 가이드)
├─ .github/workflows/   # ci.yml (install/build/lint/test/typecheck, migrate/deploy 없음)
├─ .moai/               # MoAI 설정·SPEC·프로젝트 문서
│  ├─ specs/SPEC-ENV-SETUP-001/
│  ├─ project/          # 본 문서 위치
│  └─ config/, brand/, db/ ...
├─ .nx/                 # Nx 캐시/데몬 작업 디렉터리
├─ nx.json              # Nx targetDefaults (build/lint/test/typecheck 캐시)
├─ pnpm-workspace.yaml  # 워크스페이스 글롭 + built-deps 정책
├─ pnpm-lock.yaml
├─ package.json         # 루트(private) — nx run-many 스크립트
├─ tsconfig.base.json   # 루트 공유 TS 컴파일러 옵션
├─ .npmrc               # node-linker=hoisted
├─ .mcp.json
└─ CLAUDE.md
```

> `packages/api-client/`는 **SPEC-ENV-SETUP-001(completed)에서 생성되어 디스크에 존재**한다(아래 표 참조). `apps/backend/src/generated/`와 `packages/api-client/src/schema.d.ts`는 gitignore되며 Nx 타겟으로 재생성된다.

## 워크스페이스 패키지 표

| 패키지 이름 | 경로 | 역할 | 스택 / 핵심 버전 | 상태 |
|-------------|------|------|------------------|------|
| `@moyura/mobile` | `apps/mobile` | 네이티브 앱 — expo-router 하이브리드 네비게이션 골격 + 라우트별 WebView + 토큰 기반 세션 브리지 | Expo `~56.0.6`, react `19.2.3`, react-native `0.85.3`, TypeScript `~6.0.3`, `react-native-webview@13.16.1`, `expo-secure-store ~56.0.4`, `expo-splash-screen ~56.0.10`, `expo-router ~56.2.10`, `react-native-safe-area-context`, `react-native-screens`, `expo-constants`, `@react-native-google-signin/google-signin@16.1.2`(SPEC-MOBILE-004), `@supabase/supabase-js@2.106.2`(SPEC-MOBILE-004) | **구현됨** (SPEC-MOBILE-001·SPEC-WEBVIEW-SHELL-001·SPEC-MOBILE-002·SPEC-MOBILE-003 iOS 핵심 플로우 디바이스 검증 완료 / SPEC-MOBILE-004 **completed** — 네이티브 Google Sign-In(bridge command) + 이름 온보딩 iOS 시뮬레이터 라이브 E2E 2026-06-17 PASS) |
| `@moyura/web` | `apps/web` | 메인 UI 표면 (App Router) | Next.js `16.2.6`, react `19.2.4`, Tailwind v4, TypeScript `^5` | 스캐폴드 |
| `@moyura/backend` | `apps/backend` | 백엔드 REST API | NestJS `11`(`@nestjs/common ^11`), TypeScript `^5.7.3`, Jest | 스캐폴드 |
| `@moyura/config` | `packages/config` | 공유 tsconfig base 의도 | 현재 `package.json`만 존재(`version 0.0.0`, private) | 스텁(빈 패키지) |
| `@moyura/api-client` | `packages/api-client` | OpenAPI 생성 타입드 API 클라이언트 | `openapi-typescript 7.13.0` 타입(`src/schema.d.ts`, gitignore) + 얇은 fetch 래퍼(`createApiClient`, `getHealth`, optional `getToken`→Bearer, `getMe`, `listMoims`(SPEC-MOIM-003 completed), `createMoim`+`CreateMoimRequest`(SPEC-MOIM-004), poll 타입 별칭 `CreatePollRequest`(multiSelect?, closesAt?, kind? — SPEC-MOIM-008)/`VoteRequest`/`PollResponse`(multiSelect+myVotes[], closesAt/isClosed, kind/옵션 optionDate/finalizedStartsAt/finalizeSkippedReason — SPEC-MOIM-008)) | **구현됨** (SPEC-ENV-SETUP-001 + SPEC-AUTH-001 + SPEC-MOIM-003 + SPEC-MOIM-004 + SPEC-MOIM-005) |

검증 메모:
- `@moyura/web`의 `version`은 `0.1.0`, 나머지 앱은 `1.0.0`(루트도 `1.0.0`).
- `@moyura/config`는 현재 `tsconfig` 파일을 포함하지 않은 스텁이다. "공유 tsconfig base" 역할은 의도이며, 실제 루트 공유 옵션은 `tsconfig.base.json`이 담당한다(현재 각 앱 tsconfig가 이를 참조하는지는 구현 시 정리 대상).

## Nx 타겟 / 캐시 개요

루트 스크립트(`package.json`)는 Nx로 위임한다:

| 루트 스크립트 | 명령 |
|---------------|------|
| `build` | `nx run-many -t build` |
| `lint` | `nx run-many -t lint` |
| `test` | `nx run-many -t test` |
| `typecheck` | `nx run-many -t typecheck` |
| `graph` | `nx graph` |

`nx.json` `targetDefaults` — 모두 `cache: true`:

| 타겟 | 캐시 입력(inputs) | 출력(outputs) |
|------|-------------------|----------------|
| `build` | `production`, `^production` | `{projectRoot}/dist`, `.next`, `build` |
| `lint` | `default` + eslint 설정 파일 | — |
| `test` | `default`, `^production` | — |
| `typecheck` | `default`, `^production` | — |

`sharedGlobals`: `tsconfig.base.json`, `pnpm-workspace.yaml` 변경 시 캐시 무효화.

프로젝트별 타겟(`project.json`, 모두 `nx:run-commands`로 앱 CLI 래핑):

| 프로젝트 | 정의된 타겟 |
|----------|-------------|
| `web` | `dev`, `build`(→`.next`), `start`, `lint`, `typecheck`(`tsc --noEmit`) |
| `mobile` | `start`, `android`, `ios`, `web`(Expo web), `typecheck`(`tsc --noEmit`) |
| `backend` | `prisma-generate`, `prisma-migrate`, `build`(→`dist`, `dependsOn: prisma-generate`), `openapi`(`dependsOn: build`), `typecheck`(`dependsOn: prisma-generate`), `start`, `start:dev`, `lint`, `test`(jest, `dependsOn: prisma-generate`) |
| `api-client` | `generate`(openapi.json → `openapi-typescript` 타입 생성), `build`(`dependsOn: generate`) |

> 인프라 타겟은 체인으로 연결된다: `backend:build` → `backend:openapi`(openapi.json emit) → `api-client:generate`(타입 재생성). 생성은 멱등이며 캐시된다(R-A1/R-A4/R-D4).
> Nx는 공식 플러그인(`@nx/next` 등)을 쓰지 않고 `nx:run-commands`로 각 앱의 네이티브 CLI(`next`, `expo`, `nest`, `prisma`)를 래핑한다. 자세한 내용은 [tech.md](./tech.md) 참조.

## RN 웹뷰 하이브리드 — 앱 간 관계

```
mobile (Expo 네이티브 셸 — WebViewShell + 훅 + 토큰 브리지, 구현됨)
   │  WebView 호스팅 (구현됨 — SPEC-MOBILE-001·SPEC-WEBVIEW-SHELL-001·SPEC-MOBILE-002)
   │  postMessage 토큰 브리지 (nonce 인증, versioned 스키마, specific targetOrigin)
   ▼
web (Next.js 메인 UI 표면 — @supabase/ssr 세션 권위, native-bridge 수신)
   │
   ├─ web   ── HTTP REST ─┐
   └─ mobile ── HTTP REST ─┴──▶ backend (NestJS API) ──▶ PostgreSQL (Supabase, 구현됨 — Prisma 7 + pg adapter)
```

- `mobile shell → WebView → web surface → REST → backend` 가 데이터/제어 흐름.
- 두 프런트엔드(`web`, `mobile`)는 동일 backend API를 소비한다.
- **현 시점 구현 상태 (SPEC-MOBILE-003 in-progress — iOS 핵심 플로우 디바이스 검증 완료; SPEC-MOBILE-004 completed — iOS 시뮬레이터 라이브 E2E 2026-06-17 PASS; SPEC-MOIM-003 completed — 인앱 E2E 사용자 디바이스 검증 2026-06-18 PASS)**:
  - `apps/mobile`: expo-router 파일 기반 라우팅(`app/` 트리) — Root Stack + `(auth)`(로그인 WebView) + `(tabs)`(네이티브 Tabs, 각 탭 = `${WEB_URL}/<route>` 호스팅 WebView 래퍼). `App.tsx` 제거. `components/BridgedWebView.tsx` 공유 seam.
  - `apps/web`: `(main)` 탭 라우트 그룹(BottomTabBar + HomeTab + 플레이스홀더 3종). 셸 모드에서 웹 BottomTabBar 숨김(ShellModeEffect + ShellSessionAnnouncer). post-login redirect `/me`→`/home`.
  - 네이티브 인증 상태: `lib/auth/auth-state-core.ts`(SecureStore + bridge 신호 → isSignedIn 순수 결정, @MX:ANCHOR), `lib/auth/AuthContext.tsx`. `Stack.Protected`/`Tabs.Protected` 가드.
  - 네비게이션 계약: `lib/route-map-core.ts`(URL↔라우트 1:1 매핑, @MX:ANCHOR) + `decideWebViewLoad` 교차 라우트 차단+dispatch 확장.
  - 토큰 기반 느슨한 결합 세션: `ShellSessionAnnouncer`((main) 마운트 시 `getSession()` → `session:synced` 핸드오버, D-V2 수정). 웹이 세션 권위; 네이티브는 SecureStore 캐시. 버전드 nonce 인증 postMessage 브리지(SPEC-MOBILE-002).
  - 보안: nonce 인증 + WebView origin 잠금 + specific targetOrigin + per-request CSP + x-nonce inline script 호환.
  - iOS 시뮬레이터 디바이스 검증: AC-1(로그인→네이티브 (tabs)/home) PASS, AC-4(콜드 재시작 세션 지속) PASS, AC-5(셸 모드 탭바 숨김) PASS, AC-7(moyura:// 딥링크 공존) PASS. Google OAuth·Android·로그아웃 E2E 검증 대기.

## 인증 흐름 (SPEC-AUTH-001, 구현됨)

웹 레이어가 세션을 소유하고, 백엔드가 stateless JWT 검증자가 되는 단일 인증 surface:

```
웹/모바일(시스템 브라우저 OAuth or email/pw)
   │  @supabase/ssr 쿠키 세션 (proxy.ts updateSession, PKCE 콜백 app/auth/callback)
   ▼
Supabase 세션 access_token (ES256)
   │  @moyura/api-client getToken → Authorization: Bearer (토큰 URL/query 금지)
   ▼
NestJS SupabaseAuthGuard (jose createRemoteJWKSet, ES256 JWKS 검증, @UseGuards on /me)
   │  검증된 sub
   ▼
ProfileService.upsertBySub (Prisma Profile, id=sub PK, 멱등 UPSERT)
   │
   ▼
GET /me → 200 profile (id === sub) — 가드 + upsert 종단 증명
```

- 세션 소유 = 웹(`apps/web/lib/supabase` + `proxy.ts`). 소셜 OAuth는 시스템 브라우저(모바일 `lib/auth/oauth.ts`), email/pw는 webview 내 동작 + 로컬 종단 테스트 경로.
- 백엔드 가드는 `/me`에 per-route `@UseGuards`(global 아님) — `/health`·`GET /`는 public 유지.
- 소셜 provider 키·모바일 런타임 OAuth는 named follow-up(스캐폴드만). 상세: [`SPEC-AUTH-001/spec.md`](../specs/SPEC-AUTH-001/spec.md) Implementation Notes.

## 모듈 경계 / 의존 방향

권장 의존 방향(단방향):

```
@moyura/api-client ────────────┐
  ▲ (openapi.json 계약 생성)     ├──▶ @moyura/web    ──┐
@moyura/backend ────────────────┤    @moyura/mobile  ─┴──▶ (런타임) @moyura/backend API
@moyura/config (공유 tsconfig) ─┘
```

- `@moyura/web`, `@moyura/mobile`은 `@moyura/api-client`를 워크스페이스 의존으로 **소비한다**(구현됨, R-A2). web은 `transpilePackages`, mobile은 직접 import.
- 계약 흐름: `@moyura/backend`가 OpenAPI(`openapi.json`)를 emit → `@moyura/api-client`가 그로부터 타입을 생성 → web/mobile이 api-client를 소비. 즉 **web/mobile → @moyura/api-client → (계약) backend openapi**.
- `@moyura/backend`는 프런트엔드 패키지에 의존하지 않는다(역방향 의존 금지). backend → api-client는 코드 의존이 아니라 openapi.json 계약 산출물 관계다.
- 프런트엔드 ↔ 백엔드의 **런타임** 결합은 컴파일 의존이 아니라 HTTP REST로만 이루어진다.
- `@moyura/config`는 빌드 타임 tsconfig 공유 용도이며 런타임 코드 의존이 아니다.
