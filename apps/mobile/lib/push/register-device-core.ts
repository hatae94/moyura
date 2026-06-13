// 디바이스 등록의 순수 결정 로직 (SPEC-CHAT-002 R-PUSH-005, T-008).
//
// 이 모듈은 expo-notifications/RN import 가 전혀 없는 순수 함수/타입만 제공한다 — vitest node 환경에서
// mock 없이 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션). 실제 push 토큰 획득(권한 요청 +
// getDevicePushTokenAsync)과 REST 등록(POST /devices, SecureStore access token Bearer)은 register-device.ts
// 얇은 래퍼가 담당한다(device-gated — Expo Go 원격 푸시 불가, dev build 필요).

/** device_token.platform 값. 네이티브 앱만 푸시 대상 — android/ios 만 유효하다. */
export type DevicePlatform = "android" | "ios";

/** POST /devices 요청 바디(백엔드 RegisterDeviceDto 와 동형). */
export interface RegisterDeviceBody {
  token: string;
  platform: DevicePlatform;
}

/**
 * RN Platform.OS 문자열을 device_token.platform 으로 정규화한다.
 *
 * android/ios 만 유효하다 — 그 외(web/windows/macos 등)는 네이티브 푸시 대상이 아니므로 null 이다
 * (게스트 웹은 디바이스 토큰을 등록하지 않는다 — 백엔드 REQ-PUSH-006 과 정합).
 *
 * @param os RN Platform.OS (또는 임의 문자열)
 * @returns 정규화된 DevicePlatform, 비대상이면 null
 */
export function normalizePlatform(os: string): DevicePlatform | null {
  return os === "android" || os === "ios" ? os : null;
}

/**
 * POST /devices 요청 바디를 조립한다. token 이 비어 있거나 platform 정규화가 실패하면 null
 * (등록 불가 — 빈 토큰/비대상 OS 전송 방지).
 *
 * @param token 디바이스 push 토큰(획득 결과)
 * @param platform 정규화 전 OS 문자열 또는 정규화된 값/null
 * @returns 유효한 요청 바디, 등록 불가면 null
 */
export function buildRegisterDeviceBody(
  token: string,
  platform: string | DevicePlatform | null,
): RegisterDeviceBody | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = platform === null ? null : normalizePlatform(platform);
  if (!normalized) {
    return null;
  }
  return { token: trimmed, platform: normalized };
}

/**
 * 로그아웃 해제 시 사용할 토큰을 결정한다(R-3 orphan token 신뢰성 — 재획득 비의존).
 *
 * 우선순위: 명시 인자(explicit) > 등록 시 저장해 둔 토큰(stored) > null. expo getDevicePushTokenAsync 를
 * 로그아웃 시점에 재획득하지 않는다 — 권한 취소/Expo Go 에서 재획득이 실패하면 해제가 건너뛰어져 orphan
 * token 이 남기 때문이다(MEDIUM-CRAFT). 빈 문자열은 미보유로 취급한다. 어느 쪽도 없으면 null(no-op).
 *
 * @param explicit 호출자가 직접 넘긴 토큰(있으면 최우선)
 * @param stored registerDevice 가 성공 시 보관해 둔 토큰
 * @returns 해제 대상 토큰, 없으면 null
 */
export function resolveUnregisterToken(
  explicit: string | null | undefined,
  stored: string | null | undefined,
): string | null {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) {
    return fromExplicit;
  }
  const fromStored = stored?.trim();
  if (fromStored) {
    return fromStored;
  }
  return null;
}
