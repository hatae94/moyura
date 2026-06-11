# SPEC-MOBILE-002 독립 감사 보고서 (plan-auditor)

> M1 Context Isolation: 작성자(manager-spec/orchestrator)의 추론 컨텍스트는 무시했다. spec.md / acceptance.md / plan.md + 저장소(read-only) + 의존 SPEC(MOBILE-001, WEBVIEW-SHELL-001) spec.md 만 근거로 독립 판정한다. 호출자의 "Confirmed user intent"는 faithfulness 비교의 ground truth 로만 사용했다.
> 적대적 입장(adversarial): "이 SPEC에는 결함이 있다"를 기본 가정으로 두고 증거로 반증을 시도했다.
> 검증 일자: 2026-06-09. 모든 저장소 인용은 실제 파일을 읽어 확인했다. SPEC의 코드 주장은 신뢰하지 않고 직접 대조했다.

---

## Verdict

**FAIL** — 아키텍처 비전(웹 단일 세션 권위 + 네이티브 토큰 캐시 + 버전드 브리지 + PII 최소화)은 잘 설계됐고 OD-4 역전 문서화도 정직하다. 그러나 인증 SPEC의 본질에서 다음 **BLOCKER 2건**이 미충족이다: (B-1) **코드 인용 드리프트** — `me/page.tsx`가 사용하는 것은 `getSession()`인데 SPEC은 핵심 가드 동작을 부정확하게 인용하며, 더 치명적으로 **저장소에 `getSession()`만 존재하고 SPEC의 핸드셰이크가 전제하는 "웹이 setSession 후 최신 토큰을 회신"할 client-side 세션 읽기 경로의 실재 여부를 SPEC이 확인하지 않음**; (B-2) **핸드셰이크/주입 race·실패·타임아웃 경로 전면 부재** — 콜드스타트 핸드셰이크가 영원히 회신을 못 받으면 스플래시가 무한 유지되는데(R-N4가 "결과 수신 시 숨김"만 규정), 타임아웃/실패 시 스플래시 강제 해제 요구가 없다. 추가로 HIGH 다수(자동화 불가 AC가 자동으로 표기됨, 웹 setSession 경로의 실제 클라이언트 부재, signOutAction redirect 타이밍 미해결).

한 줄 요약: 설계 의도는 훌륭하나, "토큰이 JS 브리지를 건너는 보안 핸드셰이크"의 **실패·경합·타임아웃 계약과 웹 측 실재 검증**이 비어 있어 인증 파운데이션 SPEC으로서 미완이다.

---

## 심각도별 카운트

- BLOCKER: 2
- HIGH: 4
- MEDIUM: 5
- LOW: 3

---

## What's good (강점)

- **OD-4 역전 문서화 정직**: HISTORY L18이 MOBILE-001 OD-4("네이티브 토큰 저장소 미도입")를 명시적으로 역전함을 기록하고, revisitable 결정(OD-1)으로 마이그레이션 경로까지 1줄로 남김. 의도와 정확히 일치. MOBILE-001 spec.md OD-4(역전 대상)와 oauth.ts:3-15 주석(OD-4 "둘 다 미도입") 모두 대조 확인 — 역전의 출처가 실재.
- **PII 최소화 설계**: R-T1/OD-4가 브리지 payload를 access/refresh 토큰만으로 제한하고 `userId`는 JWT `sub` 디코드로 처리 — confirmed intent와 정확히 일치하며 AC-T1 자동 검증("payload 타입에 `userId`/프로필 필드 부재")으로 falsifiable.
- **웹 가드(가드레일 3) 정확**: R-T4/AC-T4의 `if (window.ReactNativeWebView)` 가드는 순수 웹 무영향을 보장. 저장소 확인 결과 현재 `apps/web` 어디에도 `ReactNativeWebView` 참조가 없어(grep 0건) 신규 추가가 맞고, Non-Goal("신규 웹 라우트 0")과 일관.
- **버전드 스키마(가드레일 2)**: OD-6의 `{version, type, payload}` + unknown type 무시 + version 불일치 graceful degrade는 additive 확장성 요구를 충족. 5개 type 보장이 AC-T1로 고정됨.
- **대부분의 코드 인용 정확**: `actions.ts:14 CALLBACK_URL`(확인), `:79-99 signInWithOAuthAction`(확인), `:69-73 signOutAction`(L69-73 — `signOut()` + `redirect("/login")` 확인), `config.toml:155-169`(redirect allowlist 확인), `route.ts` 주석 `127.0.0.1` 드리프트(route.ts:4 실제 `127.0.0.1` — 확인), `package.json` `expo-secure-store` 누락(확인) — 모두 일치.
- **split 정합**: 가드레일 1·4는 SHELL-001, 2·3은 MOBILE-002라는 분담이 양쪽 SPEC에서 일치(SHELL-001 spec.md와 대조). 모듈 재번호(M2→M1 등) 기록도 일관.

---

## Findings (심각도순)

### BLOCKER

#### B-1 — 핸드셰이크가 전제하는 웹 측 "setSession 후 최신 토큰 회신" 경로의 실재를 SPEC이 검증하지 않음 + `me/page.tsx` 가드 인용 부정확 (정합성/feasibility, R-T3 / Sources L124)
- **위치**: spec.md R-T3(L83), Sources L124("`apps/web/app/me/page.tsx:19-25` — `supabase.auth.getSession()` 없으면 `redirect("/login")`"), Background L34("`me/page.tsx:23-25`")
- **문제**:
  1. **인용 라인 드리프트**: SPEC은 두 곳에서 `me/page.tsx:19-25`(Sources)와 `:23-25`(Background)로 서로 다르게 인용한다. 저장소 확인 결과 `getSession()`은 L19-21, `redirect("/login")`은 L23-24다. 사소하나 같은 사실을 두 줄범위로 적은 trace 불일치.
  2. **더 본질적 공백**: R-T3는 "웹이 `supabase.auth.setSession({access_token, refresh_token})`로 검증/갱신한 뒤 **최신 `{access, refresh}`를 네이티브로 회신**한다"고 요구한다. 그러나 `setSession()` 호출 주체는 **브라우저 컨텍스트의 client 클라이언트**여야 한다(WebView 내부 JS). 저장소 확인: `apps/web/lib/supabase/client.ts`는 `createBrowserClient`를 제공하지만, **현재 이를 호출하는 client-side 세션 조작 코드는 어디에도 없다**(`me/page.tsx`·`actions.ts`는 전부 server 클라이언트/Server Action). 즉 "setSession 후 최신 토큰을 읽어 postMessage로 회신"하는 경로는 **완전 신규**인데, SPEC은 이를 "기존 웹 가드 재사용 + 브리지 한 곳"으로 과소평가한다. setSession 후 갱신된 토큰을 어떻게 얻는지(`onAuthStateChange` 구독 vs `getSession()` 재호출 vs setSession 리턴값)가 R-T3에 명시되지 않아 구현자가 임의 해석한다. 또한 `setSession()`이 쿠키와 client 세션을 어떻게 동기화하는지(@supabase/ssr 0.10.3 browser 클라이언트는 document.cookie 폴백 — client.ts:3-5 주석), 그리고 그 쿠키가 `me/page.tsx`의 server `getSession()`과 일관되는지가 검증되지 않았다. 이 경로가 깨지면 핸드셰이크 전체가 무효다.
