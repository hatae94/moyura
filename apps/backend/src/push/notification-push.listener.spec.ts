import type { MoimSettlementCompletedPayload } from '../expense/expense-events';
import type { DeviceToken, Moim, MoimMember } from '../generated/prisma/client';
import type { MoimMemberJoinedPayload } from '../invite/invite-events';
import type { PrismaService } from '../prisma/prisma.service';
import type { MoimScheduleConfirmedPayload } from '../schedule/schedule-events';
import type { FcmSender, PushData, PushNotification } from './fcm-sender';
import { NotificationPushListener } from './notification-push.listener';

// NotificationPushListener 단위 테스트(SPEC-NOTIFICATIONS-001 M6). 인앱 피드(NotificationListener)와 독립적인
// 추가 @OnEvent 구독자로, 고신호 3종만 FCM 으로 승격한다. prisma(멤버/디바이스/모임/닉네임)와 FcmSender 를 mock 으로
// 대체해 이벤트별 수신자 산정(멤버−actor / counterparty) + device_token 조인 + 카피/데이터 매핑 +
// 0-토큰 no-op + best-effort(에러 격리)를 검증한다. FcmSender.send 는 mock(no-op)이며 실제 발송은 하지 않는다.

const MOIM_ID = 'moim-A';

// deviceToken.findMany 가 받는 where 인자 형태(수신자 userId in 필터).
type DeviceFindManyArg = { where: { userId: { in: string[] } } };
// moimMember.findUnique 가 받는 where 인자 형태(복합키).
type MemberFindUniqueArg = {
  where: { moimId_userId: { moimId: string; userId: string } };
};
// moim.findUnique 가 받는 where 인자 형태.
type MoimFindUniqueArg = { where: { id: string } };

function member(userId: string, nickname: string): MoimMember {
  return {
    moimId: MOIM_ID,
    userId,
    nickname,
    role: 'member',
    joinedAt: new Date('2026-06-14T00:00:00.000Z'),
  };
}

function device(token: string, userId: string): DeviceToken {
  return {
    token,
    userId,
    platform: 'ios',
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    updatedAt: new Date('2026-06-14T00:00:00.000Z'),
  };
}

function moim(name: string): Moim {
  return {
    id: MOIM_ID,
    name,
    startsAt: null,
    location: null,
    createdBy: 'sub-owner',
    maxMembers: 15,
    createdAt: new Date('2026-06-14T00:00:00.000Z'),
    budget: null,
  };
}

interface Mocks {
  memberFindMany: jest.Mock<Promise<MoimMember[]>, [unknown]>;
  memberFindUnique: jest.Mock<
    Promise<MoimMember | null>,
    [MemberFindUniqueArg]
  >;
  moimFindUnique: jest.Mock<Promise<Moim | null>, [MoimFindUniqueArg]>;
  deviceFindMany: jest.Mock<Promise<DeviceToken[]>, [DeviceFindManyArg]>;
  send: jest.Mock<Promise<void>, [string[], PushNotification, PushData?]>;
}

function makeListener(opts: {
  members?: MoimMember[];
  devices?: DeviceToken[];
  moim?: Moim | null;
}): { listener: NotificationPushListener; mocks: Mocks } {
  const members = opts.members ?? [];
  const devices = opts.devices ?? [];
  const moimRow = opts.moim === undefined ? moim('주말모임') : opts.moim;

  const memberFindMany = jest
    .fn<Promise<MoimMember[]>, [unknown]>()
    .mockResolvedValue(members);
  // 복합키 조회는 members 목록에서 (moimId, userId) 로 찾아 반환한다(없으면 null → nickname 폴백 분기).
  const memberFindUnique = jest.fn((arg: MemberFindUniqueArg) =>
    Promise.resolve(
      members.find(
        (m) =>
          m.moimId === arg.where.moimId_userId.moimId &&
          m.userId === arg.where.moimId_userId.userId,
      ) ?? null,
    ),
  );
  const moimFindUnique = jest.fn((arg: MoimFindUniqueArg) =>
    Promise.resolve(moimRow && moimRow.id === arg.where.id ? moimRow : null),
  );
  // 실제 Prisma 처럼 where.userId.in 필터를 적용한다(naive mock 이 비수신자 디바이스를 흘려보내지 않도록).
  const deviceFindMany = jest.fn((arg: DeviceFindManyArg) =>
    Promise.resolve(
      devices.filter((d) => arg.where.userId.in.includes(d.userId)),
    ),
  );
  const send = jest
    .fn<Promise<void>, [string[], PushNotification, PushData?]>()
    .mockResolvedValue(undefined);

  const prisma = {
    moimMember: { findMany: memberFindMany, findUnique: memberFindUnique },
    moim: { findUnique: moimFindUnique },
    deviceToken: { findMany: deviceFindMany },
  } as unknown as PrismaService;
  const fcm = { send } as unknown as FcmSender;

  return {
    listener: new NotificationPushListener(prisma, fcm),
    mocks: {
      memberFindMany,
      memberFindUnique,
      moimFindUnique,
      deviceFindMany,
      send,
    },
  };
}

