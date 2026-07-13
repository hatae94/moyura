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
import { Alert, StyleSheet, View } from "react-native";
import type { Edge } from "react-native-safe-area-context";
import * as SplashScreen from "expo-splash-screen";
import { useRouter } from "expo-router";
import type WebView from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";

import { WEB_URL } from "../lib/web-url";
import { loadTokens, type SessionTokens } from "../lib/auth/token-store";
import {
  consumeDeepLinkTarget,
  subscribeDeepLinkTarget,
} from "../lib/push/deep-link-intent";
import { buildTargetOrigin } from "../hooks/auth-bridge-core";
import { urlForRoute, type AppRoute } from "../lib/route-map-core";
import { useAuth } from "../lib/auth/AuthContext";
import type { AuthBridgeSignal } from "../lib/auth/auth-state-core";
import { useAppLifecycle } from "../hooks/useAppLifecycle";
import { useAuthBridge } from "../hooks/useAuthBridge";
import { decideHeader, type NavState } from "../lib/nav-header-core";
import { WebViewShell } from "./WebViewShell";
import { NativeHeaderBar } from "./NativeHeaderBar";
import { WebViewErrorOverlay } from "./WebViewErrorOverlay";

/**
 * R-NF2(M2/T-004): Expo splash 를 fade 옵션으로 해제하는 단일 헬퍼. 4곳(핸드셰이크 해결·타임아웃
 * 폴백·onError·onHttpError)의 동일 `hideAsync` 호출을 한 곳으로 통합해 중복을 제거한다 — 발화 조건은
 * 각 호출부 그대로 보존한다(의미 무변경). fade 동작은 _layout.tsx 의 setOptions({ fade:true })가 켠다.
 */
function hideSplash(): void {
  void SplashScreen.hideAsync().catch(() => undefined);
}

// R-T9/C-2: WebView 를 신뢰 origin 에 잠그는 originWhitelist(WEB_URL origin literal 만 허용).
const TRUSTED_ORIGIN = buildTargetOrigin(WEB_URL);
const ORIGIN_WHITELIST: readonly string[] = [TRUSTED_ORIGIN];

// safe-area 엣지(라우트 컨텍스트별): (tabs) 는 하단 네이티브 탭바(Tabs)가 bottom inset 을 소유하므로
// top(+좌우)만 인셋한다 — bottom 까지 넣으면 탭바 + safe-area 이중 패딩이 된다. (auth)/공개 라우트(invite)는
// 탭바 없는 풀스크린이라 top+bottom(+좌우) 전부 인셋한다. 좌우는 노치/랜드스케이프 대비(세로에선 0).
const SAFE_AREA_EDGES: Record<"(tabs)" | "(auth)", readonly Edge[]> = {
  "(tabs)": ["top", "left", "right"],
  "(auth)": ["top", "bottom", "left", "right"],
};

// SPEC-MOBILE-NAV-001: (tabs) 에서 네이티브 헤더가 렌더될 때(headerVisible)는 NativeHeaderBar 가 top
// status-bar 인셋을 소유하므로 WebViewShell edges 에서 top 을 제거해 이중 인셋(헤더+WebView 둘 다 top)을
// 막는다. 헤더 없는 라우트(탭 루트·보류 페이지)에서는 기존 (tabs) top 인셋을 그대로 유지한다(회귀 0).
// (auth)/공개 라우트는 헤더가 애초에 없어 이 조정 대상이 아니다(기존 top+bottom 유지).
const SAFE_AREA_EDGES_TABS_WITH_HEADER: readonly Edge[] = ["left", "right"];

/**
 * 헤더 가시 여부를 반영한 WebViewShell safe-area edges 를 돌려준다(이중 top 인셋 방지).
 * (tabs) + 헤더 가시 → top 제거(헤더가 소유), 그 외 → 라우트 컨텍스트 기본 edges.
 */
