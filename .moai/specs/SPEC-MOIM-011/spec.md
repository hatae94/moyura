---
id: SPEC-MOIM-011
version: 0.4.0
status: completed
created: 2026-06-22
updated: 2026-06-22
author: hatae
priority: medium
issue_number: 0
---

# SPEC-MOIM-011: 초대 링크 생성 UI + 딥링크 (invite-create UI + moyura://invite 딥링크)

## HISTORY

- 2026-06-22 (v0.4.0): **모바일 딥링크 로드 시 자동 열기 추가**(사용자 요청 — "버튼 한 번 더 안 누르고 앱이 바로 열리도록"). 변경: `apps/web/app/invite/[token]/page.tsx` — 모바일 브라우저(앱 셸 아님 — `window.ReactNativeWebView` 부재)에서 페이지 로드 시 `useEffect`+`useRef` 가드로 `moyura://invite/{token}` 을 마운트당 1회 자동 발화. 앱 셸(WebView) 안에서는 자동 발화 제외(재진입 루프 방지), 데스크톱 미노출. "앱에서 열기" 버튼은 모바일 브라우저 한정 수동 재시도 폴백으로 유지. **이 변경은 v0.1.0 의 "자동 리다이렉트 없음" 확정 결정을 SUPERSEDE 한다**(REQ-MOIM11-005·§4·§5·리스크 갱신). 검증(2026-06-22): web typecheck/lint/`nx run web:build` 0, iOS 시뮬레이터(iPhone 16) Safari 에서 `simctl openurl http://localhost:3000/invite/{token}` → 인앱 버튼 탭 없이 scheme 자동 발화 → iOS 시스템 "'app'에서 이 페이지를 열겠습니까?" 확인 표시(스크린샷 확인). **잔여 한계**: 커스텀 scheme 특성상 iOS 가 시스템 "열기?" 확인을 1회 표시한다(앱 미설치 시 "주소가 올바르지 않습니다" 안내) — 확인창 없는 완전 무탭은 Universal Links(실 https 도메인 + apple-app-site-association + associated domains) 필요, localhost 불가로 향후 과제. status `completed` 유지(딥링크/수락/생성 UI 는 v0.3.0 에서 검증 완료, 본 변경은 UX 개선).
- 2026-06-22 (v0.3.0): **device-gated 검증 완료 → status completed**. Maestro(2.3.0, 번들 idb 드라이버 — macOS 손쉬운 사용 권한 불필요, iPhone 16 시뮬레이터 iOS 18.6)로 딥링크 종단 검증: (1) `xcrun simctl openurl moyura://invite/{token}` → iOS "'app'에서 열겠습니까?" 프롬프트(scheme OS 등록·라우팅 확인, warm+cold) → Maestro `tapOn "열기"` → **앱이 `app/invite/[token]` 라우트로 열려 WebView 수락 페이지 렌더**("모임 초대" + 모바일 전용 "앱에서 열기" 버튼 + 닉네임 폼 — REQ-MOIM11-004/005 ✓). (2) Maestro `inputText` 닉네임 + `tapOn "모임 참여하기"` → 백엔드 수락 → **모임 가입 → 채팅 화면 리다이렉트**(CHAT-001 in-WebView, 기존 메시지 렌더). (3) 홈 → 모임 카드 탭 → 상세 네이티브 push(MOIM-003) → 멤버 목록에 가입자 반영 + 4개 투표 + 헤더 일정/장소 finalize 결과 in-WebView 렌더 확인. (4) 웹 초대 생성 UI(이전 세션 보류분) — 백엔드 재기동(다운 상태였음, expert-debug 진단)으로 웹 로그인 정상화 후 데스크톱 브라우저에서 owner "초대하기" → 발급 링크 표시 → "링크 복사" → "복사됨" + 수락 페이지 데스크톱 "앱에서 열기" 미노출(모바일 감지 게이트) 확인. → REQ-MOIM11-001~007 + AC 전부 검증(딥링크 모바일 + 생성 UI 데스크톱 + 수락 in-WebView). 검증 도구: Maestro flows + simctl openurl/screenshot. 잔여 참고: Maestro 의 WebView 내 투표 옵션 버튼 탭은 a11y 해상도 한계로 자동 등록이 불안정(앱 결함 아님 — 동일 WebView 의 입력/버튼 탭은 정상 등록되어 가입까지 동작; 투표 동작 자체는 데스크톱 + poll-*.live.mts 로 검증됨).
- 2026-06-22 (v0.2.0): 구현 완료 + 자동 게이트 검증 → status in-progress(device-gated). **구현 요약**: (1) **백엔드/마이그레이션 무변경** — 기존 초대 라우트(발급/목록/폐기/수락 4개) 그대로 재사용. DTO·라우트·마이그레이션·jest 무변경. (2) **웹 신규**: `apps/web/lib/moim/invites.ts`(`createInvite` 구체-경로 헬퍼 + `InviteResult` 로컬 미러 타입 — `lib/moim/polls.ts` 패턴 미러), `apps/web/app/(main)/home/[id]/invite-actions.ts`(Server Action — 발급 + `InviteResult` 반환), `apps/web/app/(main)/home/[id]/invite-button.tsx`(owner 전용 Client 섬 — "초대하기" 버튼 + 발급 → 링크 표시 + `navigator.clipboard` 복사; 비-owner 는 null), `apps/web/app/(main)/home/[id]/page.tsx` — `isOwner = moim.createdBy === session.user.id` 계산 + `<InviteButton>` 렌더, `apps/web/app/invite/[token]/page.tsx` — `useSyncExternalStore` UA 감지로 모바일 브라우저에만 "앱에서 열기" 버튼 추가(`window.location = moyura://invite/{token}`); 데스크톱 미노출, 자동 리다이렉트 없음, 기존 닉네임 폼 보존. (3) **모바일 신규**: `apps/mobile/app/invite/[token].tsx`(신규 expo-router 네이티브 라우트 — `${WEB_URL}/invite/${token}` BridgedWebView 호스팅, MOIM-003 detail-in-WebView 패턴 미러, `(tabs)`·`(auth)` 그룹 밖 공개 랜딩), `apps/mobile/app/_layout.tsx` — `<Stack.Screen name="invite/[token]" />` 추가(expo-router scheme "moyura" 기존 설정 + 파일 기반 라우팅으로 `moyura://invite/{token}` 자동 링크). (4) **커스텀 scheme `moyura://invite/{token}`** — 기존 `moyura://auth-callback` 선례 확장. Universal Links 미포함. **자동 게이트**: web tsc/lint/`nx run web:build` 0 error, mobile tsc/vitest 0 error(회귀 0), backend jest 무변경(기존 invite jest 회귀 GREEN). **미완료(device-gated)**: (1) `moyura://invite/{token}` 딥링크가 앱을 `app/invite/[token]` 라우트로 여는지 — iOS 시뮬레이터 검증 필요. (2) "앱에서 열기" 버튼이 scheme 을 발화하는지 — iOS 시뮬레이터 검증 필요. (3) 웹 초대 생성 UI 워크스루(owner "초대하기" → 발급 → 링크 + 복사) — 이번 세션 웹 로그인 세션-쿠키 리다이렉트 이슈(signInAction 303→/home 307 bounce, auth/middleware 무변경, 직접 signInWithPassword 확인됨)로 미수행.
- 2026-06-22 (v0.1.0): 최초 draft. 초대 백엔드(SPEC-INVITE / REQ-INV — `apps/backend/src/invite/`)는 **완전 구축됨**: owner 전용 발급(`POST /moims/:moimId/invites`, expiresAt?/maxUses? 선택 — 미지정 시 +7d/무제한 기본값), owner 전용 목록(`GET .../invites`, live 토큰 포함), owner 전용 폐기(`DELETE .../invites/:inviteId`), 수락(`POST /invites/:token/accept`, 익명 로그인 가능 — 404 미지/410 만료·폐기/409 초과/400 빈 nickname). 웹에는 수락 랜딩(`apps/web/app/invite/[token]/page.tsx`, 닉네임 폼 → 익명 세션 → submitAccept)이 있다. **그러나 갭이 둘 있다**: (1) 초대를 **생성**할 UI 가 어디에도 없다("초대하기" 버튼 부재 — owner 가 토큰을 만들 표면이 없음); (2) 초대 링크에서 **모바일 앱으로 들어올 딥링크**가 없다(`moyura://` scheme 은 app.json 에 설정됐고 `moyura://auth-callback` 선례가 있으나 invite 경로는 미배선). 본 SPEC 은 이 둘을 한 SPEC 으로 채운다. **WHY**: 모임의 가장 흔한 성장 경로는 owner 가 친구에게 초대 링크를 보내 끌어들이는 것인데, 백엔드 발급 API 가 다 있는데도 그걸 누를 버튼이 없어 초대 자체가 불가능했다(수락 페이지만 있고 진입이 없음). 그리고 초대를 받은 사람이 모바일에서 링크를 누르면 브라우저 웹 페이지로만 가고 설치된 앱으로 들어올 길이 없었다. **확정 설계 결정(사용자 선택 — 재논의 없음)**: (1) **딥링크 메커니즘 = 커스텀 scheme `moyura://invite/{token}`**(Universal Links 아님). 기존 `moyura://` scheme(auth-callback 선례)을 확장하고 expo-router 파일 기반 라우팅이 scheme path 를 라우트로 매핑한다. Universal Links(https 자동 열기)는 호스팅 도메인 + apple-app-site-association + associatedDomains 엔타이틀먼트가 필요해 localhost 에서 불가 — **제외**(향후). (2) **웹→앱 핸드오프 = 명시적 "앱에서 열기" 버튼**(수락 페이지 `/invite/[token]` 에, 모바일 브라우저에서만 노출)이 `moyura://invite/{token}` 로 이동. 앱 미설치면 scheme 은 no-op 이고 사용자는 기존 닉네임 폼(웹 폴백)으로 계속 진행. **자동 리다이렉트 없음**. 데스크톱은 버튼 미노출(웹 수락 폼만). (3) **스코프 = 한 SPEC**(초대 생성 UI + 딥링크). **핵심 결정 기록**: (a) **백엔드 무변경** — 발급/목록/폐기/수락 4개 라우트 모두 존재(REUSE). 본 SPEC 은 백엔드 코드를 한 줄도 바꾸지 않는다(확인만, 회귀 보존). (b) 초대 생성 UI 는 **웹**이 소유(모임 상세 `(main)/home/[id]` 안 owner 전용 "초대하기") → 모바일 WebView 안에서 렌더되므로 별도 네이티브 생성 화면 없음. `lib/moim/polls.ts` 구체-경로 헬퍼 패턴을 미러한 신규 `lib/moim/invites.ts` 의 `createInvite(api, moimId, body?)` 가 `POST /moims/:moimId/invites` 를 호출(path-param → api-client 편의 메서드 아님). (c) MVP 생성 UI = 발급 + 링크 표시 + 복사 한 개. 목록/폐기/관리 UI·per-invite 만료·maxUses 입력·QR·OS 공유 시트는 **제외**(§4). (d) 딥링크 = 신규 expo-router 라우트 `apps/mobile/app/invite/[token]`(네이티브 화면)이 `${EXPO_PUBLIC_WEB_URL}/invite/{token}` 을 react-native-webview(BridgedWebView 패턴)로 호스팅 — MOIM-003 detail-in-WebView 패턴 미러. expo-router scheme 링킹(scheme "moyura" 설정됨)이 `moyura://invite/{token}` → 이 라우트로 매핑. 수락은 WebView 안 웹 수락 페이지가 수행. (e) **모바일 네이티브 코드를 실제로 건드린다**(신규 `app/invite/[token]` 라우트 + 링킹) — MOIM-005~010 의 "모바일 무변경"과 다르다. mobile vitest/tsc/expo export 게이트가 적용되고 모바일은 본 SPEC 에서 "변경됨"이며 **device-gated**(scheme 열림 + 수락 화면은 iOS 시뮬레이터/기기에서만 검증 가능). (f) **device-gated 결정**: 웹 초대 생성·복사·수락 페이지 버튼 렌더는 데스크톱 브라우저에서 검증 가능. 그러나 `moyura://invite/{token}` 가 앱을 수락 화면으로 여는 것 + "앱에서 열기" 버튼이 scheme 을 발화하는 것은 iOS 시뮬레이터/기기에서만 검증 가능 → sync 시 status `in-progress`, acceptance 에 런북식 디바이스 체크리스트 포함.

