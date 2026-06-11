# Task Decomposition

SPEC: SPEC-MOBILE-003
Approved: 2026-06-11 (Run Decision Point 1)
Baseline correction: vitest baseline is **94/94** (SPEC docs say 89/89 — stale; sync 단계에서 정정)
OD decisions: OD-1 route-map-core + decideWebViewLoad 통합 / OD-2 decideBackPress route-context 확장 / OD-3 injectedJavaScriptBeforeContentLoaded 마커 / OD-4 lazy 탭 마운트 (전부 권장안 — SPEC 개정 불필요)
Entry pattern [HARD]: `index.ts` 유지 — `import './lib/env'` 첫 줄 → `import 'expo-router/entry'` 마지막. `main`을 `expo-router/entry`로 직접 변경 금지(env 가드 유실).

| Task ID | Description | Requirement | Dependencies | Planned Files | Status |
|---------|-------------|-------------|--------------|---------------|--------|
| T-001 | 웹 (main) 그룹 layout + 세션 가드 + 공유 BottomTabBar (Figma 적응) | R-WB1 | - | apps/web/app/(main)/layout.tsx [NEW], (main)/_components/BottomTabBar.tsx [NEW] | done |
| T-002 | 웹 /home HomeTab + 플레이스홀더 3종 + Figma 토큰(globals.css @theme) | R-WB2 | T-001 | (main)/home/page.tsx [NEW], home/_mock.ts [NEW], (main)/{explore,notifications,profile}/page.tsx [NEW×3], apps/web/app/globals.css [MODIFY] | done |
| T-003 | 셸 모드 감지(__MOYURA_NATIVE_SHELL__ 마커, pre-hydration) → 웹 탭바 숨김 fail-safe | R-WB3, R-WB4 | T-001 | (main)/layout.tsx [MODIFY], apps/web/lib/native-bridge/ [참조/헬퍼], apps/mobile/components/WebViewShell.tsx [MODIFY: 마커 주입] | done |
| T-004 | post-login /me→/home: web actions.ts:46,65,89 + mobile oauth-bridge.ts:29 DEFAULT_NEXT + 테스트 갱신 (security/token 테스트의 /me origin 단언은 변경 금지) | R-PR3 | T-002 | apps/web/lib/auth/actions.ts [MODIFY], apps/mobile/lib/auth/oauth-bridge.ts [MODIFY], oauth-bridge.test.ts [MODIFY], hooks/auth-bridge-core.test.ts [MODIFY] | done |
| T-005 | route-map-core.ts 순수 모듈 TDD: routeForUrl/urlForRoute/isCrossRoute (query/hash는 cross 아님) [@MX:ANCHOR] | R-NC1 | - | apps/mobile/lib/route-map-core.ts [NEW], route-map-core.test.ts [NEW] | done |
| T-006 | auth-state-core.ts 순수 결정 TDD: {tokens, lastBridgeSignal}→{isSignedIn, redirectTo} [@MX:ANCHOR] | R-AS1~5 | - | apps/mobile/lib/auth/auth-state-core.ts [NEW], auth-state-core.test.ts [NEW] | done |
| T-007 | decideWebViewLoad cross-route dispatch 확장(optional currentUrl, 기존 13 origin 단언 보존) + decideBackPress route-context 확장(기존 9 단언 보존) | R-NC2, R-NC3, R-NC4 | T-005 | hooks/auth-bridge-core.ts [MODIFY] + 테스트, hooks/app-lifecycle-core.ts [MODIFY] + 테스트 | done |
| T-008 | expo-router 의존성(npx expo install, 핀 금지) + 커스텀 엔트리(env 가드 보존) + app/_layout.tsx 행위 보존 이전 + app/index.tsx + +not-found + App.tsx 제거 + typedRoutes(조건부) [@MX:WARN] + lockfile 패치 무결성 확인 | R-RT1~6 | T-003, T-006 | apps/mobile/package.json, index.ts, app.json [MODIFY], app/_layout.tsx, app/index.tsx, app/+not-found.tsx [NEW], App.tsx [REMOVE] | done |
| T-009 | AuthContext + (auth) 그룹(WebViewShell 로그인 보존) + (tabs) 그룹(네이티브 탭바 Figma RN 재해석 + Protected 가드) + 탭 WebView 래퍼 4종(lazy) + session:synced→replace((tabs)/home) | R-AS1~3, R-NC5, R-PR2, R-WB5 | T-005, T-007, T-008 | lib/auth/AuthContext.tsx, app/(auth)/_layout.tsx, app/(auth)/login.tsx, app/(tabs)/_layout.tsx, app/(tabs)/{home,explore,notifications,profile}.tsx [NEW] | done |
| T-010 | 회귀·딥링크 공존·로그아웃 종단 게이트: vitest 94/94+신규, tsc 0(web/mobile), next build, expo export, AC-8 static-grep, 콜백 라우트 파일 부재, lockfile 무결성 | R-PR1, R-PR4, R-PR5 | T-001~009 | 검증 전용 | done |

## Device-Verification Gate (status completed 전환 조건)
- T-003: 셸 모드 탭바 미표시 + hydration flash 없음 (AC-5b)
- T-008: 콜드스타트 스플래시/핸드셰이크/타임아웃 보존 (AC-4 런타임)
- T-009: 로그인→/(tabs)/home, 네이티브 탭 전환, 교차 라우트 디스패치, Android back (AC-1/3/6 런타임)
- T-010: moyura:// 딥링크 공존, 로그아웃 종단 (AC-7)

## Phase 1.7 (stub scaffolding) — SKIPPED with rationale
파일 기반 라우팅(Next.js App Router, expo-router)에서는 파일 존재 자체가 라우트 등록 = 런타임 동작 변경이며, default export 없는 빈 stub은 next build를 깨뜨림. "stubs only, no behavior" 전제가 성립하지 않아 스킵. 파일 생성은 각 TDD 사이클에서 수행.
