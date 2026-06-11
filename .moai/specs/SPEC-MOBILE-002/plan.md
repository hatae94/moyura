# SPEC-MOBILE-002 — Implementation Plan

> Plan phase 산출물. 구현 코드는 Run phase(`/moai run SPEC-MOBILE-002`). 시간 추정 없이 우선순위 라벨 + 단계 순서로 표기.
> depends-on: **SPEC-MOBILE-001** (in-progress) **AND SPEC-WEBVIEW-SHELL-001** (draft, 선행). SHELL-001 이 추출한 `App.tsx`/`WebViewShell`/`useAppLifecycle`/`useAuthBridge` 위에 토큰 로직을 얹는다.
> 개발 방법론: brownfield. 기존 동작 보존이 핵심(M4 가 무회귀를 닫는다).
> 선행: WebViewShell 추출(원래 본 SPEC 의 M1)은 SPEC-WEBVIEW-SHELL-001 로 split — 이 SPEC 시작 전 완료되어 있어야 한다.

---

## 마일스톤 개요 (의존성 순서)

```
[선행] SPEC-WEBVIEW-SHELL-001 (WebViewShell/오버레이/훅 추출, 행위 보존)
   │  ── App.tsx 를 합성 가능한 구조로 만들어 본 SPEC 의 토큰 로직이 인라인 비대화 없이 얹힘
   ▼
M1 (token-store + 진입 라이프사이클 + 스플래시)
   │  ── 토큰 캐시 + 콜드스타트 골격(스플래시/로드/숨김), useAppLifecycle 확장
   ▼
M2 (토큰 동기화 브리지: 버전드 스키마 + 웹 setSession + 네이티브 onMessage)
   │  ── 핵심 핸드셰이크. M1 의 token-store + SHELL-001 의 useAuthBridge 확장
   ▼
M3 (resume 재검증 + 로그아웃 클리어)
   │  ── M2 스키마/핸들러 재사용(resume:revalidate, session:cleared)
   ▼
M4 (보존 + 디바이스 종단 검증)  ── 무회귀 확인, status in-progress→completed 전환
```

순서 근거: 선행 SHELL-001 추출이 끝나야 본 SPEC 의 토큰 로직이 인라인이 아닌 추출된 훅(`useAppLifecycle`/`useAuthBridge`)에 들어간다(forward-compat 가드레일 1·4는 SHELL-001 충족). M2 핸드셰이크는 M1 의 `token-store` 와 SHELL-001 의 `useAuthBridge` 둘 다에 의존하므로 마지막에서 두 번째. M3 는 M2 의 버전드 스키마/메시지 핸들러를 그대로 확장한다.

---

## M1. 네이티브 토큰 캐시 + 진입 라이프사이클 — Priority High

OD-4 역전 지점(`expo-secure-store` 도입).

추가 파일:
- `apps/mobile/lib/auth/token-store.ts` — `loadTokens`/`saveTokens`/`clearTokens`(`expo-secure-store`, OS 키체인 암호화). refresh 토큰 SecureStore 전용(R-N2/R-V2). **보안(M-1)**: `setItemAsync` 에 명시적 `keychainAccessible` 안전값(권장 `WHEN_UNLOCKED_THIS_DEVICE_ONLY`) 전달, SDK 기본값/`ALWAYS` 금지. `session:none` 수신 시 clear 경로(R-R4)도 이 모듈의 `clearTokens` 를 호출한다.

수정 파일:
- `apps/mobile/package.json` — `npx expo install expo-secure-store` AND `npx expo install expo-splash-screen`(둘 다 SDK 56 핀, R-N1/OD-8). 두 의존성 모두 R-N1 정규 요구.
- `apps/mobile/App.tsx` + `apps/mobile/hooks/useAppLifecycle.ts`(SHELL-001 추출본 확장) — 콜드스타트: 스플래시 표시 → `loadTokens()` → `WEB_URL` 로드(R-N3), 핸드셰이크 결과(synced/none 만 — cleared 제외) 수신 시 스플래시 숨김(R-N4), 무토큰 콜드스타트도 `WEB_URL` 로드 후 웹 가드에 위임(R-N5), **bounded 타임아웃 경과 시 스플래시 강제 해제 + 웹가드 폴백**(R-N6, 무한 스플래시 방지).

