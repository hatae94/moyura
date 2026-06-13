// 모임 채팅 실시간 구독 훅 (SPEC-CHAT-001 REQ-CHAT-006 / AC-5).
//
// @MX:NOTE: 트리거가 broadcast하는 페이로드는 chat_message 레코드만 운반한다(nickname 미포함 — thin trigger,
// 게이트 결정). sender 표시 이름은 소비 측(page.tsx)이 멤버 목록에서 senderId→nickname으로 해석한다.
//
// @MX:NOTE: setAuth 설계 — private 채널 구독 인가는 realtime.messages RLS(멤버십 조회)가 담당한다.
// SSR 쿠키 세션에서는 realtime이 토큰을 자동 전달하지 못할 수 있어, 구독 직전 supabase.realtime.setAuth(token)로
// access_token을 명시 주입한다(research §7c). 토큰 없이 구독하면 RLS가 거부해 메시지를 받지 못한다.
"use client";

import { useEffect } from "react";

import { createClient } from "@/lib/supabase/client";

// broadcast로 수신하는 메시지 레코드(백엔드 chat_message row의 컬럼명 = snake_case).
// 트리거가 realtime.broadcast_changes로 NEW row를 그대로 운반하므로 DB 컬럼명을 따른다.
export interface ChatBroadcastRecord {
  id: string | number;
  moim_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

// broadcast INSERT 이벤트 페이로드(realtime-js). record에 새 메시지 row가 담긴다.
interface BroadcastInsertPayload {
  payload?: { record?: ChatBroadcastRecord };
}

/**
 * 모임 private 실시간 채널을 구독하고, 수신한 INSERT broadcast를 onMessage로 전달한다.
 *
 * @param moimId 구독 대상 모임 id(채널 토픽 = `moim:{moimId}`)
 * @param accessToken realtime.setAuth에 주입할 access_token(없으면 구독하지 않음 — RLS가 거부하므로 무의미)
 * @param onMessage 수신한 메시지 레코드 콜백(소비 측이 senderId→nickname 해석 후 렌더)
 */
export function useChatChannel(
  moimId: string,
  accessToken: string | null,
  onMessage: (record: ChatBroadcastRecord) => void,
): void {
  useEffect(() => {
    // 토큰이 없으면 구독하지 않는다(private 채널은 인가 토큰 없이는 RLS가 거부 — 무의미한 연결 방지).
    if (!accessToken) {
      return;
    }

    const supabase = createClient();

    // private 채널 구독 인가 토큰을 명시 주입한다(SSR 쿠키 세션 자동 전달 미보장 대비).
    supabase.realtime.setAuth(accessToken);

    const channel = supabase
      .channel(`moim:${moimId}`, { config: { private: true } })
      .on(
        "broadcast",
        { event: "INSERT" },
        ({ payload }: BroadcastInsertPayload) => {
          // 트리거 페이로드의 record(새 메시지 row)만 소비한다. 비정상 페이로드는 무시한다.
          const record = payload?.record;
          if (record) {
            onMessage(record);
          }
        },
      )
      .subscribe();

    // 언마운트/의존성 변경 시 채널 정리(중복 구독·메모리 누수 방지).
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [moimId, accessToken, onMessage]);
}
