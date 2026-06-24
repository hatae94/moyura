// 멤버 목록 섹션 (Client Component, SPEC-MOIM-012).
//
// page.tsx 의 서버 렌더 멤버 목록을 대체한다. 기존 RoleBadge + MemberRow 와 동일 시각을 유지하면서
// owner 전용 컨트롤(강퇴·방장 위임)과 confirm 다이얼로그(backdrop 비활성)를 추가한다.
// invite-invalid-handler.tsx 의 alertdialog 스타일(fixed inset-0 z-50 bg-black/50, 확인만 닫음)을 재사용.
"use client";

import { useTransition, useState } from "react";
import { Crown, User, UserMinus } from "lucide-react";

import { type MoimMember } from "@/lib/moim/api";
import { kickMemberAction, transferOwnerAction } from "./member-actions";

// ─────────────────────────────────────────────
// 역할 배지 (page.tsx 의 RoleBadge 와 동일)
// ─────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const isOwner = role === "owner";
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        isOwner ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      }`}
    >
      {isOwner ? <Crown size={12} /> : <User size={12} />}
      {isOwner ? "방장" : "멤버"}
    </span>
  );
}

// ─────────────────────────────────────────────
// confirm 다이얼로그 — backdrop 비활성, 취소·확인 두 버튼
// ─────────────────────────────────────────────
interface ConfirmDialogProps {
  title: string;
  description?: string;
  confirmLabel: string;
  /** 확인 버튼이 destructive(강퇴) 여부 */
  destructive?: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  destructive = false,
  isPending,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="member-confirm-title"
      // backdrop 비활성: 오버레이에 닫기 핸들러 없음(확인/취소 버튼으로만 진행)
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <p
          id="member-confirm-title"
          className="text-center text-base font-semibold text-gray-900"
        >
          {title}
        </p>
        {description ? (
          <p className="mt-2 text-center text-sm text-gray-500">{description}</p>
        ) : null}
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className={`flex-1 rounded-xl py-3 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
              destructive
                ? "bg-red-600 hover:bg-red-700"
                : "bg-primary hover:bg-primary/90"
            }`}
          >
            {isPending ? "처리 중…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 다이얼로그 상태 타입
// ─────────────────────────────────────────────
type DialogState =
  | { type: "kick"; member: MoimMember }
  | { type: "transfer"; member: MoimMember }
  | null;

// ─────────────────────────────────────────────
// MembersSection — 메인 export
// ─────────────────────────────────────────────
interface MembersSectionProps {
  moimId: string;
  members: MoimMember[];
  isOwner: boolean;
  currentUserId: string;
}

// @MX:ANCHOR: [AUTO] MembersSection — 멤버 목록 + owner 컨트롤의 단일 진입점(page.tsx, 추후 모바일 공유 가능성)
// @MX:REASON: isOwner + currentUserId 조합으로 컨트롤 노출 여부를 결정하는 인가 로직 포함
export function MembersSection({
  moimId,
  members,
  isOwner,
  currentUserId,
}: MembersSectionProps) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 다이얼로그 닫기 — 오류도 함께 초기화
  function closeDialog() {
    setDialog(null);
    setActionError(null);
  }

  // 확인 버튼 핸들러 — Server Action 호출(useTransition 으로 pending 관리)
  function handleConfirm() {
    if (!dialog) return;

    startTransition(async () => {
      if (dialog.type === "kick") {
        const result = await kickMemberAction(moimId, dialog.member.userId);
        if (result?.error) {
          setActionError(result.error);
          return; // 다이얼로그 유지, 오류 표시
        }
      } else {
        const result = await transferOwnerAction(moimId, dialog.member.userId);
        if (result?.error) {
          setActionError(result.error);
          return;
        }
      }
      // 성공: revalidatePath 가 서버에서 실행돼 목록이 갱신된다
      setDialog(null);
      setActionError(null);
    });
  }

  return (
    <>
      {members.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {members.map((member) => {
            // owner 컨트롤 노출 조건: 현재 사용자가 owner이고, 대상 멤버가 owner가 아니며, 자기 자신이 아닌 경우
            const showControls =
              isOwner && member.role !== "owner" && member.userId !== currentUserId;
            const initial = member.nickname.charAt(0).toUpperCase() || "?";

            return (
              <li
                key={member.userId}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                {/* 아바타 이니셜 */}
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-bold text-secondary-foreground">
                  {initial}
                </span>
                {/* 닉네임 */}
                <span className="min-w-0 flex-1 truncate font-medium text-card-foreground">
                  {member.nickname}
                </span>
                {/* 역할 배지 */}
                <RoleBadge role={member.role} />
                {/* owner 전용 컨트롤: 방장 위임 + 강퇴 */}
                {showControls ? (
                  <div className="flex items-center gap-1">
                    {/* 방장 위임 버튼 */}
                    <button
                      type="button"
                      aria-label={`${member.nickname}님에게 방장 위임`}
                      title="방장 위임"
                      onClick={() => setDialog({ type: "transfer", member })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Crown size={15} />
                    </button>
                    {/* 강퇴 버튼 */}
                    <button
                      type="button"
                      aria-label={`${member.nickname}님 강퇴`}
                      title="강퇴"
                      onClick={() => setDialog({ type: "kick", member })}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <UserMinus size={15} />
                    </button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-border bg-card p-4 text-center text-sm text-muted-foreground">
          아직 멤버가 없어요
        </p>
      )}

      {/* 인라인 오류 — 다이얼로그 외부에 표시(다이얼로그가 열려있을 때만) */}
      {actionError && dialog ? (
        <p className="mt-2 text-center text-sm text-destructive" role="alert">
          {actionError}
        </p>
      ) : null}

      {/* 강퇴 confirm 다이얼로그 */}
      {dialog?.type === "kick" ? (
        <ConfirmDialog
          title={`${dialog.member.nickname}님을 모임에서 강퇴할까요?`}
          confirmLabel="강퇴"
          destructive
          isPending={isPending}
          onCancel={closeDialog}
          onConfirm={handleConfirm}
        />
      ) : null}

      {/* 방장 위임 confirm 다이얼로그 */}
      {dialog?.type === "transfer" ? (
        <ConfirmDialog
          title={`방장 권한을 ${dialog.member.nickname}님에게 위임할까요?`}
          description="위임하면 현재 사용자는 일반 멤버가 됩니다."
          confirmLabel="위임"
          isPending={isPending}
          onCancel={closeDialog}
          onConfirm={handleConfirm}
        />
      ) : null}
    </>
  );
}
