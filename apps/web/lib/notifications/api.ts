// 인앱 알림 API 헬퍼 (Notifications M4b — 미읽음 배지).
//
// lib/schedule/api.ts 의 구체-경로 패턴을 미러한다(api.request(path as never)).
// M4b 범위는 배지 실카운트뿐이므로 unread-count 만 노출한다 — 목록/읽음 헬퍼는 M5(웹 알림 탭)가 추가한다.
import { type ApiClient } from "@moyura/api-client";

// ─────────────────────────────────────────────
// 타입 정의 (백엔드 GET /notifications/unread-count 응답 미러)
// ─────────────────────────────────────────────

/** GET /notifications/unread-count 응답. 안읽음 알림 개수. */
export interface UnreadCountResponse {
  count: number;
}

// ─────────────────────────────────────────────
// API 헬퍼
// ─────────────────────────────────────────────

/**
 * 인증 사용자의 안읽음 알림 개수를 조회한다(GET /notifications/unread-count).
 * 인가는 백엔드가 recipientId===sub 로 강제하므로 교차 조회는 구조적으로 불가하다.
 * 토큰은 api 클라이언트의 getToken 공급자가 Bearer 헤더로 주입한다(R-D4). 실패 시 ApiError 를 전파한다
 * (호출부가 배지 UX 비차단을 위해 0 으로 폴백/무시할지 결정).
 *
 * @param api Bearer 토큰이 배선된 ApiClient(서버: session.access_token / 클라: 전달받은 access token)
 * @returns 안읽음 개수(정수)
 */
export async function getUnreadCount(api: ApiClient): Promise<number> {
  const result = (await api.request(
    "/notifications/unread-count" as never,
    "get",
  )) as UnreadCountResponse;
  return result.count;
}
