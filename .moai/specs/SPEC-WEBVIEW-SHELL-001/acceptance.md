# SPEC-WEBVIEW-SHELL-001 — Acceptance Criteria

> 각 AC 는 spec.md 의 EARS 요구사항과 1:1 대응한다(R-S1~S6 ↔ AC-S1~S6). 순수 행위 보존 리팩토링 — 새 동작 0, 회귀 0.
> 검증 채널: **자동**(`apps/mobile` typecheck 0 / 기존 `oauth-bridge` vitest + 신규 추출-훅 분기 vitest(AC-S6) 통과 / `expo export` 번들 OK) + **수동 전용**(에뮬레이터 종단 회귀 — WebView 비리마운트·OAuth 왕복은 자동 불가, AC-S3).

---

## M1. WebViewShell 추출 (행위 보존)

### AC-S1 ↔ R-S1 (WebViewShell 컴포넌트, generic)
- **Given** 모놀리식 `App.tsx` 의 WebView 설정(`source`, `sharedCookiesEnabled`(iOS), `thirdPartyCookiesEnabled`(Android), `style`, 핸들러들)
- **When** `apps/mobile/components/WebViewShell.tsx` 로 추출한다
- **Then** `WebViewShell` 은 source URL prop + 이벤트 핸들러 prop(loading/error/navigation/shouldStartLoad)을 받아 WebView 를 렌더하며, 임의의 웹 라우트를 호스팅할 수 있을 만큼 generic 하다(forward-compat 가드레일 4).
- 자동 검증: typecheck 0, `WebViewShell` props 타입 export 존재, `App.tsx` 가 `WebViewShell` 을 import.

### AC-S2 ↔ R-S2 (오버레이 분리)
- **Given** `App.tsx` 인라인 로딩 인디케이터 + 에러/재시도 오버레이 JSX(+ `StyleSheet`)
- **When** 별도 presentational 컴포넌트로 추출한다
- **Then** 로딩/에러 오버레이가 `App.tsx`/`WebViewShell` 본문 밖 독립 presentational 컴포넌트로 분리되어 import 된다(파일명·위치는 구현 재량 — 권장 이름은 plan.md 의 non-normative 제안).
- 자동 검증: typecheck 0, 로딩/에러 오버레이가 각각 독립 컴포넌트 파일로 존재하고 `App.tsx`(또는 `WebViewShell`)가 이를 import(파일명은 검증 대상 아님 — 분리·import 여부만 판정).

### AC-S3 ↔ R-S3 (행위 보존 — 무회귀, 수동 종단)
- **Given** SPEC-MOBILE-001 의 모든 동작(Android 백 히스토리, SafeArea, 로딩 state, 복구 가능 에러+재시도, OAuth 인터셉트→시스템 브라우저, 인증 성공 시 웹 콜백 네비게이트)
- **When** `App.tsx` 가 `WebViewShell`+오버레이+훅으로 재구성된다
- **Then** 위 동작 전부가 기능 회귀 없이 보존된다.
- **환경 전제(M-1)**: 수동 회귀는 **웹 dev 서버 기동 + 로컬 supabase 기동 + `EXPO_PUBLIC_WEB_URL` 호스트 일관(MOBILE-001 OD-2/OD-3, localhost 일관 셋업 권장)** 상태에서 수행한다. OAuth 실패가 "추출 회귀"인지 "환경 문제"인지 분리하기 위해, **추출 전 동일 환경에서 baseline(로딩/에러/재시도/Android 백/Google OAuth 왕복)을 먼저 1회 통과시켜 무회귀 기준선을 고정**한다(MOBILE-001 R-P2 baseline — DoD 참조).
- 검증: 자동 분기 커버리지는 AC-S6 가 담당. **이 AC 의 종단 동작(WebView 비리마운트, OAuth 왕복)은 자동 불가 — 수동 전용**(에뮬레이터에서 로딩/에러/재시도/Android 백/Google OAuth 왕복 회귀 확인). typecheck 0 / 기존 `oauth-bridge` vitest 통과 / `expo export` 번들 OK 는 보조 게이트(동작 동등 보장 아님).

