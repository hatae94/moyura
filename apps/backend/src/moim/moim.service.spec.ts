import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Moim, MoimMember } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { MOIM_MEMBER_KICKED, MOIM_OWNER_TRANSFERRED } from './moim-events';
import { MoimService } from './moim.service';

// SPEC-NOTIFICATIONS-001 M2: MoimService 는 EventEmitter2 를 주입받는다. emit 호출을 검증하지 않는 기존 테스트는
// no-op 스텁을 넘긴다(push.listener.spec 패턴 — standalone jest.fn 참조). 발행 검증 테스트는 별도 emit 스텁을 만든다.
function makeEvents(): EventEmitter2 {
  return { emit: jest.fn() } as unknown as EventEmitter2;
}

// MoimService 단위 테스트(SPEC-MOIM-001). Prisma는 jest.Mock 스텁으로 대체한다
// (profile.service.spec.ts 패턴 — Prisma 7 WASM은 jest VM에서 동작 불가, 인자/분기만 검증).
//
// 인메모리 fake Prisma: moim/moimMember 테이블을 Map으로 흉내내고 createMoim의
// 인터랙티브 $transaction(tx) 콜백을 그대로 실행해 owner row 주입을 검증한다.

interface Tables {
  moim: Map<string, Moim>;
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
}

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

// moim/moimMember 위임을 흉내내는 tx 핸들(create 시 Map에 기록).
function makeTxClient(tables: Tables, ids: { next: () => string }) {
  return {
    moim: {
      // SPEC-MOIM-004: data 에 optional startsAt/location 을 포함한다(전달 검증용).
      create: jest.fn(
        (arg: {
          data: {
            name: string;
            createdBy: string;
            startsAt?: Date | null;
            location?: string | null;
            maxMembers?: number;
          };
        }) => {
          const created: Moim = {
            id: ids.next(),
            name: arg.data.name,
            startsAt: arg.data.startsAt ?? null,
            location: arg.data.location ?? null,
            // SPEC-MOIM-012: maxMembers 미전달 시 DB @default(15)를 흉내낸다.
            maxMembers: arg.data.maxMembers ?? 15,
            budget: null,
            createdBy: arg.data.createdBy,
            createdAt: new Date('2026-06-13T00:00:00.000Z'),
          };
          tables.moim.set(created.id, created);
          return Promise.resolve(created);
        },
      ),
    },
    moimMember: {
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            userId: string;
            nickname: string;
            role: string;
          };
        }) => {
          const created: MoimMember = {
            moimId: arg.data.moimId,
            userId: arg.data.userId,
            nickname: arg.data.nickname,
            role: arg.data.role,
            joinedAt: new Date('2026-06-13T00:00:00.000Z'),
          };
          tables.member.set(memberKey(created.moimId, created.userId), created);
          return Promise.resolve(created);
        },
      ),
    },
  };
}

// $transaction(인터랙티브 콜백)을 캡처하는 타입드 스텁(인자 형태 단언용).

type TransactionMock = jest.Mock<Promise<unknown>, [any]>;

