import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Expense, ExpenseShare, Settlement } from '../generated/prisma/client';
import { MoimService } from '../moim/moim.service';
import { PrismaService } from '../prisma/prisma.service';

// 카테고리 프리셋(REQ-EXP-003). DB enum 없이 컨트롤러/서비스에서 검증.
export const EXPENSE_CATEGORIES = ['식비', '교통', '숙박', '입장', '준비물', '기타'] as const;

// 분배 방식 프리셋(REQ-EXP-004).
const SPLIT_METHODS = ['equal', 'custom', 'ratio'] as const;
type SplitMethod = (typeof SPLIT_METHODS)[number];

// 분담 입력 타입(컨트롤러에서 전달).
export interface ShareInput {
  userId: string;
  amount?: number;
  ratio?: number;
}

// 서비스가 반환하는 경비 + 분담 타입.
export interface ExpenseWithShares extends Expense {
  shares: ExpenseShare[];
}

// 정산 거래 타입(settled 플래그 포함).
export interface SettlementTransaction {
  from: string;
  to: string;
  amount: number;
  settled: boolean;
}

// GET 응답을 위한 집계 타입.
export interface ExpenseListResult {
  expenses: ExpenseWithShares[];
  summary: {
    total: number;
    perPerson: number;
    budget: number | null;
    remaining: number | null;
  };
  settlement: {
    balances: { userId: string; balance: number }[];
    transactions: SettlementTransaction[];
  };
}