### AC-S4 ↔ R-S4 (훅 분리 — forward-compat 1, MOBILE-002 seam)
- **Given** `App.tsx` 인라인 라이프사이클/브리지 로직(`BackHandler` `useEffect`, `onNavigationStateChange`, `onShouldStartLoadWithRequest`, `runOAuthBridge`)
- **When** `apps/mobile/hooks/useAppLifecycle.ts`(Android 백/네비 히스토리) / `useAuthBridge.ts`(OAuth 인터셉트→시스템 브라우저 브리지)로 추출한다
- **Then** 라이프사이클·브리지 로직이 합성 가능한 훅으로 분리되어 `App.tsx` 가 호출만 하고(향후 expo-router 마이그레이션 기계적), **두 훅은 SPEC-MOBILE-001 의 기존 동작만 담는다**(토큰 로직 0 — SPEC-MOBILE-002 의 확장 지점으로 비워둔다).
- 자동 검증(seam 게이트 구체화, M-3): (1) 두 훅 파일이 `expo-secure-store` 및 `@supabase/*` 를 **import 하지 않는다**(import 그래프 검사 — grep 보다 견고한 negative 게이트); (2) `package.json` 에 `expo-secure-store` **부재**(AC-S5 의 expo-router 부재 검사와 동일 패턴); (3) 훅의 export 시그니처가 MOBILE-001 동작에 필요한 인자/리턴만 노출한다(토큰/세션 관련 인자·리턴 부재). + typecheck 0, 두 훅 파일 존재 + `App.tsx` 가 import.

### AC-S5 ↔ R-S5 (단일 화면 유지 — Unwanted)
- **Given** 단일 화면 아키텍처
- **When** 추출을 완료한다
- **Then** `expo-router` 가 도입되지 않고 두 번째 navigatable 라우트가 추가되지 않으며 `main: index.ts`/`scheme: "moyura"` 가 그대로다.
- 자동 검증: `package.json` 에 `expo-router` 없음, `app.json` scheme 불변, **`index.ts` 가 여전히 `./App` 의 default export 를 `registerRootComponent` 로 등록(diff 부재)**(L-2 구체화).

### AC-S6 ↔ R-S6 (추출 훅 분기 자동 특성화 테스트)
- **Given** 추출된 `useAuthBridge`/`useAppLifecycle` 의 분기 로직
- **When** `oauth-bridge.test.ts` 패턴(expo/RN import 0, 순수 로직 / 주입 콜백)으로 단위 테스트를 작성한다
- **Then** 각 분기에 최소 1개의 자동 테스트가 존재한다:
  - `useAuthBridge`: `shouldBridgeOAuth` true(인터셉트)/false(정상 네비) 판별, `runOAuthBridge` 콜백 경로(authenticated → `setSourceUri` 호출, cancelled/error → no-op·미인증 유지).
  - `useAppLifecycle`: Android 백 핸들러 `canGoBack` true → `goBack()` 호출 / false → 기본 종료 허용.
- 자동 검증: 신규 `apps/mobile` vitest 가 위 분기를 커버하고 전량 통과(expo/RN import 0). 자동 불가 항목(WebView 비리마운트, OAuth 왕복)은 AC-S3 수동 전용으로 격리.

---

## Definition of Done

- [ ] 진입 전제(M-4): MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline 을 추출 전 동일 환경(웹 dev + 로컬 supabase + 호스트 일관)에서 1회 통과시켜 무회귀 기준선을 고정한다. baseline 미확보 시 AC-S3 무회귀 판정 불가.
- [ ] 자동 게이트: `apps/mobile` typecheck 0 / 기존 `oauth-bridge` vitest + 신규 추출-훅 분기 vitest(AC-S6) 전량 통과 / `expo export` 번들 OK.
- [ ] 신규 의존성 0(`react-native-webview` 13.16.1 만 사용), `apps/web` 변경 0.
- [ ] 행위 보존(AC-S3) — 추출 대상 동작(로딩/에러/재시도/Android 백/Google OAuth 왕복/인증 성공 시 웹 콜백 네비게이트) 무회귀. **자동 falsify 게이트**: AC-S6 추출-훅 분기 테스트. **자동 불가 — 수동 전용**: WebView 인스턴스 비리마운트(OD-1), 전체 OAuth 왕복 종단. (이메일 로그인은 본 추출과 무관 — WebView 안에서 브리지 없이 동작(MOBILE-001 R-P1), MOBILE-002 AC-V3c 가 종단 검증하므로 본 SPEC 무회귀 게이트에서 제외.)
- [ ] WebView 인스턴스 비리마운트(OD-1): `ref`/`sourceUri` state 위치 보존, OAuth 복귀 시 `setSourceUri` 네비게이트(리마운트 아님) 패턴 유지 — 수동 전용 확인.
- [ ] forward-compat 가드레일 2종 충족: 훅 분리(AC-S4, 가드레일 1), generic WebViewShell(AC-S1, 가드레일 4).
- [ ] SPEC-MOBILE-002 seam 명확: 추출 훅이 `expo-secure-store`/`@supabase/*` 미import + 토큰 시그니처 부재(AC-S4) — MOBILE-002 가 채울 자리만 마련.
- [ ] 완료 정책: R-P2 baseline 고정 → 자동 게이트(AC-S6 포함) 통과 후 status draft→in-progress, 에뮬레이터 수동 종단 회귀(AC-S3) 통과 시 completed.
