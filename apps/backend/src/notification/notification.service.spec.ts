import { BadRequestException } from '@nestjs/common';
import type {
  Moim,
  MoimMember,
  Notification,
} from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

// NotificationService 단위 테스트(SPEC-NOTIFICATIONS-001 M3). 인메모리 fake Prisma 로 검증한다:
//   - listForRecipient: recipientId=sub 필터 + keyset(id lt, desc, take limit) + nextCursor(가득/부족) +
//     (moimId, actorId) 배치 해석(모임명/닉네임) + 대상 부재 시 graceful fallback.
//   - unreadCount: recipientId=sub AND readAt=null 카운트.
//   - markRead: recipientId=sub AND readAt=null (+ ids in) 만 갱신, updated 수 반환, 멱등.
//   - 인가 격리: 모든 쿼리가 recipientId=sub 로 필터되어 남의 알림을 반환/갱신하지 않는다.
// expense/schedule.service.spec 패턴 미러 — fake 는 async 대신 Promise.resolve 반환(require-await 회피).

const NOW = new Date('2026-07-02T00:00:00.000Z');

// ── fake Prisma 인자 형태(no-unsafe 회피용 명시 타입) ──────────────────────────
interface NotifFindManyArg {
  where: { recipientId: string; id?: { lt: bigint } };
  orderBy: { id: 'desc' };
  take: number;
}
interface NotifCountArg {
  where: { recipientId: string; readAt: null };
}
interface NotifUpdateManyArg {
  where: { recipientId: string; readAt: null; id?: { in: bigint[] } };
  data: { readAt: Date };
}
interface MoimFindManyArg {
  where: { id: { in: string[] } };
}
interface MemberFindManyArg {
  where: { moimId: { in: string[] }; userId: { in: string[] } };
}

interface Store {
  notifications: Notification[];
  moims: Moim[];
  members: MoimMember[];
}

interface Mocks {
  findMany: jest.Mock<Promise<Notification[]>, [NotifFindManyArg]>;
  count: jest.Mock<Promise<number>, [NotifCountArg]>;
  updateMany: jest.Mock<Promise<{ count: number }>, [NotifUpdateManyArg]>;
  moimFindMany: jest.Mock<Promise<Moim[]>, [MoimFindManyArg]>;
  memberFindMany: jest.Mock<Promise<MoimMember[]>, [MemberFindManyArg]>;
}

function notif(
  overrides: Partial<Notification> & { id: bigint; recipientId: string },
): Notification {
  return {
    id: overrides.id,
    recipientId: overrides.recipientId,
    type: overrides.type ?? 'member.joined',
    moimId: overrides.moimId ?? 'moim-A',
    actorId: overrides.actorId ?? null,
    data: overrides.data ?? {},
    readAt: overrides.readAt ?? null,
    createdAt: overrides.createdAt ?? NOW,
  };
}

function moim(id: string, name: string): Moim {
  return {
    id,
    name,
    startsAt: null,
    location: null,
    createdBy: 'sub-owner',
    maxMembers: 15,
    createdAt: NOW,
    budget: null,
  };
}

function member(moimId: string, userId: string, nickname: string): MoimMember {
  return {
    moimId,
    userId,
    nickname,
    role: 'member',
    joinedAt: NOW,
  };
}

// id 내림차순 정렬(BigInt 비교).
function byIdDesc(a: Notification, b: Notification): number {
  if (a.id < b.id) return 1;
  if (a.id > b.id) return -1;
  return 0;
}

function makeService(
  seed: Partial<Store> & { notifications: Notification[] },
): { service: NotificationService; store: Store; mocks: Mocks } {
  const store: Store = {
    notifications: seed.notifications,
    moims: seed.moims ?? [],
    members: seed.members ?? [],
  };

  const findMany = jest.fn<Promise<Notification[]>, [NotifFindManyArg]>(
    (arg) => {
      let rows = store.notifications.filter(
        (n) => n.recipientId === arg.where.recipientId,
      );
      const lt = arg.where.id?.lt;
      if (lt !== undefined) {
        rows = rows.filter((n) => n.id < lt);
      }
      rows = [...rows].sort(byIdDesc);
      return Promise.resolve(rows.slice(0, arg.take));
    },
  );

  const count = jest.fn<Promise<number>, [NotifCountArg]>((arg) =>
    Promise.resolve(
      store.notifications.filter(
        (n) => n.recipientId === arg.where.recipientId && n.readAt === null,
      ).length,
    ),
  );

  const updateMany = jest.fn<Promise<{ count: number }>, [NotifUpdateManyArg]>(
    (arg) => {
      const idsIn = arg.where.id?.in;
      const matched = store.notifications.filter((n) => {
        if (n.recipientId !== arg.where.recipientId) return false;
        if (n.readAt !== null) return false;
        if (idsIn !== undefined && !idsIn.includes(n.id)) return false;
        return true;
      });
      for (const n of matched) {
        n.readAt = arg.data.readAt;
      }
      return Promise.resolve({ count: matched.length });
    },
  );

  const moimFindMany = jest.fn<Promise<Moim[]>, [MoimFindManyArg]>((arg) =>
    Promise.resolve(store.moims.filter((m) => arg.where.id.in.includes(m.id))),
  );

  const memberFindMany = jest.fn<Promise<MoimMember[]>, [MemberFindManyArg]>(
    (arg) =>
      Promise.resolve(
        store.members.filter(
          (m) =>
            arg.where.moimId.in.includes(m.moimId) &&
            arg.where.userId.in.includes(m.userId),
        ),
      ),
  );

  const prisma = {
    notification: { findMany, count, updateMany },
    moim: { findMany: moimFindMany },
    moimMember: { findMany: memberFindMany },
  } as unknown as PrismaService;

  const service = new NotificationService(prisma);
  return {
    service,
    store,
    mocks: { findMany, count, updateMany, moimFindMany, memberFindMany },
  };
}

