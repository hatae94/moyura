// 풀스크린 WebView 셸 + OAuth 브리지 + 토큰 동기화 (SPEC-MOBILE-001 / SPEC-WEBVIEW-SHELL-001 / SPEC-MOBILE-002).
//
// 이 앱은 웹(apps/web)을 풀스크린 WebView 로 호스팅하는 씬 셸이다. 자체 네이티브 제품 화면은 짓지
// 않는다(파운데이션만 — SPEC-MOBILE-002 Non-Goal). 이메일/비번 로그인은 WebView 안에서, Google 소셜은
// 시스템 브라우저 브리지로 동작한다(R-V1 보존).
//
// SPEC-WEBVIEW-SHELL-001: 모놀리식 셸을 WebViewShell + 오버레이 + 훅으로 추출했다.
// SPEC-MOBILE-002 (M1·M2·M3): 토큰 기반 느슨한 결합 세션 파운데이션을 얹는다 —
//   - 콜드스타트: 스플래시 표시(R-N3) → SecureStore 토큰 로드 → WEB_URL 로드 → 로드 완료 시 신뢰
//     origin 에 session:restore 주입(R-T2) → 웹 setSession 검증/갱신 → synced/none 회신 시 스플래시
//     해제(R-N4) → bounded 타임아웃 시 강제 해제 폴백(R-N6, 무한 스플래시 금지).
//   - resume: AppState active 시 토큰 재주입+재검증(R-R1, useAppLifecycle/useAuthBridge 가 처리).
//   - 로그아웃: 웹 session:cleared → SecureStore 클리어(R-R3, useAuthBridge onMessage).
//
// [CRITICAL — OD-1] WebView ref/sourceUri state 는 여기(App.tsx)가 소유하고 리마운트하지 않는다
// (key prop 없음). OAuth 복귀/토큰 주입은 setSourceUri/injectJavaScript 로만 수행한다.
import { useCallback, useEffect, useRef, useState } from "react";
import { SafeAreaView, StyleSheet } from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import type WebView from "react-native-webview";

import { WEB_URL } from "./lib/web-url";
import { loadTokens, type SessionTokens } from "./lib/auth/token-store";
import { generateBridgeNonce } from "./lib/auth/nonce-core";
import { buildTargetOrigin } from "./hooks/auth-bridge-core";
import { WebViewShell } from "./components/WebViewShell";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { WebViewErrorOverlay } from "./components/WebViewErrorOverlay";
import { useAppLifecycle } from "./hooks/useAppLifecycle";
import { useAuthBridge } from "./hooks/useAuthBridge";

// R-N3/OD-8: 콜드스타트 핸드셰이크 동안 스플래시를 유지한다 — 모듈 평가 시점에 자동 숨김을 막는다.
// (실패해도 throw 하지 않게 흡수 — 스플래시 미지원 환경/이미 숨김 등.)
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// R-T9/C-2: WebView 를 신뢰 origin 에 잠그는 originWhitelist(WEB_URL origin literal 만 허용).
const TRUSTED_ORIGIN = buildTargetOrigin(WEB_URL);
const ORIGIN_WHITELIST: readonly string[] = [TRUSTED_ORIGIN];

/**
 * R-T8/OD-11: 컨텐츠 로드 전 per-session nonce 를 신뢰 origin 채널로 페이지에 확립하는 JS 를 만든다.
 * 웹 브리지(bridge-client)가 window.__MOYURA_BRIDGE_NONCE__ 를 읽어 인바운드 메시지 인증에 쓴다.
 * nonce 값은 JSON.stringify 로 문자열 리터럴로만 들어간다(코드 평가 아님).
 */
