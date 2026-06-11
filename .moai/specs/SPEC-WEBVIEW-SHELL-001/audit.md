# SPEC-WEBVIEW-SHELL-001 독립 감사 보고서 (plan-auditor)

> M1 Context Isolation: 작성자(manager-spec/orchestrator)의 추론 컨텍스트는 무시했다. spec.md / acceptance.md / plan.md + 저장소(read-only) + 의존 SPEC-MOBILE-001 spec.md 만 근거로 독립 판정한다. 단, 호출자가 전달한 "Confirmed user intent"는 faithfulness 비교의 기준(ground truth)으로만 사용했다(작성자 추론이 아님).
> 적대적 입장(adversarial): "이 SPEC에는 결함이 있다"를 기본 가정으로 두고 증거로 반증을 시도했다.
> 검증 일자: 2026-06-09. 모든 저장소 인용은 실제 파일을 읽어 확인했다. SPEC의 코드 주장은 신뢰하지 않고 직접 대조했다.

---

## Verdict

**PASS-WITH-FIXES** — 행위 보존 리팩토링 SPEC으로서 범위 규율·EARS 패턴·R↔AC 1:1·코드 인용 정확성은 매우 양호하다(저장소 사실과 거의 완전 일치). 그러나 (1) DoD가 어떤 요구사항에도 없는 신규 검증 항목("이메일 로그인 무회귀")을 끌어들여 acceptance 경계를 넘고, (2) "행위 보존(무회귀)"을 자동으로 falsify할 수 있는 메커니즘이 부재(스냅샷/특성화 테스트 없이 수동 회귀에만 의존)하며, (3) `apps/web` 무변경 Non-Goal과 R-S3/AC-S3의 "OAuth 인터셉트→시스템 브라우저" 보존이 미세하게 겹치는 검증 책임 분담이 불명확하다. BLOCKER는 없다 — 위 항목을 acceptance에 반영하면 Run 착수 가능.

한 줄 요약: 구조 리팩토링 SPEC의 모범에 가깝다. 다만 "무회귀"라는 핵심 약속을 측정 가능하게 만드는 게이트가 약하고, DoD가 요구 범위를 살짝 초과한다.

---

## 심각도별 카운트

- BLOCKER: 0
- HIGH: 2
- MEDIUM: 4
- LOW: 3

---

## What's good (강점)

- **코드 인용 정확성 우수**: spec.md Background(L26-36)가 서술한 `App.tsx` 인라인 관심사 — WebView config(`sharedCookiesEnabled`/`thirdPartyCookiesEnabled`/`style`), `onShouldStartLoadWithRequest`→`shouldBridgeOAuth`(L91-101), `onNavigationStateChange`/`canGoBackRef`(L104-106), `BackHandler` `useEffect`(L42-58), `onLoadStart/End`·`onError/onHttpError`(L125-135), 인라인 오버레이 + `StyleSheet`(L138-202), `runOAuthBridge`/`setSourceUri`(L69-82) — 이 전부가 실제 `apps/mobile/App.tsx`와 정확히 일치한다.
- **OD-1(리마운트 회피) 근거가 실제 코드와 일치**: spec.md OD-1(L78)이 인용한 "MOBILE-001 `App.tsx` 주석(line 114): WebView 에 `key` 를 부여하면 리마운트"는 실제 `App.tsx:114` 주석("key 는 일부러 두지 않는다 — 리마운트하면 WebView 쿠키/PKCE 컨텍스트가 초기화돼 OAuth 흐름이 깨진다")과 정확히 매칭된다. 가장 취약한 추출 지점을 정확히 식별했다.
- **Non-Goal·의존 무변경 정직**: `oauth.ts`/`oauth-bridge.ts`/`web-url.ts`/`package.json`(`react-native-webview` 13.16.1 보유 — package.json:14 확인)/`app.json`(scheme: "moyura" — 확인)/`index.ts`(main, registerRootComponent — 확인) 불변 주장이 모두 실제 파일과 일치.
- **EARS 패턴 분류 정확**: R-S1·S2 Ubiquitous, R-S4 Ubiquitous, R-S5 Unwanted("SHALL NOT") — 라벨이 옳다. R-S3은 Ubiquitous로 표기됐으나 사실상 불변식이라 허용 범위.
- **seam 명시(OD-3)**: 추출 훅에 토큰 로직 0을 명시하고, MOBILE-002가 채울 자리(`AppState`/스플래시/`session:restore`/`onMessage`/SecureStore)를 구체적으로 비워둠 — clean seam 의도가 명확하고 AC-S4 자동 검증("훅 본문에 토큰/세션/SecureStore 코드 부재")으로 falsifiable.
- **R↔AC 1:1 완비**: R-S1~S5 ↔ AC-S1~S5 정확히 1:1. orphan AC 없음, uncovered R 없음.

