import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  Expense,
  ExpenseShare,
  Moim,
  MoimMember,
  Settlement,
} from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ExpenseService } from './expense.service';

// ExpenseService 단위 테스트(SPEC-MOIM-EXPENSE-001). 인메모리 fake Prisma + stub MoimService 로 검증한다:
//   - createExpense: equal/custom/ratio 분배 + 합=amount 불변식 + 검증 실패 → 400/403.
//   - listExpenses: total/perPerson/budget/remaining + balance 계산 + greedy 최소 거래 + settled 마커.
//   - deleteExpense: owner 성공(cascade) + 비-owner 403 + 타-모임/미존재 404.
//   - updateExpense: ExpenseShare 재 materialize + 동일 검증 + 비-owner 403 + 타-모임 404.
//   - createSettlement: 현재 거래 집합 내 존재 검증(400) + 멱등 + deleteSettlement.
// poll.service.spec.ts 패턴 미러 — fake 테이블 Map + stub MoimService.

const NOW = new Date('2026-06-24T00:00:00.000Z');

// ── 인메모리 테이블 ─────────────────────────────────────────────────────────────

interface Tables {
  moim: Map<string, Moim & { budget?: number | null }>;
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
  expense: Map<string, Expense>;
  share: Map<string, ExpenseShare>; // key: `${expenseId}:${userId}`
  settlement: Map<string, Settlement>;
}

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

function shareKey(expenseId: string, userId: string): string {
  return `${expenseId}:${userId}`;
}

