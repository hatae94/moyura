# SPEC-MOBILE-NATIVE-UI-001 — Acceptance Criteria

> 각 AC 는 spec.md 의 EARS 요구사항과 1:1 대응한다(R-N1~N22 ↔ AC-N1~N22). 패리티는 **데이터·동작 패리티**(픽셀 아님 — OD-6)로 판정한다.
>
> 검증 채널:
> - **AUTO**: `apps/mobile` + `apps/web` + 공유 패키지 typecheck 0 / `expo export` 번들 OK / `apps/web` `next build` OK / import-그래프 negative 게이트(no-duplication, WebView 의존 부재) / 공유 단일-출처 grep.
> - **DEVICE-GATED**(iOS 시뮬레이터 전용 + 일부 실기기): 화면 렌더 패리티 종단, Google OAuth 네이티브 왕복, 실시간 라이브 갱신(RLS 인가), FCM 푸시. moyura 디바이스 게이팅 정책 — 자동 게이트만으로는 완료 아님.
>
> 참고: `apps/web` 은 테스트 하베스가 없으므로 웹 회귀는 `next build`/typecheck/import 그래프로 1차 검증, 종단은 수동(OD-4).

---

## M1. 네이티브 셸 + 네이티브 인증

### AC-N1 ↔ R-N1 (WebView 호스트 제거 — 네이티브 화면)
- **Given** 현재 모바일이 각 라우트를 `${WEB_URL}/{route}` WebView 로 호스팅함
- **When** 화면들을 네이티브 RN 화면(expo-router)으로 재구축한다
- **Then** 모든 사용자 화면이 네이티브로 렌더되고, 공유 `@moyura/api-client`(+ 공유 도메인 패키지)를 직접 호출하며, 어떤 사용자 화면도 `react-native-webview` 인스턴스를 마운트하지 않는다.
- AUTO: `app/` 내 사용자 화면 코드에 `WebView`/`BridgedWebView`/`WebViewShell` import 부재(import 그래프), typecheck 0, `expo export` OK. 화면 렌더는 DEVICE-GATED.

### AC-N2 ↔ R-N2 (네이티브 세션 토큰 주입)
- **Given** 보호 API 호출(`getMe`/`listMoims` 등)
- **When** 네이티브 화면이 인증 호출을 발행한다
- **Then** `@moyura/api-client` `getToken` 공급자가 **네이티브 Supabase 세션** access_token 을 반환해 Authorization Bearer 로 주입되며(URL/query 비탑재), WebView 쿠키/핸드셰이크 세션을 사용하지 않는다.
- AUTO: `getToken` 배선이 네이티브 세션(AuthContext/supabase-mobile)에서 토큰을 읽음(코드 경로 + typecheck 0), `bridge-protocol`/`session:restore` 비참조. 실제 401/200 동작은 DEVICE-GATED.

### AC-N3 ↔ R-N3 (네이티브 로그인 화면)
- **Given** 미인증 사용자
- **When** 로그인 화면을 연다
- **Then** 네이티브 로그인 화면이 Google OAuth(`oauth.ts`/`google-signin.ts` → `supabase-mobile.ts` `signInWithIdToken`) + 이메일 로그인을 제공하고, 성공 시 네이티브 Supabase 세션이 수립된다 — WebView 로그인 페이지 비호스팅.
- AUTO: 로그인 화면이 네이티브 컴포넌트 + 기존 OAuth 모듈 호출(import 그래프), typecheck 0. Google OAuth 네이티브 왕복은 DEVICE-GATED(실 자격증명 + idToken audience 정합 — 기존 mobile-google-idtoken-audience 사안 참조).

### AC-N4 ↔ R-N4 (AuthContext = 단일 세션 권위)
- **Given** 네이티브 세션 존재
- **When** 보호 화면/realtime/`getToken` 이 세션을 참조한다
- **Then** `AuthContext` 가 단일 세션 권위로 동작하고, WebView 토큰 주입 브리지(`session:restore`)가 네이티브 화면의 세션 출처가 아니다.
- AUTO: 네이티브 화면/realtime/`getToken` 의 세션 출처가 `AuthContext`(코드 경로), `useAuthBridge` `session:restore` 가 네이티브 세션 공급에 미관여(import 그래프), typecheck 0.

