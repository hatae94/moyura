# SPEC-WEBVIEW-SHELL-001 — Implementation Plan

> Plan phase 산출물. 구현 코드는 Run phase(`/moai run SPEC-WEBVIEW-SHELL-001`). 시간 추정 없이 우선순위 라벨 + 단계 순서로 표기.
> depends-on: **SPEC-MOBILE-001** (in-progress). MOBILE-001 의 `App.tsx` 를 리팩토링한다.
> 개발 방법론: brownfield, **순수 행위 보존 리팩토링**. 새 동작 0, 회귀 0. 선행 SPEC(이 SPEC 먼저 → SPEC-MOBILE-002).

---

## 단일 마일스톤 — Priority High

WebViewShell + 오버레이 + 훅 추출. 동작은 한 줄도 바꾸지 않고 구조만 분리한다.

> 진입 전제(M-4): MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline 을 **추출 전** 동일 환경(웹 dev 서버 + 로컬 supabase + `EXPO_PUBLIC_WEB_URL` 호스트 일관)에서 1회 통과시켜 무회귀 기준선을 고정한다. baseline 미확보 시 AC-S3 무회귀 PASS 판정 불가(코드 리팩토링 자체는 baseline 미검증 상태로도 작성 가능하나, 무회귀 선언은 baseline 에 의존).

추가 파일:
- `apps/mobile/components/WebViewShell.tsx` — source URL prop + 핸들러 prop(loading/error/navigation/shouldStartLoad) 받는 generic WebView 래퍼(R-S1). `react-native-webview` 설정(`sharedCookiesEnabled`/`thirdPartyCookiesEnabled`/`style`)을 캡슐화. 임의 웹 라우트 호스팅 가능(forward-compat 4).
- 로딩 오버레이 컴포넌트(권장 이름 `components/LoadingOverlay.tsx` — **non-normative**, 파일명 구현 재량) — 인라인 로딩 인디케이터 분리(R-S2).
- 에러/재시도 오버레이 컴포넌트(권장 이름 `components/WebViewErrorOverlay.tsx` — **non-normative**, 파일명 구현 재량) — 인라인 복구 가능 에러/재시도 분리(R-S2).
- `apps/mobile/hooks/useAppLifecycle.ts` — `BackHandler`(Android `hardwareBackPress`→`goBack` vs 기본 종료) + `onNavigationStateChange`(`canGoBack` 추적)(R-S4). **기존 동작만** — `AppState`/스플래시/토큰 로드는 SPEC-MOBILE-002 가 추가할 자리(비워둠). `expo-secure-store`/`@supabase/*` import 금지(AC-S4 seam 게이트).
- `apps/mobile/hooks/useAuthBridge.ts` — `onShouldStartLoadWithRequest`→`shouldBridgeOAuth` 인터셉트 + `runOAuthBridge`(`bridgeGoogleOAuth`+`resolveWebCallbackUrl`→콜백 URL 세팅)(R-S4). **기존 동작만** — `session:restore` 주입/`onMessage`/SecureStore 는 SPEC-MOBILE-002 자리(비워둠). `expo-secure-store`/`@supabase/*` import 금지(AC-S4 seam 게이트).
- `apps/mobile/hooks/*.test.ts`(또는 인접 `__tests__`) — 추출 훅 분기 자동 특성화 테스트(R-S6/AC-S6): `useAuthBridge`(`shouldBridgeOAuth` true/false, `runOAuthBridge` authenticated/cancelled/error), `useAppLifecycle`(back `canGoBack` true/false). `oauth-bridge.test.ts` 패턴(expo/RN import 0, 주입 콜백).

수정 파일:
- `apps/mobile/App.tsx` — 위 컴포넌트/훅을 합성(인라인 로직 제거)(R-S3/R-S5). WebView `ref` + `sourceUri` state 소유 위치 보존(OD-1/OD-2), 단일 화면 유지, `expo-router` 미도입.

변경 없음(의존만):
- `apps/mobile/lib/auth/oauth.ts` / `oauth-bridge.ts` — `useAuthBridge` 가 기존과 동일하게 호출.
- `apps/mobile/lib/web-url.ts` — `WEB_URL` 그대로 사용.

산출 검증: typecheck 0, 기존 `oauth-bridge` vitest + 신규 추출-훅 분기 vitest(AC-S6) 통과, `expo export` 번들 OK(AC-S1·S2·S4·S5·S6) + 에뮬레이터 종단 회귀 **수동 전용**(AC-S3: WebView 비리마운트·OAuth 왕복). 수동은 R-P2 baseline 고정 환경에서 수행.

---

## 위험

- **WebView 리마운트(OD-1, 최우선)**: 추출 중 WebView 인스턴스가 리마운트되면(예: `WebViewShell` 에 `key` 부여, 조건부 마운트, 부모 재마운트) MOBILE-001 의 쿠키/PKCE 컨텍스트가 초기화돼 OAuth 가 깨진다. 추출은 순수 구조 변경에 한정하고 `ref`/`sourceUri` state 위치를 보존한다.
- **stale closure / 핸들러 누락(OD-2)**: 훅으로 콜백을 옮길 때 의존성 배열/ref 소유를 잘못 분리하면 Android 백 분기나 OAuth 인터셉트가 누락된다. 동작 보존이 시그니처 미학보다 우선.
- **seam 누수(OD-3)**: 추출 훅에 실수로 토큰 로직 골격을 넣으면 MOBILE-002 와 범위가 겹친다 — 이 SPEC 은 기존 동작만, 토큰 0.

---

## 파일 영향 요약

| 추가 | 수정 | 변경 없음(의존) |
|------|------|------|
| `components/WebViewShell.tsx`, 로딩 오버레이 컴포넌트(권장명 `LoadingOverlay.tsx`, non-normative), 에러 오버레이 컴포넌트(권장명 `WebViewErrorOverlay.tsx`, non-normative), `hooks/useAppLifecycle.ts`, `hooks/useAuthBridge.ts`, 추출-훅 분기 테스트(`hooks/*.test.ts`, R-S6) | `App.tsx` | `lib/auth/oauth.ts`, `lib/auth/oauth-bridge.ts`, `lib/web-url.ts`, `package.json`(신규 의존성 0), `app.json`/`index.ts`(불변) |

> 후행: 이 SPEC 완료 후 SPEC-MOBILE-002 가 같은 `App.tsx`/`useAppLifecycle.ts`/`useAuthBridge.ts` 를 수정해 토큰 동기화를 얹는다.

---

## Sources (출처)

- `apps/mobile/App.tsx` — 추출 대상 모놀리식 셸. WebView `key` 미부여 주석(리마운트 회피). (코드 직접 확인 2026-06-09)
- `apps/mobile/lib/auth/oauth.ts` / `oauth-bridge.ts` — `useAuthBridge` 가 호출할 기존 브리지 함수. (코드 직접 확인)
- `apps/mobile/lib/web-url.ts` / `lib/env.ts` — `WEB_URL` 가드. (코드 직접 확인)
- `apps/mobile/package.json` / `app.json` / `index.ts` — 신규 의존성 0, scheme/진입 불변. (코드 직접 확인)
- SPEC-MOBILE-001 spec.md — 추출 대상 동작의 원천. SPEC-MOBILE-002 spec.md — 후행 확장 SPEC. (.moai/specs/ 직접 확인)
