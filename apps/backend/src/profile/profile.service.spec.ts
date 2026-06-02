import type { Profile } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from './profile.service';

// prisma.profile.upsert가 받는 인자 형태(테스트 단언용 — 클라이언트 필드 mass-assign 부재 검증).
interface UpsertArg {
  where: { id: string };
  create: { id: string };
  update: Record<string, never>;
}

// ProfileService 단위 테스트(AC-B3/B4/B6). UPSERT 키 출처 + 멱등성 + mass-assignment 차단을 검증한다.
describe('ProfileService', () => {
  // prisma.profile.upsert 호출 인자를 캡처하는 타입드 스텁.
  function makePrisma(): {
    prisma: PrismaService;
    upsert: jest.Mock<Promise<Profile>, [UpsertArg]>;
  } {
    const upsert = jest.fn<Promise<Profile>, [UpsertArg]>((arg) =>
      Promise.resolve({
        id: arg.where.id,
        createdAt: new Date('2026-06-02T00:00:00Z'),
      }),
    );
    const prisma = {
      profile: { upsert },
    } as unknown as PrismaService;
    return { prisma, upsert };
  }

  it('검증된 sub를 id로 UPSERT한다 (AC-B3)', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new ProfileService(prisma);

    const profile = await service.upsertBySub('sub-A');

    expect(profile.id).toBe('sub-A');
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'sub-A' },
      create: { id: 'sub-A' },
      update: {},
    });
  });

  it('upsert는 sub 외 어떤 클라이언트 필드도 끼워 넣지 않는다 (AC-B6 mass-assignment 차단)', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new ProfileService(prisma);

    await service.upsertBySub('sub-A');

    // create payload는 정확히 { id: sub }만 포함해야 한다(추가 필드 mass-assign 불가).
    const callArg = upsert.mock.calls[0][0];
    expect(Object.keys(callArg.create)).toEqual(['id']);
    expect(callArg.update).toEqual({});
  });

  it('멱등: 동일 sub 재호출 시에도 where=id 키로만 동작한다 (AC-B4)', async () => {
    const { prisma, upsert } = makePrisma();
    const service = new ProfileService(prisma);

    await service.upsertBySub('sub-A');
    await service.upsertBySub('sub-A');

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0][0].where).toEqual({ id: 'sub-A' });
    expect(upsert.mock.calls[1][0].where).toEqual({ id: 'sub-A' });
  });
});
