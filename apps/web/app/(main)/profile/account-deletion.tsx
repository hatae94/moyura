// 마이 페이지 — 회원 탈퇴 진입점 + 파괴적·불가역 확인 UI (Client Component, SPEC-ACCOUNT-001 T-09).
//
// profile-form 의 useActionState 패턴을 미러하되, 탈퇴는 되돌릴 수 없으므로 2단계 확인 게이트를 둔다:
//  1) 기본 상태 — "회원 탈퇴" 트리거 버튼만 노출(파괴적 스타일). 클릭 시 confirming=true 로 확인 패널을 연다.
//  2) 확인 상태 — 불가역 경고 문구 + "탈퇴하기"(폼 submit → deleteAccountAction) + "취소"(type=button, 패널만 닫음).
// 서버 액션(deleteAccountAction)은 오직 확인 패널의 destructive submit 으로만 호출된다 — 취소는 액션을 부르지 않는다
// (AC-5-2 "확인 단계 뒤에만 호출, 취소 시 미호출"). 성공 시 액션이 signOut 후 /login 으로 redirect 하므로
// 성공 상태는 클라이언트에서 다루지 않고, 실패 시 자격증명 비노출 일반화 오류만 표시한다.
"use client";

import { useActionState, useState } from "react";

import { deleteAccountAction, type DeleteAccountState } from "./actions";

export function AccountDeletion() {
  // 확인 게이트 — false 이면 트리거 버튼만, true 이면 불가역 경고 + 탈퇴/취소 패널을 노출한다.
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<DeleteAccountState, FormData>(
    deleteAccountAction,
    undefined,
  );

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full rounded-2xl border border-destructive/30 bg-card py-3 font-semibold text-destructive transition-all hover:bg-destructive/10 active:scale-[0.99]"
      >
        회원 탈퇴
      </button>
    );
  }

  return (
    <div className="animate-fade-in-up flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold text-destructive">정말 탈퇴하시겠어요?</span>
        <p className="text-xs leading-relaxed text-muted-foreground">
          탈퇴하면 계정과 개인정보가 삭제되며 되돌릴 수 없어요. 소유한 모임은 다른 멤버에게 이양되거나
          삭제됩니다.
        </p>
      </div>

      {state?.error ? (
        <div
          role="alert"
          className="animate-fade-in-down rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {state.error}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="flex-1 rounded-2xl border border-border bg-card py-3 font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.99] disabled:opacity-50"
        >
          취소
        </button>
        {/* 확인 패널 안에서만 렌더되는 폼 — 이 submit 만이 deleteAccountAction 을 호출한다. */}
        <form action={action} className="flex-1">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl bg-destructive py-3 font-bold text-white shadow-lg shadow-destructive/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {pending ? "탈퇴 중..." : "탈퇴하기"}
          </button>
        </form>
      </div>
    </div>
  );
}