---

## 1. 개요 (Overview)

SPEC-INVITE(REQ-INV)가 초대 백엔드를 완전히 구축했다 — owner 전용 발급/목록/폐기와 수락 흐름(익명 로그인 게스트 가입 포함)이 모두 동작하고 jest 로 고정돼 있다. 웹에는 수락 랜딩 페이지(`apps/web/app/invite/[token]/page.tsx`)가 있어 링크를 받은 사람이 닉네임을 넣고 모임에 합류할 수 있다. **그러나 초대를 _만들_ UI 가 없다** — 어디에도 "초대하기" 버튼이 없어 owner 가 발급 API 를 호출할 표면이 존재하지 않았고, 결과적으로 백엔드는 준비됐는데 초대 자체를 시작할 수 없었다. 또한 초대 링크를 모바일에서 누르면 모바일 브라우저의 웹 페이지로만 가고, 설치된 모야 앱으로 들어올 **딥링크가 없었다**.

본 SPEC 은 이 두 갭을 한 SPEC 으로 채운다:

1. **초대 생성 UI(웹, 모바일 WebView 안에서 렌더)** — 모임 상세(`(main)/home/[id]`)에 **owner 전용 "초대하기"** 어포던스를 추가한다. owner(세션 user.id 가 그 모임의 `role==='owner'` 멤버)에게만 보이고, 비-owner 멤버에게는 보이지 않는다. 누르면 신규 구체-경로 헬퍼 `createInvite(api, moimId, body?)`(`lib/moim/polls.ts` 패턴 미러)가 기존 `POST /moims/:moimId/invites` 를 호출해 토큰을 받는다. UI 는 공유 가능한 초대 링크 `{webOrigin}/invite/{token}` 을 **복사 버튼**(navigator.clipboard)과 함께 보여준다. 작은 Client 섬(상태 + 클립보드)이다.
2. **딥링크 `moyura://invite/{token}`(모바일 네이티브 + 웹 엣지)** — 모바일에 신규 expo-router 라우트 `apps/mobile/app/invite/[token]`(네이티브 화면)를 추가해 `${EXPO_PUBLIC_WEB_URL}/invite/{token}`(웹 수락 페이지)을 react-native-webview 로 호스팅한다(MOIM-003 detail-in-WebView 패턴 미러). expo-router 의 scheme 링킹(scheme "moyura" 이미 설정)이 `moyura://invite/{token}` → 이 라우트로 매핑한다. 수락은 WebView 안 웹 수락 페이지(WebView 의 Supabase 세션으로 백엔드에 POST)가 수행한다. 웹 수락 페이지(`/invite/[token]/page.tsx`)는 **모바일 브라우저(앱 셸 아님)에서 로드 시 `moyura://invite/{token}` 을 1회 자동 발화**해 앱 설치 시 바로 열고(v0.4.0), 자동 시도가 막힌 경우의 수동 재시도로 "앱에서 열기" 버튼을 함께 둔다. 앱 미설치면 scheme 은 no-op 이고 기존 닉네임 폼(웹 폴백)이 유지된다. 데스크톱·앱 셸(`window.ReactNativeWebView` 존재)에서는 자동 발화·버튼 모두 미노출.