산출 검증: `package.json` 에 `expo-secure-store`/`expo-splash-screen`; token-store 순수/얇은 래퍼 부분 단위 테스트; 타임아웃 타이머→스플래시 hide 자동(AC-N6, 주입 가능 클록); 콜드스타트 골격 수동(AC-N3/N4/N5/N6 → AC-V3a/b/g).

위험: SDK 56 의 `expo-secure-store`/`expo-splash-screen` 정확한 API 는 버전드 docs(docs.expo.dev/versions/v56.0.0/) 확인 필수(`apps/mobile/AGENTS.md`). SecureStore 는 비동기 — 콜드스타트 race(스플래시 숨김 타이밍)는 R-N6 타임아웃으로 정규 처리.

---

## M2. 토큰 동기화 브리지 — Priority High (핵심 핸드셰이크)

추가 파일:
- `apps/mobile/lib/auth/bridge-protocol.ts` — 버전드 스키마 `{version,type,payload}`, 5개 type 상수(`session:restore`/`synced`/`none`/`cleared`/`resume:revalidate`), 직렬화/파싱 + 주입 페이로드 빌더 + **per-session nonce/HMAC 부착·검증 순수 함수(R-T8/OD-11)** + **origin 매칭 순수 함수(신뢰/비신뢰, R-T6/R-T9)**(전부 순수, vitest). expo/RN import 0(oauth-bridge.ts 패턴). **payload 는 access/refresh 토큰만**(프로필/`userId` 미포함, PII 최소화 — OD-4); 식별자 필요 시 access token JWT `sub` 디코드.

수정 파일:
- `apps/mobile/components/WebViewShell.tsx`(SHELL-001 추출본 확장) — **`originWhitelist` 를 신뢰 origin 으로 제한**(기본 전체 http/https 금지) + `onShouldStartLoadWithRequest` 를 비신뢰 top-level 로드 거부 게이트로 확장(OAuth 인터셉트 보존, 비신뢰는 `Linking.openURL` 외부 위임)(R-T9/C-2).
- `apps/mobile/hooks/useAuthBridge.ts`(SHELL-001 추출본 확장) — 콜드스타트 시 **주입 순간 LIVE origin 재검증**(stale ref 아님, R-T9 TOCTOU 차단) 후 `session:restore` 주입, **targetOrigin 은 신뢰 origin literal(`"*"` 금지, R-T8/H-1)** + **nonce/HMAC 부착**(R-T8), **핸들러 미등록 race 대비 bounded 재시도/버퍼·ack**(R-T7), `onMessage` 로 인증된(nonce/HMAC) `session:synced` 만 수신 → `token-store.saveTokens`(R-T5/R-T8). origin allowlist(콜드스타트+resume 공용) + 비로깅 + postMessage 우선(R-T6).
- `apps/web/` 브리지 모듈(신규 client util 1개, `window.ReactNativeWebView` 가드) — **인바운드 메시지 인증 게이트**: `event.origin === 신뢰 origin` AND nonce/HMAC 검증 통과한 메시지만 처리, 위조/foreign-origin `session:restore` 거부(R-T8/C-1) → **browser 클라이언트(`lib/supabase/client.ts` — 현재 미사용, 신규 client-side wiring, B-1) 로** `supabase.auth.setSession()` 호출 → 리턴값(`data.session`)/`onAuthStateChange`(OD-9)에서 갱신 토큰 읽어 valid/refreshed `session:synced` 회신(토큰만) / empty·expired `session:none` / **throw·네트워크 오류 → `session:none` 폴백**(별도 type 미도입 — R-T1 보장 5 type 유지, N-2)(R-T3/R-T4). 권위 = setSession 갱신 + 백엔드 JWKS(getSession 은 쿠키 가드, M-5). **신규 라우트/server action 0.**