---

## Findings (심각도순)

### HIGH

#### H-1 — DoD가 어떤 R/AC에도 없는 신규 검증 항목("이메일 로그인 무회귀")을 도입 — acceptance 경계 초과 (정합성/범위, acceptance.md:46)
- **위치**: acceptance.md DoD L46 — "행위 보존(AC-S3): SPEC-MOBILE-001 의 모든 동작(로딩/에러/재시도/Android 백/Google OAuth 왕복/**이메일 로그인**) 무회귀"
- **문제**: AC-S3(L22-26)과 R-S3(spec.md:68)이 열거하는 보존 동작 목록에는 "이메일 로그인"이 **없다**(Android 백 히스토리, SafeArea, 로딩 state, 복구 가능 에러+재시도, OAuth 인터셉트→시스템 브라우저, 인증 성공 시 웹 콜백 네비게이트). 그런데 DoD에만 "이메일 로그인"이 추가됐다. 더 본질적으로, 이메일/비번 로그인은 MOBILE-001 R-P1 기준 **WebView 안에서 브리지 없이 동작**하므로(App.tsx는 이메일 로그인에 관여하는 코드가 전혀 없음 — 확인) 이 컴포넌트 추출과 **무관**하다. DoD가 추출과 무관한 동작을 무회귀 게이트에 끼워 넣으면, 검증자가 추출 PR과 상관없는 시나리오를 확인하느라 게이트 의미가 흐려지고, AC와 DoD가 불일치하는 trace 오염이 생긴다.
- **수정안**: DoD L46에서 "이메일 로그인"을 제거하거나, 굳이 포함하려면 AC-S3·R-S3 본문에도 동일하게 추가해 trace를 맞춘다(권장: 제거 — 추출과 무관하므로). MOBILE-002의 AC-V3c가 이메일 로그인 종단을 이미 다루므로 SHELL-001에서 중복 검증할 필요 없음.

#### H-2 — "무회귀(행위 보존)"를 자동으로 falsify할 메커니즘 부재 — 핵심 약속이 수동 회귀에만 의존 (testability, AC-S3 / DoD)
- **위치**: spec.md R-S3(L68), acceptance.md AC-S3(L22-26, "자동(typecheck 0 / 기존 `oauth-bridge` vitest 통과 / `expo export` 번들 OK) + 수동(에뮬레이터)")
- **문제**: 이 SPEC의 본질은 "동작을 한 줄도 바꾸지 않는다"인데, 자동 게이트가 검증하는 것은 (a) typecheck 0, (b) `oauth-bridge` vitest 통과(순수 URL 헬퍼 — 저장소 확인: oauth-bridge.test.ts 9개 `it`), (c) `expo export` 번들 OK 뿐이다. 그러나 (b)의 oauth-bridge 테스트는 `oauth-bridge.ts`의 순수 함수만 검증할 뿐 **추출되는 `App.tsx`/훅의 동작은 한 줄도 커버하지 않는다**(App.tsx에 대한 테스트 파일 부재 — 저장소 확인: 모바일 테스트는 `oauth-bridge.test.ts`·`web-url.test.ts` 2개뿐). 즉 추출 과정에서 핸들러 배선 누락·stale closure·이벤트 누수(OD-2가 인지한 바로 그 리스크)가 발생해도 **자동 게이트는 전부 green으로 통과**한다. typecheck와 번들 성공은 "타입이 맞고 빌드된다"만 보장하지 "동작이 같다"를 보장하지 않는다. 결과적으로 SPEC 전체의 무회귀 약속이 에뮬레이터 수동 1회에만 걸려 있다.
- **수정안**: brownfield 행위 보존 리팩토링이므로 DDD 특성화(characterization) 관점의 자동 게이트를 1개 이상 추가하는 것을 acceptance에 명시한다. 예: 추출된 `useAuthBridge`의 `shouldBridgeOAuth` 분기/`runOAuthBridge` 콜백 경로, `useAppLifecycle`의 백 핸들러 분기(canGoBack true/false)를 RN 의존 최소화한 순수 단위로 테스트(`oauth-bridge.test.ts` 패턴 — expo/RN import 0). 최소한 "추출 전후 `App.tsx`가 `WebViewShell`/훅을 통해 동일한 props/콜백 집합을 전달함"을 타입 수준이 아니라 동작 수준에서 1개 검증. 자동화가 진짜 불가능한 부분(WebView 인스턴스 비리마운트, OAuth 왕복)은 현행대로 수동으로 두되, 이를 DoD에 "자동 불가 — 수동 전용"으로 명시 격리.

