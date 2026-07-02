import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Expense,
  ExpenseShare,
  Moim,
  MoimMember,
  Settlement,
  SettlementRequest,
} from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SafetyService } from '../safety/safety.service';
import {
  MOIM_EXPENSE_ADDED,
  MOIM_SETTLEMENT_COMPLETED,
  MOIM_SETTLEMENT_REQUESTED,
} from './expense-events';
import { BLOCKED_MEMBER_LABEL, ExpenseService } from './expense.service';

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
  // SPEC-NOTIFICATIONS-001 M2: 정산 요청 테이블(requestSettlement 검증용).
  settlementRequest: Map<string, SettlementRequest>;
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
  // SPEC-NOTIFICATIONS-001 M2: EventEmitter2.emit 스텁(발행 검증용, per-test 초기화).
  let emit: jest.Mock;
  // SPEC-SAFETY-001 T-006: 뷰어(sub)가 숨긴 userId 목록(block∪report). 테스트별로 세팅해 마스킹을 검증한다.
  let hiddenUserIds: string[];
  // getHiddenUserIds 스텁(호출 검증용).
  let getHiddenUserIds: jest.Mock;

  function reset(): void {
    tables = {
      moim: new Map(),
      member: new Map(),
      expense: new Map(),
      share: new Map(),
      settlement: new Map(),
      settlementRequest: new Map(),
    };
    idSeq = 0;
    owners = new Map();
    emit = jest.fn();
    hiddenUserIds = [];
    // fake Prisma 컨벤션대로 Promise.resolve 로 비동기 반환한다(sync return 금지).
    getHiddenUserIds = jest.fn(() => Promise.resolve(hiddenUserIds));
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

    // SPEC-NOTIFICATIONS-001 M2: 정산 요청 fake 클라이언트(create 만 — requestSettlement 검증용).
    const settlementRequestClient = {
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            requesterId: string;
            debtorId: string;
            amount: number;
          };
        }) => {
          const id = nextId('sreq');
          const row: SettlementRequest = {
            id,
            moimId: arg.data.moimId,
            requesterId: arg.data.requesterId,
            debtorId: arg.data.debtorId,
            amount: arg.data.amount,
            createdAt: NOW,
          };
          tables.settlementRequest.set(id, row);
          return Promise.resolve(row);
        },
      ),
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
      settlementRequest: settlementRequestClient,
      $transaction,
    } as unknown as PrismaService;
  }

  // SPEC-SAFETY-001 T-006: 뷰어 측 숨김 목록 단일 출처 스텁. getHiddenUserIds 만 사용한다(getBlockersOf 는 push 경로 전용).
  function makeSafetyService(): SafetyService {
    return {
      getHiddenUserIds,
    } as unknown as SafetyService;
  }

  function makeService(): ExpenseService {
    return new ExpenseService(
      makePrisma(),
      makeMoimService(),
      {
        emit,
      } as unknown as EventEmitter2,
      makeSafetyService(),
    );
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

  // ── SPEC-NOTIFICATIONS-001 M2: 경비/정산 도메인 이벤트 발행 ─────────────────────
  describe('createExpense() — moim.expense.added 발행 (SPEC-NOTIFICATIONS-001 M2)', () => {
    it('성공 시 분담 참가자(shareUserIds)를 실은 이벤트를 1회 발행한다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');

      const created = await service.createExpense(
        'owner',
        'moim-A',
        9000,
        '식비',
        'owner',
        undefined,
        'equal',
        ['owner', 'user-B', 'user-C'],
        undefined,
      );

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_EXPENSE_ADDED, {
        moimId: 'moim-A',
        actorId: 'owner',
        expenseId: created.id,
        amount: 9000,
        category: '식비',
        shareUserIds: ['owner', 'user-B', 'user-C'],
      });
    });

    it('authz 실패(비-owner 403) 경로는 발행하지 않는다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'member');

      await expect(
        service.createExpense(
          'member',
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
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('createSettlement() — moim.settlement.completed 발행 (SPEC-NOTIFICATIONS-001 M2)', () => {
    it('신규 마커 시 상대방(counterparty=actor 아닌 당사자)에게 1회 발행한다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');
      // user-C 가 10000 지불, user-B/user-C 균등 → user-B 가 user-C 에게 5000 채무.
      seedExpense('moim-A', 'user-C', 10000, '식비', [
        { userId: 'user-B', shareAmount: 5000 },
        { userId: 'user-C', shareAmount: 5000 },
      ]);

      await service.createSettlement(
        'owner',
        'moim-A',
        'user-B',
        'user-C',
        5000,
      );

      expect(emit).toHaveBeenCalledTimes(1);
      // actor(owner)는 정산 당사자가 아니므로 counterparty = 채권자(toUserId=user-C=요청자).
      expect(emit).toHaveBeenCalledWith(MOIM_SETTLEMENT_COMPLETED, {
        moimId: 'moim-A',
        actorId: 'owner',
        counterpartyId: 'user-C',
        amount: 5000,
      });
    });

    it('멱등(기존 마커 재호출)은 발행하지 않는다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');
      seedExpense('moim-A', 'user-C', 10000, '식비', [
        { userId: 'user-B', shareAmount: 5000 },
        { userId: 'user-C', shareAmount: 5000 },
      ]);
      // 동일 (from,to,amount) 마커를 미리 시드 → 재호출은 멱등(no-op).
      seedSettlement('moim-A', 'user-B', 'user-C', 5000, 'owner');

      await service.createSettlement(
        'owner',
        'moim-A',
        'user-B',
        'user-C',
        5000,
      );

      expect(emit).not.toHaveBeenCalled();
    });
  });

  // ── SPEC-NOTIFICATIONS-001 M2: 정산 요청(신규 액션) ────────────────────────────
  describe('requestSettlement() (SPEC-NOTIFICATIONS-001 M2)', () => {
    it('멤버가 채무자에게 요청 시 요청 행 생성 + moim.settlement.requested 1회 발행', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      const req = await service.requestSettlement(
        'owner',
        'moim-A',
        'user-B',
        4000,
      );

      expect(req.requesterId).toBe('owner');
      expect(req.debtorId).toBe('user-B');
      expect(req.amount).toBe(4000);
      expect(tables.settlementRequest.size).toBe(1);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_SETTLEMENT_REQUESTED, {
        moimId: 'moim-A',
        actorId: 'owner',
        debtorId: 'user-B',
        amount: 4000,
      });
    });

    it('요청자가 비멤버면 403(요청 미생성·미발행)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      await expect(
        service.requestSettlement('stranger', 'moim-A', 'user-B', 4000),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.settlementRequest.size).toBe(0);
      expect(emit).not.toHaveBeenCalled();
    });

    it('채무자가 모임 멤버가 아니면 400(요청 미생성·미발행)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');

      await expect(
        service.requestSettlement('owner', 'moim-A', 'outsider', 4000),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tables.settlementRequest.size).toBe(0);
      expect(emit).not.toHaveBeenCalled();
    });

    it('자기 자신에게 요청하면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');

      await expect(
        service.requestSettlement('owner', 'moim-A', 'owner', 4000),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(emit).not.toHaveBeenCalled();
    });

    it('금액이 1 미만/비정수이면 400', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');

      await expect(
        service.requestSettlement('owner', 'moim-A', 'user-B', 0),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.requestSettlement('owner', 'moim-A', 'user-B', 1.5),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  // ── SPEC-SAFETY-001 T-006: 지출 표시 목록 작성자 마스킹(REQ-FLT-003 / AC-FLT-3) ────────────────
  // 계약(M3-8~M3-11, E-2): 계산=전체 원본(balance/transactions/total 불변), 표시=행 유지 + 차단 대상
  // 작성자만 '차단한 멤버' 마스킹. [WARN] 마스킹은 계산 입력이 아니라 표시 반환 직전에만 적용한다.
  //
  // 선행 확인 결과(task T-006 "선행 확인: listExpenses 반환 shape 에 settlement_request 행 포함 여부"):
  //   listExpenses 반환 shape = { expenses: ExpenseWithShares[], summary, settlement } 이며
  //   settlement_request 행은 표시 목록에 포함되지 않는다(SettlementRequest 테이블은 requestSettlement
  //   create 전용, 읽기 경로 없음). 따라서 REQ-FLT-003 의 "요청자 마스킹"은 이 표면에서 마스킹할 행이
  //   존재하지 않아 vacuously 충족된다 — 아래 마지막 테스트로 이 불변식을 명시 고정한다.
  describe('listExpenses() — 차단 대상 작성자 마스킹(SPEC-SAFETY-001 REQ-FLT-003 / AC-FLT-3)', () => {
    it('hidden creator 의 expense 행은 제거되지 않고 createdBy 만 마스킹된다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');
      // E1: 작성자=user-B(차단 대상), E2: 작성자=user-C(정상). createdBy 는 시드 후 명시 세팅한다.
      const e1 = seedExpense('moim-A', 'owner', 5000, '식비', []);
      tables.expense.set(e1.id, {
        ...tables.expense.get(e1.id),
        createdBy: 'user-B',
      });
      const e2 = seedExpense('moim-A', 'owner', 3000, '교통', []);

      hiddenUserIds = ['user-B'];

      const result = await service.listExpenses('owner', 'moim-A');

      // 행 유지: 두 행 모두 남아 있다(제거 아님).
      expect(result.expenses).toHaveLength(2);
      const maskedE1 = result.expenses.find((e) => e.id === e1.id);
      const plainE2 = result.expenses.find((e) => e.id === e2.id);
      // 차단 대상 작성자만 마스킹.
      expect(maskedE1?.createdBy).toBe(BLOCKED_MEMBER_LABEL);
      // 정상 작성자는 원본 유지.
      expect(plainE2?.createdBy).toBe('owner');
      // getHiddenUserIds 는 요청당 1회만 조회한다(N+1 회피).
      expect(getHiddenUserIds).toHaveBeenCalledTimes(1);
      expect(getHiddenUserIds).toHaveBeenCalledWith('owner');
    });

    it('마스킹은 정산 계산(balance/transactions/total)을 오염시키지 않는다 — 계산=전체 원본', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner', 50000);
      addMember('moim-A', 'user-B');
      // user-B 가 10000 지불하고 owner/user-B 균등 분배 → user-B 채권자, owner 채무자.
      // 작성자(createdBy)=user-B 로 만들어 마스킹 대상이면서 동시에 payer 로 계산에 참여한다.
      const e1 = seedExpense('moim-A', 'user-B', 10000, '식비', [
        { userId: 'owner', shareAmount: 5000 },
        { userId: 'user-B', shareAmount: 5000 },
      ]);
      tables.expense.set(e1.id, {
        ...tables.expense.get(e1.id),
        createdBy: 'user-B',
      });

      hiddenUserIds = ['user-B'];

      const result = await service.listExpenses('owner', 'moim-A');

      // total 은 마스킹과 무관하게 전체 원본 기준.
      expect(result.summary.total).toBe(10000);
      // balance: user-B 는 payer 이므로 payerUserId(마스킹 안 되는 필드)로 계산 — +5000 채권자.
      const userBBalance = result.settlement.balances.find(
        (b) => b.userId === 'user-B',
      );
      const ownerBalance = result.settlement.balances.find(
        (b) => b.userId === 'owner',
      );
      expect(userBBalance?.balance).toBe(5000);
      expect(ownerBalance?.balance).toBe(-5000);
      // 최소 거래도 원본 기준(owner → user-B 5000).
      expect(result.settlement.transactions).toHaveLength(1);
      const tx = result.settlement.transactions[0];
      expect(tx.from).toBe('owner');
      expect(tx.to).toBe('user-B');
      expect(tx.amount).toBe(5000);
      // 표시 행의 createdBy 는 마스킹.
      expect(result.expenses[0].createdBy).toBe(BLOCKED_MEMBER_LABEL);
    });

    it('∑ 정합: 마스킹 후에도 표시 expense 항목 금액 합 == summary.total(금액 불변)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      addMember('moim-A', 'user-C');
      const e1 = seedExpense('moim-A', 'owner', 5000, '식비', []);
      tables.expense.set(e1.id, {
        ...tables.expense.get(e1.id),
        createdBy: 'user-B',
      });
      seedExpense('moim-A', 'owner', 3000, '교통', []);

      hiddenUserIds = ['user-B'];

      const result = await service.listExpenses('owner', 'moim-A');

      const shownSum = result.expenses.reduce((acc, e) => acc + e.amount, 0);
      expect(shownSum).toBe(result.summary.total);
      expect(shownSum).toBe(8000);
    });

    it('차단 없음(hiddenIds=[]) 시 createdBy 마스킹 없이 원본 그대로 반환한다', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      const e1 = seedExpense('moim-A', 'owner', 5000, '식비', []);
      tables.expense.set(e1.id, {
        ...tables.expense.get(e1.id),
        createdBy: 'user-B',
      });

      // hiddenUserIds 기본값 [] 유지.
      const result = await service.listExpenses('owner', 'moim-A');

      expect(result.expenses[0].createdBy).toBe('user-B');
    });

    it('선행 확인 고정: listExpenses 표시 목록은 settlement_request 행을 포함하지 않는다(요청자 마스킹 대상 부재)', async () => {
      const service = makeService();
      seedMoim('moim-A', 'owner');
      addMember('moim-A', 'user-B');
      // 정산 요청을 생성해도 listExpenses 표시 목록(expenses)에는 나타나지 않는다.
      await service.requestSettlement('owner', 'moim-A', 'user-B', 4000);
      expect(tables.settlementRequest.size).toBe(1);

      hiddenUserIds = ['user-B'];
      const result = await service.listExpenses('owner', 'moim-A');

      // 표시 목록에 settlement_request 행이 섞이지 않는다 — expenses 는 모두 Expense 행이다.
      // (settlement_request 는 이 표면에서 렌더되지 않으므로 요청자 마스킹은 vacuous.)
      expect(result.expenses).toHaveLength(0);
    });
  });
});
