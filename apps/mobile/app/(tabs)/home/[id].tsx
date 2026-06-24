// (tabs)/home/[id] 모임 상세 네이티브 라우트 (SPEC-MOIM-003 REQ-MOIM3-003) — ${WEB_URL}/home/{id} 호스팅.
//
// 홈 카드 탭 시 useAuthBridge 의 detail-push 분기가 router.push((tabs)/home/[id]) 로 이 화면을 띄운다.
// 이 화면은 expo-router 의 id 파라미터로 ${WEB_URL}/home/{id} 를 조립해(urlForDetailRoute — list 와 동일한
// URL 결합 규칙) BridgedWebView 로 호스팅한다(R-NC1 네이티브↔웹 1:1 매핑). routeContext="(tabs)" 라
// Android 백을 expo-router 에 위임하고(R-NC4), _layout 의 Stack 이 네이티브 back 으로 list 복귀를 보장한다.
//
// 상세 WebView 내 "채팅 입장"(/moims/{id}/chat) 은 앱 라우트 prefix 가 아니므로 detail-push/cross-route
// 분류 대상이 아니다 → trusted-load 로 WebView 내에서 그대로 로드된다(SPEC-MOIM-003 acceptance 엣지).
import { useLocalSearchParams } from "expo-router";

import { WEB_URL } from "../../../lib/web-url";
import { urlForDetailRoute } from "../../../lib/route-map-core";
import { buildChatUrl } from "../../../lib/push/notification-core";
import { BridgedWebView } from "../../../components/BridgedWebView";

export default function HomeDetail(): React.JSX.Element {
  // expo-router 동적 세그먼트 [id] — 배열일 수 있어 단일 문자열로 정규화한다(방어적).
  const params = useLocalSearchParams<{ id: string | string[]; target?: string | string[] }>();
  const id = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  // SPEC-CHAT-002 R-PUSH-007: 알림 탭으로 진입한 경우(`?target=chat`) 모임 상세 대신 채팅(/moims/{id}/chat)
  // WebView 를 직접 로드한다. 그 외에는 기존대로 모임 상세(${WEB_URL}/home/{id})를 호스팅한다.
  const target = Array.isArray(params.target) ? params.target[0] : params.target;
  const sourceUri =
    target === "chat"
      ? (buildChatUrl(id, WEB_URL) ?? urlForDetailRoute("home", id, WEB_URL))
      : urlForDetailRoute("home", id, WEB_URL);
  return <BridgedWebView sourceUri={sourceUri} routeContext="(tabs)" />;
}
