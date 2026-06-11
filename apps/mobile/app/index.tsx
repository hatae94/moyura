// 진입 분기 (SPEC-MOBILE-003 R-AS3) — 인증 상태에 따라 랜딩 라우트로 Redirect.
//
// 콜드스타트 토큰 로드가 끝나기 전(isLoading)에는 아무 것도 렌더하지 않는다 — 스플래시가 화면을
// 덮은 상태로 대기해 미인증→로그인→홈 깜빡임을 막는다(R-N3 흐름 일치). 로드 후 AuthContext.isSignedIn
// (= deriveAuthState 결과)에 따라 (tabs)/home 또는 (auth)/login 으로 선언적 전환한다.
import { Redirect } from "expo-router";

import { useAuth } from "../lib/auth/AuthContext";
import { ROUTE_SIGNED_IN, ROUTE_SIGNED_OUT } from "../lib/auth/auth-state-core";

export default function Index(): React.JSX.Element | null {
  const { isSignedIn, isLoading } = useAuth();
  if (isLoading) {
    // 콜드스타트 토큰 로드 대기 — 스플래시가 덮고 있으므로 렌더 없음(깜빡임 방지).
    return null;
  }
  // R-AS3: isSignedIn=true → (tabs)/home, false → (auth)/login. 웹 세션 페이지 미참조(R-AS5).
  return <Redirect href={`/${isSignedIn ? ROUTE_SIGNED_IN : ROUTE_SIGNED_OUT}` as never} />;
}
