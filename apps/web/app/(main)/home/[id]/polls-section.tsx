// 모임 투표 섹션 (Client Component, SPEC-MOIM-006 REQ-MOIM6-006 / AC-6).
//
// 읽기 전용이던 상세(page.tsx, Server Component)에 도입하는 인터랙티브 섬이다 — page.tsx 는 가드 + 데이터
// fetch 를 유지하고(Server), 이 컴포넌트가 투표 컨트롤·생성 폼을 렌더한다(Client). Server Action 은
// poll-actions.ts("use server") 에서 import 한다(직렬화 가능한 props 만 page→여기로 전달 — 함수/인스턴스 금지).
//
// SPEC-MOIM-006 다중 선택: poll.multiSelect 로 렌더 분기한다.
//   - 단일(false): MOIM-005 그대로 — 한 강조, 탭=교체(myVotes 0/1요소). 회귀 0.
//   - 다중(true): 체크박스형 — 멤버가 고른 여러 선택지 동시 강조(myVotes.includes), 탭=토글(추가/제거),
//     "여러 개 선택 가능" 안내. 두 경우 모두 isMine = poll.myVotes.includes(option.id) 로 통일(분기 최소화).
//
// 디자인: (main)/home/[id] 와 동일한 Meetup 오렌지 시맨틱 토큰(bg-primary/text-primary-foreground/
// border-border/bg-card/bg-muted/text-muted-foreground/rounded-2xl) — login/onboarding 의 blue 흐름 아님.
//   - 득표 막대: bg-muted(배경) 위에 bg-primary(채움, 총표 대비 퍼센트 너비).
//   - 내 표 강조: myVotes 에 포함된 행에 ring-primary + bg-primary/5(단일/다중 공통, 다중은 여러 행 동시).
//   - 빈 상태: poll 0개면 "아직 투표가 없어요"(허위/플레이스홀더 값 금지).
"use client";

import { useActionState, useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CalendarClock,
  Check,
  CheckSquare,
  Clock,
  Lock,
  MapPin,
  Plus,
  Square,
  Vote,
  X,
} from "lucide-react";

import type { PollWithResults } from "@/lib/moim/polls";
import { usePollChannel } from "@/lib/poll/usePollChannel";
import {
  closePollAction,
  createPollAction,
  voteAction,
  type CreatePollActionState,
} from "./poll-actions";

