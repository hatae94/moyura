// 멤버 목록 섹션 (Client Component, SPEC-MOIM-012).
//
// page.tsx 의 서버 렌더 멤버 목록을 대체한다. 기존 RoleBadge + MemberRow 와 동일 시각을 유지하면서
// owner 전용 컨트롤(강퇴·방장 위임·정원 수정)과 confirm 다이얼로그(backdrop 비활성)를 추가한다.
// invite-invalid-handler.tsx 의 alertdialog 스타일(fixed inset-0 z-50 bg-black/50, 확인만 닫음)을 재사용.
//
// 실시간: useMemberChannel 로 'member_change' 이벤트를 구독한다.
//   - DELETE + userId === currentUserId → 자신이 강퇴됨 → router.replace('/home')
//   - 그 외(INSERT/UPDATE/DELETE 타인) → router.refresh()(멤버 목록·isOwner 재계산)
"use client";

import { useCallback, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Crown, Pencil, User, UserMinus, Users } from "lucide-react";

import { type MoimMember } from "@/lib/moim/api";
import { useMemberChannel } from "@/lib/moim/useMemberChannel";
import { kickMemberAction, transferOwnerAction, updateMaxMembersAction } from "./member-actions";

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
  /** realtime 구독 인가 토큰(없으면 구독하지 않음) */
  accessToken: string;
  /** 모임 최대 인원 정원 */
  maxMembers: number;
}

// @MX:ANCHOR: [AUTO] MembersSection — 멤버 목록 + owner 컨트롤의 단일 진입점(page.tsx, 추후 모바일 공유 가능성)
// @MX:REASON: isOwner + currentUserId 조합으로 컨트롤 노출 여부를 결정하는 인가 로직 포함 + 실시간 멤버 변경 구독
export function MembersSection({
  moimId,
  members,
  isOwner,
  currentUserId,
  accessToken,
  maxMembers,
}: MembersSectionProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // 정원 편집 상태 — null이면 표시 모드, string이면 편집 모드(입력값)
  const [editingMax, setEditingMax] = useState<string | null>(null);
  const [maxMembersError, setMaxMembersError] = useState<string | null>(null);
  const [isSavingMax, startMaxTransition] = useTransition();

  // ─────────────────────────────────────────────
  // 실시간 멤버 변경 구독
  // ─────────────────────────────────────────────
  // @MX:WARN: [AUTO] onEvent — 자기강퇴(DELETE+self) → router.replace, 그 외 → router.refresh 분기
  // @MX:REASON: router.replace 는 히스토리를 교체하므로 잘못 호출하면 네비게이션 스택이 깨짐. userId 일치 조건이 핵심.
  const onEvent = useCallback(
    (e: { op: string; userId: string }) => {
      if (e.op === "DELETE" && e.userId === currentUserId) {
        // 자신이 강퇴됨 → 메인 화면으로 이동(히스토리 교체 — "뒤로 가기"로 강퇴된 모임에 재진입 방지)
        router.replace("/home");
      } else {
        // 참여(INSERT)·방장위임(UPDATE)·타인강퇴(DELETE) → 서버 재조회로 목록 갱신
        router.refresh();
      }
    },
    [currentUserId, router],
  );

  useMemberChannel(moimId, accessToken, onEvent);

  // ─────────────────────────────────────────────
  // kick/transfer 다이얼로그 핸들러
  // ─────────────────────────────────────────────
  function closeDialog() {
    setDialog(null);
    setActionError(null);
  }

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

  // ─────────────────────────────────────────────
  // 정원 편집 핸들러
  // ─────────────────────────────────────────────
  function startEditMax() {
    setEditingMax(String(maxMembers));
    setMaxMembersError(null);
  }

  function cancelEditMax() {
    setEditingMax(null);
    setMaxMembersError(null);
  }

  function saveEditMax() {
    const value = parseInt(editingMax ?? "", 10);
    if (!editingMax || isNaN(value) || value < 1) {
      setMaxMembersError("1명 이상으로 입력해 주세요.");
      return;
    }
    startMaxTransition(async () => {
      const result = await updateMaxMembersAction(moimId, value);
      if (result?.error) {
        setMaxMembersError(result.error);
        return;
      }
      setEditingMax(null);
      setMaxMembersError(null);
    });
  }

  return (
    <>
      {/* 헤더: 멤버 수 / 최대 M명 + owner 용 정원 수정 컨트롤 */}
      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Users size={16} />
        <span>멤버 {members.length}명</span>
        {/* 정원 표시 */}
        {editingMax === null ? (
          <>
            <span className="text-muted-foreground font-normal">/ 최대 {maxMembers}명</span>
            {isOwner ? (
              <button
                type="button"
                aria-label="정원 수정"
                title="정원 수정"
                onClick={startEditMax}
                className="ml-1 flex items-center gap-1 rounded-lg px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil size={12} />
                정원 수정
              </button>
            ) : null}
          </>
        ) : (
          /* 정원 인라인 편집 모드 */
          <span className="ml-1 flex items-center gap-1.5">
            <span className="text-muted-foreground font-normal">/ 최대</span>
            <input
              type="number"
              min={1}
              value={editingMax}
              onChange={(e) => setEditingMax(e.target.value)}
              className="w-16 rounded-lg border border-border bg-card px-2 py-0.5 text-sm text-card-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              aria-label="최대 인원 수"
              disabled={isSavingMax}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveEditMax();
                if (e.key === "Escape") cancelEditMax();
              }}
            />
            <span className="text-muted-foreground font-normal">명</span>
            <button
              type="button"
              disabled={isSavingMax}
              onClick={saveEditMax}
              className="rounded-lg bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSavingMax ? "저장 중…" : "저장"}
            </button>
            <button
              type="button"
              disabled={isSavingMax}
              onClick={cancelEditMax}
              className="rounded-lg border border-border px-2 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              취소
            </button>
          </span>
        )}
      </div>

      {/* 정원 편집 오류 */}
      {maxMembersError ? (
        <p className="text-sm text-destructive" role="alert">
          {maxMembersError}
        </p>
      ) : null}

      {/* 멤버 목록 */}
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