- **수정안**:
  - R-T3에 회신 토큰 획득 메커니즘 명시 — "웹은 `setSession()` 리턴(또는 직후 `onAuthStateChange`)에서 갱신된 `{access_token, refresh_token}`를 읽어 `session:synced`로 회신한다." Open Decision로 "setSession 리턴값 vs onAuthStateChange vs getSession 재호출"을 노출.
  - Sources/Background의 `me/page.tsx` 인용을 `getSession()` L19-21 / `redirect` L23-24로 통일.
  - acceptance에 "웹 client 클라이언트(`lib/supabase/client.ts`)로 브라우저 컨텍스트에서 setSession을 호출하고, 그 결과 쿠키가 server `getSession()`(me/page.tsx)과 일관됨"을 검증 항목으로 추가(현재 client.ts는 미사용 — 신규 wiring 필요함을 명시).

#### B-2 — 핸드셰이크/주입의 실패·타임아웃·race 경로 전면 부재 → 스플래시 무한 유지·half-auth 위험 (completeness/안정성, R-N3·N4 / R-T2·T3 / OD-8)
- **위치**: spec.md R-N4(L76, "핸드셰이크 결과 수신 시 스플래시 숨김"), R-N3(L75), R-T2(L82), plan.md L45("SecureStore 비동기 — 콜드스타트 race 주의"), L60("주입 시점 race"), L75("AppState 과다 발화 debounce 필요")
- **문제**: 확정 의도(prompt)는 "handshake failure/timeout, token-injection race, setSession failure handling, splash-hide on error, AppState debounce"를 명시적으로 다뤄야 할 흐름으로 열거한다. 그러나:
  1. **R-N4는 "결과 수신 시 숨김"만 규정** — 결과를 영영 못 받으면(웹 미응답, 브리지 핸들러 미등록 race, 네트워크 단절) 스플래시가 무한 유지된다. **타임아웃 후 강제 스플래시 해제** 요구가 없다. R-U4(MOBILE-001) 같은 복구 가능 에러 화면으로의 폴백도 R-N4에 없다.
  2. **주입 race**: R-T2는 "WebView가 로딩 완료 시 주입"이라지만, plan.md L60이 인지한 "onLoadEnd ↔ 웹 bridge handler 등록 순서 race"를 다루는 **요구가 없다**(handler 미등록 시 `session:restore`가 유실됨). 재시도/ack 메커니즘 부재.
  3. **setSession 실패 처리**: R-T3는 "valid/refreshed → synced, empty/expired → none"만 분기한다. `setSession()`이 **네트워크 오류/예외**로 실패하는 경우(refresh 자체가 throw)는 synced도 none도 아니다 — 이 경로가 미정의라 스플래시 무한 유지 또는 미정의 동작.
  4. **AppState debounce**: plan.md L75가 "과다 발화 debounce 필요"를 인지하지만 R-R1에는 debounce/중복 억제 요구가 없다 — resume마다 토큰을 중복 주입/재검증하면 토큰 경합 위험.
  - plan.md 위험란이 이 4가지를 모두 "인지"하지만, **요구(R)·AC로 승격되지 않아** 구현자가 처리하지 않아도 SPEC 위반이 아니게 된다. 인증 핸드셰이크에서 실패/타임아웃은 happy-path만큼 중요한 정규 요구다.
- **수정안**: M1/M2/M3에 신규 요구 추가 —
  - `R-N6 (Unwanted/If-then)`: *If the cold-start handshake does not return a result (synced/none/cleared) within a bounded timeout, then the shell shall hide the splash and fall back to the existing web guard routing (never keep the splash indefinitely).*
  - `R-T7 (Unwanted)`: *If the web bridge handler is not yet registered when native injects `session:restore`, then native shall retry injection (bounded) or the web shall buffer/ack so the message is not silently lost.*
  - `R-T3` 보강: setSession 예외(네트워크/throw) → `session:none`(또는 별도 error type) + 스플래시 해제 + 로그인 폴백 명시.
  - `R-R1` 보강: AppState `active` 전이는 debounce/직전 상태 비교로 중복 재검증을 억제한다.
  - 각각 대응 AC(타임아웃 시 스플래시 해제, handler 미등록 시 미유실, setSession throw 시 폴백, resume 중복 억제) 추가.

---

### HIGH

#### H-1 — 자동화 불가 AC가 "자동 검증" 가능으로 표기됨 — apps/web 무 테스트 하니스 (verifiability, AC-T3·AC-N3·AC-R1 등)
- **위치**: acceptance.md 헤더 L4("검증 채널: 자동(typecheck / vitest / `expo export`)"), AC-T2 L57("자동(주입 페이로드 빌더 순수 함수 vitest)"), AC-T3 L63, AC-R1 L91("자동(AppState 핸들러 분기 vitest 가능 부분)")
- **문제**: 저장소 확인 — `apps/web`에는 **테스트 하니스가 전혀 없다**(package.json scripts: `dev/build/start/lint`만, vitest/jest 의존성·설정 0건). 따라서 **웹 측 브리지 동작(R-T3 setSession 분기, R-T4 가드 false 분기, R-R2 logout emit)은 자동 테스트가 불가능**하다. AC-T4 L69("가드 false 분기 단위 테스트")·AC-R2 L97("가드된 `session:cleared` emit 존재")는 웹 코드 검증을 함의하는데 실행할 러너가 없다. acceptance.md L4가 "`apps/web`은 무관, `apps/mobile`은 vitest"라고 단서를 달지만, AC 본문들은 여전히 웹 동작에 "자동 검증"을 부여한다. 이는 검증 불가능한 약속이다.
- **수정안**: 웹 측 AC(T3·T4·R2의 웹 부분)를 "자동"에서 분리 — `apps/mobile` 순수 로직(bridge-protocol 직렬화/파싱, origin 매칭, 메시지 핸들러 분기, 페이로드 빌더)만 vitest 자동으로 두고, **웹 브리지 동작은 빌드(typecheck/`next build`) + 수동 종단**으로 명시. acceptance.md DoD L138의 "vitest 전량 통과"가 웹을 포함하지 않음을 명확히. (web-no-test-harness 환경 사실과 일치시킬 것.)

#### H-2 — logout emit 타이밍이 미해결 Risk로만 존재 — R-R2가 falsifiable하지 않음 (testability/feasibility, R-R2 / plan.md L75)
- **위치**: spec.md R-R2(L91), plan.md L75("로그아웃 emit 타이밍 — `signOutAction`이 `redirect("/login")`하므로 클라이언트 emit 시점 확보 주의")
- **문제**: 저장소 확인 — `signOutAction`(actions.ts:69-73)은 **Server Action**이고 `await signOut()` 직후 `redirect("/login")`한다(서버 redirect). 클라이언트 `window.ReactNativeWebView.postMessage(session:cleared)`는 브라우저 컨텍스트에서 일어나야 하는데, Server Action redirect는 클라이언트 JS 실행 기회를 주지 않고 페이지를 전환한다. plan.md가 이 충돌을 인지하지만 R-R2는 단지 "로그아웃 시 `session:cleared` post"라고만 해서 **언제·어디서(server redirect 전 client hook? me/page.tsx의 logout form? signOut 후 /login 도착 시점?)** post하는지가 미정이다. 구현 경로가 불확정이라 R-R2는 PASS/FAIL 판정이 불가하고, 잘못 구현하면 emit이 유실돼 네이티브 SecureStore가 영영 클리어되지 않는다(stale 토큰 잔존 = 보안 약점).
- **수정안**: R-R2에 emit 지점 확정 또는 Open Decision 노출 — 예: "로그아웃 emit은 server redirect와 경합하지 않도록, `/login` 도착 후 client에서 `window.ReactNativeWebView` 가드로 1회 post한다(또는 me 페이지의 logout 버튼 client handler에서 signOut 전 post)." 대응 AC를 "로그아웃 후 네이티브 onMessage가 `session:cleared`를 수신하고 clearTokens 실행"으로 종단 검증(수동)으로 명시.

