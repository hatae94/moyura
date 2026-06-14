import type { Profile } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { ProfileService } from './profile.service';

// prisma.profile.upsert가 받는 인자 형태(테스트 단언용 — 클라이언트 필드 mass-assign 부재 검증).
interface UpsertArg {
  where: { id: string };
  create: { id: string };
  update: Record<string, never>;
}

// prisma.profile.update가 받는 인자 형태(SPEC-MOBILE-004 T-002 updateName 단언용).
interface UpdateArg {
  where: { id: string };
  data: { name: string };
}

// ProfileService 단위 테스트(AC-B3/B4/B6). UPSERT 키 출처 + 멱등성 + mass-assignment 차단을 검증한다.
describe('ProfileService', () => {
  // prisma.profile.upsert/update 호출 인자를 캡처하는 타입드 스텁.
  // SPEC-MOBILE-004 T-001: upsert 결과에 name(nullable)을 포함한다.
  function makePrisma(seedName: string | null = null): {
    prisma: PrismaService;
    upsert: jest.Mock<Promise<Profile>, [UpsertArg]>;
    update: jest.Mock<Promise<Profile>, [UpdateArg]>;
  } {
    const upsert = jest.fn<Promise<Profile>, [UpsertArg]>((arg) =>
      Promise.resolve({
        id: arg.where.id,
        // UPSERT preserve: 기존 name은 보존되고 신규는 null이다(T-001).
        name: seedName,
        createdAt: new Date('2026-06-02T00:00:00Z'),
      }),
    );
    const update = jest.fn<Promise<Profile>, [UpdateArg]>((arg) =>
      Promise.resolve({
        id: arg.where.id,
        name: arg.data.name,
        createdAt: new Date('2026-06-02T00:00:00Z'),
      }),
    );
    const prisma = {
      profile: { upsert, update },
    } as unknown as PrismaService;
    return { prisma, upsert, update };
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

  it('T-001: 신규 sub UPSERT는 name이 null로 반환된다 (이름 미보유)', async () => {
    const { prisma } = makePrisma(null);
    const service = new ProfileService(prisma);

    const profile = await service.upsertBySub('sub-new');

    expect(profile.name).toBeNull();
  });

  it('T-001: 기존 name은 UPSERT(update:{})로 보존·반환된다', async () => {
    const { prisma } = makePrisma('홍길동');
    const service = new ProfileService(prisma);

    const profile = await service.upsertBySub('sub-existing');

    // update:{}이므로 name을 건드리지 않고 그대로 보존한다.
    expect(profile.name).toBe('홍길동');
  });

  it('T-002: updateName은 검증된 sub를 키로 name만 갱신한다 (sub-scoped)', async () => {
    const { prisma, update } = makePrisma();
    const service = new ProfileService(prisma);

    const profile = await service.updateName('sub-A', '김무야');

    expect(profile.name).toBe('김무야');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sub-A' },
      data: { name: '김무야' },
    });
  });

  it('T-002: updateName의 data는 정확히 name만 포함한다 (mass-assignment 차단)', async () => {
    const { prisma, update } = makePrisma();
    const service = new ProfileService(prisma);

    await service.updateName('sub-A', '김무야');

    const callArg = update.mock.calls[0][0];
    expect(callArg.where).toEqual({ id: 'sub-A' });
    expect(Object.keys(callArg.data)).toEqual(['name']);
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