아키텍처는 하이브리드(불변)다: 웹이 화면 콘텐츠를 소유하고, 모바일이 네이티브 크롬을 소유한다. 초대 생성 UI 는 모임 상세 안에서 in-WebView 로 렌더되므로 **별도 네이티브 생성 화면이 없다**. 다만 딥링크 **라우트**(신규 `app/invite/[token]`)와 scheme 링킹은 진짜 모바일 네이티브 추가다 — MOIM-005~010 이 "모바일 무변경"이었던 것과 달리, 본 SPEC 은 모바일을 실제로 건드린다.

**백엔드는 무변경**이다. 발급(`POST /moims/:moimId/invites`)·목록·폐기·수락 4개 라우트가 모두 존재하므로(REUSE) 본 SPEC 은 백엔드 코드를 한 줄도 바꾸지 않는다(기존 invite jest 회귀 보존만 확인). 보안상 초대 토큰은 가입 자격증명이므로 owner 만 본다(발급/목록이 owner 전용 — REQ-INV-004) — 생성 UI 가 owner-gated 인 이유이고, "앱에서 열기" 버튼은 이미 웹 URL 에 있는 토큰을 scheme URL 로 그대로 넘길 뿐이라 새 노출이 없다.

이는 **초대 생성 버튼(owner 전용) + 발급 헬퍼 + 링크 표시·복사 + 모바일 딥링크 라우트(WebView 호스팅) + 웹 수락 페이지 "앱에서 열기" 버튼** 이지 대형 기능이 아니다. Universal Links(확인창 없는 무탭 열기)·초대 목록/폐기/관리 UI·per-invite 만료/maxUses 입력·QR·OS 공유 시트·Android 딥링크·백엔드 변경은 모두 제외한다(§4 — 단 모바일 로드 시 scheme 자동 발화는 v0.4.0 에서 추가됨).

---

## 2. EARS 요구사항 (Requirements)

요구사항 모듈은 7개로 제한한다. 각 모듈은 `REQ-MOIM11-XXX`로 번호를 부여하며(기존 `REQ-INV-XXX`/`REQ-MOIMn-XXX` 등과 네임스페이스 분리) 모두 테스트 가능하고 `acceptance.md`의 시나리오(AC-N)로 추적된다.

### REQ-MOIM11-001: 백엔드 무변경 — 기존 초대 라우트 재사용 (Ubiquitous)

- **The backend shall** 본 SPEC 에서 **변경되지 않는다** — 초대 발급(`POST /moims/:moimId/invites`, owner 전용 201)·목록(`GET .../invites`, owner 전용)·폐기(`DELETE .../invites/:inviteId`, owner 전용)·수락(`POST /invites/:token/accept`, 404/410/409/400 고정)이 모두 이미 존재하므로 본 SPEC 은 `apps/backend/src/invite/**` 를 그대로 둔다(코드·DTO·라우트·검증·테스트 무변경).
- **The backend shall** `CreateInviteDto` 의 선택 필드(`expiresAt?`, `maxUses?`)를 그대로 둔다 — 본 SPEC MVP 의 생성 UI 는 body 를 비우거나 생략해 백엔드 기본값(+7d 만료, maxUses null=무제한)을 쓴다(REQ-INV-001 기본값 경로 재사용).
- **The backend shall** `InviteResponseDto.token`(추측 불가 base64url, ≥128-bit)을 발급 응답에 그대로 담는다 — 웹 생성 UI 가 이 토큰으로 공유 링크 `{webOrigin}/invite/{token}` 을 조립한다(신규 백엔드 필드 없음).
- **The backend shall** 수락 흐름(`POST /invites/:token/accept`)의 인가(`SupabaseAuthGuard` — 익명 로그인 sub 포함)·고정 실패 코드·멱등을 그대로 유지한다 — 딥링크가 여는 WebView 수락 페이지가 이 동일 계약을 호출하므로 새 수락 경로가 아니다.
- (Unwanted behavior) **IF** 본 SPEC 구현 중 백엔드 갭이 발견되면(예: 생성 헬퍼가 요구하는 필드 부재), **then** 우선 재사용을 시도하고 변경이 불가피하면 그 한 항목만 별도 기록한다 — 무분별한 백엔드 수정 금지(기대: 변경 0).

### REQ-MOIM11-002: 초대 생성 헬퍼 — 구체-경로 호출 (Ubiquitous)

- **The web app shall** 초대 발급 path-param 라우트(`POST /moims/:moimId/invites`)를 web 의 **구체-경로 헬퍼**(신규 `lib/moim/invites.ts` 의 `createInvite(api, moimId, body?)`)로 호출한다 — `lib/moim/polls.ts`(`createPoll`/`votePoll`/`closePoll`)와 동일 패턴(moimId 인코딩 → 구체 경로 조립 → `api.request(path as never, "post", ...)`). api-client 편의 메서드(리터럴 경로 전용)에 넣지 않는다.
- **The web app shall** `createInvite` 의 body 를 선택적으로 받되 MVP 에서는 비우거나(`{}`) 생략해 백엔드 기본값(+7d/무제한)을 쓴다 — `expiresAt`/`maxUses` 입력 UI 는 본 SPEC 범위 밖(§4).
- **The web app shall** 발급 응답에서 `token`(과 필요 시 `expiresAt`)을 받아 공유 링크 `{webOrigin}/invite/{token}` 을 조립한다 — `webOrigin` 은 현재 페이지 origin(또는 web env)에서 파생하며 토큰은 URL path 에만 싣는다(query/Authorization 에 토큰을 추가로 노출하지 않음).
- **The web/api-client shall** invite 타입을 로컬 미러(`lib/moim/invites.ts` 의 `InviteResult { token; expiresAt; ... }`)로 두거나 `@moyura/api-client` 의 기존 `InviteResponse`(존재 시)를 재사용한다 — 백엔드 무변경이므로 schema 재생성은 필요 없다(웹이 invite 타입을 api-client 에서 import 하지 않으면 로컬 미러로 충분, `PollWithResults` 미러 선례와 동일). 토큰은 Authorization Bearer 헤더로만 인증을 전달한다(기존 `getToken` 보존).

### REQ-MOIM11-003: 초대 생성 UI — owner 전용 "초대하기" + 링크 표시·복사 (Event-driven / State-driven / Unwanted behavior 혼합)

