import { BadRequestException } from '@nestjs/common';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { ExpenseController, SettlementController } from './expense.controller';
import type { ExpenseListResult, ExpenseService, ExpenseWithShares } from './expense.service';

// ExpenseController / SettlementController 단위 테스트(SPEC-MOIM-EXPENSE-001).
// ExpenseService 는 mock 으로 대체해 라우팅 + DTO 매핑 + 수동 400 검증만 검증한다.
// 401/403/404 가드/인가 배선은 integration 레벨에서 검증하므로 여기선 제외한다.
// poll.controller.spec.ts 패턴 미러.

const USER: VerifiedUser = { sub: 'sub-owner', role: 'authenticated' };

// ExpenseService 의 createExpense 가 반환하는 형태.
const EXPENSE_WITH_SHARES: ExpenseWithShares = {
  id: 'exp-1',
  moimId: 'moim-A',
  amount: 10000,
  category: '식비',
  payerUserId: 'sub-owner',
  memo: null,
  createdBy: 'sub-owner',
  createdAt: new Date('2026-06-24T00:00:00.000Z'),
  updatedAt: new Date('2026-06-24T00:00:00.000Z'),
  shares: [
    { id: 'share-1', expenseId: 'exp-1', userId: 'sub-owner', shareAmount: 5000, createdAt: new Date('2026-06-24T00:00:00.000Z') },
    { id: 'share-2', expenseId: 'exp-1', userId: 'user-B', shareAmount: 5000, createdAt: new Date('2026-06-24T00:00:00.000Z') },
  ],
};

// listExpenses 가 반환하는 집계 형태.
const LIST_RESULT: ExpenseListResult = {
  expenses: [EXPENSE_WITH_SHARES],
  summary: { total: 10000, perPerson: 5000, budget: null, remaining: null },
  settlement: {
    balances: [
      { userId: 'sub-owner', balance: 5000 },
      { userId: 'user-B', balance: -5000 },
    ],
    transactions: [
      { from: 'user-B', to: 'sub-owner', amount: 5000, settled: false },
    ],
  },
};

function makeService(): {
  service: ExpenseService;
  mocks: {
    createExpense: jest.Mock;
    listExpenses: jest.Mock;
    updateExpense: jest.Mock;
    deleteExpense: jest.Mock;
    createSettlement: jest.Mock;
    deleteSettlement: jest.Mock;
    deleteSettlementById: jest.Mock;
  };
} {
  const mocks = {
    createExpense: jest.fn().mockResolvedValue(EXPENSE_WITH_SHARES),
    listExpenses: jest.fn().mockResolvedValue(LIST_RESULT),
    updateExpense: jest.fn().mockResolvedValue(EXPENSE_WITH_SHARES),
    deleteExpense: jest.fn().mockResolvedValue(undefined),
    createSettlement: jest.fn().mockResolvedValue({
      id: 'settle-1',
      moimId: 'moim-A',
      fromUserId: 'user-B',
      toUserId: 'sub-owner',
      amount: 5000,
      settledBy: 'sub-owner',
      settledAt: new Date('2026-06-24T00:00:00.000Z'),
    }),
    deleteSettlement: jest.fn().mockResolvedValue(undefined),
    deleteSettlementById: jest.fn().mockResolvedValue(undefined),
  };
  return { service: mocks as unknown as ExpenseService, mocks };
}

