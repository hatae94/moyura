// 브리지 연결 WebView 화면 프리미티브 (SPEC-MOBILE-003 R-RT3/R-AS2/R-NC2/R-NC4/R-PR2/R-WB5).
//
// App.tsx 의 루트 오케스트레이션 본문(WebViewShell + useAuthBridge + useAppLifecycle + 콜드스타트
// session:restore 주입 + 스플래시/핸드셰이크 타임아웃 + OAuth 콜백 네비게이트)을 행위 보존으로
// 추출한 재사용 화면 프리미티브다. (auth)/login 과 (tabs)/{home,explore,notifications,profile} 가
// 이 한 컴포넌트를 source/routeContext 만 달리해 마운트한다 — App.tsx 본문을 화면마다 복제하지 않는다.
//
// [CRITICAL — OD-1] WebView ref/sourceUri 는 이 컴포넌트가 소유하고 리마운트하지 않는다(key 없음).
// OAuth 복귀/토큰 주입은 setSourceUri/injectJavaScript 로만 수행한다(쿠키/PKCE 컨텍스트 보존).
//
// 인증 소스 분담: nonce·isSignedIn 상태는 AuthContext 가 소유하고, 이 컴포넌트는 web→native 신호를
// reportSignal 로 AuthContext 에 보고한다(R-AS2). 가드 전환(R-NC5/R-PR5)은 AuthContext.isSignedIn 을
// 보는 그룹 _layout 의 선언적 <Redirect> 가 수행한다 — 여기서 imperative 전환을 하지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { useRouter } from "expo-router";
import type WebView from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";

import { WEB_URL } from "../lib/web-url";
import { loadTokens, type SessionTokens } from "../lib/auth/token-store";
import { buildTargetOrigin } from "../hooks/auth-bridge-core";
import { urlForRoute, type AppRoute } from "../lib/route-map-core";
import { useAuth } from "../lib/auth/AuthContext";
import { useAppLifecycle } from "../hooks/useAppLifecycle";
import { useAuthBridge } from "../hooks/useAuthBridge";
import { WebViewShell } from "./WebViewShell";
import { LoadingOverlay } from "./LoadingOverlay";
import { WebViewErrorOverlay } from "./WebViewErrorOverlay";

// R-T9/C-2: WebView 를 신뢰 origin 에 잠그는 originWhitelist(WEB_URL origin literal 만 허용).
const TRUSTED_ORIGIN = buildTargetOrigin(WEB_URL);
const ORIGIN_WHITELIST: readonly string[] = [TRUSTED_ORIGIN];

/**
 * R-T8/OD-11: 컨텐츠 로드 전 per-session nonce 를 페이지에 확립하는 JS 를 만든다(App.tsx 보존).
 * nonce 값은 JSON.stringify 로 문자열 리터럴로만 들어간다(코드 평가 아님).
 */
function buildNonceBootstrapJs(nonce: string): string {
  return `(function(){try{window.__MOYURA_BRIDGE_NONCE__=${JSON.stringify(nonce)};}catch(e){}})(); true;`;
}

export interface BridgedWebViewProps {
  /** WebView 가 로드할 초기 URL(탭은 urlForRoute(route, WEB_URL), (auth)/login 은 ${WEB_URL}/login). */
  sourceUri: string;
  /**
   * R-NC4: 라우트 그룹 컨텍스트. `"(tabs)"` 면 Android 백을 expo-router 에 위임(교차 라우트 디스패치
   * 활성), `"(auth)"` 면 WebView back 보존(인증 플로우 in-WebView 유지).
   */
  routeContext: "(tabs)" | "(auth)";
}

/**
 * 브리지 연결 WebView 화면(App.tsx 본문 보존 + 라우트 컨텍스트 적용).
 *
 * @MX:WARN: [AUTO] App.tsx 엔트리 오케스트레이션을 행위 보존 이전한 화면 프리미티브 — 콜드스타트
 *           스플래시/세션 핸드셰이크/OAuth 콜백 네비게이트가 모두 여기를 통과한다.
 * @MX:REASON: 엔트리 포인트 전환(SPEC-MOBILE-003 R-RT3)은 세션 부트/스플래시 회귀 위험이 HIGH 다.
 *             콜드스타트 토큰 주입 순서(maybeInjectRestore)·핸드셰이크 타임아웃(R-N6 무한 스플래시
 *             금지)·OD-1 무리마운트(쿠키/PKCE 보존)가 깨지면 로그인 무한 루프나 세션 부트 실패가
 *             발생한다. 디바이스 종단 검증 전까지 동작은 미확정이다(콜드스타트/탭전환/back/로그아웃).
 */