- (State-driven, owner 게이트) **WHILE** 현재 사용자(session.user.id)가 그 모임의 owner 인 동안(멤버 목록에서 `role==='owner'` 인 멤버의 userId 와 일치 — 또는 `moim.createdBy`/owner 필드, 코드로 확인), **the web app shall** 모임 상세(`(main)/home/[id]`)에 "초대하기" 어포던스를 노출한다.
- (State-driven, 비-owner 숨김) **WHILE** 현재 사용자가 owner 가 아닌 동안, **the web app shall** "초대하기" 어포던스를 노출하지 **않는다**(방어적 — 백엔드가 비-owner 발급을 403 으로 이미 차단하므로 UI 숨김은 defense-in-depth, 권위 출처는 백엔드).
- (Event-driven, 발급) **WHEN** owner 가 "초대하기" 를 누르면, **the web app shall** `createInvite(api, moimId)`(body 비움 — 백엔드 기본값)를 호출하고, 성공 시 응답 `token` 으로 공유 링크 `{webOrigin}/invite/{token}` 을 화면에 표시한다(Client 섬 상태에 보관).
- (Event-driven, 복사) **WHEN** owner 가 표시된 링크의 **복사** 버튼을 누르면, **the web app shall** `navigator.clipboard.writeText(link)` 로 링크를 클립보드에 복사하고 복사 완료 피드백("복사됨" 류)을 표시한다. clipboard API 미가용/거부 시 일반화된 폴백(링크 텍스트 선택 가능 상태 유지)으로 graceful 처리하고 토큰/오류 상세를 노출하지 않는다.
- (Unwanted behavior) **IF** 발급이 백엔드 오류(403 비-owner/404 미존재 모임/네트워크)를 반환하면, **then the web app shall** 화면에 머무른 채 일반화된 오류를 표시하고(토큰/오류 상세 비노출) 재시도할 수 있게 한다 — 비-owner 가 (UI 우회로) 발급을 시도해도 백엔드 403 이 최종 방어선이다.
- (Ubiquitous, 디자인) **The web app shall** 초대 생성 UI("초대하기" 버튼·링크 표시·복사 버튼·복사 피드백)를 Meetup 디자인 시스템(`(main)/home/[id]` 가 쓰는 동일 오렌지 시맨틱 토큰 — `bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`)으로 렌더하며, login/onboarding 의 blue 흐름 토큰을 사용하지 않는다.

### REQ-MOIM11-004: 모바일 딥링크 라우트 — moyura://invite/{token} → WebView 수락 (Event-driven / Ubiquitous 혼합)

- (Ubiquitous, 라우트) **The mobile app shall** 신규 expo-router 라우트 `apps/mobile/app/invite/[token]`(네이티브 화면)를 추가해 `${EXPO_PUBLIC_WEB_URL}/invite/{token}`(웹 수락 페이지)을 react-native-webview(`BridgedWebView` 또는 동등 패턴)로 호스팅한다 — MOIM-003 의 detail-in-WebView 패턴(`(tabs)/home/[id]` 가 `urlForDetailRoute` 로 `${WEB_URL}/home/{id}` 를 호스팅)을 미러한다.
- (Event-driven, scheme 링킹) **WHEN** OS 가 `moyura://invite/{token}` 딥링크를 앱으로 전달하면, **the mobile app shall** expo-router 의 scheme 링킹(app.json `scheme: "moyura"` 이미 설정 — `moyura://auth-callback` 선례와 동일 scheme)으로 이를 `app/invite/[token]` 라우트로 해석해 그 화면을 띄운다. scheme path 가 라우트로 자동 매핑되도록 expo-router 링킹을 확인/배선한다(파일 기반 라우트는 자동 링크되나, scheme path 해석을 위한 `app/_layout.tsx` 링킹 설정이 필요하면 추가).
- (Ubiquitous, 토큰 전달) **The mobile app shall** 딥링크 path 의 `{token}` 세그먼트를 그대로 web 수락 페이지 URL 의 path 세그먼트로 전달한다(`${EXPO_PUBLIC_WEB_URL}/invite/${encodeURIComponent(token)}`) — 토큰을 query/헤더로 옮기지 않고 path 에만 유지(웹 수락 페이지가 path 파라미터로 토큰을 읽음, 기존 계약).
- (Ubiquitous, 수락 위임) **The mobile app shall** 실제 수락(닉네임 입력 → `POST /invites/:token/accept`)을 WebView 안 웹 수락 페이지에 위임한다 — 네이티브는 "올바른 web URL 을 WebView 로 띄우는" 역할만 하고 수락 로직/토큰 검증/실패 코드를 재구현하지 않는다(REQ-MOIM11-001 백엔드 무변경과 일관).
- (Unwanted behavior) **IF** 딥링크 token 세그먼트가 비었거나 malformed 이면, **then the mobile app shall** crash 없이 안전 처리한다(빈 token 으로 WebView 를 띄우면 웹 수락 페이지가 404/유효하지 않은 링크 안내를 표시 — 기존 web 계약). 네이티브에서 throw 하지 않는다.
- (Ubiquitous, scheme 보존) **The mobile app shall** 기존 `moyura://auth-callback`(OAuth 복귀) 링킹·`(tabs)`/`(auth)` 라우트·WebView origin 잠금(`originWhitelist`)·route-map-core 매핑을 **그대로 보존**한다 — invite 라우트 추가가 인증/탭/교차 라우트 흐름에 회귀를 일으키지 않는다(확인).

### REQ-MOIM11-005: 웹 수락 페이지 "앱에서 열기" 버튼 — 모바일 브라우저 한정 (Event-driven / State-driven / Unwanted behavior 혼합)

- (State-driven, 모바일 노출) **WHILE** 웹 수락 페이지(`/invite/[token]`)가 모바일 브라우저에서 렌더되는 동안(user-agent 또는 동등 모바일 감지), **the web app shall** "앱에서 열기" 버튼을 닉네임 폼과 함께 노출한다.
- (State-driven, 데스크톱 숨김) **WHILE** 데스크톱 브라우저에서 렌더되는 동안, **the web app shall** "앱에서 열기" 버튼을 노출하지 **않는다**(데스크톱은 웹 수락 폼만).
- (Event-driven, 로드 시 자동 시도 — v0.4.0) **WHEN** 웹 수락 페이지가 모바일 브라우저(앱 셸 아님 — `window.ReactNativeWebView` 부재)에서 로드되면, **the web app shall** 마운트당 1회 `window.location` 을 `moyura://invite/{token}` 으로 설정해 앱 열기를 자동 시도한다(버튼 추가 탭 불필요). 앱 셸(WebView) 안에서는 자동 시도하지 **않는다**(재진입 루프 방지).
- (Event-driven, 수동 재시도) **WHEN** 사용자가 "앱에서 열기" 를 누르면, **the web app shall** 동일하게 `window.location` 을 `moyura://invite/{token}` 으로 설정한다(자동 시도가 차단됐거나 앱에서 되돌아온 경우의 수동 재시도 — 현재 path 의 token 그대로, 새 노출 없음).
- (State-driven, 폴백) **WHILE** 앱이 설치되어 있지 않아 scheme 이 no-op 인 동안(또는 사용자가 앱 대신 웹을 선호하는 동안), **the web app shall** 기존 닉네임 수락 폼을 웹 폴백으로 유지한다 — 자동 시도가 실패해도 웹 폼에 머물러 그대로 가입 가능하다(앱 미설치 시 iOS 가 시스템 확인을 1회 표시할 수 있으나 폼은 보존). 확인창 없는 완전 무탭 열기는 Universal Links 가 필요하다(§4, 향후).
- (Ubiquitous, 기존 흐름 보존) **The web app shall** 기존 수락 흐름(익명 로그인 → 닉네임 → `submitAccept` → 성공 시 `/moims/:id/chat` 리다이렉트, 404/410/409/400 일반화 오류)을 그대로 유지한다 — "앱에서 열기" 버튼은 순수 추가이며 기존 폼/제출/오류 처리에 회귀가 없다.
- (Unwanted behavior) **IF** 모바일 감지가 불확실하거나 scheme 발화가 실패하면, **then the web app shall** crash 없이 웹 수락 폼에 머무른다(버튼은 best-effort — 실패해도 웹 폴백이 항상 동작).