산출 검증(분리 — H-1): **apps/mobile vitest** — bridge-protocol 직렬화/파싱·type round-trip·unknown 무시(AC-T1), origin 매칭(콜드스타트+resume+비신뢰 reject, AC-T6/T9), **nonce/HMAC accept(일치)·reject(위조/없음)(AC-T8)**, **targetOrigin literal 빌더(`"*"` 미사용)(AC-T8)**, **live-origin 재검증 함수(주입 시점 origin 인자)(AC-T9)**, 메시지 핸들러 분기, payload `userId` 부재, R-T7 재시도 카운터. **apps/web — 무 테스트 하니스이므로 typecheck/`next build` + 수동 종단**(R-T3 분기·R-T4 가드·R-T8 웹 인증 게이트는 자동 vitest 불가). 수동(AC-V3a/b/f/h).

위험: **웹 측 메시지 인증 부재 = 세션 고정/토큰 탈취(C-1, CRITICAL)** → R-T8 origin+nonce 게이트로 차단. **WebView origin 미잠금 + targetOrigin `"*"` = 토큰 유출(C-2/H-1, CRITICAL/HIGH)** → R-T9 originWhitelist+네비 게이트 + R-T8 specific targetOrigin 로 차단. 웹 브리지 주입 시점 race 는 R-T7(재시도/버퍼)로 정규 처리. OD-7(에뮬레이터 호스트) 일관성이 origin allowlist 매칭에 직접 영향(AC-V3f). `client.ts` browser 클라이언트 미사용 → 신규 wiring(B-1). nonce/HMAC 스키마는 mobile/web 양측 동기 필요(security-review L-2 — 공유/계약 테스트 권장).

---

## M3. Resume 재검증 + 로그아웃 클리어 — Priority High (보안 R-R4 a/b/c 포함)

M2 스키마/핸들러 확장. R-R4 (c) = 디바이스 검증에서 발견된 쿠키 부활 결함의 fix.

수정 파일:
- `apps/mobile/hooks/useAppLifecycle.ts`(SHELL-001 추출본 확장) — `AppState` 구독, `active` 전이 + 토큰 보유 시 **origin allowlist 선통과(R-T6, third-party 페이지면 미주입 — H-3)** + **debounce/직전 상태 비교로 중복 active 억제(R-R1 debounce 분기/B-2)** 후 `resume:revalidate` + 토큰 주입(R-R1).
- `apps/mobile/hooks/useAuthBridge.ts`(SHELL-001 추출본 확장) — resume 후 `session:synced` 수신 처리(M2 핸들러 재사용), `session:cleared` 수신 → `token-store.clearTokens` **+ 신뢰 origin WebView 쿠키 clear(R-R4 c — 디바이스 검증 쿠키 부활 차단; cookie-manager 로 WKWebView store + NSHTTPCookieStorage 제거)**(R-R3/R-R4), **`session:none` 수신 → `token-store.clearTokens` 도 수행(R-R4 a/M-3 — 저장 스킵에 그치지 않음, 단 쿠키 clear 는 미적용)**.
- `apps/mobile/lib/auth/bridge-protocol.ts` — `decideInboundAction` 의 `session:none` 처리를 no-op 이 아니라 **clear 동작**으로(R-R4 a/M-3), `session:cleared` 는 **token clear + cookie clear** 결정으로(R-R4 c), `session:synced` 는 쿠키 clear 미발생. 로그아웃 emit 신뢰성을 위한 ack/retry 또는 멱등 재clear 보조(R-R4 b/H-2). 쿠키 clear 트리거 분기는 순수 결정 함수로 테스트 가능.
- `apps/web/` 브리지 모듈 — 로그아웃 시 **server redirect 와 경합하지 않는 client 지점**(`/login` 도착 후 mount 또는 `/me` 로그아웃 버튼 client handler 의 signOut 전 — OD-10/H-2)에서 `session:cleared` post(가드)(R-R2). `actions.ts:69-73 signOutAction` 은 Server Action + server redirect 이므로 emit 을 그 본문 안에 두지 않는다. server action 신규 생성 없음.

추가 의존성: `@react-native-cookies/cookies`(또는 동등 cookie-manager, R-R4 c — R-N1 선언, 패키지 매니저 설치 + autolink pod).

