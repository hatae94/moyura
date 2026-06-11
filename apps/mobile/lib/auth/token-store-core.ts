// token-store 의 순수 결정 로직 (SPEC-MOBILE-002 R-N2, AC-N2).
//
// 이 모듈은 expo-secure-store import 가 전혀 없는 순수 함수/상수만 제공한다 — vitest node 환경에서
// mock 없이 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션). SecureStore 키 매핑과
// "로드된 한 쌍이 유효한 토큰 캐시인지"의 결정만 담고, 실제 비동기 SecureStore 호출은
// token-store.ts 얇은 래퍼가 담당한다.

/** 캐시된 세션 토큰 쌍. payload 에 userId/프로필은 절대 포함하지 않는다(PII 최소화 — OD-4). */
export interface SessionTokens {
  /** Supabase access_token(JWT). 백엔드 Bearer 호출에 사용(장기 비전). */
  access: string;
  /** Supabase refresh_token. SecureStore 에만 저장한다(R-N2/R-V2 — AsyncStorage/plaintext 금지). */
  refresh: string;
}

// SecureStore 키. expo-secure-store 키는 [A-Za-z0-9._-] 만 허용한다(SDK 56) — 점 구분 네임스페이스 사용.
// access·refresh 를 별도 항목으로 저장한다(둘 다 SecureStore = OS 키체인 암호화, refresh 평문 금지).
export const ACCESS_TOKEN_KEY = "moyura.session.access_token";
export const REFRESH_TOKEN_KEY = "moyura.session.refresh_token";

/**
 * SecureStore 에서 읽은 access·refresh 원시값을 유효한 토큰 캐시로 디코드한다(R-N2).
 *
 * access·refresh 둘 다 비어 있지 않을 때만 SessionTokens 를 반환한다. 한쪽이라도 null/빈 문자열이면
 * "캐시 미보유"(null)로 취급한다 — refresh 없는 access 는 갱신 불가, access 없는 refresh 는 무의미하다.
 * 둘 다 없으면 미인증 콜드스타트(R-N5)다.
 *
 * @param access SecureStore getItemAsync(ACCESS_TOKEN_KEY) 결과
 * @param refresh SecureStore getItemAsync(REFRESH_TOKEN_KEY) 결과
 * @returns 완전한 토큰 쌍이면 SessionTokens, 불완전하면 null
 */
export function decodeStoredTokens(
  access: string | null,
  refresh: string | null,
): SessionTokens | null {
  if (!access || !refresh) {
    return null;
  }
  return { access, refresh };
}
