# SPEC-MOIM-011 구현 계획 (Plan)

> SPEC-MOIM-011: 초대 링크 생성 UI + 딥링크 (invite-create UI + moyura://invite 딥링크)
> 본 계획은 파일별 작업 단위(milestone)와 기술 접근을 정의한다. 시간 추정은 사용하지 않으며 우선순위·순서로 표현한다.

## 1. 기술 접근 (Technical Approach)

- **방법론**: 기존 도메인 확장(brownfield). 초대 백엔드(SPEC-INVITE)는 **완전 구축**돼 있어 재사용만 한다(백엔드 무변경) — 본 SPEC 은 (1) 웹 초대 생성 UI(owner 전용, 모임 상세 안 in-WebView 렌더) (2) 모바일 딥링크 라우트(`moyura://invite/{token}` → expo-router 라우트 → WebView 수락 페이지 호스팅) (3) 웹 수락 페이지 "앱에서 열기" 버튼(모바일 한정) 세 가지를 더한다. 웹은 테스트 하니스 부재 → build/lint/tsc + 데스크톱 브라우저 워크스루 + 라이브 검증. 모바일은 신규 라우트가 있어 vitest/tsc/expo export 적용.
- **데이터 흐름(순서 의존)**: (1) 백엔드 무변경 확인(발급/수락 4개 라우트 존재) → (2) web 발급 헬퍼(`lib/moim/invites.ts` — polls.ts 미러) → (3) web 초대 생성 Client 섬(`invite-section.tsx`) + 모임 상세 page.tsx owner 판정·prop 전달 → (4) web 수락 페이지 "앱에서 열기" 버튼(모바일 감지) → (5) 모바일 딥링크 라우트(`app/invite/[token].tsx` + 필요 시 `_layout` linking). 웹 생성/수락은 백엔드 무변경이라 schema 재생성 없이 곧장 구현 가능하다.
- **백엔드 무변경(핵심)**: 발급(`POST /moims/:moimId/invites`, owner 전용)·목록·폐기·수락(`POST /invites/:token/accept`)이 모두 verified 존재한다(REQ-INV). 본 SPEC 은 `apps/backend/src/invite/**` 를 한 줄도 바꾸지 않고 호출만 한다. MVP 생성은 CreateInviteDto body 를 비워 백엔드 기본값(+7d/무제한)을 쓴다.
- **딥링크 = 커스텀 scheme(확정)**: `moyura://invite/{token}`(Universal Links 아님). app.json scheme "moyura" 가 이미 설정됐고(`moyura://auth-callback` 선례), expo-router 파일 기반 라우트(`app/invite/[token]`)가 scheme path 를 자동 해석한다. 자동 해석이 안 되면 루트 `_layout` linking prefixes/screens 명시. Universal Links(associatedDomains)는 제외(§4 — localhost 불가).
- **웹→앱 핸드오프 = "앱에서 열기" 버튼(확정)**: 자동 리다이렉트 없음. 모바일 브라우저에서만 버튼 노출 → 클릭 시 `window.location = moyura://invite/{token}`. 앱 미설치면 no-op + 웹 닉네임 폼 폴백. 데스크톱 버튼 미노출.
- **하이브리드 아키텍처**: 초대 생성 UI 는 웹(모임 상세 안 in-WebView). 딥링크 라우트만 모바일 네이티브 추가(그것도 WebView 호스팅) — 별도 네이티브 생성 화면 없음. MOIM-003 detail-in-WebView 패턴 미러.
- **owner 게이트 + 토큰 노출**: 발급/목록이 owner 전용(백엔드 403, REQ-INV-004 — 토큰은 가입 자격증명). 생성 UI 는 owner-gated(UI 숨김 = defense-in-depth, 권위 출처는 백엔드). "앱에서 열기"·딥링크는 이미 URL 에 있는 토큰을 scheme 으로 그대로 넘김(새 노출 0).
- **모바일 셸/route-map 보존**: 기존 `(tabs)`/`(auth)`/`index`/`(tabs)/home/[id]`·BridgedWebView·route-map-core·OAuth 딥링크·originWhitelist 무변경. invite 라우트는 그룹 밖 순수 추가.
- **디자인 시스템**: 초대 생성 UI 는 Meetup 오렌지(`(main)/home/[id]` 토큰). 수락 페이지 버튼은 기존 페이지 스타일 일관. login/onboarding blue 미사용(모임 상세 UI).

## 2. 데이터 / 라우트 모델 — 변경 없음(백엔드) + 신규 라우트(모바일)

- **백엔드 스키마/DTO/라우트**: **무변경.** MoimInvite 테이블·CreateInviteDto(expiresAt?/maxUses?)·InviteResponseDto(token 등)·4개 라우트 그대로. 마이그레이션 없음.
- **api-client**: schema 재생성 **불필요**(백엔드 OpenAPI 무변경). 웹은 invite 응답을 로컬 미러 타입(`InviteResult`)으로 둔다(`PollWithResults` 미러 선례). 웹이 api-client 의 기존 invite 타입을 import 한다면 그 타입은 이미 생성돼 있어 추가 작업 없음.
- **웹 라우트**: 기존 `/invite/[token]`(수락) 보존 + 모임 상세 `(main)/home/[id]` 에 owner 전용 초대 생성 UI 추가. 신규 라우트 없음(섬 컴포넌트 추가).
- **모바일 라우트**: 신규 `app/invite/[token]`(공개 랜딩, 그룹 밖 — 가드 미상속) + 필요 시 `app/invite/_layout`. `moyura://invite/{token}` → 이 라우트. WebView 가 `${WEB_URL}/invite/{token}` 호스팅.

## 3. 마일스톤 (파일별 작업 단위)

순서는 데이터 흐름 의존성을 따른다(M1 → M5). 우선순위는 모두 본 SPEC 완료에 필수(High).

### M1 — 백엔드 무변경 확인 (Priority: High)

- `apps/backend/src/invite/**` (NO CHANGE — 확인만):
  - 발급(`POST /moims/:moimId/invites`, owner 전용 201)·목록·폐기·수락(`POST /invites/:token/accept`, 404/410/409/400) 4개 라우트 존재 확인.
  - `CreateInviteDto`(expiresAt?/maxUses? 선택) + `InviteResponseDto`(token) 가 MVP 발급 UI 에 충분한지 확인 — body 비움 → 백엔드 기본값(+7d/무제한).
  - 기존 invite jest(`invite.service.spec.ts`/`invite.integration.spec.ts`)가 GREEN 인지 확인(회귀 기준선).
- 게이트: backend 무변경, 기존 invite jest GREEN. (갭 발견 시 그 한 항목만 기록 — 기대: 변경 0.)

### M2 — web 초대 발급 헬퍼 (Priority: High)

- `apps/web/lib/moim/invites.ts` (ADD):
  - `createInvite(api: ApiClient, moimId: string, body?: { expiresAt?: string; maxUses?: number }): Promise<InviteResult>` — `lib/moim/polls.ts` 미러: `const path = ` + 백틱`/moims/${encodeURIComponent(moimId)}/invites`백틱 → `api.request(path as never, "post", { headers: {"Content-Type":"application/json"}, body: JSON.stringify(body ?? {}) })`. MVP 는 body 비움(백엔드 기본값).
  - `InviteResult` 로컬 미러 타입(`{ id; moimId; token; expiresAt; maxUses; usedCount; revokedAt; createdAt }` 또는 token 중심 최소 — InviteResponseDto 미러).
  - (선택) `buildInviteLink(origin, token)` 헬퍼 — `${origin}/invite/${encodeURIComponent(token)}` 조립(또는 호출부에서 조립).
  - @MX:NOTE — path-param 발급 라우트의 구체-경로 헬퍼(polls.ts 미러, api-client 편의 메서드 아님). 토큰은 Bearer 헤더로만 인증.
- 게이트: web tsc 0. polls.ts/api.ts 무변경.

### M3 — web 초대 생성 UI(owner 전용 Client 섬) + 모임 상세 prop (Priority: High, depends: M2)

- `apps/web/app/(main)/home/[id]/invite-section.tsx` (ADD, Client 섬):
  - props: `isOwner`/`moimId`/`accessToken`(또는 Server Action 핸들 — poll-actions 미러). 직렬화 plain object 만.
  - `isOwner === false` → null 렌더(어포던스 미노출 — 방어적).
  - owner: "초대하기" 버튼 → 발급(Server Action 권장 — 토큰을 서버 경계에서 다루고 표시용만 섬으로 / 또는 client accessToken 직접 호출) → 응답 token 으로 링크 `{origin}/invite/{token}` 상태 보관 → 표시.
  - 복사 버튼 → `navigator.clipboard.writeText(link)` → `copied` 상태 "복사됨" 피드백. clipboard 미가용 폴백(텍스트 선택 가능).
  - 발급 오류(403/404/네트워크) → 일반화 메시지(토큰/상세 비노출) + 재시도.
  - Meetup 오렌지(`bg-primary`/`text-primary-foreground`/`border-border`/`bg-card`/`text-muted-foreground`).
- (선택) `apps/web/app/(main)/home/[id]/invite-actions.ts` (ADD, Server Action — poll-actions.ts 미러) — 세션 → createInvite → token 반환. 권장(토큰 서버 경계 처리).
- `apps/web/app/(main)/home/[id]/page.tsx` (MODIFY):
  - owner 판정: `const isOwner = members.some(m => m.userId === session.user.id && m.role === 'owner')`(또는 `moim.createdBy === session.user.id` — 코드로 확인해 정확한 출처 사용). members/createdBy 는 이미 fetch 됨.
  - `<InviteSection isOwner={isOwner} moimId={moim.id} accessToken={session.access_token} />` 를 적절한 위치(멤버 목록 근처 또는 헤더 액션)에 렌더. 기존 섹션 무변경.
- 게이트: web tsc 0, web lint 0, web build 0(초대 생성 섬 + 헬퍼 컴파일). 데스크톱 브라우저: owner 만 버튼·발급·복사 동작, 비-owner 미노출.

### M4 — web 수락 페이지 "앱에서 열기" 버튼(모바일 한정) (Priority: High)

- `apps/web/app/invite/[token]/page.tsx` (MODIFY):
  - 모바일 브라우저 감지(UA 또는 동등) → 모바일이면 "앱에서 열기" 버튼 노출(데스크톱 미노출).
  - 클릭 핸들러: `window.location.href = ` + 백틱`moyura://invite/${encodeURIComponent(token)}`백틱(현재 path 의 token).
  - 기존 닉네임 폼·익명 로그인·submitAccept·`/moims/:id/chat` 리다이렉트·오류 처리 **보존**(순수 추가) — 버튼은 폼 위/아래 보조 액션, 자동 리다이렉트 없음.
  - scheme 발화 실패해도 crash 없이 웹 폼 유지(best-effort).
- 게이트: web tsc 0, web lint 0, web build 0. 데스크톱 브라우저: 버튼 미노출 + 기존 수락 폼 동작. (모바일 브라우저 버튼·scheme 발화는 디바이스.)

### M5 — 모바일 딥링크 라우트 + linking (Priority: High, depends: M4)

- `apps/mobile/app/invite/[token].tsx` (ADD, 네이티브 화면 — `(tabs)/home/[id].tsx` 미러):
  - `useLocalSearchParams<{ token: string | string[] }>` → token 단일 문자열 정규화(방어적, 배열 폴백).
  - `const sourceUri = ` + 백틱`${WEB_URL}/invite/${encodeURIComponent(token)}`백틱(WEB_URL = web-url.ts) — 또는 web-url 패턴 헬퍼.
  - `<BridgedWebView sourceUri={sourceUri} routeContext={...} />` — invite 는 `(tabs)`/`(auth)` 밖 공개 랜딩이라 routeContext 를 적절히(인증 무관; WebView 안에서 익명 로그인/수락). 빈/malformed token 은 web 수락 페이지가 안전 처리(네이티브 throw 없음).
- `apps/mobile/app/invite/_layout.tsx` (ADD, 필요 시 — `(tabs)/home/_layout.tsx` 미러):
  - `<Stack screenOptions={{ headerShown: false }} />`(BridgedWebView 풀스크린).
- `apps/mobile/app/_layout.tsx` (MODIFY, 필요 시):
  - 파일 기반 라우트는 자동 링크되나, `moyura://invite/{token}` scheme path 해석이 자동이 아니면 linking config(prefixes `moyura://` + screens `invite/[token]` 매핑) 명시. 기존 `(auth)`/`(tabs)`/`index` Stack·AuthProvider·Google Sign-In 보존. `<Stack.Screen name="invite" />` 등록(필요 시).
- 게이트: mobile tsc 0, mobile vitest 회귀 0(route-map-core 등 기존 순수 모듈 — invite 라우트 추가가 매핑/디스패치 테스트 안 깸), `expo export` 0(신규 라우트 포함). 디바이스: `simctl openurl moyura://invite/{token}` → 앱이 invite 라우트로 열려 WebView 가 수락 페이지 로드.

## 4. 구현 단계 검증 체크포인트

다음을 구현 시점에 점검하며 진행한다(요구사항 충족 확인용):

- [ ] 백엔드가 무변경인가(발급/목록/폐기/수락 4개 라우트 존재, invite jest GREEN)? CreateInviteDto(expiresAt?/maxUses?)+InviteResponseDto(token)가 MVP 발급에 충분(body 비움 → +7d/무제한)인가?
- [ ] `createInvite(api, moimId, body?)` 가 polls.ts 구체-경로 패턴(`/moims/:moimId/invites` 인코딩 → `api.request(path as never, "post")`)을 미러하고, 토큰을 Bearer 헤더로만 인증하는가? schema 재생성 없이 로컬 미러 타입(`InviteResult`)으로 충분한가?
- [ ] 초대 생성 UI 가 owner 에게만 노출되고(현재 user.id == owner 멤버 또는 moim.createdBy — 코드 확인), 비-owner 는 미노출이며, 백엔드 403 이 최종 방어선인가?
- [ ] "초대하기" → 발급 → 링크 `{origin}/invite/{token}` 표시 → 복사(navigator.clipboard) → "복사됨" 피드백이 동작하고, 발급 오류가 일반화(토큰/상세 비노출)되는가? Meetup 오렌지인가?
- [ ] 수락 페이지 "앱에서 열기" 버튼이 모바일 브라우저에서만 노출되고(데스크톱 미노출), 클릭 시 `window.location = moyura://invite/{token}`(현재 token)이며, 기존 닉네임 폼/익명 로그인/submitAccept/리다이렉트가 회귀 없이 보존되는가? 자동 리다이렉트가 없는가?
- [ ] 모바일 `app/invite/[token]` 라우트가 `${WEB_URL}/invite/{token}` 을 BridgedWebView 로 호스팅(MOIM-003 미러)하고, 공개 랜딩이라 인증 가드를 상속하지 않으며(그룹 밖), 빈/malformed token 을 crash 없이 안전 처리하는가?
- [ ] `moyura://invite/{token}` 가 expo-router 로 `app/invite/[token]` 라우트에 해석되는가(자동 또는 루트 _layout linking)? 기존 `moyura://auth-callback` OAuth 딥링크가 회귀 없이 보존되는가?
- [ ] WebView originWhitelist 가 `${WEB_URL}/invite/{token}`(동일 origin)을 허용하고, 수락이 WebView 안 웹 페이지에 위임되며(네이티브 수락 로직 재구현 없음), 토큰이 새 채널로 노출되지 않는가?
- [ ] 신규 invite 라우트 추가가 `(tabs)`/`(auth)`/`index`/detail-push/route-map-core 매핑을 깨지 않는가(mobile vitest 회귀 0)?
- [ ] web tsc/lint/build 0 + mobile tsc/vitest/expo export 0 + backend 무변경 invite jest GREEN인가?
- [ ] **디바이스**(device-gated): owner 발급·복사, `simctl openurl moyura://invite/{token}` → 앱 invite 라우트 열림 → WebView 수락 → 닉네임 → 가입 → /moims/:id/chat, 미설치/데스크톱 scheme no-op + 웹 폼 폴백, OAuth 딥링크/탭/detail-push 회귀 0 라이브 확인되는가?

## 5. 검증 게이트 (요약)

spec.md §7 참조. 핵심: 백엔드 무변경(발급/수락 4개 라우트 존재 — invite jest 회귀 GREEN) → tsc 0(web + mobile, 신규 헬퍼/섬/수락 버튼/invite 라우트) → web lint 0 → web build 0(초대 생성 + 복사 + 수락 버튼) → mobile vitest 회귀 0(route-map-core 등) + `expo export` 0(신규 라우트) → 디바이스 종단 검증(owner 발급·복사 / `moyura://invite/{token}` 앱 열림 → WebView 수락 / 미설치·데스크톱 폴백 / OAuth·탭·detail-push 회귀 0). web 초대 생성·복사·수락 버튼 렌더는 데스크톱 브라우저로 검증 가능, scheme→앱 열림 + "앱에서 열기" 발화는 iOS 시뮬레이터/기기 전용(device-gated → in-progress).

## 6. 위임/협의 권장

- 모바일 딥링크 라우트(`app/invite/[token]` + expo-router scheme linking)·BridgedWebView 호스팅(MOIM-003 미러)·공개 랜딩 가드 미상속·route-map-core 회귀 보존: expert-frontend(Expo/expo-router) 또는 expert-debug 협의 가능(scheme path 해석·linking config·WebView origin 잠금이 invite URL 허용 확인).
- web 초대 생성 UI(owner 전용 Client 섬·발급 Server Action·navigator.clipboard 복사·Meetup 오렌지)·수락 페이지 "앱에서 열기" 버튼(모바일 감지·scheme 발화·웹 폴백 보존)·`createInvite` 헬퍼(polls.ts 미러): expert-frontend 협의 가능(Next 16 Server Action + Client 섬 경계 + 모바일 감지).
- 백엔드 무변경 확인(발급/수락 계약 재사용·owner 인가·토큰 노출 경계): expert-backend 또는 expert-security 협의 가능(토큰이 새 채널로 안 새는지·owner-gated 이중 방어 검증).
