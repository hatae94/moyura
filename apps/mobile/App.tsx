// 풀스크린 WebView 셸 + Google OAuth 브리지 (SPEC-MOBILE-001 M1~M3).
//
// 이 앱은 웹(apps/web)을 풀스크린 WebView 로 호스팅하는 씬 셸이다(R-S2). 자체 제품 화면은
// 네이티브로 만들지 않는다. 이메일/비번 로그인은 WebView 안에서 브리지 없이 동작하고(R-P1),
// Google 소셜만 시스템 브라우저로 빠져나갔다 deep link 로 복귀하는 네이티브 브리지가 필요하다.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeEventSubscription,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import WebView from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";

import { WEB_URL } from "./lib/web-url";
import {
  shouldBridgeOAuth,
  bridgeGoogleOAuth,
  resolveWebCallbackUrl,
} from "./lib/auth/oauth";

export default function App() {
  const webViewRef = useRef<WebView>(null);
  // WebView 가 로드할 URL. 초기값은 셸이 호스팅하는 웹 URL(R-S2). OAuth 복귀 시 웹 콜백 URL 로 교체한다(R-O3).
  const [sourceUri, setSourceUri] = useState<string>(WEB_URL);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  // Android 하드웨어 백 처리를 위한 네비게이션 히스토리 여부(R-U1).
  const canGoBackRef = useRef<boolean>(false);

  // R-U1: Android 하드웨어 백 — 히스토리가 있으면 WebView.goBack(), 없으면 기본 종료.
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const onBackPress = (): boolean => {
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true; // 이벤트 소비 — 앱이 종료되지 않는다.
      }
      return false; // 히스토리 없음 — 기본 종료 동작 허용.
    };
    const subscription: NativeEventSubscription = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );
    return () => subscription.remove();
  }, []);

  // R-U4 복구: 재시도 — 에러/로딩 상태를 초기화하고 웹 URL 을 다시 로드한다.
  const handleRetry = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    setSourceUri(WEB_URL);
    webViewRef.current?.reload();
  }, []);

  // 시스템 브라우저 OAuth → deep-link 복귀 → WebView 콜백 로드(R-O2/R-O3/R-O4).
  const runOAuthBridge = useCallback(async (interceptedAuthorizeUrl: string): Promise<void> => {
    const result = await bridgeGoogleOAuth(interceptedAuthorizeUrl);
    if (result.kind !== "authenticated") {
      // cancelled | error → 미인증 유지, 크래시 없음, 로그인 surface 에 머문다(R-O4).
      return;
    }
    const callbackUrl = resolveWebCallbackUrl(result.returnUrl, WEB_URL);
    if (!callbackUrl) {
      // code 누락 등 — half-auth 방지(미인증 유지). 로그인 surface 유지(R-O4).
      return;
    }
    // WebView 를 웹 콜백 URL(?code=)로 네비게이트 → @supabase/ssr 가 교환·쿠키 세션 설정 → /me(R-O3).
    setSourceUri(callbackUrl);
  }, []);

  // R-O1: GoTrue authorize URL 로의 네비게이션을 인터셉트해 임베디드 로드를 차단하고,
  // 시스템 브라우저로 Google OAuth 를 브리지한다. 그 외 네비게이션은 정상 허용한다(EC-5).
  // @MX:WARN: [AUTO] 외부 시스템(시스템 브라우저/IdP) 경계 — 복귀 실패는 throw 가 아니라
  //   복구 가능 결과({cancelled|error})로 분류해 미인증 유지·크래시 없음을 보장해야 한다(R-O4/R-E4).
  // @MX:REASON: 인터셉트가 너무 넓으면 정상 네비게이션까지 차단(EC-5), half-auth(브라우저 쿠키)나
  //   deep-link 미복귀 시 멈춤이 발생할 수 있는 가장 취약한 경계다. authorizeUrl 의 redirect_to 를
  //   deep-link 로 재작성(bridgeGoogleOAuth)해야 WebView 쿠키 컨텍스트로 세션이 안착한다(OD-5).
  const handleShouldStartLoad = useCallback(
    (request: ShouldStartLoadRequest): boolean => {
      if (!shouldBridgeOAuth(request.url)) {
        return true; // 정상 네비게이션 — 임베디드 로드 허용.
      }
      // 임베디드 WebView 로 provider 페이지를 직접 로드하지 않는다(Google 차단 — R-E2/R-O1).
      void runOAuthBridge(request.url);
      return false;
    },
    [runOAuthBridge],
  );

  // R-U1: WebView 네비게이션 히스토리 추적(하드웨어 백 분기에 사용).
  const handleNavStateChange = useCallback((nav: WebViewNavigation): void => {
    canGoBackRef.current = nav.canGoBack;
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <WebView
        ref={webViewRef}
        // R-S2: 풀스크린 웹 호스트. sourceUri state 변경 시 WebView 가 새 URL 로 네비게이트한다(R-O3 콜백 교체).
        // key 는 일부러 두지 않는다 — 리마운트하면 WebView 쿠키/PKCE 컨텍스트가 초기화돼 OAuth 흐름이 깨진다(OD-5).
        source={{ uri: sourceUri }}
        style={styles.webview}
        // R-O5: OAuth 왕복/앱 재시작을 가로질러 @supabase/ssr 세션 쿠키를 보존한다.
        sharedCookiesEnabled // iOS
        thirdPartyCookiesEnabled // Android
        // R-O1: provider authorize 네비게이션 인터셉트 → 시스템 브라우저 브리지.
        onShouldStartLoadWithRequest={handleShouldStartLoad}
        // R-U1: 히스토리 추적.
        onNavigationStateChange={handleNavStateChange}
        // R-U3: 로딩 인디케이터.
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        // R-U4: 로드 실패(네트워크/도달 불가) → 복구 가능한 에러 상태.
        onError={() => {
          setHasError(true);
          setIsLoading(false);
        }}
        onHttpError={() => {
          setHasError(true);
          setIsLoading(false);
        }}
      />

      {/* R-U3: 로딩 중 인디케이터 오버레이. */}
      {isLoading && !hasError ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      ) : null}

      {/* R-U4: 복구 가능한 에러/오프라인 UI(재시도 제공) — 빈 화면/크래시 금지. */}
      {hasError ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>연결할 수 없습니다</Text>
          <Text style={styles.errorBody}>
            웹 서버({WEB_URL})에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryLabel}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  webview: {
    flex: 1,
  },
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#fff",
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorBody: {
    fontSize: 14,
    color: "#555",
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#1a73e8",
  },
  retryLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
