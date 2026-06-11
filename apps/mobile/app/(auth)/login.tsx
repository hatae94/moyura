// (auth)/login 화면 (SPEC-MOBILE-003 R-PR2/R-AS3) — in-WebView 로그인 흐름 보존.
//
// 기존 App.tsx 의 인증 WebView 흐름을 그대로 보존한다(R-PR2): 이메일/비번 로그인은 WebView 안에서
// (네이티브 인터셉트 없음), Google 소셜은 시스템 브라우저 OAuth 브리지로 동작한다. nonce 주입,
// session:restore 복원/재검증, 로딩/에러 오버레이도 BridgedWebView 가 행위 보존한다.
//
// routeContext="(auth)": Android 하드웨어 백은 WebView 히스토리 back 을 유지한다(R-NC4 — (tabs) 와 달리
// expo-router 위임이 아니다). 로그인 완료 시 onAuthSignal(session:synced) → AuthContext isSignedIn=true
// → (auth)/_layout 의 선언적 <Redirect> 가 (tabs)/home 으로 전환한다(R-NC5, 이 화면은 전환을 모른다).
import { WEB_URL } from "../../lib/web-url";
import { BridgedWebView } from "../../components/BridgedWebView";

// 인증 surface 의 웹 진입 경로. 웹 가드(getSession empty → /login)와 일치한다 — 셸은 ${WEB_URL}/login 을
// 로드하고, 미인증이면 웹이 로그인 폼을, 콜드스타트 토큰 복원에 성공하면 synced 회신으로 home 전환된다.
const LOGIN_URL = new URL("/login", WEB_URL).toString();

export default function Login(): React.JSX.Element {
  return <BridgedWebView sourceUri={LOGIN_URL} routeContext="(auth)" />;
}