### AC-N5 ↔ R-N5 (네이티브 이름 온보딩 가드)
- **Given** 이름 없는 인증 세션(`GET /me` `name == null`)
- **When** 보호 화면 진입을 시도한다
- **Then** 네이티브 온보딩 화면으로 가드되고(웹 `requireNamedSession` 동작 재현), 이름은 공유 `patchMe` 로 영속된다.
- AUTO: 가드 판정 로직이 공유 출처(또는 공유 규칙) 사용 + 온보딩 화면 존재 + `patchMe` 호출(import 그래프), typecheck 0. 종단 가드 동작은 DEVICE-GATED.

### AC-N6 ↔ R-N6 (미인증 보호 화면 차단 — Unwanted)
- **Given** 세션 없는 보호 화면 접근
- **When** 화면이 마운트된다
- **Then** 네이티브 로그인으로 라우팅되고 보호 콘텐츠가 렌더되지 않는다(미인증 데이터 누출 0).
- AUTO: 보호 화면이 세션 가드를 거침(코드 경로), typecheck 0. 종단 차단은 DEVICE-GATED.

---

## M2. 모임 목록 + 상세 + 생성 + 탐색

### AC-N7 ↔ R-N7 (홈 목록 렌더 패리티)
- **Given** 웹 `home` 의 모임 목록 동작
- **When** 홈 탭이 포커스되어 `listMoims()` 로 목록을 가져온다
- **Then** 동일 백엔드 응답에 대해 웹과 같은 DTO 필드(name/일정/멤버 맥락)를 노출하고, 빈 목록/로딩/에러 상태를 웹과 동일하게 처리한다.
- AUTO: 홈 화면이 공유 `listMoims()` 호출 + 상태 분기 존재(코드 경로), typecheck 0. **패리티 종단(같은 응답 → 같은 필드)은 DEVICE-GATED**(시뮬레이터 + 로컬 테스트 계정 owner-test@moyura.dev).

### AC-N8 ↔ R-N8 (모임 상세 렌더 패리티)
- **Given** 웹 `home/[id]`(detail + members + polls + invite)
- **When** 모임을 연다
- **Then** **공유** moim 도메인 로직(`getMoim`/`getMoimMembers`/`formatMoimSchedule`)으로 상세·멤버·투표·초대 affordance 를 네이티브로 렌더하고, 일정 표시가 `formatMoimSchedule`(null → "일정 미정") 거동과 동일하다.
- AUTO: 상세 화면이 **공유 패키지**(`@moyura/domain` 등)에서 moim 로직 import(import 그래프 — mobile-local 포크 부재), typecheck 0. 렌더 패리티는 DEVICE-GATED.

### AC-N9 ↔ R-N9 (모임 생성)
- **Given** 모임 생성 폼
- **When** `createMoim()` 으로 제출한다
- **Then** name/nickname 필수 + startsAt/location optional 로 생성되고, 400(ApiError)을 웹과 동일하게 분류·표시한다.
- AUTO: 생성 화면이 공유 `createMoim()` 호출 + 에러 분기(코드 경로), typecheck 0. 종단은 DEVICE-GATED.

### AC-N10 ↔ R-N10 (탐색 — 초대 링크 참여 진입)
- **Given** 웹 `explore`(초대 링크로 참여)
- **When** 탐색 탭을 사용한다
- **Then** 네이티브 "초대 링크/토큰으로 참여" 진입점이 토큰 입력 → 초대 수락 흐름(AC-N18)으로 연결되며 웹 동작과 동등하다.
- AUTO: 탐색 화면이 토큰 입력 → 초대 수락 경로 연결(코드 경로), typecheck 0. 종단은 DEVICE-GATED.