산출 검증(분리 — H-1): apps/mobile vitest(AppState 핸들러 분기, origin 거부 미주입, 연속 active→1회 트리거 debounce, `session:cleared`→clearTokens **+ cookie-clear 트리거**, `session:synced`→cookie-clear 미발생, **`session:none`→clearTokens(쿠키 clear 미적용)(R-R4/AC-R4)**, ack/retry 멱등성 — 전부 순수 결정 로직); apps/web typecheck/`next build`(가드된 emit 이 client 경로) + 수동 종단(AC-R2 네이티브 수신→clear, AC-R4 (c) 로그아웃 후 쿠키 저장소 `sb-*` 부재 + 재시작 `/login`, emit 유실 후 세션 미부활); 수동(AC-V3d/e/i).

위험: `AppState` active 과다 발화 → R-R1 debounce 분기로 정규 처리. **로그아웃 후 재시작 세션 부활(디바이스 검증 실측, HIGH)** — 원인은 WebView 쿠키 삭제 미영속(`binarycookies` 의 `sb-127-auth-token` 잔존, getSession 쿠키 전용 + 시간상 유효 JWT) → **R-R4 (c) 네이티브 쿠키 clear** 로 차단(SecureStore/clearTokens 가 아니라 쿠키가 원인이었음). 로그아웃 emit 유실 → stale refresh 잔존(H-2/M-3) → R-R4 (a)(b)(`session:none`→clear + ack/retry 멱등)로 차단. 주의: 쿠키 clear 를 `session:none` 에 적용하면 setSession network-throw 폴백(R-T3)에서 유효 쿠키 세션 파괴 — 따라서 `session:cleared` 에만 적용. resume 시 third-party origin 토큰 유출 → R-T6 resume 선통과로 차단.

---

## M4. 보존 + 검증 — Priority High (게이트)

수정/검증:
- 진입 baseline(H-4): MOBILE-001 R-P2(디바이스 OAuth 왕복) 을 동일 환경에서 통과시켜 AC-V1 무회귀 기준선 고정.
- 무회귀 확인: 기존 `oauth.ts`/`oauth-bridge.ts` 흐름 보존(R-V1, AC-V1). 기존 vitest 전량 통과.
- 보안 제약 점검(R-V2/AC-V2): refresh SecureStore 전용 + 안전 accessibility(R-N2/M-1), 네이티브 origin allowlist(콜드스타트+resume), **웹 인바운드 인증·specific targetOrigin(R-T8), WebView origin 잠금·live-origin 재검증(R-T9), `session:none`→clear·로그아웃 신뢰성·로그아웃 WebView 쿠키 clear(R-R4 a/b/c)**, 비로깅, prod HTTPS(dev localhost 예외). **Run phase 에서 expert-security 재리뷰로 security-review.md C-1/C-2/H-1/H-2 + 디바이스 검증 쿠키 부활 closure 확인**(OD-5/OD-11).
- 수동 디바이스 종단(R-V3/AC-V3 a~i): 콜드스타트(유효/무세션), 로그인 토큰 영속, resume refresh, 로그아웃 클리어(종단 clearTokens), origin allowlist 종단(f), 웹 미기동 타임아웃 폴백(g), **보안 종단(h): 위조 `session:restore` 미수용·비신뢰 origin 로드 거부·evil origin 토큰 미전달; (i): 로그아웃(`session:cleared`) 후 앱 쿠키 저장소 `sb-*` 부재 + 재시작 `/login`(쿠키 부활 차단, R-R4 c) + emit 유실 후 세션 미부활(R-R4 a/b)**. OD-7 호스트 일관성(adb reverse vs 10.0.2.2 실측). iOS 종단은 macOS+Xcode 환경 의존 — **MOBILE-001 의 OD-6(iOS 환경 의존)을 상속**(본 SPEC 의 OD-6 은 버전드 스키마 — 구분, L-2).

완료 정책: 선행 SHELL-001 완료 + MOBILE-001 R-P2 baseline 확인 → apps/mobile 자동 게이트 + apps/web 빌드 통과 + **보안 게이트(R-T8/R-T9/R-R4 a/b/c/R-N2)·expert-security 재리뷰 closure** 후 status draft→in-progress, 디바이스 종단(AC-V3 a~i, 쿠키 부활 차단 i 포함) 통과 시 completed(MOBILE-001 패턴 일관).