---

### MEDIUM

#### M-1 — `apps/web` 무변경 Non-Goal ↔ R-S3 "OAuth 인터셉트→시스템 브라우저" 보존의 검증 책임 분담 불명확 (정합성, Non-Goals L55 / R-S3 / AC-S3)
- **위치**: spec.md Non-Goals L55("웹(`apps/web`) 변경 없음"), R-S3/AC-S3(OAuth 인터셉트→시스템 브라우저 보존)
- **문제**: OAuth 왕복 무회귀를 에뮬레이터 수동으로 확인하려면(AC-S3 검증) 웹 서버(`apps/web`)와 GoTrue가 떠 있어야 하고 호스트 일관성(MOBILE-001 OD-2/OD-3)이 성립해야 한다. SHELL-001은 웹을 변경하지 않지만 OAuth 종단 검증은 웹 환경 의존이다. SPEC은 이 환경 전제(웹 dev 서버 + supabase 로컬 + 호스트 매핑)를 검증 절차에 명시하지 않아, 검증자가 "추출 회귀"와 "환경 설정 실패"를 혼동할 수 있다(MOBILE-001 OD-2가 "가장 흔한 종단 실패"로 경고한 바로 그 지점).
- **수정안**: AC-S3 수동 검증 항목에 환경 전제 한 줄 추가 — "웹 dev 서버 + supabase 로컬 기동 + `EXPO_PUBLIC_WEB_URL` 호스트 일관(MOBILE-001 OD-2/OD-3) 상태에서 OAuth 왕복 회귀를 확인한다. OAuth 실패가 추출 회귀인지 환경 문제인지 분리하려면 추출 전 baseline을 동일 환경에서 먼저 통과시킨다."

#### M-2 — R-S2/AC-S2가 오버레이 컴포넌트 파일명을 고정해 구현을 과도하게 구속 (clarity/over-spec, acceptance.md:20)
- **위치**: acceptance.md AC-S2 L20 — "오버레이 컴포넌트 파일(`LoadingOverlay`/`WebViewErrorOverlay`) 존재", plan.md L15-16 동일 파일명
- **문제**: R-S2(spec.md:67)는 "별도 presentational 컴포넌트로 추출"이라는 행위만 요구하는데, AC-S2의 자동 검증이 특정 파일명 2개(`LoadingOverlay`/`WebViewErrorOverlay`)의 존재를 PASS 조건으로 박았다. 이는 WHAT(분리됨)이 아니라 HOW(파일명)를 acceptance로 강제하는 것으로, MoAI EARS 규약상 요구는 행위/결과여야 한다는 원칙과 충돌한다. 구현자가 `LoadingIndicator`·`ErrorOverlay` 등 다른 이름을 쓰면 동작이 동일해도 AC 실패가 된다.
- **수정안**: AC-S2 자동 검증을 "로딩/에러 오버레이가 `App.tsx`/`WebViewShell` 본문 밖 독립 컴포넌트로 분리되어 import된다(파일명·위치는 구현 재량)"로 완화. 파일명은 plan.md의 권장(non-normative)으로만 남긴다.

