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

import { useActionState, useState, useTransition } from "react";
import { BarChart3, Check, CheckSquare, Plus, Square, Vote, X } from "lucide-react";

import type { PollWithResults } from "@/lib/moim/polls";
import {
  createPollAction,
  voteAction,
  type CreatePollActionState,
} from "./poll-actions";

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
  onVote,
}: {
  option: { id: string; label: string; voteCount: number };
  totalVotes: number;
  isMine: boolean;
  multiSelect: boolean;
  pending: boolean;
  onVote: (optionId: string) => void;
}) {
  // 총표 0이면 0% (퍼센트 NaN 방지). 막대는 시각적 집계.
  const percent = totalVotes > 0 ? Math.round((option.voteCount / totalVotes) * 100) : 0;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => onVote(option.id)}
      // 다중 선택은 체크박스 의미(role=checkbox + aria-checked), 단일은 toggle 버튼(aria-pressed).
      role={multiSelect ? "checkbox" : undefined}
      aria-checked={multiSelect ? isMine : undefined}
      aria-pressed={multiSelect ? undefined : isMine}
      className={`relative w-full overflow-hidden rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
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
            {option.label}
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
function PollCard({ moimId, poll }: { moimId: string; poll: PollWithResults }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);

  const totalVotes = poll.options.reduce((sum, o) => sum + o.voteCount, 0);
  const hasVoted = poll.myVotes.length > 0;

  function handleVote(optionId: string): void {
    setError(undefined);
    startTransition(async () => {
      const result = await voteAction(moimId, poll.id, optionId);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <h3 className="flex items-start gap-2 font-bold text-card-foreground">
        <Vote size={18} className="mt-0.5 shrink-0 text-primary" />
        <span className="min-w-0">{poll.question}</span>
      </h3>

      {/* 다중 선택 안내 — 여러 항목을 동시에 고를 수 있음을 명시한다(단일은 표시 안 함). */}
      {poll.multiSelect ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <CheckSquare size={13} />
          여러 개 선택 가능
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
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
            onVote={handleVote}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        총 {totalVotes}표
        {hasVoted
          ? " · 내 선택이 반영됐어요"
          : poll.multiSelect
            ? " · 가능한 항목을 모두 탭해 투표하세요"
            : " · 선택지를 탭해 투표하세요"}
      </p>
    </article>
  );
}

/** "투표 만들기" 폼 — 질문 + 동적 옵션 입력(추가/제거, 최소 2). useActionState(createPollAction). */
function CreatePollForm({ moimId }: { moimId: string }) {
  const [state, action, pending] = useActionState<
    CreatePollActionState,
    FormData
  >(createPollAction, undefined);
  // 동적 옵션 입력 — 기본 2칸, 추가/제거 가능(최소 2 유지). 제어 컴포넌트로 입력값을 관리한다.
  const [options, setOptions] = useState<string[]>(["", ""]);
  const [open, setOpen] = useState(false);

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

      {/* 동적 선택지(최소 2) */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-foreground">선택지</span>
        {options.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              name="option"
              type="text"
              value={value}
              onChange={(e) => updateOption(index, e.target.value)}
              placeholder={`선택지 ${index + 1}`}
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
}: {
  moimId: string;
  polls: PollWithResults[];
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <BarChart3 size={16} />
        <span>투표 {polls.length}개</span>
      </div>

      {polls.length > 0 ? (
        <div className="flex flex-col gap-3">
          {polls.map((poll) => (
            <PollCard key={poll.id} moimId={moimId} poll={poll} />
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
