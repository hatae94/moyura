# Tech — moyura

> 본 문서는 **구현됨(IMPLEMENTED)** 과 **계획됨(PLANNED)** 을 명확히 구분한다.
> 환경/인프라 배선은 [`SPEC-ENV-SETUP-001`](../specs/SPEC-ENV-SETUP-001/spec.md)(status: `completed`, v0.3.0)에서 정의되었고 **구현 완료**되었다(`master`, 커밋 `7362e2a..1895e05`).
> 인증(authn)은 [`SPEC-AUTH-001`](../specs/SPEC-AUTH-001/spec.md)(status: `completed`, v0.3.0)에서 **구현 완료**되었다(`master`, 커밋 `6ca29fd..d54adb0`, evaluator-active PASS — security 0.97). 남은 PLANNED 항목은 prod 배포 파이프라인과 인증 후속 과제(소셜 키, 이메일 확인/재설정, RBAC, 프런트 테스트 타겟)뿐이다.
> 모임 도메인은 [`SPEC-MOIM-001`](../specs/SPEC-MOIM-001/spec.md)(status: `completed`, v0.2.0)에서 **구현 완료**되었다(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `cc37924`, evaluator-active PASS). Moim + MoimMember 테이블, 6개 REST 라우트, assertMember/assertOwner 인가 단일 출처(@MX:ANCHOR) 구현.
> 초대/게스트 가입은 [`SPEC-MOIM-002`](../specs/SPEC-MOIM-002/spec.md)(status: `completed`, v0.2.0)에서 **구현 완료**되었다(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `acc6fe8`, evaluator Security PASS). MoimInvite 테이블, 토큰 발급/목록/폐기(owner 전용), 게스트 accept(익명 로그인 + 멱등 + 원자 usedCount), 웹 `/invite/[token]` 랜딩, `enable_anonymous_sign_ins = true` 구현.
> 네이티브 Google 로그인(bridge command 방식) + provider-agnostic 이름 온보딩은 [`SPEC-MOBILE-004`](../specs/SPEC-MOBILE-004/spec.md)(status: `completed`, v0.3.0)에서 **iOS 시뮬레이터 라이브 E2E 검증 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `a03fe75`). mobile vitest 191/191(+4 auth:google-request), backend jest 214/214(85.36% branch), tsc 0 errors, web build OK, expo export OK. Profile.name(nullable) 마이그레이션, PATCH /me, provider-agnostic 온보딩 가드(`require-named-session.ts`), mobile 네이티브 Google Sign-In 코어(google-signin-core/signin-id-token-core 순수 vitest 코어 + SDK 래퍼). **설계 변경**: OAuth URL 인터셉트 방식 실패 확인 후 `auth:google-request` additive bridge 커맨드 방식으로 전환(BRIDGE_VERSION 1 유지). `apps/mobile/plugins/withModularHeaders.js` config plugin 추가(pod install 오류 해소). `GoogleSignin.configure` 앱 부트 배선(`app/_layout.tsx`). 라이브 E2E(2026-06-17): iPhone 16 Pro 시뮬레이터 + 로컬 Supabase + 실 Google 계정 → AC-1/2/3/5 PASS, `auth.sessions` 1행(`last_sign_in_at: 2026-06-17T17:19:03`), 이름 온보딩 + "하태용" prefill 확인.
> 모임 상세 화면 + 홈 실 데이터 배선은 [`SPEC-MOIM-003`](../specs/SPEC-MOIM-003/spec.md)(status: `completed`, v0.3.0)에서 **전 AC 충족 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `74fd7fe`). mobile vitest 215/215(+24 route-map detail-push), tsc 0 errors(web/mobile/api-client), web build OK, expo export OK. 홈 탭 mock→real 배선(MOCK_MEETUPS 제거, GET /moims), 모임 상세 Server Component(`app/(main)/home/[id]/page.tsx` — GET /moims/:id + /members, (main) 가드 상속, notFound()), 웹 상세/멤버 헬퍼(`apps/web/lib/moim/api.ts`), api-client `listMoims()` + `MoimResponse`, 모바일 `detailRouteForUrl`/`decideWebViewLoad` push 변형(additive) + `onDetailPush` 콜백 + `BridgedWebView` push, 홈 탭 디렉터리화(`(tabs)/home/` Stack+index+[id], flat `home.tsx` 제거). 라이브 데이터 패스 검증(실 password-grant 토큰, 로컬 Supabase): GET /moims → 200 실 형상; /moims/:id → 200; /moims/:id/members → 200; /moims/<missing> → 404; 미인증/위조 → 401. AC-1/2/5 라이브 PASS, AC-4 PASS, AC-6 GREEN. **AC-3(모바일 인앱 카드 탭 E2E) 사용자 디바이스 검증 2026-06-18 PASS**: 홈 실 카드 탭 → 네이티브 (tabs)/home/[id] push → 웹 상세 렌더 → 네이티브 back → 목록 복귀 사용자 확인 완료. 전 6 AC 충족.
> 투표 마감(deadline + 수동 마감)은 [`SPEC-MOIM-007`](../specs/SPEC-MOIM-007/spec.md)(status: `in-progress`, v0.2.0)에서 **데스크톱·API 라이브 검증 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `8e37d33`). backend jest 290/290(마감 신규 + 열린 poll 회귀 포함), tsc 0(all), web lint/build 0, mobile vitest 215/215(회귀 0), prisma migrate clean. `Poll.closesAt DateTime? @map("closes_at")` nullable additive 추가(기존 poll row 모두 null = 마감 없음). `PollVote` 복합 PK 무변경(SPEC-MOIM-006 보존). `PollService.vote` — 마감 검사(closesAt <= now → 409 "마감된 투표입니다") 분기 앞에 삽입(단일/다중 공통 차단, 열린 poll 동작 보존). 신규 `closePoll(sub, moimId, pollId)` — 생성자 전용 인가(createdBy !== sub → 403) + closesAt=now 설정(멱등). `aggregatePolls` — closesAt + 서버 계산 isClosed(closesAt != null && closesAt <= now) 추가 매핑. 신규 `POST :pollId/close` 라우트. `CreatePollDto.closesAt?: string`, `PollResponseDto.closesAt/isClosed`. api-client `CreatePollRequest`(closesAt?) + `PollResponse`(closesAt/isClosed) + `closePoll` 헬퍼. 웹: `createPollAction` closesAt 읽기(datetime-local → toIsoOrUndefined), `closePollAction` 신규, `PollCard` isClosed 분기(배지+비활성+결과유지 / 열림=MOIM-005/006 그대로), 생성자 "마감하기" 버튼, `CreatePollForm` 마감 시각 입력, `page.tsx` currentUserId prop 전달. 라이브 검증(2026-06-20): 미래 마감 poll 생성 → 열린 poll 투표(정상) → 생성자 "마감하기" → "마감됨" 배지+비활성+결과유지+버튼사라짐 → 마감 poll 투표 409 차단 → 재-close 200(멱등) PASS. AC-1~6 PASS, AC-7/AC-8 자동 게이트 PASS. **미완료 device-gated**: 모바일 WebView 마감 poll 흐름(마감 시각 생성 → 투표 → 생성자 "마감하기" → 배지+비활성+결과 → 마감 후 409 차단 → 비생성자/마감 "마감하기" 미노출) iOS 시뮬레이터 검증 대기.
> 투표 다중 선택(multi-select)은 [`SPEC-MOIM-006`](../specs/SPEC-MOIM-006/spec.md)(status: `in-progress`, v0.2.0)에서 **데스크톱·API 라이브 검증 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `71544c4`). backend jest 269/269(+11, 단일 선택 회귀 포함), tsc 0(all), web lint/build 0, mobile vitest 215/215(회귀 0), prisma migrate clean. `Poll.multiSelect Boolean @default(false)` additive 추가(기존 poll row 모두 false). `PollVote` 복합 PK `(pollId,userId)` → `(pollId,optionId,userId)` 비파괴 변경(`add_poll_multi_select` — 기존 단일 선택 표 row 손실 0 검증). `PollService.vote` 단일(deleteMany+create 교체)/다중(findUnique 토글) 분기. 읽기 모델 `myVote: string|null` → `myVotes: string[]`(genuine break — tsc 게이트로 모든 소비처 동시 갱신 강제). api-client `PollResponse`(`multiSelect`+`myVotes[]`) + `CreatePollRequest`(`multiSelect?`). 웹: "여러 개 선택 허용" 토글, 다중=체크박스형(토글·여러 강조), 단일=MOIM-005 무변경(버튼 교체). 라이브 검증(2026-06-20): 다중 poll "가능한 날짜 모두 선택" → 토요일+월요일 토글(50%/50%, 총 2표) → 토글 off. 단일 poll 교체 회귀 0. AC-1~6 PASS, AC-7 자동 게이트 PASS. **미완료 device-gated**: 모바일 WebView poll 인터랙션(Server Action + revalidatePath) iOS 시뮬레이터 검증 대기.
> 모임 투표(poll)는 [`SPEC-MOIM-005`](../specs/SPEC-MOIM-005/spec.md)(status: `in-progress`, v0.2.0)에서 **데스크톱 라이브 검증 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `9231700`). backend jest 258/258(poll 36 케이스, branch 85.14%), tsc 0(all), web lint/build 0, mobile vitest 215/215(회귀 0), prisma migrate clean. Poll/PollOption/PollVote 신규 3 테이블 additive 추가(모im 무변경), `PollVote(pollId,userId)` 복합 PK 단일 투표 불변식. `PollController(@Controller('moims/:id/polls'))` + `PollService`(MoimService.assertMember 재사용). POST 생성(멤버 전용, question+옵션≥2, 빈 question/옵션<2→400, 비멤버→403), POST `:pollId/vote`(단일 투표 upsert, 재투표=optionId 교체, 잘못된 optionId→400), GET(voteCount+myVote+비멤버→403). api-client `CreatePollRequest`/`VoteRequest`/`PollResponse` 타입 별칭. 웹: `lib/moim/polls.ts` 구체-경로 헬퍼, `poll-actions.ts` Server Action(`createPollAction`/`voteAction` + `revalidatePath`), `polls-section.tsx` Client 하위 컴포넌트(득표 막대+내 표 강조+생성 폼+빈 상태, Meetup 오렌지 토큰), `page.tsx` Server Component 유지. 라이브 검증(2026-06-19): 빈 상태 → 생성 → 투표 → 재투표(총 1표 불변, 표 교체) 데스크톱 PASS. AC-1~5 PASS. **미완료 device-gated**: 모바일 WebView 셸에서 Server Action(`revalidatePath`)이 결과를 갱신하는지 iOS 시뮬레이터 검증 대기. 소소한 UX 메모: 생성 폼 자동 닫힘 미구현(코스메틱, 별도 후속). **이벤트 트라이어드(일정·장소·투표) 완성 — 제품 태그라인 충족**.
> 모임 생성 UI 기능화 + 이벤트 일정/장소 필드는 [`SPEC-MOIM-004`](../specs/SPEC-MOIM-004/spec.md)(status: `in-progress`, v0.2.0)에서 **데스크톱 라이브 검증 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `3145ad1`). backend jest 222/222, tsc 0(backend/web/api-client/mobile), web lint/build 0, mobile vitest 215/215(회귀 0), prisma migrate clean. `Moim.startsAt DateTime?` + `location String?` additive nullable 마이그레이션(`20260619000000_add_moim_event_fields`), `CreateMoimDto`/`MoimResponseDto` 두 필드, `POST /moims` optional 영속 + startsAt 무효 400, `GET /moims`·`GET /moims/:id` 응답 두 필드 포함. api-client `createMoim()` + `CreateMoimRequest`. 웹: `app/moims/new/`(page.tsx Server Component + `createMoimAction` Server Action + `useActionState` 폼 — 이름/닉네임/일정/장소) → redirect `/home/{id}`. 홈 CTA → `/moims/new` Link. 카드·상세 일정/장소 정직 표시(Meetup 오렌지 토큰). AC-1~5 라이브 PASS(2026-06-19). **미완료 device-gated**: 모바일 WebView 셸 server-action redirect → `/home/{id}` 시 SPEC-MOIM-003 `detailRouteForUrl` push 트리거 iOS 시뮬레이터 검증 대기. 투표(poll)는 별도 후속 SPEC.
> moims 서브트리 이름-온보딩 가드는 [`SPEC-WEB-GUARD-001`](../specs/SPEC-WEB-GUARD-001/spec.md)(status: `completed`, v0.2.0)에서 **구현 완료**되었다(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `aef205e`). `apps/web/app/moims/layout.tsx`(서버 컴포넌트) 단일 파일 추가로 moims 서브트리에 `requireNamedSession()` 가드 적용. SPEC-MOBILE-004 cross-SPEC 후속(chat 페이지 이름 가드 미적용 MEDIUM) 해소. nx run web:build/lint PASS.
> FCM 백그라운드 푸시는 [`SPEC-CHAT-002`](../specs/SPEC-CHAT-002/spec.md)(status: `in-progress`, v0.2.0)에서 **자동 게이트 통과**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `48a3110`, evaluator Security PASS). DeviceToken 모델 + 마이그레이션, 등록/해제 REST API(owner-scoped IDOR 차단), PushListener(@OnEvent 단방향, sender/게스트 제외, 서버 측 nickname), FcmSender(firebase-admin graceful), mobile expo-notifications 헬퍼/배선, 느슨한 결합(chat↛push) 검증. backend jest 206/206, mobile vitest 151/151, TRUST 5 PASS. AC-5(실기기 FCM 수신·탭)는 device-gated → in-progress 유지. 신규 의존성: `firebase-admin@^13.10.0`(backend), `expo-notifications@~56.0.17`(mobile).
> 모임 채팅 코어는 [`SPEC-CHAT-001`](../specs/SPEC-CHAT-001/spec.md)(status: `completed`, v0.3.1)에서 **라이브 브라우저 검증 완료**(브랜치 `feature/SPEC-MOBILE-004`, 커밋 `5e35248`, evaluator PASS). ChatMessage 모델 + 트리거/RLS 마이그레이션, sendMessage/getHistory, chat.message.created 이벤트 계약, 웹 채팅 UI 구현. 2026-06-15 라이브 E2E로 AC-1c/AC-4 PASS → completed 전환. 2026-06-18 라이브 브라우저 검증에서 CSP `ws://` 누락 + api-client detached fetch 두 가지 잠재 결함 발견 및 수정(b86a80c/5e35248): AC-5 이제 실증 PASS(이전 "추론 PASS"의 정직한 수정). 채팅 UI 리디자인(orange 토큰, own/other 말풍선, sticky 헤더/입력 — 0aba5f3). CSP connect-src: 호스트-핀 ws/wss + 백엔드 API origin 추가. api-client 기본 fetch `globalThis.fetch.bind(globalThis)` 바인딩(브라우저 크로스 컷팅 수정). 신규 의존성: `@nestjs/event-emitter@^3.1.0`. Supabase Realtime broadcast_changes + trigger/RLS 인프라 도입.

