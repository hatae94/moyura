# Plan — SPEC-MOBILE-003

> expo-router 네비게이션 골격 + 라우트별 WebView 하이브리드 구현 계획.
> 방법론: TDD(`quality.development_mode: tdd`) — 단 RN/expo import 파일(라우트, `_layout.tsx`)은 vitest 불가이므로 결정 로직을 `-core.ts` 순수 모듈로 추출해 RED 대상 삼는다(research §7.5). 브라운필드 — 기존 동작 보존.
> 시간 추정 금지: 우선순위 라벨(High/Medium/Low) + phase 순서로 표기.

## 기술 접근 (Technical Approach)

- **마일스톤 순서 = web-first.** 모바일 WebView 래퍼(`(tabs)/home.tsx` 등)가 가리킬 웹 페이지(`${WEB_URL}/home` 등)가 먼저 존재해야 모바일 종단 검증이 가능하다. 따라서 **M4(웹 `(main)` UI)를 먼저 착수**하고, 그 다음 모바일 골격(M1)·인증(M2)·계약(M3)·보존/전환(M5) 순으로 진행한다. (요구 ID 의 M1~M5 번호는 spec.md 의 관심사 그룹이며, 아래 실행 순서는 의존성 기반으로 재정렬한다.)
- **순수 로직 우선(TDD seam).** `route-map-core.ts`(URL↔라우트 매핑), `auth-state-core.ts`(isSignedIn 결정), 확장된 `decideWebViewLoad`(교차 라우트 차단), 확장된 `decideBackPress`(라우트 컨텍스트 back 분기)를 먼저 RED→GREEN 으로 만든다. 라우트/`_layout.tsx`(JSX)는 이 순수 결정을 호출만 한다.
- **행위 보존 이전.** `App.tsx`→`app/_layout.tsx` 이전은 신규 동작 0. 스플래시/브리지/콜드스타트 핸드셰이크 호출 순서·타임아웃을 그대로 옮긴다(GREEN 후 특성화 테스트로 회귀 확인).
- **deprecated 회피.** `npx expo install` 로만 의존성 추가(수동 핀 금지), `expo-router/entry` 엔트리, `@react-navigation/*`/`expo-router/babel`/`useRootNavigation` 미사용(research §5).

## 실행 순서 (의존성 기반 재정렬)

### 단계 A — 웹 `(main)` UI (spec M4 / R-WB1·R-WB2) — Priority High (모바일 타깃 선행)
모바일 WebView 가 호스팅할 웹 페이지를 먼저 만든다.

| 작업 | 파일 | 비고 |
|---|---|---|
| `(main)` 라우트 그룹 + 공유 레이아웃 | `apps/web/app/(main)/layout.tsx` [NEW] | BottomTabBar + 인증 가드(기존 `me/page.tsx` 세션 가드 패턴 참조) |
| 공유 BottomTabBar 컴포넌트 | `apps/web/app/(main)/_components/BottomTabBar.tsx` [NEW] | Figma BottomTabBar 적응(lucide-react `^1.17.0` 아이콘, Tailwind v4) |
| `/home` Figma HomeTab | `apps/web/app/(main)/home/page.tsx` [NEW] | 인사말/CTA/필터 칩/모임 카드(mock)/빈 상태. mock 데이터는 `apps/web/app/(main)/home/_mock.ts` |
| 플레이스홀더 3종 | `apps/web/app/(main)/{explore,notifications,profile}/page.tsx` [NEW] | 이모지+타이틀+설명만 |
| 디자인 토큰 반영 | `apps/web/app/globals.css` [MODIFY] | Figma 테마(색/타이포/radius)를 Tailwind v4 테마 변수로 수동 추출 |

### 단계 B — 셸 모드 크롬 (spec M4 / R-WB3·R-WB4) — Priority High
| 작업 | 파일 | 비고 |
|---|---|---|
| 셸 모드 감지 → 웹 탭바 숨김 | `apps/web/app/(main)/layout.tsx` [MODIFY], `apps/web/lib/native-bridge/` [MODIFY/참조] | OD-3: `injectedJavaScriptBeforeContentLoaded` 마커(권장) 또는 `window.ReactNativeWebView`. flash 방지 = 하이드레이션 전 보장 |