describe('NotificationPushListener (SPEC-NOTIFICATIONS-001 M6)', () => {
  describe('moim.member.joined', () => {
    const PAYLOAD: MoimMemberJoinedPayload = {
      moimId: MOIM_ID,
      actorId: 'sub-joiner',
    };

    it('actor(신규 가입자)를 제외한 멤버의 등록 디바이스로 발송한다 + data.type/moimId + 카피', async () => {
      // 기존 멤버 = owner(디바이스 등록). actor = 신규 가입자(닉네임 조이너, 발송 대상 아님).
      const { listener, mocks } = makeListener({
        members: [member('sub-owner', '방장'), member('sub-joiner', '조이너')],
        devices: [device('tok-owner', 'sub-owner')],
        moim: moim('주말모임'),
      });

      await listener.handleMemberJoined(PAYLOAD);

      // 디바이스 조회는 actor 를 제외한 수신자 집합으로만 한다(sub-owner).
      const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
      expect(deviceArg.where.userId.in).toEqual(['sub-owner']);
      expect(deviceArg.where.userId.in).not.toContain('sub-joiner');

      expect(mocks.send).toHaveBeenCalledTimes(1);
      const [tokens, notification, data] = mocks.send.mock.calls[0];
      expect(tokens).toEqual(['tok-owner']);
      expect(notification.title).toBe('moyura');
      // 닉네임 = actor(가입자)의 모임별 표시 이름, 모임명 = moim.name.
      expect(notification.body).toBe('조이너님이 주말모임에 참여했어요');
      expect(data).toEqual({ type: 'member.joined', moimId: MOIM_ID });
    });

    it('수신자에게 등록 디바이스가 없으면 발송하지 않는다 (0-토큰 no-op, 모임/닉네임 조회도 생략)', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-owner', '방장'), member('sub-joiner', '조이너')],
        devices: [], // 아무도 디바이스 미등록(웹/게스트만)
      });

      await listener.handleMemberJoined(PAYLOAD);

      expect(mocks.send).not.toHaveBeenCalled();
      // 토큰 0개 → early return: 모임명/닉네임 해석 쿼리를 아예 하지 않는다(불필요 쿼리 회피).
      expect(mocks.moimFindUnique).not.toHaveBeenCalled();
      expect(mocks.memberFindUnique).not.toHaveBeenCalled();
    });

    it('actor 외 수신자가 0명이면 device 조회 없이 no-op 이다 (빈 in 회피 branch)', async () => {
      // 멤버가 actor 뿐 → members − actor = [] → resolveDeviceTokens 가 device_token 조회 없이 빈 배열.
      const { listener, mocks } = makeListener({
        members: [member('sub-joiner', '조이너')],
        devices: [device('tok-joiner', 'sub-joiner')],
      });

      await listener.handleMemberJoined(PAYLOAD);

      expect(mocks.deviceFindMany).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('모임 행이 사라졌으면 모임명 안전 기본값으로 발송한다 (moimName 폴백 branch)', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-owner', '방장'), member('sub-joiner', '조이너')],
        devices: [device('tok-owner', 'sub-owner')],
        moim: null, // 모임 삭제 등
      });

      await listener.handleMemberJoined(PAYLOAD);

      const [, notification] = mocks.send.mock.calls[0];
      expect(notification.body).toBe('조이너님이 모임에 참여했어요');
    });

    it('actor 멤버 행이 없으면 닉네임 안전 기본값으로 발송한다 (nickname 폴백 branch)', async () => {
      // 수신자(owner)는 있지만 actor(가입자)의 멤버 행 조회가 null 인 경합/정리 상황.
      const { listener, mocks } = makeListener({
        members: [member('sub-owner', '방장')], // actor(sub-joiner) 멤버 행 없음
        devices: [device('tok-owner', 'sub-owner')],
        moim: moim('주말모임'),
      });

      await listener.handleMemberJoined(PAYLOAD);

      const [, notification] = mocks.send.mock.calls[0];
      expect(notification.body).toBe('알 수 없음님이 주말모임에 참여했어요');
    });

    it('best-effort: prisma 조회가 throw 해도 listener 는 throw 하지 않는다 (이벤트 발행 격리)', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-owner', '방장')],
        devices: [device('tok-owner', 'sub-owner')],
      });
      mocks.memberFindMany.mockRejectedValueOnce(new Error('DB down'));

      await expect(
        listener.handleMemberJoined(PAYLOAD),
      ).resolves.toBeUndefined();
      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('best-effort: non-Error 값으로 reject 돼도 unknown error 로 흡수한다 (catch ternary fallback)', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-owner', '방장')],
        devices: [device('tok-owner', 'sub-owner')],
      });
      mocks.memberFindMany.mockRejectedValueOnce('boom');

      await expect(
        listener.handleMemberJoined(PAYLOAD),
      ).resolves.toBeUndefined();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  });

  describe('moim.schedule.confirmed', () => {
    const PAYLOAD: MoimScheduleConfirmedPayload = {
      moimId: MOIM_ID,
      actorId: 'sub-actor',
      startsAt: '2026-07-10T12:00:00.000Z',
    };

    it('멤버 − actor 의 등록 디바이스로 발송한다 + body {모임} 일정이 확정됐어요 + data.type/moimId', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-actor', '확정자'), member('sub-2', '참가자2')],
        devices: [device('tok-2', 'sub-2')],
        moim: moim('한강피크닉'),
      });

      await listener.handleScheduleConfirmed(PAYLOAD);

      const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
      expect(deviceArg.where.userId.in).toEqual(['sub-2']);

      expect(mocks.send).toHaveBeenCalledTimes(1);
      const [tokens, notification, data] = mocks.send.mock.calls[0];
      expect(tokens).toEqual(['tok-2']);
      expect(notification.title).toBe('moyura');
      expect(notification.body).toBe('한강피크닉 일정이 확정됐어요');
      expect(data).toEqual({ type: 'schedule.confirmed', moimId: MOIM_ID });
    });

    it('수신자에게 등록 디바이스가 없으면 발송하지 않는다 (0-토큰 no-op)', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-actor', '확정자'), member('sub-2', '참가자2')],
        devices: [], // 미등록
      });

      await listener.handleScheduleConfirmed(PAYLOAD);

      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.moimFindUnique).not.toHaveBeenCalled();
    });

    it('best-effort: prisma 조회가 throw 해도 throw 하지 않는다', async () => {
      const { listener, mocks } = makeListener({
        members: [member('sub-actor', '확정자'), member('sub-2', '참가자2')],
        devices: [device('tok-2', 'sub-2')],
      });
      mocks.memberFindMany.mockRejectedValueOnce(new Error('DB down'));

      await expect(
        listener.handleScheduleConfirmed(PAYLOAD),
      ).resolves.toBeUndefined();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  });

  describe('moim.settlement.completed', () => {
    const PAYLOAD: MoimSettlementCompletedPayload = {
      moimId: MOIM_ID,
      actorId: 'sub-debtor',
      counterpartyId: 'sub-creditor',
      amount: 30000,
    };

    it('counterparty(요청자) 1명에게만 발송한다 + body {금액}원 정산이 완료됐어요 + data.type/moimId', async () => {
      const { listener, mocks } = makeListener({
        devices: [device('tok-creditor', 'sub-creditor')],
      });

      await listener.handleSettlementCompleted(PAYLOAD);

      // 수신자 = counterparty 만(actor=채무자 제외). device 조회 in 필터가 counterparty 단일.
      const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
      expect(deviceArg.where.userId.in).toEqual(['sub-creditor']);
      expect(deviceArg.where.userId.in).not.toContain('sub-debtor');

      expect(mocks.send).toHaveBeenCalledTimes(1);
      const [tokens, notification, data] = mocks.send.mock.calls[0];
      expect(tokens).toEqual(['tok-creditor']);
      expect(notification.title).toBe('moyura');
      expect(notification.body).toBe('30000원 정산이 완료됐어요');
      expect(data).toEqual({ type: 'settlement.completed', moimId: MOIM_ID });
    });

    it('counterparty 에게 등록 디바이스가 없으면 발송하지 않는다 (0-토큰 no-op)', async () => {
      const { listener, mocks } = makeListener({
        devices: [], // counterparty 미등록(웹만 사용)
      });

      await listener.handleSettlementCompleted(PAYLOAD);

      expect(mocks.send).not.toHaveBeenCalled();
    });

    it('settlement 은 모임 전체가 아니라 counterparty 만 대상이라 moimMember.findMany 를 호출하지 않는다', async () => {
      const { listener, mocks } = makeListener({
        devices: [device('tok-creditor', 'sub-creditor')],
      });

      await listener.handleSettlementCompleted(PAYLOAD);

      expect(mocks.memberFindMany).not.toHaveBeenCalled();
    });

    it('best-effort: device 조회가 throw 해도 throw 하지 않는다', async () => {
      const { listener, mocks } = makeListener({
        devices: [device('tok-creditor', 'sub-creditor')],
      });
      mocks.deviceFindMany.mockRejectedValueOnce(new Error('DB down'));

      await expect(
        listener.handleSettlementCompleted(PAYLOAD),
      ).resolves.toBeUndefined();
      expect(mocks.send).not.toHaveBeenCalled();
    });
  });
});
