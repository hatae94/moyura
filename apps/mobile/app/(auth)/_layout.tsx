// (auth) 그룹 레이아웃 (SPEC-MOBILE-003 R-AS3/R-NC5) — 로그인 후 전환 가드.
//
// 선언적 가드(imperative router.replace 중복 회피): isSignedIn=true 면 인증 화면에 머물 이유가
// 없으므로 (tabs)/home 으로 <Redirect> 한다. 로그인 완료(session:synced) → AuthContext isSignedIn=true
// → 이 레이아웃이 재평가되어 home 으로 전환된다(R-NC5 — router.replace 메커니즘을 선언적 가드로 대체).
import { Redirect, Stack } from "expo-router";

import { useAuth } from "../../lib/auth/AuthContext";
import { ROUTE_SIGNED_IN } from "../../lib/auth/auth-state-core";

export default function AuthLayout(): React.JSX.Element {
  const { isSignedIn } = useAuth();
  // R-AS3/R-NC5: 로그인 상태면 인증 그룹 진입 금지 → (tabs)/home 으로 선언적 전환.
  if (isSignedIn) {
    return <Redirect href={`/${ROUTE_SIGNED_IN}` as never} />;
  }
  // animation:"none" — 페이지 전환 슬라이드 제거(루트 Stack 과 일관).
  return <Stack screenOptions={{ headerShown: false, animation: "none" }} />;
}