#### H-3 — origin allowlist(R-T6)가 resume 재주입(R-R1)에 적용되는지 불명확 — re-inject 시 origin 미검증 누수 위험 (보안, R-R1 / R-T6)
- **위치**: spec.md R-R1(L90, resume 시 토큰 주입), R-T6(L86, "주입 전 origin 검증 — 콜드스타트 맥락")
- **문제**: R-T6는 origin allowlist를 "WebView가 신뢰 `WEB_URL` origin이 아니면 주입 금지"로 규정하나, 문맥이 **콜드스타트 주입(R-T2)** 중심이다. R-R1(resume 재주입)은 origin 검증을 **명시적으로 재참조하지 않는다**. 그런데 resume 시점은 위험이 더 크다 — 사용자가 WebView 안에서 외부 링크(OAuth 후 third-party, 또는 임의 네비게이션)로 이동한 상태에서 백그라운드 갔다가 돌아오면, **현재 origin이 신뢰 origin이 아닐 수 있다**. R-R1이 origin 재검증 없이 토큰을 주입하면 third-party 페이지로 토큰 유출(OWASP). 확정 의도(prompt)도 "missing origin check on resume re-inject"를 명시적 gap 후보로 지목한다.
- **수정안**: R-R1에 "resume 재주입도 R-T6 origin allowlist를 먼저 통과해야 한다(현재 origin이 신뢰 `WEB_URL`이 아니면 주입 금지)"를 명시. 대응 AC를 AC-T6의 origin 매칭 순수 함수가 resume 경로에도 적용됨으로 확장.

#### H-4 — frontmatter `priority: medium` ↔ depends-on 미완(in-progress×2) + 본문 "핵심 핸드셰이크" 성숙도 불일치 (정합성, frontmatter L8 / HISTORY)
- **위치**: spec.md frontmatter L8(`priority: medium`), HISTORY L16(depends-on MOBILE-001 in-progress AND SHELL-001 draft)
- **문제**: 이 SPEC은 토큰 캐시·세션 핸드셰이크라는 보안 민감 파운데이션인데 priority가 `medium`이다(MOBILE-001도 medium, SHELL-001은 high). 우선순위 자체는 작성자 재량이나, plan.md가 M2를 "Priority High (핵심 핸드셰이크)"로 표기(plan.md L49)하는 것과 frontmatter `medium`이 불일치한다. 또한 depends-on 두 SPEC이 모두 미완(MOBILE-001 in-progress, SHELL-001 draft)인데 진입 게이트는 DoD L137("선행: SHELL-001 완료")에 SHELL-001만 있고 **MOBILE-001 baseline(R-P2 디바이스 검증, MOBILE-001 spec.md L18 미완)** 전제는 없다 — MOBILE-002 AC-V1(OAuth 무회귀)의 기준선이 미확정.
- **수정안**: frontmatter priority를 plan.md M2와 정합(high 검토) 또는 plan.md를 medium으로 정정. DoD에 MOBILE-001 R-P2 baseline 통과를 SHELL-001과 함께 진입 전제로 추가.

---

### MEDIUM

#### M-1 — R-N4 "핸드셰이크 결과(synced/none/cleared)"에 `cleared`가 콜드스타트 결과로 포함되는 의미 모호 (clarity, R-N4 / AC-N4)
- **위치**: spec.md R-N4(L76), acceptance.md AC-N4(L32, "`session:synced`/`session:none`/`session:cleared` 수신 시 스플래시 숨김")
- **문제**: `session:cleared`는 R-R2 기준 **로그아웃 시** 웹→네이티브 메시지다. 콜드스타트 핸드셰이크 결과로 `cleared`가 오는 시나리오가 무엇인지 불명확(콜드스타트에 로그아웃이 동시 발생?). 콜드스타트 결과는 논리적으로 synced/none 둘이어야 자연스럽다. `cleared`를 콜드스타트 스플래시 해제 트리거에 넣은 것은 over-inclusive하거나 의미 누락.
- **수정안**: R-N4를 "콜드스타트 핸드셰이크 결과는 `synced` 또는 `none`이며, 둘 중 하나 수신 시 스플래시를 숨긴다"로 정정. `cleared`는 R-R 그룹(로그아웃)에만 둔다. 또는 cleared가 콜드스타트에 유효한 경로를 명시.

#### M-2 — R-N1이 한 요구에 `expo-secure-store`만 선언하나 plan.md는 `expo-splash-screen`도 추가 — 의존성 누락 trace (정합성, R-N1 / plan.md L40 / OD-8)
- **위치**: spec.md R-N1(L73, `expo-secure-store`만), plan.md L40("추가로 `npx expo install expo-splash-screen`"), OD-8(L113, 스플래시 메커니즘 `expo-splash-screen`)
- **문제**: 스플래시(R-N3/N4)는 `expo-splash-screen` 의존성을 요구하는데(OD-8/plan.md 인정), **R-N1은 `expo-secure-store`만 선언 요구**한다. AC-N1(L12-16)도 `expo-secure-store`만 검증한다. `expo-splash-screen` 의존성 도입이 어떤 R/AC에도 정규 요구로 없어, 의존성 trace에 구멍이 있다(스플래시는 R-N3/N4가 동작으로만 요구).
- **수정안**: R-N1을 "`expo-secure-store` AND `expo-splash-screen`(둘 다 SDK 56 핀)"으로 확장하거나, 스플래시 의존성 신규 요구(R-N1b)를 추가. AC-N1에 `expo-splash-screen` 존재 검증 추가.

#### M-3 — R-T1/AC-T1의 5개 type이 "최소"라면서 type 집합 닫힘 여부 미정 (clarity/testability, R-T1 / AC-T1)
- **위치**: spec.md R-T1(L81, "at least the types ..."), acceptance.md AC-T1(L49, "최소 ... type을 정의")
- **문제**: "최소 5개 type"은 확장성(가드레일 2) 의도지만, AC-T1 자동 검증("5개 type 상수 존재")은 정확히 5개인지 5개 이상인지 판정 기준이 모호하다. unknown type 무시(OD-6)와 결합하면 잘못된 type 오타도 "unknown으로 무시"되어 silent 실패할 수 있다(예: `session:synced` → `session:sync` 오타).
- **수정안**: AC-T1을 "정의된 type 집합이 최소 5개를 **포함**하고, 직렬화/파싱이 알려진 type을 정확히 round-trip하며, unknown type은 안전히 무시(throw 없음)함을 vitest로 검증"으로 구체화. type 상수를 enum/const로 고정해 오타를 컴파일 타임에 잡도록 권장.