function webViewEdgesFor(
  routeContext: "(tabs)" | "(auth)",
  headerVisible: boolean,
): readonly Edge[] {
  if (routeContext === "(tabs)" && headerVisible) {
    return SAFE_AREA_EDGES_TABS_WITH_HEADER;
  }
  return SAFE_AREA_EDGES[routeContext];
}

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
  /**
   * SPEC-MOBILE-NAV-001 정합(알림 탭 딥링크): true 면 deep-link-intent(알림 탭이 저장한 대상 채팅 URL)를
   * 소비해 이 WebView 를 대상으로 setSourceUri 한다(리마운트 없음 — 세션 쿠키 보존). home 탭만 true —
   * 모임/채팅은 home 탭 하위 웹 라우트라 이 탭 WebView 가 소비한다. detail-push(별도 WebView) 대체.
   */
  consumesDeepLink?: boolean;
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
  consumesDeepLink = false,
}: BridgedWebViewProps): React.JSX.Element {
  const { nonce, reportSignal, isSignedIn } = useAuth();
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);

  // WebView 가 로드할 URL. OAuth 복귀 시 웹 콜백 URL 로 교체(리마운트 아님 — OD-1).
  const [sourceUri, setSourceUri] = useState<string>(initialSourceUri);
  // R-NF2(M2/T-002): 로딩 표시는 WebViewShell 의 startInLoadingState/renderLoading 이 단일 소유한다
  // (이전 isLoading state + 형제 LoadingOverlay 제거 — double-overlay 해소). 에러 상태만 여기서 관리한다.
  const [hasError, setHasError] = useState<boolean>(false);

  // R-NC2: onShouldStartLoadWithRequest 가 currentUrl 을 읽을 수 있도록 navigation URL 을 추적한다.
  const currentUrlRef = useRef<string>(initialSourceUri);

  // SPEC-MOBILE-NAV-001: 웹이 nav:state 로 보고한 최신 nav 상태. NativeHeaderBar 렌더 + WebViewShell edges
  // 조정 + Android web-back(webCanGoBack) 판정의 단일 소스다. 첫 보고 전 null(헤더 미렌더 — 빈 헤더 방지).
  const [navState, setNavState] = useState<NavState | null>(null);
  // REQ-MOBNAV-020/022: injectNavBack 은 useAuthBridge 리턴이라 useAppLifecycle(먼저 호출)에서 forward-
  // reference 다. ref 로 우회해 안정 콜백(handleWebBack)이 최신 injectNavBack 을 호출하게 한다(useAuthBridge
  // 내부 nativeGoogleSignInRef 와 동형 패턴 — TDZ/재구독 회피).
  const injectNavBackRef = useRef<() => void>(() => undefined);
  const handleWebBack = useCallback((): void => {
    injectNavBackRef.current();
  }, []);

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
    // REQ-MOBNAV-022: 웹이 보고한 in-app back 가능 여부 → (tabs) 하드웨어 back 이 web-back 위임 여부 결정.
    webCanGoBack: navState?.canGoBack ?? false,
    // REQ-MOBNAV-022: web-back 결정 시 nav:back 위임(헤더 back 과 동일 경로 — injectNavBack via ref).
    onWebBack: handleWebBack,
  });

  // R-N4: 콜드스타트 핸드셰이크 해결(synced/none 수신) → 스플래시 해제 + 타임아웃 취소(App.tsx 보존).
  const resolveHandshake = useCallback((): void => {
    markHandshakeResolved();
    hideSplash();
  }, [markHandshakeResolved]);

  // R-NC2/R-NC3: 교차 라우트 차단 시 네이티브 라우트로 디스패치(WebView 자체 이동 금지 → router.replace).
  const onCrossRouteDispatch = useCallback(
    (route: AppRoute): void => {
      router.replace(`/(tabs)/${route}` as never);
    },
    [router],
  );

  // SPEC-MOIM-011 후속: 웹 초대 수락 페이지가 로드 시 무효 초대(미지/만료/폐기)를 invite:invalid 로 통지하면
  // 네이티브가 처리한다(웹 모달 대신 — 앱 컨텍스트). 로그인 여부와 무관하게 안내 Alert("유효하지 않은
  // 초대입니다.", backdrop 비활성 — cancelable:false)를 띄우고, 확인 시 목적지로 router.replace 한다:
  // 실제 계정 로그인 → 메인 탭((tabs)/home), 미로그인/익명 → 로그인((auth)/login). 미로그인도 조용히
  // 이동하지 않고 동일 안내를 먼저 보여준다(UX — 무효 사유 인지). 네이티브 라우터 전환이라 무효 화면이 스택에 안 남는다.
  const onInviteInvalid = useCallback(
    (loggedIn: boolean): void => {
      const dest = loggedIn ? "/(tabs)/home" : "/(auth)/login";
      Alert.alert(
        "유효하지 않은 초대입니다.",
        undefined,
        [{ text: "확인", onPress: () => router.replace(dest as never) }],
        { cancelable: false },
      );
    },
    [router],
  );

  // R-R1 [FIX]: 세션 신호를 AuthContext(reportSignal)에 보고하면서, session:synced 최신 토큰으로 resume 재검증
  //   토큰(useAppLifecycle tokensRef)을 함께 갱신한다. App.tsx→BridgedWebView 이전(SPEC-MOBILE-003) 때 이
  //   "synced 시 registerColdStartTokens 갱신"이 누락됐다(useAppLifecycle:93/173 주석은 이 갱신을 명시한다).
  //   누락 시: 콜드스타트 SecureStore 에 stale 토큰이 있는 상태에서 fresh 로그인하면 tokensRef 는 stale 로
  //   남고, resume(백그라운드→포그라운드)가 그 stale 토큰으로 injectRevalidate → 웹 setSession 실패 →
  //   session:none → clearWebViewCookies → *로그아웃*된다(device 확정). synced 만 갱신한다(none/cleared 는
  //   useAuthBridge 가 clearTokens 로 별도 처리, 다음 콜드스타트/synced 가 tokensRef 를 정리).
  const handleAuthSignal = useCallback(
    (signal: AuthBridgeSignal, syncedTokens?: SessionTokens | null): void => {
      reportSignal(signal, syncedTokens);
      if (signal === "session:synced" && syncedTokens) {
        registerColdStartTokens(syncedTokens); // resume 재검증 대상 토큰을 최신으로 갱신(stale 재검증 방지).
      }
    },
    [reportSignal, registerColdStartTokens],
  );

  // R-O1~R-O4 보존 + R-T2/R-T5/R-T7/R-R1/R-R3/R-T8/R-T9 + R-NC2/R-AS2 + NAV-001: OAuth 브리지 + 토큰
  // 동기화 + 신호 보고 + nav 상태 수신/back 위임.
  const { onShouldStartLoadWithRequest, onMessage, injectRestore, injectRevalidate, injectNavBack } =
    useAuthBridge({
      onNavigateToCallback: setSourceUri,
      webViewRef,
      onHandshakeResolved: resolveHandshake,
      nonce,
      // R-AS2/R-NC5/R-PR5: synced/none/cleared 를 AuthContext 에 보고(가드 전환) + synced 시 resume 토큰 갱신.
      onAuthSignal: handleAuthSignal,
      // R-NC2: 디스패치 변형 활성화(currentUrl 제공) + 교차 라우트 → router.replace.
      getCurrentUrl: () => currentUrlRef.current,
      onCrossRouteDispatch,
      // SPEC-MOIM-011 후속: 무효 초대 통지 → 네이티브 Alert + (tabs)/home 또는 (auth)/login 전환.
      onInviteInvalid,
      // SPEC-MOBILE-NAV-001 REQ-MOBNAV-010: 웹 nav:state 보고 → 헤더 상태 갱신(NativeHeaderBar 구동).
      onNavState: setNavState,
    });

  // REQ-MOBNAV-020/022: forward-referenced injectNavBack 를 ref 에 동기화한다 — handleWebBack(useAppLifecycle
  // onWebBack) 과 헤더 back 탭이 이 ref 로 최신 injectNavBack 을 호출한다(안정 콜백 유지 — 재구독 회피).
  injectNavBackRef.current = injectNavBack;

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
        hideSplash();
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

  // R-U4 복구: 재시도 — 에러 상태 초기화 + 초기 URL 재로드. 로딩 표시는 reload 시 WebViewShell 의
  // startInLoadingState 가 재진입해 자동 처리한다(별도 isLoading 불필요 — double-overlay 해소 후).
  const handleRetry = useCallback(() => {
    setHasError(false);
    setSourceUri(initialSourceUri);
    webViewRef.current?.reload();
  }, [initialSourceUri]);

  // SPEC-MOBILE-NAV-001 정합(알림 탭 딥링크): consumesDeepLink(home 탭)이면 deep-link-intent 에 저장된 대상
  // 채팅 URL 을 소비해 이 *기존* WebView 를 setSourceUri 로 이동한다(리마운트 없음 — 세션 쿠키 보존, OD-1).
  // 세션 확립(isSignedIn) 후에만 적용해 미인증 로드→/login 바운스→session:cleared 로그아웃 연쇄를 피한다:
  //   - background 탭: 이미 isSignedIn=true → 구독 통지 즉시 적용.
  //   - cold-start 탭: isSignedIn false→true 전이에서 effect 재실행이 대기 intent 를 쿠키 확립 후 적용.
  const applyDeepLinkTarget = useCallback((): void => {
    if (!consumesDeepLink || !isSignedIn) {
      return; // home 탭 아님 또는 세션 미확립 — pending 유지(쿠키 확립 후 소비).
    }
    const target = consumeDeepLinkTarget();
    if (!target) {
      return; // 대기 intent 없음 — no-op(일반 흐름 무영향).
    }
    let targetOrigin: string;
    try {
      targetOrigin = new URL(target).origin;
    } catch {
      return; // malformed URL — 무시(이동 생략).
    }
    if (targetOrigin !== TRUSTED_ORIGIN) {
      return; // R-T9/C-2: 비신뢰 origin — 무시(WebView origin 잠금 보존, intent 위조 방어).
    }
    setSourceUri(target); // 기존 WebView URL 교체(리마운트 아님 — 쿠키/PKCE 컨텍스트 보존, OD-1).
  }, [consumesDeepLink, isSignedIn]);

  // 마운트/세션 전이 시 대기 intent 소비 + intent 저장 통지 구독(background 탭 즉시 소비). isSignedIn 변화 시
  // applyDeepLinkTarget 재생성 → effect 재실행이 cold-start 대기 intent 를 세션 확립 시점에 적용한다.
  useEffect(() => {
    if (!consumesDeepLink) {
      return;
    }
    applyDeepLinkTarget();
    return subscribeDeepLinkTarget(applyDeepLinkTarget);
  }, [consumesDeepLink, applyDeepLinkTarget]);

  // SPEC-MOBILE-NAV-001: 헤더는 (tabs) 컨텍스트 + 웹이 보고한 헤더 필요 5페이지에서만 그린다(topology-
  // agnostic — 웹 pathname 만 소비). (auth)/공개 라우트에서는 NativeHeaderBar 를 마운트하지 않는다(routeContext
  // gating 은 여기서 소유). headerVisible 은 WebViewShell edges 조정(이중 top 인셋 방지)에도 쓴다.
  // decideHeader 는 순수 함수라 여기(edges 조정)와 NativeHeaderBar(렌더) 두 곳에서 동일 navState 로 호출된다.
  const headerVisible =
    routeContext === "(tabs)" && navState !== null && decideHeader(navState).headerVisible;
  const webViewEdges = webViewEdgesFor(routeContext, headerVisible);

  return (
    <View style={styles.container}>
      {/* (tabs) 헤더 오버레이 — WebView 뷰포트 위(문서 흐름 밖). 헤더 필요 5페이지에서만 렌더되며 top
          status-bar 인셋을 소유한다(NativeHeaderBar 내부 SafeAreaView). back 탭 → nav:back 위임(injectNavBack).
          NativeHeaderBar 자체가 headerVisible/showBackChevron 을 decideHeader 로 판정하므로 여기서는
          (tabs) 여부만 gating 한다(headerVisible 미가시 시 컴포넌트가 null 렌더). */}
      {routeContext === "(tabs)" ? (
        <NativeHeaderBar navState={navState} onBackPress={handleWebBack} />
      ) : null}
      <WebViewShell
        ref={webViewRef}
        sourceUri={sourceUri}
        // safe-area 인셋: (tabs)=top(+좌우) / (auth)·invite=top+bottom(+좌우). 하단 탭바 이중 패딩 방지.
        // NAV-001: (tabs) + 헤더 가시 시 top 제거(헤더가 소유 — 이중 인셋 방지, webViewEdgesFor).
        edges={webViewEdges}
        // R-T9/C-2: WebView 를 신뢰 origin 에 잠근다(비신뢰 origin in-WebView 로드 차단).
        originWhitelist={ORIGIN_WHITELIST}
        // R-T8/OD-11: 컨텐츠 로드 전 per-session nonce 를 페이지에 확립(셸 마커는 WebViewShell 가 항상 선행 주입).
        injectedJavaScriptBeforeContentLoaded={buildNonceBootstrapJs(nonce)}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onNavigationStateChange={onNavigationStateChange}
        // R-T5/R-R3/R-N4: 웹→네이티브 메시지(session:synced/none/cleared) 수신.
        onMessage={onMessage}
        // R-T2/R-N5: 로드 완료 시 콜드스타트 토큰 1회 주입(페이드인은 WebViewShell 내부가 담당).
        onLoadEnd={() => {
          maybeInjectRestore();
        }}
        onError={() => {
          setHasError(true);
          hideSplash();
        }}
        onHttpError={() => {
          setHasError(true);
          hideSplash();
        }}
        // R-NF2(M2/T-005): iOS 콘텐츠 프로세스 종료 시 현재 라우트 reload 로 복구(빈 화면 방지).
        // device-gated 미검증(RN 0.85/RNWebView 13.16 — GitHub #2559). 발화 시 reload, 미발화 시 onError 폴백.
        onContentProcessDidTerminate={() => webViewRef.current?.reload()}
      />

      {/* R-U4: 복구 가능한 에러/오프라인 UI(재시도 제공) — 빈 화면/크래시 금지. 로딩 표시는 WebViewShell 소유. */}
      {hasError ? <WebViewErrorOverlay webUrl={WEB_URL} onRetry={handleRetry} /> : null}
    </View>
  );
}

/** (tabs) 탭 래퍼 공용 헬퍼 — 라우트의 호스팅 웹 URL 로 BridgedWebView 를 마운트한다(R-WB5/R-NC1). */
export function TabWebView({ route }: { route: AppRoute }): React.JSX.Element {
  return (
    <BridgedWebView
      sourceUri={urlForRoute(route, WEB_URL)}
      routeContext="(tabs)"
      // SPEC-MOBILE-NAV-001: 알림 탭 딥링크(모임/채팅)는 home 탭 하위 웹 라우트라 home 탭 WebView 가 소비한다.
      consumesDeepLink={route === "home"}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
});