describe('NotificationService (M3 읽기 API)', () => {
  // ── listForRecipient: keyset + 해석 ────────────────────────────────────────

  it('listForRecipient: recipientId=sub 로 필터하고 id 내림차순 + take limit 로 페이지를 만든다', async () => {
    const { service, mocks } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A' }),
        notif({ id: 2n, recipientId: 'sub-A' }),
        notif({ id: 3n, recipientId: 'sub-A' }),
      ],
    });

    const page = await service.listForRecipient('sub-A', { limit: 2 });

    // 최신순(3,2) 2개 + 아직 더 있음 → nextCursor = 마지막(2).
    expect(page.items.map((i) => i.id)).toEqual([3n, 2n]);
    expect(page.nextCursor).toBe('2');
    // 쿼리는 recipientId=sub + desc + take 로 나간다.
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { recipientId: 'sub-A' },
      orderBy: { id: 'desc' },
      take: 2,
    });
  });

  it('listForRecipient: cursor 지정 시 id < cursor 로 다음 페이지를 잘라온다', async () => {
    const { service, mocks } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A' }),
        notif({ id: 2n, recipientId: 'sub-A' }),
        notif({ id: 3n, recipientId: 'sub-A' }),
      ],
    });

    const page = await service.listForRecipient('sub-A', {
      cursor: '3',
      limit: 20,
    });

    // id < 3 → [2,1]. limit(20)보다 적으므로 nextCursor=null.
    expect(page.items.map((i) => i.id)).toEqual([2n, 1n]);
    expect(page.nextCursor).toBeNull();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { recipientId: 'sub-A', id: { lt: 3n } },
      orderBy: { id: 'desc' },
      take: 20,
    });
  });

  it('listForRecipient: 반환 행이 limit 보다 적으면 nextCursor 는 null(마지막 페이지)', async () => {
    const { service } = makeService({
      notifications: [notif({ id: 1n, recipientId: 'sub-A' })],
    });

    const page = await service.listForRecipient('sub-A', { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('listForRecipient: 알림이 없으면 빈 items + null 커서 + 해석 쿼리 미발생(빈 in 회피)', async () => {
    const { service, mocks } = makeService({ notifications: [] });

    const page = await service.listForRecipient('sub-A', { limit: 20 });

    expect(page).toEqual({ items: [], nextCursor: null });
    expect(mocks.moimFindMany).not.toHaveBeenCalled();
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('listForRecipient: 잘못된 cursor 는 BadRequestException(400) — findMany 미발생', async () => {
    const { service, mocks } = makeService({
      notifications: [notif({ id: 1n, recipientId: 'sub-A' })],
    });

    await expect(
      service.listForRecipient('sub-A', { cursor: 'not-a-bigint', limit: 20 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it('listForRecipient: (moimId, actorId) 배치로 모임명 + actor 닉네임을 해석한다', async () => {
    const { service, mocks } = makeService({
      notifications: [
        notif({
          id: 5n,
          recipientId: 'sub-A',
          moimId: 'moim-A',
          actorId: 'sub-actor',
          type: 'member.joined',
          data: { foo: 'bar' },
        }),
      ],
      moims: [moim('moim-A', '금요일 모임')],
      members: [member('moim-A', 'sub-actor', '길동')],
    });

    const page = await service.listForRecipient('sub-A', { limit: 20 });

    expect(page.items[0]).toEqual({
      id: 5n,
      type: 'member.joined',
      moimId: 'moim-A',
      moimName: '금요일 모임',
      actor: { id: 'sub-actor', nickname: '길동' },
      data: { foo: 'bar' },
      readAt: null,
      createdAt: NOW,
    });
    // 해석 쿼리는 고유 id 로 각각 1회씩.
    expect(mocks.moimFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['moim-A'] } },
    });
    expect(mocks.memberFindMany).toHaveBeenCalledWith({
      where: { moimId: { in: ['moim-A'] }, userId: { in: ['sub-actor'] } },
    });
  });

  it('listForRecipient: actorId 가 null 이면 actor=null(무행위자 알림)', async () => {
    const { service } = makeService({
      notifications: [
        notif({
          id: 1n,
          recipientId: 'sub-A',
          moimId: 'moim-A',
          actorId: null,
        }),
      ],
      moims: [moim('moim-A', '금요일 모임')],
    });

    const page = await service.listForRecipient('sub-A', { limit: 20 });

    expect(page.items[0].actor).toBeNull();
    expect(page.items[0].moimName).toBe('금요일 모임');
  });

  it('listForRecipient: 멤버 행이 사라졌으면 닉네임 fallback, 모임이 사라졌으면 moimName=null', async () => {
    const { service } = makeService({
      notifications: [
        notif({
          id: 1n,
          recipientId: 'sub-A',
          moimId: 'moim-gone',
          actorId: 'sub-gone',
        }),
      ],
      // moims/members 비움 → 해석 실패 경로.
    });

    const page = await service.listForRecipient('sub-A', { limit: 20 });

    expect(page.items[0].moimName).toBeNull();
    // actorId 는 있으나 멤버 행 부재 → actor 는 살아있고 nickname 만 fallback.
    expect(page.items[0].actor).toEqual({
      id: 'sub-gone',
      nickname: '알 수 없음',
    });
  });

  // ── 인가 격리: 남의 알림 미노출 ────────────────────────────────────────────

  it('인가 격리(list): sub-A 조회는 sub-B 의 알림을 절대 반환하지 않는다', async () => {
    const { service } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A' }),
        notif({ id: 2n, recipientId: 'sub-B' }),
        notif({ id: 3n, recipientId: 'sub-A' }),
      ],
    });

    const page = await service.listForRecipient('sub-A', { limit: 20 });

    // sub-B(id=2)는 제외 — recipientId 필터가 where 절에 박혀 있어 교차 노출 불가.
    expect(page.items.map((i) => i.id)).toEqual([3n, 1n]);
    expect(page.items.every((i) => i.id !== 2n)).toBe(true);
  });

  // ── unreadCount ────────────────────────────────────────────────────────────

  it('unreadCount: recipientId=sub AND readAt=null 만 센다', async () => {
    const { service, mocks } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A', readAt: null }),
        notif({ id: 2n, recipientId: 'sub-A', readAt: NOW }), // 읽음 — 제외
        notif({ id: 3n, recipientId: 'sub-A', readAt: null }),
        notif({ id: 4n, recipientId: 'sub-B', readAt: null }), // 남의 것 — 제외
      ],
    });

    const count = await service.unreadCount('sub-A');

    expect(count).toBe(2);
    expect(mocks.count).toHaveBeenCalledWith({
      where: { recipientId: 'sub-A', readAt: null },
    });
  });

  // ── markRead ───────────────────────────────────────────────────────────────

  it('markRead(all): 수신자의 미읽음 전체를 읽음 처리하고 updated 수를 반환한다', async () => {
    const { service, store, mocks } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A', readAt: null }),
        notif({ id: 2n, recipientId: 'sub-A', readAt: NOW }), // 이미 읽음 — 재갱신 안 함
        notif({ id: 3n, recipientId: 'sub-A', readAt: null }),
      ],
    });

    const result = await service.markRead('sub-A', { all: true });

    expect(result).toEqual({ updated: 2 });
    // 미읽음(1,3)만 readAt 채워짐 — 이미 읽은 2는 그대로.
    expect(store.notifications.find((n) => n.id === 1n)?.readAt).not.toBeNull();
    expect(store.notifications.find((n) => n.id === 3n)?.readAt).not.toBeNull();
    // updateMany where 에 id in 절이 없다(all).
    const arg = mocks.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ recipientId: 'sub-A', readAt: null });
  });

  it('markRead(ids): 지정 id 중 미읽음만 읽음 처리한다(id in 절 포함)', async () => {
    const { service, store, mocks } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A', readAt: null }),
        notif({ id: 2n, recipientId: 'sub-A', readAt: null }),
        notif({ id: 3n, recipientId: 'sub-A', readAt: null }),
      ],
    });

    const result = await service.markRead('sub-A', { ids: ['1', '3'] });

    expect(result).toEqual({ updated: 2 });
    expect(store.notifications.find((n) => n.id === 2n)?.readAt).toBeNull();
    // ids 문자열이 BigInt in 절로 변환됐다.
    const arg = mocks.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({
      recipientId: 'sub-A',
      readAt: null,
      id: { in: [1n, 3n] },
    });
  });

  it('인가 격리(markRead): where 에 recipientId=sub 가 항상 있어 남의 알림은 갱신되지 않는다', async () => {
    const { service, store } = makeService({
      notifications: [
        notif({ id: 1n, recipientId: 'sub-A', readAt: null }),
        notif({ id: 2n, recipientId: 'sub-B', readAt: null }),
      ],
    });

    // sub-A 가 sub-B 의 알림 id(2)를 읽음 처리하려 해도 recipientId=sub-A 필터로 매칭되지 않는다.
    const result = await service.markRead('sub-A', { ids: ['2'] });

    expect(result).toEqual({ updated: 0 });
    // sub-B 의 알림은 여전히 미읽음.
    expect(store.notifications.find((n) => n.id === 2n)?.readAt).toBeNull();
  });
});
