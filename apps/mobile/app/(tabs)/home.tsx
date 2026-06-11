// (tabs)/home 탭 (SPEC-MOBILE-003 R-WB5/R-NC1) — ${WEB_URL}/home 호스팅 얇은 WebView 래퍼.
//
// route-map-core 의 urlForRoute("home", WEB_URL) 로 source 를 조립한다(라우트 문자열 하드코딩 금지).
// 교차 라우트 디스패치(R-NC2)·Android 백 expo-router 위임(R-NC4)·셸 모드 탭바 숨김(R-WB3, 셸 마커는
// WebViewShell 가 항상 선행 주입)·lazy 마운트((tabs)/_layout lazy:true)는 TabWebView/BridgedWebView 가 처리한다.
import { TabWebView } from "../../components/BridgedWebView";

export default function HomeTab(): React.JSX.Element {
  return <TabWebView route="home" />;
}