describe('ExpenseController', () => {
  describe('POST /moims/:id/expenses (create, REQ-EXP-002/004 AC-1/2/2b)', () => {
    it('유효한 body 로 createExpense 를 호출하고 DTO 를 반환한다(201)', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      const res = await controller.create(USER, 'moim-A', {
        amount: 10000,
        category: '식비',
        payerUserId: 'sub-owner',
        splitMethod: 'equal',
      });

      expect(mocks.createExpense).toHaveBeenCalledWith(
        'sub-owner',
        'moim-A',
        10000,
        '식비',
        'sub-owner',
        undefined,
        'equal',
        undefined,
        undefined,
      );
      expect(res.id).toBe('exp-1');
      expect(res.amount).toBe(10000);
      expect(res.shares).toHaveLength(2);
    });

    it('amount 가 1 미만 정수이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          amount: 0, // 0 은 허용 안 됨
          category: '식비',
          payerUserId: 'sub-owner',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createExpense).not.toHaveBeenCalled();
    });

    it('category 가 프리셋 외 값이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          amount: 5000,
          category: '불법카테고리',
          payerUserId: 'sub-owner',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createExpense).not.toHaveBeenCalled();
    });

    it('payerUserId 가 빈 문자열이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          amount: 5000,
          category: '식비',
          payerUserId: '   ', // 빈 문자열
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createExpense).not.toHaveBeenCalled();
    });

    it('splitMethod 가 무효 값이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          amount: 5000,
          category: '식비',
          payerUserId: 'sub-owner',
          splitMethod: 'bogus' as never,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createExpense).not.toHaveBeenCalled();
    });

    it('splitMethod 생략 시 "equal" 로 서비스를 호출한다', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await controller.create(USER, 'moim-A', {
        amount: 5000,
        category: '식비',
        payerUserId: 'sub-owner',
      });

      // splitMethod 는 7번째 인자 — "equal" 이 기본값으로 전달된다.
      const callArgs: unknown[] = mocks.createExpense.mock.calls[0];
      expect(callArgs[6]).toBe('equal');
    });
  });

  describe('GET /moims/:id/expenses (list, REQ-EXP-005 AC-5)', () => {
    it('listExpenses 결과를 DTO 형태로 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      const res = await controller.list(USER, 'moim-A');

      expect(mocks.listExpenses).toHaveBeenCalledWith('sub-owner', 'moim-A');
      expect(res.expenses).toHaveLength(1);
      expect(res.summary.total).toBe(10000);
      expect(res.settlement.transactions).toHaveLength(1);
    });
  });

  describe('PATCH /moims/:id/expenses/:expenseId (update, REQ-EXP-007 AC-11)', () => {
    it('유효한 body 로 updateExpense 를 호출하고 DTO 를 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      const res = await controller.update(USER, 'moim-A', 'exp-1', {
        amount: 10000,
        category: '교통',
      });

      expect(mocks.updateExpense).toHaveBeenCalled();
      expect(res.id).toBe('exp-1');
    });

    it('amount 가 0 이하이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await expect(
        controller.update(USER, 'moim-A', 'exp-1', {
          amount: -1,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.updateExpense).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /moims/:id/expenses/:expenseId (remove, REQ-EXP-006 AC-7)', () => {
    it('deleteExpense 를 호출하고 void 를 반환한다(204)', async () => {
      const { service, mocks } = makeService();
      const controller = new ExpenseController(service);

      await controller.remove(USER, 'moim-A', 'exp-1');

      expect(mocks.deleteExpense).toHaveBeenCalledWith('sub-owner', 'moim-A', 'exp-1');
    });
  });
});

describe('SettlementController', () => {
  describe('POST /moims/:id/settlements (create, REQ-EXP-009 AC-12)', () => {
    it('유효한 body 로 createSettlement 를 호출하고 DTO 를 반환한다(201)', async () => {
      const { service, mocks } = makeService();
      const controller = new SettlementController(service);

      const res = await controller.create(USER, 'moim-A', {
        fromUserId: 'user-B',
        toUserId: 'sub-owner',
        amount: 5000,
      });

      expect(mocks.createSettlement).toHaveBeenCalledWith(
        'sub-owner',
        'moim-A',
        'user-B',
        'sub-owner',
        5000,
      );
      expect(res.id).toBe('settle-1');
    });

    it('fromUserId 가 빈 문자열이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new SettlementController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          fromUserId: '',
          toUserId: 'sub-owner',
          amount: 5000,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createSettlement).not.toHaveBeenCalled();
    });

    it('amount 가 0 이하이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new SettlementController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          fromUserId: 'user-B',
          toUserId: 'sub-owner',
          amount: 0,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createSettlement).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /moims/:id/settlements (removeByFields)', () => {
    it('body 의 (fromUserId,toUserId,amount) 로 deleteSettlement 를 호출한다', async () => {
      const { service, mocks } = makeService();
      const controller = new SettlementController(service);

      await controller.removeByFields(
        USER,
        'moim-A',
        { fromUserId: 'user-B', toUserId: 'sub-owner', amount: 5000 },
      );

      expect(mocks.deleteSettlement).toHaveBeenCalledWith(
        'sub-owner',
        'moim-A',
        'user-B',
        'sub-owner',
        5000,
      );
    });
  });

  describe('DELETE /moims/:id/settlements/:settlementId (removeById)', () => {
    it('settlementId 로 deleteSettlementById 를 호출한다', async () => {
      const { service, mocks } = makeService();
      const controller = new SettlementController(service);

      await controller.removeById(USER, 'moim-A', 'settle-1');

      expect(mocks.deleteSettlementById).toHaveBeenCalledWith(
        'sub-owner',
        'moim-A',
        'settle-1',
      );
    });
  });
});