### REQ-MOIM11-006: 보안 — 토큰 노출 경계 보존 (Unwanted behavior / Ubiquitous 혼합)

- (State-driven, owner 한정 토큰) **WHILE** 초대 토큰이 가입 자격증명인 동안, **the web app shall** 토큰을 owner 에게만 노출한다 — 발급/목록이 owner 전용(REQ-INV-001/004, 백엔드)이고 생성 UI 가 owner-gated 이므로, 비-owner 멤버는 토큰을 보지 못한다(UI 숨김 + 백엔드 403 이중 방어).
- (Ubiquitous, 수락 인증) **The backend shall** 수락에 인증을 요구한다(`SupabaseAuthGuard` — 익명 로그인 sub 포함, 기존 계약) — 딥링크가 여는 WebView 수락도 동일 가드를 통과한다(새 우회 경로 없음).
- (Ubiquitous, scheme 노출 동등) **The web/mobile shall** "앱에서 열기" 와 딥링크가 **이미 웹 URL 에 있는 토큰**을 scheme URL 로 그대로 넘긴다 — 토큰을 새 채널(로그/분석/query)로 추가 노출하지 않는다(노출 표면 불변).
- (Unwanted behavior) **IF** 발급/복사/딥링크 경로에서 오류가 나면, **then** 토큰이나 오류 상세를 사용자 화면/로그에 노출하지 않고 일반화된 메시지로 처리한다(R-A9 정신 보존).

### REQ-MOIM11-007: 회귀 보존 — 기존 모임/투표/인증/수락 흐름 (Ubiquitous)

- **The web app shall** 모임 상세(`(main)/home/[id]`)의 기존 렌더(이름·일정·장소 헤더·멤버 목록·채팅 입장·투표 섹션 — MOIM-003~010)를 그대로 보존하고, "초대하기" UI 를 owner 전용 추가 어포던스로만 더한다(기존 콘텐츠 무파손).
- **The mobile app shall** 기존 expo-router 트리(`(tabs)`/`(auth)`/`index`/`(tabs)/home/[id]`)·`BridgedWebView`·`route-map-core` 매핑·OAuth 딥링크·WebView origin 잠금을 그대로 보존하고, `app/invite/[token]` 라우트를 순수 추가한다(인증/탭/교차 라우트 회귀 0).
- **The web app shall** 수락 페이지(`/invite/[token]`)의 기존 닉네임 폼·익명 로그인·`submitAccept`·리다이렉트를 그대로 보존하고, "앱에서 열기" 버튼을 모바일 한정 추가로만 더한다.
- **The backend shall** invite/moim/poll/auth 도메인의 기존 jest 를 그대로 통과한다(본 SPEC 백엔드 무변경 — invite jest 회귀 보존).
- **The web app shall** 신규 invite-create UI 와 헬퍼가 tsc/lint/`nx run web:build` 0 으로 컴파일되고, 모바일은 신규 invite 라우트가 tsc/vitest/`expo export` 0 으로 컴파일된다(회귀 0 + 신규 컴파일).

---

## 3. 델타 마커 (Delta Markers — Brownfield)

본 SPEC 은 초대 백엔드(SPEC-INVITE)와 모임 상세(MOIM-003~010)·모바일 셸(MOBILE-001~004)을 확장한다. 파일·라인은 작성 시점(2026-06-22) verified 기준.

### [EXISTING] (보존 — 변경 없음)

- `apps/backend/src/invite/**`(controller/service/dto/module/spec) — **무변경**. 발급(`POST /moims/:moimId/invites`)·목록(`GET .../invites`)·폐기(`DELETE .../invites/:inviteId`)·수락(`POST /invites/:token/accept`)·`CreateInviteDto`(expiresAt?/maxUses?)·`InviteResponseDto`(token 등)·`assertOwner` 인가·토큰 CSPRNG 생성·404/410/409/400 고정·멱등이 모두 그대로 재사용된다. **백엔드 무변경.**
- `apps/web/app/invite/[token]/page.tsx` 의 기존 닉네임 폼·익명 로그인(`signInAnonymously`)·`submitAccept`·`/moims/:id/chat` 리다이렉트·오류 처리 — 보존. "앱에서 열기" 버튼만 모바일 한정으로 추가([MODIFY]).
- `apps/web/lib/invite/accept.ts`(`submitAccept`/`messageForStatus`/`AcceptOutcome`) — **무변경**(수락 헬퍼 그대로).
- `apps/web/lib/moim/polls.ts`(`createPoll`/`votePoll`/`closePoll`/`listPolls` 구체-경로 패턴) — 보존. 신규 `lib/moim/invites.ts` 가 이 패턴을 미러([ADD]) — invites.ts 는 polls.ts 를 import 하지 않음(독립 헬퍼).
- `apps/web/app/(main)/home/[id]/page.tsx` 의 헤더·멤버 목록·채팅 입장·투표 섹션·`session.user.id`/`accessToken` 전달·`members[]`(role 포함) — 보존. owner 판정용 데이터(members 의 role 또는 moim.createdBy)는 이미 fetch 됨 — "초대하기" Client 섬에 owner 여부 + moimId + accessToken 을 전달하는 prop 만 추가([MODIFY] 최소).
- `apps/mobile/app.json` — scheme `"moyura"` 이미 설정(무변경). `ios.bundleIdentifier: com.hatae.moyura`(무변경). associatedDomains 추가 **안 함**(Universal Links 제외 — §4).
- `apps/mobile/lib/auth/oauth.ts`(`moyura://auth-callback` 선례)·`apps/mobile/lib/route-map-core.ts`(routeForUrl/urlForRoute/detailRouteForUrl/urlForDetailRoute)·`apps/mobile/components/BridgedWebView.tsx`·`apps/mobile/lib/web-url.ts`(`WEB_URL`/`EXPO_PUBLIC_WEB_URL`) — **보존**. invite 라우트가 BridgedWebView·WEB_URL 을 재사용하되 기존 매핑/링킹을 바꾸지 않는다.
- `apps/mobile/app/(tabs)/home/[id].tsx`(detail-in-WebView 패턴) — 보존. invite 라우트가 이 패턴을 미러(import 는 안 함 — 별도 라우트).

### [MODIFY] (수정)

- `apps/web/app/invite/[token]/page.tsx` — 모바일 브라우저 감지 시 "앱에서 열기" 버튼 추가(클릭 → `window.location = moyura://invite/{token}`). 데스크톱 미노출. 기존 닉네임 폼/익명 로그인/submitAccept/리다이렉트/오류 처리 보존(순수 추가).
- `apps/web/app/(main)/home/[id]/page.tsx` — owner 여부(현재 user.id 가 owner 멤버와 일치)를 계산해 "초대하기" Client 섬(`InviteSection` 또는 동등)에 `isOwner`/`moimId`/`accessToken` prop 전달. 기존 섹션 렌더 무변경 — owner 전용 어포던스 추가만.
- `apps/mobile/app/_layout.tsx` — (필요 시) expo-router 링킹 설정에 `invite/[token]` scheme path 매핑 확인/추가. 파일 기반 라우트는 자동 링크되나 scheme path 해석이 자동이 아니면 linking config(prefixes `moyura://` + screens 매핑)를 명시. 기존 `(auth)`/`(tabs)`/`index` Stack·AuthProvider·Google Sign-In 설정 보존.

