// (tabs)/home 스택 레이아웃 (SPEC-MOBILE-NAV-001 단일 WebView 모델) — index(목록)가 유일한 스크린.
//
// SPEC-MOBILE-NAV-001 이 detail-push 라우트(이전 [id].tsx)를 폐기하면서, 이 Stack 은 이제 index(목록)만
// 호스팅한다. 홈 카드 탭은 Next <Link> soft-nav(history.pushState)로 같은 홈 탭 WebView 안에서 /home/{id}
// 로 이동하고, back 은 네이티브 헤더 오버레이(NavStateReporter/nav:state/nav:back)가 처리한다 — 별도
// 네이티브 detail 화면 push 없음(단일 WebView 유지 → 세션 쿠키/PKCE 컨텍스트 보존, OD-1).
// headerShown:false 로 BridgedWebView 를 풀스크린 유지한다((tabs)/_layout 의 headerShown:false 와 일관 —
// 네이티브 크롬은 탭바뿐, 화면 콘텐츠는 웹이 소유한다 R-WB5).
//
// (tabs)/_layout.tsx 의 Tabs.Screen name="home" 은 이 디렉터리 기반으로 그대로 동작한다(탭바 보존 R-WB5).
import { Stack } from "expo-router";

export default function HomeStackLayout(): React.JSX.Element {
  // animation:"none" — 스크린 전환 슬라이드 제거(루트 Stack 과 일관).
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