#### M-3 — R-S4 자동 검증의 "토큰/세션/SecureStore 코드 부재"가 grep 기반이라 우회 가능 (testability, acceptance.md:32)
- **위치**: acceptance.md AC-S4 L32 — "훅 본문에 토큰/세션/SecureStore 코드 부재"
- **문제**: seam 청결성(OD-3)의 핵심 게이트인데, 검증 방법이 키워드 grep 수준으로만 암시된다. `expo-secure-store` import나 `saveTokens` 호출은 grep으로 잡히지만, 토큰 로직을 변수명만 바꿔 넣거나(예: `cache`), 주석으로 골격을 남기면 통과한다. "부재"를 어떻게 PASS/FAIL 판정하는지 기준이 약하다.
- **수정안**: AC-S4를 구체화 — "(1) 두 훅 파일이 `expo-secure-store`/`@supabase/*`를 import하지 않는다(import 그래프 검사), (2) `package.json`에 `expo-secure-store` 부재(AC-S5의 expo-router 부재 검사와 동일 패턴), (3) 훅의 export 시그니처가 MOBILE-001 동작에 필요한 인자/리턴만 노출한다." import 부재는 grep보다 견고한 negative 게이트.

#### M-4 — depends-on이 in-progress(미완) SPEC인데 진입 게이트 부재 (dependency, HISTORY L16 / plan.md L4)
- **위치**: spec.md HISTORY L16("depends-on: SPEC-MOBILE-001 (in-progress)"), plan.md L4
- **문제**: SHELL-001은 MOBILE-001의 `App.tsx`를 리팩토링하는데, MOBILE-001은 status `in-progress`이며 그 spec.md HISTORY(v0.2.0, L18)는 "**미완(디바이스 필요): R-P2 종단, OD-2** — status=in-progress 유지"라고 명시한다. 즉 MOBILE-001의 종단 동작(OAuth 왕복)이 아직 디바이스 검증 전인데, 그 위에서 "행위 보존"을 약속하는 리팩토링을 시작하면 "보존해야 할 baseline 동작이 아직 검증되지 않은 상태"가 된다. AC-S3 무회귀의 기준선이 불확실하다. SHELL-001 acceptance/plan에는 "MOBILE-001 R-P2 baseline 통과 확인" 같은 진입 게이트가 없다.
- **수정안**: DoD 또는 plan.md에 진입 전제 추가 — "선행: MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline을 추출 전에 동일 환경에서 1회 통과시켜 무회귀 기준선을 고정한다. baseline 미확보 시 AC-S3 무회귀 판정은 불가." (코드 리팩토링 자체는 baseline 미검증 상태로도 작성 가능하나, 무회귀 PASS 선언은 baseline에 의존함을 명시.)

---

### LOW

#### L-1 — Background L23 "Expo ~56.0.6 / RN 0.85.3 / React 19.2.3" 버전이 약식이나 정확 (정확성 확인, Background L23)
- **위치**: spec.md Background L23
- **문제**: 저장소 package.json 확인 결과 `expo ~56.0.6`, `react-native 0.85.3`, `react 19.2.3` 모두 정확히 일치(package.json:7,13,12). 결함 아님 — 정확성을 긍정 확인으로 기록한다. (NIT 수준: 버전을 본문에 박으면 향후 드리프트 위험이 있으나 현재는 정확.)

#### L-2 — AC-S5 "package.json 에 expo-router 없음" 검증은 양호하나 `index.ts` 진입 불변 검증 방법 미명시 (testability, acceptance.md:38)
- **위치**: acceptance.md AC-S5 L38
- **문제**: "`index.ts` 진입 불변"을 어떻게 자동 확인하는지 방법이 없다. `index.ts`는 `registerRootComponent(App)` 한 줄 구조(저장소 확인)이므로, 추출 후에도 `App.tsx` default export를 `index.ts`가 그대로 등록하는지 확인하면 된다.
- **수정안**: "`index.ts`가 여전히 `./App`의 default export를 `registerRootComponent`로 등록(diff 부재)"로 구체화. 경미.

#### L-3 — HISTORY 두 항목이 모두 동일 날짜·동일 버전(v0.1.0)이라 split 이력 추적이 평면적 (문서, HISTORY L16-17)
- **위치**: spec.md HISTORY L16-17
- **문제**: split 근거는 잘 기술됐으나 두 항목 모두 "2026-06-09 (v0.1.0)"로 동일해, 어느 것이 최초 작성이고 어느 것이 split 기록인지 시간 순서가 드러나지 않는다. 경미.
- **수정안**: 두 번째 항목을 첫 항목의 하위 불릿으로 병합하거나, split 기록을 본문 한 줄로 흡수. 영향 없음.

