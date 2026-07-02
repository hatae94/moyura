import type { ChatMessageCreatedPayload } from '../chat/chat-events';
import type { DeviceToken, MoimMember } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { SafetyService } from '../safety/safety.service';
import type { FcmSender, PushData, PushNotification } from './fcm-sender';
import { PushListener } from './push.listener';

// deviceToken.findMany 가 받는 where 인자 형태(수신 대상 userId in 필터).
type DeviceFindManyArg = { where: { userId: { in: string[] } } };

// PushListener 단위 테스트(REQ-PUSH-001/006 / AC-1,4 + SPEC-SAFETY-001 REQ-FLT-006 / AC-FLT-6). prisma(멤버/
// 디바이스/sender 닉네임)·FcmSender·SafetyService 를 mock 으로 대체해 수신 대상 산정(멤버 - sender ⋈ device_token) +
// sender 제외 + 게스트(미등록) 제외 + 서버 측 nickname 해석 + 0-토큰 미발송 + best-effort(에러 격리) +
// **발신 역방향 차감(sender 를 차단한 수신자를 FCM 대상에서 제외 — block 만, report 는 미억제)**을 검증한다.

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
  memberFindMany: jest.Mock<Promise<MoimMember[]>, [unknown]>;
  memberFindUnique: jest.Mock<Promise<MoimMember | null>, [unknown]>;
  deviceFindMany: jest.Mock<Promise<DeviceToken[]>, [DeviceFindManyArg]>;
  // FcmSender.send(tokens, notification, data?) 시그니처로 타이핑 — mock.calls 접근을 타입 안전하게.
  send: jest.Mock<Promise<void>, [string[], PushNotification, PushData?]>;
  // SafetyService.getBlockersOf(userIds) — sender 를 차단한 blocker 집합(발신 역방향 필터, REQ-FLT-006).
  getBlockersOf: jest.Mock<Promise<Set<string>>, [string[]]>;
}

