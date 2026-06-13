// 알림 탭 핸들러 얇은 래퍼 (SPEC-CHAT-002 R-PUSH-007, T-009) — device-gated.
//
// @MX:NOTE: [AUTO] 탭 시 "앱 열기 + WebView 대상 URL 최소 구현"만 한다(R-4 — 네이티브 라우트 딥링크는
// SPEC-MOBILE-003 후속 비범위). expo-notifications 응답 리스너(포그라운드/백그라운드 탭) + 콜드스타트
// 마지막 응답을 구독해, FCM data 의 moimId → 대상 모임 채팅 WebView URL 을 조립(notification-core)하고
// 호출부가 준 onNavigate 로 디스패치한다. 순수 결정(moimId 추출/URL 조립)은 notification-core.ts 에
// 위임하고(vitest), 이 래퍼는 expo I/O 만 담당한다(자동 게이트는 tsc — 실기기 수신/탭은 device-gated AC-5).
import * as Notifications from "expo-notifications";

import { WEB_URL } from "../web-url";
import { buildChatUrl, extractMoimId } from "./notification-core";

/** 탭 대상 URL 로 이동하는 콜백(호출부 소유 — WebView source 갱신/라우터 디스패치). */
export type NavigateToChat = (url: string) => void;

// 알림 응답(탭)에서 대상 모임 채팅 URL 을 해석한다. moimId 가 없거나 조립 실패면 null(앱 열기만).
function resolveTargetUrl(
  response: Notifications.NotificationResponse | null,
): string | null {
  if (!response) {
    return null;
  }
  // data 는 신뢰 불가 페이로드 — notification-core 가 형 검사 후 추출/조립한다.
  const data = response.notification.request.content.data as
    | Record<string, unknown>
    | null
    | undefined;
  const moimId = extractMoimId(data);
  if (!moimId) {
    return null;
  }
  return buildChatUrl(moimId, WEB_URL);
}

/**
 * 알림 탭 핸들러를 등록한다(R-PUSH-007). 포그라운드/백그라운드 탭은 응답 리스너로, 콜드스타트(앱이 꺼진
 * 상태에서 탭으로 기동)는 마지막 응답 조회로 처리한다. 두 경로 모두 대상 URL 이 해석되면 onNavigate 한다.
 *
 * @param onNavigate 대상 모임 채팅 URL 로 이동하는 콜백(앱 열기 + WebView 대상 URL — R-4 최소 구현)
 * @returns 구독 해제 함수(언마운트 시 호출)
 */
export function registerNotificationTapHandler(
  onNavigate: NavigateToChat,
): () => void {
  // 콜드스타트: 앱이 종료된 상태에서 알림 탭으로 기동된 경우 마지막 응답을 1회 처리한다(비차단).
  void Notifications.getLastNotificationResponseAsync()
    .then((last) => {
      const url = resolveTargetUrl(last);
      if (url) {
        onNavigate(url);
      }
    })
    .catch(() => undefined);

  // 포그라운드/백그라운드 탭: 응답 수신마다 대상 URL 로 디스패치한다.
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const url = resolveTargetUrl(response);
      if (url) {
        onNavigate(url);
      }
    },
  );

  return () => subscription.remove();
}