---

## EARS 체크리스트

| 요구 | 패턴 | 라벨 적정 | 단일 관심사 | 테스트 가능 | 비고 |
|------|------|-----------|-------------|-------------|------|
| R-S1 | Ubiquitous | OK | OK | OK(typecheck+import) | generic prop 셋 명확 |
| R-S2 | Ubiquitous | OK | OK | △(파일명 과구속 — M-2) | |
| R-S3 | Ubiquitous(사실상 불변식) | OK | △(보존 동작 다수 열거 — 본질상 불가피) | △(무회귀 자동 게이트 약함 — H-2) | |
| R-S4 | Ubiquitous | OK | OK | △(부재 grep — M-3) | seam 명시 우수 |
| R-S5 | Unwanted("SHALL NOT") | OK | OK | OK(negative 게이트) | |

## R↔AC 매핑 체크리스트

| R | AC | 1:1 | ID 일치 | 비고 |
|---|----|----|---------|------|
| R-S1 | AC-S1 | OK | OK | |
| R-S2 | AC-S2 | OK | OK | M-2 |
| R-S3 | AC-S3 | OK | OK | DoD가 R에 없는 "이메일 로그인" 추가 — H-1 |
| R-S4 | AC-S4 | OK | OK | M-3 |
| R-S5 | AC-S5 | OK | OK | L-2 |

- orphan AC: 없음
- uncovered R: 없음
- DoD ↔ AC 불일치: 1건(H-1, "이메일 로그인")

## 내부 정합성 체크리스트

- 모듈 ≤5: OK(M1 단일 모듈, R-S1~S5)
- DELTA 마커(`[NEW]`/`[MODIFY]`/`[EXISTING]`): 일관 사용. R-S1·S2·S4 `[NEW]`, R-S3·S5 `[MODIFY]`. OK
- depends-on 체인: SPEC-MOBILE-001(in-progress) — baseline 진입 게이트 미흡(M-4)
- MOBILE-002와의 split 정합: SHELL-001이 가드레일 1·4, MOBILE-002가 2·3을 보유한다는 분담이 양쪽 SPEC에서 일치(MOBILE-002 HISTORY L17과 대조 확인). OK
- 제거/개명된 요구 참조: 없음

## 코드 인용 검증(저장소 직접 대조)

| SPEC 인용 | 저장소 실제 | 판정 |
|-----------|-------------|------|
| `App.tsx` 인라인 관심사 7종(Background L26-36) | App.tsx 전부 일치 | 정확 |
| WebView `key` 미부여 주석 "line 114"(OD-1) | App.tsx:114 주석 일치 | 정확 |
| `react-native-webview` 13.16.1 보유 | package.json:14 일치 | 정확 |
| `scheme: "moyura"`, `main: index.ts` 불변 | app.json/index.ts 일치 | 정확 |
| `oauth.ts`/`oauth-bridge.ts` 함수(shouldBridgeOAuth 등) | 일치 | 정확 |
| `WEB_URL` @MX:ANCHOR | web-url.ts:36-40 일치 | 정확 |

코드 인용 드리프트: **0건**. 이 SPEC은 코드 사실 정확성이 매우 높다.

---

## Faithfulness (Confirmed intent 대조)

- 행위 보존(무회귀) 리팩토링 한정, 토큰 로직 0, 가드레일 1·4 소유, generic WebViewShell, 훅 분리(seam), expo-router 미도입, 단일 화면, oauth.ts/web 무변경 — **확정 의도와 정확히 일치한다.**
- silent scope expansion: 1건(H-1, DoD의 "이메일 로그인"). 의도 위반은 아니나 acceptance 경계를 넘음.
- 누락된 confirmed-intent 흐름: 토큰/핸드셰이크 관련은 전부 MOBILE-002 범위이므로 SHELL-001 누락 아님(올바른 분리).

**이 SPEC은 confirmed intent를 충실히 반영하는가: YES** (H-1 DoD 항목 정리 권장).

---