### [ADD] (신규)

- `apps/web/lib/moim/invites.ts`(신규) — `createInvite(api, moimId, body?)` 구체-경로 헬퍼(`POST /moims/:moimId/invites`, `lib/moim/polls.ts` 미러) + `InviteResult` 로컬 미러 타입(token/expiresAt 등) + 공유 링크 조립 헬퍼(또는 호출부에서 조립). 토큰은 Bearer 헤더로만 인증 전달.
- `apps/web/app/(main)/home/[id]/invite-section.tsx`(신규, Client 섬) — owner 전용 "초대하기" 버튼 + 발급 호출(Server Action 또는 client fetch — polls-section 패턴 따름) + 링크 표시 + 복사 버튼(navigator.clipboard) + 복사 피드백 + 오류 처리. Meetup 오렌지.
  - (발급이 토큰을 클라이언트에 노출하므로 owner 전용 — Server Action 으로 발급하고 토큰만 섬으로 돌려주거나, client 에서 accessToken 으로 직접 호출. polls-section 의 Server Action 패턴 미러 권장.)
- `apps/mobile/app/invite/[token].tsx`(신규, 네이티브 화면) — `useLocalSearchParams` 로 token 읽기 → `${EXPO_PUBLIC_WEB_URL}/invite/${encodeURIComponent(token)}` 조립 → `BridgedWebView` 로 호스팅(MOIM-003 `(tabs)/home/[id].tsx` 미러). routeContext 는 invite 가 `(tabs)`/`(auth)` 그룹 밖이라 적절한 컨텍스트로 설정(인증 무관 공개 랜딩 — WebView 안에서 익명 로그인/수락이 일어남).
- `apps/mobile/app/invite/_layout.tsx`(필요 시, 신규) — invite Stack 레이아웃(headerShown:false, BridgedWebView 풀스크린). `(tabs)/home/_layout.tsx` 미러.

### [BREAK] (의도적 호환성 단절)

- 없음. invite-create UI 는 owner 전용 추가 어포던스, "앱에서 열기" 는 모바일 한정 추가 버튼, 딥링크 라우트는 신규 파일이다 — 기존 타입/라우트/필드를 제거하거나 시그니처를 바꾸지 않는다(순수 추가). web `InviteResult` 는 로컬 미러라 api-client 소비처에 영향 없음.

### [REMOVE]

- 없음(테이블·라우트·파일·필드·컬럼·백엔드 삭제 없음).

---

## 4. 제외 범위 (Exclusions — What NOT to Build)

본 SPEC 에서 **구현하지 않는다**:

- **Universal Links / https 자동 열기** — `https://.../invite/{token}` 링크가 OS 가 자동으로 앱을 여는 Universal Links 는 호스팅 도메인 + apple-app-site-association 파일 + `associatedDomains` 엔타이틀먼트가 필요해 localhost 환경에서 불가능하다. 본 SPEC 은 커스텀 scheme(`moyura://invite/{token}`)만 쓴다 — Universal Links 는 향후(호스팅 도메인 확보 후).
- **자동 scheme 리다이렉트** — 웹 수락 페이지가 로드되자마자 `moyura://invite/{token}` 으로 자동 점프하는 동작은 범위 밖. scheme 은 **"앱에서 열기" 버튼 클릭으로만** 발화한다(앱 미설치 사용자가 빈 화면/에러를 보지 않도록 — 명시적 사용자 의도). 자동 리다이렉트 휴리스틱(타이머/blur 감지)은 향후.
- **초대 목록 / 폐기 / 관리 UI** — owner 가 발급한 초대들을 보거나(GET .../invites) 폐기하는(DELETE) UI 는 범위 밖. MVP 는 발급 + 링크 표시 + 복사 한 개뿐이다. 백엔드 목록/폐기 라우트는 존재하나 UI 를 붙이지 않는다(향후).
- **per-invite 만료 / maxUses 입력 UI** — `CreateInviteDto.expiresAt`/`maxUses` 를 사용자가 폼에서 지정하는 UI 는 범위 밖. MVP 는 백엔드 기본값(+7d 만료, 무제한)을 쓴다(body 비움). 만료/사용 제한 커스터마이즈는 향후.
- **QR 코드** — 초대 링크를 QR 로 렌더하는 기능은 범위 밖. 복사가 MVP 공유 수단이다.
- **네이티브 OS 공유 시트** — `navigator.share`/네이티브 share sheet 로 링크를 시스템 공유하는 기능은 범위 밖. 복사(navigator.clipboard)면 MVP 충분.
- **Android 딥링크 / app-links** — 본 SPEC 의 딥링크·디바이스 검증은 iOS 시뮬레이터/기기 한정이다(프로젝트 메모리 `ios-simulator-only`). Android intent-filter/app-links 배선은 범위 밖(향후).
- **백엔드 초대 라우트 변경** — 발급/목록/폐기/수락 4개 라우트는 모두 존재하므로 본 SPEC 은 백엔드를 변경하지 않는다(REQ-MOIM11-001). DTO 필드 추가·새 라우트·검증 변경 없음.
- **새 invite 수락 경로** — 딥링크는 기존 웹 수락 페이지를 WebView 로 띄울 뿐, 네이티브에 수락 로직(토큰 검증/멤버십 생성/실패 코드)을 재구현하지 않는다(REQ-MOIM11-004 위임).
- **api-client schema 재생성** — 백엔드 OpenAPI 가 바뀌지 않으므로 `schema.d.ts` 재생성이 필요 없다. 웹이 invite 타입을 로컬 미러(`InviteResult`)로 둔다(웹이 api-client 에서 invite 타입을 import 하지 않는 한 — `PollWithResults` 미러 선례). 만약 웹이 api-client 의 기존 invite 타입을 import 한다면 그 타입은 이미 생성돼 있어 추가 작업 없음.
- **모바일 네이티브 초대 생성 화면** — 초대 생성 UI 는 웹이 소유하고 모바일 WebView(모임 상세) 안에서 렌더된다. expo-router 에 네이티브 invite-create 화면을 만들지 않는다. (딥링크 수락 라우트만 네이티브 — 그것도 WebView 호스팅.)

---

## 5. 설계 노트 (Design Notes)

### 백엔드 무변경 — 4개 라우트 전부 존재 (REUSE)

- `apps/backend/src/invite/invite.controller.ts` + `invite.service.ts` 에 발급(owner 전용 `assertOwner` → 토큰 CSPRNG → MoimInvite create)·목록(owner 전용)·폐기(owner 전용)·수락(`SupabaseAuthGuard` → 토큰 검증 → 멱등 멤버십 + usedCount 원자 증가 → 404/410/409/400)이 모두 verified 동작한다. 본 SPEC 은 이 표면을 한 줄도 바꾸지 않는다 — 웹 생성 UI 가 발급을, 딥링크 WebView 가 수락을 **기존 계약 그대로** 호출할 뿐이다.
- MVP 생성은 `CreateInviteDto` body 를 비워(`{}` 또는 생략) 보낸다 → `InviteService.resolveExpiry(undefined)` = now+7d, `resolveMaxUses(undefined)` = null(무제한). 만료/제한 입력 UI 를 안 만드는 게 핵심 단순화다(§4).