## 구현됨 vs 계획됨 (요약)

| 구분 | 내용 |
|------|------|
| **IMPLEMENTED (골격)** | 모노레포 골격(pnpm + Nx), 3개 앱 스캐폴드(mobile/web/backend), `@moyura/config` 스텁, 루트/앱별 Nx 타겟, hoisted node_modules |
| **IMPLEMENTED (SPEC-MOIM-007, in-progress — 데스크톱·API 라이브 검증 2026-06-20 PASS / 모바일 WebView poll 마감 인터랙션 device-gated 검증 대기)** | 투표 마감(deadline + 수동 마감): `Poll.closesAt DateTime? @map("closes_at")` nullable additive 추가(기존 poll row 모두 null = 마감 없음, PollVote PK 무변경). 마이그레이션 `20260620200000_add_poll_closes_at`(비파괴 — `ALTER TABLE poll ADD COLUMN closes_at TIMESTAMP(3);`, row 손실 0). `PollService.vote` — 마감 검사(409 "마감된 투표입니다") 삽입(단일/다중 공통, 열린 poll 동작 보존). 신규 `closePoll` — 생성자 전용(createdBy !== sub → 403) + closesAt=now(멱등). 서버 계산 isClosed(closesAt <= now). `CreatePollDto.closesAt?`/`PollResponseDto.closesAt+isClosed`. 신규 `POST :pollId/close` 라우트. api-client `CreatePollRequest`(closesAt?) + `PollResponse`(closesAt/isClosed) + `closePoll` 헬퍼. 웹: 마감 분기(isClosed: "마감됨" 배지+비활성+결과유지 / 열림: MOIM-005/006 그대로), 생성자 "마감하기" 버튼(closePollAction), 생성 폼 마감 시각(datetime-local), page currentUserId prop. jest 290/290, tsc 0(all), web lint/build 0, mobile vitest 215/215(회귀 0). 라이브 검증(2026-06-20): 미래 마감 poll 생성 → 열린 poll 투표 → 생성자 "마감하기" → 배지+비활성+결과유지 → 마감 poll 투표 409 → 재-close 200(멱등) PASS. device-gated: 모바일 WebView 마감 poll 흐름 iOS 시뮬레이터 검증 대기. |
| **IMPLEMENTED (SPEC-MOIM-006, in-progress — 데스크톱·API 라이브 검증 2026-06-20 PASS / 모바일 WebView poll 인터랙션 device-gated 검증 대기)** | 투표 다중 선택(multi-select): `Poll.multiSelect Boolean @default(false)` additive 추가(기존 poll row 모두 false). `PollVote` 복합 PK `(pollId,userId)` → `(pollId,optionId,userId)` 비파괴 변경(`add_poll_multi_select` — 기존 단일 선택 표 row 손실 0). `PollService.vote` 단일(deleteMany+create 교체)/다중(findUnique 토글) 분기. 읽기 모델 `myVote:string|null` → `myVotes:string[]`(genuine break, tsc 게이트). `CreatePollDto.multiSelect?`, `PollResponseDto.multiSelect`+`myVotes[]`. api-client `PollResponse`(multiSelect+myVotes[]) + `CreatePollRequest`(multiSelect?). 웹: "여러 개 선택 허용" 토글 추가, 다중=체크박스형(토글·여러 강조), 단일=MOIM-005 무변경(버튼 교체). lib/moim/polls.ts `PollWithResults`(myVotes[]). jest 269/269(+11, 단일 선택 회귀 포함), tsc 0(all), web lint/build 0, mobile vitest 215/215(회귀 0). 라이브 검증(2026-06-20): 다중 poll 토요일+월요일 동시 강조(50%/50%, 총 2표), 토글 off 동작, 단일 poll 교체 회귀 0. AC-1~6 PASS, AC-7 자동 게이트 PASS. device-gated: 모바일 WebView poll 인터랙션(Server Action+revalidatePath) iOS 시뮬레이터 검증 대기. |
| **IMPLEMENTED (SPEC-MOIM-005, in-progress — 데스크톱 라이브 검증 2026-06-19 PASS / 모바일 WebView Server Action device-gated 검증 대기)** | 모임 투표(poll): Poll/PollOption/PollVote 신규 3 테이블 additive 추가(`add_poll` 마이그레이션, moim 무변경). `PollVote(pollId,userId)` 복합 PK = 단일 투표 불변식. `apps/backend/src/poll/`(PollController/PollService/DTO/PollModule). POST 생성(멤버 전용, question+옵션≥2, 빈 question/옵션<2→400, 비멤버→403) + POST `:pollId/vote`(단일 투표 upsert, 재투표=교체, 잘못된 optionId→400) + GET(voteCount+myVote+비멤버→403). api-client `CreatePollRequest`/`VoteRequest`/`PollResponse`. 웹: `lib/moim/polls.ts`, `poll-actions.ts`(Server Action+revalidatePath), `polls-section.tsx`(Client, 득표 막대+내 표 강조+생성 폼+빈 상태, Meetup 오렌지). jest 258/258(poll 36), branch 85.14%, tsc 0, web lint/build 0, vitest 215/215(회귀 0). 라이브 검증(2026-06-19): 빈 상태→생성→투표→재투표(총 1표 불변) 데스크톱 PASS. device-gated: 모바일 WebView 셸 Server Action+revalidatePath iOS 시뮬레이터 검증 대기. **이벤트 트라이어드(일정·장소·투표) 문서화 완성**. |
| **IMPLEMENTED (SPEC-MOIM-004, in-progress — 데스크톱 라이브 검증 2026-06-19 PASS / 모바일 server-action redirect push device-gated 검증 대기)** | 모임 생성 UI 기능화 + 이벤트 일정/장소 필드: `Moim.startsAt DateTime?` + `location String?` additive nullable 마이그레이션(`20260619000000_add_moim_event_fields`, 기존 row null), `CreateMoimDto` optional startsAt/location, `MoimResponseDto` 두 필드 직렬화, `POST /moims` optional 영속 + startsAt 무효 400 + name/nickname 누락 400 보존, `GET /moims`·`GET /moims/:id` 두 필드 포함. api-client `createMoim()` + `CreateMoimRequest`. 웹: `app/moims/new/`(Server Component + `createMoimAction` Server Action + `useActionState` 폼 — 이름/닉네임/일정 datetime-local/장소) → redirect `/home/{id}`. 홈 CTA → `/moims/new` Link(비기능 대체). `HomeTab` 카드 + `/home/[id]` 상세 일정/장소 정직 표시(null → "일정 미정"/생략, 허위 값 없음, Meetup 오렌지 토큰). backend jest 222/222, tsc 0, web lint/build 0, mobile vitest 215/215(회귀 0). AC-1~5 라이브 PASS. device-gated: 모바일 server-action redirect → `/home/{id}` 시 SPEC-MOIM-003 `detailRouteForUrl` push 트리거 iOS 시뮬레이터 검증 대기. 투표 → 별도 후속 SPEC. |
| **IMPLEMENTED (SPEC-MOIM-003, completed — 전 AC 충족 / AC-3 사용자 디바이스 검증 2026-06-18 PASS)** | 모임 상세 화면 + 홈 실 데이터 배선: 홈 탭 mock→real(`MOCK_MEETUPS` 제거, `GET /moims`), 카드 `/home/{id}` 링크, 신규 `apps/web/app/(main)/home/[id]/page.tsx`(Server Component, GET /moims/:id+/members, (main) 가드 상속, 403/404→notFound()), `apps/web/lib/moim/api.ts`(getMoim/getMoimMembers), api-client `listMoims()`+`MoimResponse`, mobile `detailRouteForUrl`/`decideWebViewLoad` push 변형(additive) + `onDetailPush` + `BridgedWebView` push, 홈 탭 디렉터리화(`(tabs)/home/` Stack+index+[id], flat `home.tsx` 제거). vitest 215/215(+24), tsc 0, web build OK, expo export OK. AC-1/2/4/5/6 PASS. AC-3 홈 실 카드 탭 → 네이티브 (tabs)/home/[id] push → 웹 상세 렌더 → 네이티브 back → 목록 복귀 사용자 디바이스 검증 2026-06-18 PASS. |
| **IMPLEMENTED (SPEC-WEB-GUARD-001, completed)** | moims 서브트리 이름-온보딩 가드: `apps/web/app/moims/layout.tsx` 서버 컴포넌트 추가 — `requireNamedSession()` await → children. 미인증 → /login, 이름 없음 → /onboarding. SPEC-MOBILE-004 cross-SPEC 후속 해소. nx run web:build/lint PASS, GET /moims/*/chat 세션 없음 → 307→/login 실 HTTP 확인. |
| **IMPLEMENTED (SPEC-MOBILE-004, completed — iOS 시뮬레이터 라이브 E2E 2026-06-17 PASS)** | 네이티브 Google Sign-In(bridge command 방식) + provider-agnostic 이름 온보딩: Profile.name(String? nullable) + 마이그레이션 `20260615000000_add_profile_name`, PATCH /me(UpdateNameDto, requireNonEmpty 400, sub-scoped mass-assignment 차단), ProfileResponseDto.name, signUpAction 이름 배선, web onboarding/ 라우트((main) 외부, 루프 안전), require-named-session.ts 공유 서버 가드((main)/layout.tsx + me/page.tsx), mobile google-signin-core/signin-id-token-core 순수 vitest 코어 + google-signin.ts/supabase-mobile.ts SDK 래퍼, useAuthBridge.ts 네이티브 경로(@MX:ANCHOR 보존). **설계 변경(v0.3.0)**: OAuth 네비게이션 인터셉트 → `auth:google-request` additive bridge 커맨드(bridge-protocol 양쪽, BRIDGE_VERSION 1 유지). `apps/mobile/plugins/withModularHeaders.js` config plugin(use_modular_headers! 주입). `GoogleSignin.configure` 앱 부트 배선(`app/_layout.tsx`, 실 OAuth 클라이언트 ID). `requestNativeGoogleSignIn()` 함수(web — 셸 내 postMessage, 데스크톱 false). 신규 의존성: @react-native-google-signin/google-signin@16.1.2 + @supabase/supabase-js@2.106.2(mobile). 라이브 E2E: auth.sessions 1행(last_sign_in_at: 2026-06-17T17:19:03), AC-1/2/3/5 PASS. |
| **IMPLEMENTED (SPEC-MOBILE-003, in-progress — iOS 핵심 플로우 검증 완료)** | expo-router(~56.2.10) 네이티브 네비게이션 골격(Root Stack + `(auth)`/`(tabs)` 그룹 + 네이티브 Tabs), 라우트별 WebView 래퍼, 웹 `(main)` 탭 라우트 그룹(BottomTabBar + HomeTab + 플레이스홀더), 네이티브 AuthContext(SecureStore + bridge 신호), route-map-core / auth-state-core 순수 결정 모듈, 셸 모드 탭바 숨김(ShellModeEffect + ShellSessionAnnouncer), redirect /me→/home. Google OAuth·Android·로그아웃 E2E 검증 대기 — status in-progress |
| **IMPLEMENTED (SPEC-CHAT-002, in-progress — 자동 게이트 통과 / 실기기 FCM 수신·탭 device-gated 검증 대기)** | FCM 백그라운드 푸시: DeviceToken 모델(token PK, userId, platform, createdAt, updatedAt, @@index userId) + 마이그레이션 `20260614_add_device_token`, 등록/해제 REST API(owner-scoped IDOR 차단: unregisterByOwner), PushListener(@OnEvent 단방향, sender 제외, 게스트 자연 제외, 서버 측 nickname 조회), FcmSender(firebase-admin@^13.10.0, graceful no-op), 느슨한 결합(chat↛push, loose-coupling.spec), mobile expo-notifications@~56.0.17(register-device-core/notification-core 순수 로직 + 얇은 래퍼 + AuthContext 등록 배선 + useAuthBridge 로그아웃 해제). backend jest 206, mobile vitest 151, TRUST 5 PASS, evaluator Security PASS. FIREBASE_CREDENTIALS optional+graceful. |
| **IMPLEMENTED (SPEC-CHAT-001, completed — 라이브 브라우저 검증 2026-06-18 PASS / v0.3.1)** | 모임 채팅 코어: ChatMessage 모델(BigInt PK, moimId FK→moim Cascade, @@index(moimId,id desc)) + 마이그레이션 `20260613175232_add_chat`(content CHECK 1..2000, RLS default-deny, broadcast_chat_message() SECURITY DEFINER, chat_message_broadcast 트리거, realtime.messages SELECT 정책). sendMessage(assertMember + insert + best-effort emit) / getHistory(keyset 내림차순). chat.message.created 이벤트 계약(@MX:ANCHOR, chat-events.ts). 웹 채팅 UI(useChatChannel + /moims/[id]/chat/page.tsx, nickname 클라이언트 해석; Meetup 디자인 시스템 리디자인 v0.3.1). CSP connect-src: 호스트-핀 wss/ws(Supabase realtime) + 백엔드 API origin 추가(v0.3.1 수정). api-client 기본 fetch `globalThis.fetch.bind(globalThis)` 바인딩(v0.3.1 브라우저 크로스 컷팅 수정). jest 170/170(chat 22), chat 100% stmt/85.71% branch, evaluator PASS(Func 90/Sec 82/Craft 85/Consistency 90). AC-1c(멤버 broadcast 수신) / AC-4(비멤버 RLS 거부) PASS(2026-06-15 라이브 E2E). AC-5(CSP 위반 없는 realtime + 클라이언트 fetch) 이전 "추론 PASS"에서 2026-06-18 라이브 브라우저 실증 PASS로 정직한 수정. 신규 의존성: `@nestjs/event-emitter@^3.1.0`. |
| **IMPLEMENTED (SPEC-MOIM-002, completed)** | 초대/게스트 가입: MoimInvite 모델(token PK, CSPRNG ≥128-bit, expiresAt 상한 30일, maxUses?, usedCount, revokedAt?) + 마이그레이션 `20260613171209_add_moim_invite`, 토큰 발급/목록/폐기(owner 전용, assertOwner 재사용), 게스트 accept(멱등 P2002 처리, 원자 usedCount), 웹 `/invite/[token]` 랜딩(익명 로그인 → nickname → accept), `enable_anonymous_sign_ins = true`(`anonymous_users = 30` rate limit). jest 148/148, invite 100% stmt / 85.29% branch, evaluator Security PASS. 새 의존성 없음(Node.js `crypto` 내장). |
| **IMPLEMENTED (SPEC-MOIM-001, completed)** | 모임 도메인 첫 기능 모듈: Moim + MoimMember 모델(nickname, role, joined_at, 복합 PK, onDelete Cascade) + 마이그레이션 `20260613155202_add_moim`, 6개 REST 라우트(POST/GET 목록·단건·멤버/DELETE 모임·멤버십), assertMember/assertOwner 인가 단일 출처(@MX:ANCHOR), createMoim 원자 트랜잭션. jest 105/105, coverage 96.79%, evaluator-active PASS. 새 의존성 없음(@nestjs/common ^11, @prisma/client 7.8.0 재사용). |
| **IMPLEMENTED (SPEC-ENV-SETUP-001, completed)** | Supabase PostgreSQL 연결(Prisma 7 + `@prisma/adapter-pg` 듀얼 URL), Zod 4 환경검증(fail-fast), NestJS `@nestjs/swagger` OpenAPI → `packages/api-client`(`@moyura/api-client`) 타입드 클라이언트 생성, Supabase CLI 로컬 스택(direct `:54322`), CORS allowlist, `GET /health` 엔드포인트, CI/EAS 스켈레톤, 프런트 env 가드(web/mobile) |
| **IMPLEMENTED (SPEC-AUTH-001, completed)** | Supabase Auth **실제 인증**(authn-only): 백엔드 ES256 JWKS 검증 가드(jose), 첫 도메인 모델 `Profile` + UPSERT, 보호 라우트 `GET /me`, 웹 `@supabase/ssr` 쿠키 세션 + email/pw + PKCE 콜백, 소셜/모바일 OAuth 스캐폴드, `@moyura/api-client` Bearer 토큰 주입. evaluator-active PASS(security 0.97) |
| **PLANNED (follow-up, 미구현)** | prod 배포 파이프라인(자동 Prisma migrate + deploy, Render/Supabase 실 배포 및 prod e2e 증명), 인증 후속 과제(실제 소셜 provider 키, 모바일 런타임 OAuth 라운드트립, 이메일 확인/비밀번호 재설정, RBAC/인가, 프런트 자동 테스트 타겟, prod HTTPS 강제) |

---

## 1. 언어 / 런타임 (IMPLEMENTED)

- **TypeScript**:
  - `apps/mobile`: TypeScript `~6.0.3` (**TS 6** 라인) — web/backend와 메이저 라인이 다름. 타입 검사/생성 클라이언트 호환성은 TS 6 기준으로 확인 필요.
  - `apps/web`: TypeScript `^5`
  - `apps/backend`: TypeScript `^5.7.3`
- **루트 공유 컴파일러 옵션** (`tsconfig.base.json`): `target ES2022`, `module ESNext`, `moduleResolution Bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `declaration`, `sourceMap`.
- **Node**: 개발 환경 Node v25.x. backend `engines`는 `node >=20.0.0`, `npm >=10.0.0` 요구.
- **패키지 매니저**: pnpm `10.27.0` (`packageManager` 필드로 고정).

## 2. 프레임워크 (IMPLEMENTED — 스캐폴드)

| 앱 | 프레임워크 | 핵심 버전 | 특이사항(검증됨) |
|----|------------|-----------|------------------|
| mobile | Expo (React Native) | expo `~56.0.6`, react `19.2.3`, react-native `0.85.3`, `react-native-webview 13.16.1`(Expo56 핀), `expo-secure-store ~56.0.4`, `expo-splash-screen ~56.0.10`, `expo-router ~56.2.10`(SPEC-MOBILE-003), `react-native-safe-area-context`, `react-native-screens`, `expo-constants`, `expo-notifications@~56.0.17`(SPEC-CHAT-002), `@react-native-google-signin/google-signin@16.1.2`(SPEC-MOBILE-004), `@supabase/supabase-js@2.106.2`(SPEC-MOBILE-004) | `app.json` slug `app`, scheme `moyura`. expo-router 파일 기반 라우팅(`app/` 트리) — Root Stack + `(auth)`/`(tabs)` 그룹 + 네이티브 Tabs. `App.tsx` 제거(SPEC-MOBILE-003). `expo-secure-store` 기반 토큰 캐시 + nonce 인증 postMessage 브리지(SPEC-WEBVIEW-SHELL-001 + SPEC-MOBILE-002). FCM 푸시 토큰 등록/수신/탭 헬퍼(SPEC-CHAT-002). 네이티브 Google Sign-In(bridge command `auth:google-request` 방식) + provider-agnostic 온보딩(SPEC-MOBILE-004 completed). `plugins/withModularHeaders.js` config plugin(use_modular_headers! — SPEC-MOBILE-004 v0.3.0). @react-native-cookies jcenter()→mavenCentral() pnpm patch(Android Gradle 9 호환) |
| web | Next.js | `16.2.6`, react/react-dom `19.2.4` | App Router(`app/`), Tailwind v4(`@tailwindcss/postcss`), `reactCompiler: true`, `turbopack.root`를 모노레포 루트로 고정(stray lockfile 워크스페이스 오탐 방지) |
| backend | NestJS | `@nestjs/common ^11`, `@nestjs/core ^11`, platform-express `^11` | 현재 기본 `app.controller`/`app.service`만 존재. `main.ts` 포트 `3000` 하드코딩(SPEC에서 config화 예정) |

> Expo 56 / Next 16은 bleeding-edge이므로 버전 특이 동작은 추측하지 않는다. `apps/mobile/AGENTS.md`, `apps/web/AGENTS.md`가 "학습 데이터와 다를 수 있으니 버전별 공식 문서를 먼저 읽으라"고 명시한다.

## 3. 빌드 / 패키지 도구 (IMPLEMENTED)

- **Nx `21.6.7`** — 빌드 오케스트레이션/캐시.
  - 모든 프로젝트 타겟이 `nx:run-commands`로 각 앱의 **네이티브 CLI**(`next`, `expo`, `nest build`, `eslint`, `jest`, `tsc`)를 래핑한다.
  - **@nx 공식 플러그인(`@nx/next`, `@nx/expo`, `@nx/nest` 등)은 채택하지 않음** — run-commands 래핑 방식. (캐시 입력/출력 미스로 인한 stale 산출물 리스크는 SPEC K2에서 명시.)
  - 캐시 정책은 `nx.json` `targetDefaults` + 프로젝트별 `outputs`로 관리(상세: [structure.md](./structure.md)).
- **pnpm workspaces** — `apps/*`, `packages/*`. `node-linker=hoisted`(Metro 호환).
  - `onlyBuiltDependencies`: `@nestjs/core`, `@swc/core`, `nx`, `msgpackr-extract` (설치 시 빌드 스크립트 허용).
  - `ignoredBuiltDependencies`: `sharp`, `unrs-resolver`.

## 4. 데이터 / 백엔드 스택 (IMPLEMENTED — SPEC-ENV-SETUP-001, completed v0.3.0)

아래 항목은 **구현 완료**되어 `master`에 존재한다(품질 게이트 green). 버전은 실제 설치된 의존성 기준.

- **DB (prod)**: Supabase 관리형 **PostgreSQL** (PG `17.x` stable — 마이너는 Supabase 고정). SPEC 결정 #2.
- **ORM**: **Prisma `7.8.0`** — D1 스파이크 통과로 Prisma 7 확정 (선택지 A). 듀얼 URL 패턴 (R-B3~R-B5):
  - `prisma-client` 제너레이터, `moduleFormat = "cjs"`(NestJS CommonJS), 클라이언트를 `apps/backend/src/generated/prisma`로 **source-emit**(gitignore — `prisma generate`로 재생성). hoisted 레이아웃에서 심링크 의존 없음(R-A3 충족).
  - Prisma 7는 **driver adapter 필수** → `@prisma/adapter-pg 7.8.0` + `pg 8.21.0` 사용.
  - 연결 URL은 schema가 아닌 **`apps/backend/prisma.config.ts`**에 위치 (Prisma 7가 schema `datasource`에서 `url`/`directUrl` 제거).
  - `DATABASE_URL` = 런타임 pooled (prod: 포트 `6543`, Supavisor transaction-mode, `?pgbouncer=true`, prepared statements 비활성) → pg adapter 경유 Client.
  - `DIRECT_URL` = direct (포트 `5432`) → 마이그레이션 CLI(`prisma migrate`, 양 환경 공통).
- **config 검증**: `@nestjs/config 4.0.4` + **Zod `4.4.3`** 부팅 시 검증, 누락/불일치 시 fail-fast(non-zero exit). R-B1/R-B2. `FIREBASE_CREDENTIALS`(SPEC-CHAT-002, optional — 부재 시 FcmSender graceful no-op, 부팅 비차단).
- **API 계약**: `@nestjs/swagger 11.4.4`로 OpenAPI를 `/api`에 노출 → `apps/backend/openapi.ts` emit 스크립트가 `apps/backend/openapi.json` 생성(서버 미기동) → `packages/api-client`에 타입드 클라이언트 생성.
  - **생성 도구(D2 확정)**: `openapi-typescript 7.13.0` 타입 생성(`src/schema.d.ts`, gitignore — 재생성) + 얇은 타입드 fetch 래퍼(`createApiClient`, `getHealth`). openapi.json 계약 산출물은 커밋된다.
- **로컬 DB**: **Supabase CLI `2.104.0` 로컬 스택**(Docker: Postgres + Auth/GoTrue + Studio), `supabase/config.toml` + `supabase/README.md`(start/stop). canonical 로컬 DB. R-C1~R-C4.
  - 로컬 스택은 `6543` pooler를 노출하지 않음 → 로컬은 **direct Postgres `:54322`** 운영(pooler는 prod 전용). 이 경우 prepared-statement 비활성은 N/A(R-C2, K8). prod에서만 pooled(6543) 적용.
- **백엔드 prod 호스팅**: **Render** (Web Service). build `pnpm nx build backend`, start `node dist/src/main.js`, health check path `/health`, env는 Render secrets 주입. 가이드: `docs/deploy-render.md`. SPEC 결정 #4.
- **CORS**: 환경별 web + mobile origin allowlist를 `CORS_ORIGINS`(validated config)에서 로드, 와일드카드(`*`) 금지. R-F1~R-F3.
- **헬스 엔드포인트**: `GET /health` — `PrismaService.pingDatabase()`(`SELECT 1`)로 DB 연결 확인. 200(`ok`/`up`) / 503(`degraded`/`down`). end-to-end 배선 증명용(로컬 e2e 검증 완료). R-G1~R-G4.
- **프런트 env 주입**: web `NEXT_PUBLIC_API_BASE_URL`(`apps/web/lib/env.ts` 가드, 루트 레이아웃에서 실행), mobile `EXPO_PUBLIC_API_BASE_URL`(`apps/mobile/lib/env.ts` 가드, `index.ts`에서 실행). 미설정 시 명시적 throw(R-E4 — `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`는 build/bundle 시점 정적 인라인). web은 api-client를 `transpilePackages`로 처리.
- **Auth**: **실제 인증 구현 완료**(SPEC-AUTH-001 completed, authn-only). 환경/인프라 SPEC이 남긴 no-op seam을 실제 인증으로 대체/확장.
  - **백엔드 JWT 검증**: `SupabaseAuthGuard`가 **jose `^6.2.3`** `createRemoteJWKSet` + `jwtVerify`로 ES256 JWKS 검증(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, `kid` 선택, algorithms 화이트리스트 고정, `alg:none`/alg-confusion은 서명 검증 전 거부, `iss`/`aud`/`exp`/`nbf` normative, JWKS 실패 시 fail-closed 무다운그레이드). HS256-only 토큰 전용 레거시 폴백(`SUPABASE_JWT_SECRET`). 가드는 보호 라우트(`/me`)에 **per-route `@UseGuards`**(global 아님) — `/health`·`GET /`는 public 유지.
  - **profile 모델**: 첫 Prisma 도메인 모델 `Profile`(`id = sub` PK, `createdAt`), 마이그레이션 `20260602095934_init_profile`(`DIRECT_URL`). `ProfileService.upsertBySub`는 가드가 부착한 검증된 `sub`만 사용(mass-assignment 차단).
  - **웹 세션**: **`@supabase/ssr` `0.10.3`** + `@supabase/supabase-js` `2.106.2`. browser/server 클라이언트(`lib/supabase/`), `proxy.ts` updateSession(Next 16 미들웨어 컨벤션), PKCE 콜백 라우트(`app/auth/callback/route.ts`, 음성 경로 가드), email/pw signup/login/logout(`lib/auth/actions.ts`). `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - **api-client Bearer**: `@moyura/api-client`에 optional `getToken`→`Authorization: Bearer` 주입(토큰은 URL/query 금지) + `getMe()` 편의 메서드.
  - **소셜/모바일 스캐폴드**: `supabase/config.toml` `[auth.external.google|kakao|apple]`(`enabled = false`, `env()` 시크릿). `apps/mobile` app scheme `"moyura"` + 시스템 브라우저 OAuth 헬퍼(`lib/auth/oauth.ts`), `EXPO_PUBLIC_SUPABASE_*`. 네이티브 토큰 저장소 미도입(webview가 웹 세션 공유 — OD-4).
  - 검증: 백엔드 보안 테스트 53건(14개 적대적 공격 토큰 차단), statement 커버리지 95.71%, 웹 세션→`GET /me`→200 profile LIVE e2e, evaluator-active PASS(Functionality 0.95 / Security 0.97 / Craft 0.78 / Consistency 0.93). R-A1~R-J3.
- **FCM 푸시 인프라**(SPEC-CHAT-002): `firebase-admin@^13.10.0`(backend, Node 20+ 호환) + `expo-notifications@~56.0.17`(mobile, SDK 56). `FIREBASE_CREDENTIALS` env(optional Zod, 단일 행 JSON 직렬화 서비스 계정 키, gitignored) — `apps/backend/src/config/env.validation.ts`에 선언. `FcmSender`는 `JSON.parse(FIREBASE_CREDENTIALS)` → `admin.credential.cert()` 경로로 초기화. 부재 시 graceful no-op(개발/CI 환경에서 부팅·테스트 차단 없음). **라이브 검증(2026-06-18)**: 서비스 계정(`project_id=moyura-498500`) 배선 후 firebase-admin 초기화 + Google 인증 통과 + FCM 도달가능성 확인(FCM API 비활성화로 per-token `messaging/mismatched-credential` 반환 — 자격증명 자체는 유효). 잔여 게이트: `fcm.googleapis.com` 활성화(Google Cloud Console), 모바일 클라이언트 config `moyura-498500` 프로젝트 일치, 실기기 dev build 검증(device-gated).
- **CI / EAS**: `.github/workflows/ci.yml`(install → prisma generate → `nx affected` build/lint/test/typecheck; **migrate/deploy 없음**) + `apps/mobile/eas.json` `local`/`prod` 프로파일 **스켈레톤**. R-I1~R-I3.

### follow-up (PLANNED — 의도적으로 연기)

- **prod 배포 파이프라인**(SPEC-ENV-SETUP-001 연기): 자동 Prisma migrate + deploy, Render/Supabase 실 배포, prod e2e 증명(R-G4 prod — 현재는 Render health check path가 `/health`임만 확인). named follow-up.
- **인증 후속 과제**(SPEC-AUTH-001 연기): 실제 소셜 provider 키 발급/배선(Google/Apple/Kakao 콘솔), 모바일 런타임 OAuth 라운드트립(디바이스/시뮬레이터 — 현재 코드+config 스캐폴드만), 이메일 확인 + 비밀번호 재설정, RBAC/인가, prod HTTPS 강제. 모두 named follow-up(Non-Goal로 spec.md에 명시).
- **프런트 자동 테스트 타겟**(SPEC-AUTH-001 evaluator MAJOR): web/mobile/api-client에 자동화 테스트 타겟 부재. 테스트 가능한 순수 함수(`resolveCallbackOutcome`/`resolveSupabaseConfig`/api-client Bearer 주입/`launchSocialOAuth`)가 회귀 보호되지 않음(빌드 시점 node sanity로만 검증). 별도 후속 작업으로 도입.

## 5. 품질 / 테스트

### 프로젝트 기본 정책 (`.moai/config/sections/quality.yaml`)

- **개발 방법론**: TDD (`development_mode: tdd`, RED-GREEN-REFACTOR).
- **커버리지 목표**: `test_coverage_target: 85` (%), 커밋당 최소 `min_coverage_per_commit: 80`.
- **TRUST 5 enforce**: `enforce_quality: true`. LSP quality gates `enabled: true`.
- **세션 effort 기본값**: `xhigh` (Opus 4.7+).

### 인프라 SPEC의 실용적 하이브리드 (주의)

- 위 85% 목표는 **도메인 기능 코드** 기준이다. 인프라 배선 SPEC([`SPEC-ENV-SETUP-001`](../specs/SPEC-ENV-SETUP-001/spec.md))은 환경/배선 검증 성격상 **실용적 하이브리드(pragmatic hybrid)** 접근을 취하며, end-to-end 증명은 `/health` 엔드포인트(실제 요청) 같은 통합 검증으로 한다 — 단위 커버리지 85%를 기계적으로 강제하지 않는다.

### 현재 앱별 테스트 도구 (IMPLEMENTED 스캐폴드)

- `apps/backend`: **Jest**(`jest`, `ts-jest`), e2e(`supertest`, `jest-e2e.json`), 커버리지 타겟 설정 존재. lint = ESLint 9 flat config + Prettier.
- `apps/web`: ESLint 9(`eslint-config-next`), `babel-plugin-react-compiler`.
- `apps/mobile`: **vitest**(node-env, SPEC-MOBILE-001 도입) — 순수 함수 단위 테스트(`resolveWebUrl`, oauth-bridge 헬퍼)만 대상(RN/expo import 없는 모듈). nx `test` 타겟. typecheck = `tsc --noEmit`. 린터 미구성(품질 게이트는 strict tsc).

> 참고: 사용자 글로벌 선호(vitest/oxlint 등)는 다른 프로젝트 기준이나, mobile은 SPEC-MOBILE-001에서 순수 로직 회귀 보호를 위해 vitest를 도입했다(web/backend 도구 구성은 불변).

## 6. 주요 설정 파일 위치

| 파일 | 역할 |
|------|------|
| `package.json` (루트) | private, `nx run-many` 스크립트, `packageManager: pnpm@10.27.0`, devDep `nx 21.6.7` |
| `nx.json` | `targetDefaults`(build/lint/test/typecheck 캐시), `namedInputs`, `sharedGlobals` |
| `pnpm-workspace.yaml` | 워크스페이스 글롭 + `onlyBuiltDependencies`/`ignoredBuiltDependencies` |
| `.npmrc` | `node-linker=hoisted` |
| `tsconfig.base.json` | 루트 공유 TS 컴파일러 옵션 |
| `apps/web/next.config.ts` | `reactCompiler`, `turbopack.root` 고정 |
| `apps/web/project.json` 등 | 프로젝트별 Nx 타겟 |
| `apps/backend/nest-cli.json`, `.prettierrc`, `eslint.config.mjs` | backend 빌드/포맷/린트 |
| `apps/mobile/app.json` | Expo 앱 config |
| `.moai/config/sections/quality.yaml` | 품질/방법론(TDD, 85%) 설정 |
| `apps/backend/prisma/schema.prisma` | Prisma 7 스키마(`prisma-client` 제너레이터, source-emit, `Profile` + `Moim` + `MoimMember` 모델) |
| `apps/backend/prisma/migrations/20260615000000_add_profile_name/` | Profile.name(String? nullable) 추가 마이그레이션 — SPEC-MOBILE-004 |
| `apps/backend/src/profile/update-name.dto.ts`, `apps/backend/src/profile/profile-response.dto.ts` | PATCH /me UpdateNameDto + name 포함 ProfileResponseDto — SPEC-MOBILE-004 |
| `apps/web/lib/auth/require-named-session.ts` | 공유 서버 가드 — getSession→/login, getMe, name 없으면 /onboarding (SPEC-MOBILE-004) |
| `apps/web/app/onboarding/` | 이름 입력 온보딩 페이지 — provider 비종속, (main) 그룹 외부, 루프 안전 (SPEC-MOBILE-004) |
| `apps/mobile/lib/auth/google-signin-core.ts`, `apps/mobile/lib/auth/google-signin.ts` | 네이티브 Google Sign-In 순수 코어 + SDK 래퍼 (SPEC-MOBILE-004) |
| `apps/mobile/lib/auth/signin-id-token-core.ts`, `apps/mobile/lib/auth/supabase-mobile.ts` | signInWithIdToken 순수 코어 + Supabase mobile SDK 래퍼 (SPEC-MOBILE-004) |
| `apps/mobile/plugins/withModularHeaders.js` | Expo config plugin — use_modular_headers! Podfile 주입(GoogleSignin 8.x AppCheckCore 정적 통합 pod install 오류 해소) — SPEC-MOBILE-004 v0.3.0 |
| `apps/mobile/app/_layout.tsx` (GoogleSignin.configure) | 앱 부트 시 GoogleSignin.configure 호출 + 실 OAuth 클라이언트 ID 배선 — SPEC-MOBILE-004 v0.3.0 |
| `apps/mobile/lib/auth/bridge-protocol.ts` (auth:google-request) | `"auth:google-request"` bridge 커맨드 타입 추가(additive, BRIDGE_VERSION 1 유지) — SPEC-MOBILE-004 v0.3.0 |
| `apps/web/lib/native-bridge/bridge-protocol.ts` (auth:google-request) | 동일 `"auth:google-request"` 커맨드 타입 추가(web 측) — SPEC-MOBILE-004 v0.3.0 |
| `apps/backend/prisma/migrations/20260602095934_init_profile/` | 첫 도메인 마이그레이션(`Profile`) |
| `apps/backend/prisma/migrations/20260613155202_add_moim/` | 모임 도메인 마이그레이션(`Moim` + `MoimMember`, onDelete Cascade) |
| `apps/backend/prisma/migrations/20260613175232_add_chat/` | 채팅 도메인 마이그레이션(SPEC-CHAT-001) — `ChatMessage` 테이블 + 수동 SQL(트리거/RLS/CHECK/realtime 정책) |
| `apps/backend/src/auth/`, `apps/backend/src/profile/` | 인증 가드/검증/config + profile 모듈·서비스·`GET /me` |
| `apps/backend/src/moim/` | 모임 도메인 모듈(SPEC-MOIM-001) — MoimService/MoimController/MoimModule + dto + spec/integration 테스트 |
| `apps/backend/src/invite/` | 초대 도메인 모듈(SPEC-MOIM-002) — InviteService/InviteController/InviteModule + dto + spec/integration 테스트 |
| `apps/backend/src/chat/` | 채팅 도메인 모듈(SPEC-CHAT-001) — ChatService/ChatController/ChatModule + chat-events.ts(@MX:ANCHOR) + dto + spec/integration 테스트 |
| `apps/backend/test/chat.live.mts` | 채팅 수동 검증 스크립트(SPEC-CHAT-001 AC-1c/4/5 런타임 검증) |
| `apps/web/lib/chat/useChatChannel.ts` | Supabase Realtime private channel 구독 훅(SPEC-CHAT-001) |
| `apps/web/app/moims/[id]/chat/page.tsx` | 모임 채팅 페이지(SPEC-CHAT-001) — 히스토리 로드 + 구독 + 전송 |
| `apps/web/app/invite/[token]/` | 초대 랜딩 페이지(SPEC-MOIM-002) — 익명 로그인 → nickname → accept → /moims/[id]/chat |
| `apps/web/lib/invite/accept.ts` | 초대 수락 클라이언트 로직(SPEC-MOIM-002) |
| `supabase/config.toml` (enable_anonymous_sign_ins) | 익명 로그인 활성화(SPEC-MOIM-002) — `enable_anonymous_sign_ins = true`, `anonymous_users = 30` |
| `apps/web/lib/supabase/`, `apps/web/lib/auth/`, `apps/web/proxy.ts` | 웹 `@supabase/ssr` 클라이언트·세션 미들웨어·auth 액션·PKCE 콜백 |
| `apps/mobile/App.tsx` | 풀스크린 WebView 셸 + Google OAuth 인터셉트/복귀(SPEC-MOBILE-001) |
| `apps/mobile/lib/web-url.ts` | `EXPO_PUBLIC_WEB_URL` 가드 + `WEB_URL`(@MX:ANCHOR) — WebView source·OAuth 콜백 호스트 단일 출처 |
| `apps/mobile/lib/auth/oauth.ts` | 모바일 시스템 브라우저 OAuth 헬퍼 + Google authorizeUrl 브리지 배선(R-F3 완성) |
| `apps/mobile/lib/auth/oauth-bridge.ts` | OAuth 브리지 순수 URL 헬퍼(인터셉트 판별/redirect_to 재작성/콜백 조립) — vitest 단위 테스트 |
| `apps/backend/prisma.config.ts` | Prisma 7 연결 URL(`DATABASE_URL`/`DIRECT_URL`) 위치 |
| `apps/backend/openapi.ts`, `openapi.json` | OpenAPI emit 스크립트 + 커밋된 계약 산출물 |
| `supabase/config.toml`, `supabase/README.md` | 로컬 Supabase CLI 스택(direct `:54322`) |
| `apps/web/lib/env.ts`, `apps/mobile/lib/env.ts` | 프런트 env 가드(미설정 시 throw) |
| `apps/mobile/eas.json` | EAS `local`/`prod` 프로파일 스켈레톤 |
| `.github/workflows/ci.yml` | CI(install/build/lint/test/typecheck, migrate/deploy 없음) |
| `docs/deploy-render.md` | Render 배포 가이드 |

## 참조

- 계획 스택 상세/근거: [`.moai/specs/SPEC-ENV-SETUP-001/`](../specs/SPEC-ENV-SETUP-001/) (`spec.md`, `acceptance.md`, `plan.md`, `audit.md`)
- 디렉터리/패키지 구조: [structure.md](./structure.md)
- 제품 비전: [product.md](./product.md)
