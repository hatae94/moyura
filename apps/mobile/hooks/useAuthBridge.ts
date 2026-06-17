// OAuth 브리지 + 토큰 동기화 훅 (SPEC-WEBVIEW-SHELL-001 R-S4 / SPEC-MOBILE-002 M2·M3) — App.tsx 에서 합성.
//
// SPEC-WEBVIEW-SHELL-001 의 기존 동작(OAuth 인터셉트 → 시스템 브라우저 브리지 → 콜백 네비게이트)을
// 보존(R-V1)하면서, SPEC-MOBILE-002 가 토큰 동기화 레이어를 얹는다:
//   - 콜드스타트: 신뢰 origin 로드 완료 후 저장 토큰을 session:restore 로 주입(R-T2), 핸들러 미등록
//     race 대비 bounded 재시도(R-T7), origin allowlist 선통과(R-T6).
//   - onMessage: session:synced → SecureStore 갱신(R-T5), session:cleared → clearTokens(R-R3),
//     session:none → 콜드스타트 해결(웹 가드가 /login 라우팅 — 네이티브 reload 없음).
//   - resume: resume:revalidate + 토큰 재주입(R-R1, App.tsx 가 호출, origin 선통과).
//
// 분기 결정은 모두 순수 auth-bridge-core.ts / bridge-protocol.ts 에 위임한다(node 단위 테스트).
// 보안(SPEC-MOBILE-002 v0.2.0 — C-1/C-2/H-1):
//   - 토큰 값을 로깅하지 않는다(R-T6/R-V2). 토큰은 postMessage 페이로드(JSON.stringify)로만 전달한다.
//   - 네이티브→웹 주입 postMessage 의 targetOrigin 은 신뢰 origin literal 이다(`"*"` 금지 — H-1).
//   - 주입 JS 가 in-page 에서 window.location.origin 을 LIVE 재검증한다(TOCTOU 차단 — R-T9).
//   - 모든 브리지 메시지가 per-session nonce 를 싣고, 수신 시 nonce 를 검증한다(R-T8/OD-11).
//   - onShouldStartLoadWithRequest 가 비신뢰 origin in-WebView 로드를 거부한다(R-T9 — WebView origin 잠금).
import { useCallback, useRef, type RefObject } from "react";
import { Linking } from "react-native";
import type WebView from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
} from "react-native-webview/lib/WebViewTypes";

import { WEB_URL } from "../lib/web-url";
import { SUPABASE_URL } from "../lib/env";
import { bridgeGoogleOAuth } from "../lib/auth/oauth";
import { signInWithGoogle } from "../lib/auth/google-signin";
import {
  createMobileSupabaseClient,
  exchangeGoogleIdTokenForSession,
} from "../lib/auth/supabase-mobile";
import { saveTokens, clearTokens, type SessionTokens } from "../lib/auth/token-store";
import { clearWebViewCookies } from "../lib/auth/cookie-clear";
import { unregisterDevice } from "../lib/push/register-device";
import {
  serializeBridgeMessage,
  parseBridgeMessage,
  buildRestoreMessage,
  buildRevalidateMessage,
  decideInboundAction,
} from "../lib/auth/bridge-protocol";
import {
  resolveBridgeNavigation,
  isTrustedOrigin,
  decideWebViewLoad,
  buildTargetOrigin,
  MAX_INJECTION_RETRIES,
} from "./auth-bridge-core";
import type { AppRoute } from "../lib/route-map-core";
import type { AuthBridgeSignal } from "../lib/auth/auth-state-core";

