import type { DeviceToken } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { DeviceTokenService } from './device-token.service';

// prisma.deviceToken.upsert가 받는 인자 형태(테스트 단언용 — 클라이언트 필드 mass-assign 부재 검증).
interface UpsertArg {
  where: { token: string };
  create: { token: string; userId: string; platform: string };
  update: { userId: string; platform: string };
}
// owner-scoped deleteMany 인자 형태(IDOR 방지 — token AND user.sub 모두 일치해야 삭제).
interface DeleteManyArg {
  where: { token: string; userId: string };
}

// DeviceTokenService 단위 테스트(REQ-PUSH-002/003 / AC-2).
// 등록 upsert(token PK 기준 중복 없음) + userId 출처(가드 sub만) + owner-scoped 해제(deleteMany)를 검증한다.
describe('DeviceTokenService', () => {
  function makePrisma(deleteCount = 1): {
    prisma: PrismaService;
    upsert: jest.Mock<Promise<DeviceToken>, [UpsertArg]>;
    deleteMany: jest.Mock<Promise<{ count: number }>, [DeleteManyArg]>;
  } {
    const upsert = jest.fn<Promise<DeviceToken>, [UpsertArg]>((arg) =>
      Promise.resolve({
        token: arg.where.token,
        userId: arg.create.userId,
        platform: arg.create.platform,
        createdAt: new Date('2026-06-14T00:00:00Z'),
        updatedAt: new Date('2026-06-14T00:00:00Z'),
      }),
    );
    // deleteMany: token AND userId 모두 일치하는 row만 삭제(없으면 count 0 — 멱등, P2025 없음).
    const deleteMany = jest.fn<Promise<{ count: number }>, [DeleteManyArg]>(
      () => Promise.resolve({ count: deleteCount }),
    );
    const prisma = {
      deviceToken: { upsert, deleteMany },
    } as unknown as PrismaService;
    return { prisma, upsert, deleteMany };
  }

  it('register: token PK 기준 upsert로 사용자에 연결한다 (AC-2, 중복 없음)', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new DeviceTokenService(prisma);

    const row = await service.register('sub-A', 'tok-1', 'android');

    expect(row.token).toBe('tok-1');
    expect(row.userId).toBe('sub-A');
    expect(upsert).toHaveBeenCalledWith({
      where: { token: 'tok-1' },
      create: { token: 'tok-1', userId: 'sub-A', platform: 'android' },
      update: { userId: 'sub-A', platform: 'android' },
    });
  });

  it('register: userId는 가드 sub만 들어가고 클라이언트 필드는 끼워 넣지 않는다 (mass-assignment 차단)', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new DeviceTokenService(prisma);

    await service.register('sub-A', 'tok-1', 'ios');

    const arg = upsert.mock.calls[0][0];
    // create/update payload는 정확히 token/userId/platform 만 포함한다(추가 필드 불가).
    expect(Object.keys(arg.create).sort()).toEqual([
      'platform',
      'token',
      'userId',
    ]);
    expect(Object.keys(arg.update).sort()).toEqual(['platform', 'userId']);
    expect(arg.create.userId).toBe('sub-A');
  });

  it('register: 동일 token 재호출도 token PK 기준 upsert라 중복 row가 생기지 않는다 (멱등)', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new DeviceTokenService(prisma);

    await service.register('sub-A', 'tok-1', 'ios');
    await service.register('sub-A', 'tok-1', 'ios');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].where).toEqual({ token: 'tok-1' });
    expect(upsert.mock.calls[1][0].where).toEqual({ token: 'tok-1' });
  });

  it('unregisterByOwner: token AND user.sub 모두 일치하는 row만 삭제한다 (IDOR 방지 — owner-scoped)', async () => {
    const { prisma, deleteMany } = makePrisma();
    const service = new DeviceTokenService(prisma);

    await service.unregisterByOwner('sub-A', 'tok-1');

    // deleteMany where 에 token 과 userId 가 모두 들어가야 한다 — 소유자가 아니면 삭제되지 않는다(OWASP A01).
    expect(deleteMany).toHaveBeenCalledWith({
      where: { token: 'tok-1', userId: 'sub-A' },
    });
  });

  it('unregisterByOwner: 다른 소유자의 토큰은 삭제되지 않는다 (count 0, no-op, 멱등)', async () => {
    // deleteMany count 0 — token 은 존재하나 userId 가 sub 와 다르면 매칭 0건(타인 등록 보호).
    const { prisma, deleteMany } = makePrisma(0);
    const service = new DeviceTokenService(prisma);

    await expect(
      service.unregisterByOwner('sub-attacker', 'tok-of-victim'),
    ).resolves.toBeUndefined();
    expect(deleteMany).toHaveBeenCalledWith({
      where: { token: 'tok-of-victim', userId: 'sub-attacker' },
    });
  });

  it('unregisterByOwner: 미등록 token 해제는 count 0으로 멱등 처리된다 (P2025 없음 — deleteMany)', async () => {
    const { prisma } = makePrisma(0);
    const service = new DeviceTokenService(prisma);

    await expect(
      service.unregisterByOwner('sub-A', 'missing'),
    ).resolves.toBeUndefined();
  });
});