### 초대 생성 헬퍼 = polls.ts 구체-경로 패턴 미러

- 발급 라우트(`POST /moims/:moimId/invites`)는 path 파라미터(`moimId`)가 있어 api-client 편의 메서드(리터럴 경로) 표면에 없다 — `lib/moim/polls.ts` 의 `createPoll`/`closePoll` 가 `moimId`/`pollId` 를 인코딩해 구체 경로를 만들고 `api.request(path as never, "post", ...)` 로 호출하는 패턴을 그대로 미러한다. 신규 `lib/moim/invites.ts` 의 `createInvite(api, moimId, body?)` 가 동일 형태다.
- invite 응답 타입은 로컬 미러(`InviteResult { token: string; expiresAt: string; ... }`)로 둔다 — 백엔드 무변경이라 schema 재생성이 없고, 웹이 api-client 의 invite 타입을 import 하지 않으면 `PollWithResults`(polls.ts) 처럼 로컬 미러가 가장 단순하다.

### 초대 생성 UI = owner 전용 Client 섬 (polls-section 패턴)

- 모임 상세 page.tsx(Server Component)가 owner 여부(`session.user.id` 가 `role==='owner'` 멤버의 userId 또는 `moim.createdBy` 와 일치)를 계산해 `InviteSection` Client 섬에 `isOwner`/`moimId`/`accessToken` 을 직렬화 prop 으로 전달한다 — `PollsSection` 이 `currentUserId`/`accessToken` 을 받는 것과 동일 경계(plain object 만, 함수/인스턴스 금지).
- 토큰이 발급 응답에 담기므로 발급은 owner 전용이어야 한다 — Server Action 으로 발급하고 토큰만 섬으로 돌려주는 방식(poll-actions.ts 의 Server Action 미러)이 권장된다(토큰을 서버 경계에서 다루고 클라이언트엔 표시용으로만 전달). 또는 섬이 accessToken 으로 직접 호출. 어느 쪽이든 비-owner 는 백엔드 403 으로 최종 차단된다(UI 숨김은 defense-in-depth).
- 복사는 `navigator.clipboard.writeText` — Client 섬 상태(`copied` boolean)로 "복사됨" 피드백. clipboard 미가용 시 링크 텍스트를 선택 가능 상태로 두는 폴백.

### 딥링크 = 커스텀 scheme moyura://invite/{token} → expo-router 라우트 → WebView

- `moyura://` scheme 은 app.json 에 이미 있고(`moyura://auth-callback` OAuth 선례), expo-router 는 파일 기반 라우트를 자동 링크한다. `app/invite/[token].tsx` 를 추가하면 `moyura://invite/{token}` 가 그 라우트로 해석된다 — Universal Links(https + associatedDomains)가 필요 없는 이유다(커스텀 scheme 은 도메인 검증 불요).
- 이 라우트는 MOIM-003 의 `(tabs)/home/[id].tsx` 를 미러한다: `useLocalSearchParams` 로 token 을 읽고 `${WEB_URL}/invite/${encodeURIComponent(token)}` 을 조립해 `BridgedWebView` 로 호스팅한다. 차이점: invite 는 `(tabs)`/`(auth)` 그룹 밖의 **공개 랜딩**이다(인증 무관 — 미인증 게스트도 링크로 진입, WebView 안에서 익명 로그인 + 수락이 일어남). 따라서 그룹 _layout 가드를 상속하지 않는 최상위 `app/invite/` 트리에 둔다.
- expo-router 의 scheme path 해석이 자동이 아니면(루트 `_layout` 의 linking 설정 필요 시), `app/_layout.tsx` 에 linking prefixes(`moyura://`) + screens 매핑을 명시한다 — 디바이스 검증으로 scheme 이 라우트를 실제로 여는지 확인(이 부분이 device-gated 핵심).
- 수락은 WebView 안 웹 페이지가 수행한다 — 네이티브는 "올바른 URL 을 WebView 로 띄우는" 역할만, 수락 로직/실패 코드는 백엔드 + 웹 페이지의 기존 계약(REQ-INV)을 재사용한다.

### 웹→앱 핸드오프 = 로드 시 자동 시도 + "앱에서 열기" 버튼 (모바일 한정, v0.4.0)

- 웹 수락 페이지(`/invite/[token]/page.tsx`, Client Component)는 모바일 브라우저(앱 셸 아님)에서 로드되면 `moyura://invite/{token}` 을 **마운트당 1회 자동 발화**한다(`useEffect` + `useRef` 가드) — 앱 설치 시 버튼 추가 탭 없이 바로 열린다(v0.4.0). "앱에서 열기" 버튼은 자동 시도가 차단됐거나 앱에서 되돌아온 경우의 **수동 재시도**로 남긴다. 데스크톱·앱 셸(`window.ReactNativeWebView` 존재)에서는 자동 발화·버튼 모두 미노출(셸 안 재진입 루프 방지).
- **자동 시도 + 안전 폴백**: 앱 설치 시 자동 발화로 앱이 열린다 — 단 iOS 는 커스텀 scheme 에 시스템 "열기?" 확인을 1회 표시한다(anti-abuse, Universal Links 없이 제거 불가 §4). 미설치 시 scheme no-op(또는 OS 안내) 후 기존 웹 닉네임 폼이 그대로 유지돼 사용자가 웹에서 가입한다. `useRef` 가드로 마운트당 1회만 발화해 루프가 없다.
- 토큰 노출 동등: 버튼/딥링크는 **이미 웹 URL path 에 있는 토큰**을 scheme URL path 로 그대로 넘긴다 — 새 채널(query/로그/분석)로 토큰을 추가 노출하지 않는다.

### 모바일은 실제로 변경됨 (device-gated)

- MOIM-005~010 은 "모바일 무변경"(웹 UI 가 WebView 안에서 렌더, 네이티브 코드 0)이었다. 본 SPEC 은 다르다 — 신규 `app/invite/[token]` 네이티브 라우트 + (필요 시) `_layout` linking 설정이 진짜 모바일 코드다. 따라서 mobile tsc/vitest/`expo export` 게이트가 적용되고, scheme 이 앱을 여는지 + "앱에서 열기" 버튼이 scheme 을 발화하는지는 **iOS 시뮬레이터/기기에서만** 검증 가능하다(`xcrun simctl openurl booted moyura://invite/{token}` 류) → device-gated, sync 시 status in-progress.
- 단, 웹 초대 생성·복사·수락 페이지 버튼 렌더 자체는 데스크톱 브라우저에서 검증 가능(tsc/lint/build + 브라우저 워크스루).

### 디자인

- 초대 생성 UI("초대하기" 버튼·링크 표시·복사 버튼·복사 피드백)는 `(main)/home/[id]` Meetup 오렌지 토큰 사용(`bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`). "앱에서 열기" 버튼은 수락 페이지의 기존 스타일과 일관(수락 페이지는 현재 blue 계열 — 기존 페이지 스타일을 따르되 신규 모임 상세 UI 는 오렌지). login/onboarding 흐름 토큰을 모임 상세 UI 에 복사하지 않는다.

---

## 6. 리스크 (Risks)