function buildNonceBootstrapJs(nonce: string): string {
  return `(function(){try{window.__MOYURA_BRIDGE_NONCE__=${JSON.stringify(nonce)};}catch(e){}})(); true;`;
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  // R-T8/OD-11: per-session one-time nonce — cold-start 시 1회 생성(앱 인스턴스 수명 동안 고정).
  const nonceRef = useRef<string>("");
  if (!nonceRef.current) {
    nonceRef.current = generateBridgeNonce();
  }
  // WebView 가 로드할 URL. 초기값은 셸이 호스팅하는 웹 URL. OAuth 복귀 시 웹 콜백 URL 로 교체(리마운트 아님).
  const [sourceUri, setSourceUri] = useState<string>(WEB_URL);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  // R-N3/R-T2: 콜드스타트에 주입할, SecureStore 에서 로드한 토큰(로드 완료 시 주입).
  const coldStartTokensRef = useRef<SessionTokens | null>(null);
  // 콜드스타트 토큰 로드 완료 여부(WebView onLoadEnd 와의 순서 무관하게 주입 1회 보장).
  const tokensLoadedRef = useRef<boolean>(false);
  const restoreInjectedRef = useRef<boolean>(false);

  // R-N3/R-N4/R-N6/R-R1: 콜드스타트 토큰 등록·핸드셰이크 타임아웃·resume 재검증(추출 — useAppLifecycle).
  const {
    onNavigationStateChange,
    registerColdStartTokens,
    markHandshakeResolved,
    startHandshakeTimeout,
  } = useAppLifecycle({
    webViewRef,
    // R-R1: resume 시 origin 선통과 후 토큰 재주입(injectRevalidate 가 origin allowlist 강제).
    onResumeRevalidate: (tokens, currentUrl) => injectRevalidate(tokens, currentUrl),
  });

  // R-N4: 콜드스타트 핸드셰이크 해결(synced/none 수신) → 스플래시 해제 + 타임아웃 취소.
  const resolveHandshake = useCallback((): void => {
    markHandshakeResolved();
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [markHandshakeResolved]);

  // R-O1~R-O4 보존 + R-T2/R-T5/R-T7/R-R1/R-R3/R-T8/R-T9: OAuth 브리지 + 토큰 동기화(추출 — useAuthBridge).
  const { onShouldStartLoadWithRequest, onMessage, injectRestore, injectRevalidate } =
    useAuthBridge({
      onNavigateToCallback: setSourceUri,
      webViewRef,
      onHandshakeResolved: resolveHandshake,
      // R-T8/OD-11: 모든 브리지 메시지에 싣고 인바운드 인증에 쓸 per-session nonce.
      nonce: nonceRef.current,
    });

  // R-N3: 콜드스타트 진입 — SecureStore 토큰 로드 + 핸드셰이크 bounded 타임아웃 시작(R-N6).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tokens = await loadTokens();
      if (cancelled) {
        return;
      }
      coldStartTokensRef.current = tokens;
      tokensLoadedRef.current = true;
      registerColdStartTokens(tokens); // resume 재검증 대상 등록.
      // R-N6: 결과(synced/none) 미수신 시 스플래시 강제 해제 폴백(무한 스플래시 금지).
      startHandshakeTimeout(() => {
        void SplashScreen.hideAsync().catch(() => undefined);
      });
      // 토큰 로드가 onLoadEnd 보다 늦었다면 여기서 주입을 시도한다(순서 무관 — 아래 maybeInjectRestore).
      maybeInjectRestore();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R-T2/R-N5: 신뢰 origin 로드 완료 + 토큰 로드 완료 시 1회 session:restore 주입.
  // 토큰 미보유면 주입하지 않고 웹 가드(getSession empty → /login)에 위임 + 스플래시는 timeout/none 으로 해제(R-N5).
  const maybeInjectRestore = useCallback((): void => {
    if (restoreInjectedRef.current || !tokensLoadedRef.current) {
      return;
    }
    const tokens = coldStartTokensRef.current;
    if (!tokens) {
      // R-N5: 미인증 콜드스타트 — 주입 없음. 웹 가드가 /login 라우팅하고, 핸드셰이크 결과가 없으므로
      // 스플래시는 R-N6 타임아웃이 해제한다(스플래시가 redirect 플래시를 가린다).
      restoreInjectedRef.current = true;
      return;
    }
    restoreInjectedRef.current = true;
    // R-T6/R-T7: injectRestore 가 origin allowlist 선통과 + bounded 재시도를 강제한다(현재 sourceUri origin).
    injectRestore(tokens, sourceUri);
  }, [injectRestore, sourceUri]);

  // R-U4 복구: 재시도 — 에러/로딩 상태 초기화 + 웹 URL 재로드.
  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setSourceUri(WEB_URL);
    webViewRef.current?.reload();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <WebViewShell
        ref={webViewRef}
        sourceUri={sourceUri}
        // R-T9/C-2: WebView 를 신뢰 origin 에 잠근다(비신뢰 origin in-WebView 로드 차단).
        originWhitelist={ORIGIN_WHITELIST}
        // R-T8/OD-11: 컨텐츠 로드 전 per-session nonce 를 페이지에 확립(웹 브리지 인증 기반).
        injectedJavaScriptBeforeContentLoaded={buildNonceBootstrapJs(nonceRef.current)}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        // R-T5/R-R3/R-N4: 웹→네이티브 메시지(session:synced/none/cleared) 수신.
        onMessage={onMessage}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => {
          setIsLoading(false);
          // R-T2: 신뢰 WEB_URL 로드 완료 — 토큰 주입 시도(토큰 로드 완료 여부와 무관하게 순서 안전).
          maybeInjectRestore();
        }}
        onError={() => {
          setHasError(true);
          setIsLoading(false);
          // 로드 실패 시에도 무한 스플래시를 막는다(R-N6 정신 — 에러 오버레이가 복구 제공).
          void SplashScreen.hideAsync().catch(() => undefined);
        }}
        onHttpError={() => {
          setHasError(true);
          setIsLoading(false);
          void SplashScreen.hideAsync().catch(() => undefined);
        }}
      />

      {/* R-U3: 로딩 중 인디케이터 오버레이. */}
      {isLoading && !hasError ? <LoadingOverlay /> : null}

      {/* R-U4: 복구 가능한 에러/오프라인 UI(재시도 제공) — 빈 화면/크래시 금지. */}
      {hasError ? <WebViewErrorOverlay webUrl={WEB_URL} onRetry={handleRetry} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
