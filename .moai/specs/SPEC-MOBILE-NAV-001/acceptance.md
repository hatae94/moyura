# Acceptance — SPEC-MOBILE-NAV-001 (모바일 네이티브 헤더·뒤로가기)

> Given/When/Then 시나리오. 각 요구 모듈당 최소 2개. **검증 층위 분리**가 핵심이다:
> - **[local]** — 로컬에서 자동 검증 가능(웹 `next build`/`tsc`, mobile pure-core `vitest`, 브리지 round-trip). 하니스만으로 PASS 판정 가능.
> - **[device-gated]** — iOS 시뮬레이터 라이브 검증 필수(헤더 렌더·nav 왕복·back·레이아웃 회귀). 자동 게이트만으로 completed 불가.
> - **[spike-gate]** — Phase 0 선행 게이트(BLOCKING). 통과 전 M2 실구현 착수 금지.
>
> **[HARD] status 정책 (메모리 `mobile-spec-device-gated`)**: [device-gated] AC 는 iOS 시뮬레이터 라이브 검증 완료 전까지 자동 게이트가 전부 PASS 여도 SPEC status 는 **`in-progress` 로 유지**한다. 자동 통과 ≠ completed. Android AC 는 iOS 검증 후 보류 기록(메모리 `ios-simulator-only`).
> **[HARD] 로컬 우선 분리 (메모리 `verify-locally-before-device-gating`)**: run 단계에서 각 [device-gated] AC 가 실제로 디바이스를 요하는지 재판정한다. Phase 0 SPIKE 와 REQ-MOBNAV-021 폴백 로직 일부는 로컬 검증 가능 여부를 run 단계에서 분리 판정.

---

## Phase 0 — 선행 SPIKE 게이트 (BLOCKING)

### AC-SPIKE-1 [spike-gate][device-gated] — Next 16 nav 관측 완전성 (REQ-MOBNAV-013)

- **Given** iOS 시뮬레이터 dev build 에 로그인된 세션이 있고, Next 16 nav 관측 후보 패턴(`usePathname` effect 또는 Next 16 `Link onNavigate`)이 계측(로그)되어 있을 때
- **When** `<Link>` soft-nav(홈 카드 탭), `router.push`(초대 플로우), Server Action redirect(폼 제출) 세 전환을 각각 수행하면
- **Then** 관측 패턴이 세 전환을 **누락 없이** 포착해야 한다(각 전환마다 pathname 변화 로그 1건 이상).
- **게이트**: 누락 전환 유형이 발견되면 그 전환에 대한 보완 신호를 설계한 뒤에만 M2(NavStateReporter) 실구현에 착수한다. 미통과 시 M2 설계 재편.
- **선행 확인**: Next 16 nav API 는 `node_modules/next/dist/` 문서 확인 선행(AGENTS.md).

### AC-SPIKE-2 [spike-gate] — SPIKE 결과의 NavStateReporter 구현 반영 (REQ-MOBNAV-013)

- **Given** AC-SPIKE-1 로 확정된 관측 방식이 있을 때
- **When** NavStateReporter 를 구현하면
- **Then** 컴포넌트의 pathname 관측 방식이 SPIKE 로 확정된 API/패턴을 사용해야 하며(@MX:NOTE 로 근거 기록), SPIKE 로 발견된 누락 전환 유형에 대한 보완 신호가 포함되어야 한다.

---

## M1 — 네이티브 헤더 크롬 렌더

### AC-M1-1 [local] — nav-header-core 5페이지 판정 (REQ-MOBNAV-001/003)

- **Given** `nav-header-core.decideHeader({pathname, title, canGoBack})` 순수 함수가 있을 때
- **When** pathname 이 헤더 필요 5페이지(`/home/[id]`, `/moims/new`, `/moims/[id]/chat`, `/moims/[id]/schedule`, `/moims/[id]/expenses`) 중 하나이면
- **Then** `{headerVisible: true, ...}` 를 반환하고; pathname 이 탭 루트(`/home`, `/explore`, `/notifications`, `/profile`) 또는 보류 3페이지(`/me`, `/invite`, `/invite/[token]`)이면 `{headerVisible: false}` 를 반환한다.
- **검증**: `vitest` (node-env, RN import 0 — mobile pure-core seam). 5페이지 각각 + 미대상 페이지 표본 테스트.