---

## 파일 영향 요약

> 선행조건: SPEC-WEBVIEW-SHELL-001 이 `components/WebViewShell.tsx`·`components/LoadingOverlay.tsx`·`components/WebViewErrorOverlay.tsx`·`hooks/useAppLifecycle.ts`·`hooks/useAuthBridge.ts` 를 이미 추가하고 `App.tsx` 를 추출 완료한 상태. 아래는 본 SPEC 이 그 위에서 더하는 변경.

| 모듈 | 추가 | 수정 |
|------|------|------|
| M1 | `lib/auth/token-store.ts`(safe `keychainAccessible`, R-N2/M-1) | `package.json`(+ cookie-manager 의존 `@react-native-cookies/cookies`, R-N1/R-R4 c), `App.tsx`, `hooks/useAppLifecycle.ts`(SHELL-001 추출본) |
| M2 | `lib/auth/bridge-protocol.ts`(스키마+nonce/HMAC+origin 매칭), `apps/web/` 브리지 client util(1, origin+nonce 인증 게이트) | `components/WebViewShell.tsx`(originWhitelist+네비 게이트, R-T9/SHELL-001 추출본), `hooks/useAuthBridge.ts`(specific targetOrigin+nonce+live-origin, R-T8/T9/SHELL-001 추출본), (web) supabase browser client 사용처 |
| M3 | — | `hooks/useAppLifecycle.ts`, `hooks/useAuthBridge.ts`(둘 다 SHELL-001 추출본; **`session:cleared`→clearTokens + WebView 쿠키 clear, R-R4 c**), `lib/auth/bridge-protocol.ts`(`session:none`→clear / `session:cleared`→token+cookie clear 결정, R-R4 a/c), `apps/web/` 브리지 util |
| M4 | — | (검증 전용; 코드 변경 없음) |

> Multi-File 주의: M1~M3 가 `App.tsx`/`useAppLifecycle.ts`/`useAuthBridge.ts`/`bridge-protocol.ts`(SHELL-001 이 만든 파일 + M2 신규 protocol) 를 누적 수정한다. Run phase 에서 모듈 단위 순차 진행(M1→M2→M3) 권장 — 같은 파일 동시 편집 회피.
> 보안(C-1/C-2/H-1/H-2) 수정은 M2(R-T8/T9: `WebViewShell.tsx`·`useAuthBridge.ts`·`bridge-protocol.ts`·웹 브리지)·M3(R-R4: `bridge-protocol.ts`·`useAuthBridge.ts`·웹 브리지)·M1(R-N2: `token-store.ts`)에 걸쳐 있다. nonce/HMAC·origin 매칭은 mobile/web 양측 동기 구현(security-review L-2 — 공유/계약 테스트 권장).

---

## 교차 리스크 (전 모듈)

