// 네이티브 토큰 캐시 (SPEC-MOBILE-002 R-N2, AC-N2) — OD-4 역전 지점.
//
// expo-secure-store(OS 키체인/Keystore 암호화) 위에 loadTokens/saveTokens/clearTokens 를 제공한다.
// refresh 토큰은 SecureStore 에만 저장한다 — AsyncStorage/plaintext 에 절대 두지 않는다(R-N2/R-V2).
//
// 세션 권위(검증/갱신)는 웹이 보유하고 네이티브는 캐시일 뿐이다(OD-1). 이 모듈은 토큰을 저장/조회만
// 하며 Supabase refresh 로직을 복제하지 않는다(Non-Goal — OD-3). 결정 로직(키 매핑, 유효 한 쌍 판별)은
// 순수 token-store-core.ts 에 두어 node 환경에서 단위 테스트한다(mobile-pure-core-test-seam).
//
// 보안: 토큰 값을 절대 로깅하지 않는다(R-T6/R-V2). 저장/조회 실패는 throw 가 아니라 복구 가능한
// 결과(load 는 null, save/clear 는 no-op)로 흡수해 콜드스타트/핸드셰이크가 멈추지 않게 한다(R-N6 연계).
import * as SecureStore from "expo-secure-store";

import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  decodeStoredTokens,
  type SessionTokens,
} from "./token-store-core";

export type { SessionTokens } from "./token-store-core";

// @MX:NOTE: [AUTO] SecureStore 쓰기 accessibility 옵션 — 보안 M-1/R-N2.
// refresh 같은 장기 비밀은 잠금 해제 + 디바이스 바인딩(WHEN_UNLOCKED_THIS_DEVICE_ONLY)으로 저장해
// 백업/다른 기기 복원으로의 유출을 막는다. SDK 기본값에 의존하지 않으며 ALWAYS(잠금 무관)는 쓰지 않는다.
const TOKEN_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/**
 * SecureStore 에 캐시된 토큰 쌍을 로드한다(R-N3 콜드스타트 진입에서 사용).
 *
 * access·refresh 둘 다 존재할 때만 SessionTokens 를 반환한다(decodeStoredTokens). 한쪽이라도
 * 없거나 SecureStore 조회가 실패하면 null(캐시 미보유)로 흡수한다 — 미인증 콜드스타트(R-N5)와
 * 동일하게 웹 가드 라우팅에 위임한다.
 *
 * @returns 완전한 토큰 쌍이면 SessionTokens, 미보유/실패면 null
 */
export async function loadTokens(): Promise<SessionTokens | null> {
  try {
    const [access, refresh] = await Promise.all([
      SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
    ]);
    return decodeStoredTokens(access, refresh);
  } catch {
    // SecureStore 조회 실패(키체인 잠금 등) — 토큰 내용 비노출, 캐시 미보유로 폴백(R-N6 연계).
    return null;
  }
}

/**
 * 토큰 쌍을 SecureStore 에 저장한다(R-T5 session:synced 수신 시 갱신).
 *
 * access·refresh 를 각각 별도 SecureStore 항목으로 저장한다(둘 다 OS 키체인 암호화). refresh 는
 * 절대 다른 저장소에 두지 않는다(R-N2). 저장 실패는 no-op 으로 흡수한다(핸드셰이크 비차단).
 *
 * @param tokens 웹이 회신한 최신 access·refresh
 */
export async function saveTokens(tokens: SessionTokens): Promise<void> {
  try {
    // R-N2/M-1: 명시적 안전 keychainAccessible 로 저장(SDK 기본값 미의존, ALWAYS 금지).
    await Promise.all([
      SecureStore.setItemAsync(ACCESS_TOKEN_KEY, tokens.access, TOKEN_STORE_OPTIONS),
      SecureStore.setItemAsync(REFRESH_TOKEN_KEY, tokens.refresh, TOKEN_STORE_OPTIONS),
    ]);
  } catch {
    // 저장 실패(키체인 쓰기 불가 등) — 토큰 내용 비노출, no-op(다음 핸드셰이크에서 재시도).
  }
}

/**
 * SecureStore 의 토큰 쌍을 제거한다(R-R3 session:cleared 수신 시 로그아웃 클리어).
 *
 * access·refresh 두 항목을 모두 삭제한다 — stale 토큰 잔존(보안 약점)을 막는다(R-R2/H-2 종단).
 * 삭제 실패는 no-op 으로 흡수한다.
 */
export async function clearTokens(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
      SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
    ]);
  } catch {
    // 삭제 실패 — no-op. 다음 clear 기회(다음 로그아웃)에서 재시도.
  }
}
