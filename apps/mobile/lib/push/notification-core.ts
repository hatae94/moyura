// 알림 탭 네비게이션의 순수 결정 로직 (SPEC-CHAT-002 R-PUSH-007, T-008).
//
// 이 모듈은 expo-notifications/RN import 가 전혀 없는 순수 함수만 제공한다 — vitest node 환경에서 mock
// 없이 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션). FCM data 페이로드(moimId)에서 탭 시
// 이동할 대상 모임 채팅 WebView URL 을 조립한다. 실제 알림 응답 리스너 등록/네비게이션은
// notification-handler.ts 얇은 래퍼가 담당한다(device-gated).
//
// 범위: "앱 열기 + WebView 대상 URL 최소 구현"(R-4). 네이티브 라우트 딥링크는 비범위(SPEC-MOBILE-003 후속).

/** 모임 채팅 화면의 웹 경로 — WebView 가 로드할 대상(R-4 최소 구현). */
const CHAT_PATH_SUFFIX = "chat";

/**
 * FCM data 페이로드에서 moimId 를 추출한다(R-PUSH-007 탭 대상).
 *
 * data 가 없거나 moimId 가 빈 값/비문자열이면 null — 탭 시 대상 모임이 불명하면 앱 열기만 한다.
 *
 * @param data 수신 알림의 data 페이로드(신뢰 불가 — 형 검사 필요)
 * @returns moimId 문자열, 없으면 null
 */
export function extractMoimId(
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (!data) {
    return null;
  }
  const moimId = data.moimId;
  if (typeof moimId !== "string" || moimId.trim().length === 0) {
    return null;
  }
  return moimId.trim();
}

/**
 * moimId 로 대상 모임 채팅 WebView URL 을 조립한다(R-PUSH-007 / R-4 최소 구현).
 *
 * `${webUrl 호스트}/moims/{moimId}/chat` 형태의 절대 URL(중복 슬래시 없음). moimId 가 빈 값이면 null
 * (대상 불명 — 네비게이션 불가, 앱 열기만).
 *
 * @param moimId 대상 모임 id
 * @param webUrl 호스팅 웹 base(WEB_URL — EXPO_PUBLIC_WEB_URL 파생)
 * @returns 대상 채팅 URL, moimId 가 비면 null
 */
export function buildChatUrl(moimId: string, webUrl: string): string | null {
  const trimmed = moimId.trim();
  if (!trimmed) {
    return null;
  }
  // URL 생성자로 base 와 경로를 결합한다 — trailing slash 중복을 자동 정규화한다(route-map-core 패턴 동일).
  return new URL(`/moims/${trimmed}/${CHAT_PATH_SUFFIX}`, webUrl).toString();
}