- **진입 baseline 미확보(H-4)**: SHELL-001 완료 + MOBILE-001 R-P2(디바이스 OAuth 왕복) baseline 미고정 시 AC-V1 무회귀 판정 불가 — 둘 다 진입 전제.
- **선행 SHELL-001 미완**: WebViewShell 추출이 끝나지 않은 상태에서 본 SPEC 을 시작하면 토큰 로직이 다시 모놀리식 `App.tsx` 에 인라인된다 — SHELL-001 완료를 선행조건으로 강제.
- **핸드셰이크 실패/경합/타임아웃(B-2)**: 콜드스타트 무응답→무한 스플래시(R-N6 타임아웃 폴백), 핸들러 미등록 race→메시지 유실(R-T7 재시도/버퍼), setSession throw→미해결(R-T3 `session:none` 폴백), AppState 중복 발화→토큰 경합(R-R1 debounce 분기) — 전부 정규 요구로 승격됨(인지→요구).
- **웹 setSession 경로 실재(B-1)**: `client.ts` browser 클라이언트는 현재 미사용 — R-T3 는 이를 처음 쓰는 신규 client-side wiring. 회신 토큰 획득 메커니즘(OD-9)·쿠키 일관성을 Run 에서 실측 확정.
- **(보안 CRITICAL — C-1) 웹 메시지 인증 부재**: 웹 브리지가 인바운드 메시지의 origin/발신자를 검증하지 않으면 동일 page 의 임의 스크립트(서드파티/공급망/XSS)가 `session:restore` 를 위조해 세션 고정 또는 토큰 탈취 가능 → R-T8(origin + per-session nonce/HMAC 인증, OD-11)로 차단. 스키마 검증만으로는 불충분(form ≠ identity).
- **(보안 CRITICAL — C-2) WebView origin 미잠금 + targetOrigin `"*"`**: `originWhitelist` 기본값(모든 http/https) + `"*"` targetOrigin 이면 비신뢰 origin 으로 네비게이트 후 토큰이 공격자 페이지로 유출 → R-T9(originWhitelist 제한 + 네비 게이트 + live-origin 재검증) + R-T8(specific targetOrigin)으로 차단. TOCTOU(stale `currentUrlRef`) 주의 — 주입 순간 LIVE origin 재검증.
- **(보안 HIGH — H-1) targetOrigin 와일드카드 브로드캐스트**: C-2(d)와 동일 라인 — `postMessage(..., "*")` 는 동일 document 모든 리스너에 토큰 브로드캐스트. R-T8 신뢰 origin literal 로 고정.
- **로그아웃 emit 경합/유실(H-2/M-3)**: Server Action redirect 가 client JS 기회를 안 주므로 emit 지점(OD-10)을 잘못 잡으면 유실 → SecureStore stale refresh 잔존 → 다음 콜드스타트에서 세션 부활. R-R4 a/b(`session:none`→clear 멱등 + ack/retry)로 차단. AC-R2/AC-R4 종단 확인.
- **로그아웃 후 쿠키 부활(디바이스 검증 실측 결함, HIGH — closed by R-R4 c)**: WebView 영속 쿠키 저장소(`binarycookies`)의 `sb-*` auth 쿠키 삭제가 영속되지 않아(2회 재현, 30초 flush 불변) `getSession()`(쿠키 전용) + 시간상 유효 access JWT(jwt_expiry=3600)로 로그아웃 후 ≤1h 재시작 시 세션 부활. 원인은 SecureStore/clearTokens 가 아니라 **WebView 쿠키 삭제 미영속** → **R-R4 (c) `session:cleared` 시 네이티브 쿠키 clear(WKWebView+NSHTTPCookieStorage)** 로 zero-resurrection. 주의: `session:none` 에는 미적용(R-T3 network-throw 폴백의 유효 쿠키 보호). AC-R4/AC-V3i 종단 확인.
- **resume origin 유출(H-3)**: third-party 페이지에서 resume 시 토큰 주입하면 유출 — R-T6 resume 선통과로 차단(R-T9 live-origin 재검증과 결합).
- **(보안 MEDIUM — M-1) SecureStore accessibility 미설정**: 기본값 의존 시 플랫폼 차이/백업 복원 노출 — R-N2 가 `WHEN_UNLOCKED_THIS_DEVICE_ONLY` 명시 강제(`ALWAYS` 금지).
- **apps/web 무 테스트 하니스(H-1)**: 웹 브리지 동작은 자동 vitest 불가 → typecheck/`next build` + 수동 종단으로만 검증. "vitest 전량 통과" 는 apps/mobile 한정.
- **OD-1 (웹 세션 권위)**: revisitable. 네이티브가 갱신을 인수하려 들면 토큰 경합 — 이 SPEC 은 웹 단일 권위 고수. 권위 = setSession 갱신 + 백엔드 JWKS(getSession 은 쿠키 가드, M-5).
- **OD-7 (에뮬레이터 호스트)**: MOBILE-001 OD-2/OD-3 상속. origin allowlist 는 `EXPO_PUBLIC_WEB_URL` 호스트 파생(M-4) — 쿠키·setSession 호스트 일관성이 종단 성공의 가장 흔한 실패점(AC-V3f).
- **PII 최소화(OD-4)**: 브리지 payload 에 `userId`/프로필을 싣지 않는다 — 토큰만. 식별자는 access token JWT `sub` 디코드. 회귀 시 노출면 증가.
- **Expo SDK 56 버전 드리프트**: `expo-secure-store`/`expo-splash-screen` API 는 학습 데이터와 다를 수 있음 → 버전드 docs 필독(`apps/mobile/AGENTS.md`).
- **웹 변경 범위 누수**: `apps/web` 변경이 가드된 브리지 util 1곳을 넘어가면 Non-Goal(신규 웹 경로) 위반 — `window.ReactNativeWebView` 가드로 순수 웹 무영향 유지.

