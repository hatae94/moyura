// 모임 경비 변경 실시간 구독 훅 (SPEC-MOIM-EXPENSE).
//
// usePollChannel 패턴을 미러한다 — 같은 private 채널 `moim:{id}` 를 구독하되
// 'expense_change' 이벤트만 듣는다(교차 수신 방지). 수신 자체를 "경비 변경됨"
// 신호로 보고 onChange(router.refresh)를 호출한다 — 집계/정산은 서버 재조회로 갱신한다.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/**
 * 모임 private 실시간 채널을 구독하고, 'expense_change' broadcast 수신 시 onChange 를 호출한다.
 *
 * @param moimId 구독 대상 모임 id(채널 토픽 = `moim:{moimId}`)
 * @param accessToken realtime.setAuth 에 주입할 access_token(없으면 구독하지 않음 — RLS 거부 방지)
 * @param onChange 경비 변경 신호 수신 콜백(소비 측이 router.refresh 등으로 서버 재조회). 안정 참조 권장(useCallback).
 */
export function useExpenseChannel(
  moimId: string,
  accessToken: string | null,
  onChange: () => void,
): void {
  useEffect(() => {
    // 토큰 없으면 구독하지 않는다(private 채널은 인가 토큰 없이 RLS 거부 — 무의미한 연결 방지).
    if (!accessToken) {
      return;
    }

    const supabase = createClient();

    // private 채널 구독 인가 토큰을 명시 주입한다(SSR 쿠키 세션 자동 전달 미보장 대비).
    supabase.realtime.setAuth(accessToken);

    const channel = supabase
      .channel(`moim:${moimId}`, { config: { private: true } })
      .on("broadcast", { event: "expense_change" }, () => {
        // 경량 신호 — 페이로드 내용은 보지 않고 "경비 변경됨"으로만 해석해 서버 재조회를 트리거한다.
        onChange();
      })
      .subscribe();

    // 언마운트/의존성 변경 시 채널 정리(중복 구독·메모리 누수 방지).
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [moimId, accessToken, onChange]);
}
