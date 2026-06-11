// (tabs)/notifications 탭 (SPEC-MOBILE-003 R-WB5/R-NC1) — ${WEB_URL}/notifications 호스팅 WebView 래퍼.
// 네이티브 탭 배지(mock)는 (tabs)/_layout 의 tabBarBadge 가 표시한다.
import { TabWebView } from "../../components/BridgedWebView";

export default function NotificationsTab(): React.JSX.Element {
  return <TabWebView route="notifications" />;
}