### 단계 C — post-login 목적지 전환 (spec M5 / R-PR3) — Priority High
| 작업 | 파일:line | 비고 |
|---|---|---|
| 이메일 로그인/가입 redirect | `apps/web/lib/auth/actions.ts:46,65` [MODIFY] | `redirect("/me")` → `redirect("/home")` |
| OAuth next | `apps/web/lib/auth/actions.ts:89` [MODIFY] | `?next=/me` → `?next=/home` |
| mobile DEFAULT_NEXT | `apps/mobile/lib/auth/oauth-bridge.ts:29` [MODIFY] | `"/me"` → `"/home"` |
| 관련 테스트 갱신 | `apps/mobile/lib/auth/oauth-bridge.test.ts`, `apps/mobile/hooks/auth-bridge-core.test.ts`(`next=/me` 단언) [MODIFY] | `/me`→`/home` 단언. **security 테스트(`auth-bridge-core.security.test.ts`)의 `/me` 변형은 origin 잠금 의미라 유지/검토** |

### 단계 D — 모바일 순수 결정 로직 (spec M2·M3 core) — Priority High (TDD RED 먼저)
| 작업 | 파일 | 요구 | 비고 |
|---|---|---|---|
| 라우트 매핑 순수 모듈 | `apps/mobile/lib/route-map-core.ts` [NEW] + `.test.ts` | R-NC1 | URL→라우트, 라우트→`${WEB_URL}/path`. vitest node-env |
| isSignedIn 결정 순수 모듈 | `apps/mobile/lib/auth/auth-state-core.ts` [NEW] + `.test.ts` | R-AS4 | `{tokens,lastBridgeSignal}`→`{isSignedIn,redirectTo}`. @MX:ANCHOR |
| `decideWebViewLoad` 교차 라우트 확장 | `apps/mobile/hooks/auth-bridge-core.ts:187` [MODIFY] + security/test 보강 | R-NC2/R-NC3 | 기존 3분기(trusted-load/oauth-intercept/deny)에 cross-route 차단+dispatch 추가. 기존 단언 보존 |
| `decideBackPress` 라우트 컨텍스트 확장 | `apps/mobile/hooks/app-lifecycle-core.ts:19` [MODIFY] + `.test.ts` | R-NC4/OD-2 | `(tabs)`=native-first, `(auth)/login`=기존 WebView back 보존 |

### 단계 E — expo-router 골격 + 엔트리 이전 (spec M1) — Priority High
| 작업 | 파일 | 요구 | 비고 |
|---|---|---|---|
| 의존성 추가 | `apps/mobile/package.json` [MODIFY] | R-RT2 | `npx expo install expo-router react-native-safe-area-context react-native-screens expo-constants` (핀 금지) |
| 엔트리 전환 | `apps/mobile/package.json:4` [MODIFY], `apps/mobile/index.ts` [MODIFY/REMOVE] | R-RT1/R-RT4 | `main: "expo-router/entry"`. **`./lib/env` side-effect 보존**(custom entry 또는 `_layout.tsx` 최상단 import) |
| Root layout(행위 보존 이전) | `apps/mobile/app/_layout.tsx` [NEW] | R-RT3 | App.tsx 의 스플래시/브리지/콜드스타트(`App.tsx:35,82,108,169,174`) 이전. @MX:WARN |
| 진입 분기 | `apps/mobile/app/index.tsx` [NEW] | R-AS3 | `auth-state-core` 결정 → `Redirect` |
| App.tsx 제거 | `apps/mobile/App.tsx` [REMOVE] | R-RT5 | 라우터 우회 경로 제거 |
| typedRoutes | `apps/mobile/app.json` [MODIFY] | R-RT6 | typecheck 통과 시에만 활성 |