#### M-4 — OD-7(에뮬레이터 호스트) origin allowlist 매칭이 `10.0.2.2` vs `localhost` 미결인데 R-T6 자동 AC는 통과 가능 (feasibility, OD-7 / AC-T6)
- **위치**: spec.md OD-7(L112, "미결 — 구현 시 검증"), acceptance.md AC-T6(L81, "origin 매칭 순수 함수 vitest")
- **문제**: AC-T6의 origin 매칭 순수 함수는 vitest로 통과시킬 수 있으나, **실제 종단에서 신뢰 origin이 무엇인지(`10.0.2.2:3000` vs `localhost:3000` via adb reverse)가 OD-7에서 미결**이다. 순수 함수가 "localhost만 허용"으로 구현되면 에뮬레이터(`10.0.2.2`)에서 토큰 주입이 거부돼 핸드셰이크가 실패한다. 자동 AC가 green이어도 종단이 깨지는 미스매치(MOBILE-001 OD-2가 "가장 흔한 종단 실패"로 경고한 바로 그 지점의 확장).
- **수정안**: AC-T6에 "허용 origin 집합은 `EXPO_PUBLIC_WEB_URL` 호스트에서 파생되며, OD-7 호스트 결정과 일관됨(localhost 일관 셋업 권장)"을 명시. 종단 검증(AC-V3)에 origin allowlist가 실제 에뮬레이터 호스트를 통과함을 포함.

#### M-5 — Background L34/Sources의 `me/page.tsx` 가드가 "getSession" — 신원 권위 검증과 혼동 위험 (clarity, R-N5·R-T3)
- **위치**: spec.md Background L34, Sources L124 / 저장소 me/page.tsx:17-21
- **문제**: `me/page.tsx`의 `getSession()`은 코드 주석(me/page.tsx:17-18)이 명시하듯 "쿠키에서 세션을 읽어 access_token을 백엔드로 전달하는 용도이며, 신원의 권위 있는 검증은 백엔드 가드가 JWKS로 수행"한다. R-T3/R-N5가 이 가드를 "세션 검증 권위"처럼 의존하면, 실제로는 `getSession()`이 서명을 검증하지 않는 쿠키 읽기일 뿐이라는 점과 미세하게 충돌한다(setSession이 쿠키를 채우면 getSession은 무조건 통과 — half-auth 토큰도 통과 가능). SPEC OD-1은 "웹이 setSession으로 검증/갱신"이라 하지만, `me/page.tsx`의 getSession 가드 자체는 검증을 하지 않는다.
- **수정안**: R-T3에 "유효성의 권위는 `setSession()`의 갱신 성공 여부(및 백엔드 JWKS 가드)이며, `me/page.tsx`의 `getSession()`은 쿠키 존재 라우팅 가드일 뿐"을 명시해 권위 위치를 정확히. (confirmed intent의 "웹이 검증/갱신 단일 권위"와 코드 현실을 정렬.)

---

### LOW

#### L-1 — `expo-secure-store` 버전 표기가 SPEC 내 불일치 (정확성, R-N1 vs MOBILE-001 oauth.ts 주석)
- **위치**: spec.md R-N1(L73, "SDK 56 bundled version, `npx expo install`로 핀"), OD-2(L107) — 구체 버전 미기재. MOBILE-001 oauth.ts:14 주석은 "expo-secure-store(56.0.4)"로 구체 버전 언급.
- **문제**: R-N1은 버전을 `npx expo install` 핀에 위임(좋은 패턴, 드리프트 회피)하나, MOBILE-001 oauth.ts 주석은 `56.0.4`로 박아둠. 향후 두 출처가 갈릴 수 있음. 경미.
- **수정안**: R-N1의 "SDK 56 bundled 핀" 방식 유지(권장). 구체 버전을 본문에 박지 말 것.

#### L-2 — AC-V3가 "OD-6 iOS"를 참조하나 MOBILE-002 OD-6은 버전드 스키마임 (cross-ref 오류, acceptance.md:131)
- **위치**: acceptance.md AC-V3 L131("OD-6 iOS 는 macOS+Xcode 환경 의존 — MOBILE-001 OD-6 상속")
- **문제**: 문장이 "OD-6 iOS"라 쓰는데, **MOBILE-002의 OD-6은 "버전드 브리지 스키마 형태"**(spec.md L111)다. iOS 환경 의존은 **MOBILE-001의 OD-6**이다. 같은 줄에서 "MOBILE-001 OD-6 상속"이라 덧붙여 의도는 읽히나, 앞의 "OD-6 iOS"가 MOBILE-002 OD-6(스키마)을 가리키는 것으로 오독될 수 있는 cross-reference 충돌.
- **수정안**: "MOBILE-001 OD-6(iOS macOS+Xcode 환경 의존)을 상속"으로 명확히. 자기 SPEC의 OD-6(스키마)과 구분.

#### L-3 — HISTORY 3개 항목이 모두 동일 날짜·버전(v0.1.0)이라 이력 평면적 (문서, HISTORY L16-18)
- **위치**: spec.md HISTORY L16-18
- **문제**: 최초 작성·SHELL split·OD-4 역전이 모두 "2026-06-09 (v0.1.0)"로 동일. 순서/인과가 평면적. 경미.
- **수정안**: split·역전 기록을 최초 항목의 하위 불릿으로 정리하거나 본문 흡수.

---

## EARS 체크리스트

| 요구 | 패턴 | 라벨 적정 | 단일 관심사 | 테스트 가능 | 비고 |
|------|------|-----------|-------------|-------------|------|
| R-N1 | Ubiquitous | OK | △(splash 의존 누락 — M-2) | OK | |
| R-N2 | Ubiquitous | OK | OK | OK | refresh 저장 정책 명확 |
| R-N3 | Event-Driven | OK | OK | △(수동+일부 자동) | |
| R-N4 | Event-Driven | OK | OK | ✗(타임아웃/실패 누락 — B-2) | cleared 모호 — M-1 |
| R-N5 | State-Driven | OK | OK | OK(수동) | |
| R-T1 | Ubiquitous | OK | OK | △(type 집합 닫힘 — M-3) | PII 최소화 우수 |
| R-T2 | Event-Driven | OK | OK | ✗(주입 race 누락 — B-2) | |
| R-T3 | Event-Driven | OK | △(검증+회신+라우팅 다중) | ✗(회신 메커니즘·실패경로 미정 — B-1/B-2) | |
| R-T4 | Unwanted | OK | OK | △(웹 무하니스 — H-1) | |
| R-T5 | Event-Driven | OK | OK | OK | |
| R-T6 | Unwanted | OK | OK | △(resume 미적용 — H-3) | |
| R-R1 | Event-Driven | OK | OK | ✗(debounce·origin 누락 — B-2/H-3) | |
| R-R2 | Event-Driven | OK | OK | ✗(emit 타이밍 미정 — H-2) | |
| R-R3 | Event-Driven | OK | OK | OK | |
| R-V1 | Ubiquitous | OK | OK | OK(vitest+수동) | |
| R-V2 | Ubiquitous | OK | △(다중 보안 제약 묶음 — 본질상 허용) | △(설계 리뷰) | |
| R-V3 | Event-Driven(manual) | OK | OK | 수동 | |

## R↔AC 매핑 체크리스트

| R | AC | 1:1 | ID 일치 | 비고 |
|---|----|----|---------|------|
| R-N1~N5 | AC-N1~N5 | OK | OK | M-1(N4), M-2(N1) |
| R-T1~T6 | AC-T1~T6 | OK | OK | B-1(T3), M-3(T1), H-3(T6) |
| R-R1~R3 | AC-R1~R3 | OK | OK | H-2(R2), B-2(R1) |
| R-V1~V3 | AC-V1~V3 | OK | OK | H-1(자동표기), L-2(V3 cross-ref) |

