import type { Profile, WithdrawnAccount } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AccountWithdrawnException } from './account-withdrawn.exception';
import { ProfileService } from './profile.service';

// prisma.profile.upsert가 받는 인자 형태(테스트 단언용 — 클라이언트 필드 mass-assign 부재 검증).
interface UpsertArg {
  where: { id: string };
  create: { id: string };
  update: Record<string, never>;
}

// prisma.withdrawnAccount.findUnique가 받는 인자 형태(T-02 툼스톤 선조회 단언용).
interface FindTombstoneArg {
  where: { sub: string };
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
  // SPEC-ACCOUNT-001 T-02: withdrawnAccount.findUnique 툼스톤 선조회 스텁을 함께 제공한다.
  //   - tombstone=false(기본): 툼스톤 없음 → 기존 upsert 정상 경로.
  //   - tombstone=true: 툼스톤 존재 → upsert 미호출 + AccountWithdrawnException.
  // SPEC-MOIM-DETAIL 성능 최적화(핫패스): upsertBySub 는 read-first 다 — profile.findUnique 로 존재를 먼저 확인해
  // 히트면 그대로 반환(툼스톤 조회 + upsert 쓰기 생략). existingProfile 인자로 이 read-hit 를 흉내낸다(기본 미존재=null).
  function makePrisma(
    seedName: string | null = null,
    tombstone = false,
    existingProfile: Profile | null = null,
  ): {
    prisma: PrismaService;
    findProfile: jest.Mock<
      Promise<Profile | null>,
      [{ where: { id: string } }]
    >;
    upsert: jest.Mock<Promise<Profile>, [UpsertArg]>;
    update: jest.Mock<Promise<Profile>, [UpdateArg]>;
    findTombstone: jest.Mock<
      Promise<WithdrawnAccount | null>,
      [FindTombstoneArg]
    >;
  } {
    const findProfile = jest.fn<
      Promise<Profile | null>,
      [{ where: { id: string } }]
    >(() => Promise.resolve(existingProfile));
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
    const findTombstone = jest.fn<
      Promise<WithdrawnAccount | null>,
      [FindTombstoneArg]
    >((arg) =>
      Promise.resolve(
        tombstone
          ? {
              sub: arg.where.sub,
              withdrawnAt: new Date('2026-07-01T00:00:00Z'),
            }
          : null,
      ),
    );
    const prisma = {
      profile: { findUnique: findProfile, upsert, update },
      withdrawnAccount: { findUnique: findTombstone },
    } as unknown as PrismaService;
    return { prisma, findProfile, upsert, update, findTombstone };
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

  // --- SPEC-MOIM-DETAIL 성능 최적화(핫패스): read-first ---

  it('profile 이 이미 존재하면 그대로 반환하고 툼스톤 조회·upsert 쓰기를 모두 건너뛴다', async () => {
    const existing: Profile = {
      id: 'sub-A',
      name: '홍길동',
      createdAt: new Date('2026-06-02T00:00:00Z'),
    };
    const { prisma, findProfile, upsert, findTombstone } = makePrisma(
      null,
      false,
      existing,
    );
    const service = new ProfileService(prisma);

    const profile = await service.upsertBySub('sub-A');

    // 존재하는 profile 을 그대로 반환한다(name 보존).
    expect(profile).toEqual(existing);
    // read-first: findUnique 는 검증된 sub 를 id 키로 1회 조회한다.
    expect(findProfile).toHaveBeenCalledWith({ where: { id: 'sub-A' } });
    // 핫패스 최적화: 존재 히트면 툼스톤 조회(read)와 upsert(write)를 모두 생략한다.
    expect(findTombstone).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('profile 미존재(read miss)면 툼스톤 확인 후 upsert 로 생성한다(최초 인증 회귀)', async () => {
    const { prisma, findProfile, upsert, findTombstone } = makePrisma(
      null,
      false,
      null,
    );
    const service = new ProfileService(prisma);

    const profile = await service.upsertBySub('sub-new');

    // miss → 툼스톤 확인 → upsert 생성 순서를 모두 거친다.
    expect(findProfile).toHaveBeenCalledWith({ where: { id: 'sub-new' } });
    expect(findTombstone).toHaveBeenCalledWith({ where: { sub: 'sub-new' } });
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'sub-new' },
      create: { id: 'sub-new' },
      update: {},
    });
    expect(profile.id).toBe('sub-new');
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

  // --- SPEC-ACCOUNT-001 T-02: 툼스톤 부활 차단 (AC-3-1) ---

  it('T-02 (AC-3-1): 툼스톤 존재 시 upsert를 호출하지 않고 AccountWithdrawnException을 던진다', async () => {
    const { prisma, upsert } = makePrisma(null, true);
    const service = new ProfileService(prisma);

    await expect(service.upsertBySub('sub-withdrawn')).rejects.toBeInstanceOf(
      AccountWithdrawnException,
    );
    // 부활 차단: profile.upsert가 절대 호출되지 않아야 한다(PII 재생성 금지).
    expect(upsert).not.toHaveBeenCalled();
  });

  it('T-02 (AC-3-1): 툼스톤 선조회는 검증된 sub를 where 키로 사용한다', async () => {
    const { prisma, findTombstone } = makePrisma(null, true);
    const service = new ProfileService(prisma);

    await expect(service.upsertBySub('sub-withdrawn')).rejects.toBeInstanceOf(
      AccountWithdrawnException,
    );
    expect(findTombstone).toHaveBeenCalledWith({
      where: { sub: 'sub-withdrawn' },
    });
  });

  it('T-02 (EC-6): 툼스톤 존재 시 재호출해도 upsert 미호출 유지(멱등 차단)', async () => {
    const { prisma, upsert } = makePrisma(null, true);
    const service = new ProfileService(prisma);

    await expect(service.upsertBySub('sub-withdrawn')).rejects.toBeInstanceOf(
      AccountWithdrawnException,
    );
    await expect(service.upsertBySub('sub-withdrawn')).rejects.toBeInstanceOf(
      AccountWithdrawnException,
    );
    // 반복 요청에도 profile 행이 생성되지 않는다(부활 차단 멱등).
    expect(upsert).not.toHaveBeenCalled();
  });

  it('T-02 (AC-3-2): 툼스톤 없는 정상 sub는 기존과 동일하게 upsert된다(회귀)', async () => {
    const { prisma, upsert, findTombstone } = makePrisma(null, false);
    const service = new ProfileService(prisma);

    const profile = await service.upsertBySub('sub-normal');

    // 툼스톤 선조회는 정상 플로우를 저해하지 않는다: 선조회 후 upsert 수행.
    expect(findTombstone).toHaveBeenCalledWith({
      where: { sub: 'sub-normal' },
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { id: 'sub-normal' },
      create: { id: 'sub-normal' },
      update: {},
    });
    expect(profile.id).toBe('sub-normal');
  });
});