## 우선순위 수정 리스트

1. **(H-1)** DoD L46에서 "이메일 로그인" 제거(추출과 무관, AC/R에 없음) — 또는 R-S3/AC-S3에 동기화.
2. **(H-2)** 무회귀 자동 게이트 1개 이상 추가(추출 훅 분기의 순수 단위 테스트, oauth-bridge.test.ts 패턴) + 자동 불가 항목을 "수동 전용"으로 DoD 격리.
3. **(M-4)** MOBILE-001 R-P2 baseline 진입 게이트를 DoD에 명시(무회귀 기준선 고정).
4. **(M-1)** AC-S3 수동 검증에 웹/supabase 환경 전제 + 추출 전 baseline 한 줄 추가.
5. **(M-3)** AC-S4 seam 게이트를 import-부재 + package.json 부재로 구체화.
6. **(M-2)** AC-S2 파일명 과구속 완화(행위 기준으로).
7. **(L-2, L-3)** index.ts 불변 검증 구체화, HISTORY 평면 이력 정리.

감사자 메모: 행위 보존 리팩토링 SPEC으로서 상위 수준이다. 코드 인용이 모두 정확하고 seam 의도가 명확하다. 단 하나 본질적 약점은 "무회귀"라는 약속을 측정 가능하게 만드는 게이트가 typecheck/번들/무관한 vitest에만 의존한다는 점(H-2)이며, 이는 brownfield 리팩토링에서 가장 흔히 누락되는 보호선이다.

---
---

## Re-audit (round 2) — 2026-06-09

> M1 Context Isolation 유지: round-1 작성자/리미디에이션 작성자의 추론 컨텍스트는 무시했다. 현행 spec.md/acceptance.md/plan.md + 저장소(read-only, 직접 재대조)만 근거로 독립 재판정한다. 호출자가 전달한 round-1 finding 요약과 "confirmed intent"는 closure 대조 기준으로만 사용했다.
> 적대적 입장 유지: 리미디에이션이 불완전하거나 새 결함을 만들었다는 가정 하에 반증을 시도했다. 모든 코드 인용을 라이브 소스(`App.tsx`, `oauth.ts`, `oauth-bridge.ts`, `web-url.ts`, `app.json`, `index.ts`, `package.json`, `oauth-bridge.test.ts`)로 재확인했다.

### Round-1 finding 별 closure 표