/** 마감 시각(ISO)을 사람이 읽을 수 있는 한국어 로컬 표기로 변환한다(표시 전용 — 판정은 isClosed). */
function formatClosesAt(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 한 선택지 행 — 라벨 + 득표 수 + 총표 대비 퍼센트 막대 + 내 표 강조. 클릭하면 그 선택지에 투표한다.
 * multiSelect 면 체크박스형(CheckSquare/Square) 아포던스, 단일이면 선택 시 Check 아이콘(MOIM-005).
 */
function OptionRow({
  option,
  totalVotes,
  isMine,
  multiSelect,
  pending,
  closed,
  onVote,
}: {
  option: { id: string; label: string; voteCount: number; optionDate: string | null };
  totalVotes: number;
  isMine: boolean;
  multiSelect: boolean;
  pending: boolean;
  closed: boolean;
  onVote: (optionId: string) => void;
}) {
  // 총표 0이면 0% (퍼센트 NaN 방지). 막대는 시각적 집계.
  const percent = totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 100) : 0;
  // SPEC-MOIM-008: 날짜 투표 선택지는 optionDate(ISO)를 사람이 읽을 수 있게 표시한다(정규 ISO label 노출 금지).
  const displayLabel = option.optionDate ? formatClosesAt(option.optionDate) : option.label;
  return (
    <button
      type="button"
      // SPEC-MOIM-007: 마감(closed)이면 투표 컨트롤을 비활성화한다(결과 막대/강조는 계속 표시).
      disabled={pending || closed}
      onClick={() => onVote(option.id)}
      // 다중 선택은 체크박스 의미(role=checkbox + aria-checked), 단일은 toggle 버튼(aria-pressed).
      role={multiSelect ? "checkbox" : undefined}
      aria-checked={multiSelect ? isMine : undefined}
      aria-pressed={multiSelect ? undefined : isMine}
      className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
        closed ? "cursor-default" : ""
      } ${
        isMine
          ? "border-primary bg-primary/5 ring-2 ring-primary/40"
          : "border-border bg-card hover:border-primary/40"
      }`}
    >
      {/* 득표 막대(배경) — bg-muted 트랙 위에 bg-primary 채움(퍼센트 너비). */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-primary/10"
        style={{ width: `${percent}%` }}
      />
      <span className="relative flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {multiSelect ? (
            // 다중: 체크박스형 — 고른 선택지는 채워진 체크박스, 아니면 빈 박스(여러 강조 동시 가능).
            isMine ? (
              <CheckSquare size={16} className="shrink-0 text-primary" />
            ) : (
              <Square size={16} className="shrink-0 text-muted-foreground" />
            )
          ) : isMine ? (
            // 단일: 고른 선택지에만 Check(MOIM-005 그대로).
            <Check size={16} className="shrink-0 text-primary" />
          ) : null}
          <span
            className={`truncate font-medium ${
              isMine ? "text-primary" : "text-card-foreground"
            }`}
          >
            {displayLabel}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-muted-foreground">
          {option.voteCount}표 · {percent}%
        </span>
      </span>
    </button>
  );
}

/**
 * 한 투표 카드 — 질문 + (다중 선택이면 "여러 개 선택 가능" 안내) + 옵션들(득표 막대 + 내 표 강조) + 투표 컨트롤.
 * 단일/다중은 poll.multiSelect 로 분기 — 강조 판정은 둘 다 poll.myVotes.includes(option.id) 로 통일한다.
 * 다중 선택은 총표 합이 멤버 수보다 클 수 있어(멤버당 옵션당 1표) 퍼센트 합이 100%가 아닐 수 있다(총표 대비 표시).
 */
function PollCard({
  moimId,
  poll,
  currentUserId,
}: {
  moimId: string;
  poll: PollWithResults;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  // SPEC-MOIM-008: 마감 직후 finalize 결과 안내(동점/무표로 일정이 확정되지 않은 경우).
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const totalVotes = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
  const hasVoted = poll.myVotes.length > 0;
  // SPEC-MOIM-007: 마감 판정은 서버 계산 isClosed 만 신뢰한다(closesAt 자기 시계 비교 금지 — 시계 오차 차단).
  const closed = poll.isClosed;
  // SPEC-MOIM-008: 날짜 투표(kind="date") — 마감 시 최다 득표 날짜가 모임 일정으로 확정된다.
  const isDatePoll = poll.kind === "date";
  // SPEC-MOIM-010: 장소 투표(kind="place") — 마감 시 최다 득표 장소가 모임 장소로 확정된다.
  const isPlacePoll = poll.kind === "place";
  // "마감하기"는 생성자 + 열린 poll 에만 노출한다(createdBy = JWT sub = Supabase user.id).
  const canClose = poll.createdBy === currentUserId && !closed;

  function handleVote(optionId: string): void {
    if (closed) {
      return;
    }
    setError(undefined);
    startTransition(async () => {
      const result = await voteAction(moimId, poll.id, optionId);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  function handleClose(): void {
    setError(undefined);
    setNotice(undefined);
    startTransition(async () => {
      const result = await closePollAction(moimId, poll.id);
      if (result?.error) {
        setError(result.error);
        return;
      }
      // 날짜 투표 finalize 가 동점/무표로 스킵되면 일정 미확정을 안내한다(단일 승자면 헤더 일정이 갱신됨).
      if (result?.finalizeSkippedReason === "tie") {
        setNotice("최다 득표가 동점이라 일정이 확정되지 않았어요. 한 곳으로 모인 뒤 다시 마감해 주세요.");
      } else if (result?.finalizeSkippedReason === "no_votes") {
        setNotice("투표가 없어 일정이 확정되지 않았어요.");
      }
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-start gap-2 font-bold text-card-foreground">
          <Vote size={18} className="mt-0.5 shrink-0 text-primary" />
          <span className="min-w-0">{poll.question}</span>
        </h3>
        {/* 마감됨 배지 — 차분한 muted 계열(파괴적 아님). 마감 후에도 결과는 계속 표시한다. */}
        {closed ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
            <Lock size={12} />
            마감됨
          </span>
        ) : null}
      </div>

      {/* 다중 선택 안내 — 여러 항목을 동시에 고를 수 있음을 명시한다(단일은 표시 안 함). */}
      {poll.multiSelect ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <CheckSquare size={13} />
          여러 개 선택 가능
        </p>
      ) : null}

      {/* SPEC-MOIM-008: 날짜 투표 안내 — 열린 동안은 마감 시 일정 확정 예고, 마감 후 단일 승자면 헤더 일정이 갱신된다. */}
      {isDatePoll && !closed ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <CalendarClock size={13} />
          마감하면 최다 득표 날짜가 모임 일정으로 확정돼요
        </p>
      ) : null}

      {/* SPEC-MOIM-010: 장소 투표 안내 — 마감 시 최다 득표 장소가 모임 장소(헤더)로 확정된다. */}
      {isPlacePoll && !closed ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <MapPin size={13} />
          마감하면 최다 득표 장소가 모임 장소로 확정돼요
        </p>
      ) : null}

      {/* 마감 시각 표시 — closesAt 가 설정돼 있을 때만(없으면 마감 안내 미표시). 표시 전용. */}
      {poll.closesAt ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={13} />
          {closed
            ? `마감됨 · ${formatClosesAt(poll.closesAt)}`
            : `마감 예정 · ${formatClosesAt(poll.closesAt)}`}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/* SPEC-MOIM-008: finalize 스킵(동점/무표) 안내 — 오류가 아니라 정보성(차분한 muted). */}
      {notice ? (
        <p className="rounded-xl border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {poll.options.map((option) => (
          <OptionRow
            key={option.id}
            option={option}
            totalVotes={totalVotes}
            isMine={poll.myVotes.includes(option.id)}
            multiSelect={poll.multiSelect}
            pending={pending}
            closed={closed}
            onVote={handleVote}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          총 {totalVotes}표
          {closed
            ? " · 마감된 투표예요"
            : hasVoted
              ? " · 내 선택이 반영됐어요"
              : poll.multiSelect
                ? " · 가능한 항목을 모두 탭해 투표하세요"
                : " · 선택지를 탭해 투표하세요"}
        </p>
        {/* 생성자 전용 "마감하기" — 열린 poll 에만 노출(마감되면 사라진다). 절제된 secondary 스타일. */}
        {canClose ? (
          <button
            type="button"
            disabled={pending}
            onClick={handleClose}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            <Lock size={12} />
            {pending ? "마감 중..." : "마감하기"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** "투표 만들기" 폼 — 질문 + 동적 옵션 입력(추가/제거, 최소 2). useActionState(createPollAction). */
function CreatePollForm({ moimId }: { moimId: string }) {
  // 동적 옵션 입력 — 기본 2칸, 추가/제거 가능(최소 2 유지). 제어 컴포넌트로 입력값을 관리한다.
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [open, setOpen] = useState(false);
  // SPEC-MOIM-008/010: 투표 종류 — "date"면 선택지 입력이 datetime-local, "place"면 장소 텍스트, 그 외 일반.
  const [pollKind, setPollKind] = useState<"general" | "date" | "place">("general");

  // 생성 성공 시 폼을 닫고 입력을 리셋한다 — 제출 후에도 폼이 열린 채 남던 UX 결함 해소.
  // createPollAction 을 액션 래퍼로 감싸 성공(ok) 직후 setOpen/setOptions 를 호출한다(트랜잭션 컨텍스트라
  // effect-내-setState 안티패턴을 피한다 — react-hooks/set-state-in-effect). 실패 시 폼/입력을 유지한다.
  const [state, action, pending] = useActionState<CreatePollActionState, FormData>(
    async (prev, formData) => {
      const result = await createPollAction(prev, formData);
      if (result?.ok) {
        setOpen(false);
        setOptions(["", ""]);
        setPollKind("general");
      }
      return result;
    },
    undefined,
  );

  function updateOption(index: number, value: string): void {
    setOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  }
  function addOption(): void {
    setOptions((prev) => [...prev, ""]);
  }
  function removeOption(index: number): void {
    // 최소 2칸은 유지한다.
    setOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/50 bg-primary/5 py-3.5 text-base font-bold text-primary transition-colors hover:bg-primary/10"
      >
        <Plus size={20} />
        투표 만들기
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4"
    >
      {/* moimId 는 Server Action 이 읽도록 hidden 으로 동봉한다. */}
      <input type="hidden" name="moimId" value={moimId} />
      {/* SPEC-MOIM-008: kind 는 일정 투표 토글에 따라 결정된다(체크 시 "date", 아니면 "general"). */}
      <input type="hidden" name="kind" value={pollKind} />

      <div className="flex items-center justify-between">
        <span className="font-bold text-card-foreground">새 투표 만들기</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="투표 만들기 취소"
          className="text-muted-foreground hover:text-foreground"
        >
          <X size={18} />
        </button>
      </div>

      {state?.error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {state.error}
        </div>
      ) : null}

      {/* 질문(필수) */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="poll-question" className="text-sm font-semibold text-foreground">
          질문
        </label>
        <input
          id="poll-question"
          name="question"
          type="text"
          required
          placeholder="예: 다음 모임은 언제가 좋을까요?"
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      {/* SPEC-MOIM-008/010: 투표 종류 3-way 선택(일반/날짜/장소). 날짜→datetime 선택지, 장소→텍스트 선택지(마감 시
          승자가 모임 일정/장소로 확정). multiSelect 와 공존 가능. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-foreground">투표 종류</span>
        <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-border bg-background p-1">
          {(
            [
              { value: "general", label: "일반" },
              { value: "date", label: "날짜" },
              { value: "place", label: "장소" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPollKind(opt.value)}
              aria-pressed={pollKind === opt.value}
              className={`rounded-lg py-2 text-sm font-semibold transition-colors ${
                pollKind === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {pollKind === "date" ? (
          <span className="text-xs text-muted-foreground">
            마감하면 최다 득표 날짜가 모임 일정으로 확정돼요.
          </span>
        ) : pollKind === "place" ? (
          <span className="text-xs text-muted-foreground">
            마감하면 최다 득표 장소가 모임 장소로 확정돼요.
          </span>
        ) : null}
      </div>

      {/* 동적 선택지(최소 2) — 날짜 투표면 datetime-local, 일반·장소면 텍스트. */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-foreground">
          {pollKind === "date"
            ? "날짜 선택지"
            : pollKind === "place"
              ? "장소 선택지"
              : "선택지"}
        </span>
        {options.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              name="option"
              type={pollKind === "date" ? "datetime-local" : "text"}
              value={value}
              onChange={(e) => updateOption(index, e.target.value)}
              placeholder={
                pollKind === "date"
                  ? undefined
                  : pollKind === "place"
                    ? `장소 ${index + 1} (예: 강남역 2번 출구)`
                    : `선택지 ${index + 1}`
              }
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {options.length > 2 ? (
              <button
                type="button"
                onClick={() => removeOption(index)}
                aria-label={`선택지 ${index + 1} 삭제`}
                className="shrink-0 rounded-lg border border-border p-2 text-muted-foreground hover:text-destructive"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={addOption}
          className="flex items-center gap-1.5 self-start text-sm font-semibold text-primary hover:text-primary/80"
        >
          <Plus size={16} />
          선택지 추가
        </button>
      </div>

      {/* 여러 개 선택 허용 토글(name="multiSelect", 체크 시 "on"). 기본 꺼짐(단일 선택). Meetup 오렌지 accent. */}
      <label
        htmlFor="poll-multi-select"
        className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-background p-3"
      >
        <input
          id="poll-multi-select"
          name="multiSelect"
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">여러 개 선택 허용</span>
          <span className="text-xs text-muted-foreground">
            켜면 멤버가 가능한 항목을 모두 고를 수 있어요(예: 가능한 날짜).
          </span>
        </span>
      </label>

      {/* SPEC-MOIM-007: optional 마감 시각(datetime-local). 미입력 시 마감 없음(영구히 열림). moims/new 일정 미러. */}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="poll-closes-at" className="text-sm font-semibold text-foreground">
          마감 시각 <span className="font-normal text-muted-foreground">(선택)</span>
        </label>
        <input
          id="poll-closes-at"
          name="closesAt"
          type="datetime-local"
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        <span className="text-xs text-muted-foreground">
          마감 시각이 지나면 투표가 자동으로 닫혀요. 비워 두면 직접 마감할 때까지 열려 있어요.
        </span>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-full rounded-2xl bg-primary py-3 text-base font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        {pending ? "만드는 중..." : "투표 만들기"}
      </button>
    </form>
  );
}

/** 투표 섹션 — 헤더 + 투표 카드 목록(또는 빈 상태) + 생성 폼. page.tsx(Server)가 polls 를 fetch 해 내려준다. */
export function PollsSection({
  moimId,
  polls,
  currentUserId,
  accessToken,
}: {
  moimId: string;
  polls: PollWithResults[];
  // SPEC-MOIM-007: 현재 사용자 sub(Supabase user.id) — 생성자 전용 "마감하기" 버튼 노출 판정에 쓴다.
  currentUserId: string;
  // SPEC-MOIM-009: realtime 구독 인가 토큰(없으면 구독 생략). page.tsx 가 세션 access_token 을 내려준다.
  accessToken: string | null;
}) {
  // SPEC-MOIM-009: 다른 멤버의 투표/생성/마감 신호('poll_change')를 받으면 서버 컴포넌트를 재조회해
  // 집계 결과 + 모임 헤더 일정(startsAt)을 통째로 갱신한다(각 멤버 myVotes 는 서버가 다시 계산).
  const router = useRouter();
  const handlePollChange = useCallback(() => {
    router.refresh();
  }, [router]);
  usePollChannel(moimId, accessToken, handlePollChange);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <BarChart3 size={16} />
        <span>투표 {polls.length}개</span>
      </div>

      {polls.length > 0 ? (
        <div className="flex flex-col gap-3">
          {polls.map((poll) => (
            <PollCard
              key={poll.id}
              moimId={moimId}
              poll={poll}
              currentUserId={currentUserId}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          아직 투표가 없어요
        </p>
      )}

      <CreatePollForm moimId={moimId} />
    </section>
  );
}
