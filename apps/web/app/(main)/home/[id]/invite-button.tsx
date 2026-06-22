// 모임 초대 생성 UI (Client Component, SPEC-MOIM-011 REQ-MOIM11-003).
//
// owner 전용 "초대하기" → createInviteAction(서버에서 발급) → 발급된 token 으로 `{origin}/invite/{token}`
// 링크를 조립해 표시 + 복사. 모임 상세(웹)에 들어가므로 모바일 WebView 안에서도 그대로 렌더된다(하이브리드).
// page.tsx 가 isOwner(=moim.createdBy === 세션 user.id)를 내려줘 비-owner 에겐 아무것도 렌더하지 않는다
// (백엔드 assertOwner 403 이 최종 출처 — UI 숨김은 방어선). Meetup 오렌지 시맨틱 토큰 사용.
"use client";

import { useState, useTransition } from "react";
import { Check, Copy, UserPlus } from "lucide-react";

import { createInviteAction } from "./invite-actions";

export function InviteButton({
  moimId,
  isOwner,
}: {
  moimId: string;
  // SPEC-MOIM-011: 현재 사용자가 모임 owner 인지(createdBy === 세션 user.id). 비-owner 면 렌더 안 함.
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [link, setLink] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  // 비-owner 에겐 초대 UI 자체를 노출하지 않는다(토큰은 owner 전용 자격증명).
  if (!isOwner) {
    return null;
  }

  function handleCreate(): void {
    setError(undefined);
    setCopied(false);
    startTransition(async () => {
      const result = await createInviteAction(moimId);
      if (result?.error || !result?.token) {
        setError(result?.error ?? "초대 링크를 만들지 못했습니다.");
        return;
      }
      // 발급된 token 으로 현재 origin 기준 수락 링크를 조립한다(웹/모바일 WebView 공통).
      setLink(`${window.location.origin}/invite/${result.token}`);
    });
  }

  async function handleCopy(): Promise<void> {
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 클립보드 권한 거부 등 — 링크는 화면에 노출돼 있어 수동 복사 가능(치명 아님).
      setError("자동 복사에 실패했어요. 링크를 길게 눌러 복사해 주세요.");
    }
  }

  return (
    <section className="flex flex-col gap-2">
      {!link ? (
        <button
          type="button"
          disabled={pending}
          onClick={handleCreate}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/50 bg-primary/5 py-3 text-base font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <UserPlus size={18} />
          {pending ? "초대 링크 만드는 중..." : "초대하기"}
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
          <span className="text-sm font-semibold text-card-foreground">초대 링크</span>
          <p className="break-all rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-muted-foreground">
            {link}
          </p>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? "복사됨" : "링크 복사"}
          </button>
          <p className="text-xs text-muted-foreground">
            이 링크를 받은 사람이 열어 닉네임을 입력하면 모임에 참여해요. 앱이 있으면 앱에서 열려요.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
