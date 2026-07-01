// 모임 일정 조율 변경 실시간 구독 훅 (SPEC-SCHEDULE-001).
//
// useExpenseChannel 패턴을 미러한다 — 같은 private 채널 `moim:{id}` 를 구독하되
// 'schedule_change' 이벤트만 듣는다(교차 수신 방지). 수신 자체를 "일정 변경됨" 신호로
// 보고 onChange(router.refresh)를 호출한다 — 그리드/히트맵/확정 상태는 서버 재조회로 갱신한다.
//
// 백엔드는 schedule_slot 이 아니라 schedule_event 에만 트리거를 두고, 슬롯 변경 시 event 를 touch 한다.
// 따라서 멤버가 슬롯 수십 개를 한 번에 교체해도 'schedule_change' 는 정확히 1회만 도착한다(방송 폭주 없음).
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * 모임 private 실시간 채널을 구독하고, 'schedule_change' broadcast 수신 시 onChange 를 호출한다.
 *
 * @param moimId 구독 대상 모임 id(채널 토픽 = `moim:{moimId}`)
 * @param accessToken realtime.setAuth 에 주입할 access_token(없으면 구독하지 않음 — RLS 거부 방지)
 * @param onChange 일정 변경 신호 수신 콜백(소비 측이 router.refresh 등으로 서버 재조회). 안정 참조 권장(useCallback).
 */
export function useScheduleChannel(
  moimId: string,
  accessToken: string | null,
  onChange: () => void,
): void {
  useEffect(() => {
    if (!accessToken) {
      return;
    }

    const supabase = createClient();
    supabase.realtime.setAuth(accessToken);

    const channel = supabase
      .channel(`moim:${moimId}`, { config: { private: true } })
      .on("broadcast", { event: "schedule_change" }, () => {
        onChange();
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [moimId, accessToken, onChange]);
}
