// (tabs)/home 스택 레이아웃 (SPEC-MOIM-003 REQ-MOIM3-003) — list → detail push + 네이티브 back 복귀.
//
// 홈 탭을 디렉터리화해 중첩 Stack 으로 만든다(이전 flat (tabs)/home.tsx 대체). index(목록)와 [id](상세)가
// 한 Stack 안에 있어, 카드 탭 시 detail 을 push 하고 네이티브 back 이 목록으로 복귀한다(expo-router Stack).
// headerShown:false 로 BridgedWebView 를 풀스크린 유지한다((tabs)/_layout 의 headerShown:false 와 일관 —
// 네이티브 크롬은 탭바뿐, 화면 콘텐츠는 웹이 소유한다 R-WB5).
//
// (tabs)/_layout.tsx 의 Tabs.Screen name="home" 은 이 디렉터리 기반으로 그대로 동작한다(탭바 보존 R-WB5).
import { Stack } from "expo-router";

export default function HomeStackLayout(): React.JSX.Element {
  // animation:"none" — list→detail 전환 슬라이드 제거(루트 Stack 과 일관).
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
