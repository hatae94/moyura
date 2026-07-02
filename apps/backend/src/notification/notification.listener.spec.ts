import type { MoimMember } from '../generated/prisma/client';
import {
  type MoimExpenseAddedPayload,
  type MoimSettlementCompletedPayload,
  type MoimSettlementRequestedPayload,
} from '../expense/expense-events';
import { type MoimMemberJoinedPayload } from '../invite/invite-events';
import {
  type MoimMemberKickedPayload,
  type MoimOwnerTransferredPayload,
} from '../moim/moim-events';
import {
  type MoimPollClosedPayload,
  type MoimPollCreatedPayload,
} from '../poll/poll-events';
import type { PrismaService } from '../prisma/prisma.service';
import type { SafetyService } from '../safety/safety.service';
import {
  type MoimScheduleConfirmedPayload,
  type MoimScheduleStartedPayload,
} from '../schedule/schedule-events';
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
    withdrawnAt: null,
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
  // SPEC-SAFETY-001 T-005: NotificationService 가 SafetyService 를 주입받는다. 리스너는 fan-out 쓰기
  // (createForRecipients)만 쓰고 getHiddenUserIds 는 호출하지 않으므로 스텁만 있으면 된다.
  const safety = {
    getHiddenUserIds: jest.fn(() => Promise.resolve([])),
  } as unknown as SafetyService;
  const service = new NotificationService(prisma, safety);
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

  // ── SPEC-NOTIFICATIONS-001 M2: 이벤트별 수신자 전략 + type/data ────────────────

  it('owner.transferred: 모임 전체 − actor 에게 owner.delegated 를 발행한다(data.newOwnerId)', async () => {
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
      member('sub-new'),
    ]);
    const payload: MoimOwnerTransferredPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      newOwnerId: 'sub-2',
    };

    await listener.handleOwnerTransferred(payload);

    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    const arg = mocks.createMany.mock.calls[0][0];
    const recipients = arg.data.map((r) => r.recipientId).sort();
    // actor(sub-owner)만 제외 — 신 방장(sub-2)도 모임 전체 공지를 받는다.
    expect(recipients).toEqual(['sub-2', 'sub-new']);
    for (const row of arg.data) {
      expect(row.type).toBe('owner.delegated');
      expect(row.moimId).toBe('moim-A');
      expect(row.actorId).toBe('sub-owner');
      expect(row.data).toEqual({ newOwnerId: 'sub-2' });
    }
  });

  it('member.kicked: 퇴장 당사자(targetId)에게만 발행한다(모임 방송 아님)', async () => {
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
    ]);
    const payload: MoimMemberKickedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      targetId: 'sub-2',
    };

    await listener.handleMemberKicked(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-2']);
    expect(arg.data[0].type).toBe('member.kicked');
    expect(arg.data[0].actorId).toBe('sub-owner');
    expect(arg.data[0].data).toEqual({});
    // moim_member 조회 없이 payload.targetId 를 직접 쓴다(개인 통지).
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('schedule.started: 모임 − actor 에게 schedule.started 를 발행한다', async () => {
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
    ]);
    const payload: MoimScheduleStartedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      scheduleEventId: 'ev-1',
    };

    await listener.handleScheduleStarted(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-2']);
    expect(arg.data[0].type).toBe('schedule.started');
    expect(arg.data[0].data).toEqual({});
  });

  it('schedule.confirmed: data.startsAt(ISO) 을 실어 모임 − actor 에게 발행한다', async () => {
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
    ]);
    const payload: MoimScheduleConfirmedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      startsAt: '2026-07-04T13:00:00.000Z',
    };

    await listener.handleScheduleConfirmed(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-2']);
    expect(arg.data[0].type).toBe('schedule.confirmed');
    expect(arg.data[0].data).toEqual({ startsAt: '2026-07-04T13:00:00.000Z' });
  });

  it('poll.created: data{pollId, question} 를 실어 모임 − actor 에게 발행한다', async () => {
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
    ]);
    const payload: MoimPollCreatedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      pollId: 'poll-1',
      question: '점심 뭐 먹지?',
    };

    await listener.handlePollCreated(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-2']);
    expect(arg.data[0].type).toBe('poll.created');
    expect(arg.data[0].data).toEqual({
      pollId: 'poll-1',
      question: '점심 뭐 먹지?',
    });
  });

  it('poll.closed: data{pollId, question} 를 실어 모임 − actor 에게 발행한다', async () => {
    const { listener, mocks } = makeListener([
      member('sub-owner'),
      member('sub-2'),
    ]);
    const payload: MoimPollClosedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      pollId: 'poll-1',
      question: '점심 뭐 먹지?',
    };

    await listener.handlePollClosed(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-2']);
    expect(arg.data[0].type).toBe('poll.closed');
    expect(arg.data[0].data).toEqual({
      pollId: 'poll-1',
      question: '점심 뭐 먹지?',
    });
  });

  it('expense.added: 분담 참가자(shareUserIds) − actor 에게만 발행한다(모임 방송 아님)', async () => {
    // 이 핸들러는 moim_member 를 조회하지 않고 payload.shareUserIds 를 직접 쓴다.
    const { listener, mocks } = makeListener([]);
    const payload: MoimExpenseAddedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      expenseId: 'exp-1',
      amount: 9000,
      category: '식비',
      shareUserIds: ['sub-owner', 'sub-2', 'sub-3'],
    };

    await listener.handleExpenseAdded(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    const recipients = arg.data.map((r) => r.recipientId).sort();
    // actor(sub-owner) 제외 — 분담 참가자에게만.
    expect(recipients).toEqual(['sub-2', 'sub-3']);
    expect(arg.data[0].type).toBe('expense.added');
    expect(arg.data[0].data).toEqual({
      expenseId: 'exp-1',
      amount: 9000,
      category: '식비',
    });
    expect(mocks.memberFindMany).not.toHaveBeenCalled();
  });

  it('expense.added: 분담 참가자가 actor 뿐이면 수신자 0명 — createMany 미호출', async () => {
    const { listener, mocks } = makeListener([]);
    const payload: MoimExpenseAddedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      expenseId: 'exp-1',
      amount: 9000,
      category: '식비',
      shareUserIds: ['sub-owner'],
    };

    await listener.handleExpenseAdded(payload);

    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('settlement.requested: 채무자(debtorId)에게만 data{amount} 로 발행한다', async () => {
    const { listener, mocks } = makeListener([]);
    const payload: MoimSettlementRequestedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      debtorId: 'sub-2',
      amount: 4000,
    };

    await listener.handleSettlementRequested(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-2']);
    expect(arg.data[0].type).toBe('settlement.requested');
    expect(arg.data[0].data).toEqual({ amount: 4000 });
  });

  it('settlement.completed: 상대방(counterpartyId)에게만 data{amount} 로 발행한다', async () => {
    const { listener, mocks } = makeListener([]);
    const payload: MoimSettlementCompletedPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      counterpartyId: 'sub-3',
      amount: 5000,
    };

    await listener.handleSettlementCompleted(payload);

    const arg = mocks.createMany.mock.calls[0][0];
    expect(arg.data.map((r) => r.recipientId)).toEqual(['sub-3']);
    expect(arg.data[0].type).toBe('settlement.completed');
    expect(arg.data[0].data).toEqual({ amount: 5000 });
  });

  it('best-effort: moim-wide 핸들러의 조회 실패는 throw 하지 않는다(발행 격리)', async () => {
    const { listener, mocks } = makeListener([member('sub-2')]);
    mocks.memberFindMany.mockRejectedValueOnce(new Error('DB down'));
    const payload: MoimOwnerTransferredPayload = {
      moimId: 'moim-A',
      actorId: 'sub-owner',
      newOwnerId: 'sub-2',
    };

    await expect(
      listener.handleOwnerTransferred(payload),
    ).resolves.toBeUndefined();
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});