### AC-M1-2 [local] — back chevron 가시성 결정 (REQ-MOBNAV-002)

- **Given** 헤더 필요 페이지에서 nav 상태가 주어질 때
- **When** `canGoBack: true`(in-app 히스토리 있음)이면
- **Then** `{showBackChevron: true}` 를 반환하고; `canGoBack: false`(딥링크 첫 진입)이면 `{showBackChevron: false}`(title-only 헤더)를 반환한다.
- **검증**: `vitest`. canGoBack 참/거짓 케이스.

### AC-M1-3 [device-gated] — 헤더 바 렌더 + status-bar inset 소유 (REQ-MOBNAV-001)

- **Given** iOS 시뮬레이터에서 `(tabs)` 컨텍스트에 로그인되어 홈 카드를 탭해 `/home/[id]` 상세에 진입했을 때
- **When** 상세 화면이 렌더되면
- **Then** WebView 뷰포트 위(status bar 영역)에 네이티브 헤더 바(back chevron + 모임명 title)가 표시되고, 이중 인셋(헤더 + WebView top inset 겹침) 없이 배치된다.
- **검증**: iOS 시뮬레이터 육안 + 레이아웃 확인. **[device-gated] — status in-progress 유지.**

---

## M2 — 웹측 nav 상태 보고

### AC-M2-1 [local] — nav:state 브리지 round-trip (REQ-MOBNAV-011)

- **Given** 웹 `serializeNavState()` 와 mobile `parseBridgeMessage`/`decideInboundAction` 가 있을 때
- **When** 웹이 `{pathname, title, canGoBack}` 페이로드로 `nav:state` 를 직렬화하고 네이티브가 파싱하면
- **Then** 유효 nonce + trusted-origin 봉투로 round-trip 이 성립하고 `{kind: "nav-state", pathname, title, canGoBack}` 로 디코드되며; unknown type 은 graceful-ignore, 기존 세션 타입(`session:*`, `auth:google-request`, `invite:invalid`)은 회귀 0.
- **검증**: `vitest` (mobile bridge-protocol). round-trip + nonce 검증 + unknown 무시 + 기존 타입 보존 케이스. **[HARD] UNIFY-001 R-U2 와 동일 채널 계약**(nonce/trusted-origin 재사용, v1 세션 타입 무변경) 준수를 테스트로 고정.

### AC-M2-2 [local] — 웹 빌드/타입 검증 (REQ-MOBNAV-010/012)

- **Given** `NavStateReporter.tsx`(신규) + `moims/layout.tsx` 2차 마운트 + `bridge-client.ts` nav 직렬화가 추가되었을 때
- **When** `next build` + `tsc --noEmit` 을 실행하면
- **Then** 빌드·타입 에러 0 으로 통과하고, title 이 route 컨텍스트 데이터에서 산출됨(static `document.title` 비의존)이 코드상 확인된다.
- **검증**: `next build`, `tsc --noEmit`. **웹 테스트 하니스 없음**(메모리 `web-no-test-harness`) — 하니스 추가 전 사용자 확인. 빌드/타입/코드리뷰로 검증.

### AC-M2-3 [device-gated] — soft-nav 헤더 타이틀·back 갱신 (REQ-MOBNAV-010/012)

- **Given** iOS 시뮬레이터에서 `/home/[id]` 상세에 있을 때
- **When** speed dial 로 chat/schedule/expenses 로 soft-nav 하면
- **Then** 네이티브 헤더 타이틀·back chevron 이 새 route 에 맞게 갱신된다(빈 헤더 깜빡임 없이 이전 타이틀 유지 후 갱신).
- **검증**: iOS 시뮬레이터 라이브. **[device-gated] — SPIKE(AC-SPIKE-1) 통과가 전제.**

---

## M3 — Back 동작 라우팅 + 하드웨어/제스처 정합

### AC-M3-1 [local] — decideBackPress web-history 분기 (REQ-MOBNAV-022)