| 리스크 | 심각도 | 내용 / 대응 |
|--------|--------|-------------|
| expo-router scheme path 가 라우트로 자동 매핑 안 됨 | HIGH | `moyura://invite/{token}` 가 `app/invite/[token]` 로 자동 해석 안 되면 딥링크가 죽는다. 파일 기반 자동 링크 + (필요 시) 루트 `_layout` linking prefixes/screens 명시. 디바이스 검증(`simctl openurl`)으로 scheme→라우트 실제 확인 — device-gated 핵심. |
| invite 라우트가 인증 가드 상속해 게스트 차단 | HIGH | invite 는 공개 랜딩(미인증 게스트 진입)이라 `(tabs)`/`(auth)` 가드를 상속하면 안 된다. 최상위 `app/invite/` 트리(그룹 밖)에 두어 가드 미상속. WebView 안에서 익명 로그인이 수락을 처리. tsc + 디바이스로 게스트 진입 확인. |
| WebView origin 잠금이 invite URL 차단 | MEDIUM | BridgedWebView 의 `originWhitelist`(WEB_URL origin)가 `${WEB_URL}/invite/{token}` 을 허용해야 한다 — 동일 origin 이므로 통과(확인). origin 이 다르면 deny. 디바이스로 WebView 가 수락 페이지를 로드하는지 확인. |
| 비-owner 가 토큰 노출 | HIGH | 발급/목록이 owner 전용(백엔드 403)이고 생성 UI 가 owner-gated. UI 숨김 + 백엔드 403 이중 방어 — UI 우회해도 백엔드가 최종 차단. owner 판정(session.user.id == owner 멤버)을 코드로 정확히(role==='owner' 또는 moim.createdBy 확인). |
| 로드 시 자동 scheme 발화의 부작용 | MEDIUM | v0.4.0: 모바일 로드 시 1회 자동 발화. 앱 셸(`window.ReactNativeWebView`) 안에서는 자동 발화 제외(재진입 루프 방지) + `useRef` 가드로 1회만 + 웹 폼 폴백 항상 유지로 회피. 잔여: 앱 미설치 시 iOS 시스템 "열기?" 확인이 1회 뜰 수 있음(커스텀 scheme 한계 — 웹 폼은 보존, 수용). 데스크톱 자동 발화/버튼 미노출. |
| 모바일 브라우저 감지 오판 | LOW | UA 기반 모바일 감지가 데스크톱에 버튼을 노출하거나 모바일에 숨길 수 있다. best-effort 감지 + scheme 실패해도 웹 폴백 동작(crash 없음) — 오판이 기능을 깨지 않음. |
| 백엔드 무변경 가정 위반 | MEDIUM | 생성 헬퍼가 백엔드에 없는 필드를 요구하면 백엔드 변경 유혹. CreateInviteDto(expiresAt?/maxUses?) + InviteResponseDto(token) 가 MVP 에 충분함을 확인 — 변경 0 기대. 갭 발견 시 그 한 항목만 기록(REQ-MOIM11-001). |
| 토큰 새 채널 노출 | MEDIUM | 복사/딥링크/로그에서 토큰이 query/분석/콘솔로 샐 위험. 토큰은 URL path 에만, Bearer 헤더로만 인증 — 로그/query 비노출(R-A9). 코드 리뷰 + 오류 일반화. |
| 기존 수락 흐름 회귀 | MEDIUM | "앱에서 열기" 버튼 추가가 닉네임 폼/익명 로그인/submitAccept/리다이렉트를 깨면 수락 회귀. 버튼은 순수 추가 — 기존 폼/제출 경로 무변경 확인(web build + 브라우저 + 디바이스 WebView 수락). |
| 모바일 셸 회귀(invite 라우트 추가) | MEDIUM | 신규 라우트/linking 이 `(tabs)`/`(auth)`/detail-push/OAuth 딥링크/route-map-core 를 깨면 인증·탭 회귀. invite 는 그룹 밖 순수 추가 + 기존 매핑 무변경 확인. mobile vitest(route-map-core 회귀 0) + tsc + expo export + 디바이스. |
| 디자인 토큰 혼선(blue vs orange) | LOW | 초대 생성 UI 에 login/onboarding blue 복사 위험. REQ-MOIM11-003 로 모임 상세 오렌지 강제, 코드 리뷰. 수락 페이지 버튼은 기존 페이지 스타일 일관. |

---

## 7. 검증 게이트 (Quality Gate)

> 웹 앱에는 테스트 하니스가 없다 — 웹 검증은 build/lint/tsc + 추론 + 데스크톱 브라우저 워크스루 + 라이브 iOS 시뮬레이터 확인으로 수행하며 웹 자동 테스트는 작성하지 않는다(프로젝트 메모리 `web-no-test-harness`). 백엔드는 무변경(기존 invite jest 회귀 보존). 모바일은 본 SPEC 에서 **변경됨**(신규 invite 라우트 + linking) — tsc/vitest/expo export 적용.

- **백엔드 무변경** — 본 SPEC 은 `apps/backend/src/invite/**`(및 다른 백엔드)를 변경하지 않는다. 기존 invite jest(발급 owner 전용/목록/폐기/수락 404·410·409·400·멱등·동시성)가 그대로 GREEN 이어야 한다(회귀 — 신규 백엔드 테스트 없음). 발급/수락 4개 라우트 전부 존재 확인.
- `tsc` 통과 (0 error — web + mobile; 신규 `lib/moim/invites.ts`/`invite-section.tsx`/web 수락 페이지 버튼 + 모바일 `app/invite/[token].tsx`/(필요 시)`_layout` linking 컴파일). 백엔드 tsc 무변경 회귀.
- web lint 통과 (0 error).
- `nx run web:build` 통과 (0 error — owner 전용 "초대하기" Client 섬 + createInvite 헬퍼 + 링크 표시·복사 + 수락 페이지 "앱에서 열기" 버튼 컴파일).
- mobile tsc / vitest / `expo export` 통과 — **모바일 변경됨**: 신규 `app/invite/[token]` 라우트 + (필요 시) `_layout` linking 이 컴파일되고, route-map-core 등 기존 순수 모듈 vitest 회귀 0(invite 라우트 추가가 기존 매핑/디스패치 테스트를 깨지 않음). `expo export` 가 신규 라우트를 포함해 0 error.
- **디바이스 종단 검증**: 본 SPEC 은 자동 게이트 통과만으로 완료되지 않는다(프로젝트 메모리 `mobile-spec-device-gated`). iOS 시뮬레이터(또는 실 기기) dev build 에서: (1) 모임 상세 owner 로 진입 → "초대하기" → 발급 → 링크 표시 + 복사 동작, 비-owner 는 버튼 미노출; (2) `xcrun simctl openurl booted moyura://invite/{token}`(또는 모바일 브라우저에서 "앱에서 열기" 클릭) → 앱이 `app/invite/[token]` 라우트로 열리고 WebView 가 `${WEB_URL}/invite/{token}` 수락 페이지를 로드 → 닉네임 입력 → 수락 → `/moims/:id/chat`; (3) 앱 미설치(또는 데스크톱)에서는 scheme no-op + 웹 닉네임 폼 폴백; (4) 기존 OAuth 딥링크(`moyura://auth-callback`)·탭·detail-push 회귀 0 확인 — 이 라이브 검증이 통과해야 status 가 `completed` 로 전환된다. 그 전까지 status 는 `in-progress`.
- 상세 수용 기준은 `acceptance.md` 참조.
