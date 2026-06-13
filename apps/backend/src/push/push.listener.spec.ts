import type { ChatMessageCreatedPayload } from '../chat/chat-events';
import type {
  DeviceToken,
  MoimMember,
} from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { FcmSender } from './fcm-sender';
import { PushListener } from './push.listener';

// PushListener 단위 테스트(REQ-PUSH-001/006 / AC-1,4). prisma(멤버/디바이스/sender 닉네임)와 FcmSender를
// mock으로 대체해 수신 대상 산정(멤버 - sender ⋈ device_token) + sender 제외 + 게스트(미등록) 제외 +
// 서버 측 nickname 해석 + 0-토큰 미발송 + best-effort(에러 격리)를 검증한다.

const PAYLOAD: ChatMessageCreatedPayload = {
  messageId: '42',
  moimId: 'moim-A',
  senderId: 'sub-sender',
  preview: '안녕하세요 여러분',
};

function member(userId: string, nickname: string): MoimMember {
  return {
    moimId: 'moim-A',
    userId,
    nickname,
    role: userId === 'sub-sender' ? 'owner' : 'member',
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

interface Mocks {
  memberFindMany: jest.Mock;
  memberFindUnique: jest.Mock;
  deviceFindMany: jest.Mock;
  send: jest.Mock;
}

function makeListener(opts: {
  members: MoimMember[];
  devices: DeviceToken[];
  senderMember?: MoimMember | null;
}): { listener: PushListener; mocks: Mocks } {
  const memberFindMany = jest.fn().mockResolvedValue(opts.members);
  const memberFindUnique = jest
    .fn()
    .mockResolvedValue(
      opts.senderMember === undefined
        ? member('sub-sender', '발신자호스트')
        : opts.senderMember,
    );
  // 실제 Prisma처럼 where.userId.in 필터를 적용한다(naive mock이 sender 디바이스를 흘려보내지 않도록).
  const deviceFindMany = jest.fn(
    (arg: { where: { userId: { in: string[] } } }) =>
      Promise.resolve(
        opts.devices.filter((d) => arg.where.userId.in.includes(d.userId)),
      ),
  );
  const send = jest.fn().mockResolvedValue(undefined);

  const prisma = {
    moimMember: { findMany: memberFindMany, findUnique: memberFindUnique },
    deviceToken: { findMany: deviceFindMany },
  } as unknown as PrismaService;
  const fcm = { send } as unknown as FcmSender;

  return {
    listener: new PushListener(prisma, fcm),
    mocks: { memberFindMany, memberFindUnique, deviceFindMany, send },
  };
}

describe('PushListener', () => {
  it('AC-1: sender를 제외한 멤버의 등록 디바이스로만 1회 발송한다', async () => {
    // 모임 A: sender(멤버1) + 멤버2(디바이스 등록). 멤버2 토큰으로만 발송.
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    // 디바이스 조회는 sender를 제외한 userId 집합으로만 한다.
    const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
    expect(deviceArg.where.userId.in).toEqual(['sub-2']);
    expect(deviceArg.where.userId.in).not.toContain('sub-sender');

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [tokens, notification] = mocks.send.mock.calls[0];
    expect(tokens).toEqual(['tok-2']);
    // 알림 본문 sender 표시 이름은 서버 측 멤버 조회(nickname)로 해석한다(이벤트 페이로드엔 nickname 없음).
    expect(notification.title).toBe('발신자호스트');
    expect(notification.body).toBe('안녕하세요 여러분');
  });

  it('AC-4: 게스트(디바이스 미등록 멤버)에게는 발송 시도가 없다 (등록 멤버에게만)', async () => {
    // 멤버2는 등록, 게스트(sub-guest)는 device_token 없음 → 자연 제외.
    const { listener, mocks } = makeListener({
      members: [
        member('sub-sender', '발신자'),
        member('sub-2', '참가자2'),
        member('sub-guest', '게스트'),
      ],
      devices: [device('tok-2', 'sub-2')], // 게스트 토큰 없음
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual(['tok-2']); // 게스트 토큰 미포함
  });

  it('엣지: sender 외 멤버가 모두 미등록이면 토큰 0개 — send는 빈 배열로 호출되어 no-op으로 처리된다', async () => {
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [], // 아무도 등록 안 함
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    // 토큰 0개 — FcmSender.send 내부에서 no-op. 여기서는 빈 배열 호출(또는 미호출)로 발송 0건을 보장한다.
    const [tokens] = mocks.send.mock.calls[0] ?? [[]];
    expect(tokens).toEqual([]);
  });

  it('엣지: sender가 유일한 멤버면 수신 대상 0명 — device 조회 없이 빈 배열로 send (early return branch)', async () => {
    // sender 제외 후 userIds.length === 0 → resolveDeviceTokens 가 device_token 조회 없이 빈 배열 반환.
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자')], // sender 본인만 존재
      devices: [device('tok-sender', 'sub-sender')], // sender 디바이스(어차피 제외)
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    // 수신 대상 0명 — deviceToken.findMany 를 아예 호출하지 않는다(불필요 쿼리 회피, early return).
    expect(mocks.deviceFindMany).not.toHaveBeenCalled();
    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual([]);
  });

  it('sender 본인은 다른 디바이스가 있어도 수신 대상에서 제외된다 (자기 메시지 알림 금지)', async () => {
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [device('tok-sender', 'sub-sender'), device('tok-2', 'sub-2')],
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
    expect(deviceArg.where.userId.in).toEqual(['sub-2']);
    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual(['tok-2']);
    expect(tokens).not.toContain('tok-sender');
  });

  it('sender 닉네임 해석은 (moimId, senderId) 복합키 findUnique로 한다', async () => {
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    expect(mocks.memberFindUnique).toHaveBeenCalledWith({
      where: { moimId_userId: { moimId: 'moim-A', userId: 'sub-sender' } },
    });
  });

  it('sender 닉네임이 없으면(멤버 부재) 발송하되 title을 빈 문자열 폴백하지 않고 안전 기본값을 쓴다', async () => {
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
      senderMember: null,
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [, notification] = mocks.send.mock.calls[0];
    // nickname 미해석 시 빈 title 대신 안전 기본값(예: '새 메시지')을 쓴다.
    expect(notification.title.length).toBeGreaterThan(0);
    expect(notification.body).toBe('안녕하세요 여러분');
  });

  it('best-effort: prisma 조회가 throw 해도 리스너는 throw 하지 않는다 (이벤트 발행 격리)', async () => {
    const { listener, mocks } = makeListener({
      members: [member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
    });
    mocks.memberFindMany.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      listener.handleChatMessageCreated(PAYLOAD),
    ).resolves.toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('best-effort: non-Error 값으로 reject 돼도 unknown error 로 흡수한다 (catch ternary fallback)', async () => {
    const { listener, mocks } = makeListener({
      members: [member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
    });
    // Error 가 아닌 값(문자열)으로 reject — err instanceof Error 의 false 분기(unknown error)를 커버.
    mocks.memberFindMany.mockRejectedValueOnce('boom');

    await expect(
      listener.handleChatMessageCreated(PAYLOAD),
    ).resolves.toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