- **Given** `app-lifecycle-core.decideBackPress` 순수 함수가 있을 때
- **When** `(tabs)` 컨텍스트 + 웹이 in-app back 가능을 보고한 상태에서 Android 하드웨어 back 이면
- **Then** web 히스토리 경로(`nav:back` 위임)로 라우팅하는 결정을 반환하고(상세 전체 pop 아님); 웹이 route root 를 보고하면 기존 `(tabs)` native-back 결정을 반환한다.
- **검증**: `vitest`. web-back-possible 참/거짓 + route root 케이스.

### AC-M3-2 [local] — nav:back 웹 위임 계약 (REQ-MOBNAV-020)

- **Given** mobile `injectNavBack` 와 웹 `nav:back` 리스너가 있을 때
- **When** `nav:back` 메시지가 발신되면
- **Then** 네이티브는 `nav:back` 을 post 하고(직렬화 검증) 웹 리스너가 `router.back()`/`history.back()` 를 호출하며, 네이티브가 `webViewRef.goBack()` 을 직접 호출하지 않음(OD-2 해소)이 코드/테스트상 확인된다.
- **검증**: mobile `vitest`(injectNavBack 직렬화) + 웹 `next build`/코드리뷰(리스너). `webViewRef.goBack()` 미사용을 정적 확인.

### AC-M3-3 [local] — 딥링크 폴백 규칙 (REQ-MOBNAV-021)

- **Given** 웹 `nav:back` 핸들러 폴백 로직이 있을 때
- **When** in-app navigation 히스토리가 없는 상태(딥링크 첫 진입)에서 `nav:back` 을 처리하면
- **Then** `router.replace('/home')` 로 폴백하고(WebView 이탈·no-op 아님); 히스토리가 있으면 `router.back()` 으로 이전 route 복귀한다.
- **검증**: 로컬 검증 우선(메모리 `verify-locally-before-device-gating`) — 폴백 결정 로직을 순수화 가능하면 `vitest`, 아니면 `next build` + 코드리뷰. `history.length` 신뢰성 최종 판정은 AC-M3-4 device.

### AC-M3-4 [device-gated] — 알림 cross-tab back 종단 (REQ-MOBNAV-021)

- **Given** iOS 시뮬레이터에서 알림 탭 → cross-tab 직진입(`/home/[id]` 또는 schedule/expenses)했을 때
- **When** 헤더 back chevron 을 탭하면
- **Then** in-app 히스토리가 있으면 알림 피드로 복귀하고; 딥링크 첫 진입이면 홈으로 폴백한다(WebView 이탈 없음).
- **검증**: iOS 시뮬레이터 라이브 (진입 경로 2종). **[device-gated] — history.length 딥링크 첫 진입 신뢰 판정 device-verify(R-11).**

### AC-M3-5 [device-gated][android-held] — Android 하드웨어 back 정합 (REQ-MOBNAV-022)

- **Given** Android 에서 `/home/[id]` 상세 내부 chat/schedule/expenses 로 soft-nav 한 상태에서
- **When** Android 하드웨어 back 을 누르면
- **Then** web 히스토리 정합으로 이전 route 복귀(상세 전체 pop 아님)한다.
- **검증**: **[device-gated][android-held]** — Android AC 는 iOS 검증 후 보류 기록(메모리 `ios-simulator-only`). iOS 시뮬레이터로는 대체 불가.

---

## M4 — 셸 모드 웹 헤더 숨김

### AC-M4-1 [local] — 셸 모드 웹 헤더 숨김 빌드 검증 (REQ-MOBNAV-030)

- **Given** `globals.css` `html[data-shell="native"]` 규칙 확장 + 5페이지 헤더 파일에 셸 숨김 대상 data-attr/조건부 렌더가 추가되었을 때
- **When** `next build` + `tsc --noEmit` 을 실행하면
- **Then** 빌드·타입 에러 0 으로 통과하고, 5페이지 sticky 헤더/back Link 가 셸 모드 숨김 대상으로 마킹됨(chat/schedule/expenses 의 "← 뒤로" Link 포함)이 코드상 확인된다.
- **검증**: `next build`, `tsc --noEmit`, 코드리뷰. **웹 하니스 없음** — 빌드/정적 검증.

