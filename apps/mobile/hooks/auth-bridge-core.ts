// useAuthBridge 의 순수 결정 로직 (SPEC-WEBVIEW-SHELL-001 R-S4/R-S6, AC-S4/AC-S6).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 함수만 제공한다 — 네이티브 모듈 mock 없이
// vitest node 환경에서 단위 테스트 가능하다(oauth-bridge.ts 와 동일 패턴). App.tsx 에 인라인이던
// OAuth 인터셉트 판별과 runOAuthBridge 의 결과 처리 분기를 행위 보존(characterization)으로 추출한다.
//
// 주의: 순수성을 유지하기 위해 oauth.ts(expo import 포함)의 shouldBridgeOAuth/resolveWebCallbackUrl
// 대신, oauth-bridge.ts(순수)의 isOAuthAuthorizeUrl/buildWebCallbackUrl 을 supabase base 주입 방식으로
// 사용한다. useAuthBridge 훅이 SUPABASE_URL/WEB_URL 을 주입한다.
//
// ── seam (SPEC-MOBILE-002) ──────────────────────────────────────────────────────
// 이 모듈은 SPEC-MOBILE-001 의 기존 동작만 담는다(토큰 로직 0). `expo-secure-store`/`@supabase/*`
// 를 import 하지 않는다(AC-S4 seam 게이트). session:restore 주입/onMessage/SecureStore 는
// SPEC-MOBILE-002 가 채울 자리다 — 여기서는 비워둔다.

import { isOAuthAuthorizeUrl, buildWebCallbackUrl } from "../lib/auth/oauth-bridge";
import { constantTimeEquals } from "../lib/auth/bridge-protocol";
import { isCrossRoute, routeForUrl, type AppRoute } from "../lib/route-map-core";
// 타입 전용 import — 컴파일 시 erase 되어 런타임에 oauth.ts(expo import)를 끌어오지 않는다
// (vitest node 환경의 순수성 유지 — AC-S6). OAuthLaunchResult 는 oauth.ts 의 공개 타입이다.
import type { OAuthLaunchResult } from "../lib/auth/oauth";

/**
 * onShouldStartLoadWithRequest 의 인터셉트 결정(R-O1). App.tsx 의 handleShouldStartLoad 분기를
 * 순수 함수로 추출한다(shouldBridgeOAuth 와 동일 판별 — supabase base 를 주입받아 순수 유지).
 *
 * @param url WebView 가 로드하려는 네비게이션 URL
 * @param supabaseBaseUrl GoTrue 호스트 base(SUPABASE_URL — 훅이 주입)
 * @returns `"bridge"` (인터셉트 → 임베디드 로드 차단 후 시스템 브라우저 브리지) 또는
 *          `"allow"` (정상 네비게이션 — 임베디드 로드 허용)
 */
export function decideOAuthIntercept(
  url: string,
  supabaseBaseUrl: string,
): "bridge" | "allow" {
  return isOAuthAuthorizeUrl(url, supabaseBaseUrl) ? "bridge" : "allow";
}

/**
 * runOAuthBridge 의 결과 처리 분기(R-O3/R-O4)를 순수 함수로 추출한다. App.tsx 의
 * runOAuthBridge 본문 중 setSourceUri 호출 여부 결정을 담는다.
 *
 * - authenticated 이고 콜백 URL 조립 성공 → 그 콜백 URL 로 네비게이트(setSourceUri).
 * - authenticated 이지만 code 누락 등으로 콜백 URL 조립 실패 → no-op(미인증 유지, half-auth 방지).
 * - cancelled | error → no-op(미인증 유지, 크래시 없음, 로그인 surface 유지).
 *
 * @param result launchSocialOAuth/bridgeGoogleOAuth 의 복귀 결과 분류
 * @param webUrl 셸이 호스팅하는 웹 URL(WEB_URL)
 * @returns 네비게이트할 웹 콜백 URL, 네비게이션 변경이 없으면 null
 */
export function resolveBridgeNavigation(
  result: OAuthLaunchResult,
  webUrl: string,
): string | null {
  if (result.kind !== "authenticated") {
    // cancelled | error → 미인증 유지, 네비게이션 변경 없음(R-O4).
    return null;
  }
  // code 누락 등이면 buildWebCallbackUrl 이 null → half-auth 방지(미인증 유지).
  return buildWebCallbackUrl(result.returnUrl, webUrl);
}

// ── SPEC-MOBILE-002 토큰 동기화 확장 (R-T6/R-T7) ────────────────────────────────────
// 아래는 useAuthBridge 가 토큰 주입 전에 호출할 순수 결정 로직이다(여전히 expo/RN import 0).

/**
 * 안전하게 URL 을 파싱한다(실패 시 null) — origin 매칭이 잘못된 입력에서 throw 하지 않게 한다.
 */
function tryParseOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * 현재 WebView URL 의 origin 이 신뢰 WEB_URL origin 과 일치하는지 판별한다(R-T6 origin allowlist).
 *
 * 토큰 주입 전(콜드스타트 R-T2 AND resume R-R1 — 공용)에 호출한다. origin 은 scheme+host+port 의
 * exact 일치로 비교한다 — third-party/네비게이트된 페이지에 토큰을 주입하지 않는다(H-3, OWASP).
 * 허용 origin 은 EXPO_PUBLIC_WEB_URL 호스트에서 파생되므로(M-4) 에뮬레이터 호스트(10.0.2.2)도
 * WEB_URL 이 그 호스트일 때 일관되게 허용된다(OD-7).
 *
 * @param currentUrl WebView 의 현재 navigation URL(onNavigationStateChange 로 추적)
 * @param trustedWebUrl 신뢰 origin 의 출처(WEB_URL — EXPO_PUBLIC_WEB_URL 파생)
 * @returns 두 origin 이 정확히 같으면 true(주입 허용), 그 외 false(주입 금지)
 */
export function isTrustedOrigin(currentUrl: string, trustedWebUrl: string): boolean {
  const current = tryParseOrigin(currentUrl);
  const trusted = tryParseOrigin(trustedWebUrl);
  if (!current || !trusted) {
    return false;
  }
  return current === trusted;
}

/** session:restore 주입 재시도 상한(bounded — R-T7). 도달 시 R-N6 타임아웃 폴백으로 이어진다. */
export const MAX_INJECTION_RETRIES = 5;

/** 주입 재시도 결정 입력 — 지금까지 시도 횟수와 웹 핸들러 ack 수신 여부. */
export interface InjectionRetryState {
  /** 지금까지 session:restore 를 주입한 횟수. */
  attempts: number;
  /** 웹 브리지 핸들러가 메시지를 받았다고 ack 했는지(synced/none 회신 = ack). */
  acked: boolean;
}

/**
 * session:restore 주입 race(웹 핸들러 미등록) 대비 bounded 재시도 여부를 결정한다(R-T7).
 *
 * - 이미 ack(synced/none 회신) 받았으면 → stop(메시지 도달, 핸드셰이크 진행 중).
 * - 아직 ack 없고 시도 횟수가 한도 미만이면 → retry(재주입 — 핸들러 등록 race 흡수).
 * - 한도 도달이면 → give-up(더 주입하지 않음; R-N6 타임아웃이 스플래시를 해제한다).
 *
 * 이로써 session:restore 가 silent 하게 유실되지 않는다(AC-T7).
 *
 * @param state 현재 시도 횟수 + ack 여부
 * @returns "retry" | "stop" | "give-up"
 */
export function decideInjectionRetry(
  state: InjectionRetryState,
): "retry" | "stop" | "give-up" {
  if (state.acked) {
    return "stop";
  }
  if (state.attempts >= MAX_INJECTION_RETRIES) {
    return "give-up";
  }
  return "retry";
}

// ── SPEC-MOBILE-002 v0.2.0 보안 확장 (R-T8/R-T9 — C-1/C-2/H-1) ──────────────────────

/**
 * 메시지 인증 nonce 를 상수시간으로 검증한다(R-T8/OD-11 — C-1/H-1).
 *
 * 동일 page 의 임의 스크립트(서드파티/XSS)는 cold-start 에 확립된 per-session nonce 를 모르므로
 * session:restore 위조(세션 고정)나 토큰 탈취가 불가능하다. 타이밍 사이드채널을 피하기 위해
 * bridge-protocol 의 constantTimeEquals 를 재사용한다.
 *
 * @param received 수신 메시지의 nonce
 * @param expected cold-start 에 확립한 per-session nonce
 * @returns 둘이 비어 있지 않고 정확히 같으면 true
 */
export function verifyNonce(received: string, expected: string): boolean {
  return constantTimeEquals(received, expected);
}

/**
 * 신뢰 WEB_URL 의 origin literal 을 반환한다(R-T8 — postMessage targetOrigin 용, C-2(d)/H-1).
 *
 * 네이티브→웹 주입 postMessage 의 targetOrigin 을 와일드카드 `"*"` 가 아니라 신뢰 origin literal 로
 * 고정하기 위해 사용한다. WebView 가 다른 origin 에 있으면 브라우저가 메시지 전달을 자체 거부한다.
 * trustedWebUrl 파싱 실패는 발생하면 안 되지만(부팅 가드가 검증), 방어적으로 원본을 그대로 돌려준다.
 *
 * @param trustedWebUrl WEB_URL(EXPO_PUBLIC_WEB_URL 파생)
 * @returns scheme+host+port origin literal(절대 `"*"` 아님)
 */
export function buildTargetOrigin(trustedWebUrl: string): string {
  return tryParseOrigin(trustedWebUrl) ?? trustedWebUrl;
}

/** decideWebViewLoad 의 origin/OAuth 판정 컨텍스트. */
export interface WebViewLoadContext {
  /** 신뢰 origin 의 출처(WEB_URL). */
  trustedWebUrl: string;
  /** GoTrue 호스트 base(SUPABASE_URL) — OAuth authorize 인터셉트 판별용. */
  supabaseBaseUrl: string;
  /**
   * (SPEC-MOBILE-003 R-NC2) WebView 의 현재 navigation URL. 주어지면 교차 라우트 디스패치 판정을
   * 활성화한다 — 부재 시(undefined) SHELL-001/MOBILE-002 동작 그대로(회귀 0).
   */
  currentUrl?: string;
}