@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    // @MX:NOTE: [AUTO] 멤버십 인가는 MoimService.assertMember/assertOwner 단일 출처를 재사용한다(재구현 금지).
    private readonly moim: MoimService,
  ) {}

  // @MX:ANCHOR: [AUTO] 경비 생성의 단일 진입점(REQ-EXP-002/004 / AC-1/2/2b). 컨트롤러(POST /moims/:id/expenses)가 호출한다.
  // @MX:REASON: owner 전용 + Expense+ExpenseShare 원자 생성(트랜잭션). splitMethod 별 분담 산정 + 합=amount 불변식.
  // 비율 분배는 금액으로 환산해 ExpenseShare.shareAmount 에만 저장한다(ratio 컬럼 없음 — 정산 단순화).
  async createExpense(
    sub: string,
    moimId: string,
    amount: number,
    category: string,
    payerUserId: string,
    memo: string | undefined,
    splitMethod: SplitMethod,
    participantUserIds: string[] | undefined,
    shares: ShareInput[] | undefined,
  ): Promise<ExpenseWithShares> {
    // owner 인가(비-owner/모임 미존재 → 403).
    await this.moim.assertOwner(sub, moimId);

    // 검증: payerUserId 가 그 모임의 멤버인지(400).
    await this.requireMember(payerUserId, moimId);

    // 분담 materialize: splitMethod 에 따라 각 멤버의 shareAmount 를 계산한다.
    const shareRows = await this.computeShares(
      moimId,
      amount,
      splitMethod,
      participantUserIds,
      shares,
    );

    return this.prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          moimId,
          amount,
          category,
          payerUserId,
          memo: memo ?? null,
          createdBy: sub,
        },
      });
      if (shareRows.length > 0) {
        await tx.expenseShare.createMany({
          data: shareRows.map((r) => ({
            expenseId: expense.id,
            userId: r.userId,
            shareAmount: r.shareAmount,
          })),
        });
      }
      const created = await tx.expense.findUnique({
        where: { id: expense.id },
        include: { shares: true },
      });
      return created as ExpenseWithShares;
    });
  }

  // @MX:ANCHOR: [AUTO] 경비 목록 + 요약 + 정산 조회의 단일 진입점(REQ-EXP-005 / AC-5). 멤버 한정.
  // @MX:REASON: balance 계산(payer합-share합) + greedy 최소 거래 + settled 마커 매칭을 서버에서 단일 계산.
  async listExpenses(sub: string, moimId: string): Promise<ExpenseListResult> {
    // 멤버 인가(비멤버/모임 미존재 → 403).
    await this.moim.assertMember(sub, moimId);

    // moim.budget 조회.
    const moimRow = await this.prisma.moim.findUnique({ where: { id: moimId } });
    const budget = (moimRow as { budget?: number | null })?.budget ?? null;

    // 경비 목록(분담 포함).
    const expenses = await this.prisma.expense.findMany({
      where: { moimId },
      include: { shares: true },
      orderBy: { createdAt: 'asc' },
    });

    // 현재 모임 멤버 목록(perPerson 계산용).
    const memberRows = await this.prisma.moimMember.findMany({
      where: { moimId },
    });
    const memberCount = memberRows.length;

    // 총 지출 합계.
    const total = expenses.reduce((acc, e) => acc + e.amount, 0);
    const perPerson = memberCount > 0 ? Math.floor(total / memberCount) : 0;
    const remaining = budget !== null ? budget - total : null;

    if (expenses.length === 0) {
      return {
        expenses: expenses as ExpenseWithShares[],
        summary: { total: 0, perPerson: 0, budget, remaining },
        settlement: { balances: [], transactions: [] },
      };
    }

    // balance 계산: 각 멤버의 balance = payer 합 - share 합.
    const balanceMap = new Map<string, number>();
    for (const exp of expenses) {
      const prev = balanceMap.get(exp.payerUserId) ?? 0;
      balanceMap.set(exp.payerUserId, prev + exp.amount);
    }
    for (const exp of expenses) {
      for (const share of exp.shares) {
        const prev = balanceMap.get(share.userId) ?? 0;
        balanceMap.set(share.userId, prev - share.shareAmount);
      }
    }
    const balances = [...balanceMap.entries()]
      .filter(([, bal]) => bal !== 0)
      .map(([userId, balance]) => ({ userId, balance }));

    // greedy 최소 거래 계산(Tricount식).
    const transactions = computeMinTransactions(balanceMap);

    // settled 마커 매칭: (from,to,amount) 가 일치하는 Settlement 마커가 있으면 settled=true.
    const markers = await this.prisma.settlement.findMany({
      where: { moimId },
    });
    const markerSet = new Set<string>(
      markers.map((m) => markerKey(m.fromUserId, m.toUserId, m.amount)),
    );
    const txWithSettled = transactions.map((t) => ({
      ...t,
      settled: markerSet.has(markerKey(t.from, t.to, t.amount)),
    }));

    return {
      expenses: expenses as ExpenseWithShares[],
      summary: { total, perPerson, budget, remaining },
      settlement: { balances, transactions: txWithSettled },
    };
  }

  // 경비 삭제(REQ-EXP-006 / AC-7). owner 전용 + expense-moim 일관성 검증.
  async deleteExpense(sub: string, moimId: string, expenseId: string): Promise<void> {
    await this.moim.assertOwner(sub, moimId);
    const expense = await this.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!expense || expense.moimId !== moimId) {
      throw new NotFoundException();
    }
    // ExpenseShare 는 FK cascade 로 함께 삭제된다.
    await this.prisma.expense.delete({ where: { id: expenseId } });
  }

  // @MX:ANCHOR: [AUTO] 경비 수정의 단일 진입점(REQ-EXP-007 / AC-11). ExpenseShare 재 materialize(deleteMany+create).
  // @MX:REASON: vote 의 단일 교체(deleteMany+create) 선례 — 기존 분담 행을 모두 삭제하고 재산정 행으로 교체(트랜잭션).
  async updateExpense(
    sub: string,
    moimId: string,
    expenseId: string,
    amount: number | undefined,
    category: string | undefined,
    payerUserId: string | undefined,
    memo: string | null | undefined,
    splitMethod: SplitMethod | undefined,
    participantUserIds: string[] | undefined,
    shares: ShareInput[] | undefined,
  ): Promise<ExpenseWithShares> {
    await this.moim.assertOwner(sub, moimId);

    // expense-moim 일관성 검증(타-모임/미존재 → 404).
    const existing = await this.prisma.expense.findUnique({ where: { id: expenseId } });
    if (!existing || existing.moimId !== moimId) {
      throw new NotFoundException();
    }

    // 실제 갱신할 값(미전달 필드는 기존값 유지).
    const newAmount = amount ?? existing.amount;
    const newCategory = category ?? existing.category;
    const newPayerUserId = payerUserId ?? existing.payerUserId;
    // memo: undefined=미전달(유지), null=명시적 해제, string=갱신.
    const newMemo = memo === undefined ? existing.memo : memo;

    // payerUserId 갱신 시 멤버 검증.
    if (payerUserId !== undefined) {
      await this.requireMember(payerUserId, moimId);
    }

    // 분담 재산정(splitMethod/participantUserIds/shares 중 하나라도 전달 시 재계산).
    const needReshare =
      amount !== undefined ||
      splitMethod !== undefined ||
      participantUserIds !== undefined ||
      shares !== undefined;
    const effectiveSplitMethod: SplitMethod = splitMethod ?? 'equal';

    let newShares: { userId: string; shareAmount: number }[] = [];
    if (needReshare) {
      newShares = await this.computeShares(
        moimId,
        newAmount,
        effectiveSplitMethod,
        participantUserIds,
        shares,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.expense.update({
        where: { id: expenseId },
        data: {
          amount: newAmount,
          category: newCategory,
          payerUserId: newPayerUserId,
          memo: newMemo,
        },
      });

      if (needReshare) {
        // 단일 교체 vote 선례: 기존 분담 행을 모두 삭제하고 재산정 행으로 교체.
        await tx.expenseShare.deleteMany({ where: { expenseId } });
        if (newShares.length > 0) {
          await tx.expenseShare.createMany({
            data: newShares.map((r) => ({
              expenseId,
              userId: r.userId,
              shareAmount: r.shareAmount,
            })),
          });
        }
      }

      const updated = await tx.expense.findUnique({
        where: { id: expenseId },
        include: { shares: true },
      });
      return updated as ExpenseWithShares;
    });
  }

  // @MX:ANCHOR: [AUTO] 정산 완료 마커 생성의 단일 진입점(REQ-EXP-009 / AC-12). 멱등 + 존재 거래 검증.
  // @MX:REASON: 마커 생성 전 현재 정산 계산 거래 집합에 (from,to,amount) 가 존재하는지 확인(400 차단). 멱등.
  async createSettlement(
    sub: string,
    moimId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
  ): Promise<Settlement> {
    await this.moim.assertOwner(sub, moimId);

    // 현재 정산 계산 결과에 해당 거래가 존재하는지 확인(400 — 임의의 from/to/amount 마커 생성 금지).
    const current = await this.listExpenses(sub, moimId);
    const exists = current.settlement.transactions.some(
      (t) => t.from === fromUserId && t.to === toUserId && t.amount === amount,
    );
    if (!exists) {
      throw new BadRequestException(
        '해당 정산 거래가 현재 계산된 거래 집합에 존재하지 않습니다',
      );
    }

    // 멱등: 이미 같은 (from,to,amount) 마커가 있으면 기존 마커 반환(중복 생성 안 함).
    const existing = await this.prisma.settlement.findFirst({
      where: { moimId, fromUserId, toUserId, amount },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.settlement.create({
      data: { moimId, fromUserId, toUserId, amount, settledBy: sub },
    });
  }

  // 정산 완료 마커 삭제(REQ-EXP-009 / AC-12). owner 전용.
  async deleteSettlement(
    sub: string,
    moimId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
  ): Promise<void> {
    await this.moim.assertOwner(sub, moimId);
    await this.prisma.settlement.deleteMany({
      where: { moimId, fromUserId, toUserId, amount },
    });
  }

  // settlementId 로 삭제(DEL /moims/:id/settlements/:settlementId).
  async deleteSettlementById(
    sub: string,
    moimId: string,
    settlementId: string,
  ): Promise<void> {
    await this.moim.assertOwner(sub, moimId);
    const marker = await this.prisma.settlement.findUnique({ where: { id: settlementId } });
    if (!marker || marker.moimId !== moimId) {
      throw new NotFoundException();
    }
    await this.prisma.settlement.delete({ where: { id: settlementId } });
  }

  // ── 내부 헬퍼 ──────────────────────────────────────────────────────────────

  // userId 가 그 모임의 멤버인지 확인(멤버가 아니면 400).
  private async requireMember(userId: string, moimId: string): Promise<void> {
    const member = await this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId, userId } },
    });
    if (!member) {
      throw new BadRequestException(
        `payerUserId(${userId})가 해당 모임의 멤버가 아닙니다`,
      );
    }
  }

  // @MX:WARN: [AUTO] splitMethod 별 분담 산정 + 나머지 결정적 배분 로직. 분담 합 = amount 불변식.
  // @MX:REASON: equal/custom/ratio 세 분기 + 나머지 배분(원 단위 누락 방지) — 정산 정확성의 핵심.
  private async computeShares(
    moimId: string,
    amount: number,
    splitMethod: SplitMethod,
    participantUserIds: string[] | undefined,
    shares: ShareInput[] | undefined,
  ): Promise<{ userId: string; shareAmount: number }[]> {
    if (splitMethod === 'equal') {
      // 참가자 목록: 생략 시 전 멤버.
      let participants: string[];
      if (participantUserIds && participantUserIds.length > 0) {
        participants = participantUserIds;
      } else {
        const members = await this.prisma.moimMember.findMany({ where: { moimId } });
        participants = members.map((m) => m.userId);
      }
      if (participants.length === 0) {
        throw new BadRequestException('분배 대상이 비어 있습니다');
      }
      // 참가자가 모임 멤버인지 검증.
      for (const uid of participants) {
        await this.requireMember(uid, moimId);
      }
      return equalSplit(amount, participants);
    }

    if (splitMethod === 'custom') {
      if (!shares || shares.length === 0) {
        throw new BadRequestException('custom 분배는 shares 가 필요합니다');
      }
      // 참가자 멤버 검증.
      for (const s of shares) {
        await this.requireMember(s.userId, moimId);
        if ((s.amount ?? 0) < 0) {
          throw new BadRequestException('shareAmount 는 0 이상이어야 합니다');
        }
      }
      const total = shares.reduce((acc, s) => acc + (s.amount ?? 0), 0);
      if (total !== amount) {
        throw new BadRequestException(
          `custom 분배 합(${total})이 amount(${amount})와 일치하지 않습니다`,
        );
      }
      return shares.map((s) => ({ userId: s.userId, shareAmount: s.amount ?? 0 }));
    }

    // ratio
    if (!shares || shares.length === 0) {
      throw new BadRequestException('ratio 분배는 shares 가 필요합니다');
    }
    for (const s of shares) {
      await this.requireMember(s.userId, moimId);
      if ((s.ratio ?? 0) <= 0) {
        throw new BadRequestException('ratio 는 0 초과여야 합니다');
      }
    }
    const totalRatio = shares.reduce((acc, s) => acc + (s.ratio ?? 0), 0);
    if (totalRatio <= 0) {
      throw new BadRequestException('비율 합이 0 이하입니다');
    }
    return ratioSplit(amount, shares as { userId: string; ratio: number }[]);
  }
}

