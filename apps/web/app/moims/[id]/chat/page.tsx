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
import { Ban, ChevronLeft, Send, Siren } from "lucide-react";

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
import { createBlock, createReport, listBlocks } from "@/lib/safety/api";
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
// SPEC-SAFETY-001 T-009: 상대 메시지에는 신고 버튼을 노출한다(v1 신고 진입점은 채팅 말풍선 한정). own 은 미노출.
function MessageBubble({
  row,
  senderName,
  onReport,
}: {
  row: RenderRow;
  senderName: string;
  /** 상대 메시지 신고 진입(own 메시지는 undefined — 자기 신고 불가). */
  onReport?: (message: ChatMessage) => void;
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
        className={`group flex max-w-[78%] items-end gap-1.5 ${
          isOwn ? "flex-row-reverse" : "flex-row"
        }`}
      >
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
            isOwn
              ? "rounded-tr-md bg-gradient-brand text-white shadow-primary/20"
              : "rounded-tl-md bg-muted text-card-foreground"
          }`}
        >
          {message.content}
        </div>
        {/* 타임스탬프 — 버블 옆 컴팩트 표시. */}
        <time className="shrink-0 pb-0.5 text-[11px] text-muted-foreground">
          {time}
        </time>
        {/* 상대 메시지 신고 진입(own 미노출). 항상 존재하되 hover/focus 시 드러난다(컴팩트 UI). */}
        {!isOwn && onReport ? (
          <button
            type="button"
            aria-label={`${senderName}님의 메시지 신고`}
            title="신고"
            onClick={() => onReport(message)}
            className="shrink-0 rounded-full p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted focus:opacity-100 focus:outline-none group-hover:opacity-100"
          >
            <Siren size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </li>
  );
}

// 채팅 리스트 초기 로딩 스켈레톤 — 좌/우 번갈아 폭이 다른 메시지 버블 자리표시자(.skeleton 시머).
// 히스토리 fetch 가 끝날 때까지 표시되어, messages 초기값([])로 인한 빈 상태 flash 를 대체한다.
function ChatLoadingSkeleton() {
  const rows: Array<{ own: boolean; w: string }> = [
    { own: false, w: "w-40" },
    { own: false, w: "w-24" },
    { own: true, w: "w-32" },
    { own: false, w: "w-44" },
    { own: true, w: "w-20" },
    { own: false, w: "w-36" },
  ];
  return (
    <li
      className="flex flex-1 flex-col gap-3 py-2"
      aria-busy="true"
      aria-label="채팅 불러오는 중"
    >
      {rows.map((r, i) => (
        <div key={i} className={`flex ${r.own ? "justify-end" : "justify-start"}`}>
          <div
            className={`skeleton h-9 ${r.w} rounded-2xl ${
              r.own ? "rounded-tr-md" : "rounded-tl-md"
            }`}
          />
        </div>
      ))}
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
  // 초기 히스토리 로딩 여부. true 동안은 로딩 스켈레톤을, 로드 완료 후에만 빈 상태("메시지 없음")를 보여준다
  // — messages 초기값이 []라 로딩 중에도 빈 상태가 flash 되던 문제를 막는다.
  const [loading, setLoading] = useState(true);

  // 뷰어 측 숨김 대상 userId 집합(SPEC-SAFETY-001 REQ-FLT-001 클라이언트 경로).
  // 초기값은 GET /blocks(영속 차단)로 시딩하고, 세션 중 신고/차단 액션 시 즉시 추가한다. 서버 히스토리 필터
  // (T-005 getHistory)는 block∪report union 을 이미 적용하므로 재조회 시 report 숨김도 반영된다. 클라이언트는
  // GET /blocks(block 만)로 영속 차단을 알 수 있고, 신고 기반 숨김은 union 엔드포인트가 없어 이번-세션 액션분만
  // 실시간 드롭에 반영된다(한계 — 이전 세션 신고분의 실시간 신규 메시지는 서버 히스토리 필터가 재조회 시 커버).
  const [hiddenUserIds, setHiddenUserIds] = useState<Set<string>>(new Set());
  // handleIncoming(실시간 콜백)이 최신 hidden 집합을 stale-closure 없이 읽도록 ref 로도 미러한다.
  const hiddenRef = useRef<Set<string>>(hiddenUserIds);
  useEffect(() => {
    hiddenRef.current = hiddenUserIds;
  }, [hiddenUserIds]);

  // 신고·차단 모더레이션 플로우 상태:
  //   { step: "report" }  — 사유 입력 폼(대상 메시지의 sender 를 신고)
  //   { step: "confirmBlock" } — 신고 성공 후 "차단할까요?" 유도(수락 시에만 POST /blocks)
  const [moderation, setModeration] = useState<
    | { step: "report"; message: ChatMessage }
    | { step: "confirmBlock"; message: ChatMessage }
    | null
  >(null);
  const [reportReason, setReportReason] = useState("");
  const [moderationPending, setModerationPending] = useState(false);
  const [moderationError, setModerationError] = useState<string | null>(null);

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

        // 멤버·히스토리와 함께 차단 목록(GET /blocks)도 로드해 실시간 필터 집합을 시딩한다.
        // 차단 목록 조회 실패는 빈 집합으로 폴백한다(채팅 진입을 막지 않음 — 서버 히스토리 필터가 1차 방어).
        const [memberList, history, blocks] = await Promise.all([
          loadMembers(api, moimId),
          loadHistory(api, moimId),
          listBlocks(api).catch(() => []),
        ]);
        if (cancelled) {
          return;
        }
        setMembers(memberList);
        setHiddenUserIds(new Set(blocks.map((b) => b.blockedUserId)));
        // 히스토리는 내림차순(최신순) → 화면은 오래된→최신 순으로 보여주기 위해 뒤집는다.
        setMessages([...history.messages].reverse());
      } catch (err) {
        if (!cancelled) {
          setError(chatErrorMessage(err));
        }
      } finally {
        // 성공/실패 무관하게 초기 로딩 종료 — 이후에야 빈 상태/에러 판정이 유효하다.
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [api, supabase, moimId]);

  // 실시간 수신: 새 메시지를 목록 맨 끝에 추가한다. 미지 senderId면 멤버 목록을 재조회한다(폴백).
  // SPEC-SAFETY-001 REQ-FLT-001(클라): append 전에 hidden 발신자면 드롭한다(서버 히스토리 필터와 짝 —
  // 리로드/실시간 양경로 정합). 미지 발신자 멤버 재조회 폴백 경로도 동일하게 hidden 검사 후에만 진행한다.
  const handleIncoming = useCallback(
    (record: ChatBroadcastRecord) => {
      const message = fromBroadcast(record);
      // 차단/신고한 발신자의 실시간 신규 메시지는 화면에 추가하지 않는다(내 화면에서만 숨김 — per-viewer).
      if (hiddenRef.current.has(message.senderId)) {
        return;
      }
      setMessages((prev) =>
        prev.some((m) => m.id === message.id) ? prev : [...prev, message],
      );
      // 멤버 목록에 없는 sender → 재조회 폴백(새로 합류한 멤버 반영). hidden 발신자는 위에서 이미 반환됐다.
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

  // ── 신고·차단 모더레이션 (SPEC-SAFETY-001 REQ-RPT-002/003, REQ-FLT-001) ──────────
  // hidden 집합에 대상 sender 를 추가하고 히스토리를 재조회한다(setMessages([]) 후 서버 union 필터 반영분 로드).
  // React Query 부재라 수동 무효화 — 서버 getHistory 가 block∪report 를 이미 필터하므로 재조회분엔 대상 UGC 부재.
  const applyHiddenAndReload = useCallback(
    async (senderId: string) => {
      setHiddenUserIds((prev) => {
        const next = new Set(prev);
        next.add(senderId);
        return next;
      });
      // 잔존 메시지 즉시 제거 후 서버 재조회(서버가 union 필터 적용 — 대상 발신자 메시지 부재).
      setMessages([]);
      try {
        const history = await loadHistory(api, moimId);
        setMessages([...history.messages].reverse());
      } catch {
        // 재조회 실패는 무시 — hidden 집합은 이미 갱신됐고, 다음 진입/실시간에서 자가 치유된다.
      }
    },
    [api, moimId],
  );

  function openReport(message: ChatMessage) {
    setModeration({ step: "report", message });
    setReportReason("");
    setModerationError(null);
  }

  function closeModeration() {
    setModeration(null);
    setReportReason("");
    setModerationError(null);
  }

  // 신고 제출: POST /reports(report 만 — block 미생성). 성공 시 신고자 측 즉시 숨김 + "차단할까요?" 유도로 전환.
  async function submitReport() {
    if (!moderation || moderation.step !== "report") {
      return;
    }
    const reason = reportReason.trim();
    if (!reason) {
      setModerationError("신고 사유를 입력해 주세요.");
      return;
    }
    const target = moderation.message;
    setModerationPending(true);
    setModerationError(null);
    try {
      await createReport(api, {
        targetUserId: target.senderId,
        moimId,
        reason,
        contentType: "chat_message",
        contentId: target.id,
      });
      // 신고 성공: 신고자 측 즉시 숨김(report 소스) — hidden 추가 + 재조회. 이어서 차단 유도로 전환.
      await applyHiddenAndReload(target.senderId);
      setModeration({ step: "confirmBlock", message: target });
    } catch (err) {
      setModerationError(chatErrorMessage(err));
    } finally {
      setModerationPending(false);
    }
  }

  // 차단 유도 수락: 이 시점에 비로소 POST /blocks(REQ-RPT-003). 거부는 report 숨김만 유지하고 block 미생성.
  async function acceptBlock() {
    if (!moderation || moderation.step !== "confirmBlock") {
      return;
    }
    const target = moderation.message;
    setModerationPending(true);
    setModerationError(null);
    try {
      await createBlock(api, target.senderId);
      // 차단은 hidden 집합에 이미 포함(신고 시 추가됨) — 재확인만 하고 플로우 종료.
      await applyHiddenAndReload(target.senderId);
      closeModeration();
    } catch (err) {
      setModerationError(chatErrorMessage(err));
    } finally {
      setModerationPending(false);
    }
  }

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
          className="animate-fade-in-down mx-3 mt-3 rounded-2xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {/* 스크롤 영역: 남은 높이를 채우고 자동으로 맨 아래로 스크롤한다.
          렌더 우선순위: (1) 초기 로딩 중 → 로딩 스켈레톤(빈 상태 flash 방지), (2) 메시지 있음 → 버블,
          (3) 로딩 끝 + 에러 → 리스트는 비우고 상단 alert 만(빈 상태 문구는 오해 소지라 숨김),
          (4) 로딩 끝 + 메시지 없음 → "아직 메시지가 없어요" 빈 상태. */}
      <ul className="flex flex-1 flex-col overflow-y-auto px-3 pb-3 pt-1">
        {loading ? (
          <ChatLoadingSkeleton />
        ) : rows.length > 0 ? (
          rows.map((row) => (
            <MessageBubble
              key={row.message.id}
              row={row}
              senderName={nicknameOf(row.message.senderId)}
              onReport={row.isOwn ? undefined : openReport}
            />
          ))
        ) : error ? null : (
          <li className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="bg-gradient-brand-soft flex h-20 w-20 items-center justify-center rounded-full text-3xl ring-1 ring-border">
              💬
            </div>
            <div className="flex flex-col gap-1">
              <p className="font-bold text-foreground">아직 메시지가 없어요</p>
              <p className="text-sm text-muted-foreground">첫 메시지를 보내보세요</p>
            </div>
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
          className="bg-gradient-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white shadow-md shadow-primary/25 transition-transform active:scale-90 disabled:opacity-40 disabled:active:scale-100"
        >
          <Send size={18} aria-hidden="true" />
        </button>
      </form>

      {/* 신고 사유 입력 모달 — 대상 메시지 sender 를 신고(report 만, block 미생성). backdrop 비활성. */}
      {moderation?.step === "report" ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-title"
          className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="animate-scale-in w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-2">
              <Siren size={18} className="text-destructive" />
              <p id="report-title" className="text-base font-bold text-foreground">
                {nicknameOf(moderation.message.senderId)}님의 메시지 신고
              </p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              신고하면 이 멤버의 콘텐츠가 내 화면에서 즉시 숨겨집니다.
            </p>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="신고 사유를 입력해 주세요"
              aria-label="신고 사유"
              rows={3}
              maxLength={500}
              disabled={moderationPending}
              className="mt-4 w-full resize-none rounded-2xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            />
            {moderationError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {moderationError}
              </p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={moderationPending}
                onClick={closeModeration}
                className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                disabled={moderationPending}
                onClick={submitReport}
                className="flex-1 rounded-2xl bg-destructive py-3 text-sm font-bold text-white shadow-md shadow-destructive/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              >
                {moderationPending ? "신고 중…" : "신고"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* 신고 후 차단 유도(prompt) — 수락 시에만 POST /blocks(REQ-RPT-003). 거부는 report 숨김만 유지. */}
      {moderation?.step === "confirmBlock" ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="block-prompt-title"
          className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
        >
          <div className="animate-scale-in w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
            <div className="flex items-center gap-2">
              <Ban size={18} className="text-destructive" />
              <p
                id="block-prompt-title"
                className="text-base font-bold text-foreground"
              >
                이 멤버를 차단할까요?
              </p>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              신고가 접수되었어요. 차단하면 앞으로도 이 멤버의 메시지·투표·지출·일정·알림이 내
              화면에서 숨겨집니다. 차단하지 않아도 신고한 콘텐츠는 계속 숨겨집니다.
            </p>
            {moderationError ? (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {moderationError}
              </p>
            ) : null}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={moderationPending}
                onClick={closeModeration}
                className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-50"
              >
                차단 안 함
              </button>
              <button
                type="button"
                disabled={moderationPending}
                onClick={acceptBlock}
                className="flex-1 rounded-2xl bg-destructive py-3 text-sm font-bold text-white shadow-md shadow-destructive/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              >
                {moderationPending ? "차단 중…" : "차단"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