### AC-N11 ↔ R-N11 (상세 에러 안전 처리 — Unwanted)
- **Given** 모임 상세 조회 실패
- **When** 에러가 발생한다
- **Then** **공유** `moimErrorStatus` 로 403(비멤버)/404(미존재)를 분류하고 토큰/오류 내부를 노출하지 않는다(인가 약화 금지 — 웹 동등).
- AUTO: 상세 화면이 공유 `moimErrorStatus` 사용 + status 분기(코드 경로), 토큰/오류 상세 로깅 부재, typecheck 0.

---

## M3. 네이티브 실시간 섹션

### AC-N12 ↔ R-N12 (네이티브 채널 구독 — 공유 디스크립터)
- **Given** 라이브 데이터 화면 + 네이티브 세션 access_token
- **When** 화면이 마운트된다
- **Then** 네이티브 `@supabase/supabase-js` 클라이언트로 `realtime.setAuth(access_token)` 후 **공유 채널 디스크립터**(topic `moim:{id}`, event, payload 타입)를 사용해 구독한다(웹과 동일 토픽/이벤트).
- AUTO: 네이티브 realtime 코드가 공유 디스크립터 import(import 그래프) + 네이티브 supabase 클라이언트 사용, typecheck 0. 실제 구독/RLS 인가는 **DEVICE-GATED**(OD-3 — 네이티브 토큰이 web 쿠키 세션과 다른 출처라 RLS 인가 확인 필수).

### AC-N13 ↔ R-N13 (4채널 라이브 갱신 패리티)
- **Given** 웹 훅(member/poll/chat/expense)의 라이브 갱신 동작
- **When** 각 채널에서 이벤트가 수신된다
- **Then** `member_change`(목록 갱신)·poll 이벤트(집계 갱신)·chat(메시지 append)·expense(`expense_change` 정산 갱신)가 웹과 동등하게 반영된다.
- AUTO: 네 채널 핸들러가 공유 payload 타입 사용 + 갱신 분기 존재(코드 경로), typecheck 0. **라이브 갱신 종단은 DEVICE-GATED**(realtime 은 로컬 Supabase + minted JWT 로 일부 로컬 검증 가능하나, 실 동선 반영은 시뮬레이터 종단).

### AC-N14 ↔ R-N14 (토큰 없으면 비구독 + 정리 — Unwanted)
- **Given** 네이티브 세션 access_token 부재
- **When** 라이브 화면 마운트/언마운트
- **Then** private 채널을 열지 않고(웹 fail-closed `if(!accessToken) return` 동등), 언마운트/의존성 변경 시 채널을 정리한다(중복 구독·누수 방지).
- AUTO: realtime 코드에 token-부재 early-return + cleanup(removeChannel) 존재(코드 경로), typecheck 0.

### AC-N15 ↔ R-N15 (채팅 — 공유 도메인 로직)
- **Given** 웹 채팅(keyset 히스토리 + 전송 + 에러 분류)
- **When** 채팅 화면을 사용한다
- **Then** **공유** chat 로직(`loadHistory`/`sendMessage`/`chatErrorMessage`)으로 히스토리 로드·전송하고 400/401/403 분류가 웹과 동일하다.
- AUTO: 채팅 화면이 공유 chat 로직 import(import 그래프 — 포크 부재), typecheck 0. 종단은 DEVICE-GATED(실 메시지 왕복은 시뮬레이터 + FCM 푸시는 push-fcm-e2e-prep 정책 참조).

---

## M4. 알림 + 프로필 + 네이티브 푸시 + 초대 수락

### AC-N16 ↔ R-N16 (프로필 패리티 + 알림 placeholder)
- **Given** 웹 `profile`(이메일/이름 표시 + 이름 수정 + 로그아웃) + `notifications`(placeholder)
- **When** 각 탭을 연다
- **Then** 프로필이 네이티브 세션 email + `GET /me` 이름을 표시하고 공유 `patchMe` 로 이름 수정·네이티브 로그아웃을 제공하며, 알림 탭은 웹의 placeholder 상태를 네이티브 placeholder 로 재현한다(기능 신설 0).
- AUTO: 프로필 화면이 공유 `patchMe` 호출 + 알림이 placeholder(기능 코드 부재), typecheck 0. 종단은 DEVICE-GATED.