- orphan AC: 없음
- uncovered R: 없음
- 누락된 정규 요구(존재해야 하나 없음): 핸드셰이크 타임아웃/실패(B-2), 주입 race/ack(B-2), setSession 예외(B-2), AppState debounce(B-2), resume origin 재검증(H-3) — **5건의 confirmed-intent 흐름이 R로 미존재**

## 내부 정합성 체크리스트

- 모듈 ≤5: OK(M1~M4)
- DELTA/EXTEND 마커: `[NEW]`/`[MODIFY]`/`[EXISTING]`/`[EXTEND]`/`[VERIFY]` 일관 사용. SHELL-001 산출물을 `[EXTEND]`로 정확히 처리(R-N3·N4·N5·T2·T5·R1·R3 등). OK
- depends-on 체인: MOBILE-001(in-progress) + SHELL-001(draft) — SHELL-001 진입 게이트만 있고 MOBILE-001 baseline 게이트 부재(H-4)
- 가드레일 분담(2·3 = 본 SPEC, 1·4 = SHELL-001): 양쪽 SPEC 일치. OK
- 모듈 재번호(M2→M1 등): HISTORY L17 기록과 본문 일치. OK
- 제거/개명된 요구 참조: 없음(R-S1~S5 split을 정확히 외부 SPEC으로 위임)

## 코드 인용 검증(저장소 직접 대조)

