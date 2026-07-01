import type { MoimMember } from '../generated/prisma/client';
import { type MoimMemberJoinedPayload } from '../invite/invite-events';
import type { PrismaService } from '../prisma/prisma.service';
import { NotificationListener } from './notification.listener';
import { NotificationService } from './notification.service';

// NotificationListener 단위 테스트(SPEC-NOTIFICATIONS-001 M1). fake Prisma(moim_member 조회 + notification 삽입)와
// 실제 NotificationService 로 검증한다: moim.member.joined 수신 시 수신자당 1행(모임 멤버 − actor) 삽입 +
// actor 제외 + 올바른 type/moimId/actorId + 수신자 0명 시 미삽입 + best-effort(에러 격리). push.listener.spec 미러.

const PAYLOAD: MoimMemberJoinedPayload = {
  moimId: 'moim-A',
  actorId: 'sub-new',
};

function member(userId: string): MoimMember {
  return {
    moimId: 'moim-A',
    userId,
    nickname: userId,
    role: userId === 'sub-owner' ? 'owner' : 'member',
    joinedAt: new Date('2026-07-01T00:00:00.000Z'),
  };
}

// notification.createMany 가 받는 인자 형태(수신자당 1행 배열).
interface NotificationRow {
  recipientId: string;
  type: string;
  moimId: string;
  actorId: string | null;
  data: unknown;
}
type CreateManyArg = { data: NotificationRow[] };

interface Mocks {
  memberFindMany: jest.Mock<Promise<MoimMember[]>, [unknown]>;
  createMany: jest.Mock<Promise<{ count: number }>, [CreateManyArg]>;
}

function makeListener(members: MoimMember[]): {
  listener: NotificationListener;
  mocks: Mocks;
} {
  const memberFindMany = jest
    .fn<Promise<MoimMember[]>, [unknown]>()
    .mockResolvedValue(members);
  const createMany = jest
    .fn<Promise<{ count: number }>, [CreateManyArg]>()
    .mockImplementation((arg) => Promise.resolve({ count: arg.data.length }));

  const prisma = {
    moimMember: { findMany: memberFindMany },
    notification: { createMany },
  } as unknown as PrismaService;
  const service = new NotificationService(prisma);
  const listener = new NotificationListener(prisma, service);

  return { listener, mocks: { memberFindMany, createMany } };
}

describe('NotificationListener', () => {
  // best-effort 경로의 console.error 노이즈를 억제한다(테스트 실패 아님 — 로깅은 의도된 동작).
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('member.joined: actor 를 제외한 각 멤버당 1행을 삽입한다(type/moimId/actorId/data 정확)', async () => {
    // 모임 A: owner + 멤버2 + 신규(actor). 신규가 자기 가입 알림을 받지 않도록 수신자에서 제외된다.
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
      member('sub-new'),
    ]);

    await listener.handleMemberJoined(PAYLOAD);

    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    const arg = mocks.createMany.mock.calls[0][0];

    // 수신자 = 멤버 − actor(sub-new). owner + 멤버2 만.
    const recipients = arg.data.map((r) => r.recipientId).sort();
    expect(recipients).toEqual(['sub-2', 'sub-owner']);
    expect(recipients).not.toContain('sub-new');

    // 각 행: type='member.joined'(이벤트명 아님), moimId/actorId 일치, data={}.
    for (const row of arg.data) {
      expect(row.type).toBe('member.joined');
      expect(row.moimId).toBe('moim-A');
      expect(row.actorId).toBe('sub-new');
      expect(row.data).toEqual({});
    }
  });

  it('수신자 조회는 payload.moimId 로 moim_member 를 조회한다', async () => {
    const { listener, mocks } = makeListener([
      member('sub-2'),
      member('sub-new'),
    ]);

    await listener.handleMemberJoined(PAYLOAD);

    expect(mocks.memberFindMany).toHaveBeenCalledWith({
      where: { moimId: 'moim-A' },
    });
  });

  it('actor 가 유일한 멤버면 수신자 0명 — createMany 를 호출하지 않는다(빈 배치 회피)', async () => {
    const { listener, mocks } = makeListener([member('sub-new')]);

    await listener.handleMemberJoined(PAYLOAD);

    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('best-effort: moim_member 조회가 throw 해도 리스너는 throw 하지 않는다(발행 격리)', async () => {
    const { listener, mocks } = makeListener([
      member('sub-2'),
      member('sub-new'),
    ]);
    mocks.memberFindMany.mockRejectedValueOnce(new Error('DB down'));

    await expect(listener.handleMemberJoined(PAYLOAD)).resolves.toBeUndefined();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('best-effort: non-Error 값으로 reject 돼도 unknown error 로 흡수한다(catch ternary fallback)', async () => {
    const { listener, mocks } = makeListener([
      member('sub-2'),
      member('sub-new'),
    ]);
    // Error 가 아닌 값(문자열)으로 reject — err instanceof Error 의 false 분기를 커버.
    mocks.memberFindMany.mockRejectedValueOnce('boom');

    await expect(listener.handleMemberJoined(PAYLOAD)).resolves.toBeUndefined();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});
