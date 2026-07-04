// 경비 관리 클라이언트 뷰 (SPEC-MOIM-EXPENSE).
//
// 요약 카드, 카테고리 도넛, 멤버 기여 막대 + 정산 리스트, 지출 내역(owner 편집),
// 지출 등록/수정 바텀시트(FAB 트리거)를 제공한다.
"use client";

import { useCallback, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Pencil, Trash2, Check, RotateCcw } from "lucide-react";
import Link from "next/link";

import {
  type Expense,
  type ExpenseInput,
  type ExpenseListResponse,
  type SettlementTransaction,
  EXPENSE_CATEGORIES,
} from "@/lib/moim/expenses";
import { type MoimMember } from "@/lib/moim/api";
import { useExpenseChannel } from "@/lib/moim/useExpenseChannel";
import {
  createExpenseAction,
  updateExpenseAction,
  deleteExpenseAction,
  toggleSettlementAction,
} from "./expense-actions";

// ─────────────────────────────────────────────
// 카테고리 색상 매핑
// ─────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, string> = {
  식비: "#f97316",
  교통: "#3b82f6",
  숙박: "#8b5cf6",
  입장: "#ec4899",
  준비물: "#10b981",
  기타: "#6b7280",
};

// ─────────────────────────────────────────────
// 카테고리 도넛 (SVG conic-gradient 방식)
// ─────────────────────────────────────────────
interface DonutProps {
  expenses: Expense[];
}

