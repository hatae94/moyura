# SPEC-MOIM-011 수용 기준 (Acceptance Criteria)

> SPEC-MOIM-011: 초대 링크 생성 UI + 딥링크 (invite-create UI + moyura://invite 딥링크)
> 각 AC 는 EARS 요구사항(spec.md §2)에 추적되며 Given-When-Then 시나리오로 검증한다.
> 웹은 테스트 하니스 부재 → build/lint/tsc + 데스크톱 브라우저 + 라이브 iOS 시뮬레이터 확인. 백엔드는 무변경(기존 invite jest 회귀). 모바일은 변경됨 → tsc/vitest/expo export + 디바이스.

## 수용 기준 (AC)

### AC-1: 백엔드 무변경 — 기존 초대 라우트 재사용 (← REQ-MOIM11-001)

발급/목록/폐기/수락 4개 라우트가 모두 존재하므로 본 SPEC 은 백엔드를 변경하지 않고 재사용한다. 기존 invite jest 회귀 보존.

- **Given** 초대 백엔드(`apps/backend/src/invite/**` — 발급 `POST /moims/:moimId/invites` owner 전용 201, 목록 `GET .../invites`, 폐기 `DELETE .../invites/:inviteId`, 수락 `POST /invites/:token/accept` 404/410/409/400 멱등)가 verified 구축돼 있고
- **When** 본 SPEC(초대 생성 UI + 딥링크)을 구현하면
- **Then** `apps/backend/src/invite/**`(controller/service/dto/module)가 한 줄도 바뀌지 않고(코드·DTO·라우트·검증·테스트 무변경), `CreateInviteDto`(expiresAt?/maxUses? 선택)·`InviteResponseDto`(token)가 그대로이며, MVP 생성 UI 는 body 를 비워 백엔드 기본값(+7d 만료/maxUses null=무제한)을 쓰고, 기존 invite jest(발급 owner 전용/목록/폐기/수락 404·410·409·400·멱등·동시성)가 모두 GREEN 으로 회귀 없이 통과한다.
- **And** 만약 구현 중 백엔드 갭이 발견되면 우선 재사용을 시도하고, 변경이 불가피한 한 항목만 별도 기록한다(기대: 변경 0).

### AC-2: 초대 발급 헬퍼 — 구체-경로 호출 (← REQ-MOIM11-002)

신규 `lib/moim/invites.ts` 의 `createInvite(api, moimId, body?)` 가 path-param 발급 라우트를 polls.ts 패턴으로 호출하고 token 을 반환한다. schema 재생성 없음.

- **Given** 초대 발급 라우트(`POST /moims/:moimId/invites`)가 path 파라미터를 가지고
- **When** `createInvite(api, moimId)` 를 호출하면(body 비움)
- **Then** moimId 가 인코딩돼 구체 경로가 조립되고(`lib/moim/polls.ts` 의 createPoll/closePoll 패턴 미러 — `api.request(path as never, "post", { body: JSON.stringify({}) })`), 발급 응답에서 `token`(추측 불가 base64url)을 받아 공유 링크 `{webOrigin}/invite/{token}` 을 조립할 수 있다(토큰은 URL path 에만, Authorization Bearer 헤더로만 인증 전달).
- **And When** 웹이 invite 응답 타입을 다루면 **Then** 로컬 미러(`InviteResult`)로 두거나 api-client 의 기존 invite 타입을 재사용해 tsc 0 이며, 백엔드 OpenAPI 무변경이므로 `schema.d.ts` 재생성이 필요 없다(`PollWithResults` 로컬 미러 선례).

### AC-3: 초대 생성 UI — owner 전용 "초대하기" + 링크 표시·복사 (← REQ-MOIM11-003)

모임 상세에 owner 전용 "초대하기" 어포던스가 있고, 누르면 발급 → 링크 표시 → 복사. 비-owner 미노출. Meetup 오렌지.

- **Given** 인증·이름 보유 멤버가 모임 상세(`/home/{id}`)에 있고
- **When** 현재 사용자(session.user.id)가 그 모임의 owner(멤버 목록의 `role==='owner'` 또는 `moim.createdBy`)이면 **Then** "초대하기" 어포던스가 노출된다.
- **And When** 현재 사용자가 owner 가 아니면 **Then** "초대하기" 어포던스가 노출되지 않는다(방어적 — 백엔드 403 이 권위 출처, UI 숨김은 defense-in-depth).
- **And When** owner 가 "초대하기" 를 누르면 **Then** `createInvite(api, moimId)`(body 비움 → 백엔드 기본값)가 호출되고, 성공 시 응답 token 으로 공유 링크 `{webOrigin}/invite/{token}` 이 화면에 표시된다.
- **And When** owner 가 링크의 복사 버튼을 누르면 **Then** `navigator.clipboard.writeText(link)` 로 클립보드에 복사되고 "복사됨" 류 피드백이 표시된다. clipboard 미가용/거부 시 링크 텍스트가 선택 가능한 상태로 graceful 폴백된다(토큰/오류 상세 비노출).
- **And When** 발급이 백엔드 오류(403 비-owner/404 미존재/네트워크)를 반환하면 **Then** 화면에 머무르며 일반화된 오류를 표시하고(토큰/상세 비노출) 재시도할 수 있다.
- **And** "초대하기" 버튼·링크 표시·복사 버튼·피드백이 모두 Meetup 오렌지 토큰을 쓴다(login/onboarding blue 아님).

### AC-4: 모바일 딥링크 라우트 — moyura://invite/{token} → WebView 수락 (← REQ-MOIM11-004)

신규 expo-router 라우트 `app/invite/[token]` 가 `${WEB_URL}/invite/{token}` 을 BridgedWebView 로 호스팅하고, `moyura://invite/{token}` 가 이 라우트로 해석된다. 수락은 WebView 위임.

- **Given** 모바일 앱에 신규 라우트 `apps/mobile/app/invite/[token]` 가 추가돼 있고
- **When** OS 가 `moyura://invite/{token}` 딥링크를 앱으로 전달하면 **Then** expo-router 의 scheme 링킹(app.json scheme "moyura" — auth-callback 과 동일 scheme)이 이를 `app/invite/[token]` 라우트로 해석해 그 화면을 띄운다(파일 기반 자동 링크 또는 루트 _layout linking).
- **And When** 그 화면이 렌더되면 **Then** `useLocalSearchParams` 로 token 을 읽어 `${EXPO_PUBLIC_WEB_URL}/invite/${encodeURIComponent(token)}` 을 조립하고 `BridgedWebView` 로 호스팅한다(MOIM-003 `(tabs)/home/[id]` detail-in-WebView 패턴 미러) — token 은 path 세그먼트에만 유지(query/헤더로 옮기지 않음).
- **And When** WebView 가 수락 페이지를 로드하면 **Then** 실제 수락(닉네임 → `POST /invites/:token/accept`)은 WebView 안 웹 페이지가 수행한다 — 네이티브는 URL 을 WebView 로 띄우는 역할만, 수락 로직/토큰 검증/실패 코드를 재구현하지 않는다.
- **And When** 딥링크 token 이 비었거나 malformed 면 **Then** 네이티브는 crash 없이 안전 처리한다(빈 token WebView → 웹 수락 페이지가 404/유효하지 않은 링크 안내 — 기존 web 계약, 네이티브 throw 없음).
- **And** 기존 `moyura://auth-callback`(OAuth)·`(tabs)`/`(auth)` 라우트·WebView originWhitelist·route-map-core 매핑이 그대로 보존된다(invite 라우트 추가가 인증/탭/교차 라우트 회귀를 일으키지 않음).

### AC-5: 웹 수락 페이지 "앱에서 열기" 버튼 — 모바일 한정 (← REQ-MOIM11-005)

수락 페이지에 모바일 브라우저 한정 "앱에서 열기" 버튼이 있어 `moyura://invite/{token}` 을 발화한다. 데스크톱 미노출, 자동 리다이렉트 없음, 웹 폴백 유지.

- **Given** 웹 수락 페이지(`/invite/[token]`)가 모바일 브라우저에서 렌더되면 **Then** "앱에서 열기" 버튼이 닉네임 폼과 함께 노출된다.
- **And Given** 데스크톱 브라우저에서 렌더되면 **Then** "앱에서 열기" 버튼이 노출되지 않는다(웹 수락 폼만).
- **And When** 사용자가 "앱에서 열기" 를 누르면 **Then** `window.location` 이 `moyura://invite/{token}`(현재 path 의 token)으로 설정돼 커스텀 scheme 이 발화된다(새 노출 없음 — 이미 URL 에 있는 토큰 그대로).
- **And When** 앱이 설치돼 있지 않아 scheme 이 no-op 이거나 사용자가 웹을 선호하면 **Then** 기존 닉네임 수락 폼이 웹 폴백으로 유지되고, **자동 리다이렉트는 일어나지 않는다**(scheme 은 버튼 클릭으로만 발화 — 사용자가 웹에서 그대로 가입 가능).
- **And** 기존 수락 흐름(익명 로그인 → 닉네임 → submitAccept → `/moims/:id/chat`, 404/410/409/400 일반화 오류)이 그대로 보존된다("앱에서 열기" 는 순수 추가 — 기존 폼/제출/오류 처리 무파손).
- **And When** 모바일 감지가 불확실하거나 scheme 발화가 실패하면 **Then** crash 없이 웹 수락 폼에 머무른다(버튼은 best-effort, 웹 폴백 항상 동작).

### AC-6: 보안 — 토큰 노출 경계 보존 (← REQ-MOIM11-006)

초대 토큰은 owner 에게만 노출되고, 수락은 인증을 요구하며, 딥링크/버튼은 이미 URL 에 있는 토큰을 새 채널 없이 그대로 넘긴다.

- **Given** 초대 토큰이 가입 자격증명이고
- **When** 비-owner 멤버가 모임 상세를 보면 **Then** "초대하기"·토큰이 노출되지 않는다(발급/목록 owner 전용 백엔드 403 + 생성 UI owner-gated — 이중 방어).
- **And When** 딥링크가 여는 WebView 수락이 백엔드를 호출하면 **Then** `SupabaseAuthGuard`(익명 로그인 sub 포함, 기존 계약)를 통과해야 한다(새 우회 경로 없음).
- **And When** "앱에서 열기"/딥링크가 token 을 전달하면 **Then** 이미 웹 URL path 에 있는 토큰을 scheme URL path 로 그대로 넘기며, 토큰을 새 채널(로그/분석/query/Authorization 추가)로 노출하지 않는다(노출 표면 불변).
- **And When** 발급/복사/딥링크 경로에서 오류가 나면 **Then** 토큰/오류 상세를 사용자 화면/로그에 노출하지 않고 일반화 메시지로 처리한다(R-A9 정신).

### AC-7: 회귀 보존 + 신규 컴파일 (← REQ-MOIM11-007)

기존 모임/투표/인증/수락/모바일 셸 흐름이 보존되고, 신규 invite-create UI·딥링크 라우트가 컴파일된다.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 모임 상세 기존 렌더(이름·일정·장소·멤버·채팅 입장·투표 — MOIM-003~010)가 보존되고 "초대하기" 가 owner 전용 추가 어포던스로만 더해지며, 모바일 기존 트리(`(tabs)`/`(auth)`/`index`/`(tabs)/home/[id]`)·BridgedWebView·route-map-core·OAuth 딥링크·originWhitelist 가 보존되고 `app/invite/[token]` 가 순수 추가되며, 수락 페이지 기존 폼/익명 로그인/submitAccept/리다이렉트가 보존되고 "앱에서 열기" 가 모바일 한정 추가로만 더해진다.
- **And Then** backend invite jest GREEN(무변경) + web tsc/lint/`nx run web:build` 0(신규 헬퍼/섬/수락 버튼) + mobile tsc/vitest 회귀 0(route-map-core 등)/`expo export` 0(신규 라우트) 이다.

### AC-8: 품질 게이트 + 디바이스 종단 검증 (← spec.md §7)

자동 게이트(backend 무변경 invite jest / web tsc·lint·build / mobile tsc·vitest·expo export) + 디바이스 라이브 검증.

- **Given** 모든 변경이 완료된 상태에서
- **When** 검증 게이트를 실행하면
- **Then** 위 모든 자동 게이트가 GREEN 이고, 디바이스 종단 검증(owner 발급·복사 / `moyura://invite/{token}` 앱 열림 → WebView 수락 → 가입 / 미설치·데스크톱 폴백 / OAuth·탭·detail-push 회귀 0)이 통과하면 status 가 completed 로 전환된다.

## 엣지 케이스 (Edge Cases)

- **백엔드 무변경**: 발급/목록/폐기/수락 4개 라우트 전부 존재 → 본 SPEC 백엔드 코드 변경 0, 기존 invite jest 회귀 GREEN. (← REQ-MOIM11-001)
- **MVP 발급 = body 비움**: createInvite body `{}` → 백엔드 기본값(+7d 만료/무제한). expiresAt/maxUses 입력 UI 없음(§4). (← REQ-MOIM11-002)
- **로컬 미러 타입**: 백엔드 OpenAPI 무변경 → schema 재생성 불필요, 웹이 InviteResult 로컬 미러(PollWithResults 선례) 또는 기존 api-client invite 타입 재사용. (← REQ-MOIM11-002)
- **owner 판정**: session.user.id 가 `role==='owner'` 멤버의 userId(또는 moim.createdBy)와 일치 → owner. 비일치 → 비-owner(버튼 미노출). 코드로 정확한 출처 확인. (← REQ-MOIM11-003)
- **비-owner UI 우회**: 비-owner 가 (콘솔 등으로) 발급을 시도해도 백엔드 403 이 최종 차단(UI 숨김은 defense-in-depth, 권위 출처 백엔드). (← REQ-MOIM11-003/006)
- **clipboard 미가용**: navigator.clipboard 미지원/거부 → 링크 텍스트 선택 가능 폴백(crash 없음, "복사됨" 대신 안내). (← REQ-MOIM11-003)
- **발급 오류**: 403/404/네트워크 → 화면 유지 + 일반화 오류(토큰/상세 비노출) + 재시도. (← REQ-MOIM11-003)
- **딥링크 → 라우트 해석**: `moyura://invite/{token}` → `app/invite/[token]`(파일 기반 자동 또는 루트 _layout linking). 해석 안 되면 딥링크 죽음 → 디바이스 검증 필수(device-gated 핵심). (← REQ-MOIM11-004)
- **invite 라우트 = 공개 랜딩**: `(tabs)`/`(auth)` 그룹 밖 최상위 `app/invite/` → 인증 가드 미상속(미인증 게스트 진입 가능, WebView 안 익명 로그인 + 수락). (← REQ-MOIM11-004)
- **빈/malformed token 딥링크**: 네이티브 throw 없이 안전 — 빈 token WebView → 웹 수락 페이지가 404/유효하지 않은 링크 안내(기존 web 계약). (← REQ-MOIM11-004)
- **WebView origin 잠금**: originWhitelist(WEB_URL origin)가 `${WEB_URL}/invite/{token}`(동일 origin) 허용 → 통과. 다른 origin 이면 deny(보안 보존). (← REQ-MOIM11-004)
- **수락 위임**: 네이티브는 URL 을 WebView 로 띄우는 역할만 — 수락 로직/토큰 검증/실패 코드 재구현 없음(WebView 안 웹 페이지 + 백엔드 기존 계약). (← REQ-MOIM11-004)
- **"앱에서 열기" 모바일 한정**: 모바일 브라우저 노출, 데스크톱 미노출. UA 감지 오판해도 scheme 실패 시 웹 폴백 동작(crash 없음). (← REQ-MOIM11-005)
- **자동 리다이렉트 없음**: 페이지 로드 시 scheme 자동 점프 안 함 — 버튼 클릭으로만 발화. 앱 미설치 사용자가 빈 화면/오류를 안 봄(웹 폼 그대로). (← REQ-MOIM11-005)
- **scheme no-op(미설치)**: 앱 미설치 → `moyura://invite/{token}` 무반응 → 사용자는 웹 닉네임 폼으로 가입(폴백). (← REQ-MOIM11-005)
- **기존 수락 흐름 보존**: 익명 로그인 → 닉네임 → submitAccept → /moims/:id/chat, 404/410/409/400 → "앱에서 열기" 순수 추가가 안 깸. (← REQ-MOIM11-005/007)
- **토큰 노출 동등**: 버튼/딥링크가 이미 URL 에 있는 토큰을 scheme 으로 그대로 넘김 — 새 채널(로그/query/분석) 노출 0. (← REQ-MOIM11-006)
- **OAuth 딥링크 회귀**: 신규 invite 라우트가 `moyura://auth-callback` 링킹/탭/detail-push/route-map-core 를 안 깸(mobile vitest 회귀 0 + 디바이스). (← REQ-MOIM11-004/007)
- **Universal Links 제외**: https 자동 열기 없음(associatedDomains 미추가 — localhost 불가, 향후). 커스텀 scheme 만. (← spec §4)
- **Android 제외**: 딥링크·디바이스 검증 iOS 전용(ios-simulator-only). Android intent-filter 범위 밖. (← spec §4)
- **세션 만료 후 발급/수락**: 발급 Server Action 시점 세션 부재 → 기존 가드(/login 리다이렉트). 수락은 익명 로그인이 세션 확보(기존 흐름). (← REQ-MOIM11-003/005)
- **데스크톱 vs 모바일**: 초대 생성 UI 는 데스크톱 일반 렌더 + 모바일 in-WebView(모임 상세). 수락 페이지 "앱에서 열기" 는 모바일만. 딥링크 라우트는 네이티브(WebView 호스팅) — scheme→앱 열림은 iOS 디바이스 전용 검증.

## Definition of Done (DoD)

- [x] 백엔드 무변경 — 발급/목록/폐기/수락 4개 라우트 존재 확인, `apps/backend/src/invite/**` 무변경, 기존 invite jest GREEN(회귀). 갭 없음(변경 0). (AC-1) — **VERIFIED** (feat 2023cb9, 백엔드/마이그레이션 무변경 확인)
- [x] `apps/web/lib/moim/invites.ts` 의 `createInvite(api, moimId, body?)` 가 polls.ts 구체-경로 패턴 미러 + InviteResult 로컬 미러 + 토큰 Bearer 헤더만 + schema 재생성 없음. (AC-2) — **VERIFIED** (web tsc 0, feat 2023cb9)
- [x] 모임 상세 owner 전용 "초대하기"(`invite-button.tsx`) — owner 만 노출(isOwner prop) / 비-owner null 반환 + Server Action(`invite-actions.ts`) 발급 → 링크 `{origin}/invite/{token}` 표시 + `navigator.clipboard` 복사 + "복사됨" 피드백 + 오류 일반화. page.tsx `isOwner = moim.createdBy === session.user.id` 판정·prop 전달. (AC-3) — **VERIFIED** (web tsc/lint/build 0, feat 2023cb9) — ⚠️ **PENDING: 웹 UI 브라우저 워크스루** 미수행(이번 세션 웹 로그인 세션-쿠키 리다이렉트 이슈 — auth/middleware 무변경, signInWithPassword 직접 동작 확인됨, 초대 코드와 무관한 인프라 이슈)
- [x] 수락 페이지(`/invite/[token]`) "앱에서 열기" 버튼 — `useSyncExternalStore` UA 감지로 모바일 한정 노출/데스크톱 미노출 + 클릭 `window.location = moyura://invite/{token}` + 자동 리다이렉트 없음 + 기존 닉네임 폼/익명 로그인/submitAccept/리다이렉트 보존. (AC-5) — **VERIFIED** (web tsc/lint/build 0, feat 2023cb9)
- [x] 모바일 `app/invite/[token].tsx` 라우트 — `${WEB_URL}/invite/${token}` BridgedWebView 호스팅(MOIM-003 detail-in-WebView 패턴 미러) + `(tabs)`·`(auth)` 그룹 밖 공개 랜딩(가드 미상속) + 빈/malformed token 안전(WebView가 웹 수락 페이지에 위임) + 수락 WebView 위임. `app/_layout.tsx` — `<Stack.Screen name="invite/[token]" />` 추가. (AC-4) — **VERIFIED** (mobile tsc/vitest 0, feat 2023cb9)
- [x] `moyura://invite/{token}` → `app/invite/[token]` 해석(expo-router scheme "moyura" 기존 설정 + 파일 기반 라우팅 자동 링크) + 기존 `moyura://auth-callback`/탭/detail-push/originWhitelist/route-map-core 보존. (AC-4/7) — **VERIFIED** (mobile tsc/vitest 회귀 0, feat 2023cb9) — ⚠️ **PENDING: 딥링크 앱 열림 + "앱에서 열기" 발화** device-gated(iOS 시뮬레이터 검증 필요)
- [x] 보안 — 토큰 owner 한정(isOwner 판정 + 백엔드 403 이중 방어) + 수락 SupabaseAuthGuard + 토큰 새 채널 노출 0 + 오류 일반화. (AC-6) — **VERIFIED** (코드 리뷰 + tsc, feat 2023cb9)
- [x] web tsc 0 / web lint 0 / `nx run web:build` 0(invite-button.tsx + invite-actions.ts + lib/moim/invites.ts + 수락 페이지 "앱에서 열기" 버튼). (AC-7/8) — **VERIFIED** (feat 2023cb9)
- [x] mobile tsc 0 / vitest 회귀 0(route-map-core 등) / `expo export` 0(신규 invite 라우트). (AC-7/8) — **VERIFIED** (feat 2023cb9)
- [x] backend invite jest GREEN(무변경 회귀). (AC-1/7/8) — **VERIFIED** (feat 2023cb9, 백엔드 무변경)
- [ ] 디바이스 종단 검증: (1) iOS 시뮬레이터 owner 모임 상세 → "초대하기" → 발급 → 링크 표시 + 복사, 비-owner 미노출(웹 브라우저 워크스루 + iOS 시뮬레이터); (2) `xcrun simctl openurl booted moyura://invite/{token}`(또는 모바일 브라우저 "앱에서 열기") → 앱이 `app/invite/[token]` 라우트로 열려 WebView 가 `${WEB_URL}/invite/{token}` 수락 페이지 로드 → 닉네임 → 수락 → `/moims/:id/chat`; (3) 미설치/데스크톱 scheme no-op + 웹 닉네임 폼 폴백; (4) OAuth 딥링크(`moyura://auth-callback`)·탭·detail-push 회귀 0 라이브 확인. — **PENDING** (iOS 시뮬레이터 딥링크 + "앱에서 열기" 발화 검증 대기 + 웹 invite-create UI 워크스루 대기) (AC-8)

---

> 디바이스 검증 전까지 status `in-progress` 유지(프로젝트 메모리 `mobile-spec-device-gated`, `ios-simulator-only`). 웹 초대 생성·복사·수락 페이지 버튼 렌더는 데스크톱 브라우저 워크스루로 선검증 가능.

---

## 웹 검증 완료 갱신 (2026-06-22, 백엔드 복구 후)

이전 sync 시 "웹 세션-쿠키 바운스"로 보류했던 invite-create UI 워크스루를 **완료**했다. 바운스의 근본 원인은
expert-debug 진단 결과 **백엔드(:3001) 다운**(nest watch 좀비 — `/home` 가드의 `GET /me` 실패 → fail-closed
/login 바운스)이었고, 백엔드 재기동으로 해소됨(auth/쿠키 코드는 master와 동일, 무관). 재검증 결과:

- [x] owner(앨리스) 모임 상세에 "초대하기" 노출 → 클릭 → 발급된 링크(`http://localhost:3000/invite/{token}`) 표시
- [x] "링크 복사" → 클립보드 복사 + "복사됨" 피드백
- [x] 수락 페이지(`/invite/{token}`) 데스크톱 렌더 — "앱에서 열기" 버튼 **미노출**(모바일 감지 게이트 정상), 닉네임 폼만 표시
- [x] 발급 토큰으로 게스트 가입 동작(멤버 "앱 게스트" 추가 확인 — 멤버 3명)

**잔여(여전히 in-progress 근거)**: `moyura://invite/{token}` 딥링크 → 앱 열림 + 모바일 수락 페이지의 "앱에서 열기"
버튼 발화는 iOS 시뮬레이터 검증 필요(device-gated, 런북 §5).
