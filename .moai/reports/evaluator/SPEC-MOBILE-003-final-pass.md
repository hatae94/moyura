# Evaluation Report

**SPEC**: SPEC-MOBILE-003
**Harness**: standard (final-pass mode)
**Date**: 2026-06-12
**Overall Verdict**: PASS

---

## Dimension Scores

| Dimension | Score | Verdict | Evidence |
|-----------|-------|---------|----------|
| Functionality (40%) | 85/100 | PASS | 자동 게이트 전체 통과(134 tests, tsc 0, next build OK). 디바이스 게이트 항목 UNVERIFIED(예상). AC-2 결정 테이블 코드에서 완전 검증. AC-3 단언은 tautology 아님(구체 입출력). AC-8 static-grep 전항목 통과. |
| Security (25%) | 90/100 | PASS | Critical/High 없음. origin 탈출 불가 확인. nonce injection 불가. open-redirect 차단 확인. |
| Craft (20%) | 76/100 | PASS | seam 분리 양호. loadTokens try-catch 누락(LOW). loadTokens 중복 호출(INFO). |
| Consistency (15%) | 88/100 | PASS | SPEC-MOBILE-001/002 pure-core-test-seam 패턴 일관 유지. |

---

## Functionality — 자동 게이트 실행 결과

### `pnpm --filter @moyura/mobile test`
```
Test Files  15 passed (15)
     Tests  134 passed (134)
```
**PASS** (baseline 89/89 초과, 신규 auth-state-core/route-map-core/crossroute 테스트 포함)

### `pnpm --filter @moyura/mobile exec tsc --noEmit`
0 에러 **PASS**

### `pnpm --filter @moyura/web exec tsc --noEmit`
0 에러 **PASS**

### `pnpm --filter @moyura/web build`
```
✓ Compiled successfully in 1569ms
✓ Generating static pages using 12 workers (11/11)
```
**PASS**

---

## Functionality — AC별 검증

### AC-2 (자동) — auth-state 결정 테이블

`auth-state-core.ts:67-76`의 `deriveAuthState` + `auth-state-core.test.ts` 검증:

| 입력 | 기대 출력 | 테스트 결과 |
|------|-----------|------------|
| `{ tokens: null, lastBridgeSignal: "session:none" }` | `{ isSignedIn: false, redirectTo: "(auth)/login" }` | PASS |
| `{ tokens: TOKENS, lastBridgeSignal: "session:synced" }` | `{ isSignedIn: true, redirectTo: "(tabs)/home" }` | PASS |
| `{ tokens: null, lastBridgeSignal: "session:cleared" }` | `{ isSignedIn: false, redirectTo: "(auth)/login" }` | PASS |
| `{ tokens: TOKENS, lastBridgeSignal: "session:cleared" }` | `{ isSignedIn: false, redirectTo: "(auth)/login" }` (보수적) | PASS |
| `{ tokens: TOKENS, lastBridgeSignal: null }` | `{ isSignedIn: true, redirectTo: "(tabs)/home" }` (provisional) | PASS |

ROUTE_SIGNED_IN = `"(tabs)/home"`, ROUTE_SIGNED_OUT = `"(auth)/login"` — `/me` 미참조 (R-AS5). **PASS**

### AC-3 (자동) — 교차 라우트 deny + dispatch 단언

`auth-bridge-core.crossroute.test.ts`에서 구체적 단언 확인:
- 입력: `url = "http://localhost:3000/explore"`, `currentUrl = "http://localhost:3000/home"` → `{ action: "dispatch", route: "explore" }` 단언
- tautology 아님 — 구체적 URL 입출력으로 계약 검증 ✓

기존 `auth-bridge-core.security.test.ts` 13건 회귀 없이 유지. **PASS**

### AC-8 (자동 static-grep) — 라우트 구조 + deprecated API 금지

| 검사 항목 | 결과 |
|-----------|------|
| `package.json main = "index.ts"` (expo-router/entry re-export) | PASS |
| `@react-navigation/*` import: 0건 | PASS |
| `expo-router/babel` in app.json plugins: 없음 | PASS |
| `useRootNavigation()`: 0건 | PASS |
| App.tsx 부재 | PASS |
| auth-callback 라우트 파일 부재 | PASS |
| `(tabs)/{home,explore,notifications,profile}.tsx` = WebView 래퍼 | PASS |
| 웹 `(main)/*`에 `react-native-webview` import: 0건 | PASS |
| `"/me"` in `apps/mobile/app/**`: 0건 | PASS |
| `experiments.typedRoutes` 미설정(R-RT6 Optional — tsc 0 에러이므로 통과) | PASS |

**index.ts 엔트리 순서**: `./lib/env` import가 line 10, `expo-router/entry`가 line 14 — 계약 순서 준수. **PASS**

### AC-5 (부분 자동) — redirect("/home") in actions.ts

`apps/web/lib/auth/actions.ts:46,65` — `redirect("/home")` 확인. `/me` 없음. **PASS** (브라우저 확인은 디바이스 게이트)

### AC-1, AC-4, AC-5b, AC-6 runtime, AC-7 runtime — 디바이스 게이트

**UNVERIFIED** (device-gated, 예상됨 — `mobile-spec-device-gated` 메모리 일관, in-progress 유지 조건)

---

## Security — 보안 탐침 결과

### (a) cross-origin 탈출 시도

**`//evil.com/home` 입력**
`tryParseUrl("//evil.com/home")` → base 없이 프로토콜-상대 URL 파싱 → `TypeError` → `null` 반환 → `routeForUrl` null → `isCrossRoute` false. **차단됨.**