### 단계 F — 인증 그룹 + 탭 그룹 + 가드 (spec M2·M4 / R-AS·R-WB5) — Priority High
| 작업 | 파일 | 요구 | 비고 |
|---|---|---|---|
| AuthContext | `apps/mobile/app/_layout.tsx` 내 또는 `apps/mobile/lib/auth/AuthContext.tsx` [NEW] | R-AS1/R-AS2 | `auth-state-core` + bridge 신호 소비 |
| `(auth)` 그룹 | `apps/mobile/app/(auth)/_layout.tsx`+`login.tsx` [NEW] | R-AS3/R-PR2 | 기존 `WebViewShell`+`useAuthBridge` 재사용(로그인=웹뷰 보존) |
| `(tabs)` 그룹 + 네이티브 탭바 | `apps/mobile/app/(tabs)/_layout.tsx` [NEW] | R-WB5/R-AS3 | `Tabs` + Figma BottomTabBar RN 재해석 + notifications 배지(mock) + `Tabs.Protected` |
| 탭 WebView 래퍼 4종 | `apps/mobile/app/(tabs)/{home,explore,notifications,profile}.tsx` [NEW] | R-WB5/R-NC1 | `WebViewShell` source=`route-map-core` 의 `${WEB_URL}/<route>`. OD-4 lazy 마운트 |

### 단계 G — 보존/회귀 + 종단 (spec M5 / R-PR1·R-PR4·R-PR5) — Priority High
| 작업 | 검증 | 비고 |
|---|---|---|
| 회귀 게이트 | `nx test mobile` 89/89+ , `tsc --noEmit`(mobile/web), `next build`, `expo export` | R-PR1 |
| 딥링크 공존 | `moyura://auth-callback` 가 라우트 파일로 안 잡힘 확인 | R-PR4(디바이스) |
| 로그아웃 종단 | `session:cleared` → `(auth)/login` 네이티브 이동 + R-R4 cookie-clear 보존 | R-PR5(디바이스) |

## 기술 제약 (Constraints)

1. **pnpm workspace + hoisted**(`.npmrc node-linker=hoisted`): expo-router 의존성은 `apps/mobile` 스코프 한정. 추가 후 `pnpm-lock.yaml` 변경 검토.
2. **버전 핀 금지**: `npx expo install` 가 SDK 56 호환 버전 자동 결정(research §5).
3. **`patches/` 주의**: expo 패치는 JSI/런타임(JS expo-router 와 무관)이나, pnpm patch 는 exact 버전 필요 → 의존성 추가가 패치 대상 버전을 바꾸지 않는지 lockfile 확인.
4. **vitest node-env 제약**: 라우트/`_layout.tsx`(JSX+expo import)는 vitest 불가. 결정 로직은 `-core.ts` 순수 모듈로 추출(`route-map-core`, `auth-state-core`, `decideWebViewLoad`/`decideBackPress` 확장).
5. **TS 6 라인**(`apps/mobile` `~6.0.3`): typed routes/expo-router 타입이 TS 6 typecheck 통과하는지 확인(R-RT6 는 통과 시에만).
6. **품질 게이트**: mobile 린터 미구성 → strict `tsc --noEmit` + vitest. web 은 `tsc --noEmit` + `next build`(자동 테스트 하니스 없음 — 메모리 `web-no-test-harness`, 하니스 추가 전 사용자 확인).
7. **설정 변경 후 `npx expo start --clear`**(research §5).
8. **웹 스택 고정**: Next.js 16.2.6 + Tailwind v4(config-less) + lucide-react `^1.17.0` 기존 의존 재사용(신규 UI 라이브러리 도입 없음).

## 리스크 및 완화 (Risk Analysis)