/** useAuthBridge 인자. */
export interface UseAuthBridgeArgs {
  /**
   * 인증 성공 시 WebView 가 로드할 웹 콜백 URL 로 네비게이트하는 콜백(OD-1 setSourceUri 주입).
   */
  onNavigateToCallback: (callbackUrl: string) => void;
  /** WebView 인스턴스 ref(호출부 소유 — injectJavaScript 로 토큰 주입, OD-1). */
  webViewRef: RefObject<WebView | null>;
  /**
   * 콜드스타트 핸드셰이크가 해결됐음(session:synced/none 수신)을 호출부에 알린다 — 스플래시 해제(R-N4).
   * session:cleared 는 콜드스타트 결과가 아니므로 호출하지 않는다(M-1).
   */
  onHandshakeResolved: () => void;
  /**
   * per-session one-time nonce(R-T8/OD-11). App.tsx 가 cold-start 시 1회 생성해 주입한다 — 모든 브리지
   * 메시지가 이 nonce 를 싣고(주입), 수신 메시지의 nonce 를 이 값과 상수시간 비교해 인증한다(위조 거부).
   */
  nonce: string;
  /**
   * (SPEC-MOBILE-003 R-AS2/R-NC5/R-PR5, optional) web→native 상태 신호를 호출부에 보고한다.
   * 부재 시(SHELL-001/MOBILE-002 호출부) onMessage 동작은 그대로다 — 회귀 0. AuthContext(T-009)가
   * synced/none/cleared 를 받아 isSignedIn 을 갱신하고 가드가 전환을 수행한다(선언적 Redirect).
   */
  onAuthSignal?: (signal: AuthBridgeSignal, tokens?: SessionTokens | null) => void;
  /**
   * (SPEC-MOBILE-003 R-NC2, optional) WebView 의 현재 navigation URL 을 돌려준다. 주어지면
   * onShouldStartLoadWithRequest 가 교차 라우트 디스패치 변형을 활성화한다(decideWebViewLoad 의
   * currentUrl 오버로드). 부재 시 기존 3분기 동작 그대로(회귀 0).
   */
  getCurrentUrl?: () => string;
  /**
   * (SPEC-MOBILE-003 R-NC2/R-NC3, optional) 교차 라우트 로드 차단 시 네이티브 라우트로 디스패치한다
   * (router.replace). getCurrentUrl 와 함께 주어질 때만 디스패치 분기가 동작한다.
   */
  onCrossRouteDispatch?: (route: AppRoute) => void;
}

/** useAuthBridge 리턴. */
export interface UseAuthBridgeResult {
  /** R-O1: provider authorize 네비게이션 인터셉트 → 시스템 브라우저 브리지. */
  onShouldStartLoadWithRequest: (request: ShouldStartLoadRequest) => boolean;
  /** R-T5/R-R3/R-N4: 웹→네이티브 메시지 수신 → 분기 처리(save/clear/handshake 해결). */
  onMessage: (event: WebViewMessageEvent) => void;
  /** R-T2/R-T7: 콜드스타트에 저장 토큰을 session:restore 로 주입(origin 선통과 + bounded 재시도). */
  injectRestore: (tokens: SessionTokens, currentUrl: string) => void;
  /** R-R1: resume 에 저장 토큰을 resume:revalidate 로 재주입(origin 선통과). */
  injectRevalidate: (tokens: SessionTokens, currentUrl: string) => void;
}

// 웹 핸들러 미등록 race 대비 재주입 간격(ms) — bounded 재시도(R-T7, MAX_INJECTION_RETRIES)와 함께 동작.
// give-up 시 R-N6 타임아웃이 스플래시를 마무리한다.
const INJECTION_RETRY_INTERVAL_MS = 400;

/**
 * 직렬화된 브리지 메시지를 WebView 로 postMessage 하는 주입 JS 를 만든다(R-T6/R-T8/R-T9).
 *
 * 보안 3중 방어:
 *   1. targetOrigin 을 신뢰 origin literal 로 고정한다(`"*"` 금지 — H-1). WebView 가 다른 origin 에
 *      있으면 브라우저가 메시지 전달을 자체 거부한다.
 *   2. in-page 에서 window.location.origin 을 LIVE 재검증한다(R-T9 TOCTOU 차단) — 주입 순간 페이지가
 *      신뢰 origin 이 아니면 postMessage 를 실행하지 않는다(stale currentUrlRef 비의존).
 *   3. 토큰은 JSON.stringify 로 한 번 더 감싼 문자열 리터럴로만 들어간다(코드 평가 아님 — injection 차단).
 *
 * @param serialized 직렬화된 BridgeMessage(nonce 포함)
 * @param targetOrigin 신뢰 origin literal(buildTargetOrigin 결과)
 * @returns injectJavaScript 로 실행할 JS 문자열
 */
