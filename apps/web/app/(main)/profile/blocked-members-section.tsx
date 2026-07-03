// 프로필 "차단한 멤버" 섹션 (Client Component, SPEC-SAFETY-001 T-009 / REQ-BLK-004).
//
// 서버(page.tsx)가 GET /blocks 로 조회한 block 행(block 만 — 신고 기반 숨김 미포함)을 받아 목록으로 렌더하고,
// 각 행에서 unblockAction(DELETE /blocks/:blockedUserId)으로 해제한다. 전용 라우트를 신설하지 않고 프로필
// 화면 내 섹션으로만 배치한다(최소 배치). 해제 성공 시 revalidatePath("/profile") 로 서버가 목록을 재조회한다.
//
// 차단은 userId(sub) 매칭이라 전역 닉네임이 없다(모임별 표시 이름과 분리 — REQ-BLK-003). 각 행은 식별 가능한
// 최소 표기(userId 앞자리)만 노출하고, 해제 버튼으로 진입점을 제공한다.
"use client";

import { useState, useTransition } from "react";
import { Ban } from "lucide-react";

import { type BlockItem } from "@/lib/safety/api";
import { unblockAction } from "@/lib/safety/actions";

interface BlockedMembersSectionProps {
  blocks: BlockItem[];
}

export function BlockedMembersSection({ blocks }: BlockedMembersSectionProps) {
  const [error, setError] = useState<string | null>(null);
  // 현재 해제 처리 중인 blockedUserId(행별 스피너/비활성 분기용).
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUnblock(blockedUserId: string) {
    setError(null);
    setPendingId(blockedUserId);
    startTransition(async () => {
      const result = await unblockAction(blockedUserId);
      setPendingId(null);
      if (result?.error) {
        setError(result.error);
        return;
      }
      // 성공: revalidatePath("/profile") 가 서버에서 실행돼 목록이 갱신된다.
    });
  }

  return (
    <section className="animate-fade-in-up flex flex-col gap-4 rounded-3xl border border-border bg-card p-5 shadow-sm [animation-delay:0.12s]">
      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Ban size={16} />
        <span>차단한 멤버 {blocks.length}명</span>
      </div>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {blocks.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {blocks.map((block) => {
            const rowPending = isPending && pendingId === block.blockedUserId;
            return (
              <li
                key={block.blockedUserId}
                className="flex items-center gap-3 rounded-2xl border border-border bg-background p-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold text-muted-foreground">
                  <Ban size={15} />
                </span>
                {/* 전역 닉네임이 없으므로 userId 앞자리로 식별 표기(차단은 sub 매칭 — REQ-BLK-003). */}
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-card-foreground">
                  {block.blockedUserId.slice(0, 12)}…
                </span>
                <button
                  type="button"
                  disabled={rowPending}
                  aria-label="차단 해제"
                  onClick={() => handleUnblock(block.blockedUserId)}
                  className="rounded-xl border border-border px-3 py-1.5 text-xs font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-50"
                >
                  {rowPending ? "해제 중…" : "차단 해제"}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-background p-4 text-center text-sm text-muted-foreground">
          차단한 멤버가 없어요
        </p>
      )}
    </section>
  );
}
