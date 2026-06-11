// (tabs)/profile 탭 (SPEC-MOBILE-003 R-WB5/R-NC1) — ${WEB_URL}/profile 호스팅 얇은 WebView 래퍼.
import { TabWebView } from "../../components/BridgedWebView";

export default function ProfileTab(): React.JSX.Element {
  return <TabWebView route="profile" />;
}