### AC-M4-2 [device-gated] — 이중 헤더 없음 + 레이아웃 회귀 없음 (REQ-MOBNAV-030/031)

- **Given** iOS 시뮬레이터 셸 모드에서 5페이지 각각을 렌더할 때
- **When** 네이티브 헤더가 표시되면
- **Then** 웹 sticky back Link 가 미노출(이중 헤더 없음)이고, chat `h-dvh-fixed`(:459) 고정 뷰포트 스크롤 모델과 schedule sticky sub-toolbar `top-[60px]`(:1014) 오프셋이 깨지지 않는다.
- **검증**: iOS 시뮬레이터 육안 + 스크롤 확인. **[device-gated] — 헤더가 뷰포트 차지 시 레이아웃 재검증(R-9).**

---

## 회귀 방지 (Preservation)

### AC-REG-1 [local] — 기존 mobile vitest baseline 보존 (REQ-MOBNAV-011)

- **Given** bridge nav 채널 additive 확장 + `decideBackPress` 분기 후
- **When** `nx test mobile`(vitest) 을 실행하면
- **Then** 기존 baseline(bridge-protocol/nonce/token-store/auth-bridge/app-lifecycle 포함 security suites) 이 전부 통과하고, 신규 테스트(`nav-header-core`, nav round-trip, `decideBackPress` 분기)가 GREEN 이며 회귀 0.
- **검증**: `nx test mobile`. 기존 baseline 유지 + 신규 GREEN.

### AC-REG-2 [local] — 신규 컴포넌트 WebView 미생성 (R-2 회귀 방지)

- **Given** `NativeHeaderBar.tsx`(신규)가 있을 때
- **When** 정적 검사하면
- **Then** NativeHeaderBar 는 `react-native-webview` 를 import 하지 않고(WebView 는 WebViewShell 단일 소유 유지), `decelerationRate` Android 크래시 재발 경로가 없음이 확인된다.
- **검증**: `tsc --noEmit`(mobile) + grep 정적 검사(NativeHeaderBar 내 WebView import 0).

---

## Quality Gate (품질 게이트 요약)

| 층위 | 검증 명령 | 대상 AC | 판정 |
|---|---|---|---|
| Phase 0 SPIKE (BLOCKING) | iOS 시뮬레이터 nav 관측 로그 | AC-SPIKE-1/2 | 통과 전 M2 착수 금지 |
| mobile pure-core | `nx test mobile` (vitest) | AC-M1-1/2, AC-M2-1, AC-M3-1/2, AC-REG-1/2 | 자동 PASS 가능 |
| 웹 빌드/타입 | `next build` + `tsc --noEmit` (하니스 없음) | AC-M2-2, AC-M3-3, AC-M4-1 | 자동 PASS 가능 |
| mobile 타입/번들 | `tsc --noEmit`(mobile), `expo export` | AC-REG-2 | 자동 PASS 가능 |
| iOS 시뮬레이터 (device-gated) | 라이브 종단 | AC-M1-3, AC-M2-3, AC-M3-4, AC-M4-2 | **completed 조건 — 미검증 시 in-progress** |
| Android (보류) | 라이브 | AC-M3-5 | iOS 검증 후 보류 기록 |

### Definition of Done

- [ ] Phase 0 SPIKE(AC-SPIKE-1/2) 통과 후 M2 착수
- [ ] mobile pure-core vitest 전건 GREEN + 기존 baseline 보존(AC-REG-1)
- [ ] `apps/web` `next build` + `tsc --noEmit` 0 에러(AC-M2-2/M3-3/M4-1) — **테스트 하니스 없음, 하니스 추가 전 사용자 확인**
- [ ] `tsc --noEmit`(mobile) 0 에러 + `expo export` OK
- [ ] iOS 시뮬레이터 device-gated AC(AC-M1-3, AC-M2-3, AC-M3-4, AC-M4-2) 라이브 검증 완료 → **이 전까지 status `in-progress` 유지**
- [ ] Android AC(AC-M3-5)는 iOS 검증 후 보류 기록(메모리 `ios-simulator-only`)
