// 모바일 Supabase 클라이언트 + signInWithIdToken 얇은 래퍼 (SPEC-MOBILE-004 R-MOB4-001/002, AC-1/2/5/6b).
//
// @supabase/supabase-js 의 createClient + auth.signInWithIdToken 을 호출하는 네이티브/네트워크 경계
// 래퍼다. 세션 결과 분류는 순수 signin-id-token-core.ts(classifyIdTokenSession)에 위임한다 — 이 파일은
// 클라이언트 생성 + signInWithIdToken 호출 + try/catch 흡수만 담는다(google-signin.ts 와 동일 패턴).
//
// ── 세션 권위 / 토큰 흐름 ──────────────────────────────────────────────────────────
// 네이티브 Google SDK 가 얻은 idToken 을 signInWithIdToken({provider:'google', token})에 넘겨 Supabase
// 세션(access/refresh)을 얻는다. 그 토큰은 useAuthBridge 가 saveTokens(SecureStore) 후 session:restore
// 브리지로 WebView 웹 세션에 주입한다(bridge-protocol v1 무변경 — 기존 경로 재사용). 이 클라이언트는
// 세션을 영속(persistSession)하지 않는다 — refresh 영속 책임은 token-store(SecureStore)에 있다(OD-4).
//
// ── 로컬 nonce skip / prod 분리 (SPEC-AUTH-002 OD-5 일관) ────────────────────────────
// 로컬/dev 는 Supabase 의 skip_nonce_check=true 를 전제하므로 nonce 를 전달하지 않는다. prod nonce
// 강제(idToken nonce claim 검증)는 follow-up(SPEC-MOBILE-004 제외 범위 — prod OAuth 배선 OD-4)이다.
//
// ── Expo Go 불가 / 런타임 디바이스 게이트 ──────────────────────────────────────────
// signInWithIdToken 의 실제 동작(토큰 검증·세션 발급)은 dev 백엔드/Supabase + 실제 idToken 이 필요해
// 디바이스 종단 검증(T-010)에서 확인한다. 이 래퍼는 tsc/expo export 로 정적 검증된다.
//
// 보안(AC-6b): access/refresh 토큰 값이나 idToken 을 로깅하지 않는다 — core 분류 결과만 돌려준다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../env";
import {
  classifyIdTokenSession,
  type IdTokenSessionResult,
} from "./signin-id-token-core";

/**
 * 모바일용 Supabase 클라이언트를 생성한다(R-MOB4-001).
 *
 * persistSession/autoRefreshToken 을 끈다 — 세션 영속은 token-store(SecureStore)가, 갱신/검증은 웹
 * 레이어가 담당한다(OD-1/OD-4). 이 클라이언트는 idToken→세션 교환(signInWithIdToken) 1회 용도다.
 *
 * @returns 공개 anon 키로 구성된 SupabaseClient(서버 세션 영속 없음)
 */
export function createMobileSupabaseClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // 세션 영속/자동 갱신 비활성 — refresh 영속은 SecureStore(token-store), 갱신은 웹이 권위(OD-1/OD-4).
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Google idToken 을 Supabase 세션으로 교환하고 결과를 순수 core 로 분류해 돌려준다(R-MOB4-001/002/005).
 *
 * auth.signInWithIdToken({provider:'google', token}) 의 resolve 응답({data,error})과 throw 한 예외를
 * 모두 classifyIdTokenSession 에 넘긴다 — core 가 세션 토큰 쌍이면 session, 그 외(error/세션 없음/
 * 불완전)는 error 로 흡수한다. 어떤 경우에도 throw 하지 않고 복구 가능한 분류를 반환한다(미인증 유지
 * — AC-6b). 토큰 값/ error 상세를 로깅하지 않는다(AC-6b — 자격증명 비노출).
 *
 * 로컬 nonce skip(OD-5): nonce 를 전달하지 않는다(prod nonce 강제는 제외 범위).
 *
 * @param client createMobileSupabaseClient() 가 만든 클라이언트
 * @param idToken 네이티브 Google SDK 가 얻은 Google idToken
 * @returns session(access/refresh) | error(복구 가능한 실패) — 토큰 값 비노출
 */
// @MX:NOTE: [AUTO] Supabase signInWithIdToken 호출 경계(SPEC-MOBILE-004) — idToken→세션 교환.
//   로컬 nonce skip(OD-5), prod nonce 강제는 follow-up. resolve/throw 를 core 분류기로 흡수(AC-6b).
// @MX:WARN: [AUTO] 로컬은 Supabase skip_nonce_check=true 전제로 nonce 를 전달하지 않는다 — prod 는
//   idToken nonce claim 검증을 강제해야 한다(미적용 시 토큰 재생(replay) 위험).
// @MX:REASON: nonce 미검증 idToken 은 탈취 시 재사용될 수 있다(세션 고정/재생). 로컬 검증 편의를 위한
//   skip 이 prod 로 새면 OWASP M3(insecure auth) 노출이므로 prod 배선(OD-4)에서 반드시 nonce 를 싣는다.
export async function exchangeGoogleIdTokenForSession(
  client: SupabaseClient,
  idToken: string,
): Promise<IdTokenSessionResult> {
  try {
    const response = await client.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });
    return classifyIdTokenSession(response);
  } catch (error) {
    // 네트워크/클라이언트 예외 — core 가 malformed 로 흡수한다(토큰/상세 비노출 — AC-6b).
    return classifyIdTokenSession(error);
  }
}