function CategoryDonut({ expenses }: DonutProps) {
  // 카테고리별 합계 계산
  const totals: Record<string, number> = {};
  for (const e of expenses) {
    totals[e.category] = (totals[e.category] ?? 0) + e.amount;
  }
  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  if (grandTotal === 0 || entries.length === 0) {
    return (
      <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
        지출 내역이 없어요
      </div>
    );
  }

  // conic-gradient 계산
  const segments: string[] = [];
  let cumulative = 0;
  for (const [cat, amount] of entries) {
    const pct = (amount / grandTotal) * 100;
    const color = CATEGORY_COLORS[cat] ?? "#6b7280";
    segments.push(`${color} ${cumulative}% ${cumulative + pct}%`);
    cumulative += pct;
  }
  const gradient = `conic-gradient(${segments.join(", ")})`;

  return (
    <div className="flex items-center gap-4">
      {/* 도넛 */}
      <div className="relative shrink-0">
        <div
          className="h-24 w-24 rounded-full"
          style={{ background: gradient }}
          aria-hidden="true"
        />
        {/* 중앙 흰 원 — 도넛 구멍 */}
        <div className="absolute inset-0 m-auto h-12 w-12 rounded-full bg-card" />
      </div>
      {/* 범례 */}
      <ul className="flex flex-col gap-1.5 min-w-0">
        {entries.map(([cat, amount]) => {
          const pct = Math.round((amount / grandTotal) * 100);
          return (
            <li key={cat} className="flex items-center gap-2 text-sm">
              <span
                className="h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: CATEGORY_COLORS[cat] ?? "#6b7280" }}
                aria-hidden="true"
              />
              <span className="text-card-foreground font-medium">{cat}</span>
              <span className="text-muted-foreground ml-auto">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────
// 요약 카드
// ─────────────────────────────────────────────
function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-4 gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-bold text-foreground">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

// ─────────────────────────────────────────────
// 삭제 확인 다이얼로그
// ─────────────────────────────────────────────
function DeleteConfirmDialog({
  isPending,
  onCancel,
  onConfirm,
}: {
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="expense-delete-title"
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="animate-scale-in mx-4 w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
        <p id="expense-delete-title" className="text-center text-base font-bold text-foreground">
          이 지출 항목을 삭제할까요?
        </p>
        <p className="mt-2 text-center text-sm text-muted-foreground">삭제하면 되돌릴 수 없어요.</p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className="bg-destructive flex-1 rounded-2xl py-3 text-sm font-bold text-white shadow-md shadow-destructive/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {isPending ? "삭제 중…" : "삭제"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 바텀시트 — 지출 등록/수정
// ─────────────────────────────────────────────
interface SheetProps {
  moimId: string;
  members: MoimMember[];
  currentUserId: string;
  editing: Expense | null;
  onClose: () => void;
}

function ExpenseSheet({ moimId, members, currentUserId, editing, onClose }: SheetProps) {
  const [amount, setAmount] = useState<string>(editing ? String(editing.amount) : "");
  const [category, setCategory] = useState<string>(
    editing ? editing.category : EXPENSE_CATEGORIES[0],
  );
  const [payerUserId, setPayerUserId] = useState<string>(
    editing ? editing.payerUserId : currentUserId,
  );
  const [memo, setMemo] = useState<string>(editing?.memo ?? "");
  const [splitMethod, setSplitMethod] = useState<"equal" | "custom" | "ratio">(
    "equal",
  );
  // 커스텀/비율 분담 입력값 (userId → 입력값)
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsedAmount = parseInt(amount, 10);
    if (!parsedAmount || parsedAmount <= 0) {
      setError("금액을 올바르게 입력해 주세요.");
      return;
    }
    if (!category) {
      setError("카테고리를 선택해 주세요.");
      return;
    }
    if (!payerUserId) {
      setError("결제자를 선택해 주세요.");
      return;
    }

    // 커스텀/비율 분담 빌드
    let shares: ExpenseInput["shares"] | undefined;
    let participantUserIds: string[] | undefined;

    if (splitMethod === "custom") {
      shares = members
        .filter((m) => customInputs[m.userId])
        .map((m) => ({ userId: m.userId, amount: parseInt(customInputs[m.userId] ?? "0", 10) }));
      if (shares.length === 0) {
        setError("분담 금액을 입력해 주세요.");
        return;
      }
    } else if (splitMethod === "ratio") {
      shares = members
        .filter((m) => customInputs[m.userId])
        .map((m) => ({ userId: m.userId, ratio: parseFloat(customInputs[m.userId] ?? "0") }));
      if (shares.length === 0) {
        setError("비율을 입력해 주세요.");
        return;
      }
    } else {
      // 균등 — 전체 멤버 참여(participantUserIds 생략 = 전체)
      participantUserIds = undefined;
    }

    const input: ExpenseInput = {
      amount: parsedAmount,
      category,
      payerUserId,
      memo: memo || undefined,
      splitMethod,
      ...(participantUserIds !== undefined && { participantUserIds }),
      ...(shares !== undefined && { shares }),
    };

    startTransition(async () => {
      const result = editing
        ? await updateExpenseAction(moimId, editing.id, input)
        : await createExpenseAction(moimId, input);
      if (result?.error) {
        setError(result.error);
        return;
      }
      onClose();
    });
  }

  return (
    <>
      {/* 배경 오버레이 — fade-in + blur 로 부드럽게 어두워진다. */}
      <div
        className="animate-fade-in fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* 시트 — 아래에서 슬라이드업(인스타 바텀시트 시그니처). */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "지출 수정" : "지출 등록"}
        className="animate-slide-up fixed bottom-0 left-0 right-0 z-50 rounded-t-[1.75rem] bg-background shadow-2xl"
      >
        <div className="mx-auto mb-2 mt-3 h-1.5 w-12 rounded-full bg-muted" aria-hidden="true" />
        <div className="max-h-[80vh] overflow-y-auto px-5 pb-8 pt-4">
          <h2 className="mb-4 text-lg font-bold text-foreground">
            {editing ? "지출 수정" : "지출 등록"}
          </h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* 금액 */}
            <div className="flex flex-col gap-1">
              <label htmlFor="expense-amount" className="text-sm font-medium text-foreground">
                금액 (원)
              </label>
              <input
                id="expense-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="rounded-xl border border-border bg-card px-4 py-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                disabled={isPending}
                required
              />
            </div>

            {/* 카테고리 */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">카테고리</span>
              <div className="flex flex-wrap gap-2">
                {EXPENSE_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    disabled={isPending}
                    className={`rounded-full px-3 py-1.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                      category === cat
                        ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                        : "border border-border bg-card text-card-foreground hover:bg-secondary"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* 결제자 */}
            <div className="flex flex-col gap-1">
              <label htmlFor="expense-payer" className="text-sm font-medium text-foreground">
                결제자
              </label>
              <select
                id="expense-payer"
                value={payerUserId}
                onChange={(e) => setPayerUserId(e.target.value)}
                className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                disabled={isPending}
              >
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.nickname}{m.userId === currentUserId ? " (나)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {/* 메모 */}
            <div className="flex flex-col gap-1">
              <label htmlFor="expense-memo" className="text-sm font-medium text-foreground">
                메모 <span className="text-muted-foreground font-normal">(선택)</span>
              </label>
              <input
                id="expense-memo"
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="예) 저녁 식사"
                className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                disabled={isPending}
                maxLength={100}
              />
            </div>

            {/* 분담 방식 */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">분담 방식</span>
              <div className="flex gap-2">
                {(["equal", "custom", "ratio"] as const).map((method) => {
                  const label = method === "equal" ? "균등" : method === "custom" ? "커스텀 금액" : "커스텀 비율";
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => {
                        setSplitMethod(method);
                        setCustomInputs({});
                      }}
                      disabled={isPending}
                      className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                        splitMethod === method
                          ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                          : "border border-border bg-card text-card-foreground hover:bg-secondary"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* 커스텀/비율 멤버별 입력 */}
              {splitMethod !== "equal" ? (
                <div className="flex flex-col gap-2 mt-1">
                  {members.map((m) => (
                    <div key={m.userId} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-card-foreground">
                        {m.nickname}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={splitMethod === "ratio" ? "0.1" : "1"}
                        value={customInputs[m.userId] ?? ""}
                        onChange={(e) =>
                          setCustomInputs((prev) => ({ ...prev, [m.userId]: e.target.value }))
                        }
                        placeholder={splitMethod === "ratio" ? "비율" : "금액"}
                        className="w-24 rounded-xl border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                        disabled={isPending}
                      />
                      <span className="text-sm text-muted-foreground shrink-0">
                        {splitMethod === "ratio" ? "%" : "원"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <div className="flex gap-3 mt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="flex-1 rounded-xl border border-border py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="bg-gradient-brand flex-1 rounded-xl py-3 text-sm font-bold text-white shadow-md shadow-primary/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
              >
                {isPending ? "저장 중…" : editing ? "수정 완료" : "등록"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────
interface ExpensesViewProps {
  moimId: string;
  data: ExpenseListResponse;
  members: MoimMember[];
  /** userId → nickname 매핑 */
  nicknameMap: Record<string, string>;
  isOwner: boolean;
  currentUserId: string;
  accessToken: string;
}

// @MX:ANCHOR: [AUTO] ExpensesView — 경비 화면 단일 진입점(page.tsx에서 마운트)
// @MX:REASON: isOwner+currentUserId 조합으로 편집 권한 제어 + 실시간 구독 포함, fan_in 예상 >=3(page, 추후 확장)
export function ExpensesView({
  moimId,
  data,
  members,
  nicknameMap,
  isOwner,
  currentUserId,
  accessToken,
}: ExpensesViewProps) {
  const router = useRouter();

  // 실시간 구독 — 경비 변경 신호 수신 시 서버 재조회
  const handleChange = useCallback(() => {
    router.refresh();
  }, [router]);
  useExpenseChannel(moimId, accessToken, handleChange);

  // 시트 상태
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // 삭제 confirm 상태
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDeletePending, startDeleteTransition] = useTransition();

  // 정산 토글 상태
  const [isSettlePending, startSettleTransition] = useTransition();
  const [settleError, setSettleError] = useState<string | null>(null);

  function openSheet(expense?: Expense) {
    setEditingExpense(expense ?? null);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditingExpense(null);
  }

  function handleDelete(expenseId: string) {
    startDeleteTransition(async () => {
      const result = await deleteExpenseAction(moimId, expenseId);
      if (!result?.ok) {
        // 오류는 무시하고 다이얼로그 닫기(백엔드가 차단)
      }
      setDeletingId(null);
    });
  }

  function handleToggleSettle(tx: SettlementTransaction) {
    setSettleError(null);
    startSettleTransition(async () => {
      const result = await toggleSettlementAction(
        moimId,
        { fromUserId: tx.from, toUserId: tx.to, amount: tx.amount },
        !tx.settled,
      );
      if (result?.error) {
        setSettleError(result.error);
      }
    });
  }

  const { expenses, summary, settlement } = data;

  const nickname = (userId: string) =>
    nicknameMap[userId] ?? `사용자(${userId.slice(0, 6)})`;

  // 멤버별 지불 합계 계산(막대 차트용)
  const paidByUser: Record<string, number> = {};
  for (const e of expenses) {
    paidByUser[e.payerUserId] = (paidByUser[e.payerUserId] ?? 0) + e.amount;
  }
  const maxPaid = Math.max(...Object.values(paidByUser), 1);

  return (
    // 문서 스크롤: min-h-dvh 로 화면을 채우고(짧은 콘텐츠도 빈 공간 없음) 콘텐츠가 길면 흐름대로 자라 문서가
    // 스크롤된다(→ 브라우저 크롬 접힘). moims 그룹은 하단 탭바가 없어 회피 여백이 필요 없다.
    <div className="flex min-h-dvh flex-col bg-background">
      {/* 헤더 — sticky top-0 로 문서 스크롤 중 상단 고정(기존 유지). */}
      <header
        data-shell-header
        className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur"
      >
        <Link
          href={`/home/${moimId}`}
          aria-label="모임 상세로 돌아가기"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft size={22} />
        </Link>
        <h1 className="text-lg font-bold text-foreground">경비 관리</h1>
      </header>

      {/* 문서 스크롤: overflow-y-auto 제거(흐름대로 자람). flex-1 로 짧은 콘텐츠가 화면을 채운다. */}
      <div className="flex flex-1 flex-col gap-4 px-4 pb-24 pt-4">
        {/* 요약 카드 */}
        <div className={`grid gap-3 ${summary.budget != null ? "grid-cols-3" : "grid-cols-2"}`}>
          <SummaryCard
            label="총 지출"
            value={`${summary.total.toLocaleString()}원`}
          />
          <SummaryCard
            label="1인당"
            value={`${summary.perPerson.toLocaleString()}원`}
          />
          {summary.budget != null ? (
            <SummaryCard
              label="남은 예산"
              value={`${(summary.remaining ?? 0).toLocaleString()}원`}
              sub={`예산 ${summary.budget.toLocaleString()}원`}
            />
          ) : null}
        </div>

        {/* 카테고리 도넛 */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">카테고리별 지출</h2>
          <CategoryDonut expenses={expenses} />
        </section>

        {/* 멤버별 기여 막대 */}
        {members.length > 0 && Object.keys(paidByUser).length > 0 ? (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">멤버별 결제</h2>
            <ul className="flex flex-col gap-2">
              {members
                .filter((m) => paidByUser[m.userId])
                .sort((a, b) => (paidByUser[b.userId] ?? 0) - (paidByUser[a.userId] ?? 0))
                .map((m) => {
                  const paid = paidByUser[m.userId] ?? 0;
                  const pct = Math.round((paid / maxPaid) * 100);
                  return (
                    <li key={m.userId} className="flex flex-col gap-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-card-foreground">{m.nickname}</span>
                        <span className="text-muted-foreground">{paid.toLocaleString()}원</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="bg-gradient-brand h-full rounded-full transition-[width] duration-500 ease-out"
                          style={{ width: `${pct}%` }}
                          aria-hidden="true"
                        />
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        ) : null}

        {/* 정산 내역 */}
        {settlement.transactions.length > 0 ? (
          <section className="rounded-2xl border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-foreground">정산 내역</h2>
            {settleError ? (
              <p className="mb-2 text-sm text-destructive" role="alert">
                {settleError}
              </p>
            ) : null}
            <ul className="flex flex-col gap-2">
              {settlement.transactions.map((tx, idx) => (
                <li
                  key={idx}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-3 transition-opacity ${
                    tx.settled ? "border-border/40 bg-secondary/30 opacity-60" : "border-border bg-card"
                  }`}
                >
                  <span
                    className={`text-sm ${
                      tx.settled ? "line-through text-muted-foreground" : "text-card-foreground"
                    }`}
                  >
                    <span className="font-semibold">{nickname(tx.from)}</span>님이{" "}
                    <span className="font-semibold">{nickname(tx.to)}</span>님에게{" "}
                    <span className="font-semibold text-primary">
                      {tx.amount.toLocaleString()}원
                    </span>
                  </span>
                  {/* owner 전용 — 정산 완료/취소 토글 */}
                  {isOwner ? (
                    <button
                      type="button"
                      onClick={() => handleToggleSettle(tx)}
                      disabled={isSettlePending}
                      aria-label={tx.settled ? "정산 완료 취소" : "정산 완료 처리"}
                      title={tx.settled ? "완료 취소" : "정산 완료"}
                      className={`flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                        tx.settled
                          ? "bg-secondary text-muted-foreground hover:bg-secondary/80"
                          : "bg-primary/10 text-primary hover:bg-primary/20"
                      }`}
                    >
                      {tx.settled ? (
                        <>
                          <RotateCcw size={12} />
                          완료 취소
                        </>
                      ) : (
                        <>
                          <Check size={12} />
                          정산 완료
                        </>
                      )}
                    </button>
                  ) : tx.settled ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
                      <Check size={12} />
                      완료
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {/* 지출 목록 */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">지출 내역</h2>
          {expenses.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              아직 지출 내역이 없어요
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {expenses.map((expense) => (
                <li
                  key={expense.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"
                >
                  {/* 카테고리 색 도트 */}
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[expense.category] ?? "#6b7280" }}
                    aria-hidden="true"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {expense.category}
                      </span>
                      {expense.memo ? (
                        <span className="truncate text-xs text-muted-foreground">{expense.memo}</span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {nickname(expense.payerUserId)} 결제
                    </div>
                  </div>
                  <span className="shrink-0 font-bold text-primary">
                    {expense.amount.toLocaleString()}원
                  </span>
                  {/* owner 전용 편집/삭제 */}
                  {isOwner ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="지출 수정"
                        title="수정"
                        onClick={() => openSheet(expense)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="지출 삭제"
                        title="삭제"
                        onClick={() => setDeletingId(expense.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* FAB — owner 전용 */}
      {isOwner ? (
        <button
          type="button"
          aria-label="지출 등록"
          onClick={() => openSheet()}
          className="bg-gradient-brand animate-scale-in fixed bottom-6 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl shadow-primary/30 transition-transform hover:scale-105 hover:rotate-90 active:scale-95"
        >
          <Plus size={26} />
        </button>
      ) : null}

      {/* 지출 등록/수정 바텀시트 */}
      {sheetOpen ? (
        <ExpenseSheet
          moimId={moimId}
          members={members}
          currentUserId={currentUserId}
          editing={editingExpense}
          onClose={closeSheet}
        />
      ) : null}

      {/* 삭제 확인 다이얼로그 */}
      {deletingId ? (
        <DeleteConfirmDialog
          isPending={isDeletePending}
          onCancel={() => setDeletingId(null)}
          onConfirm={() => handleDelete(deletingId)}
        />
      ) : null}
    </div>
  );
}