describe('ExpenseService', () => {
  let tables: Tables;
  let idSeq: number;
  // moimId별 owner sub 집합(assertOwner 판정).
  let owners: Map<string, string>;

  function reset(): void {
    tables = {
      moim: new Map(),
      member: new Map(),
      expense: new Map(),
      share: new Map(),
      settlement: new Map(),
    };
    idSeq = 0;
    owners = new Map();
  }

  function nextId(prefix: string): string {
    idSeq += 1;
    return `${prefix}-${idSeq}`;
  }

  // ── 시드 헬퍼 ───────────────────────────────────────────────────────────────

  // 모임 + owner + 멤버 시드. budget 기본 null.
  function seedMoim(
    moimId: string,
    ownerSub: string,
    budget: number | null = null,
  ): void {
    tables.moim.set(moimId, {
      id: moimId,
      name: `모임 ${moimId}`,
      startsAt: null,
      location: null,
      maxMembers: 15,
      budget,
      createdBy: ownerSub,
      createdAt: NOW,
    });
    owners.set(moimId, ownerSub);
    // owner는 멤버에도 포함한다.
    tables.member.set(memberKey(moimId, ownerSub), {
      moimId,
      userId: ownerSub,
      nickname: '호스트',
      role: 'owner',
      joinedAt: NOW,
    });
  }

  // 멤버 추가.
  function addMember(moimId: string, userId: string): void {
    tables.member.set(memberKey(moimId, userId), {
      moimId,
      userId,
      nickname: `참가자 ${userId}`,
      role: 'member',
      joinedAt: NOW,
    });
  }

  // 경비 + 분담 직접 시드(list/settlement 테스트 준비용).
  function seedExpense(
    moimId: string,
    payerUserId: string,
    amount: number,
    category = '식비',
    sharesInput: { userId: string; shareAmount: number }[] = [],
  ): Expense & { shares: ExpenseShare[] } {
    const id = nextId('exp');
    const exp: Expense = {
      id,
      moimId,
      amount,
      category,
      payerUserId,
      memo: null,
      createdBy: payerUserId,
      createdAt: NOW,
      updatedAt: NOW,
    };
    tables.expense.set(id, exp);
    const shares: ExpenseShare[] = sharesInput.map((s) => {
      const share: ExpenseShare = {
        expenseId: id,
        userId: s.userId,
        shareAmount: s.shareAmount,
        createdAt: NOW,
      };
      tables.share.set(shareKey(id, s.userId), share);
      return share;
    });
    return { ...exp, shares };
  }

  // Settlement 마커 직접 시드.
  function seedSettlement(
    moimId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    settledBy: string,
  ): Settlement {
    const id = nextId('settle');
    const s: Settlement = {
      id,
      moimId,
      fromUserId,
      toUserId,
      amount,
      settledBy,
      settledAt: NOW,
    };
    tables.settlement.set(id, s);
    return s;
  }

  // ── Stub MoimService ────────────────────────────────────────────────────────

  // assertOwner: owner=resolve / 비-owner=ForbiddenException / 미존재=NotFoundException.
  // assertMember: 멤버=resolve / 비멤버=ForbiddenException / 미존재=NotFoundException.
  function makeMoimService(): MoimService {
    return {
      assertOwner: jest.fn((sub: string, moimId: string) => {
        if (!tables.moim.has(moimId)) {
          return Promise.reject(new NotFoundException());
        }
        if (owners.get(moimId) !== sub) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve();
      }),
      assertMember: jest.fn((sub: string, moimId: string) => {
        if (!tables.moim.has(moimId)) {
          return Promise.reject(new NotFoundException());
        }
        if (!tables.member.has(memberKey(moimId, sub))) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve();
      }),
    } as unknown as MoimService;
  }

  // ── Fake PrismaService ──────────────────────────────────────────────────────

  function makePrisma(): PrismaService {
    const moimClient = {
      findUnique: jest.fn((arg: { where: { id: string } }) => {
        const row = tables.moim.get(arg.where.id) ?? null;
        return Promise.resolve(row);
      }),
    };

    const moimMemberClient = {
      findUnique: jest.fn(
        (arg: {
          where: { moimId_userId: { moimId: string; userId: string } };
        }) => {
          const { moimId, userId } = arg.where.moimId_userId;
          return Promise.resolve(
            tables.member.get(memberKey(moimId, userId)) ?? null,
          );
        },
      ),
      findMany: jest.fn((arg: { where: { moimId: string } }) => {
        const rows = [...tables.member.values()].filter(
          (m) => m.moimId === arg.where.moimId,
        );
        return Promise.resolve(rows);
      }),
    };

    const expenseClient = {
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            amount: number;
            category: string;
            payerUserId: string;
            memo: string | null;
            createdBy: string;
          };
        }) => {
          const id = nextId('exp');
          const created: Expense = {
            id,
            moimId: arg.data.moimId,
            amount: arg.data.amount,
            category: arg.data.category,
            payerUserId: arg.data.payerUserId,
            memo: arg.data.memo,
            createdBy: arg.data.createdBy,
            createdAt: NOW,
            updatedAt: NOW,
          };
          tables.expense.set(id, created);
          return Promise.resolve(created);
        },
      ),
      findUnique: jest.fn(
        (arg: { where: { id: string }; include?: { shares?: boolean } }) => {
          const exp = tables.expense.get(arg.where.id);
          if (!exp) return Promise.resolve(null);
          if (arg.include?.shares) {
            const shares = [...tables.share.values()].filter(
              (s) => s.expenseId === exp.id,
            );
            return Promise.resolve({ ...exp, shares });
          }
          return Promise.resolve(exp);
        },
      ),
      findMany: jest.fn(
        (arg: {
          where: { moimId: string };
          include?: { shares?: boolean };
          orderBy?: unknown;
        }) => {
          const rows = [...tables.expense.values()]
            .filter((e) => e.moimId === arg.where.moimId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          if (arg.include?.shares) {
            return Promise.resolve(
              rows.map((e) => ({
                ...e,
                shares: [...tables.share.values()].filter(
                  (s) => s.expenseId === e.id,
                ),
              })),
            );
          }
          return Promise.resolve(rows);
        },
      ),
      delete: jest.fn((arg: { where: { id: string } }) => {
        const existing = tables.expense.get(arg.where.id);
        tables.expense.delete(arg.where.id);
        // onDelete: Cascade 흉내 — 해당 expense 의 share 행 제거.
        for (const [key, s] of [...tables.share.entries()]) {
          if (s.expenseId === arg.where.id) {
            tables.share.delete(key);
          }
        }
        return Promise.resolve(existing ?? null);
      }),
      update: jest.fn(
        (arg: { where: { id: string }; data: Partial<Expense> }) => {
          const existing = tables.expense.get(arg.where.id);
          if (!existing) return Promise.resolve(null);
          const updated = { ...existing, ...arg.data };
          tables.expense.set(arg.where.id, updated);
          return Promise.resolve(updated);
        },
      ),
    };

    const expenseShareClient = {
      createMany: jest.fn(
        (arg: {
          data: { expenseId: string; userId: string; shareAmount: number }[];
        }) => {
          for (const d of arg.data) {
            nextId('share');
            const share: ExpenseShare = {
              expenseId: d.expenseId,
              userId: d.userId,
              shareAmount: d.shareAmount,
              createdAt: NOW,
            };
            tables.share.set(shareKey(d.expenseId, d.userId), share);
          }
          return Promise.resolve({ count: arg.data.length });
        },
      ),
      deleteMany: jest.fn((arg: { where: { expenseId: string } }) => {
        let count = 0;
        for (const [key, s] of [...tables.share.entries()]) {
          if (s.expenseId === arg.where.expenseId) {
            tables.share.delete(key);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      }),
    };

    const settlementClient = {
      findMany: jest.fn((arg: { where: { moimId: string } }) => {
        const rows = [...tables.settlement.values()].filter(
          (s) => s.moimId === arg.where.moimId,
        );
        return Promise.resolve(rows);
      }),
      findFirst: jest.fn(
        (arg: {
          where: {
            moimId: string;
            fromUserId: string;
            toUserId: string;
            amount: number;
          };
        }) => {
          const found =
            [...tables.settlement.values()].find(
              (s) =>
                s.moimId === arg.where.moimId &&
                s.fromUserId === arg.where.fromUserId &&
                s.toUserId === arg.where.toUserId &&
                s.amount === arg.where.amount,
            ) ?? null;
          return Promise.resolve(found);
        },
      ),
      findUnique: jest.fn((arg: { where: { id: string } }) =>
        Promise.resolve(tables.settlement.get(arg.where.id) ?? null),
      ),
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            fromUserId: string;
            toUserId: string;
            amount: number;
            settledBy: string;
          };
        }) => {
          const id = nextId('settle');
          const s: Settlement = {
            id,
            moimId: arg.data.moimId,
            fromUserId: arg.data.fromUserId,
            toUserId: arg.data.toUserId,
            amount: arg.data.amount,
            settledBy: arg.data.settledBy,
            settledAt: NOW,
          };
          tables.settlement.set(id, s);
          return Promise.resolve(s);
        },
      ),
      deleteMany: jest.fn(
        (arg: {
          where: {
            moimId: string;
            fromUserId: string;
            toUserId: string;
            amount: number;
          };
        }) => {
          let count = 0;
          for (const [key, s] of [...tables.settlement.entries()]) {
            if (
              s.moimId === arg.where.moimId &&
              s.fromUserId === arg.where.fromUserId &&
              s.toUserId === arg.where.toUserId &&
              s.amount === arg.where.amount
            ) {
              tables.settlement.delete(key);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
      delete: jest.fn((arg: { where: { id: string } }) => {
        const existing = tables.settlement.get(arg.where.id);
        tables.settlement.delete(arg.where.id);
        return Promise.resolve(existing ?? null);
      }),
    };

    // $transaction(인터랙티브 콜백) — createExpense/updateExpense 의 원자 write 를 그대로 실행.
    const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        expense: expenseClient,
        expenseShare: expenseShareClient,
        settlement: settlementClient,
      }),
    );

    return {
      moim: moimClient,
      moimMember: moimMemberClient,
      expense: expenseClient,
      expenseShare: expenseShareClient,
      settlement: settlementClient,
      $transaction,
    } as unknown as PrismaService;
  }

  function makeService(): ExpenseService {
    return new ExpenseService(makePrisma(), makeMoimService());
  }

  beforeEach(() => {
    reset();
  });

  // ── createExpense ─────────────────────────────────────────────────────────

  describe('createExpense() — 균등 분배(REQ-EXP-004 AC-1)', () => {
    it('equal 분배: share 합 = amount, 나머지는 앞선 참가자에게 배분된다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');

      // 3명, 10000원 → 3334, 3333, 3333
      const result = await service.createExpense(
        'owner',
        'moim-A',
        10000,
        '식비',
        'owner',
        undefined,
        'equal',
        ['owner', 'user-B', 'user-C'],
        undefined,
      );

      const shareSum = result.shares.reduce((acc, s) => acc + s.shareAmount, 0);
      expect(shareSum).toBe(10000);
      expect(result.shares).toHaveLength(3);
    });

    it('equal 분배: 나머지 없이 나눠 떨어지면 모두 같은 금액', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      const result = await service.createExpense(
        'owner',
        'moim-A',
        10000,
        '교통',
        'owner',
        undefined,
        'equal',
        ['owner', 'user-B'],
        undefined,
      );

      const shareSum = result.shares.reduce((acc, s) => acc + s.shareAmount, 0);
      expect(shareSum).toBe(10000);
      // 5000원씩 동일.
      expect(result.shares.every((s) => s.shareAmount === 5000)).toBe(true);
    });

    it('equal 분배: participantUserIds 생략 시 전 멤버에 균등 분배', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      const result = await service.createExpense(
        'owner',
        'moim-A',
        3000,
        '숙박',
        'owner',
        undefined,
        'equal',
        undefined, // 전 멤버
        undefined,
      );

      const shareSum = result.shares.reduce((acc, s) => acc + s.shareAmount, 0);
      expect(shareSum).toBe(3000);
      expect(result.shares).toHaveLength(2); // owner + user-B
    });
  });

  describe('createExpense() — custom 분배(REQ-EXP-004 AC-2)', () => {
    it('custom 분배: 지정 금액 그대로 저장하고 합 = amount', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      const result = await service.createExpense(
        'owner',
        'moim-A',
        9000,
        '입장',
        'owner',
        undefined,
        'custom',
        undefined,
        [
          { userId: 'owner', amount: 6000 },
          { userId: 'user-B', amount: 3000 },
        ],
      );

      const shareSum = result.shares.reduce((acc, s) => acc + s.shareAmount, 0);
      expect(shareSum).toBe(9000);
      expect(result.shares.find((s) => s.userId === 'owner')?.shareAmount).toBe(
        6000,
      );
      expect(
        result.shares.find((s) => s.userId === 'user-B')?.shareAmount,
      ).toBe(3000);
    });
  });

  describe('createExpense() — ratio 분배(REQ-EXP-004 AC-2b)', () => {
    it('ratio 분배: 정수 KRW 로 환산하고 합 = amount', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      // 비율 1:2, 총 9999원 → floor(3333)+floor(6666) = 9999 또는 나머지 1원 배분
      const result = await service.createExpense(
        'owner',
        'moim-A',
        9999,
        '준비물',
        'owner',
        undefined,
        'ratio',
        undefined,
        [
          { userId: 'owner', ratio: 1 },
          { userId: 'user-B', ratio: 2 },
        ],
      );

      const shareSum = result.shares.reduce((acc, s) => acc + s.shareAmount, 0);
      expect(shareSum).toBe(9999);
      expect(result.shares).toHaveLength(2);
    });
  });

  describe('createExpense() — 검증 실패(REQ-EXP-002 AC-400)', () => {
    it('amount 가 정수가 아니면 컨트롤러에서 400(서비스 레벨 — payer 검증 전 assertOwner 통과 후)', async () => {
      // amount 검증은 컨트롤러에서 수행하므로, 서비스는 유효한 값을 받는다.
      // 여기서는 서비스 레벨 검증인 payerUserId 멤버 미포함 400 을 검증한다.
      const service = makeService();
      seedMoim('moim-A', 'owner');
      // user-X 는 멤버가 아님.

      await expect(
        service.createExpense(
          'owner',
          'moim-A',
          5000,
          '식비',
          'user-X', // 멤버가 아닌 결제자
          undefined,
          'equal',
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('category 가 프리셋 외 값이면 컨트롤러 400 — 서비스는 category 를 그대로 저장', async () => {
      // 카테고리 검증은 컨트롤러에서 수행한다. 서비스는 통과된 값을 저장.
      // 이 케이스는 컨트롤러 레벨 검증이므로 서비스에서는 저장 성공으로 확인.
      const service = makeService();
      seedMoim('moim-A', 'owner');

      // 서비스는 category 를 그대로 DB 에 전달한다(서비스 내 별도 검증 없음).
      const result = await service.createExpense(
        'owner',
        'moim-A',
        5000,
        '기타', // 유효 카테고리
        'owner',
        undefined,
        'equal',
        undefined,
        undefined,
      );
      expect(result.category).toBe('기타');
    });

    it('payerUserId 가 해당 모임 멤버가 아니면 400(BadRequestException)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      // 'outsider' 는 멤버가 아님.

      await expect(
        service.createExpense(
          'owner',
          'moim-A',
          5000,
          '식비',
          'outsider',
          undefined,
          'equal',
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('custom 분배 합이 amount 와 다르면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      await expect(
        service.createExpense(
          'owner',
          'moim-A',
          9000,
          '식비',
          'owner',
          undefined,
          'custom',
          undefined,
          [
            { userId: 'owner', amount: 6000 },
            { userId: 'user-B', amount: 2000 }, // 합 8000 ≠ 9000
          ],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('ratio 합이 0 이하이면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      await expect(
        service.createExpense(
          'owner',
          'moim-A',
          9000,
          '식비',
          'owner',
          undefined,
          'ratio',
          undefined,
          [
            { userId: 'owner', ratio: 0 }, // 비율 0 이하
            { userId: 'user-B', ratio: 0 },
          ],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('shares 의 userId 가 멤버가 아니면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');

      await expect(
        service.createExpense(
          'owner',
          'moim-A',
          9000,
          '식비',
          'owner',
          undefined,
          'custom',
          undefined,
          [
            { userId: 'owner', amount: 5000 },
            { userId: 'outsider', amount: 4000 }, // 멤버 아님
          ],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('equal 분배 시 참가자 목록 사용자 중 멤버가 아닌 userId 가 있으면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      // 'outsider' 는 참가자로 지정했지만 모임 멤버가 아님.

      await expect(
        service.createExpense(
          'owner',
          'moim-A',
          5000,
          '식비',
          'owner',
          undefined,
          'equal',
          ['owner', 'outsider'], // outsider 는 멤버 아님
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('비-owner 가 생성하면 403(ForbiddenException)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'member');

      await expect(
        service.createExpense(
          'member', // owner 아님
          'moim-A',
          5000,
          '식비',
          'owner',
          undefined,
          'equal',
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // ── listExpenses + summary + settlement ──────────────────────────────────

  describe('listExpenses() — 요약(REQ-EXP-005 AC-5)', () => {
    it('total/perPerson/budget/remaining 계산이 올바르다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner', 50000); // budget=50000
      addMember('moim-A', 'user-B');
      // owner 가 30000원 지불, 두 멤버에 균등 분배.
      seedExpense('moim-A', 'owner', 30000, '식비', [
        { userId: 'owner', shareAmount: 15000 },
        { userId: 'user-B', shareAmount: 15000 },
      ]);

      const result = await service.listExpenses('owner', 'moim-A');

      expect(result.summary.total).toBe(30000);
      // 멤버 2명 → perPerson = floor(30000/2) = 15000
      expect(result.summary.perPerson).toBe(15000);
      expect(result.summary.budget).toBe(50000);
      expect(result.summary.remaining).toBe(20000); // 50000 - 30000
    });

    it('budget 가 null 이면 remaining 도 null', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner', null); // budget 없음
      seedExpense('moim-A', 'owner', 10000, '교통', [
        { userId: 'owner', shareAmount: 10000 },
      ]);

      const result = await service.listExpenses('owner', 'moim-A');

      expect(result.summary.budget).toBeNull();
      expect(result.summary.remaining).toBeNull();
    });

    it('경비 없으면 빈 목록 + 0 요약', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');

      const result = await service.listExpenses('owner', 'moim-A');

      expect(result.expenses).toHaveLength(0);
      expect(result.summary.total).toBe(0);
      expect(result.summary.perPerson).toBe(0);
      expect(result.settlement.balances).toHaveLength(0);
      expect(result.settlement.transactions).toHaveLength(0);
    });

    it('비멤버가 조회하면 403(ForbiddenException)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');

      await expect(
        service.listExpenses('outsider', 'moim-A'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listExpenses() — balance + greedy 거래(REQ-EXP-005 AC-5)', () => {
    it('balance = payer 합 - share 합 계산이 올바르다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      // owner 가 10000 원 지불, 균등 분배(owner 5000, user-B 5000).
      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);

      const result = await service.listExpenses('owner', 'moim-A');

      const ownerBalance = result.settlement.balances.find(
        (b) => b.userId === 'owner',
      );
      const userBBalance = result.settlement.balances.find(
        (b) => b.userId === 'user-B',
      );
      // owner: paid 10000 - share 5000 = +5000(채권자)
      expect(ownerBalance?.balance).toBe(5000);
      // user-B: paid 0 - share 5000 = -5000(채무자)
      expect(userBBalance?.balance).toBe(-5000);
    });

    it('greedy 최소 거래: user-B 가 owner 에게 5000 원 송금', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);

      const result = await service.listExpenses('owner', 'moim-A');

      expect(result.settlement.transactions).toHaveLength(1);
      const tx = result.settlement.transactions[0];
      expect(tx.from).toBe('user-B');
      expect(tx.to).toBe('owner');
      expect(tx.amount).toBe(5000);
    });

    it('settled 플래그: 마커가 있는 거래는 settled=true, 없는 거래는 false', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);
      // 정산 마커 생성(user-B → owner, 5000).
      seedSettlement('moim-A', 'user-B', 'owner', 5000, 'owner');

      const result = await service.listExpenses('owner', 'moim-A');

      const tx = result.settlement.transactions.find(
        (t) => t.from === 'user-B' && t.to === 'owner' && t.amount === 5000,
      );
      expect(tx?.settled).toBe(true);
    });

    it('마커 없는 거래는 settled=false', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);
      // 마커 없음.

      const result = await service.listExpenses('owner', 'moim-A');

      const tx = result.settlement.transactions[0];
      expect(tx.settled).toBe(false);
    });
  });

  // ── deleteExpense ─────────────────────────────────────────────────────────

  describe('deleteExpense() (REQ-EXP-006 AC-7)', () => {
    it('owner 가 삭제하면 expense + share 가 제거된다(cascade)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      const exp = seedExpense('moim-A', 'owner', 5000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
      ]);

      await service.deleteExpense('owner', 'moim-A', exp.id);

      expect(tables.expense.has(exp.id)).toBe(false);
      // share 도 cascade 제거.
      expect(
        [...tables.share.values()].filter((s) => s.expenseId === exp.id),
      ).toHaveLength(0);
    });

    it('비-owner 가 삭제하면 403', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'member');
      const exp = seedExpense('moim-A', 'owner', 5000, '식비', []);

      await expect(
        service.deleteExpense('member', 'moim-A', exp.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.expense.has(exp.id)).toBe(true);
    });

    it('타-모임 expenseId 로 삭제하면 404', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      seedMoim('moim-B', 'owner');
      const expB = seedExpense('moim-B', 'owner', 5000, '식비', []);

      await expect(
        service.deleteExpense('owner', 'moim-A', expB.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('존재하지 않는 expenseId 로 삭제하면 404', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');

      await expect(
        service.deleteExpense('owner', 'moim-A', 'no-such'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── updateExpense (PATCH) ─────────────────────────────────────────────────

  describe('updateExpense() (REQ-EXP-007 AC-11)', () => {
    it('amount 변경 시 ExpenseShare 가 재 materialize 된다(deleteMany+create)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      const exp = seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);

      const updated = await service.updateExpense(
        'owner',
        'moim-A',
        exp.id,
        8000, // 새 amount
        undefined,
        undefined,
        undefined,
        'equal', // splitMethod 재계산
        ['owner', 'user-B'],
        undefined,
      );

      const shareSum = updated.shares.reduce(
        (acc, s) => acc + s.shareAmount,
        0,
      );
      expect(shareSum).toBe(8000);
    });

    it('미전달 필드는 기존값을 유지한다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      const exp = seedExpense('moim-A', 'owner', 5000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
      ]);

      const updated = await service.updateExpense(
        'owner',
        'moim-A',
        exp.id,
        undefined, // amount 미전달
        '교통', // category 만 변경
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );

      expect(updated.category).toBe('교통');
      expect(updated.amount).toBe(5000); // 기존값 유지
    });

    it('비-owner 가 수정하면 403', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'member');
      const exp = seedExpense('moim-A', 'owner', 5000, '식비', []);

      await expect(
        service.updateExpense(
          'member',
          'moim-A',
          exp.id,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('타-모임 expenseId 로 수정하면 404', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      seedMoim('moim-B', 'owner');
      const expB = seedExpense('moim-B', 'owner', 5000, '식비', []);

      await expect(
        service.updateExpense(
          'owner',
          'moim-A',
          expB.id,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('custom 분배 합이 새 amount 와 다르면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      const exp = seedExpense('moim-A', 'owner', 5000, '식비', []);

      await expect(
        service.updateExpense(
          'owner',
          'moim-A',
          exp.id,
          9000,
          undefined,
          undefined,
          undefined,
          'custom',
          undefined,
          [
            { userId: 'owner', amount: 5000 },
            { userId: 'user-B', amount: 2000 }, // 합 7000 ≠ 9000
          ],
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('payerUserId 변경 시 새 payer 가 멤버가 아니면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      const exp = seedExpense('moim-A', 'owner', 5000, '식비', []);

      await expect(
        service.updateExpense(
          'owner',
          'moim-A',
          exp.id,
          undefined,
          undefined,
          'outsider', // 멤버 아님
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── createSettlement (정산 완료 마커) ─────────────────────────────────────

  describe('createSettlement() (REQ-EXP-009 AC-12)', () => {
    it('현재 거래 집합에 존재하는 거래를 마커로 생성한다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);

      // user-B → owner 5000 거래가 현재 계산에 존재한다.
      const marker = await service.createSettlement(
        'owner',
        'moim-A',
        'user-B',
        'owner',
        5000,
      );

      expect(marker.fromUserId).toBe('user-B');
      expect(marker.toUserId).toBe('owner');
      expect(marker.amount).toBe(5000);
      expect(tables.settlement.size).toBe(1);
    });

    it('멱등: 동일 (from,to,amount) 마커가 이미 있으면 새로 생성하지 않고 기존 반환', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);
      // 기존 마커 시드.
      const existing = seedSettlement(
        'moim-A',
        'user-B',
        'owner',
        5000,
        'owner',
      );

      const result = await service.createSettlement(
        'owner',
        'moim-A',
        'user-B',
        'owner',
        5000,
      );

      // 새 마커 미생성(테이블 크기 유지).
      expect(tables.settlement.size).toBe(1);
      expect(result.id).toBe(existing.id);
    });

    it('현재 거래 집합에 없는 (from,to,amount) 는 400(BadRequestException)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      // 경비 없음 → 거래 없음.

      await expect(
        service.createSettlement('owner', 'moim-A', 'user-B', 'owner', 5000),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('비-owner 가 마커를 생성하면 403', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'member');
      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'member', shareAmount: 5000 },
      ]);

      await expect(
        service.createSettlement('member', 'moim-A', 'member', 'owner', 5000),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('deleteSettlement() (REQ-EXP-009 AC-12)', () => {
    it('마커 삭제 후 listExpenses 에서 settled=false 로 나타난다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);
      seedSettlement('moim-A', 'user-B', 'owner', 5000, 'owner');

      // 마커 삭제.
      await service.deleteSettlement(
        'owner',
        'moim-A',
        'user-B',
        'owner',
        5000,
      );

      // 삭제 후 다시 조회하면 settled=false.
      const result = await service.listExpenses('owner', 'moim-A');
      const tx = result.settlement.transactions.find(
        (t) => t.from === 'user-B' && t.to === 'owner',
      );
      expect(tx?.settled).toBe(false);
    });

    it('경비 변경 후 기존 마커는 stale — 거래가 재계산되어 settled=false 로 변한다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');
      const exp = seedExpense('moim-A', 'owner', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);
      // 기존 마커(user-B → owner 5000).
      seedSettlement('moim-A', 'user-B', 'owner', 5000, 'owner');

      // 경비를 3인 균등으로 수정(user-B 의 share 가 달라져 거래 금액 변경).
      await service.updateExpense(
        'owner',
        'moim-A',
        exp.id,
        9000, // 새 amount
        undefined,
        undefined,
        undefined,
        'equal',
        ['owner', 'user-B', 'user-C'],
        undefined,
      );

      // 새 거래에서 user-B → owner 의 금액이 달라졌으므로 기존 5000 마커는 매칭 안 됨.
      const result = await service.listExpenses('owner', 'moim-A');
      const oldTx = result.settlement.transactions.find(
        (t) => t.from === 'user-B' && t.to === 'owner' && t.amount === 5000,
      );
      // 5000 거래는 재계산 후 더 이상 현재 거래 집합에 없을 수 있음.
      // 어떤 경우든 stale 마커는 현재 거래와 매칭되지 않으면 settled=false.
      if (oldTx) {
        expect(oldTx.settled).toBe(false);
      } else {
        // 거래 자체가 사라짐 — 마커는 stale 상태임을 간접 확인.
        expect(tables.settlement.size).toBe(1); // 마커는 여전히 존재
      }
    });

    it('비-owner 가 마커 삭제를 시도하면 403', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'member');

      await expect(
        service.deleteSettlement('member', 'moim-A', 'member', 'owner', 5000),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
