// (tabs)/explore 탭 (SPEC-MOBILE-003 R-WB5/R-NC1) — ${WEB_URL}/explore 호스팅 얇은 WebView 래퍼.
import { TabWebView } from "../../components/BridgedWebView";

export default function ExploreTab(): React.JSX.Element {
  return <TabWebView route="explore" />;
}
