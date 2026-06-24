// 경비 관리 Server Action (SPEC-MOIM-EXPENSE).
//
// member-actions.ts 의 requireToken + Server Action 패턴을 미러한다.
// 토큰은 서버 경계에서만 다루고 클라이언트에 노출하지 않는다. 인가는 백엔드가 최종 출처.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import {
  type ExpenseInput,
  createExpense,
  updateExpense,
  deleteExpense,
  createSettlement,
  deleteSettlement,
} from "@/lib/moim/expenses";
import { createClient } from "@/lib/supabase/server";

/** 경비 액션 공통 결과 상태 */
export type ExpenseActionState = { ok?: boolean; error?: string } | undefined;

const GENERIC_ERROR = "요청을 처리하지 못했습니다. 다시 시도해 주세요.";

/** 쿠키 세션을 읽어 access_token 을 돌려준다. 세션 부재면 /login 리다이렉트. */
async function requireToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }
  return session.access_token;
}

/**
 * 지출 항목을 생성한다. 성공 시 경비 페이지를 재검증한다.
 * 실패(403 비-owner / 400 무효 입력 / 네트워크) → 일반화 오류.
 */
export async function createExpenseAction(
  moimId: string,
  input: ExpenseInput,
): Promise<ExpenseActionState> {
  if (!moimId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await createExpense(api, moimId, input);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`createExpenseAction: POST expenses 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/expenses`);
  return { ok: true };
}

/**
 * 지출 항목을 수정한다. 성공 시 경비 페이지를 재검증한다.
 * 실패(403 비-owner / 404 미존재 / 네트워크) → 일반화 오류.
 */
export async function updateExpenseAction(
  moimId: string,
  expenseId: string,
  input: ExpenseInput,
): Promise<ExpenseActionState> {
  if (!moimId || !expenseId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await updateExpense(api, moimId, expenseId, input);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`updateExpenseAction: PATCH expenses 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/expenses`);
  return { ok: true };
}

/**
 * 지출 항목을 삭제한다. 성공 시 경비 페이지를 재검증한다.
 * 실패(403 비-owner / 404 미존재 / 네트워크) → 일반화 오류.
 */
export async function deleteExpenseAction(
  moimId: string,
  expenseId: string,
): Promise<ExpenseActionState> {
  if (!moimId || !expenseId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await deleteExpense(api, moimId, expenseId);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`deleteExpenseAction: DELETE expenses 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/expenses`);
  return { ok: true };
}

/**
 * 정산을 토글한다. settled=true → POST /settlements, settled=false → DELETE /settlements.
 * 성공 시 경비 페이지를 재검증한다.
 */
export async function toggleSettlementAction(
  moimId: string,
  transaction: { fromUserId: string; toUserId: string; amount: number },
  settled: boolean,
): Promise<ExpenseActionState> {
  if (!moimId || !transaction.fromUserId || !transaction.toUserId) {
    return { error: GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    if (settled) {
      await createSettlement(
        api,
        moimId,
        transaction.fromUserId,
        transaction.toUserId,
        transaction.amount,
      );
    } else {
      await deleteSettlement(
        api,
        moimId,
        transaction.fromUserId,
        transaction.toUserId,
        transaction.amount,
      );
    }
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`toggleSettlementAction: settlements 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath(`/moims/${moimId}/expenses`);
  return { ok: true };
}