| # | 리스크 | 심각도 | 완화 |
|---|---|---|---|
| 1 | 엔트리 전환 시 `App.tsx` 스플래시/브리지/콜드스타트 핸드셰이크(`App.tsx:35,82`) 손실, `index.ts:5` env 가드 side-effect 누락 | HIGH | `_layout.tsx` 단방향 행위 보존 이전 + env import 최상단 재배치. App.tsx 제거(R-RT5). **@MX:WARN**(@MX:REASON: 엔트리 전환 = 세션 부트 회귀 위험) |
| 2 | 인증 상태 신호 누락 시 로그인 무한 루프 | HIGH | `auth-state-core.ts` 순수 결정 + vitest 특성화. bridge 신호 단일 소스(R-AS1/AS5). **@MX:ANCHOR**(라우트 가드 fan_in) |
| 3 | `decideWebViewLoad` 확장이 기존 R-T9 origin 잠금 단언 회귀 | HIGH | 기존 security 테스트 보존 후 cross-route 분기 추가(89/89 게이트). RED 로 신규 분기만 추가 |
| 4 | Android back 일원화가 `(auth)/login` WebView back 회귀 | MEDIUM | `decideBackPress` 라우트 컨텍스트 인자(OD-2). `(auth)` 는 기존 동작 보존 |
| 5 | 셸 모드 웹 탭바 hydration flash(이중 탭바 순간 노출) | MEDIUM | `injectedJavaScriptBeforeContentLoaded` 마커(OD-3, R-WB4). 디바이스 검증 |
| 6 | `moyura://auth-callback` 딥링크가 expo-router 라우트로 포착 | MEDIUM | 콜백 경로를 라우트 파일로 만들지 않음(R-PR4). 디바이스 검증 |
| 7 | Figma Make 웹 코드 적응 비용/오역 | LOW | 스택 일치(Tailwind v4 + lucide-react). RN 이식 아님(웹 페이지) |
| 8 | 디바이스 검증 게이트(자동만으로 completed 불가) | MEDIUM | status 는 디바이스 종단 검증 후 completed(메모리 일관) |

## MX 태그 계획

- **@MX:ANCHOR**: `auth-state-core.ts` 의 isSignedIn 결정 함수(라우트 가드가 fan_in ≥ 3 의존), `route-map-core.ts` 의 URL↔라우트 매핑(탭 래퍼+인터셉트가 공유 의존).
- **@MX:WARN**(@MX:REASON 필수): `app/_layout.tsx` 의 엔트리/스플래시/콜드스타트 핸드셰이크 이전부 — 엔트리 포인트 전환은 세션 부트/스플래시 회귀 위험 HIGH.
- **@MX:NOTE**: `(auth)/login.tsx` WebView 재사용 경계, 확장된 `decideWebViewLoad` 의 cross-route 차단 의미, `oauth-bridge.ts` `DEFAULT_NEXT` 가 네이티브 목적지와 분리됨.

## Reference (재사용 자산 — file:line)

- `apps/mobile/components/WebViewShell.tsx` — 탭 WebView 래퍼 + `(auth)/login` 재사용 (SPEC-WEBVIEW-SHELL-001)
- `apps/mobile/hooks/useAuthBridge.ts:136-138` + `auth-bridge-core.ts:187` `decideWebViewLoad` — 인터셉트 확장 대상 (R-NC2)
- `apps/mobile/hooks/useAppLifecycle.ts:77-90` + `app-lifecycle-core.ts:19` `decideBackPress` — back 일원화 대상 (R-NC4)
- `apps/mobile/lib/auth/token-store.ts` + `bridge-protocol.ts` — AuthContext 토큰/신호 소스 (R-AS1)
- `apps/mobile/lib/auth/oauth-bridge.ts:29` `DEFAULT_NEXT` — `/me`→`/home` (R-PR3)
- `apps/mobile/App.tsx:35,82,108,169,174` — 스플래시/콜드스타트 이전 원본 (R-RT3)
- `apps/mobile/index.ts:5` — env 가드 side-effect 보존 (R-RT4)
- `apps/web/lib/auth/actions.ts:46,65,89` — post-login redirect (R-PR3)
- `apps/web/lib/native-bridge/NativeBridgeProvider.tsx` — `window.ReactNativeWebView` 셸 모드 감지 (R-WB3/R-WB4)
- `apps/web/package.json` — lucide-react `^1.17.0`, tailwindcss `^4` (R-WB1)
