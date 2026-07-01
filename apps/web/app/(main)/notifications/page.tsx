// 인앱 알림 탭 (Notifications M5 — 플레이스홀더 교체).
//
// 서버 컴포넌트: 세션 가드(requireNamedSession, layout 과 React cache 로 dedup)로 sub/토큰을 얻고, 첫 페이지를
// 서버에서 fetch 해 클라 <NotificationFeed> 에 시드로 넘긴다. 조회 실패는 탭을 절대 크래시하지 않는다 —
// 빈 리스트로 폴백해 빈 상태를 보이고, 이후 사용자가 재진입/새로고침하면 자가 치유한다(배지 fetch 폴백과 동형).
import { createApiClient } from "@moyura/api-client";

import { requireNamedSession } from "@/lib/auth/require-named-session";
import { API_BASE_URL } from "@/lib/env";
import { listNotifications, type NotificationDto } from "@/lib/notifications/api";

import { NotificationFeed } from "./notification-feed";

export default async function NotificationsPage() {
  const { session } = await requireNamedSession();

  let initialItems: NotificationDto[] = [];
  let initialNextCursor: string | null = null;
  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    const page = await listNotifications(api, { limit: 20 });
    initialItems = page.items;
    initialNextCursor = page.nextCursor;
  } catch (err) {
    // 비차단 폴백: 첫 페이지 조회 실패 시 빈 리스트로 빈 상태를 렌더한다(토큰/민감정보 미노출).
    console.error("[moyura/web] 알림 첫 페이지 조회 실패 — 빈 상태로 폴백", err);
  }

  return (
    <NotificationFeed
      initialItems={initialItems}
      initialNextCursor={initialNextCursor}
      accessToken={session.access_token}
      currentUserId={session.user.id}
    />
  );
}
