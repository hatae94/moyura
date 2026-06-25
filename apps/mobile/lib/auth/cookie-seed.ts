// 로그인 WebView 세션 쿠키 공유 store 선주입 (SPEC-MOBILE-004 후속 — Google 네이티브 로그인 main→login 바운스 수정).
//
// 배경: 네이티브 Google 로그인은 로그인 WebView 안에서 web setSession() 으로 세션을 확립한다. setSession 은
// document.cookie 로 세션 쿠키를 WKWebView 자체 store(WKHTTPCookieStore = defaultDataStore)에만 쓴다. 그런데
// 로그인 성공 → isSignedIn=true → expo-router 가 (tabs)/home 을 *새 WebView* 로 마운트한다. 그 홈 WebView 가
// 첫 GET 에 쿠키를 싣지 못해 서버 가드(require-named-session)가 /login 으로 302 → 메인 진입 직후 바운스.
//
// [근원 — node_modules 소스 확인] 홈 WebView 는 첫 GET 의 쿠키를 *자신의 WKHTTPCookieStore*
// (`[WKWebsiteDataStore defaultDataStore].httpCookieStore`)에서 읽는다(RNCWebViewImpl.m:465 — _cacheEnabled
// 기본 YES → defaultDataStore). NSHTTPCookieStorage 는 첫 GET 에 직접 읽히지 않는다. NSHTTP→WK 의 유일한
// 다리는 RNW 의 visitSource 가 부르는 syncCookiesToWebView 1회 동기화뿐이다(RNCWebViewImpl.m:1826-1828 —
// NSHTTP 를 읽어 WK 로 복사). 즉 useWebKit=false 로 NSHTTP 에만 쓰면 (1) 그 한 번의 비동기 sync 홉에 의존하고
// (2) get→set 왕복에서 host-only 쿠키가 명시 Domain 쿠키로 변형되는 등 취약점이 생긴다 — 실측상 홈 WebView 가
// 끝내 쿠키를 싣지 못했다(useWebKit=false 가 *틀린 store* 였다는 직접 증거).
//
// 조치: session:synced 수신 시(홈 리다이렉트 직전) WKHTTPCookieStore 의 세션 쿠키(sb-*)를 읽어, 홈 WebView 가
// 실제로 읽는 바로 그 store(WKHTTPCookieStore = useWebKit=true)에 *명시적으로* 다시 써 커밋을 확정한다
// (RNCookieManagerIOS.m:60 — set(...,true) 가 defaultDataStore.httpCookieStore 에 쓰고 completionHandler 로 ack).
// NSHTTPCookieStorage(useWebKit=false)에도 함께 미러링한다 — RNW 가 NSHTTP 에서 재동기화하는 모든 경로/이메일
// 로그인(서버 Set-Cookie→NSHTTP)과 대칭을 맞추고 cookie-clear.ts 의 BOTH-store 삭제와 짝을 이루기 위함이다.
// @supabase/ssr 쿠키 포맷(이름/base64url/청킹)을 *복제하지 않고* 웹이 만든 실제 쿠키를 그대로 복사하므로
// ssr 업그레이드에도 깨지지 않는다.
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
 * 로그인 WebView 의 setSession 이 WKWebView store 에 쓴 세션 쿠키를, 새 홈 WebView 가 첫 GET 에 읽는 store 로
 * (명시) 다시 써 둔다.
 *
 * iOS: get(WEB_URL, true) = WKHTTPCookieStore(defaultDataStore — setSession 의 document.cookie write 가 들어간
 *      곳이자 새 홈 WebView 가 첫 GET 에 읽는 곳). 복사 대상은 *두 store* 다:
 *   - set(WEB_URL, cookie, true)  = WKHTTPCookieStore(defaultDataStore) — *결정적*. 홈 WebView 의 첫 GET 이
 *     직접 읽는 바로 그 store 에 명시 setCookie+completionHandler 로 커밋해, document.cookie→WK 전파 타이밍/
 *     NSHTTP 재동기화 홉에 의존하지 않는다(바운스 차단의 핵심).
 *   - set(WEB_URL, cookie, false) = NSHTTPCookieStorage — 대칭/방어. RNW 가 NSHTTP 에서 재동기화하는 경로와
 *     이메일 로그인(서버 Set-Cookie→NSHTTP) 경로에 맞추고 cookie-clear.ts 의 BOTH-store 삭제와 짝을 맞춘다.
 * sb-* 세션 쿠키만 복사한다(다른 쿠키는 불필요). 원본 속성(path/domain/expires/secure/httpOnly)을 보존한다 —
 * secure 는 그대로 보존하므로 dev(http localhost, secure=false)·prod(https, secure=true) 양쪽에서 WebView scheme
 * 과 일치해 첫 GET 에 정상 전송된다.
 *
 * 실패(네이티브 모듈 미가용/스토어 접근 등)는 no-op 으로 흡수한다 — 선주입 실패가 로그인을 막지 않는다
 * (쿠키가 제때 안 실리면 기존 동작대로 가드가 /login 라우팅할 뿐, 크래시/행 없음).
 *
 * Android: @react-native-cookies/cookies 는 단일 CookieManager store 라 useWebKit 이 무의미하고,
 * thirdPartyCookiesEnabled 경로가 이미 동작한다(검증 범위 밖 — best-effort no-op 안전).
 */
export async function seedSharedCookiesFromWebKit(): Promise<void> {
  try {
    // WKHTTPCookieStore(useWebKit=true) — 로그인 WebView setSession 이 document.cookie 로 쓴 곳.
    const webKitCookies = await CookieManager.get(WEB_URL, true);
    const sessionCookies = Object.values(webKitCookies).filter((c) =>
      c.name.startsWith(SUPABASE_COOKIE_PREFIX),
    );
    if (sessionCookies.length === 0) {
      // WK store 에 세션 쿠키 없음 — 복사 대상 없음(예: 이메일 로그인은 이미 NSHTTP 에 존재).
      return;
    }
    // 두 store 모두에 명시 커밋한다 — useWebKit=true(홈 WebView 가 직접 읽는 store, 결정적) + false(대칭/방어).
    // set(...,true) 의 completionHandler ack 로 WK 커밋이 확정된 뒤에 synced 가 보고된다(useAuthBridge .finally).
    await Promise.all(
      sessionCookies.flatMap((c) => [
        CookieManager.set(WEB_URL, toSharedCookie(c), true),
        CookieManager.set(WEB_URL, toSharedCookie(c), false),
      ]),
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
