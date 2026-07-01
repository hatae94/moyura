// 인앱 알림 미읽음 배지 실시간 구독 훅 (Notifications M4b).
//
// useScheduleChannel 패턴을 미러한다 — 같은 private 채널 메커니즘을 쓰되 두 가지만 다르다:
//   (1) 토픽 = `user:${sub}` (모임 무관 per-user 전역 1구독, moim:{id} 아님)
//   (2) 이벤트 = 'notification_new' (수신 자체를 "새 알림 도착" 신호로 보고 onSignal 호출)
//
// 백엔드는 notification AFTER INSERT row 트리거로 `realtime.send(thin, 'notification_new', 'user:'||recipient_id)`
// 를 발화한다. fan-out N행은 각기 다른 user:{id} 토픽으로 가므로 이 사용자는 자기 알림당 정확히 1회만 수신한다
// (방송 폭주 없음). realtime.messages RLS 가 `topic()=='user:'||auth.uid()` 로 자기 토픽만 허용한다.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * 사용자 private 실시간 채널(`user:{sub}`)을 구독하고, 'notification_new' broadcast 수신 시 onSignal 을 호출한다.
 *
 * @param sub 구독 대상 사용자 sub(채널 토픽 = `user:{sub}` — 가드-검증 sub 와 일치해야 RLS 통과)
 * @param accessToken realtime.setAuth 에 주입할 access_token(없으면 구독하지 않음 — RLS 거부 방지)
 * @param onSignal 새 알림 신호 수신 콜백(소비 측이 unread-count 재조회 등). 안정 참조 권장(useCallback).
 */
export function useNotificationChannel(
  sub: string,
  accessToken: string | null,
  onSignal: () => void,
): void {
  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const supabase = createClient();
    supabase.realtime.setAuth(accessToken);

    const channel = supabase
      .channel(`user:${sub}`, { config: { private: true } })
      .on("broadcast", { event: "notification_new" }, () => {
        onSignal();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [sub, accessToken, onSignal]);
}