// ── 순수 계산 함수 ────────────────────────────────────────────────────────────

// 균등 분배: 나머지는 앞선 참가자에게 1원씩 배분해 분담 합 = amount 보장.
function equalSplit(
  amount: number,
  participants: string[],
): { userId: string; shareAmount: number }[] {
  const n = participants.length;
  const base = Math.floor(amount / n);
  const remainder = amount - base * n;
  return participants.map((userId, idx) => ({
    userId,
    shareAmount: idx < remainder ? base + 1 : base,
  }));
}

// 비율 분배: 안분 후 나머지를 앞선 참가자에게 1원씩 배분해 분담 합 = amount 보장.
function ratioSplit(
  amount: number,
  shares: { userId: string; ratio: number }[],
): { userId: string; shareAmount: number }[] {
  const totalRatio = shares.reduce((acc, s) => acc + s.ratio, 0);
  const baseAmounts = shares.map((s) => Math.floor((amount * s.ratio) / totalRatio));
  const allocated = baseAmounts.reduce((acc, v) => acc + v, 0);
  let remainder = amount - allocated;
  return shares.map((s, idx) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { userId: s.userId, shareAmount: baseAmounts[idx] + extra };
  });
}

// greedy 최소 거래 계산(Tricount식).
// balance 양수=채권자(받을 사람), 음수=채무자(낼 사람). 전 멤버 balance 합 = 0.
function computeMinTransactions(
  balanceMap: Map<string, number>,
): { from: string; to: string; amount: number }[] {
  // balance != 0 인 멤버만.
  const creditors: { userId: string; amount: number }[] = [];
  const debtors: { userId: string; amount: number }[] = [];
  for (const [userId, bal] of balanceMap.entries()) {
    if (bal > 0) creditors.push({ userId, amount: bal });
    else if (bal < 0) debtors.push({ userId, amount: -bal }); // 양수로 변환
  }

  const transactions: { from: string; to: string; amount: number }[] = [];

  // greedy: 가장 큰 채무자 ↔ 가장 큰 채권자 매칭.
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const c = creditors[ci];
    const d = debtors[di];
    const tx = Math.min(c.amount, d.amount);
    transactions.push({ from: d.userId, to: c.userId, amount: tx });
    c.amount -= tx;
    d.amount -= tx;
    if (c.amount === 0) ci++;
    if (d.amount === 0) di++;
  }

  return transactions;
}

// settled 마커 매칭 키.
function markerKey(fromUserId: string, toUserId: string, amount: number): string {
  return `${fromUserId}:${toUserId}:${amount}`;
}
