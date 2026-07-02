// 경비 관리 API 헬퍼 (SPEC-MOIM-EXPENSE).
//
// members.ts 의 구체-경로 패턴을 미러한다(moimId 인코딩 + request(path as never)).
// api-client.request 는 path 를 baseUrl 뒤에 그대로 연결하므로 여기서 경로를 완성한다.
import { type ApiClient } from "@moyura/api-client";

// ─────────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────────

/** 지출 항목의 멤버별 분담 */
export interface ExpenseShare {
  userId: string;
  shareAmount: number;
}

/** 지출 항목 */
export interface Expense {
  id: string;
  amount: number;
  category: string;
  payerUserId: string;
  memo?: string | null;
  createdAt: string;
  updatedAt: string;
  shares: ExpenseShare[];
}

/** 경비 요약(합계/1인당/예산/잔여) */
export interface ExpenseSummary {
  total: number;
  perPerson: number;
  budget: number | null;
  remaining: number | null;
}

/** 정산 잔액 — 양수면 받을 돈, 음수면 줄 돈 */
export interface SettlementBalance {
  userId: string;
  balance: number;
}

/** 정산 거래 내역 */
export interface SettlementTransaction {
  from: string;
  to: string;
  amount: number;
  settled: boolean;
}

/** GET /moims/:id/expenses 응답 */
export interface ExpenseListResponse {
  expenses: Expense[];
  summary: ExpenseSummary;
  settlement: {
    balances: SettlementBalance[];
    transactions: SettlementTransaction[];
  };
}

/** 지출 생성/수정 요청 바디 */
export interface ExpenseInput {
  amount: number;
  category: string;
  payerUserId: string;
  memo?: string;
  splitMethod: "equal" | "custom" | "ratio";
  participantUserIds?: string[];
  /** custom: [{userId, amount}], ratio: [{userId, ratio}] */
  shares?: Array<{ userId: string; amount?: number; ratio?: number }>;
}

// ─────────────────────────────────────────────
// 카테고리 프리셋(백엔드 정의)
// ─────────────────────────────────────────────
export const EXPENSE_CATEGORIES = ["식비", "교통", "숙박", "입장", "준비물", "기타"] as const;

// ─────────────────────────────────────────────
// API 헬퍼
// ─────────────────────────────────────────────

/**
 * 경비 목록 + 요약 + 정산 내역을 조회한다(GET /moims/:id/expenses). 멤버 전용.
 * 비멤버 → 403, 미존재 → 404(ApiError 전파).
 */
export async function listExpenses(
  api: ApiClient,
  moimId: string,
): Promise<ExpenseListResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/expenses`;
  return (await api.request(path as never, "get")) as ExpenseListResponse;
}

/**
 * 지출 항목을 생성한다(POST /moims/:id/expenses). owner 전용.
 * 비-owner 호출 → 403, 무효 입력 → 400(ApiError 전파).
 */
export async function createExpense(
  api: ApiClient,
  moimId: string,
  input: ExpenseInput,
): Promise<Expense> {
  const path = `/moims/${encodeURIComponent(moimId)}/expenses`;
  return (await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as Expense;
}

/**
 * 지출 항목을 수정한다(PATCH /moims/:id/expenses/:expenseId). owner 전용.
 * 비-owner 호출 → 403, 미존재 → 404(ApiError 전파).
 */
export async function updateExpense(
  api: ApiClient,
  moimId: string,
  expenseId: string,
  input: ExpenseInput,
): Promise<Expense> {
  const path = `/moims/${encodeURIComponent(moimId)}/expenses/${encodeURIComponent(expenseId)}`;
  return (await api.request(path as never, "patch", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as Expense;
}

/**
 * 지출 항목을 삭제한다(DELETE /moims/:id/expenses/:expenseId). owner 전용.
 * 비-owner 호출 → 403, 미존재 → 404(ApiError 전파). 성공 시 204(바디 없음).
 */
export async function deleteExpense(
  api: ApiClient,
  moimId: string,
  expenseId: string,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/expenses/${encodeURIComponent(expenseId)}`;
  await api.request(path as never, "delete");
}

/**
 * 정산을 완료 처리한다(POST /moims/:id/settlements). owner 전용.
 * 성공 시 해당 거래가 settled=true 로 전환된다.
 */
export async function createSettlement(
  api: ApiClient,
  moimId: string,
  fromUserId: string,
  toUserId: string,
  amount: number,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/settlements`;
  await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromUserId, toUserId, amount }),
  });
}

/**
 * 정산 완료를 취소한다(DELETE /moims/:id/settlements). owner 전용.
 * 성공 시 해당 거래가 settled=false 로 전환된다.
 */
export async function deleteSettlement(
  api: ApiClient,
  moimId: string,
  fromUserId: string,
  toUserId: string,
  amount: number,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/settlements`;
  await api.request(path as never, "delete", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromUserId, toUserId, amount }),
  });
}
