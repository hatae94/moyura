// 재사용 가능한 풀스크린 WebView 래퍼 (SPEC-WEBVIEW-SHELL-001 R-S1, AC-S1) — App.tsx 에서 추출.
//
// source URL prop + 이벤트 핸들러 prop(loading/error/navigation/shouldStartLoad)을 받아 WebView 를
// 렌더한다. react-native-webview 설정(sharedCookiesEnabled/thirdPartyCookiesEnabled/style)을
// 캡슐화하며, 임의의 웹 라우트를 호스팅할 수 있을 만큼 generic 하다(forward-compat 가드레일 4).
//
// safe-area: WebView 를 react-native-safe-area-context 의 네이티브 `SafeAreaView` 로 감싸 노치/상태바/
// 홈 인디케이터 인셋을 적용한다(RN 코어 SafeAreaView 는 deprecated — 라이브러리 네이티브 컴포넌트 사용,
// new arch 지원 + JS 레이아웃 flicker 없음). 적용 엣지는 호출부(BridgedWebView)가 라우트 컨텍스트로
// 결정한다 — (tabs) 는 하단 네이티브 탭바가 bottom inset 을 소유하므로 top(+좌우)만, (auth)/공개 라우트는
// 탭바가 없어 top+bottom(+좌우) 전부(이중 패딩 방지).
//
// 오버레이(로딩/에러)는 이 컴포넌트가 합성하지 않는다 — App.tsx 가 형제로 합성한다. 이 컴포넌트는
// WebView 호스팅만 담당한다(단일 책임 + generic 유지).
//
// [CRITICAL — OD-1] WebView 에 key 를 부여하지 않는다. 리마운트하면 쿠키/PKCE 컨텍스트가
// 초기화돼 OAuth 흐름이 깨진다. ref/sourceUri 소유는 호출부(App.tsx)에 두고, OAuth 복귀 시
// sourceUri 교체(setSourceUri)만으로 네비게이트한다(리마운트 아님). SafeAreaView 래핑은 무조건적
// (조건부 아님)이라 WebView 인스턴스를 보존한다 — 래퍼 추가가 자식을 리마운트하지 않는다.
import { forwardRef, useCallback, useRef } from "react";
import { Animated, Platform, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import WebView from "react-native-webview";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";

import { LoadingOverlay } from "./LoadingOverlay";
import {
  COVER_OPACITY_LOADING,
  COVER_FADE_DURATION_MS,
  coverOpacityOnLoadStart,
  coverOpacityOnLoadEnd,
} from "../lib/ui/webview-fade-core";

export interface WebViewShellProps {
  /** WebView 가 로드할 source URL. 변경 시 WebView 가 새 URL 로 네비게이트한다(리마운트 아님). */
  sourceUri: string;
  /**
   * R-T9/C-2: WebView 를 신뢰 origin 에 잠그는 originWhitelist(예: ["http://192.168.219.102:3000"]).
   * 기본값 ["http://*","https://*"] 대신 신뢰 origin 만 허용해 비신뢰 origin in-WebView 로드를 막는다.
   * onShouldStartLoadWithRequest 의 deny 게이트와 이중 방어한다.
   */
  originWhitelist?: readonly string[];
  /**
   * R-T8/OD-11: 컨텐츠 로드 전 1회 실행되는 JS(신뢰 origin 채널). per-session nonce 를 페이지에 확립한다
   * (App.tsx 가 nonce 를 setter 로 정의해 주입). injectedJavaScript 와 달리 페이지 스크립트보다 먼저 돈다.
   */
  injectedJavaScriptBeforeContentLoaded?: string;
  /** R-O1: provider authorize 네비게이션 인터셉트 → 시스템 브라우저 브리지(useAuthBridge 제공). */
  onShouldStartLoadWithRequest?: (request: ShouldStartLoadRequest) => boolean;
  /** R-U1: 네비게이션 히스토리 추적(useAppLifecycle 제공). */
  onNavigationStateChange?: (nav: WebViewNavigation) => void;
  /** R-T5/R-R3/R-N4: 웹→네이티브 브리지 메시지 수신(useAuthBridge 제공 — SPEC-MOBILE-002). */
  onMessage?: (event: WebViewMessageEvent) => void;
  /** R-U3: 로드 시작(로딩 인디케이터 표시). */
  onLoadStart?: () => void;
  /** R-U3: 로드 종료(로딩 인디케이터 숨김). */
  onLoadEnd?: () => void;
  /** R-U4: 로드 실패(네트워크/도달 불가) → 복구 가능한 에러 상태. */
  onError?: () => void;
  /** R-U4: HTTP 에러 → 복구 가능한 에러 상태. */
  onHttpError?: () => void;
  /**
   * R-NF2(M2/T-005): iOS WebView 콘텐츠 프로세스가 종료되면(메모리 압박 등) 빈 화면을 막기 위해
   * 호출부가 현재 라우트를 reload 하도록 위임받는 콜백. long-lived WebView 의 iOS 안전장치다.
   * (실 발화 여부는 device-gated — 아래 onContentProcessDidTerminate 주석 참조.)
   */
  onContentProcessDidTerminate?: () => void;
  /** WebView 컨테이너 스타일(기본: flex 1 풀스크린). */
  style?: StyleProp<ViewStyle>;
  /**
   * 적용할 safe-area 엣지(react-native-safe-area-context). 호출부(BridgedWebView)가 라우트 컨텍스트에
   * 따라 지정한다: (tabs) 는 하단 네이티브 탭바가 bottom inset 을 소유하므로 top(+좌우)만, (auth)/공개
   * 라우트(invite)는 탭바가 없어 top+bottom(+좌우) 전부. 미지정 시 SafeAreaView 기본값(전 엣지).
   */
  edges?: readonly Edge[];
}

/**
 * 풀스크린 WebView 호스트(R-S2). source URL + 이벤트 핸들러를 prop 으로 받아 generic 하게
 * 임의 웹 라우트를 호스팅한다. ref 를 전달해 호출부가 goBack/reload 등을 호출할 수 있다.
 *
 * R-O5: OAuth 왕복/앱 재시작을 가로질러 @supabase/ssr 세션 쿠키를 보존한다
 *   (sharedCookiesEnabled[iOS] / thirdPartyCookiesEnabled[Android]).
 *
 * safe-area: SafeAreaView(네이티브) 가 edges 만큼 인셋을 적용한다. WebView 는 인셋 영역 안에서 flex 채운다.
 */
export const WebViewShell = forwardRef<WebView, WebViewShellProps>(function WebViewShell(
  {
    sourceUri,
    originWhitelist,
    injectedJavaScriptBeforeContentLoaded,
    onShouldStartLoadWithRequest,
    onNavigationStateChange,
    onMessage,
    onLoadStart,
    onLoadEnd,
    onError,
    onHttpError,
    onContentProcessDidTerminate,
    style,
    edges,
  },
  ref,
) {
  // SPEC-MOBILE-003 R-WB3/R-WB4: 셸 모드 마커를 *콘텐츠 로드 전* 항상 주입한다(컴포넌트 레벨 보장).
  // 웹 (main)/layout 의 인라인 스크립트가 이 전역으로 하단 탭바를 flash 없이 숨긴다(이중 탭바 금지).
  // 호출부가 nonce 등 다른 pre-content JS 를 넘기면 마커를 앞에 붙여 둘 다 실행되게 한다(기존 행위 보존).
  const beforeContentJs = `window.__MOYURA_NATIVE_SHELL__=true;${
    injectedJavaScriptBeforeContentLoaded ?? ""
  }`;

  // R-NF2(M2/T-003): 로드 완료 시 흰 깜빡임을 제거하는 페이드인.
  //
  // [회귀 수정 — main→login 바운스] 이전 구현은 WebView 자체를 opacity 0→1 로 페이드했는데, iOS WKWebView 는
  // 자신의 레이어가 완전 투명(opacity 0)이면 비가시(occluded)로 판정해 페이지 JS/핸드셰이크를 서스펜드한다
  // (document.visibilityState='hidden'). 그 결과 (tabs)/home 의 *새* WebView 가 opacity 0 으로 마운트되는 동안
  // session:restore 핸드셰이크가 비가시 상태로 구동돼 결정적으로 session:none 으로 귀결 → isSignedIn=false
  // → 메인 진입 직후 로그인 바운스. 그래서 *WebView 는 항상 opacity 1(가시/활성)로 두고*, 그 위에 덮인
  // 불투명 커버(스켈레톤 배경)를 1→0 으로 페이드아웃해 동일한 페이드인을 구현한다(WebView 비서스펜드 — 불변식은
  // webview-fade-core.ts 가 강제). 무조건적 Animated.View 커버라 WebView 를 리마운트하지 않는다(OD-1 보존).
  const coverOpacity = useRef(new Animated.Value(COVER_OPACITY_LOADING)).current;

  // 재로드(handleRetry) 시에도 다시 페이드인하도록 로드 시작에 커버를 불투명(1)으로 리셋한 뒤
  // 호출부 onLoadStart 를 그대로 호출한다(기존 콜백 행위 보존). WebView opacity 는 건드리지 않는다(항상 1).
  const handleLoadStart = useCallback((): void => {
    coverOpacity.setValue(coverOpacityOnLoadStart());
    onLoadStart?.();
  }, [coverOpacity, onLoadStart]);

  // 로드 종료 시 커버를 0 으로 페이드아웃해 아래 WebView 콘텐츠를 드러낸 뒤 호출부 onLoadEnd(maybeInjectRestore 등)를
  // 그대로 호출한다. opacity 는 네이티브 드라이버 지원(레이아웃 영향 없음) → useNativeDriver:true.
  const handleLoadEnd = useCallback((): void => {
    Animated.timing(coverOpacity, {
      toValue: coverOpacityOnLoadEnd(),
      duration: COVER_FADE_DURATION_MS,
      useNativeDriver: true,
    }).start();
    onLoadEnd?.();
  }, [coverOpacity, onLoadEnd]);

  return (
    // safe-area 인셋 적용 래퍼(네이티브 SafeAreaView). edges 미지정 시 전 엣지가 기본값이다.
    // [OD-1] 무조건적 래퍼라 WebView 를 리마운트하지 않는다(쿠키/PKCE 컨텍스트 보존).
    <SafeAreaView style={styles.safeArea} edges={edges}>
      {/* [회귀 수정] WebView 는 래퍼 없이 항상 opacity 1(가시/활성)로 렌더한다 — opacity 0 래퍼는 WKWebView 를
          서스펜드해 홈 진입 핸드셰이크가 session:none → 로그인 바운스를 유발했다(webview-fade-core.ts 참조). */}
      <WebView
        ref={ref}
        // R-S2: 풀스크린 웹 호스트. sourceUri 변경 시 WebView 가 새 URL 로 네비게이트한다(R-O3 콜백 교체).
        // key 는 일부러 두지 않는다 — 리마운트하면 WebView 쿠키/PKCE 컨텍스트가 초기화돼 OAuth 흐름이 깨진다(OD-1/OD-5).
        source={{ uri: sourceUri }}
        style={style ?? styles.webview}
        // R-T9/C-2: WebView 를 신뢰 origin 에 잠근다(미지정 시 RN 기본 ["http://*","https://*"] — 위험).
        originWhitelist={originWhitelist ? [...originWhitelist] : undefined}
        // Android: 신뢰 origin 잠금을 우회하는 새 창(window.open) 차단(C-2 보강).
        setSupportMultipleWindows={false}
        // R-T8/OD-11: 컨텐츠 로드 전 per-session nonce 를 신뢰 origin 채널로 확립한다.
        // SPEC-MOBILE-003 R-WB3/R-WB4: 셸 모드 마커(__MOYURA_NATIVE_SHELL__)를 항상 선행 주입한다.
        injectedJavaScriptBeforeContentLoaded={beforeContentJs}
        // R-O5: OAuth 왕복/앱 재시작을 가로질러 @supabase/ssr 세션 쿠키를 보존한다.
        sharedCookiesEnabled // iOS
        thirdPartyCookiesEnabled // Android
        // ── R-NF1(M1): 호스트 perf 프롭(보안/쿠키/브리지 프롭과 무충돌 — additive only). ──
        // Android: GPU 합성으로 스크롤 jank 해소(하드웨어 레이어).
        androidLayerType="hardware"
        // iOS 전용: 네이티브 감속 곡선 일치(웹 기본 fast 대신 normal — 네이티브 스크롤 체감).
        // [Android 크래시 회귀] decelerationRate 는 iOS 전용 prop 이지만 New Architecture 에서 Android
        // RNCWebView 가 이를 Double 로 코드젠한다(RNCWebViewNativeComponent.ts). iOS 는 "normal" 문자열을
        // 숫자로 변환해 넘기지만 Android 엔 변환 로직이 없어, 문자열을 그대로 넘기면 Fabric preallocateView
        // 단계에서 String→Double ClassCastException 으로 크래시한다. Android 엔 undefined 로 미전달한다.
        decelerationRate={Platform.OS === "ios" ? "normal" : undefined}
        // Android: 글로우/바운스 오버스크롤 제거(앱 같은 정적 느낌).
        overScrollMode="never"
        // 웹 캐시(localStorage/sessionStorage) 보장 — 웹 SPA 캐시 전략 동작 전제.
        domStorageEnabled={true}
        // Android 캐시 정책: LOAD_DEFAULT(표준 캐시 우선 + 최신성 유지). 인증/세션 화면이 많아
        // LOAD_CACHE_ELSE_NETWORK(stale 위험)는 피한다(데이터 최신성 — strategy OD-1).
        cacheMode="LOAD_DEFAULT"
        // R-NF2(M2/T-002): startInLoadingState 가 있어야 renderLoading 이 동작한다(둘 다 설정).
        // 로드 중 흰 화면 대신 브랜드색 스켈레톤을 RNWebView 가 자동 표시/숨김한다.
        // [double-overlay 해소] 로딩 표시 책임을 여기로 일원화 — 호출부(BridgedWebView)의 형제
        // LoadingOverlay 와 isLoading state 를 제거했다(중복 0). hasError 분기만 호출부에 남는다.
        startInLoadingState={true}
        renderLoading={() => <LoadingOverlay />}
        // R-O1/R-T9: authorize 인터셉트 + WebView origin 잠금(비신뢰 in-WebView 로드 거부).
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        // R-U1: 히스토리 추적.
        onNavigationStateChange={onNavigationStateChange}
        // R-T5/R-R3/R-N4: 웹→네이티브 브리지 메시지 수신(SPEC-MOBILE-002).
        onMessage={onMessage}
        // R-U3 + R-NF2(T-003): 로드 시작 시 커버 리셋(불투명), 종료 시 커버 페이드아웃 후 호출부 콜백 위임.
        onLoadStart={handleLoadStart}
        onLoadEnd={handleLoadEnd}
        // R-U4: 로드 실패 → 복구 가능한 에러 상태.
        onError={onError}
        onHttpError={onHttpError}
        // R-NF2(M2/T-005): iOS 콘텐츠 프로세스 종료 시 빈 화면 대신 현재 라우트를 reload 한다(호출부 위임).
        // [device-gated 미검증] RN 0.85 / RNWebView 13.16 조합에서 이 콜백의 실제 발화 여부는
        // 검증되지 않았다(GitHub react-native-webview#2559 회귀 보고). 미발화 시 onError 가 폴백 경로다.
        onContentProcessDidTerminate={onContentProcessDidTerminate}
      />
      {/* R-NF2(M2/T-003): WebView 위에 덮인 불투명 커버. 로드 시작에는 1(콘텐츠 가림 — 흰 깜빡임 제거),
          로드 완료 시 0 으로 페이드아웃해 콘텐츠를 드러낸다(콘텐츠 페이드인과 시각적 동일). pointerEvents="none"
          이라 터치를 가로채지 않고, opacity 0 도달 후에도 WebView 가 항상 위에 보인다(커버는 시각만 담당).
          핵심: 커버를 숨길 뿐 WebView 는 절대 숨기지 않으므로 WKWebView 가 서스펜드되지 않는다(바운스 회귀 차단). */}
      <Animated.View
        style={[styles.fadeCover, { opacity: coverOpacity }]}
        pointerEvents="none"
      >
        <LoadingOverlay />
      </Animated.View>
    </SafeAreaView>
  );
});

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    // 인셋(상태바/홈인디케이터) 영역 배경 — 웹 페이지 라이트 배경과 일치(BridgedWebView 컨테이너 #fff 와 동일).
    backgroundColor: "#fff",
  },
  // 페이드 커버 — WebView 위에 덮이는 절대 위치 풀블리드. 로드 완료 시 opacity 1→0 으로 페이드아웃해
  // 콘텐츠를 드러낸다(내부 LoadingOverlay 가 브랜드색 스켈레톤 배경 제공). WebView 자체는 항상 가시(opacity 1)다.
  fadeCover: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  webview: {
    flex: 1,
  },
});