export function BridgedWebView({
  sourceUri: initialSourceUri,
  routeContext,
}: BridgedWebViewProps): React.JSX.Element {
  const { nonce, reportSignal } = useAuth();
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);

  // WebView 가 로드할 URL. OAuth 복귀 시 웹 콜백 URL 로 교체(리마운트 아님 — OD-1).
  const [sourceUri, setSourceUri] = useState<string>(initialSourceUri);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);

  // R-NC2: onShouldStartLoadWithRequest 가 currentUrl 을 읽을 수 있도록 navigation URL 을 추적한다.
  const currentUrlRef = useRef<string>(initialSourceUri);

  // R-N3/R-T2: 콜드스타트에 주입할, SecureStore 에서 로드한 토큰(로드 완료 시 주입).
  const coldStartTokensRef = useRef<SessionTokens | null>(null);
  const tokensLoadedRef = useRef<boolean>(false);
  const restoreInjectedRef = useRef<boolean>(false);

  // R-N3/R-N4/R-N6/R-R1/R-NC4: 콜드스타트 토큰 등록·핸드셰이크 타임아웃·resume 재검증·라우트 백 분기.
  const {
    onNavigationStateChange: lifecycleOnNavigationStateChange,
    registerColdStartTokens,
    markHandshakeResolved,
    startHandshakeTimeout,
  } = useAppLifecycle({
    webViewRef,
    routeContext,
    onResumeRevalidate: (tokens, currentUrl) => injectRevalidate(tokens, currentUrl),
  });

  // R-N4: 콜드스타트 핸드셰이크 해결(synced/none 수신) → 스플래시 해제 + 타임아웃 취소(App.tsx 보존).
  const resolveHandshake = useCallback((): void => {
    markHandshakeResolved();
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [markHandshakeResolved]);

  // R-NC2/R-NC3: 교차 라우트 차단 시 네이티브 라우트로 디스패치(WebView 자체 이동 금지 → router.replace).
  const onCrossRouteDispatch = useCallback(
    (route: AppRoute): void => {
      router.replace(`/(tabs)/${route}` as never);
    },
    [router],
  );

  // R-O1~R-O4 보존 + R-T2/R-T5/R-T7/R-R1/R-R3/R-T8/R-T9 + R-NC2/R-AS2: OAuth 브리지 + 토큰 동기화 + 신호 보고.
  const { onShouldStartLoadWithRequest, onMessage, injectRestore, injectRevalidate } =
    useAuthBridge({
      onNavigateToCallback: setSourceUri,
      webViewRef,
      onHandshakeResolved: resolveHandshake,
      nonce,
      // R-AS2/R-NC5/R-PR5: synced/none/cleared 를 AuthContext 에 보고 → 가드가 전환을 수행한다.
      onAuthSignal: reportSignal,
      // R-NC2: 디스패치 변형 활성화(currentUrl 제공) + 교차 라우트 → router.replace.
      getCurrentUrl: () => currentUrlRef.current,
      onCrossRouteDispatch,
    });

  // R-T2/R-N5: 신뢰 origin 로드 완료 + 토큰 로드 완료 시 1회 session:restore 주입(App.tsx maybeInjectRestore 보존).
  const maybeInjectRestore = useCallback((): void => {
    if (restoreInjectedRef.current || !tokensLoadedRef.current) {
      return;
    }
    const tokens = coldStartTokensRef.current;
    if (!tokens) {
      // R-N5: 미인증 콜드스타트 — 주입 없음. 웹 가드가 /login 라우팅하고, 스플래시는 R-N6 타임아웃이 해제한다.
      restoreInjectedRef.current = true;
      return;
    }
    restoreInjectedRef.current = true;
    // R-T6/R-T7: injectRestore 가 origin allowlist 선통과 + bounded 재시도를 강제한다(현재 sourceUri origin).
    injectRestore(tokens, sourceUri);
  }, [injectRestore, sourceUri]);

  // R-N3: 콜드스타트 진입 — SecureStore 토큰 로드 + 핸드셰이크 bounded 타임아웃 시작(App.tsx 보존).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let tokens: SessionTokens | null = null;
      try {
        tokens = await loadTokens();
      } catch (error) {
        // 토큰 로드 실패 시 토큰 없음으로 진행(스플래시 타임아웃 폴백 R-N6 은 그대로 동작) — 원인은 로그로 보존.
        console.error("[BridgedWebView] 콜드스타트 loadTokens 실패 — 토큰 없음으로 진행:", error);
      }
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
      maybeInjectRestore();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // R-U1/R-R1/R-NC2: 네비게이션 히스토리·현재 URL 추적(useAppLifecycle 위임 + currentUrlRef 갱신).
  const onNavigationStateChange = useCallback(
    (nav: WebViewNavigation): void => {
      currentUrlRef.current = nav.url;
      lifecycleOnNavigationStateChange(nav);
    },
    [lifecycleOnNavigationStateChange],
  );

  // R-U4 복구: 재시도 — 에러/로딩 상태 초기화 + 초기 URL 재로드.
  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setSourceUri(initialSourceUri);
    webViewRef.current?.reload();
  }, [initialSourceUri]);

  return (
    <View style={styles.container}>
      <WebViewShell
        ref={webViewRef}
        sourceUri={sourceUri}
        // R-T9/C-2: WebView 를 신뢰 origin 에 잠근다(비신뢰 origin in-WebView 로드 차단).
        originWhitelist={ORIGIN_WHITELIST}
        // R-T8/OD-11: 컨텐츠 로드 전 per-session nonce 를 페이지에 확립(셸 마커는 WebViewShell 가 항상 선행 주입).
        injectedJavaScriptBeforeContentLoaded={buildNonceBootstrapJs(nonce)}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        // R-T5/R-R3/R-N4: 웹→네이티브 메시지(session:synced/none/cleared) 수신.
        onMessage={onMessage}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => {
          setIsLoading(false);
          maybeInjectRestore();
        }}
        onError={() => {
          setHasError(true);
          setIsLoading(false);
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
    </View>
  );
}

/** (tabs) 탭 래퍼 공용 헬퍼 — 라우트의 호스팅 웹 URL 로 BridgedWebView 를 마운트한다(R-WB5/R-NC1). */
export function TabWebView({ route }: { route: AppRoute }): React.JSX.Element {
  return <BridgedWebView sourceUri={urlForRoute(route, WEB_URL)} routeContext="(tabs)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
