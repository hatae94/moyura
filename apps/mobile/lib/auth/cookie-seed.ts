// 로그인 WebView 세션 쿠키 공유 store 선주입 (SPEC-MOBILE-004 후속 — Google 네이티브 로그인 main→login 바운스 수정).
//
// 배경: 네이티브 Google 로그인은 로그인 WebView 안에서 web setSession() 으로 세션을 확립한다. setSession 은
// document.cookie 로 세션 쿠키를 WKWebView 자체 store(useWebKit=true)에만 쓴다. 그런데 로그인 성공 →
// isSignedIn=true → expo-router 가 (tabs)/home 을 *새 WebView* 로 마운트하고, 그 WebView 는
// sharedCookiesEnabled 로 NSHTTPCookieStorage(useWebKit=false)에서 쿠키를 읽는다. 두 store 가 분리돼 있고
// WKWebView 의 document.cookie write 는 NSHTTPCookieStorage 로 자동 동기화되지 않으므로, 새 홈 WebView 의
// 첫 GET 에 세션 쿠키가 없어 서버 가드(require-named-session)가 /login 으로 302 → 메인 진입 직후 바운스.
// (이메일 로그인은 서버 Set-Cookie 라 NSHTTPCookieStorage 에 바로 들어가 바운스 없음 — 대조로 확인됨.)
//
// 조치: session:synced 수신 시(홈 리다이렉트 직전) WKWebView store 의 세션 쿠키(sb-*)를 읽어
// NSHTTPCookieStorage 로 복사한다. 그러면 새 홈 WebView 의 첫 GET 이 쿠키를 싣는다. cookie-clear.ts 의
// 역방향 미러이며, @supabase/ssr 쿠키 포맷(이름/base64url/청킹)을 *복제하지 않고* 웹이 만든 실제 쿠키를
// 그대로 복사하므로 ssr 업그레이드에도 깨지지 않는다.
//
// 이 모듈은 @react-native-cookies/cookies(네이티브 모듈)를 import 하므로 vitest node 환경에서 단위
// 테스트하지 않는다(mobile-pure-core-test-seam — cookie-clear.ts / token-store.ts 와 동일 seam).
//
// 보안: 쿠키 값을 절대 로깅하지 않는다(R-T6/R-V2). 실패는 throw 가 아니라 no-op 으로 흡수한다 —
// 선주입 실패가 로그인 신호(session:synced)를 막지 않게 한다(부분 성공 > 차단).
import CookieManager, { type Cookie } from "@react-native-cookies/cookies";

import { WEB_URL } from "../web-url";

/** @supabase/ssr 세션 쿠키 이름 접두사(sb-<ref>-auth-token[.N]). 이 접두사만 복사한다. */
const SUPABASE_COOKIE_PREFIX = "sb-";

/**
 * 로그인 WebView 의 setSession 이 WKWebView store 에 쓴 세션 쿠키를 공유 NSHTTPCookieStorage 로 복사한다.
 *
 * iOS: get(WEB_URL, true) = WKWebView store(setSession 의 document.cookie write 가 들어간 곳),
 *      set(WEB_URL, cookie, false) = NSHTTPCookieStorage(sharedCookiesEnabled WebView 가 첫 GET 에 읽는 곳).
 * sb-* 세션 쿠키만 복사한다(다른 쿠키는 불필요). 원본 속성(path/domain/expires/secure/httpOnly)을 보존한다.
 *
 * 실패(네이티브 모듈 미가용/스토어 접근 등)는 no-op 으로 흡수한다 — 선주입 실패가 로그인을 막지 않는다
 * (쿠키가 제때 안 실리면 기존 동작대로 가드가 /login 라우팅할 뿐, 크래시/행 없음).
 *
 * Android: @react-native-cookies/cookies 는 단일 CookieManager store 라 useWebKit 이 무의미하고,
 * thirdPartyCookiesEnabled 경로가 이미 동작한다(검증 범위 밖 — best-effort no-op 안전).
 */
export async function seedSharedCookiesFromWebKit(): Promise<void> {
  try {
    // WKWebView store(useWebKit=true) — 로그인 WebView setSession 이 document.cookie 로 쓴 곳.
    const webKitCookies = await CookieManager.get(WEB_URL, true);
    const sessionCookies = Object.values(webKitCookies).filter((c) =>
      c.name.startsWith(SUPABASE_COOKIE_PREFIX),
    );
    if (sessionCookies.length === 0) {
      // WKWebView store 에 세션 쿠키 없음 — 복사 대상 없음(예: 이메일 로그인은 이미 NSHTTP 에 존재).
      return;
    }
    // NSHTTPCookieStorage(useWebKit=false) 로 복사 — sharedCookiesEnabled WebView 의 다음 GET 이 읽는다.
    await Promise.all(
      sessionCookies.map((c) => CookieManager.set(WEB_URL, toSharedCookie(c), false)),
    );
  } catch {
    // 선주입 실패 — 쿠키 값 비노출, no-op. 가드가 기존대로 라우팅(부분 성공 > 차단).
  }
}

/** WKWebView 에서 읽은 쿠키를 NSHTTPCookieStorage set 용으로 변환한다(원본 속성 보존, path 기본 "/"). */
function toSharedCookie(cookie: Cookie): Cookie {
  return {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path ?? "/",
    ...(cookie.domain ? { domain: cookie.domain } : null),
    ...(cookie.expires ? { expires: cookie.expires } : null),
    ...(cookie.secure !== undefined ? { secure: cookie.secure } : null),
    ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : null),
  };
}
