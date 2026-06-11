// 네이티브 인증 상태의 순수 결정 로직 (SPEC-MOBILE-003 R-AS1/R-AS2/R-AS4/R-AS5, AC-2).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 함수/상수만 제공한다 — vitest node 환경에서 mock 없이
// 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션). 네이티브 AuthContext(T-009)가 진입
// 분기/가드 결정에 호출할 isSignedIn + redirectTo 도출 로직을 담는다.
//
// 인증 소스(R-AS1/R-AS5): SecureStore 토큰 캐시 + bridge `session:synced/none/cleared` 신호만으로
// 도출한다. 웹 `/me` 페이지의 세션 상태를 네이티브 인증 소스로 읽지 않는다(R-AS5 부정 불변 — 이
// 모듈은 /me 를 어디에서도 참조하지 않는다).

import { BRIDGE_MESSAGE_TYPES } from "./bridge-protocol";
import type { SessionTokens } from "./token-store-core";

/**
 * 네이티브 인증 결정에 영향을 주는 bridge 신호의 부분집합(web→native 상태 신호).
 * restore/revalidate(native→web 발신)는 상태 신호가 아니므로 제외한다. null 은 핸드셰이크 전(콜드스타트).
 */
export type AuthBridgeSignal =
  | typeof BRIDGE_MESSAGE_TYPES.SYNCED
  | typeof BRIDGE_MESSAGE_TYPES.NONE
  | typeof BRIDGE_MESSAGE_TYPES.CLEARED
  | null;

/** isSignedIn=true 일 때의 네이티브 라우트 목적지(expo-router 그룹 경로 — /me 미사용 R-AS5). */
export const ROUTE_SIGNED_IN = "(tabs)/home" as const;
/** isSignedIn=false 일 때의 네이티브 라우트 목적지(expo-router 그룹 경로 — /me 미사용 R-AS5). */
export const ROUTE_SIGNED_OUT = "(auth)/login" as const;

/** deriveAuthState 입력 — SecureStore 토큰 캐시 + 마지막 web→native 상태 신호. */
export interface AuthStateInput {
  /** SecureStore 에서 디코드한 토큰 캐시(decodeStoredTokens 결과), 미보유면 null. */
  tokens: SessionTokens | null;
  /** 마지막으로 수신한 bridge 상태 신호. 핸드셰이크 전이면 null. */
  lastBridgeSignal: AuthBridgeSignal;
}

/** deriveAuthState 출력 — 로그인 여부 + 진입 리다이렉트 목적지. */
export interface AuthStateOutput {
  isSignedIn: boolean;
  redirectTo: typeof ROUTE_SIGNED_IN | typeof ROUTE_SIGNED_OUT;
}

/**
 * 토큰 캐시 + bridge 신호로 네이티브 인증 상태와 진입 목적지를 도출한다(R-AS1/R-AS2).
 *
 * 결정 규칙:
 *   - 부정 신호(session:none/session:cleared) → 항상 미로그인(토큰 잔존 여부 무관, 보수적). 로그아웃
 *     신호가 stale 캐시보다 우선한다.
 *   - 토큰 캐시 null → 미로그인. session:synced 신호만 있고 캐시가 없으면 인정하지 않는다(보수적 —
 *     신호 위조/경합 방지, 캐시가 곧 인증 증거).
 *   - 그 외(토큰 보유 + 신호가 synced 또는 null):
 *       · session:synced + 토큰 → 로그인(핸드셰이크 확정).
 *       · null 신호 + 토큰 → provisional 로그인(아래 @MX:NOTE).
 *
 * @MX:NOTE: [AUTO] 콜드스타트 provisional 로그인 규칙 — 핸드셰이크 전(null 신호)이라도 SecureStore
 *   캐시 토큰이 있으면 isSignedIn=true 로 처리한다. SPEC-MOBILE-002 R-N3 스플래시 흐름과 일치:
 *   콜드스타트 시 캐시 토큰을 신뢰해 (tabs)/home 으로 향하고, 이후 web→native 핸드셰이크 결과
 *   (session:none/cleared)가 도착하면 그때 미로그인으로 재평가된다. 캐시 없으면 미인증 콜드스타트다.
 *
 * @param input 토큰 캐시 + 마지막 bridge 신호
 * @returns isSignedIn + redirectTo
 * @MX:ANCHOR: [AUTO] 네이티브 인증 결정의 단일 소스 — AuthContext·(auth)/(tabs) 가드·index 진입
 *             분기(T-009)가 호출(fan_in >= 3).
 * @MX:REASON: 이 결정이 틀리면 미인증 사용자가 (tabs) 에 진입하거나(보안) 로그인 사용자가 로그인
 *             화면에 갇힌다(R-AS3 가드 계약). 웹 /me 세션을 소스로 끌어오면 R-AS5 부정 불변 위반.
 */
export function deriveAuthState(input: AuthStateInput): AuthStateOutput {
  const negativeSignal =
    input.lastBridgeSignal === BRIDGE_MESSAGE_TYPES.NONE ||
    input.lastBridgeSignal === BRIDGE_MESSAGE_TYPES.CLEARED;
  // 토큰 캐시가 있고 부정 신호가 아니면 로그인(synced 확정 또는 콜드스타트 provisional).
  const isSignedIn = input.tokens !== null && !negativeSignal;
  return {
    isSignedIn,
    redirectTo: isSignedIn ? ROUTE_SIGNED_IN : ROUTE_SIGNED_OUT,
  };
}
