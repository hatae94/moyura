// 인앱 알림 API 헬퍼 (Notifications M4b 배지 + M5 웹 알림 탭).
//
// lib/schedule/api.ts 의 구체-경로 패턴을 미러한다(api.request(path as never)).
// M4b 는 unread-count 만 노출했고, M5(웹 알림 탭)가 목록(listNotifications) + 읽음(markRead)을 추가한다.
import { type ApiClient } from "@moyura/api-client";

// ─────────────────────────────────────────────
// 타입 정의 (백엔드 notification-response.dto 미러)
// ─────────────────────────────────────────────

/** GET /notifications/unread-count 응답. 안읽음 알림 개수. */
export interface UnreadCountResponse {
  count: number;
}

/** 알림 유발자 표시 정보(NotificationActorDto). actorId 가 있을 때만 채워진다(무행위자 알림이면 null). */
export interface NotificationActor {
  id: string;
  /** 모임별 표시 이름(해석 실패 시 백엔드가 '알 수 없음' 기본값). */
  nickname: string;
}

/**
 * 알림 단건 DTO(NotificationDto 미러). BigInt id 는 문자열, 날짜는 ISO-8601 문자열이다.
 * data 는 타입별 미리보기 + 딥링크 타깃(자유 형식 JSON)이라 unknown 으로 받아 표현 계층에서 안전 추출한다:
 *   - schedule.confirmed: { startsAt }, poll.created/closed: { pollId, question },
 *     expense.added: { expenseId, amount, category }, settlement.*: { amount }, owner.delegated: { newOwnerId }
 * moimName/actor 는 응답 시점 배치 해석 결과이며, 대상이 사라졌으면 각각 null / fallback 닉네임이 된다.
 */
export interface NotificationDto {
  id: string;
  type: string;
  moimId: string;
  moimName: string | null;
  actor: NotificationActor | null;
  data: unknown;
  readAt: string | null;
  createdAt: string;
}

/** GET /notifications 응답. nextCursor 가 null 이면 더 오래된 페이지가 없다(무한 스크롤 종료). */
export interface NotificationListResponse {
  items: NotificationDto[];
  nextCursor: string | null;
}

/** POST /notifications/read 요청 바디. ids 지정이면 그 중 미읽음만, all:true 면 전체 미읽음을 읽음 처리한다. */
export type MarkReadRequest = { ids?: string[] } | { all?: true };

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

/**
 * 인증 사용자의 알림 피드 한 페이지를 조회한다(GET /notifications?cursor=&limit=). keyset 최신순.
 * 인가는 백엔드가 recipientId===sub 로 강제하므로 교차 조회는 구조적으로 불가하다(getUnreadCount 와 동일).
 * cursor 미지정 = 첫 페이지, 지정 = 그 커서보다 오래된 페이지. limit 기본 20 / 상한 50(백엔드). 실패 시 ApiError 전파.
 *
 * @param api Bearer 토큰이 배선된 ApiClient(서버: session.access_token / 클라: 전달받은 access token)
 * @param opts cursor(이전 페이지 nextCursor) + limit(페이지 크기)
 */
export async function listNotifications(
  api: ApiClient,
  opts: { cursor?: string; limit?: number } = {},
): Promise<NotificationListResponse> {
  const params = new URLSearchParams();
  if (opts.cursor) {
    params.set("cursor", opts.cursor);
  }
  if (opts.limit !== undefined) {
    params.set("limit", String(opts.limit));
  }
  const qs = params.toString();
  const path = qs ? `/notifications?${qs}` : "/notifications";
  return (await api.request(path as never, "get")) as NotificationListResponse;
}

/**
 * 알림을 읽음 처리한다(POST /notifications/read). body { ids:[...] } = 지정 건, { all:true } = 전체 미읽음.
 * 백엔드가 where 에 recipientId=sub 를 항상 포함해 남의 알림은 갱신 대상에서 구조적으로 제외한다. 실패 시 ApiError 전파
 * (호출부가 낙관적 UI 를 롤백하거나 무시할지 결정 — 배지/피드는 다음 refresh 에서 자가 치유).
 */
export async function markRead(
  api: ApiClient,
  body: MarkReadRequest,
): Promise<void> {
  await api.request("/notifications/read" as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