---

## 디바이스 검증 결과 (2026-06-10, iOS 시뮬레이터 실측)

> 실제 시뮬레이터 빌드/실행으로 검증 시도. 자동 게이트(typecheck/vitest/build) + 보안 재리뷰는 통과했으나, 네이티브 종단은 아래 **환경 toolchain blocker** 로 부분 검증됨(우리 코드 무관).

### 검증 완료
- **네이티브 빌드 성공 + WebView 풀스크린 렌더 확인**: 시뮬레이터(iPhone 16 Plus)에서 네이티브 앱 안 WebViewShell 이 웹(localhost:3000)을 풀스크린 렌더 + SafeArea 정상 + 무크래시 — 앱↔웹뷰↔웹 구조가 실기기에서 동작함을 시각 확인.
- 웹 `/login` UI 렌더, 런타임 CSP nonce+strict-dynamic, 이메일 인증 API(HTTP 200) 별도 확인.

### [BLOCKER] Expo SDK 56 ↔ Xcode 26/Swift 6.2 빌드 비호환
- **precompiled 모드(기본)**: `expo-modules-jsi/Package.swift` 가 Swift tools 6.2(Xcode 26) 필수이나 소스 `weak let` 을 Swift 6.2 가 거부 → `nonisolated(unsafe) weak var` 패치로 빌드 성공. 단 **런타임에 앱 추가 모듈(`ExpoAsset` 등) 미등록 → `Cannot find native module 'ExpoAsset'`**(fresh 번들 재현, 캐시 번들은 통과). `ExpoModulesProvider.swift` 에는 등록돼 있으나 prebuilt-xcframework 가 런타임 레지스트리에 노출 못 함.
- **source 모드(`EXPO_USE_PRECOMPILED_MODULES=0`)**: 등록 갭은 사라지나 `expo-modules-core` 등 **전 모듈 `weak let` 이 Swift 6.2 와 충돌**(예: `SharedObjectRegistry.swift:37`) → 전 SDK 패치 필요(비현실적).
- **Xcode 16.4(Swift 6.1.2)**: JSI Package.swift tools 6.2 미충족으로 SPM 해석 자체 실패.

### [해결됨 2026-06-11] EAS --local 임베디드 빌드로 ExpoAsset 갭 해소 + AC-V3b 시각 검증
- **해결 경로(실증)**: `eas build --local -p ios -e local-sim`(임베디드 Release, dev-client 미사용) → **ExpoAsset 등록 갭 미발생**, 앱 완전 부팅 = `expo-secure-store`/`expo-splash-screen` 포함 전 네이티브 모듈 정상 등록. ExpoAsset 갭은 **dev-client+prebuilt 조합 한정** 이슈로 확정.
- **환경 구축(재현 절차)**: (1) jsi 패치 영속화 `pnpm patch expo-modules-jsi` → `patches/expo-modules-jsi.patch`(`weak let runtime`→`nonisolated(unsafe) weak var runtime`, pnpm-workspace.yaml `patchedDependencies` 등록); (2) `brew install fastlane`; (3) `eas init --force`(projectId → app.json); (4) eas.json `local-sim` 프로파일(ios.simulator:true + EXPO_PUBLIC_* env baked-in, prod 빈 env 제거). 산출 tar.gz → `simctl install/launch`.
- **AC-V3b 시각 검증 완료**: `WEB_URL=/me` 빌드로 미인증 콜드스타트 → 핸드셰이크 `session:none` → 스플래시 해제 → 웹 가드 → **`/login`(Meetup UI)이 셸 WebView 에 풀스크린 렌더**(스크린샷 증거). R-N5/R-N4/R-N6 경로 + 가드레일 4(임의 웹 라우트 호스팅) 동작.
- 참고: eas 로그의 `expo doctor 1 check failed`(expo/auth-session/linking 패치버전 드리프트)는 **non-fatal** — 빌드 성공에 영향 없음(선택: `npx expo install expo expo-auth-session expo-linking`으로 정리).

