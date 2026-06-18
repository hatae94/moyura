// (tabs)/home 탭 목록 화면 (SPEC-MOBILE-003 R-WB5/R-NC1) — ${WEB_URL}/home 호스팅 얇은 WebView 래퍼.
//
// 이전 flat (tabs)/home.tsx 의 내용을 디렉터리화하며 그대로 이전했다(SPEC-MOIM-003 — 디렉터리화로 전환,
// 동작 보존). route-map-core 의 urlForRoute("home", WEB_URL) 로 source 를 조립한다(라우트 문자열
// 하드코딩 금지). 교차 라우트 디스패치(R-NC2)·detail push(MOIM-003 REQ-MOIM3-003)·Android 백 expo-router
// 위임(R-NC4)·셸 모드 탭바 숨김(R-WB3)·lazy 마운트((tabs)/_layout lazy:true)는 TabWebView/BridgedWebView 가 처리한다.
import { TabWebView } from "../../../components/BridgedWebView";

export default function HomeTab(): React.JSX.Element {
  return <TabWebView route="home" />;
}