| ID | 심각도 | 판정 | 증거(file:line) |
|----|--------|------|------------------|
| H-1 | HIGH | **CLOSED** | DoD 의 "이메일 로그인" 무회귀 항목 제거 확인 — acceptance.md:56 가 "(이메일 로그인은 본 추출과 무관 … MOBILE-002 AC-V3c 가 종단 검증하므로 본 SPEC 무회귀 게이트에서 제외)"로 명시적 제외. AC-S3(acceptance.md:23)·R-S3(spec.md:69) 보존 동작 목록에 이메일 로그인 없음(일관). 라이브 `App.tsx` 는 이메일 로그인 코드 0(주석 L4 "이메일/비번 로그인은 WebView 안에서 브리지 없이")—제외가 사실과 일치. |
| H-2 | HIGH | **CLOSED** | 신규 R-S6(spec.md:72) + AC-S6(acceptance.md:41-47) 도입. 추출 훅 분기별 최소 1개 자동 단위 테스트 요구(`useAuthBridge` shouldBridgeOAuth true/false·runOAuthBridge authenticated/cancelled/error, `useAppLifecycle` back canGoBack true/false), `oauth-bridge.test.ts` 패턴(expo/RN import 0) 명시. 자동 불가 항목(WebView 비리마운트·OAuth 왕복)을 DoD(acceptance.md:56)에서 "자동 불가 — 수동 전용"으로 격리. 라이브 `oauth-bridge.test.ts` 가 동일 패턴(순수 함수, vitest node)임을 확인 — 패턴 실재. |
| M-1 | MEDIUM | **CLOSED** | AC-S3 환경 전제 추가 확인 — acceptance.md:26 "웹 dev 서버 기동 + 로컬 supabase 기동 + EXPO_PUBLIC_WEB_URL 호스트 일관(MOBILE-001 OD-2/OD-3) … 추출 전 동일 환경에서 baseline … 1회 통과시켜 무회귀 기준선을 고정". |
| M-2 | MEDIUM | **CLOSED** | AC-S2 파일명 과구속 완화 확인 — acceptance.md:19-20 "파일명·위치는 구현 재량 … 파일명은 검증 대상 아님 — 분리·import 여부만 판정". plan.md:17-18 이 `LoadingOverlay`/`WebViewErrorOverlay` 를 **non-normative** 권장명으로 강등. |
| M-3 | MEDIUM | **CLOSED** | AC-S4 seam 게이트 구체화 확인 — acceptance.md:33 (1)`expo-secure-store`/`@supabase/*` import 부재(import 그래프), (2)`package.json` `expo-secure-store` 부재, (3)훅 export 시그니처에 토큰/세션 인자·리턴 부재. grep 의존에서 import-부재 negative 게이트로 전환. |
| M-4 | MEDIUM | **CLOSED** | MOBILE-001 R-P2 baseline 진입 게이트 추가 확인 — DoD(acceptance.md:53) "진입 전제(M-4): MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline 을 추출 전 … 1회 통과 … baseline 미확보 시 AC-S3 무회귀 판정 불가". plan.md:13 동일 게이트 명시. |
| L-1 | LOW | **CLOSED(무변경 적절)** | Background L24 의 버전 표기(Expo ~56.0.6/RN 0.85.3/React 19.2.3)는 라이브 `package.json`(L7/L13/L12)과 정확 일치. round-1 에서 결함 아닌 긍정 확인이었고 리미디에이션 불요. |
| L-2 | LOW | **CLOSED** | AC-S5 index.ts 불변 구체화 확인 — acceptance.md:39 "index.ts 가 여전히 ./App 의 default export 를 registerRootComponent 로 등록(diff 부재)". 라이브 `index.ts` 가 `import App from './App'` + `registerRootComponent` 구조임을 확인 — 검증 기준이 실제 구조와 일치. |
| L-3 | LOW | **CLOSED** | HISTORY 평면 이력 정리 확인 — spec.md:17 split 기록을 최초 항목의 하위 불릿으로 병합, spec.md:18 에 "[audit remediation applied]" 항목을 별도로 추가해 작성→split→리미디에이션 순서가 드러남. |

**집계: CLOSED 8 / PARTIAL 0 / NOT-CLOSED 0** (round-1 finding 8건 전부 closed).

### 리미디에이션이 새로 도입한 결함 점검

신규 결함: **없음(BLOCKER/HIGH/MEDIUM 0)**. 다음 항목을 적대적으로 점검해 새 문제가 없음을 확인했다.

- **R↔AC 1:1 유지(6/6)**: R-S1↔AC-S1 … R-S6↔AC-S6. 신규 R-S6/AC-S6 추가로 5→6 쌍, orphan AC 0·uncovered R 0. 카운트 재확인 PASS.
- **R-S6 EARS 유효성**: 라벨 `Ubiquitous`("The … hooks SHALL be covered by at least one AUTOMATED unit test per branch") 적정 — 시스템 불변 속성 서술. 단일 관심사(추출 훅 자동 특성화 게이트), 테스트 가능(vitest 분기 커버), `[NEW]` 마커 정확(신규 테스트 파일). 라벨 드리프트 없음.
- **DoD↔AC 정합 회복**: round-1 의 유일한 DoD↔AC 불일치(H-1 이메일 로그인)가 제거되어 DoD(acceptance.md:53-60) 의 모든 항목이 AC-S1~S6 또는 OD 로 추적됨.
- **인용 드리프트 0 유지**: 리미디에이션 본문이 추가한 코드 언급(`registerRootComponent`/`./App` default export, oauth-bridge.test.ts 패턴, `expo-secure-store` 부재)을 라이브 소스로 재대조 — 전부 정확. round-1 의 "코드 인용 드리프트 0"이 round-2 에서도 유지됨.
- **모듈 수 ≤5 유지**: 단일 모듈 M1(R-S1~S6). 요구가 5→6 으로 늘었으나 모듈 수는 1 — 제약 충족.
- **seam 게이트 강화의 부작용 없음**: AC-S4 가 "훅 export 시그니처에 토큰/세션 인자·리턴 부재"를 요구(acceptance.md:33). 이는 MOBILE-002 가 채울 seam 과 충돌하지 않음 — MOBILE-002 는 훅을 `[EXTEND]`(시그니처 추가)하므로, "SHELL-001 시점의 훅에 토큰 시그니처 부재"와 "MOBILE-002 가 이후 토큰 시그니처 추가"는 시점이 달라 모순 아님. (경계가 명확히 분리됨.)