### [2026-06-11] 인터랙티브 종단 검증 결과 (cliclick 탭 자동화, EAS 임베디드 빌드)
시나리오 실측 (스크린샷 증거):
- ✅ **AC-V3b**: 미인증 콜드스타트 → `/login` 렌더 in-shell.
- ✅ **로그인 종단**: "이메일로 계속하기" 탭 → 폼 입력 → 제출 → **`/me` 도달 + 백엔드 GET /me Bearer 인증 성공**(프로필 upsert·렌더) — WebView→웹→백엔드→DB 풀스택 동작.
- ✅ **AC-V3a**: 콜드 재시작 → `/login` 노출 없이 `/me` 직행(세션 영속).
- ✅ **로그아웃 in-run**: 로그아웃 탭 → `/login` 복귀(signOutAction + GoTrue revoke 성공 — auth.sessions/refresh_tokens 삭제 확인).
- ✅ **[해결됨 2026-06-11] R-R4(c) 구현 + 디바이스 재검증 통과**: `@react-native-cookies/cookies@6.2.1` 도입, `session:cleared` 수신 시 `clearTokens()` + `clearWebViewCookies()`(WK store + NSHTTPCookieStorage). EAS 임베디드 재빌드 + 클린 슬레이트(앱 삭제→재설치) cliclick 종단: 미인증 콜드스타트→`/login` → 이메일 로그인→`/me` → 로그아웃→`/login` → **쿠키 파일(`Cookies.binarycookies`) 자체 삭제 확인(이전엔 `sb-127-auth-token` 영구 잔존)** → **콜드 재시작→`/login` 유지(부활 0)**. mobile vitest 94/94(신규 결정 분기 5 포함). 아래는 수정 전 원 결함 기록(이력 보존):
- 🔴 **(해결됨) 원 결함 — 로그아웃 후 재시작 세션 부활(AC-V3 (i) 위반)**: 로그아웃 후 콜드 재시작 시 `/me`가 다시 렌더. **원인 실측**: 앱 영속 쿠키 저장소(`Library/Cookies/com.hatae.moyura.binarycookies`)에 `sb-127-auth-token` 쿠키가 로그아웃 후에도 잔존(30초 백그라운드 flush 대기에도 mtime 불변 — 삭제 미영속). GoTrue 측 세션/refresh는 정상 revoke됐으나, `getSession()`은 쿠키만 읽고(서명/DB 검증 없음 — 감사 M-5) 백엔드 JWKS 가드도 **시간상 유효한 access JWT**(jwt_expiry=3600)를 통과시키므로, **로그아웃 후 최대 1시간** 재시작 시 세션이 부활한다(refresh revoke로 1시간 이후엔 종료 — 무한 부활 아님). SecureStore 토큰 경로가 아니라 **WebView 쿠키 삭제 미영속**이 원인 — `session:cleared`/`clearTokens`(R-R4)만으로는 닫히지 않는 갭.
- **권고(R-R4 확장 후보)**: 네이티브가 `session:cleared` 수신 시 SecureStore clear 에 **더해 신뢰 origin 의 WebView 쿠키도 제거**(RN CookieManager/WKWebsiteDataStore 경유)하는 요구 추가 — 임베디드/공유 쿠키 저장소의 삭제 미영속에 대한 defense-in-depth. (또는 웹 가드가 revoke 를 인지하도록 `getClaims` 수준 검증 강화 — 단 이는 stateless JWT 의 본질적 한계.)

### 남은 수동 검증
- (d) resume silent refresh 관찰(외부 관측 한계 — 크래시 없음만 확인됨), (h) 위조 메시지 거부 런타임 확인, 실제 Google 로그인(인간 자격증명). dev-client 경로의 ExpoAsset 갭은 별도 follow-up(임베디드/EAS 경로는 무관). 테스트 유저 `moyura-verify@example.com`/`Verify123!`.
