// 재사용 가능한 풀스크린 WebView 래퍼 (SPEC-WEBVIEW-SHELL-001 R-S1, AC-S1) — App.tsx 에서 추출.
//
// source URL prop + 이벤트 핸들러 prop(loading/error/navigation/shouldStartLoad)을 받아 WebView 를
// 렌더한다. react-native-webview 설정(sharedCookiesEnabled/thirdPartyCookiesEnabled/style)을
// 캡슐화하며, 임의의 웹 라우트를 호스팅할 수 있을 만큼 generic 하다(forward-compat 가드레일 4).
//
// 오버레이(로딩/에러)는 이 컴포넌트가 합성하지 않는다 — App.tsx 가 형제로 합성한다. 이 컴포넌트는
// WebView 호스팅만 담당한다(단일 책임 + generic 유지).
//
// [CRITICAL — OD-1] WebView 에 key 를 부여하지 않는다. 리마운트하면 쿠키/PKCE 컨텍스트가
// 초기화돼 OAuth 흐름이 깨진다. ref/sourceUri 소유는 호출부(App.tsx)에 두고, OAuth 복귀 시
// sourceUri 교체(setSourceUri)만으로 네비게이트한다(리마운트 아님).
import { forwardRef } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import WebView from "react-native-webview";
import type {
  ShouldStartLoadRequest,
  WebViewMessageEvent,
  WebViewNavigation,
} from "react-native-webview/lib/WebViewTypes";

export interface WebViewShellProps {
  /** WebView 가 로드할 source URL. 변경 시 WebView 가 새 URL 로 네비게이트한다(리마운트 아님). */
  sourceUri: string;
  /**
   * R-T9/C-2: WebView 를 신뢰 origin 에 잠그는 originWhitelist(예: ["http://localhost:3000"]).
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
  /** WebView 컨테이너 스타일(기본: flex 1 풀스크린). */
  style?: StyleProp<ViewStyle>;
}

/**
 * 풀스크린 WebView 호스트(R-S2). source URL + 이벤트 핸들러를 prop 으로 받아 generic 하게
 * 임의 웹 라우트를 호스팅한다. ref 를 전달해 호출부가 goBack/reload 등을 호출할 수 있다.
 *
 * R-O5: OAuth 왕복/앱 재시작을 가로질러 @supabase/ssr 세션 쿠키를 보존한다
 *   (sharedCookiesEnabled[iOS] / thirdPartyCookiesEnabled[Android]).
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
    style,
  },
  ref,
) {
  return (
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
      injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
      // R-O5: OAuth 왕복/앱 재시작을 가로질러 @supabase/ssr 세션 쿠키를 보존한다.
      sharedCookiesEnabled // iOS
      thirdPartyCookiesEnabled // Android
      // R-O1/R-T9: authorize 인터셉트 + WebView origin 잠금(비신뢰 in-WebView 로드 거부).
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
      // R-U1: 히스토리 추적.
      onNavigationStateChange={onNavigationStateChange}
      // R-T5/R-R3/R-N4: 웹→네이티브 브리지 메시지 수신(SPEC-MOBILE-002).
      onMessage={onMessage}
      // R-U3: 로딩 인디케이터.
      onLoadStart={onLoadStart}
      onLoadEnd={onLoadEnd}
      // R-U4: 로드 실패 → 복구 가능한 에러 상태.
      onError={onError}
      onHttpError={onHttpError}
    />
  );
});

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
});
