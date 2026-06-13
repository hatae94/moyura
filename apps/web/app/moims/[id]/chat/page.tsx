// 모임 채팅 화면 (Client Component, SPEC-CHAT-001 REQ-CHAT-006 / AC-5).
//
// @MX:NOTE: 진입 시 (1) 멤버 목록 로드(senderId→nickname 매핑), (2) keyset 히스토리 로드(최신순),
// (3) private 실시간 채널 구독(useChatChannel)을 수행하고 메시지 입력/전송을 제공한다. broadcast 페이로드는
// nickname을 포함하지 않으므로(thin trigger) sender 표시 이름은 멤버 목록에서 클라이언트가 해석한다.
// 미지 senderId(멤버 목록에 없는 sender 수신) → 멤버 목록 재조회 폴백(acceptance 엣지).
"use client";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import {
  type ChatMessage,
  type MoimMember,
  chatErrorMessage,
  loadHistory,
  loadMembers,
  sendMessage,
} from "@/lib/chat/api";
import {
  type ChatBroadcastRecord,
  useChatChannel,
} from "@/lib/chat/useChatChannel";
import { createClient } from "@/lib/supabase/client";

// broadcast 레코드(snake_case) → 표시용 ChatMessage(camelCase)로 정규화한다.
function fromBroadcast(record: ChatBroadcastRecord): ChatMessage {
  return {
    id: String(record.id),
    moimId: record.moim_id,
    senderId: record.sender_id,
    content: record.content,
    createdAt: record.created_at,
  };
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Client Component page는 React use()로 params Promise를 푼다(Next 16).
  const { id: moimId } = use(params);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<MoimMember[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // access_token을 Bearer로 주입하는 api-client(세션마다 토큰이 달라 useMemo로 1회 구성).
  const supabase = useMemo(() => createClient(), []);
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: API_BASE_URL,
        getToken: async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          return session?.access_token;
        },
      }),
    [supabase],
  );

  // senderId → nickname 매핑(멤버 목록에서 해석). 미지 sender는 senderId 일부로 폴백 표시한다.
  const nicknameOf = useCallback(
    (senderId: string): string => {
      const found = members.find((m) => m.userId === senderId);
      return found?.nickname ?? `알 수 없음(${senderId.slice(0, 8)})`;
    },
    [members],
  );

  // 진입 시: 세션 토큰 + 멤버 목록 + 히스토리 로드.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (cancelled) {
          return;
        }
        setAccessToken(session?.access_token ?? null);

        const [memberList, history] = await Promise.all([
          loadMembers(api, moimId),
          loadHistory(api, moimId),
        ]);
        if (cancelled) {
          return;
        }
        setMembers(memberList);
        // 히스토리는 내림차순(최신순) → 화면은 오래된→최신 순으로 보여주기 위해 뒤집는다.
        setMessages([...history.messages].reverse());
      } catch (err) {
        if (!cancelled) {
          setError(chatErrorMessage(err));
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [api, supabase, moimId]);

  // 실시간 수신: 새 메시지를 목록 맨 끝에 추가한다. 미지 senderId면 멤버 목록을 재조회한다(폴백).
  const handleIncoming = useCallback(
    (record: ChatBroadcastRecord) => {
      const message = fromBroadcast(record);
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
      // 멤버 목록에 없는 sender → 재조회 폴백(새로 합류한 멤버 반영).
      setMembers((prev) => {
        if (prev.some((m) => m.userId === message.senderId)) {
          return prev;
        }
        void loadMembers(api, moimId)
          .then(setMembers)
          .catch(() => {
            /* 폴백 실패는 무시(닉네임만 미해석, 메시지는 표시됨) */
          });
        return prev;
      });
    },
    [api, moimId],
  );

  // private 채널 구독(토큰 확보 후). 트리거 broadcast INSERT를 수신해 handleIncoming으로 전달한다.
  useChatChannel(moimId, accessToken, handleIncoming);

  // 자동 스크롤(새 메시지/초기 로드 시 맨 아래로).
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const content = input.trim();
    if (!content) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      await sendMessage(api, moimId, content);
      // 전송 성공 시 입력만 비운다. 화면 반영은 실시간 구독 수신(self broadcast)에 맡긴다(중복은 id로 dedupe).
      setInput("");
    } catch (err) {
      setError(chatErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex flex-1 flex-col p-4 gap-3">
      <h1 className="text-lg font-semibold">모임 채팅</h1>

      {error ? (
        <div
          role="alert"
          className="bg-red-50 text-red-600 px-3 py-2 rounded text-sm"
        >
          {error}
        </div>
      ) : null}

      <ul className="flex-1 overflow-y-auto flex flex-col gap-2">
        {messages.map((m) => (
          <li key={m.id} className="text-sm">
            <span className="font-medium">{nicknameOf(m.senderId)}</span>
            <span className="text-gray-400 text-xs ml-2">
              {new Date(m.createdAt).toLocaleTimeString()}
            </span>
            <p className="text-gray-800">{m.content}</p>
          </li>
        ))}
        <div ref={bottomRef} />
      </ul>

      <form onSubmit={handleSend} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          placeholder="메시지를 입력하세요"
          className="flex-1 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={pending}
          className="bg-blue-600 text-white px-4 py-2 rounded font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {pending ? "전송 중..." : "전송"}
        </button>
      </form>
    </main>
  );
}