### AC-N17 ↔ R-N17 (네이티브 푸시 — 세션 배선)
- **Given** 기존 `notification-core`/`register-device`(EXISTING)
- **When** 푸시 등록을 수행한다
- **Then** 디바이스 등록이 **네이티브 세션**(네이티브 `getToken` Bearer)으로 배선되고 WebView 브리지에 의존하지 않는다.
- AUTO: 등록 호출의 토큰 출처가 네이티브 세션(코드 경로) + 브리지 비참조(import 그래프), typecheck 0. 실제 FCM 전송은 **DEVICE-GATED**(FIREBASE_CREDENTIALS + 실기기 — push-fcm-e2e-prep 정책).

### AC-N18 ↔ R-N18 (초대 수락 — fail-closed)
- **Given** 웹 초대 수락(`fetchInviteValidity` fail-closed)
- **When** 초대 링크를 연다
- **Then** **공유** `fetchInviteValidity` 로 유효성을 조회하고, 200 으로 `valid` 가 확정된 초대에만 닉네임/가입 폼을 노출한다(non-200/transient → 무효 안내). 수락은 공유 accept 로직으로 수행한다.
- AUTO: 초대 화면이 공유 invite 로직 import(import 그래프 — 포크 부재) + valid 확정 시에만 폼 렌더하는 분기(코드 경로), typecheck 0. 종단 fail-closed 거동은 DEVICE-GATED(validity-gate-fail-closed 정책 — 폼은 confirmed-valid 에만).

---

## M5. 공유 패키지 추출 + WebView 게이트 폐기 + 점진 컷오버

### AC-N19 ↔ R-N19 (도메인 로직 공유 추출)
- **Given** `apps/web/lib/` 의 플랫폼 비종속 도메인 로직(moim/chat/invite/expenses/polls/members + 채널 디스크립터)
- **When** 공유 패키지(`@moyura/domain` 등)로 추출한다
- **Then** 추출 모듈이 `api: ApiClient` 주입형 순수 TS(React/Next/RN 비의존)로 공유 패키지에 존재하고, web·mobile 양쪽이 import 할 수 있다.
- AUTO: 공유 패키지에 해당 모듈 파일 존재 + 순수 TS(`react`/`next`/`react-native` import 부재 — import 그래프), 공유 패키지 typecheck 0.

### AC-N20 ↔ R-N20 (no-duplication — 단일 출처)
- **Given** 추출된 도메인 로직
- **When** mobile·web 이 이를 소비한다
- **Then** 동일 함수 본문이 `apps/mobile` 와 `apps/web` 에 **중복 존재하지 않으며**, 양쪽이 **같은** 공유 모듈을 import 한다(web 은 행위 보존 리팩토링 — 동작 회귀 0).
- AUTO(핵심 falsify 게이트): (1) `apps/mobile/**` 와 `apps/web/**` 에 추출 함수명(`getMoim`/`fetchInviteValidity`/`loadHistory`/`sendMessage`/`chatErrorMessage`/`formatMoimSchedule` 등)의 **로컬 정의(함수 선언 본문)가 부재**하고 공유 패키지 import 만 존재(grep/import 그래프 negative 게이트); (2) `apps/web` `next build` + typecheck 0(웹 행위 보존 1차); (3) 공유 패키지가 단일 출처. 웹 종단 회귀는 수동(OD-4).

### AC-N21 ↔ R-N21 (화면 단위 플래그 컷오버)
- **Given** 대규모 전환
- **When** 컷오버를 진행한다
- **Then** 각 화면 그룹이 플래그 뒤에서 네이티브 vs WebView 로 전환되고, WebView 라우트는 해당 네이티브 화면이 패리티 AC 를 통과한 후에만 비활성화된다(빅뱅 0).
- AUTO: 라우트별 native/WebView 분기 플래그 존재(코드 경로), typecheck 0. 단계별 전환 순서는 plan.md 가 규정.