/** (SPEC-MOBILE-003 R-NC2) 교차 라우트 로드를 네이티브 라우트 전환으로 재디스패치하라는 결정. */
export interface WebViewDispatch {
  action: "dispatch";
  route: AppRoute;
}

/** decideWebViewLoad 의 결정 — 기존 3분기 + (MOBILE-003) 교차 라우트 디스패치 변형. */
export type WebViewLoadDecision =
  | "oauth-intercept"
  | "trusted-load"
  | "deny"
  | WebViewDispatch;

/**
 * onShouldStartLoadWithRequest 의 in-WebView 로드 결정(R-T9 — WebView origin 잠금, C-2 +
 * SPEC-MOBILE-003 R-NC2 교차 라우트 디스패치).
 *
 * 분기(우선순위 순):
 *   - `"oauth-intercept"`: GoTrue authorize URL — 시스템 브라우저 브리지로 인터셉트(R-V1/R-NC3 보존).
 *   - `{ action: "dispatch", route }`: (R-NC2) currentUrl 이 주어지고, 타깃이 신뢰 origin 의 교차 앱
 *     라우트면 in-WebView 로드 deny + 네이티브 라우트 디스패치. ctx.currentUrl 부재 시 비활성(회귀 0).
 *   - `"trusted-load"`: 신뢰 WEB_URL origin 의 http(s) 로드 — in-WebView 허용.
 *   - `"deny"`: 비신뢰 top-level http(s) origin — in-WebView 로드 거부(외부 브라우저 위임).
 *
 * 우선순위: OAuth 인터셉트 > 교차 라우트 디스패치 > origin 판정. OAuth/인증 플로우 내부(authorize,
 * /login, /auth/callback)는 디스패치보다 우선·보존된다(R-NC3 예외 — 인증 플로우 기존 허용 규칙).
 * supabase 호스트는 신뢰 origin 이 아니어도 authorize URL 이면 intercept(deny 아님)다. 비-http scheme/
 * 파싱 불가 URL(about:blank, data: 등 프레임워크 내부 요청)은 `"trusted-load"`(허용)로 처리해 무회귀.
 *
 * @param url WebView 가 로드하려는 네비게이션 URL
 * @param ctx 신뢰 WEB_URL + supabase base (+ optional currentUrl)
 * @returns "oauth-intercept" | "trusted-load" | "deny" | { action: "dispatch", route }
 */
// 오버로드: currentUrl 부재(기존 호출부)면 결정은 디스패치 변형이 없는 3분기로 좁혀진다 — 기존
// 소비자(useAuthBridge 의 exhaustive switch)가 타입 회귀 없이 그대로 컴파일된다(type-backward-compat).
export function decideWebViewLoad(
  url: string,
  ctx: WebViewLoadContext & { currentUrl?: undefined },
): "oauth-intercept" | "trusted-load" | "deny";
// 오버로드: currentUrl 이 주어지면 교차 라우트 디스패치 변형을 포함한 넓은 결정을 반환한다(R-NC2).
export function decideWebViewLoad(
  url: string,
  ctx: WebViewLoadContext,
): WebViewLoadDecision;
export function decideWebViewLoad(
  url: string,
  ctx: WebViewLoadContext,
): WebViewLoadDecision {
  // OAuth authorize URL 은 origin/디스패치 판정보다 우선해 인터셉트한다(R-V1/R-NC3 보존).
  if (isOAuthAuthorizeUrl(url, ctx.supabaseBaseUrl)) {
    return "oauth-intercept";
  }
  const origin = tryParseOrigin(url);
  // 파싱 불가/비-http scheme(about:blank, data: 등 프레임워크 내부) — 막지 않는다(무회귀).
  if (origin === null || !(origin.startsWith("http://") || origin.startsWith("https://"))) {
    return "trusted-load";
  }
  const trusted = isTrustedOrigin(url, ctx.trustedWebUrl);
  // (R-NC2) 교차 라우트 디스패치: currentUrl 이 주어졌고 신뢰 origin 의 교차 앱 라우트면 deny + 디스패치.
  // currentUrl 부재면 이 분기를 건너뛰어 기존 동작 그대로(회귀 0).
  if (ctx.currentUrl !== undefined && trusted && isCrossRoute(ctx.currentUrl, url)) {
    const route = routeForUrl(url);
    // isCrossRoute(...)===true 면 routeForUrl(url)!==null 이 보장되지만, 타입 내로잉 위해 확인한다.
    if (route !== null) {
      return { action: "dispatch", route };
    }
  }
  // http(s) top-level: 신뢰 origin 이면 허용, 그 외 거부(외부 브라우저 위임).
  return trusted ? "trusted-load" : "deny";
}
