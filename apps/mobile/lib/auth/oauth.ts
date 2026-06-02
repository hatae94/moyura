// 모바일 소셜 OAuth 진입 스캐폴드 (SPEC-AUTH-001 group E / R-E2 / R-E3 / R-E4, AC-E2 / AC-E3 / AC-E4).
//
// ── 세션 공유 / OD-4 결정 (네이티브 토큰 저장소 미도입) ──────────────────────────────
// 이 앱은 웹 auth surface 를 WebView 로 호스팅하고 웹 세션을 공유한다(R-E1). 세션 소유권은
// 웹 레이어(@supabase/ssr 쿠키 세션)에 있으므로, 인증 상태(토큰/세션)는 WebView 가 들고 있는
// 웹 쿠키 세션에 머문다. 네이티브 측은 세션 토큰을 직접 보관하지 않는다.
//
// 따라서 OD-4(expo-secure-store vs AsyncStorage)는 "둘 다 미도입"으로 확정한다:
//   - 네이티브가 토큰/세션 조각을 보관해야 하는 경로가 이 스캐폴드에는 없다.
//   - 시스템 브라우저 OAuth → deep link 복귀 후, WebView 가 웹 콜백(/auth/callback)을
//     로드하면서 @supabase/ssr 가 쿠키 세션을 확립한다(R-E3). 네이티브는 "브라우저를 열고
//     복귀 결과만 받는" 역할이다.
//   - 네이티브 토큰 보관이 실제로 필요해지는 follow-up(예: 네이티브-퍼스트 화면)이 생기면
//     그때 expo-secure-store(56.0.4, OS 키체인 암호화)를 도입한다. 지금 도입은 투기적
//     복잡성(TRUST 5 Readable / R-F3 스캐폴드 범위)이므로 미도입이 가장 단순하다.
//
// ── 임베디드 webview 금지 (R-E2) ────────────────────────────────────────────────
// Google 등 주요 IdP 는 임베디드 webview OAuth 를 차단한다. 따라서 provider 인증 페이지는
// expo-web-browser 의 openAuthSessionAsync(시스템 브라우저/ASWebAuthenticationSession,
// CustomTabs)로 연다 — RN WebView 안에서 직접 띄우지 않는다.
//
// ── 스캐폴드 범위 ──────────────────────────────────────────────────────────────
// 이 헬퍼는 "OAuth 를 시스템 브라우저로 띄우고 deep link 복귀를 받는" 최소 진입점만 제공한다.
// 실제 provider 키는 연기(R-F3)되어 있고, 완성된 WebView 제품 화면/스타일 흐름은 범위 밖이다.
import * as WebBrowser from "expo-web-browser";
import { makeRedirectUri } from "expo-auth-session";

import { SUPABASE_URL } from "../env";

/** 지원 소셜 provider — 웹 signInWithOAuthAction 과 동일 문자열 집합(R-F2). */
export type SocialProvider = "google" | "apple" | "kakao";

/**
 * deep link 복귀 결과.
 * - `authenticated`: 시스템 브라우저가 등록된 deep link 로 성공 복귀(웹 세션 확립은 WebView 가 수행).
 * - `cancelled`: 사용자가 브라우저를 닫거나 취소(R-E4 — 미인증 유지, 크래시 없음).
 * - `error`: redirect 불일치/예외 등 복구 가능한 실패(R-E4 — 미인증 유지 + 복구 가능 에러).
 */
export type OAuthLaunchResult =
  | { kind: "authenticated"; returnUrl: string }
  | { kind: "cancelled" }
  | { kind: "error"; reason: string };

// 앱 deep-link 복귀 URL. app.json 의 "scheme": "moyura" + config.toml additional_redirect_urls 의
// "moyura://auth-callback" 와 정확히 일치해야 한다(GoTrue exact-match — R-E3/R-H2).
// makeRedirectUri 는 현재 권장 API(getRedirectUrl 은 deprecated). path 로 host 부 경로를 고정한다.
const RETURN_PATH = "auth-callback";

/** deep link 복귀 URL 을 조립한다(예: moyura://auth-callback). 테스트 가능한 순수 단위. */
export function buildReturnUrl(): string {
  return makeRedirectUri({ scheme: "moyura", path: RETURN_PATH });
}

/**
 * 시스템 브라우저로 소셜 OAuth 를 시작한다(R-E2). 인증 URL 은 웹 PKCE 콜백을 거치는
 * provider authorize URL 이며(웹이 세션을 소유 — signInWithOAuth redirectTo=웹 콜백),
 * 완료되면 등록된 deep link(moyura://auth-callback)로 앱에 복귀한다(R-E3).
 *
 * NOTE(스캐폴드): authorizeUrl 산출(웹 signInWithOAuth 의 data.url 을 모바일로 전달하는 방식)은
 * provider 키 배선 follow-up 에서 확정한다(R-F3). 여기서는 "주어진 authorizeUrl 을 시스템
 * 브라우저로 열고 복귀 결과를 안전하게 분류" 하는 부분까지만 제공한다.
 *
 * @param authorizeUrl 시스템 브라우저에 열 provider 인증 페이지 URL
 * @returns 복귀 결과 분류(미인증 유지/복구 가능 에러 포함 — R-E4)
 */
// @MX:WARN: [AUTO] 외부 시스템(시스템 브라우저/IdP) 경계 — 복귀 실패를 throw 가 아니라
//   복구 가능한 결과로 분류해야 한다(R-E4: 크래시 없음, silent half-auth 없음).
// @MX:REASON: openAuthSessionAsync 는 사용자 취소/브라우저 종료/redirect 불일치에서 다양한
//   결과/예외를 낼 수 있고, 미처리 시 앱이 미인증인데도 인증된 듯 동작하거나 크래시할 수 있다.
export async function launchSocialOAuth(
  authorizeUrl: string,
): Promise<OAuthLaunchResult> {
  const returnUrl = buildReturnUrl();
  try {
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, returnUrl);

    if (result.type === "success") {
      // 등록된 deep link 로 복귀 — 실제 세션 확립은 WebView 가 웹 콜백을 로드하며 수행(R-E3).
      return { kind: "authenticated", returnUrl: result.url };
    }

    // 'cancel' | 'dismiss' — 사용자가 브라우저를 닫음. 미인증 유지(R-E4).
    return { kind: "cancelled" };
  } catch (err) {
    // redirect 불일치/세션 예외 등 — 미인증 유지 + 복구 가능 에러(R-E4). 토큰/URL 내용은 노출하지 않는다(R-A9).
    const reason = err instanceof Error ? err.message : "oauth_launch_failed";
    return { kind: "error", reason };
  }
}

// SUPABASE_URL 은 후속(provider authorizeUrl 산출/anon 컨텍스트) 사용을 위해 가드를 거쳐 import 한다.
// 현재 스캐폴드에서는 직접 참조하지 않으므로 void 로 부팅-시 평가만 보장한다(미설정 시 env 가드가 throw).
void SUPABASE_URL;