### 갱신된 체크리스트

EARS 체크리스트(round-2):

| 요구 | 패턴 | 라벨 적정 | 단일 관심사 | 테스트 가능 | 비고 |
|------|------|-----------|-------------|-------------|------|
| R-S1 | Ubiquitous | OK | OK | OK | generic prop 셋 명확 |
| R-S2 | Ubiquitous | OK | OK | OK(분리·import — 파일명 과구속 해소) | M-2 CLOSED |
| R-S3 | Ubiquitous(불변식) | OK | △(보존 동작 다수 — 본질상 불가피) | OK(AC-S6 자동 분기 + 수동 종단 명시 격리) | H-1/H-2 CLOSED |
| R-S4 | Ubiquitous | OK | OK | OK(import-부재 negative 게이트) | M-3 CLOSED |
| R-S5 | Unwanted | OK | OK | OK(negative + index.ts diff 부재) | L-2 CLOSED |
| R-S6 | Ubiquitous | OK | OK | OK(vitest 분기 커버) | 신규 — 유효 |

R↔AC 매핑(round-2): R-S1↔AC-S1, R-S2↔AC-S2, R-S3↔AC-S3, R-S4↔AC-S4, R-S5↔AC-S5, R-S6↔AC-S6 — **6/6 1:1, orphan 0, uncovered 0, DoD 불일치 0.**

코드 인용 검증(round-2 재대조): `App.tsx` 7종 관심사·`key` 미부여 주석 L114·`oauth.ts`(shouldBridgeOAuth L109/bridgeGoogleOAuth L121/resolveWebCallbackUrl L136)·`web-url.ts` WEB_URL L40 @MX:ANCHOR L36·`app.json` scheme L7·`index.ts` registerRootComponent(./App)·`package.json` rn-webview 13.16.1 L14 — **드리프트 0.**

### Chain-of-Verification Pass (round-2)

2차 자기비판으로 다음을 재확인했다: (1) R-S1~S6 6개 항목을 모두 끝까지 읽음(스킵 없음). (2) R 번호 시퀀스 S1~S6 연속, gap/중복 0. (3) 6개 R 전부 AC 추적 확인(샘플링 아님). (4) Non-Goal(spec.md:53-57) 의 "이메일 로그인 무관" 가정을 라이브 `App.tsx`(이메일 로그인 코드 0)로 검증. (5) 요구 간 모순 점검 — AC-S4 seam 게이트 vs MOBILE-002 EXTEND 경계가 시점 분리로 비모순임을 추가 확인. 새 결함 없음.

### Regression Check (round-2)

round-1 finding 8건(H-1·H-2·M-1~M-4·L-1~L-3): **전부 RESOLVED**. stagnation/blocking defect 없음. 미해결로 이월된 항목 없음.

### Fresh Verdict (round-2)

**PASS** — round-1 의 모든 finding(HIGH 2·MEDIUM 4·LOW 3)이 증거 기반으로 closed 되었고, 리미디에이션이 새 결함(BLOCKER/HIGH/MEDIUM)을 도입하지 않았다. 핵심 약점이었던 "무회귀 자동 falsify 게이트 부재"(H-2)가 R-S6/AC-S6 으로 닫혔고, DoD 경계 초과(H-1)가 정리됐다. R↔AC 1:1(6/6), 코드 인용 드리프트 0, 모듈 ≤5, EARS 라벨 정확, confirmed intent(행위 보존·토큰 0·seam·가드레일 1·4) 충실. **`/moai run SPEC-WEBVIEW-SHELL-001` 착수 가능.** (Run 시점 운영 전제: DoD 의 MOBILE-001 R-P2 baseline 고정은 코드 작성과 별개로 무회귀 PASS 선언의 조건임 — SPEC 결함 아님, 진입 게이트로 정상 문서화됨.)