| SPEC 인용 | 저장소 실제 | 판정 |
|-----------|-------------|------|
| `me/page.tsx:19-25`(Sources)/`:23-25`(Background) getSession→redirect | getSession L19-21, redirect L23-24 | 라인 드리프트(B-1) |
| `actions.ts:14 CALLBACK_URL` | L14 일치 | 정확 |
| `actions.ts:79-99 signInWithOAuthAction` | L79-99 일치 | 정확 |
| `actions.ts:69-73 signOutAction`(plan.md) | L69-73, signOut+redirect("/login") 일치 | 정확 |
| `config.toml:155-169` redirect allowlist | L155-169 일치(localhost + moyura://) | 정확 |
| `route.ts` 주석 `127.0.0.1` 드리프트 | route.ts:4 `127.0.0.1` 일치 | 정확 |
| `package.json` expo-secure-store 누락 | 누락 확인(deps에 없음) | 정확 |
| 웹 `lib/supabase/` browser/server 클라이언트 | client.ts/server.ts/middleware.ts 존재 | 정확(단 client.ts 미사용 — B-1) |
| `proxy.ts` 세션 미들웨어 | proxy.ts 존재(middleware.ts 아님 — Next16 컨벤션) | 정확 |
| `apps/web` ReactNativeWebView 참조 | 0건(신규 추가 맞음) | 정확 |

코드 인용 드리프트: **1건**(me/page.tsx 라인범위 + setSession client 경로 실재 미검증 — B-1). 나머지 인용은 정확.

---

## Faithfulness (Confirmed intent 대조)

- 웹 단일 세션 권위 + 네이티브 토큰 캐시 + OD-4 역전 명시 + 웹 refresh 비중복: **일치**(OD-1/OD-3/Non-Goal "네이티브 Supabase refresh 복제 없음").
- 콜드스타트 핸드셰이크 흐름(splash→load→inject→setSession→synced/none→SecureStore→splash hide): **happy-path는 일치, 실패/타임아웃/race 경로 누락**(B-2).
- resume 재검증(웹 owns routing, no native reload): 일치(R-R1) — 단 origin 재검증 누락(H-3).
- logout session:cleared → SecureStore clear: 일치(R-R2/R3) — emit 타이밍 미해결(H-2).
- 버전드/확장 스키마, 웹 가드, PII 최소화(userId 미전달, JWT sub 디코드): **정확히 일치**.
- 보안(refresh SecureStore 전용, origin allowlist, 비로깅, postMessage 선호, prod HTTPS, expert-security follow-up): **일치**(R-V2/OD-4/OD-5) — 단 resume origin(H-3)·error 로그 토큰 부재 AC는 보강 필요.
- scope expansion(네이티브 화면/expo-router/신규 웹 라우트/네이티브 refresh): **없음**(Non-Goal로 정확히 차단).

**이 SPEC은 confirmed intent를 충실히 반영하는가: PARTIAL** — 아키텍처/보안 자세/PII 최소화는 의도에 충실하나, confirmed intent가 명시적으로 요구한 **실패·타임아웃·race·resume origin·debounce 흐름이 정규 요구로 누락**되어(B-2/H-3) "충실 반영"으로 판정할 수 없다. 이들을 R/AC로 승격해야 YES가 된다.

---

## 우선순위 수정 리스트

1. **(B-1)** R-T3에 "setSession 후 갱신 토큰 회신 메커니즘" 명시 + 웹 client 클라이언트 신규 wiring 검증 + me/page.tsx 인용 통일(getSession L19-21).
2. **(B-2)** 핸드셰이크 타임아웃→스플래시 강제 해제(R-N6), 주입 race/ack(R-T7), setSession 예외 폴백(R-T3 보강), AppState debounce(R-R1 보강) + 각 AC 신설.
3. **(H-3)** resume 재주입에 origin allowlist 재적용(R-R1) — third-party 토큰 유출 차단.
4. **(H-2)** logout emit 지점 확정(server redirect 경합 해소) + 종단 AC.
5. **(H-1)** 웹 측 AC를 "자동"에서 분리 — apps/web 무 하니스 사실 반영(빌드+수동).
6. **(H-4)** frontmatter priority ↔ plan.md M2(High) 정합 + MOBILE-001 R-P2 baseline 진입 게이트.
7. **(M-1~M-5)** N4 cleared 의미, expo-splash-screen 의존 trace(R-N1), type 집합 닫힘, OD-7 origin 종단 일관, getSession 권위 명확화.
8. **(L-1~L-3)** secure-store 버전 표기, OD-6 cross-ref(iOS는 MOBILE-001), HISTORY 평면 이력.

감사자 메모: 본 SPEC은 "아키텍처 비전·보안 자세·PII 최소화"가 상위 수준이며 코드 인용도 대부분 정확하다. 그러나 **인증 핸드셰이크 SPEC의 본질인 "실패/경합/타임아웃 계약"과 "웹 setSession 회신 경로의 실재 검증"이 비어 있다**(B-1/B-2). 이는 plan.md 위험란이 인지했음에도 정규 요구로 승격되지 않은 must-fix이며, 두 BLOCKER 반영 전 `/moai run` 착수를 권하지 않는다.

---
---

## Re-audit (round 2) — 2026-06-09

> M1 Context Isolation 유지: round-1/리미디에이션 작성자의 추론 컨텍스트는 무시했다. 현행 spec.md/acceptance.md/plan.md + 저장소(read-only, 직접 재대조)만 근거로 독립 재판정한다. round-1 finding 요약·"confirmed intent"는 closure 대조 기준으로만 사용했다.
> 적대적 입장 유지: 두 BLOCKER 의 "fix"가 표면적 문구 추가에 그쳤거나 새 모순을 만들었다는 가정으로 반증을 시도했다. 모든 코드 인용을 라이브 소스로 재대조: `App.tsx`, `oauth.ts`/`oauth-bridge.ts`/`oauth-bridge.test.ts`, `web-url.ts`, `package.json`, `me/page.tsx`, `actions.ts`, `client.ts`, `route.ts`, `config.toml`, `apps/web/package.json`(무 하니스 확인).

### 라이브 코드 재대조 결과(round-2, 직접 확인)

- `me/page.tsx`: `data: { session }` L20, `getSession()` L21(따라서 `data:{session}=await getSession()` 블록 = **L19-21**), `if(!session)` L23 + `redirect("/login")` L24(= **L23-24**). 주석 L17-18 "신원의 권위 있는 검증은 백엔드가 JWKS 로". SPEC 인용 "getSession L19-21 / redirect L23-24"와 **일치**(round-1 의 라인 드리프트 해소).
- `actions.ts`: `signOutAction` L69, `signOut()` L71, `redirect("/login")` L72(= **L69-73** 함수 범위). `CALLBACK_URL` L14, `signInWithOAuthAction` L79-99. 전부 일치.
- `client.ts`: `createBrowserClient` export(`createClient()` L13-15). **호출처 검색 결과 0건**(`grep "@/lib/supabase/client" apps/web` → exit 1, no match) — "현재 미사용 = 신규 wiring" 주장 **사실 확인**.
- `apps/web` `ReactNativeWebView` 참조: **0건**(grep exit 1) — 신규 추가 주장 정확.
- `apps/web/package.json`: scripts = `dev/build/start/lint` 뿐, vitest/jest 의존성·설정 **0** — "무 테스트 하니스" 주장 **사실 확인**(H-1 전제 성립).
- `apps/mobile`: `components/`·`hooks/` 디렉터리 **부재**, `token-store.ts`·`bridge-protocol.ts` **부재**(둘 다 draft 미구현 — `[NEW]` 마커 정확). 테스트 파일 = `oauth-bridge.test.ts`·`web-url.test.ts` 2개(순수 함수 vitest node 패턴 확인 — bridge-protocol/origin/타이머 테스트의 "oauth-bridge.test.ts 패턴" 참조가 실재).
- `route.ts` L4 주석 `127.0.0.1` 드리프트 — 여전히 존재(SPEC Sources L136 이 정확히 그렇게 기록).
- `config.toml:155-169`: `site_url=localhost:3000`, allowlist=[localhost/auth/callback, moyura://auth-callback], google enabled — 일치.

### Round-1 finding 별 closure 표

| ID | 심각도 | 판정 | 증거(file:line) |
|----|--------|------|------------------|
| **B-1** | BLOCKER | **CLOSED** | (1) 회신 메커니즘 명시: R-T3(spec.md:85) "setSession() 리턴값(data.session)에서 갱신 토큰을 읽어 … 또는 onAuthStateChange(OD-9)". 신규 OD-9(spec.md:121)가 data.session vs onAuthStateChange vs getSession 재호출 3안을 노출. (2) 인용 통일: Background(spec.md:35)·Sources(spec.md:133)·AC-N5(acceptance.md:39) 모두 "getSession L19-21 / redirect L23-24"로 통일 — 라이브와 일치. (3) client.ts 신규 wiring 명시: Background(spec.md:38) "client.ts 의 browser 클라이언트는 현재 호출처가 없다(미사용) … 기존 가드 재사용이 아님", Sources(spec.md:135) 동일, AC-T3(acceptance.md:67) "browser 클라이언트(신규 wiring, 현재 미사용)로 setSession". 라이브 grep 0건으로 사실 확인. |
| **B-2** | BLOCKER | **CLOSED** | 4개 실패/경합 경로 전부 정규 요구로 승격: (a) 콜드스타트 타임아웃→스플래시 강제 해제 = 신규 **R-N6**(spec.md:79, Unwanted/If-Then) + **AC-N6**(acceptance.md:42-46, 주입 가능 타이머 자동+수동). (b) 핸들러 미등록 race→메시지 미유실 = 신규 **R-T7**(spec.md:93, Unwanted) + **AC-T7**(acceptance.md:92-96, bounded 재시도 카운터 자동). (c) setSession throw 폴백 = **R-T3** 보강(spec.md:88 "IF setSession() throws/fails … post session:none(or session:error)") + AC-T3 추가 시나리오(acceptance.md:70, throw 모사 → 무한 스플래시 없이 /login). (d) AppState debounce = **R-R1** 보강(spec.md:97 "debounce/compare against previous AppState") + AC-R1 추가 시나리오(acceptance.md:106). |
| **H-1** | HIGH | **CLOSED** | 웹측 AC 자동→빌드+수동 분리: acceptance.md 헤더 L4 "apps/web 에는 테스트 하니스가 없다 … 웹 브리지 동작(R-T3/T4/R-R2)은 typecheck/next build + 수동 종단". AC-T3(L71)·AC-T4(L77)·AC-R2(L114) 모두 "apps/web 무 하니스 — 자동 vitest 불가 → 빌드+수동/리뷰" 명시. DoD(acceptance.md:158-159) "vitest 전량 통과는 apps/web 을 포함하지 않는다". 라이브 apps/web/package.json 으로 무 하니스 사실 확인. |
| **H-2** | HIGH | **CLOSED** | 로그아웃 emit 지점 확정: R-R2(spec.md:98) "emit SHALL occur at a point that does NOT race the redirect: emit ONCE … after arriving at /login … OR from /me logout button's client handler BEFORE signOut … SHALL NOT be placed inside the Server Action body". 신규 OD-10(spec.md:122)가 두 지점 노출. AC-R2(acceptance.md:109-114)에 종단(emit→네이티브 수신→clearTokens) 추가. 라이브 actions.ts:69-73(Server Action+server redirect)로 경합 근거 사실 확인. |
| **H-3** | HIGH | **CLOSED** | resume origin 재검증: R-R1(spec.md:97) "native SHALL FIRST pass the R-T6 origin allowlist (if current WebView origin is NOT trusted WEB_URL … SHALL NOT inject … H-3)". R-T6(spec.md:92) "applies to BOTH cold-start injection (R-T2) AND resume re-injection (R-R1)". AC-T6(acceptance.md:87-90) "콜드스타트 R-T2 또는 resume R-R1 … 콜드스타트 경로와 resume 경로 모두에 동일 함수 적용(H-3)". |
| **H-4** | HIGH | **CLOSED** | priority medium→high: frontmatter(spec.md:8) `priority: high` — plan.md M2 "Priority High"(plan.md:49)와 정합. MOBILE-001 R-P2 baseline 진입 게이트: DoD(acceptance.md:156) "(2) MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline 을 … 통과 — AC-V1 무회귀 기준선 고정". plan.md:82/108 동일. |
| M-1 | MEDIUM | **CLOSED** | R-N4(spec.md:77) "session:synced OR session:none (these are the only two valid cold-start outcomes; session:cleared belongs to logout group R-R2, NOT cold start)". AC-N4(acceptance.md:32) 동일. cleared 콜드스타트 트리거에서 제거. |
| M-2 | MEDIUM | **CLOSED** | R-N1(spec.md:74) "declare BOTH expo-secure-store AND expo-splash-screen". AC-N1 은 expo-secure-store 만 검증하나 DoD(acceptance.md:157) "expo-secure-store AND expo-splash-screen 둘 다 npx expo install 핀으로 선언(AC-N1, M-2)" + plan.md:40 정규 요구 명시로 trace 회복. (잔여 미세점은 NEW finding N-1 참조 — LOW.) |
| M-3 | MEDIUM | **CLOSED** | R-T1(spec.md:83) "at least the types … additive". AC-T1(acceptance.md:55-57) "type 집합이 최소 5종을 포함(enum/const 로 고정해 오타를 컴파일 타임에 차단), 알려진 type round-trip, unknown type 무시(throw 없음)". 닫힘+round-trip 기준 구체화. |
| M-4 | MEDIUM | **CLOSED** | OD-7 origin 종단 일관: AC-T6(acceptance.md:89) "허용 origin 집합은 EXPO_PUBLIC_WEB_URL 호스트에서 파생 … OD-7 호스트 결정과 일관", AC-V3(f)(acceptance.md:147) "origin allowlist 가 실제 에뮬레이터 호스트를 종단에서 통과". |
| M-5 | MEDIUM | **CLOSED** | 권위 명확화: R-T3(spec.md:89) "Authority note (M-5): authority of validity is setSession() refresh success (and backend JWKS guard), NOT me/page.tsx getSession() — latter is only a cookie-presence routing guard". Background(spec.md:35)·AC-T3(acceptance.md:69)·DoD(acceptance.md:168) 동일. 라이브 me/page.tsx:17-18 주석과 일치. |
| L-1 | LOW | **CLOSED(적절)** | R-N1(spec.md:74) "no hardcoded version … pin owned by npx expo install" 유지. OD-2(spec.md:114) 동일. 구체 버전 본문 미기재 — round-1 권장 그대로. |
| L-2 | LOW | **CLOSED** | AC-V3(acceptance.md:150) "MOBILE-001 의 OD-6(iOS macOS+Xcode 환경 의존)을 상속(본 SPEC 의 OD-6 은 버전드 스키마이므로 구분 — L-2)". cross-ref 충돌 해소. |
| L-3 | LOW | **CLOSED** | HISTORY(spec.md:16-19): split·OD-4 역전을 최초 항목 하위 불릿으로 정리 + v0.1.1 "[audit remediation applied]" 항목 추가로 인과 순서가 드러남. |

**집계: CLOSED 13 ID(B-1·B-2·H-1~H-4·M-1~M-5·L-1~L-3) / PARTIAL 0 / NOT-CLOSED 0.** round-1 에서 "R 로 미존재"로 지목된 누락 정규요구 5건(핸드셰이크 타임아웃·주입 race·setSession throw·AppState debounce·resume origin)도 R-N6/R-T7/R-T3보강/R-R1보강/R-T6확장으로 **전부 승격**.

### 리미디에이션이 새로 도입한 결함 점검

신규 BLOCKER/HIGH/MEDIUM: **없음**. 다음을 적대적으로 점검했고 LOW 2건만 발견.

- **R↔AC 1:1 유지(19/19)**: R 카운트 = R-N1~N6(6) + R-T1~T7(7) + R-R1~R3(3) + R-V1~V3(3) = **19**. AC 카운트 = AC-N1~N6(6) + AC-T1~T7(7) + AC-R1~R3(3) + AC-V1~V3(3) = **19**. 모든 신규/보강 쌍 1:1: R-N6↔AC-N6, R-T7↔AC-T7. 보강 요구(R-T3 throw/R-R1 debounce/R-R2 emit)의 신규 검증은 새 AC ID 신설 대신 부모 AC(AC-T3/AC-R1/AC-R2)에 "그리고(…)" 추가 시나리오로 흡수 — orphan AC 0·uncovered R 0 유지. **이 folding 방식은 수용 가능**: 각 추가 시나리오가 (i) 개별 testable 한 분기(setSession throw 모사 → 무한 스플래시 없이 /login; 연속 active → 1회만 트리거; emit→수신→clearTokens 체인)이고, (ii) 부모 R 의 보강 문구(R-T3 throw 분기/R-R1 debounce/R-R2 emit 지점)와 1:1 대응하며, (iii) AC 본문에 "그리고(예외 폴백 — B-2)" 등 명시 라벨로 분리 서술돼 grab-bag 화되지 않았다. must-pass 행위(throw 폴백·debounce·emit 종단)가 부모 AC 안에서 숨지 않고 별도 검증 줄을 가진다.
- **R-N6 / R-T7 EARS 유효성**: 둘 다 `Unwanted / If-Then` 라벨 — "IF the cold-start handshake does NOT return … THEN the shell SHALL hide the splash"(R-N6), "IF the web bridge handler is NOT yet registered … THEN native SHALL retry … OR the web SHALL buffer/ack"(R-T7). EARS Unwanted 패턴(If-then) 정확, 단일 관심사(각각 타임아웃 폴백·race 미유실), testable(주입 가능 타이머/재시도 카운터), `[NEW]` 마커 정확(둘 다 신규 동작). 라벨 드리프트 없음.
- **OD-9 / OD-10 정합성**: OD-9(setSession 회신 메커니즘)는 OD-3(웹 setSession 위임)의 하위 구현 선택을 노출 — 모순 아니라 정제. OD-10(emit 지점)은 R-R2 와 일관, OD-6(스키마)·OD-7(호스트)와 독립 주제. 기존 OD 와 충돌 0. 번호 시퀀스 OD-1~OD-10 연속, gap/중복 0.
- **R-N4 cleared 제거의 orphan 점검**: R-N4 에서 `session:cleared` 를 콜드스타트 결과에서 제거(M-1)했으나, `session:cleared` 메시지 type 자체는 R-T1 의 5종 type 집합(spec.md:83)에 보존되고 R-R2(웹 emit)·R-R3(네이티브 clearTokens 수신) 핸드셰이크에 정상 연결됨. 즉 **메시지 type 고아화 없음** — cleared 는 로그아웃 그룹에서 emit/수신 양단이 모두 존재(R-R2↔R-R3↔AC-R2↔AC-R3). 핸드셰이크-결과 로직(synced/none 만 콜드스타트 종료)과 로그아웃 로직(cleared)이 깔끔히 분리됐다.
- **모듈 수 ≤5 유지**: M1~M4(네이티브 토큰 캐시 / 토큰 동기화 브리지 / resume+로그아웃 / 보존+검증) = **4개**. 신규 R-N6·R-T7 이 각각 M1·M2 안에 추가돼 모듈 수 불변.
- **인용 드리프트 점검**: round-1 의 유일한 드리프트(me/page.tsx 라인범위 + setSession client 경로 실재 미검증)가 closed. 리미디에이션이 추가한 모든 코드 언급(client.ts 미사용, apps/web 무 하니스, signOutAction Server Action, route.ts 127.0.0.1)을 라이브로 재대조 — **드리프트 0**.
- **Non-Goal 무결성**: "신규 웹 라우트/server action 0"(spec.md:61) 유지. B-1 fix 가 추가한 것은 기존 `client.ts` browser 클라이언트의 **첫 사용(wiring)** + 가드된 브리지 util 1개이지 신규 라우트/action 이 아님 — Non-Goal 비위반. DoD(acceptance.md:160) "신규 라우트/server action 0(단 browser client.ts setSession 호출은 신규 client-side wiring)"로 정확히 경계 표기.

### NEW findings (리미디에이션 후 — 모두 LOW, BLOCKER 아님)

- **N-1 (LOW, testability) — AC-N1 이 `expo-splash-screen` 존재를 자동 검증하지 않음.** R-N1(spec.md:74)·DoD(acceptance.md:157)·plan.md:40 은 `expo-splash-screen` 을 정규 의존으로 선언하나, AC-N1 자동 검증(acceptance.md:16)은 여전히 "package.json dependencies 에 expo-secure-store 존재"만 적는다. round-1 M-2 수정안("AC-N1 에 expo-splash-screen 존재 검증 추가")을 R/DoD 수준에서는 반영했으나 AC-N1 자동 게이트 줄에는 미반영. 영향 경미(DoD 가 둘 다 요구하므로 검증자가 누락하지 않음). 수정안: AC-N1 자동 검증을 "package.json 에 expo-secure-store AND expo-splash-screen 존재"로 한 줄 확장.
- **N-2 (LOW, clarity) — R-T3 의 `session:error` type 이 R-T1 의 보장 5종 type 집합에 미열거.** R-T3(spec.md:88)·AC-T3(acceptance.md:70)이 throw 폴백으로 "session:none (or a dedicated session:error type)"를 허용하나, R-T1(spec.md:83)의 보장 type 집합(restore/synced/none/cleared/resume:revalidate)에는 `session:error` 가 없다. "or dedicated" 라 선택지이므로 모순은 아니나(none 으로 폴백하면 5종으로 충분), 구현자가 session:error 를 택하면 type 집합이 6종이 되어 AC-T1 "최소 5종 포함"(≥5)과는 일관하되 명시 enum 목록과 어긋날 수 있다. 영향 경미. 수정안: R-T1 에 "(optional) session:error" 를 additive 예시로 한 줄 부기하거나 R-T3 폴백을 session:none 으로 단일화.

신규 MEDIUM 이상 결함: 없음.

### 갱신된 체크리스트

EARS 체크리스트(round-2, 변경분 위주):

| 요구 | 패턴 | 라벨 적정 | 단일 관심사 | 테스트 가능 | 비고 |
|------|------|-----------|-------------|-------------|------|
| R-N4 | Event-Driven | OK | OK | OK(synced/none 분기, cleared 제외) | M-1 CLOSED |
| R-N6 | Unwanted/If-Then | OK | OK | OK(타임아웃 타이머 자동) | 신규 — B-2 CLOSED |
| R-T1 | Ubiquitous | OK | OK | OK(round-trip+unknown 무시) | M-3 CLOSED; N-2 LOW |
| R-T3 | Event-Driven | OK | △(검증+회신+라우팅+throw 폴백 다중 — 본질상 허용) | OK(빌드+수동, 회신 메커니즘 OD-9, throw 분기) | B-1/B-2/M-5 CLOSED |
| R-T6 | Unwanted | OK | OK | OK(콜드스타트+resume 공용 함수) | H-3 CLOSED |
| R-T7 | Unwanted/If-Then | OK | OK | OK(재시도 카운터 자동) | 신규 — B-2 CLOSED |
| R-R1 | Event-Driven | OK | △(origin 선통과+debounce+주입 다중 — 보강으로 묶임) | OK(origin 거부+debounce 1회 트리거 자동) | H-3/B-2 CLOSED |
| R-R2 | Event-Driven | OK | OK | OK(빌드+수동 종단, emit 지점 OD-10) | H-2 CLOSED |

R↔AC 매핑(round-2): R-N1~N6↔AC-N1~N6, R-T1~T7↔AC-T1~T7, R-R1~R3↔AC-R1~R3, R-V1~V3↔AC-V1~V3 — **19/19 1:1, orphan 0, uncovered 0**. 보강 검증은 부모 AC 추가 시나리오로 흡수(grab-bag 아님 — 위 점검 참조).

내부 정합성(round-2): 모듈 4개(≤5 OK); DELTA/EXTEND 마커 일관(`[NEW]` R-N6/R-T7, `[EXTEND]`/`[MODIFY]`/`[EXISTING]`/`[VERIFY]`); OD 시퀀스 1~10 연속(gap/중복 0); 가드레일 분담(2·3=본 SPEC, 1·4=SHELL-001) 유지; cleared message type 고아화 0.

코드 인용 검증(round-2): me/page.tsx getSession L19-21/redirect L23-24(일치), actions.ts signOutAction L69-73(일치), client.ts 미사용(grep 0건 확인), apps/web ReactNativeWebView 0건, apps/web 무 하니스(package.json 확인), config.toml:155-169(일치), route.ts:4 127.0.0.1(일치) — **드리프트 0**(round-1 의 1건 해소).

### Chain-of-Verification Pass (round-2)

2차 자기비판: (1) R-N1~V3 19개 항목을 모두 끝까지 읽음. (2) R 번호 시퀀스(N1-6/T1-7/R1-3/V1-3) gap/중복 0, OD-1~10 gap/중복 0 — 끝까지 카운트. (3) 19개 R 전부 AC 추적(샘플링 아님) — 보강 AC folding 도 부모 R 의 보강 문구와 1:1 대조. (4) Exclusions(Non-Goal spec.md:53-62) 구체성 재확인 — "신규 웹 라우트 0"이 B-1 wiring 과 비충돌함을 라이브 grep 으로 검증. (5) 요구 간 모순 점검 — R-N4(cleared 제외) ↔ R-T1(cleared type 보존) ↔ R-R2/R-R3(cleared emit/수신)이 모순 아니라 역할 분리임을 확인; R-T3 session:error(N-2)만 미세 비일관(LOW). (6) folding 된 AC 가 must-pass 행위(throw 폴백·debounce·emit 종단)를 숨기지 않음을 각 AC 본문 줄단위로 확인. 새 BLOCKER/HIGH/MEDIUM 없음, LOW 2건(N-1/N-2) 신규.

### Regression Check (round-2)

round-1 finding 13개 ID(B-1·B-2·H-1~H-4·M-1~M-5·L-1~L-3) + 누락 정규요구 5건: **전부 RESOLVED**. stagnation/blocking defect 없음(첫 리미디에이션 라운드에서 전건 해소). 미해결 이월 0.

### Fresh Verdict (round-2)

**PASS-WITH-FIXES** — round-1 의 FAIL 을 유발한 **2 BLOCKER(B-1·B-2)가 증거 기반으로 완전히 closed** 되었고, HIGH 4·MEDIUM 5·LOW 3 도 전부 closed 되었다. round-1 에서 정규 요구로 누락됐던 실패/경합/타임아웃 계약(타임아웃 폴백·핸들러 race·setSession throw·AppState debounce·resume origin)이 R-N6/R-T7/R-T3보강/R-R1보강/R-T6확장으로 전부 승격됐고, 웹 setSession 회신 경로의 실재(client.ts 미사용=신규 wiring, OD-9)가 라이브 grep 으로 확인됐다. R↔AC 1:1(19/19), 코드 인용 드리프트 0, 모듈 ≤5, OD 시퀀스 연속, EARS 라벨 정확, confirmed intent(웹 단일 권위·네이티브 토큰 캐시·OD-4 역전·버전드 스키마·PII 최소화·실패계약) 충실. 잔여는 **LOW 2건(N-1 AC-N1 splash 자동검증 줄 누락, N-2 session:error type 미열거)뿐으로 BLOCKER 아님**.

판정 근거상 **두 BLOCKER 가 모두 해소되어 `/moai run SPEC-MOBILE-002` 착수 가능**하다(LOW 2건은 Run 중 또는 다음 패스에서 흡수 가능 — 진입 차단 아님). 단, DoD 의 진입 전제(SHELL-001 완료 + MOBILE-001 R-P2 baseline)는 실행 순서상 충족돼야 하며, 이는 SPEC 결함이 아니라 정상 문서화된 의존 게이트다.