// MoimService에 주입할 fake PrismaService. $transaction은 콜백 형태(createMoim)와 배열 형태(transferOwner) 모두 지원한다.
function makePrisma(seed?: { moims?: Moim[]; members?: MoimMember[] }): {
  prisma: PrismaService;
  tables: Tables;
  transaction: TransactionMock;
} {
  const tables: Tables = {
    moim: new Map(seed?.moims?.map((m) => [m.id, m])),
    member: new Map(
      seed?.members?.map((m) => [memberKey(m.moimId, m.userId), m]),
    ),
  };
  let seq = 0;
  const ids = {
    next: (): string => {
      seq += 1;
      return `moim-${seq}`;
    },
  };

  const findMember = (where: {
    moimId_userId: { moimId: string; userId: string };
  }): MoimMember | null =>
    tables.member.get(
      memberKey(where.moimId_userId.moimId, where.moimId_userId.userId),
    ) ?? null;

  // 콜백(createMoim) 또는 배열(transferOwner) 형태를 모두 처리한다.
  const transaction: TransactionMock = jest.fn((arg: unknown) => {
    if (typeof arg === 'function') {
      // 인터랙티브 콜백 형태: createMoim.
      return (arg as (tx: ReturnType<typeof makeTxClient>) => Promise<unknown>)(
        makeTxClient(tables, ids),
      );
    }
    // 배열 형태: 각 Promise를 순서대로 실행한다.
    return Promise.all(arg as Promise<unknown>[]);
  });

  const prisma = {
    $transaction: transaction,
    moim: {
      findUnique: jest.fn((arg: { where: { id: string } }) =>
        Promise.resolve(tables.moim.get(arg.where.id) ?? null),
      ),
      findMany: jest.fn((arg: { where: { id: { in: string[] } } }) =>
        Promise.resolve(
          arg.where.id.in
            .map((id) => tables.moim.get(id))
            .filter((m): m is Moim => m !== undefined),
        ),
      ),
      update: jest.fn((arg: { where: { id: string }; data: Partial<Moim> }) => {
        const existing = tables.moim.get(arg.where.id);
        if (!existing) {
          return Promise.resolve(null);
        }
        const updated: Moim = { ...existing, ...arg.data };
        tables.moim.set(updated.id, updated);
        return Promise.resolve(updated);
      }),
      delete: jest.fn((arg: { where: { id: string } }) => {
        const existing = tables.moim.get(arg.where.id);
        tables.moim.delete(arg.where.id);
        // onDelete: Cascade 흉내 — 해당 모임 멤버십 제거.
        for (const key of [...tables.member.keys()]) {
          if (key.startsWith(`${arg.where.id}:`)) {
            tables.member.delete(key);
          }
        }
        return Promise.resolve(existing ?? null);
      }),
    },
    moimMember: {
      findUnique: jest.fn(
        (arg: {
          where: { moimId_userId: { moimId: string; userId: string } };
        }) => Promise.resolve(findMember(arg.where)),
      ),
      findMany: jest.fn(
        (arg: { where: { userId?: string; moimId?: string } }) =>
          Promise.resolve(
            [...tables.member.values()].filter((m) =>
              arg.where.userId !== undefined
                ? m.userId === arg.where.userId
                : m.moimId === arg.where.moimId,
            ),
          ),
      ),
      delete: jest.fn(
        (arg: {
          where: { moimId_userId: { moimId: string; userId: string } };
        }) => {
          const existing = findMember(arg.where);
          tables.member.delete(
            memberKey(
              arg.where.moimId_userId.moimId,
              arg.where.moimId_userId.userId,
            ),
          );
          return Promise.resolve(existing);
        },
      ),
      update: jest.fn(
        (arg: {
          where: { moimId_userId: { moimId: string; userId: string } };
          data: { role: string };
        }) => {
          const key = memberKey(
            arg.where.moimId_userId.moimId,
            arg.where.moimId_userId.userId,
          );
          const existing = tables.member.get(key);
          if (existing) {
            const updated: MoimMember = { ...existing, role: arg.data.role };
            tables.member.set(key, updated);
            return Promise.resolve(updated);
          }
          return Promise.resolve(null);
        },
      ),
    },
  } as unknown as PrismaService;

  return { prisma, tables, transaction };
}

