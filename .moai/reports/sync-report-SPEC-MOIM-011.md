# Sync Report — SPEC-MOIM-011

생성일: 2026-06-22
브랜치: feature/SPEC-MOBILE-004
커밋: 2023cb9
status 전환: draft → in-progress (v0.1.0 → v0.2.0)

---

## 1. 동기화된 파일 목록

| 파일 | 변경 유형 | 내용 요약 |
|------|-----------|-----------|
| `.moai/specs/SPEC-MOIM-011/spec.md` | 수정 | frontmatter(status: draft→in-progress, version: 0.1.0→0.2.0), HISTORY v0.2.0 항목 추가(구현 요약 + 자동 게이트 + device-gated 이유 + 웹 세션 이슈 정직 기록) |
| `.moai/specs/SPEC-MOIM-011/acceptance.md` | 수정 | DoD 체크박스 — 자동 게이트 항목 [x] 처리(백엔드 무변경/헬퍼/invite-button/수락 페이지 버튼/모바일 라우트/보안/tsc·lint·build 0/vitest 0/backend jest GREEN); 딥링크 + 웹 invite-create UI 워크스루 PENDING 주석 + 디바이스 종단 검증 미체크 |
| `CHANGELOG.md` | 수정 | `[Unreleased] > Added` 최상단에 SPEC-MOIM-011 항목 추가(백엔드/마이그레이션 무변경, invite-create UI + moyura://invite 딥링크, device-gated, 웹 세션 이슈 정직 기록, MOIM 시리즈 명시) |
| `.moai/project/structure.md` | 수정 | 웹 신규 파일(lib/moim/invites.ts, invite-actions.ts, invite-button.tsx) + page.tsx isOwner/InviteButton + /invite/[token]/page.tsx "앱에서 열기" 버튼; 모바일 신규 `app/invite/` 트리 + `[token].tsx` + `_layout.tsx` invite screen; scheme 딥링크 자동 링크 |
| `.moai/project/tech.md` | 수정 | 상단 SPEC 기록 블록에 SPEC-MOIM-011 요약 추가; 구현됨 vs 계획됨 표에 SPEC-MOIM-011 in-progress 행 신규 추가 |
| `.moai/reports/sync-report-SPEC-MOIM-011.md` | 신규 | 본 문서 |
| `.moai/reports/mobile-verification-runbook.md` | 수정 | MOIM-011 invite-create + 딥링크 검증 섹션 추가(§5) |

---

## 2. status 전환: draft → in-progress (v0.2.0)

- **이전 status**: `draft` / **신규 status**: `in-progress`
- **이전 버전**: `0.1.0` / **신규 버전**: `0.2.0`

**전환 근거**: 구현 완료로 자동 게이트 전부 GREEN(web tsc/lint/`nx run web:build` 0 error, mobile tsc/vitest 0 error — route-map-core 등 기존 순수 모듈 회귀 0, backend 무변경 invite jest 회귀 GREEN)이지만, (1) `moyura://invite/{token}` 딥링크가 앱을 `app/invite/[token]` 라우트로 여는지 + "앱에서 열기" 버튼이 scheme 을 발화하는지는 iOS 시뮬레이터에서만 검증 가능하고, (2) 웹 초대 생성 UI 워크스루(owner "초대하기" → 발급 → 링크 표시 + 복사)가 이번 세션 웹 로그인 세션-쿠키 리다이렉트 이슈(signInAction 성공 → 303 /home → /home 307 bounce — auth/middleware 무변경, 직접 signInWithPassword 확인됨, 초대 코드와 무관한 인프라 이슈)로 미수행이므로, 프로젝트 메모리 규칙(`mobile-spec-device-gated`, `verify-locally-before-device-gating`)에 따라 `in-progress` 유지.

`completed` 전환 조건: (a) 웹 로그인 세션 이슈 해소 후 브라우저에서 owner 모임 상세 → "초대하기" → 발급 → 링크 표시 + 복사 / 비-owner 미노출 확인. (b) iOS 시뮬레이터 dev build 에서 `xcrun simctl openurl booted moyura://invite/{token}` → 앱이 `app/invite/[token]` 라우트로 열리고 WebView 가 수락 페이지 로드 → 닉네임 → 수락 → `/moims/:id/chat` + OAuth 딥링크/탭/detail-push 회귀 0 확인. 두 조건 충족 시 `completed`.

---

## 3. 구현 범위 및 설계 결정

### 백엔드/마이그레이션 무변경 (핵심 — SPEC-MOIM-011 vs MOIM-008/009/010 대비)

SPEC-MOIM-011 은 DDL 도 백엔드 코드도 전혀 변경하지 않는다:

- 발급(`POST /moims/:moimId/invites` owner 전용 201) + 목록(`GET .../invites`) + 폐기(`DELETE .../invites/:inviteId`) + 수락(`POST /invites/:token/accept` 404/410/409/400 멱등)이 모두 SPEC-MOIM-002 에서 이미 구축됨.
- `CreateInviteDto`(expiresAt?/maxUses? 선택) + `InviteResponseDto`(token 포함)가 MVP 생성 UI 에 충분하다.
- MVP 생성 UI 는 body 를 비워(`{}`) 백엔드 기본값(+7d 만료/maxUses null=무제한)을 사용한다.
- → MOIM-008(컬럼 2개 additive)/MOIM-009(트리거)/MOIM-010(kind 값 추가)보다 훨씬 단순. 백엔드는 순수 재사용이다.

### 초대 생성 헬퍼 = polls.ts 구체-경로 패턴 미러

발급 라우트(`POST /moims/:moimId/invites`)는 path 파라미터(`moimId`)가 있어 api-client 편의 메서드 표면에 없다. `lib/moim/polls.ts` 의 `createPoll`/`closePoll` 패턴(moimId 인코딩 → 구체 경로 조립 → `api.request(path as never, "post", ...)`)을 그대로 미러한 `createInvite(api, moimId, body?)` 가 `lib/moim/invites.ts` 에 신규 추가됐다. `InviteResult { token: string; expiresAt: string; ... }` 로컬 미러 타입 — 백엔드 무변경이므로 schema 재생성이 없고, `PollWithResults`(polls.ts) 선례와 동일.

### Server Action = poll-actions.ts 패턴 미러

`invite-actions.ts`(`createInviteAction`) 는 `poll-actions.ts`(`createPollAction`) 패턴 미러다: 세션에서 accessToken 추출 → `createInvite` 헬퍼 호출 → `InviteResult` 반환(토큰을 서버 경계에서 처리, 클라이언트엔 표시용으로만 전달). 이 방식으로 토큰이 클라이언트 fetch 코드에 직접 노출되지 않는다.

### owner 전용 초대 버튼 = isOwner prop + Client 섬

`page.tsx`(Server Component)가 `isOwner = moim.createdBy === session.user.id` 를 계산해 `InviteButton`(Client 섬)에 직렬화 prop 으로 전달한다 — `PollsSection` 이 `currentUserId`/`accessToken` 를 받는 것과 동일 경계(plain object 만, 함수/인스턴스 금지). `invite-button.tsx` 는 `isOwner === false` 이면 `null` 을 반환해 비-owner 에게 어포던스를 노출하지 않는다(UI 숨김 defense-in-depth — 백엔드 403 이 권위 출처).

복사는 `navigator.clipboard.writeText` — Client 섬 상태(`copied` boolean)로 "복사됨" 피드백. clipboard 미가용/거부 시 링크 텍스트를 선택 가능 상태로 두는 폴백.

### 웹→앱 핸드오프 = "앱에서 열기" 버튼 (자동 리다이렉트 없음)

웹 수락 페이지(`/invite/[token]/page.tsx`)에 `useSyncExternalStore` UA 감지로 모바일 브라우저 한정 "앱에서 열기" 버튼을 추가했다. 클릭 시 `window.location = moyura://invite/{token}`. **자동 리다이렉트 없음** — 페이지 로드 시 scheme 으로 자동 점프하면 앱 미설치 사용자가 오류/멈춤을 경험한다. 버튼 클릭으로만 발화 + 기존 닉네임 폼이 웹 폴백으로 항상 유지된다.

### 딥링크 = 커스텀 scheme moyura://invite/{token} → expo-router 라우트 → WebView

- `moyura://` scheme 은 app.json 에 이미 있고(`moyura://auth-callback` OAuth 선례), expo-router 는 파일 기반 라우트를 자동 링크한다.
- `app/invite/[token].tsx` 를 최상위 `app/` 아래(그룹 밖)에 추가하면 `moyura://invite/{token}` 이 그 라우트로 해석된다.
- `app/_layout.tsx` 에 `<Stack.Screen name="invite/[token]" />` 을 추가해 Stack 네비게이션에 등록했다.
- 이 라우트는 MOIM-003 의 `(tabs)/home/[id].tsx` 를 미러한다: token 을 읽고 `${WEB_URL}/invite/${encodeURIComponent(token)}` 을 조립해 `BridgedWebView` 로 호스팅. **차이점**: invite 는 `(tabs)`·`(auth)` 그룹 밖의 공개 랜딩이다(인증 무관 — 미인증 게스트도 링크로 진입, WebView 안에서 익명 로그인 + 수락).
- Universal Links(https 자동 열기)는 제외 — localhost 환경에서 불가(associatedDomains 엔타이틀먼트 불필요).

### 모바일은 실제로 변경됨 (MOIM-005~010 대비)

MOIM-005~010 은 "모바일 무변경"(웹 UI 가 WebView 안에서 렌더, 네이티브 코드 0)이었다. 본 SPEC 은 다르다 — 신규 `app/invite/[token].tsx` 네이티브 라우트 + `_layout.tsx` Screen 추가가 진짜 모바일 코드다. 따라서 mobile tsc/vitest 게이트가 적용되고, scheme 이 앱을 여는지는 **iOS 시뮬레이터에서만** 검증 가능하다 → device-gated.

### 웹 세션-쿠키 리다이렉트 이슈 (정직 기록)

이번 세션에서 웹 로그인(`signInAction`) 이 성공 후 303 /home 으로 응답했으나 /home 이 307 bounce 를 반환하는 현상이 발생했다. 이는 본 SPEC 의 초대 코드(auth/middleware 무변경)와 무관하며, 직접 `signInWithPassword` 호출로 Supabase 세션 동작이 정상임을 확인했다. 이 이슈로 인해 웹 invite-create UI 워크스루(owner "초대하기" → 발급 → 링크 표시 + 복사)를 브라우저에서 수행하지 못했다. 세션 이슈 해소 후 별도 검증 예정.

---

## 4. 자동 게이트 결과

| 게이트 | 결과 |
|--------|------|
| web tsc | 0 error (신규 lib/moim/invites.ts + invite-actions.ts + invite-button.tsx + 수락 페이지 "앱에서 열기" 버튼 타입) |
| web lint (`nx run web:lint`) | 0 error |
| web build (`nx run web:build`) | 0 error |
| mobile tsc | 0 error (신규 app/invite/[token].tsx + _layout invite Screen) |
| mobile vitest | 회귀 0 (route-map-core 등 기존 순수 모듈 GREEN — 신규 invite 라우트 추가가 기존 매핑 깨지 않음) |
| backend invite jest | GREEN (무변경 회귀 — 발급/목록/폐기/수락 jest 그대로 통과) |
| 마이그레이션 | 없음 (백엔드/DB 무변경) |

---

## 5. AC별 검증 결과

| AC | 요약 | 검증 방법 | 결과 |
|----|------|-----------|------|
| AC-1: 백엔드 무변경 | 발급/목록/폐기/수락 4개 라우트 그대로, DTO·jest 무변경 | 코드 확인 + backend jest 회귀 GREEN | **PASS** |
| AC-2: 초대 발급 헬퍼 | createInvite(api, moimId) polls.ts 패턴 미러, InviteResult 로컬 미러, schema 재생성 없음 | web tsc 0 | **PASS** |
| AC-3: 초대 생성 UI | invite-button.tsx — isOwner/비-owner + 발급/링크/복사/피드백/오류. page.tsx isOwner 판정·prop 전달. Meetup 오렌지 | web tsc/lint/build 0 (브라우저 워크스루 미완료) | **PASS (자동 부분) / PENDING — 웹 세션 이슈로 브라우저 워크스루 미수행** |
| AC-4: 모바일 딥링크 라우트 | app/invite/[token].tsx BridgedWebView + (tabs)·(auth) 밖 공개 랜딩 + _layout invite Screen | mobile tsc/vitest 회귀 0 | **PASS (자동 부분) / PENDING — 딥링크 앱 열림 iOS 시뮬레이터 검증 대기** |
| AC-5: 수락 페이지 "앱에서 열기" 버튼 | useSyncExternalStore UA 감지 모바일 한정 + window.location=moyura:// + 자동 리다이렉트 없음 + 기존 폼 보존 | web tsc/lint/build 0 | **PASS (자동 부분) / PENDING — "앱에서 열기" 발화 iOS 시뮬레이터 검증 대기** |
| AC-6: 보안 | 토큰 owner 한정(이중 방어) + 수락 SupabaseAuthGuard + 새 채널 노출 0 + 오류 일반화 | 코드 리뷰 + tsc | **PASS** |
| AC-7: 회귀 보존 + 신규 컴파일 | 기존 모임/투표/인증/수락/모바일 셸 무파손 + 신규 파일 컴파일 | tsc/lint/build/vitest 0 | **PASS** |
| AC-8: 품질 게이트 + 디바이스 종단 검증 | 자동 게이트 GREEN + 디바이스 라이브 검증 | 자동 게이트 GREEN | **PASS (자동) / PENDING — 디바이스 검증 대기** |
| 디바이스 종단 검증 | 딥링크 앱 열림 + WebView 수락 + "앱에서 열기" 발화 + 웹 invite-create UI 워크스루 | iOS 시뮬레이터 + 브라우저 대기 | **PENDING — device-gated** |

---

## 6. 미완료 — 웹 invite-create UI 워크스루 + 모바일 딥링크 검증

### 웹 invite-create UI 브라우저 워크스루 (웹 세션 이슈 해소 후)

signInAction 성공 → 303 /home → /home 307 bounce 이슈 해소 후: 모임 상세에서 owner 로 로그인 → "초대하기" → 발급 → `{origin}/invite/{token}` 링크 표시 + 복사 → "복사됨" 피드백 확인. 비-owner 계정에서 버튼 미노출 확인.

### 모바일 딥링크 + "앱에서 열기" iOS 시뮬레이터 검증

iOS 시뮬레이터 dev build 에서:
1. `xcrun simctl openurl booted moyura://invite/{token}` → 앱이 `app/invite/[token]` 라우트로 열리는지 확인.
2. WebView 가 `${WEB_URL}/invite/{token}` 수락 페이지를 로드하는지 확인.
3. 닉네임 입력 → 수락 → `/moims/:id/chat` 리다이렉트 확인.
4. 모바일 브라우저에서 초대 링크 열기 → "앱에서 열기" 버튼 표시 → 클릭 → scheme 발화 → 앱 열림 확인.
5. OAuth 딥링크(`moyura://auth-callback`) + 탭 + detail-push 회귀 0 확인.

---

## 7. DB 변경 내역 (없음 — 기존 백엔드 완전 재사용)

| 항목 | 내용 |
|------|------|
| **신규 마이그레이션** | 없음 |
| **백엔드 코드** | 무변경(발급/목록/폐기/수락 4개 라우트 + DTO + jest 그대로) |
| **기타 테이블/컬럼/PK/FK** | 무변경 |

DB 문서(schema.md/migrations.md) 미변경 — 이번 SPEC 은 DB 변경이 전혀 없다.

---

## 8. SPEC-MOIM 시리즈 관계 — 초대 흐름 완성

SPEC-MOIM-011 은 SPEC-MOIM-002(초대 백엔드 — 발급/목록/폐기/수락 완전 구축)의 직속 프런트엔드 후속이다. MOIM-002 가 만든 4개 라우트를 한 줄도 변경하지 않고, 그 표면 위에 owner 가 토큰을 만들 UI 와 받은 사람이 앱으로 들어올 딥링크를 추가한다.

| 도메인 | SPEC | status |
|--------|------|--------|
| 초대 백엔드(발급/목록/폐기/수락) | SPEC-MOIM-002 | completed |
| 모임 채팅 코어 | SPEC-CHAT-001 | completed |
| 채팅 Realtime 수신 | SPEC-CHAT-001 (v0.3.1) | completed |
| FCM 백그라운드 푸시 | SPEC-CHAT-002 | in-progress (device-gated) |
| 모임 상세 + 홈 실 데이터 | SPEC-MOIM-003 | completed |
| 투표 인프라(005~010) | SPEC-MOIM-005~010 | in-progress (device-gated) |
| **초대 생성 UI + moyura://invite 딥링크** | **SPEC-MOIM-011** | **in-progress (device-gated + 웹 세션 이슈)** |