function postMessageJs(serialized: string, targetOrigin: string): string {
  const payload = JSON.stringify(serialized);
  const origin = JSON.stringify(targetOrigin);
  // R-T9: in-page LIVE origin 가드 — 신뢰 origin 일 때만 postMessage(주입 순간 origin 재검증).
  return `(function(){try{if(window.location.origin===${origin}){window.postMessage(${payload}, ${origin});}}catch(e){}})(); true;`;
}

// @MX:ANCHOR: [AUTO] 토큰이 JS 브리지를 가로지르는 단일 동기화·인증 경계 — 콜드스타트/resume 주입,
//   onMessage 수신, in-WebView 로드 게이트, 그리고 (SPEC-MOBILE-004) 네이티브 Google Sign-In 으로 얻은
//   Supabase 세션 토큰까지 모두 이 훅의 injectRestore(session:restore v1)를 통과한다
//   (App.tsx + resume + 네이티브 SDK 경로 — fan_in 증가, >= 3).
// @MX:REASON: 보안 민감(R-V2 — C-1/C-2/H-1 + SPEC-MOBILE-004 AC-6b): 이 경계가 (1) origin allowlist +
//   LIVE origin 재검증(R-T6/R-T9 TOCTOU 차단), (2) specific targetOrigin(R-T8 — `"*"` 금지), (3) per-
//   session nonce 인증(R-T8/OD-11 — 위조 메시지 거부), (4) WebView origin 잠금(R-T9 deny 게이트),
//   (5) postMessage-only + 토큰 비로깅을 단일 출처로 보장한다. SPEC-MOBILE-004 가 네이티브 SDK 세션
//   토큰을 동일 injectRestore 로 주입하면서 이 경계를 통과하는 토큰 출처가 늘었으므로(fan_in↑),
//   bridge-protocol v1(메시지 타입/ nonce 봉투)을 변경하지 않고 기존 보안 불변식을 그대로 재사용한다.
//   하나라도 누락되면 third-party 페이지/동일 page 스크립트로 토큰이 유출되거나 session:restore
//   위조(세션 고정)가 가능하다(OWASP M3/M4/M5).
export function useAuthBridge({
  onNavigateToCallback,
  webViewRef,
  onHandshakeResolved,
  nonce,
  onAuthSignal,
  getCurrentUrl,
  onCrossRouteDispatch,
}: UseAuthBridgeArgs): UseAuthBridgeResult {
  // R-T7: 진행 중인 주입의 재시도 타이머·시도 횟수·ack 여부를 추적한다.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ackedRef = useRef<boolean>(false);
  // R-T8: targetOrigin 신뢰 origin literal(주입 시 `"*"` 대신 사용 — H-1).
  const targetOrigin = buildTargetOrigin(WEB_URL);
  // SPEC-MOBILE-004: 네이티브 Google Sign-In 실행 함수 ref. 실제 콜백은 injectRestore 정의 이후에
  // 할당한다(injectRestore 클로저 참조 — TDZ 회피). onShouldStartLoadWithRequest 의 oauth-intercept
  // 분기는 이 ref 를 통해 호출하므로 자신의 의존성 배열을 안정적으로 유지한다(렌더마다 재생성 방지).
  const nativeGoogleSignInRef = useRef<() => void>(() => undefined);

  // 시스템 브라우저 OAuth → deep-link 복귀 → WebView 콜백 로드(R-O2/R-O3/R-O4) — 보존(폴백 경로).
  //
  // SPEC-MOBILE-004: Google 은 아래 runNativeGoogleSignIn(네이티브 SDK) 으로 전환됐다. 이 시스템
  // 브라우저 브리지는 비-Google provider/수동 폴백 용도로 정의를 유지한다 — Google 경로의 실패는
  // REQ-MOB4-005(복구 가능한 오류: 미인증 유지 + 버튼 재활성)이므로 여기로 자동 폴백하지 않는다
  // (자동 폴백은 AC-6b 의 "다른 플로우 자동 실행 금지" 의미를 깬다).
  const runOAuthBridge = useCallback(
    async (interceptedAuthorizeUrl: string): Promise<void> => {
      const result = await bridgeGoogleOAuth(interceptedAuthorizeUrl);
      const callbackUrl = resolveBridgeNavigation(result, WEB_URL);
      if (!callbackUrl) {
        return; // cancelled | error | code 누락 → 미인증 유지(R-O4).
      }
      onNavigateToCallback(callbackUrl);
    },
    [onNavigateToCallback],
  );

  // SPEC-MOBILE-004 의 네이티브 Google Sign-In 경로(runNativeGoogleSignIn)는 injectRestore 정의 이후에
  // 선언한다(injectRestore 를 클로저로 참조 — TDZ 회피). onShouldStartLoadWithRequest 의 oauth-intercept
  // 분기가 그 ref 를 통해 호출한다(아래 nativeGoogleSignInRef).

  // R-O1/R-T9/R-NC2: in-WebView 로드 게이트 — OAuth 인터셉트 보존 + WebView origin 잠금(비신뢰 거부)
  //   + (MOBILE-003) 교차 라우트 차단 → 네이티브 라우트 디스패치.
  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      // R-NC2: getCurrentUrl 가 주어지면 currentUrl 을 넘겨 디스패치 변형을 활성화한다(부재 시 회귀 0).
      const decision = decideWebViewLoad(request.url, {
        trustedWebUrl: WEB_URL,
        supabaseBaseUrl: SUPABASE_URL,
        currentUrl: getCurrentUrl?.(),
      });
      // R-NC2/R-NC3: 교차 앱 라우트 — in-WebView 로드 차단 후 네이티브 라우트로 디스패치(WebView 자체 이동 금지).
      if (typeof decision === "object") {
        onCrossRouteDispatch?.(decision.route);
        return false;
      }
      switch (decision) {
        case "trusted-load":
          // 신뢰 origin / 프레임워크 내부 요청 — in-WebView 로드 허용(R-V1 무회귀).
          return true;
        case "oauth-intercept":
          // SPEC-MOBILE-004 R-MOB4-001: GoTrue authorize URL(WebView 내 Google 버튼 동작)을 인터셉트해
          // in-WebView 로드를 차단하고(return false) 네이티브 Google Sign-In SDK 를 실행한다 — 기존
          // 시스템 브라우저 브리지(runOAuthBridge) 대신. 데스크톱 웹은 이 인터셉트가 없으므로 기존
          // OAuth 흐름이 그대로 유지된다(AC-7 — 모바일 앱 컨텍스트에서만 동작).
          nativeGoogleSignInRef.current();
          return false;
        case "deny":
          // R-T9/C-2: 비신뢰 top-level origin — in-WebView 로드 거부, 외부 브라우저로 위임.
          void Linking.openURL(request.url).catch(() => undefined);
          return false;
      }
      // 위 switch 는 3분기를 전수 커버한다(decision 은 string union 으로 좁혀짐) — 도달 불가 방어 반환.
      return false;
    },
    // nativeGoogleSignInRef 는 안정적 ref 라 의존성이 아니다(oauth-intercept 가 ref.current 로 호출).
    [getCurrentUrl, onCrossRouteDispatch],
  );

  // 진행 중인 주입 재시도 타이머를 정리한다(핸드셰이크 해결/언마운트 시).
  const clearRetryTimer = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  // R-T5/R-R3/R-N4/R-R4/R-T8: 웹→네이티브 메시지 수신 분기(nonce 인증 포함).
  const onMessage = useCallback(
    (event: WebViewMessageEvent): void => {
      const message = parseBridgeMessage(event.nativeEvent.data);
      if (!message) {
        return; // unknown/오타/파싱 실패/nonce 누락 — 안전 무시(throw 없음, R-T1/R-T8/OD-6).
      }
      // R-T8: nonce 인증 — 위조/미인증 메시지는 decideInboundAction 이 ignore 로 거부한다(C-1).
      const action = decideInboundAction(message, nonce);
      switch (action.kind) {
        case "save":
          // R-T5: 웹이 ack(synced) — 재시도 중단, SecureStore 갱신, 콜드스타트 해결.
          ackedRef.current = true;
          clearRetryTimer();
          void saveTokens(action.tokens);
          onHandshakeResolved();
          // R-AS2/R-NC5: 갱신 토큰과 함께 synced 신호 보고 → AuthContext isSignedIn=true → 가드 전환.
          onAuthSignal?.("session:synced", action.tokens);
          break;
        case "clear":
          // R-R3/R-R4/M-3: SecureStore 클리어(로그아웃 cleared, 또는 none → stale refresh 제거).
          void clearTokens();
          if (action.clearCookies) {
            // R-R4 (c): 명시 로그아웃(session:cleared)에서만 WebView 쿠키도 제거 — 웹의 쿠키 삭제가
            // binarycookies 에 영속되지 않는 갭을 닫아 콜드 재시작 세션 부활을 차단한다. none(웹이 세션
            // 권위인 network-throw 폴백)에는 clearCookies false 라 호출되지 않는다(유효 쿠키 보존).
            void clearWebViewCookies();
          }
          if (action.resolvesHandshake) {
            // none/synced-불완전 — 콜드스타트 결과(웹 가드가 /login 라우팅). 스플래시 해제.
            ackedRef.current = true;
            clearRetryTimer();
            onHandshakeResolved();
            // R-AS2: none(또는 synced-불완전) — AuthContext 미로그인 처리(콜드스타트/세션 만료).
            onAuthSignal?.("session:none");
          } else {
            // R-PR5: cleared(로그아웃) — 콜드스타트 결과 아님(M-1). AuthContext 미로그인 → (auth)/login 전환.
            // R-PUSH-003/R-3: 명시 로그아웃에서만 디바이스 토큰을 해제한다(orphan token 방지 — 로그아웃 후
            // 푸시 수신 차단). none(콜드스타트 미인증)에는 호출하지 않는다 — 등록한 적 없는 디바이스이거나
            // 세션 만료 폴백이라 해제 대상이 아니다(현재 디바이스 토큰을 재획득해 best-effort DELETE).
            void unregisterDevice();
            onAuthSignal?.("session:cleared");
          }
          break;
        case "google-signin":
          // SPEC-MOBILE-004: 셸 Google 버튼 탭(nonce 인증 통과) → 네이티브 Google Sign-In SDK 실행.
          // 외부 브라우저 OAuth 네비게이션 없이 인앱 네이티브 로그인을 띄운다(결정적 경로 — 인터셉트 비의존).
          nativeGoogleSignInRef.current();
          break;
        case "ignore":
          break;
      }
    },
    [clearRetryTimer, onHandshakeResolved, nonce, onAuthSignal],
  );

  // R-T2/R-T7: 콜드스타트 토큰 주입 — origin allowlist 선통과 후 bounded 재시도로 주입.
  const injectRestore = useCallback(
    (tokens: SessionTokens, currentUrl: string): void => {
      // R-T6: 신뢰 WEB_URL origin 이 아니면 절대 주입하지 않는다(third-party 유출 차단).
      if (!isTrustedOrigin(currentUrl, WEB_URL)) {
        // 신뢰 origin 이 아니면 핸드셰이크를 진행할 수 없다 — 호출부 타임아웃(R-N6)이 스플래시를 해제한다.
        return;
      }
      ackedRef.current = false;
      clearRetryTimer();

      // R-T8: 메시지에 per-session nonce 를 싣는다(웹이 인증). targetOrigin 은 신뢰 origin literal.
      const serialized = serializeBridgeMessage(buildRestoreMessage(tokens, nonce));
      let attempts = 0;

      const attemptInject = (): void => {
        if (ackedRef.current || attempts >= MAX_INJECTION_RETRIES) {
          // ack 수신(stop) 또는 한도 도달(give-up) — 재시도 종료. give-up 은 R-N6 타임아웃이 마무리.
          clearRetryTimer();
          return;
        }
        attempts += 1;
        // R-T9: 주입 JS 가 in-page LIVE origin 을 재검증한다(TOCTOU 차단). targetOrigin specific(H-1).
        webViewRef.current?.injectJavaScript(postMessageJs(serialized, targetOrigin));
        // 핸들러 미등록 race(R-T7) 대비 — ack 없으면 일정 간격 후 재주입.
        retryTimerRef.current = setTimeout(attemptInject, INJECTION_RETRY_INTERVAL_MS);
      };
      attemptInject();
    },
    [webViewRef, clearRetryTimer, nonce, targetOrigin],
  );

  // R-R1: resume 토큰 재주입 — origin allowlist 선통과 후 resume:revalidate 주입(1회, ack 는 onMessage).
  const injectRevalidate = useCallback(
    (tokens: SessionTokens, currentUrl: string): void => {
      // R-T6/H-3: resume 재주입도 origin allowlist 선통과 — 백그라운드 중 third-party 네비게이트 방어.
      if (!isTrustedOrigin(currentUrl, WEB_URL)) {
        return;
      }
      // R-T8: nonce 포함, R-T9: 주입 JS 가 LIVE origin 재검증 + specific targetOrigin.
      const serialized = serializeBridgeMessage(buildRevalidateMessage(tokens, nonce));
      webViewRef.current?.injectJavaScript(postMessageJs(serialized, targetOrigin));
    },
    [webViewRef, nonce, targetOrigin],
  );

  // SPEC-MOBILE-004 R-MOB4-001/002/005: 네이티브 Google Sign-In → signInWithIdToken → 세션 주입.
  // (injectRestore 정의 이후에 선언 — 클로저로 참조해 TDZ 회피.)
  //
  // 1) signInWithGoogle(네이티브 SDK, 무료 Original API) → idToken/cancelled/error 분류.
  // 2) idToken → exchangeGoogleIdTokenForSession(Supabase signInWithIdToken) → session/error 분류.
  // 3) session → saveTokens(SecureStore) + injectRestore(session:restore v1, bridge-protocol 무변경)
  //    — 웹이 setSession 후 session:synced 로 ack 하면 onMessage 가 isSignedIn 전환을 보고한다(AC-5).
  // 4) cancelled/error(어느 단계든) → 미인증 유지: 토큰 저장/주입 없음. 로그인 페이지가 그대로 유지되고
  //    WebView 내 Google 버튼은 네이티브가 비활성화한 적이 없으므로 즉시 재시도 가능하다(AC-6a/6b).
  //
  // injectRestore 의 currentUrl 은 라이브 navigation URL(getCurrentUrl)을 쓴다 — 버튼 탭 시점의 WebView 는
  // 신뢰 origin 의 로그인 페이지이므로 isTrustedOrigin 선통과가 보장된다. getCurrentUrl 부재 폴백은
  // WEB_URL(셸의 신뢰 origin literal)을 쓴다 — isTrustedOrigin(WEB_URL, WEB_URL)===true.
  //
  // 보안(AC-6b): 토큰/idToken 값을 로깅하지 않는다 — core 분류 결과만 분기에 쓴다.
  const runNativeGoogleSignIn = useCallback(async (): Promise<void> => {
    const signIn = await signInWithGoogle();
    if (signIn.kind !== "idToken") {
      return; // cancelled | error → 미인증 유지, 토큰 미저장/미주입(AC-6a/6b).
    }
    const client = createMobileSupabaseClient();
    const session = await exchangeGoogleIdTokenForSession(client, signIn.token);
    if (session.kind !== "session") {
      return; // signInWithIdToken 실패 → 복구 가능한 오류: 미인증 유지, 토큰 미저장(AC-6b).
    }
    // 세션 확립 — SecureStore 저장 후 기존 session:restore 경로로 WebView 웹 세션에 주입(v1 무변경).
    await saveTokens(session.tokens);
    injectRestore(session.tokens, getCurrentUrl?.() ?? WEB_URL);
  }, [injectRestore, getCurrentUrl]);

  // oauth-intercept 분기(onShouldStartLoadWithRequest)가 호출하는 ref 를 최신 콜백으로 동기화한다.
  // ref 호출은 fire-and-forget(void)이며 결과 Promise 의 reject 는 흡수한다 — 분기는 미인증 유지일 뿐
  // 크래시하지 않는다(REQ-MOB4-005). 토큰/오류 상세는 로깅하지 않는다(AC-6b).
  nativeGoogleSignInRef.current = (): void => {
    void runNativeGoogleSignIn().catch(() => undefined);
  };

  return {
    onShouldStartLoadWithRequest,
    onMessage,
    injectRestore,
    injectRevalidate,
  };
}