**`https://evil.com/home` 입력 (currentUrl 있을 때)**
`decideWebViewLoad` 분기 순서 (`auth-bridge-core.ts:224-245`):
1. `isOAuthAuthorizeUrl(...)` → false (host 불일치)
2. `tryParseOrigin(...)` → `"https://evil.com"` (not null)
3. http(s) scheme 확인 → true
4. `isTrustedOrigin("https://evil.com/home", trustedWebUrl)` → **false** (origin mismatch)
5. cross-route 체크 조건: `ctx.currentUrl !== undefined && trusted && isCrossRoute(...)` → `trusted == false`이므로 **블록 건너뜀**
6. `trusted ? "trusted-load" : "deny"` → **"deny"** 반환

비신뢰 origin은 dispatch로 탈출할 수 없다. **안전.**

### (b) 셸 마커 + nonce 합성 injection 위험

`WebViewShell.tsx:80-82`:
```js
const beforeContentJs = `window.__MOYURA_NATIVE_SHELL__=true;${
  injectedJavaScriptBeforeContentLoaded ?? ""
}`;
```

BridgedWebView에서 전달하는 스크립트:
```
(function(){try{window.__MOYURA_BRIDGE_NONCE__=JSON.stringify(nonce);}catch(e){}})(); true;
```

nonce = `generateBridgeNonce()` → WebCrypto CSPRNG 기반 32자 hex(0-9a-f). 외부 입력 아님.
`JSON.stringify(hex_string)` → 따옴표 포함 안전한 JSON 인코딩. **injection 위험 없음.**

### (c) AuthContext cold-start provisional sign-in 권한 영향

`deriveAuthState({ tokens: TOKENS, lastBridgeSignal: null })` → `isSignedIn: true` (provisional).

권한 범위: `(tabs)` WebView가 렌더되고 `${WEB_URL}/home`을 로드. 웹 서버의 `(main)/layout.tsx`가 독립적으로 Supabase `getSession()`으로 세션을 검증하므로, 네이티브 토큰이 만료되었더라도 웹 가드가 `/login`으로 redirect한다. 권한 escalation 없음. **허용 범위 내.**

### (d) `?next=` 파라미터 open-redirect

`apps/web/app/auth/callback/route.ts`의 `safeNextPath`:
```js
if (raw.startsWith("/") && !raw.startsWith("//")) {
  return raw;
}
return "/";
```

- `https://evil.com` → "/" (차단)
- `//evil.com` → "/" (`startsWith("//")` 체크로 차단)
- `/home` → "/home" (허용)

**차단됨.** 프로토콜-상대 공격(`//evil.com`)도 명시적으로 차단. **PASS**

---

## Findings

- **[LOW]** `apps/mobile/lib/auth/AuthContext.tsx:79-92` — `loadTokens()` 호출에 try-catch 없음. `loadTokens` 자체가 내부에서 try-catch로 null을 반환하도록 구현되어 있어(`token-store.ts:40-50`) 실제로 throw하지 않지만, 외부 계약(함수 시그니처)은 `Promise<SessionTokens | null>`이고 구현 의존성에 기반한 safety다. `AuthContext.tsx` useEffect에서 직접 try-catch를 추가하면 방어 깊이가 향상된다.

- **[LOW]** `apps/mobile/components/BridgedWebView.tsx:142-162` — 동일한 패턴. `loadTokens()` 에러 처리가 피호출자(token-store.ts) 구현에 의존함.

- **[INFO]** `apps/mobile/lib/auth/AuthContext.tsx:82`, `apps/mobile/components/BridgedWebView.tsx:145` — `loadTokens()` 중복 호출. AuthContext는 가드 결정용, BridgedWebView는 inject용으로 역할이 다르지만, 동일한 SecureStore 읽기가 두 번 발생한다. 설계 trade-off로 허용 가능하며 버그는 아님.

- **[INFO]** `apps/mobile/app.json` — `experiments.typedRoutes` 미설정. R-RT6 Optional이고 tsc 0 에러 통과 중이므로 결함 아님. SDK 56에서 typedRoutes 활성화 시도 후 실패 여부를 명시적으로 문서화하면 명확성 향상.

- **[INFO]** `apps/mobile/hooks/auth-bridge-core.ts:230-233` — `about:blank` 및 `data:` URI가 `"trusted-load"`로 처리됨. 의도된 설계(프레임워크 내부 요청 무회귀)이나, `originWhitelist`가 이 경로를 먼저 차단하는지는 플랫폼 의존적. SPEC-MOBILE-001에서 이미 존재하는 동작이므로 SPEC-MOBILE-003 범위 밖.

---

## Recommendations

- `AuthContext.tsx`와 `BridgedWebView.tsx`의 `loadTokens()` 호출을 `try-catch`로 감쌀 것을 권장. `loadTokens` 구현이 변경되더라도 호출부가 안전하게 동작하도록.
- `app.json`에 typedRoutes 비활성 이유를 주석 또는 experiments 블록으로 명시하면 R-RT6 의도 추적이 용이.
- 디바이스 게이트(AC-1, AC-5b, AC-6 runtime, AC-7 runtime, AC-4 boot runtime) 완료 후 status `in-progress` → `completed` 전환 필요.

---

## 판정 근거 요약

자동 검증 가능한 모든 게이트가 통과되었고, 보안 탐침에서 Critical/High 취약점이 없음을 직접 코드 경로 추적으로 확인했다. 디바이스 게이트 항목은 SPEC에서 예정된 UNVERIFIED이며, 이는 in-progress 상태 유지 조건이지 자동 평가의 FAIL 조건이 아니다. Craft 차원의 LOW 결함은 방어 깊이 미흡이나 현재 구현의 안전성을 위협하지 않는다.
