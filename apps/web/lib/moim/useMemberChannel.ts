// 모임 멤버 변경 실시간 구독 훅.
//
// usePollChannel 패턴을 미러한다 — 같은 private 채널 `moim:{id}` 를 구독하되,
// 'member_change' 이벤트만 듣는다(교차 수신 방지).
// DB 트리거가 싣는 페이로드: { op: 'INSERT' | 'UPDATE' | 'DELETE', userId }.
// INSERT/DELETE(참여·강퇴·탈퇴) → 멤버 목록 갱신 신호, UPDATE(role 변경) → 방장 위임 신호.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

/** member_change 브로드캐스트 페이로드 구조 */
export interface MemberChangePayload {
  op: string;
  userId: string;
}

/**
 * 모임 private 실시간 채널을 구독하고, 'member_change' broadcast 수신 시 onEvent 를 호출한다.
 *
 * @param moimId 구독 대상 모임 id(채널 토픽 = `moim:{moimId}`)
 * @param accessToken realtime.setAuth 에 주입할 access_token(없으면 구독하지 않음 — RLS 가 거부하므로 무의미)
 * @param onEvent 멤버 변경 페이로드 수신 콜백. 안정 참조 권장(useCallback).
 */
export function useMemberChannel(
  moimId: string,
  accessToken: string | null,
  onEvent: (e: MemberChangePayload) => void,
): void {
  useEffect(() => {
    // 토큰이 없으면 구독하지 않는다(private 채널은 인가 토큰 없이는 RLS 가 거부 — 무의미한 연결 방지).
    if (!accessToken) {
      return;
    }

    const supabase = createClient();

    // private 채널 구독 인가 토큰을 명시 주입한다(SSR 쿠키 세션 자동 전달 미보장 대비 — usePollChannel 동일).
    supabase.realtime.setAuth(accessToken);

    const channel = supabase
      .channel(`moim:${moimId}`, { config: { private: true } })
      .on("broadcast", { event: "member_change" }, ({ payload }) => {
        // 페이로드 구조: { op: 'INSERT' | 'UPDATE' | 'DELETE', userId }
        // 타입 단언: 브로드캐스트 payload 는 Record<string, unknown> 이므로 명시 캐스팅한다.
        onEvent(payload as MemberChangePayload);
      })
      .subscribe();

    // 언마운트/의존성 변경 시 채널 정리(중복 구독·메모리 누수 방지).
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [moimId, accessToken, onEvent]);
}