### AC-N22 ↔ R-N22 (WebView 스택 게이트 폐기 — RETIRE)
- **Given** M1~M4 패리티 AC 전량 통과
- **When** 폐기를 수행한다
- **Then** mobile WebView/브리지 스택(`BridgedWebView`/`WebViewShell`/오버레이/`useAuthBridge`/`useAppLifecycle`/`auth-bridge-core`/`route-map-core`/`web-url`/`bridge-protocol`/cookie seed·clear) + web `lib/native-bridge/*` 가 제거되고 `react-native-webview` 가 `apps/mobile/package.json` 에서 빠진다 — **단, 패리티 게이트 통과 전에는 수행하지 않는다.**
- AUTO(최종 상태): 폐기 후 `apps/mobile/package.json` 에 `react-native-webview` 부재 + WebView/브리지 파일 부재 + 양 앱 typecheck 0 / `expo export` / `next build` OK. **게이트 전제(M-G)**: M1~M4 의 DEVICE-GATED AC(렌더 패리티·OAuth·realtime·푸시) 통과 기록이 선행 — 미통과 시 폐기 금지(회귀 시 WebView 폴백 경로 상실 방지).

---

## Definition of Done

- [ ] **채택 게이트(OD-1)**: 본 SPEC(Option B) vs `SPEC-WEBVIEW-UNIFY-001`(WebView 유지) 중 채택이 plan/이해관계자 게이트로 확정됨. 미채택 시 구현 진입 금지(둘은 상호 배타 — 동시 진행 안 함).
- [ ] **AUTO 게이트**: `apps/mobile` + `apps/web` + 공유 패키지 typecheck 0 / `expo export` 번들 OK / `apps/web` `next build` OK.
- [ ] **no-duplication 게이트(AC-N20)**: 추출 도메인 로직이 mobile/web 양쪽에 중복 정의 부재 + 공유 패키지 단일 출처(import 그래프 negative 게이트) — anti-duplication hard 제약 충족.
- [ ] **WebView 비호스팅(AC-N1)**: 사용자 화면 코드에 WebView/Bridged 셸 import 부재.
- [ ] **네이티브 세션 권위(AC-N2/N4)**: `getToken`·realtime·푸시가 네이티브 세션을 출처로 사용, `session:restore` 브리지 비의존.
- [ ] **백엔드 계약 불변**: NestJS 엔드포인트/DTO/RLS 변경 0. 모바일이 웹과 동일 REST 호출.
- [ ] **웹 행위 보존(OD-4)**: M5 추출이 web 동작을 회귀시키지 않음 — `next build`/typecheck 1차 + 수동 종단 회귀.
- [ ] **DEVICE-GATED 패리티(iOS 시뮬레이터 + 실기기)**: 화면 렌더 데이터·동작 패리티(AC-N7/N8/N16) / Google OAuth 네이티브 왕복(AC-N3) / 4채널 라이브 갱신·RLS 인가(AC-N12/N13, OD-3) / FCM 푸시(AC-N17) — 자동 게이트만으로 완료 아님(moyura 디바이스 게이팅 정책).
- [ ] **게이트된 폐기(AC-N22, M-G)**: WebView/브리지 스택 + `react-native-webview` 제거는 M1~M4 DEVICE-GATED AC 통과 후에만. 통과 전 폐기 금지(폴백 경로 상실 방지).
- [ ] **점진 컷오버(AC-N21)**: 화면 단위 플래그 전환, 빅뱅 0.
- [ ] **완료 정책**: 채택 게이트 → AUTO 게이트(no-duplication 포함) 통과 시 status draft→in-progress, 화면 그룹별 DEVICE-GATED 패리티 통과 + WebView 폐기 완료 시 completed.
