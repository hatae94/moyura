// invite/[token] 초대 수락 딥링크 라우트 (SPEC-MOIM-011 REQ-MOIM11-004) — ${WEB_URL}/invite/{token} 호스팅.
//
// 커스텀 스킴 moyura://invite/{token} 클릭 시 expo-router 가 이 파일 라우트로 매핑한다(app.json scheme:"moyura").
// (tabs)/home/[id].tsx 의 detail-in-WebView 패턴을 미러하되, 초대는 공개 랜딩이라 (tabs)/(auth) 그룹 밖
// 최상위 app/invite/ 에 둔다(인증 가드 미상속 — 미인증/익명 게스트 진입 허용). 수락/익명 로그인은 WebView 안
// 웹 수락 페이지가 수행한다(REQ-INV-007). routeContext="(auth)" 로 in-WebView 흐름·WebView back 을 보존한다.
import { useLocalSearchParams } from "expo-router";

import { WEB_URL } from "../../lib/web-url";
import { BridgedWebView } from "../../components/BridgedWebView";

export default function InviteAccept(): React.JSX.Element {
  // expo-router 동적 세그먼트 [token] — 배열일 수 있어 단일 문자열로 정규화한다(방어적).
  const params = useLocalSearchParams<{ token: string | string[] }>();
  const token = Array.isArray(params.token)
    ? (params.token[0] ?? "")
    : (params.token ?? "");
  // WEB_URL 끝 슬래시를 제거해 중복 슬래시 없이 수락 페이지 URL 을 조립한다.
  const base = WEB_URL.replace(/\/+$/, "");
  const sourceUri = `${base}/invite/${encodeURIComponent(token)}`;
  return <BridgedWebView sourceUri={sourceUri} routeContext="(auth)" />;
}
