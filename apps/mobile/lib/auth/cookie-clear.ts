// 로그아웃 WebView 쿠키 clear (SPEC-MOBILE-002 R-R4 (c) — 디바이스 검증 쿠키 부활 결함).
//
// 배경(plan.md § 2026-06-11 인터랙티브 종단 검증): 로그아웃 후 콜드 재시작 시 세션이 ≤1시간 부활했다.
// 실측 원인 — 웹의 로그아웃 쿠키 삭제(server Set-Cookie)가 앱 영속 쿠키 저장소(binarycookies)에
// 영속되지 않음(`sb-127-auth-token` 잔존, 2회 재현). GoTrue revoke 는 정상이나 getSession() 은 쿠키
// 전용이고 백엔드가 시간상 유효한 access JWT 를 통과시켜 부활했다. SecureStore clearTokens(R-R4 (a)(b))는
// 원인이 아니다 — WebView 쿠키 삭제 미영속 갭. 조치: 명시 로그아웃(session:cleared) 수신 시 네이티브가
// WebView 쿠키를 직접 제거해 부활 창(≤ jwt_expiry = 3600s)을 0 으로 닫는다(defense-in-depth).
//
// 이 모듈은 @react-native-cookies/cookies(네이티브 모듈)를 import 하므로 vitest node 환경에서 단위
// 테스트하지 않는다(mobile-pure-core-test-seam — token-store.ts 와 동일 seam). "어떤 메시지가 쿠키를
// 지우는가"의 결정 로직은 순수 bridge-protocol.ts decideInboundAction(clearCookies)에서 테스트한다.
//
// 보안: 쿠키 값을 절대 로깅하지 않는다(R-T6/R-V2). 실패는 throw 가 아니라 no-op 으로 흡수한다
// (token-store.ts 와 동일 — 로그아웃 클리어가 멈추지 않게).
import CookieManager from "@react-native-cookies/cookies";

/**
 * WebView 쿠키 저장소를 모두 비운다(R-R4 (c) — 명시 로그아웃에서만 호출).
 *
 * iOS 에는 두 개의 분리된 쿠키 저장소가 있다: WKWebView 자체 store 와 레거시 NSHTTPCookieStorage.
 * 서버 Set-Cookie 로 들어온 세션 쿠키가 둘 중 어디에 영속됐는지 보장할 수 없으므로(binarycookies
 * 미영속 갭이 측정됨) BOTH 를 비운다 — clearAll(true) = WKWebView store, clearAll(false) =
 * NSHTTPCookieStorage(6.x API: clearAll(useWebKit?: boolean), 설치된 6.2.1 index.d.ts 확인).
 *
 * 셸은 단일 origin(신뢰 WEB_URL)에 잠겨 있으므로(WebView 가 origin-locked — R-T9: originWhitelist 제한 +
 * onShouldStartLoadWithRequest 비신뢰 거부) 모든 WebView 쿠키 = 신뢰 origin 쿠키다. 따라서 origin 별
 * 선택 삭제(clearByName) 대신 clearAll 이 비례적이고 단순하다(다른 origin 쿠키가 셸에 존재할 수 없음).
 *
 * 실패(네이티브 모듈 미가용/키체인 등)는 no-op 으로 흡수한다 — 토큰 클리어(clearTokens)는 별도로
 * 수행되므로 쿠키 clear 실패가 로그아웃 전체를 막지 않는다(부분 클리어 > 무클리어).
 */
export async function clearWebViewCookies(): Promise<void> {
  try {
    // BOTH 저장소를 비운다 — WKWebView store(useWebKit=true) + NSHTTPCookieStorage(useWebKit=false).
    await Promise.all([
      CookieManager.clearAll(true),
      CookieManager.clearAll(false),
    ]);
  } catch {
    // 쿠키 clear 실패 — 쿠키 값 비노출, no-op. clearTokens 는 별도 수행(부분 클리어 허용).
  }
}