describe('MoimService', () => {
  describe('createMoim (REQ-MOIM-004 / AC-1)', () => {
    it('모임과 생성자 owner 멤버십(host nickname 포함)을 단일 트랜잭션으로 생성한다', async () => {
      const { prisma, tables } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      const moim = await service.createMoim('sub-U', '주말 모임', '호스트');

      expect(moim.name).toBe('주말 모임');
      expect(moim.createdBy).toBe('sub-U');
      // owner 멤버십이 동일 트랜잭션에서 생성되었다.
      const owner = tables.member.get(`${moim.id}:sub-U`);
      expect(owner).toBeDefined();
      expect(owner?.role).toBe('owner');
      expect(owner?.nickname).toBe('호스트');
    });

    it('생성은 인터랙티브 $transaction을 사용한다(owner row가 moim.id에 의존)', async () => {
      const { prisma, transaction } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await service.createMoim('sub-U', 'A', '호스트');

      expect(transaction).toHaveBeenCalledTimes(1);
      // 배열 형태가 아니라 콜백(함수) 인자여야 한다.
      expect(typeof transaction.mock.calls[0][0]).toBe('function');
    });

    // SPEC-MOIM-004 AC-2: optional startsAt/location 을 받으면 tx.moim.create data 에 그대로 전달해 영속한다.
    it('startsAt/location 을 받으면 모임에 영속한다(owner 멤버십 트랜잭션 불변)', async () => {
      const { prisma, tables } = makePrisma();
      const service = new MoimService(prisma, makeEvents());
      const startsAt = new Date('2026-07-01T10:00:00.000Z');

      const moim = await service.createMoim(
        'sub-U',
        '이벤트 모임',
        '호스트',
        startsAt,
        '강남역 스타벅스',
      );

      expect(moim.startsAt).toEqual(startsAt);
      expect(moim.location).toBe('강남역 스타벅스');
      // owner 멤버십은 여전히 같은 트랜잭션에서 생성된다(불변).
      const owner = tables.member.get(`${moim.id}:sub-U`);
      expect(owner?.role).toBe('owner');
      expect(owner?.nickname).toBe('호스트');
    });

    // SPEC-MOIM-004 AC-2: startsAt/location 미전달이면 null 로 저장한다.
    it('startsAt/location 미전달이면 두 필드를 null 로 저장한다', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      const moim = await service.createMoim('sub-U', '모임', '호스트');

      expect(moim.startsAt).toBeNull();
      expect(moim.location).toBeNull();
    });
  });

  // 테스트용 시드 헬퍼: 모임 1개 + owner/멤버 구성.
  function seededMoim(): {
    moim: Moim;
    owner: MoimMember;
    member: MoimMember;
  } {
    const moim: Moim = {
      id: 'moim-A',
      name: '모임 A',
      startsAt: null,
      location: null,
      maxMembers: 15,
      budget: null,
      createdBy: 'sub-owner',
      createdAt: new Date('2026-06-13T00:00:00.000Z'),
    };
    const owner: MoimMember = {
      moimId: 'moim-A',
      userId: 'sub-owner',
      nickname: '호스트',
      role: 'owner',
      joinedAt: new Date('2026-06-13T00:00:00.000Z'),
    };
    const member: MoimMember = {
      moimId: 'moim-A',
      userId: 'sub-member',
      nickname: '참가자1',
      role: 'member',
      joinedAt: new Date('2026-06-13T00:00:00.000Z'),
    };
    return { moim, owner, member };
  }

  describe('assertMember (REQ-MOIM-002 / AC-2)', () => {
    it('멤버인 경우 통과한다(예외 없음)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.assertMember('sub-member', 'moim-A'),
      ).resolves.toBeUndefined();
    });

    it('인증되었으나 비멤버이면 403(ForbiddenException)', async () => {
      const { moim, owner } = seededMoim();
      const { prisma } = makePrisma({ moims: [moim], members: [owner] });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.assertMember('sub-stranger', 'moim-A'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 모임이면 404(NotFoundException)', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(service.assertMember('sub-U', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertOwner (REQ-MOIM-003 / AC-7)', () => {
    it('owner인 경우 통과한다(예외 없음)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.assertOwner('sub-owner', 'moim-A'),
      ).resolves.toBeUndefined();
    });

    it('멤버이지만 owner가 아니면 403(ForbiddenException)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(service.assertOwner('sub-member', 'moim-A')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('비멤버이면 403(ForbiddenException)', async () => {
      const { moim, owner } = seededMoim();
      const { prisma } = makePrisma({ moims: [moim], members: [owner] });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.assertOwner('sub-stranger', 'moim-A'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 모임이면 404(NotFoundException)', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(service.assertOwner('sub-U', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMoim (REQ-MOIM-005 / AC-6)', () => {
    it('멤버가 단건 조회하면 모임 정보를 반환한다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      const result = await service.getMoim('sub-member', 'moim-A');

      expect(result.id).toBe('moim-A');
      expect(result.name).toBe('모임 A');
    });

    it('비멤버 단건 조회는 403', async () => {
      const { moim, owner } = seededMoim();
      const { prisma } = makePrisma({ moims: [moim], members: [owner] });
      const service = new MoimService(prisma, makeEvents());

      await expect(service.getMoim('sub-stranger', 'moim-A')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('존재하지 않는 모임 단건 조회는 404', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(service.getMoim('sub-U', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listMyMoims (REQ-MOIM-005 / AC-6)', () => {
    it('사용자가 속한 모임만 반환한다', async () => {
      const moimA: Moim = {
        id: 'moim-A',
        name: '모임 A',
        startsAt: null,
        location: null,
        maxMembers: 15,
        createdBy: 'sub-owner',
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        budget: null,
      };
      const moimB: Moim = {
        id: 'moim-B',
        name: '모임 B',
        startsAt: null,
        location: null,
        maxMembers: 15,
        createdBy: 'sub-U',
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        budget: null,
      };
      const moimC: Moim = {
        id: 'moim-C',
        name: '모임 C',
        startsAt: null,
        location: null,
        maxMembers: 15,
        createdBy: 'sub-other',
        createdAt: new Date('2026-06-13T00:00:00.000Z'),
        budget: null,
      };
      // U는 A(멤버), B(owner)에만 속하고 C에는 속하지 않는다.
      const members: MoimMember[] = [
        {
          moimId: 'moim-A',
          userId: 'sub-U',
          nickname: 'U',
          role: 'member',
          joinedAt: new Date('2026-06-13T00:00:00.000Z'),
        },
        {
          moimId: 'moim-B',
          userId: 'sub-U',
          nickname: 'U',
          role: 'owner',
          joinedAt: new Date('2026-06-13T00:00:00.000Z'),
        },
        {
          moimId: 'moim-C',
          userId: 'sub-other',
          nickname: 'other',
          role: 'owner',
          joinedAt: new Date('2026-06-13T00:00:00.000Z'),
        },
      ];
      const { prisma } = makePrisma({
        moims: [moimA, moimB, moimC],
        members,
      });
      const service = new MoimService(prisma, makeEvents());

      const result = await service.listMyMoims('sub-U');

      const ids = result.map((m) => m.id).sort();
      expect(ids).toEqual(['moim-A', 'moim-B']);
    });

    it('속한 모임이 없으면 빈 배열을 반환한다', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      const result = await service.listMyMoims('sub-none');

      expect(result).toEqual([]);
    });
  });

  describe('listMembers (REQ-MOIM-006 / AC-5)', () => {
    it('멤버가 조회하면 각 멤버의 nickname을 포함한 목록을 반환한다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      const result = await service.listMembers('sub-member', 'moim-A');

      const nicknames = result.map((m) => m.nickname).sort();
      expect(nicknames).toEqual(['참가자1', '호스트']);
    });

    it('비멤버 멤버 목록 조회는 403', async () => {
      const { moim, owner } = seededMoim();
      const { prisma } = makePrisma({ moims: [moim], members: [owner] });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.listMembers('sub-stranger', 'moim-A'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 모임 멤버 목록 조회는 404', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(service.listMembers('sub-U', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('leave (REQ-MOIM-007/008 / AC-4/AC-8)', () => {
    it('일반 멤버 탈퇴 시 해당 멤버십만 삭제한다(다른 멤버 불변)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await service.leave('sub-member', 'moim-A');

      expect(tables.member.has('moim-A:sub-member')).toBe(false);
      // owner 멤버십은 불변.
      expect(tables.member.has('moim-A:sub-owner')).toBe(true);
    });

    it('owner 탈퇴 시도는 403이고 멤버십을 삭제하지 않는다(고아 모임 방지)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(service.leave('sub-owner', 'moim-A')).rejects.toThrow(
        ForbiddenException,
      );
      // owner 멤버십은 그대로 남아 있다.
      expect(tables.member.has('moim-A:sub-owner')).toBe(true);
    });

    it('비멤버(가입한 적 없음) 탈퇴는 404(멤버십 부재)', async () => {
      const { moim, owner } = seededMoim();
      const { prisma } = makePrisma({ moims: [moim], members: [owner] });
      const service = new MoimService(prisma, makeEvents());

      await expect(service.leave('sub-stranger', 'moim-A')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deleteMoim (REQ-MOIM-003 / AC-7)', () => {
    it('owner가 삭제하면 모임과 종속 멤버십이 Cascade로 제거된다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await service.deleteMoim('sub-owner', 'moim-A');

      expect(tables.moim.has('moim-A')).toBe(false);
      // Cascade: 모든 멤버십 제거.
      expect(tables.member.has('moim-A:sub-owner')).toBe(false);
      expect(tables.member.has('moim-A:sub-member')).toBe(false);
    });

    it('비-owner 멤버 삭제는 403이고 모임은 그대로다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(service.deleteMoim('sub-member', 'moim-A')).rejects.toThrow(
        ForbiddenException,
      );
      expect(tables.moim.has('moim-A')).toBe(true);
    });

    it('존재하지 않는 모임 삭제는 404', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(service.deleteMoim('sub-U', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('kickMember (owner 전용 강제 퇴장)', () => {
    it('owner가 일반 멤버를 강제 퇴장 시 해당 멤버십만 삭제된다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await service.kickMember('sub-owner', 'moim-A', 'sub-member');

      expect(tables.member.has('moim-A:sub-member')).toBe(false);
      // owner 멤버십은 불변.
      expect(tables.member.has('moim-A:sub-owner')).toBe(true);
    });

    it('비-owner가 강제 퇴장 시도는 403', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.kickMember('sub-member', 'moim-A', 'sub-owner'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('대상이 모임의 멤버가 아니면 404', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.kickMember('sub-owner', 'moim-A', 'sub-stranger'),
      ).rejects.toThrow(NotFoundException);
    });

    it('대상이 owner이면 403(owner는 퇴장 불가)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      // owner가 자기 자신을 강제 퇴장 시도(대상 role === owner → 403).
      await expect(
        service.kickMember('sub-owner', 'moim-A', 'sub-owner'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 모임이면 404', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.kickMember('sub-owner', 'missing', 'sub-member'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('transferOwner (소유권 이양)', () => {
    it('성공 시 현 owner → member, 대상 → owner로 변경하고 createdBy는 불변이다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await service.transferOwner('sub-owner', 'moim-A', 'sub-member');

      expect(tables.member.get('moim-A:sub-owner')?.role).toBe('member');
      expect(tables.member.get('moim-A:sub-member')?.role).toBe('owner');
      // createdBy 불변.
      expect(tables.moim.get('moim-A')?.createdBy).toBe('sub-owner');
    });

    it('비-owner가 이양 시도는 403', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.transferOwner('sub-member', 'moim-A', 'sub-owner'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('자기 자신에게 이양은 400(BadRequestException)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.transferOwner('sub-owner', 'moim-A', 'sub-owner'),
      ).rejects.toThrow(BadRequestException);
    });

    it('빈 userId는 400(BadRequestException)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.transferOwner('sub-owner', 'moim-A', '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('대상이 모임의 멤버가 아니면 404', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.transferOwner('sub-owner', 'moim-A', 'sub-stranger'),
      ).rejects.toThrow(NotFoundException);
    });

    it('존재하지 않는 모임이면 404', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.transferOwner('sub-owner', 'missing', 'sub-member'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // SPEC-MOIM-012: createMoim maxMembers + updateMaxMembers
  // ─────────────────────────────────────────────────────────────────
  describe('createMoim — maxMembers (SPEC-MOIM-012 REQ-MOIM12-001)', () => {
    it('maxMembers 미전달 시 DB @default(15)가 적용된다', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      const moim = await service.createMoim('sub-U', '모임', '호스트');

      expect(moim.maxMembers).toBe(15);
    });

    it('custom maxMembers를 전달하면 해당 값으로 생성된다', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      const moim = await service.createMoim(
        'sub-U',
        '소규모 모임',
        '호스트',
        undefined,
        undefined,
        5,
      );

      expect(moim.maxMembers).toBe(5);
    });
  });

  describe('updateMaxMembers (SPEC-MOIM-012 REQ-MOIM12-001)', () => {
    it('owner가 정원을 수정하면 업데이트된 모임을 반환한다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      const updated = await service.updateMaxMembers('sub-owner', 'moim-A', 30);

      expect(updated.maxMembers).toBe(30);
      expect(tables.moim.get('moim-A')?.maxMembers).toBe(30);
    });

    it('비-owner가 정원 수정을 시도하면 403(ForbiddenException)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.updateMaxMembers('sub-member', 'moim-A', 20),
      ).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 모임이면 404', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.updateMaxMembers('sub-U', 'missing', 10),
      ).rejects.toThrow(NotFoundException);
    });

    it('현재 멤버 수 미만으로 낮춰도 오류 없이 허용된다(소급 퇴장 없음)', async () => {
      // maxMembers 기본 15, 현재 멤버 2명 → 1로 낮춰도 성공
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      const updated = await service.updateMaxMembers('sub-owner', 'moim-A', 1);

      expect(updated.maxMembers).toBe(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // SPEC-MOIM-EXPENSE-001 REQ-EXP-010: updateMoimSettings — budget
  // ─────────────────────────────────────────────────────────────────
  describe('updateMoimSettings — budget(SPEC-MOIM-EXPENSE-001 REQ-EXP-010)', () => {
    it('owner 가 budget 을 설정하면 저장된 값이 반환된다', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma, tables } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      const updated = await service.updateMoimSettings(
        'sub-owner',
        'moim-A',
        undefined,
        100000,
      );

      expect(updated.budget).toBe(100000);
      expect(
        (tables.moim.get('moim-A') as Moim & { budget?: number | null })
          ?.budget,
      ).toBe(100000);
    });

    it('budget=null 로 설정하면 예산이 해제된다', async () => {
      const { moim, owner, member } = seededMoim();
      // 미리 budget 을 가진 모임으로 초기화.
      const moimWithBudget = { ...moim, budget: 50000 };
      const { prisma } = makePrisma({
        moims: [moimWithBudget],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      const updated = await service.updateMoimSettings(
        'sub-owner',
        'moim-A',
        undefined,
        null,
      );

      expect(updated.budget).toBeNull();
    });

    it('비-owner 가 budget 설정을 시도하면 403(ForbiddenException)', async () => {
      const { moim, owner, member } = seededMoim();
      const { prisma } = makePrisma({
        moims: [moim],
        members: [owner, member],
      });
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.updateMoimSettings('sub-member', 'moim-A', undefined, 100000),
      ).rejects.toThrow(ForbiddenException);
    });

    it('존재하지 않는 모임이면 404(NotFoundException)', async () => {
      const { prisma } = makePrisma();
      const service = new MoimService(prisma, makeEvents());

      await expect(
        service.updateMoimSettings('sub-owner', 'missing', undefined, 100000),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // SPEC-NOTIFICATIONS-001 M2: transferOwner/kickMember 도메인 이벤트 발행
  // 성공 경로만 정확히 1회 발행 + no-op/authz-fail 경로 미발행 + best-effort 격리.
  // ─────────────────────────────────────────────────────────────────
  describe('M2 이벤트 발행 (SPEC-NOTIFICATIONS-001)', () => {
    // 발행 검증용 서비스: emit 스텁 참조를 유지해 호출 여부/인자를 단언한다(unbound-method 회피).
    function makeServiceWithEmit(seed?: {
      moims?: Moim[];
      members?: MoimMember[];
    }): { service: MoimService; tables: Tables; emit: jest.Mock } {
      const { prisma, tables } = makePrisma(seed);
      const emit = jest.fn();
      const service = new MoimService(prisma, {
        emit,
      } as unknown as EventEmitter2);
      return { service, tables, emit };
    }

    // best-effort 경로의 console.error 노이즈 억제(테스트 실패 아님 — 로깅은 의도된 동작).
    beforeEach(() => {
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe('kickMember', () => {
      it('성공 시 moim.member.kicked 를 정확히 1회 발행한다(actorId=owner, targetId=퇴장자)', async () => {
        const { moim, owner, member } = seededMoim();
        const { service, emit } = makeServiceWithEmit({
          moims: [moim],
          members: [owner, member],
        });

        await service.kickMember('sub-owner', 'moim-A', 'sub-member');

        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(MOIM_MEMBER_KICKED, {
          moimId: 'moim-A',
          actorId: 'sub-owner',
          targetId: 'sub-member',
        });
      });

      it('비-owner(403)/대상 owner(403)/대상 부재(404) 경로는 발행하지 않는다', async () => {
        const { moim, owner, member } = seededMoim();
        const { service, emit } = makeServiceWithEmit({
          moims: [moim],
          members: [owner, member],
        });

        await expect(
          service.kickMember('sub-member', 'moim-A', 'sub-owner'),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          service.kickMember('sub-owner', 'moim-A', 'sub-owner'),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          service.kickMember('sub-owner', 'moim-A', 'sub-stranger'),
        ).rejects.toThrow(NotFoundException);

        expect(emit).not.toHaveBeenCalled();
      });

      it('발행이 throw 해도 퇴장은 성립한다(best-effort 격리)', async () => {
        const { moim, owner, member } = seededMoim();
        const { service, tables, emit } = makeServiceWithEmit({
          moims: [moim],
          members: [owner, member],
        });
        emit.mockImplementationOnce(() => {
          throw new Error('listener boom');
        });

        await expect(
          service.kickMember('sub-owner', 'moim-A', 'sub-member'),
        ).resolves.toBeUndefined();
        expect(tables.member.has('moim-A:sub-member')).toBe(false);
      });
    });

    describe('transferOwner', () => {
      it('성공 시 moim.owner.transferred 를 정확히 1회 발행한다(actorId=현owner, newOwnerId=대상)', async () => {
        const { moim, owner, member } = seededMoim();
        const { service, emit } = makeServiceWithEmit({
          moims: [moim],
          members: [owner, member],
        });

        await service.transferOwner('sub-owner', 'moim-A', 'sub-member');

        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith(MOIM_OWNER_TRANSFERRED, {
          moimId: 'moim-A',
          actorId: 'sub-owner',
          newOwnerId: 'sub-member',
        });
      });

      it('비-owner(403)/self(400)/대상 부재(404) 경로는 발행하지 않는다', async () => {
        const { moim, owner, member } = seededMoim();
        const { service, emit } = makeServiceWithEmit({
          moims: [moim],
          members: [owner, member],
        });

        await expect(
          service.transferOwner('sub-member', 'moim-A', 'sub-owner'),
        ).rejects.toThrow(ForbiddenException);
        await expect(
          service.transferOwner('sub-owner', 'moim-A', 'sub-owner'),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.transferOwner('sub-owner', 'moim-A', 'sub-stranger'),
        ).rejects.toThrow(NotFoundException);

        expect(emit).not.toHaveBeenCalled();
      });

      it('발행이 throw 해도 이양은 성립한다(best-effort 격리)', async () => {
        const { moim, owner, member } = seededMoim();
        const { service, tables, emit } = makeServiceWithEmit({
          moims: [moim],
          members: [owner, member],
        });
        emit.mockImplementationOnce(() => {
          throw new Error('listener boom');
        });

        await expect(
          service.transferOwner('sub-owner', 'moim-A', 'sub-member'),
        ).resolves.toBeUndefined();
        expect(tables.member.get('moim-A:sub-member')?.role).toBe('owner');
      });
    });
  });
});