function makeListener(opts: {
  members: MoimMember[];
  devices: DeviceToken[];
  senderMember?: MoimMember | null;
  // sender 를 차단한 수신자(blocker) 집합. 미지정이면 빈 집합(차단 없음 — 기존 발송 동작 불변).
  blockers?: Set<string>;
}): { listener: PushListener; mocks: Mocks } {
  const memberFindMany = jest
    .fn<Promise<MoimMember[]>, [unknown]>()
    .mockResolvedValue(opts.members);
  const memberFindUnique = jest
    .fn<Promise<MoimMember | null>, [unknown]>()
    .mockResolvedValue(
      opts.senderMember === undefined
        ? member('sub-sender', '발신자호스트')
        : opts.senderMember,
    );
  // 실제 Prisma처럼 where.userId.in 필터를 적용한다(naive mock이 sender 디바이스를 흘려보내지 않도록).
  const deviceFindMany = jest.fn((arg: DeviceFindManyArg) =>
    Promise.resolve(
      opts.devices.filter((d) => arg.where.userId.in.includes(d.userId)),
    ),
  );
  const send = jest
    .fn<Promise<void>, [string[], PushNotification, PushData?]>()
    .mockResolvedValue(undefined);
  const getBlockersOf = jest
    .fn<Promise<Set<string>>, [string[]]>()
    .mockResolvedValue(opts.blockers ?? new Set());

  const prisma = {
    moimMember: { findMany: memberFindMany, findUnique: memberFindUnique },
    deviceToken: { findMany: deviceFindMany },
  } as unknown as PrismaService;
  const fcm = { send } as unknown as FcmSender;
  const safety = { getBlockersOf } as unknown as SafetyService;

  return {
    listener: new PushListener(prisma, fcm, safety),
    mocks: {
      memberFindMany,
      memberFindUnique,
      deviceFindMany,
      send,
      getBlockersOf,
    },
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

  // ── SPEC-SAFETY-001 REQ-FLT-006 / AC-FLT-6: 발신 역방향 차감(block 만, report 는 미억제) ──

  it('AC-FLT-6(M3-14): sender 를 차단한 수신자는 FCM 대상에서 차감된다 (A→B block → A 미발신)', async () => {
    // 모임 A: sender(B=sub-sender) + sub-2(B 를 차단) + sub-3(차단 안 함). 둘 다 디바이스 등록.
    // getBlockersOf([sub-sender]) 가 {sub-2} 반환 → sub-2 를 수신 대상에서 차감, sub-3 만 남는다.
    const { listener, mocks } = makeListener({
      members: [
        member('sub-sender', '발신자'),
        member('sub-2', '차단자'),
        member('sub-3', '일반'),
      ],
      devices: [device('tok-2', 'sub-2'), device('tok-3', 'sub-3')],
      blockers: new Set(['sub-2']),
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    // getBlockersOf 는 sender id 를 담아 1회 조회한다(요청당 1회, N+1 회피).
    expect(mocks.getBlockersOf).toHaveBeenCalledTimes(1);
    expect(mocks.getBlockersOf.mock.calls[0][0]).toEqual(['sub-sender']);

    // 차감 후 디바이스 조회는 blocker(sub-2) 를 제외한 집합으로만 한다.
    const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
    expect(deviceArg.where.userId.in).toEqual(['sub-3']);
    expect(deviceArg.where.userId.in).not.toContain('sub-2');

    // 최종 발송 토큰은 차단하지 않은 sub-3 것만.
    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual(['tok-3']);
    expect(tokens).not.toContain('tok-2');
  });

  it('AC-FLT-6(M3-15 대조): report 만 있고 block 없으면 push 유지 (getBlockersOf 빈 집합 → 미차감)', async () => {
    // 신고(report)는 push 를 억제하지 않는다 — getBlockersOf 는 block 만 조회하므로 빈 집합을 반환한다.
    // 이 경우 수신 대상 차감이 일어나지 않고 sub-2 에게 push 가 그대로 발송된다.
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
      blockers: new Set(), // block 없음(report 만 있어도 getBlockersOf 는 block 만 봄)
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    const deviceArg = mocks.deviceFindMany.mock.calls[0][0];
    expect(deviceArg.where.userId.in).toEqual(['sub-2']); // 미차감
    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual(['tok-2']); // push 유지
  });

  it('M3-16: getBlockersOf 가 throw 해도 발송은 차단되지 않는다 (내부 best-effort — 미차감으로 degrade)', async () => {
    // safety 역방향 조회가 실패해도 FCM 발송 자체는 막지 않는다 — 차감을 포기하고(fail-open) 전체 대상에 발송한다.
    // 이 격리가 없으면 safety 장애가 채팅 push 전면 중단으로 번진다(REQ-FLT-006 best-effort).
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자'), member('sub-2', '참가자2')],
      devices: [device('tok-2', 'sub-2')],
    });
    mocks.getBlockersOf.mockRejectedValueOnce(new Error('safety down'));

    await expect(
      listener.handleChatMessageCreated(PAYLOAD),
    ).resolves.toBeUndefined();

    // getBlockersOf 실패에도 발송은 정상 진행(차감만 스킵).
    expect(mocks.send).toHaveBeenCalledTimes(1);
    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual(['tok-2']);
  });

  it('엣지: 수신 대상이 0명이면 getBlockersOf 를 호출하지 않는다 (불필요 safety 조회 회피)', async () => {
    // sender 가 유일 멤버 → recipientUserIds 0명. 차감할 대상이 없으므로 safety 왕복을 하지 않는다.
    const { listener, mocks } = makeListener({
      members: [member('sub-sender', '발신자')],
      devices: [device('tok-sender', 'sub-sender')],
    });

    await listener.handleChatMessageCreated(PAYLOAD);

    expect(mocks.getBlockersOf).not.toHaveBeenCalled();
    const [tokens] = mocks.send.mock.calls[0];
    expect(tokens).toEqual([]);
  });
});
