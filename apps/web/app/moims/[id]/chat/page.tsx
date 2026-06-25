// 모임 채팅 화면 (Client Component, SPEC-CHAT-001 REQ-CHAT-006 / AC-5).
//
// @MX:NOTE: 진입 시 (1) 멤버 목록 로드(senderId→nickname 매핑), (2) keyset 히스토리 로드(최신순),
// (3) private 실시간 채널 구독(useChatChannel)을 수행하고 메시지 입력/전송을 제공한다. broadcast 페이로드는
// nickname을 포함하지 않으므로(thin trigger) sender 표시 이름은 멤버 목록에서 클라이언트가 해석한다.
// 미지 senderId(멤버 목록에 없는 sender 수신) → 멤버 목록 재조회 폴백(acceptance 엣지).
//
// @MX:NOTE: 시각은 Meetup 디자인 시스템(모임 상세 /home/[id])과 동일한 시맨틱 토큰(bg-primary 오렌지,
// bg-card/bg-muted, text-muted-foreground, border-border, rounded-2xl, lucide 아이콘)으로 통일한다.
// own/other 버블 분기는 세션 user.id(supabase.auth.getSession)와 message.senderId 비교로 결정한다
// (추가 백엔드 호출 없음 — 진입 시 이미 가져온 세션의 user.id 사용).
"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Send } from "lucide-react";

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

// 타임스탬프 표시 — HH:MM(기존 toLocaleTimeString 접근 유지, 초 단위는 생략해 컴팩트하게).
function formatTime(createdAt: string): string {
  return new Date(createdAt).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 렌더용 메시지 행: 그룹핑 메타(연속 발신자 묶음의 첫 메시지 여부)를 메시지에 부착한다.
interface RenderRow {
  message: ChatMessage;
  // own(현재 사용자) 메시지 여부 — 우측 정렬 + 오렌지 버블 분기 기준.
  isOwn: boolean;
  // 같은 발신자의 연속 묶음에서 첫 메시지인지(닉네임/타임스탬프를 묶음당 1회만 표시).
  isGroupStart: boolean;
}

// 메시지 리스트를 렌더 행으로 가공한다(연속 발신자 그룹핑). 데이터 자체는 변형하지 않는다.
function toRenderRows(
  messages: ChatMessage[],
  currentUserId: string | null,
): RenderRow[] {
  return messages.map((message, index) => {
    const prev = messages[index - 1];
    const isGroupStart = !prev || prev.senderId !== message.senderId;
    return {
      message,
      isOwn: currentUserId != null && message.senderId === currentUserId,
      isGroupStart,
    };
  });
}

// 상단 sticky 헤더 — ← 뒤로(모임 상세로 복귀) + "모임 채팅" 타이틀. 모임 상세 헤더와 동일 토큰.
function ChatHeader({ moimId }: { moimId: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
      <Link
        href={`/home/${moimId}`}
        aria-label="모임 상세로 돌아가기"
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
      >
        <ChevronLeft size={22} />
      </Link>
      <h1 className="text-lg font-bold text-foreground">모임 채팅</h1>
    </header>
  );
}

// 단일 메시지 버블 — own(오렌지 우측 정렬) / other(중립 좌측 정렬 + 닉네임). 그룹 첫 메시지에만 메타 표시.
function MessageBubble({
  row,
  senderName,
}: {
  row: RenderRow;
  senderName: string;
}) {
  const { message, isOwn, isGroupStart } = row;
  const time = formatTime(message.createdAt);

  return (
    <li
      className={`flex flex-col ${isOwn ? "items-end" : "items-start"} ${
        isGroupStart ? "mt-3" : "mt-0.5"
      }`}
    >
      {/* 상대 메시지의 그룹 첫 줄에만 발신자 닉네임 표시(own은 닉네임 불필요). */}
      {!isOwn && isGroupStart ? (
        <span className="mb-1 px-1 text-xs font-medium text-muted-foreground">
          {senderName}
        </span>
      ) : null}

      <div
        className={`flex max-w-[78%] items-end gap-1.5 ${
          isOwn ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
            isOwn
              ? "rounded-tr-md bg-primary text-primary-foreground"
              : "rounded-tl-md bg-muted text-card-foreground"
          }`}
        >
          {message.content}
        </div>
        {/* 타임스탬프 — 버블 옆 컴팩트 표시. */}
        <time className="shrink-0 pb-0.5 text-[11px] text-muted-foreground">
          {time}
        </time>
      </div>
    </li>
  );
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Client Component page는 React use()로 params Promise를 푼다(Next 16).
  const { id: moimId } = use(params);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
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

  // 진입 시: 세션(토큰 + user.id) + 멤버 목록 + 히스토리 로드.
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
        // own/other 분기 기준: 이미 가져온 세션의 user.id를 그대로 사용(추가 백엔드 호출 없음).
        setCurrentUserId(session?.user?.id ?? null);

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

  // 렌더 행(own/other + 그룹 시작 메타) 가공. 메시지/세션 변화 시에만 재계산한다.
  const rows = useMemo(
    () => toRenderRows(messages, currentUserId),
    [messages, currentUserId],
  );

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

  const canSend = input.trim().length > 0 && !pending;

  return (
    // [예외] 채팅만 문서 스크롤이 아닌 내부 스크롤 고정 레이아웃을 유지한다 — 메시지 리스트(아래 ul 의
    // overflow-y-auto, bottomRef 자동 하단 스크롤) + 하단 고정 입력바 UX 가 문서 스크롤에서 깨지기 때문이다
    // (입력 중 툴바 접힘/리플로, 입력바 위치 흔들림, 자동 스크롤 충돌). h-dvh-fixed(height:100dvh, vh 폴백 —
    // globals.css)로 라이브 뷰포트에 고정하고, min-h-0 로 자식 ul 이 높이를 부여받아 내부 스크롤되게 한다.
    // moims 그룹은 하단 탭바가 없으므로 탭바 회피 여백은 불필요. 네이티브 WebView 에서도 dvh==전체 높이로 안전.
    <main className="flex h-dvh-fixed min-h-0 flex-col bg-background">
      <ChatHeader moimId={moimId} />

      {error ? (
        <div
          role="alert"
          className="mx-3 mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {error}
        </div>
      ) : null}

      {/* 스크롤 영역: 남은 높이를 채우고 자동으로 맨 아래로 스크롤한다. */}
      <ul className="flex flex-1 flex-col overflow-y-auto px-3 pb-3 pt-1">
        {rows.length > 0 ? (
          rows.map((row) => (
            <MessageBubble
              key={row.message.id}
              row={row}
              senderName={nicknameOf(row.message.senderId)}
            />
          ))
        ) : (
          <li className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="font-medium text-foreground">아직 메시지가 없어요</p>
            <p className="text-sm text-muted-foreground">
              첫 메시지를 보내보세요.
            </p>
          </li>
        )}
        <div ref={bottomRef} />
      </ul>

      {/* 하단 sticky 입력바: 둥근 입력 + 오렌지 전송 버튼(빈 입력/전송 중 비활성). */}
      <form
        onSubmit={handleSend}
        className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background/95 px-3 py-3 backdrop-blur"
      >
        <input
          type="text"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          placeholder="메시지를 입력하세요"
          aria-label="메시지 입력"
          className="min-w-0 flex-1 rounded-full border border-border bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={pending ? "전송 중" : "전송"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          <Send size={18} aria-hidden="true" />
        </button>
      </form>
    </main>
  );
}
