// Not-found 라우트 (SPEC-MOBILE-003) — 미매칭 경로 최소 폴백.
//
// 하이브리드 셸은 알려진 라우트(index/(auth)/(tabs))만 가지며, 미매칭 경로는 진입 분기(index)로
// 돌려보낸다 — index 가 인증 상태에 따라 올바른 랜딩으로 다시 Redirect 한다(빈 화면/크래시 금지).
import { Redirect } from "expo-router";

export default function NotFound(): React.JSX.Element {
  return <Redirect href="/" />;
}
