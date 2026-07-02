import { BadRequestException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { Block, Report } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from './safety.service';

// SafetyService 조회·변이 계약 단위 테스트(SPEC-SAFETY-001 M2 / T-002·T-003). 인메모리 fake Prisma 로 검증한다:
//   [T-002 조회]
//   - getHiddenUserIds(sub): block(blockerId=sub → blockedUserId) ∪ report(reporterId=sub → targetUserId)
//     union + 중복 제거 string[]. 두 소스는 독립 — report 항은 block 유무와 무관하게 유지된다.
//     요청당 정확히 2회 조회(block 1회 + report 1회, N+1 회피).
//   - getBlockersOf(userIds): block.findMany(blockedUserId in userIds) → blocker Set.
//     block 만 조회한다(report 미포함 — 신고는 push 억제 안 함, REQ-FLT-006).
//   [T-003 변이]
//   - createReport(sub, dto): contentType 화이트리스트 외 → 400, 빈 reason → 400, reporterId=sub 강제(body 불신),
//     **block 미생성**(신고 ≠ 차단, REQ-RPT-002).
//   - createBlock(sub, blockedUserId): 자기 차단 → 400, 이미 존재(P2002) → 멱등 성공(200).
//   - unblock(sub, blockedUserId): 없는 행 삭제 멱등, **report 는 건드리지 않음**(차단 해제 ≠ 신고 취소).
//   - listBlocks(sub): block 행만 반환(신고 숨김은 별도 — report 미포함).
// notification.service.spec 패턴 미러 — fake 는 async 대신 Promise.resolve 반환(require-await 회피).

const NOW = new Date('2026-07-02T00:00:00.000Z');

// ── fake Prisma 인자 형태(no-unsafe 회피용 명시 타입) ──────────────────────────
// block.findMany 는 두 경로에서 호출된다:
//   getHiddenUserIds → where.blockerId(정방향), getBlockersOf → where.blockedUserId.in(역방향).
interface BlockFindManyArg {
  where: { blockerId?: string; blockedUserId?: { in: string[] } };
}
interface ReportFindManyArg {
  where: { reporterId: string };
}
// block.create 인자: 복합 PK (blockerId, blockedUserId) 로 create. 중복이면 P2002 를 던진다(멱등 검증).
interface BlockCreateArg {
  data: { blockerId: string; blockedUserId: string };
}
// block.findUniqueOrThrow 인자: 멱등(P2002) 흡수 시 기존 행을 되돌려줄 때 복합 PK 로 조회한다.
interface BlockFindUniqueArg {
  where: {
    blockerId_blockedUserId: { blockerId: string; blockedUserId: string };
  };
}
// block.deleteMany 인자: unblock 은 delete(P2025) 대신 deleteMany 로 없는 행도 멱등 처리한다.
interface BlockDeleteManyArg {
  where: { blockerId: string; blockedUserId: string };
}
// report.create 인자: reporterId 는 서비스가 sub 로 강제한다(DTO 에 reporterId 없음 — body 불신).
interface ReportCreateArg {
  data: {
    reporterId: string;
    targetUserId: string;
    moimId: string;
    reason: string;
    contentType: string;
    contentId: string;
  };
}

interface Store {
  blocks: Block[];
  reports: Report[];
}

interface Mocks {
  blockFindMany: jest.Mock<Promise<Block[]>, [BlockFindManyArg]>;
  reportFindMany: jest.Mock<Promise<Report[]>, [ReportFindManyArg]>;
  blockCreate: jest.Mock<Promise<Block>, [BlockCreateArg]>;
  blockFindUniqueOrThrow: jest.Mock<Promise<Block>, [BlockFindUniqueArg]>;
  blockDeleteMany: jest.Mock<Promise<{ count: number }>, [BlockDeleteManyArg]>;
  reportCreate: jest.Mock<Promise<Report>, [ReportCreateArg]>;
}

// 복합 PK 유일성 위반(P2002)을 흉내내는 Prisma 에러. invite.service.spec 패턴 미러 — instanceof 검사가
// 통과하도록 실제 PrismaClientKnownRequestError 인스턴스를 던진다.
function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function block(blockerId: string, blockedUserId: string): Block {
  return { blockerId, blockedUserId, createdAt: NOW };
}

function report(
  overrides: Partial<Report> & { reporterId: string; targetUserId: string },
): Report {
  return {
    id:
      overrides.id ??
      `report-${overrides.reporterId}-${overrides.targetUserId}`,
    reporterId: overrides.reporterId,
    targetUserId: overrides.targetUserId,
    moimId: overrides.moimId ?? 'moim-A',
    reason: overrides.reason ?? '스팸',
    contentType: overrides.contentType ?? 'chat_message',
    contentId: overrides.contentId ?? '1',
    createdAt: overrides.createdAt ?? NOW,
  };
}

function makeService(seed: Partial<Store> = {}): {
  service: SafetyService;
  store: Store;
  mocks: Mocks;
} {
  const store: Store = {
    blocks: seed.blocks ?? [],
    reports: seed.reports ?? [],
  };

  const blockFindMany = jest.fn<Promise<Block[]>, [BlockFindManyArg]>((arg) => {
    // 정방향(blockerId=sub) vs 역방향(blockedUserId in [...]) 두 경로를 모두 지원한다.
    const blockerId = arg.where.blockerId;
    const blockedIn = arg.where.blockedUserId?.in;
    const rows = store.blocks.filter((b) => {
      if (blockerId !== undefined && b.blockerId !== blockerId) return false;
      if (blockedIn !== undefined && !blockedIn.includes(b.blockedUserId))
        return false;
      return true;
    });
    return Promise.resolve(rows);
  });

  const reportFindMany = jest.fn<Promise<Report[]>, [ReportFindManyArg]>(
    (arg) =>
      Promise.resolve(
        store.reports.filter((r) => r.reporterId === arg.where.reporterId),
      ),
  );

  // block.create: 복합 PK 중복이면 P2002 를 던지고(멱등 검증), 아니면 store 에 추가한 뒤 새 행을 반환한다.
  const blockCreate = jest.fn<Promise<Block>, [BlockCreateArg]>((arg) => {
    const exists = store.blocks.some(
      (b) =>
        b.blockerId === arg.data.blockerId &&
        b.blockedUserId === arg.data.blockedUserId,
    );
    if (exists) {
      return Promise.reject(uniqueViolation());
    }
    const row = block(arg.data.blockerId, arg.data.blockedUserId);
    store.blocks.push(row);
    return Promise.resolve(row);
  });

  // block.findUniqueOrThrow: 멱등(P2002) 흡수 시 기존 행 반환용 복합 PK 조회. 행이 없으면 reject(실 프리즈마 동형).
  const blockFindUniqueOrThrow = jest.fn<Promise<Block>, [BlockFindUniqueArg]>(
    (arg) => {
      const key = arg.where.blockerId_blockedUserId;
      const row = store.blocks.find(
        (b) =>
          b.blockerId === key.blockerId &&
          b.blockedUserId === key.blockedUserId,
      );
      if (row === undefined) {
        return Promise.reject(new Error('No Block found'));
      }
      return Promise.resolve(row);
    },
  );

  // block.deleteMany: 매칭 행을 제거하고 삭제 개수를 반환한다(없는 행이면 count 0 — 멱등, throw 없음).
  const blockDeleteMany = jest.fn<
    Promise<{ count: number }>,
    [BlockDeleteManyArg]
  >((arg) => {
    const before = store.blocks.length;
    store.blocks = store.blocks.filter(
      (b) =>
        !(
          b.blockerId === arg.where.blockerId &&
          b.blockedUserId === arg.where.blockedUserId
        ),
    );
    return Promise.resolve({ count: before - store.blocks.length });
  });

  // report.create: 서비스가 넘긴 data 그대로 저장한 뒤 id/createdAt 을 채운 행을 반환한다.
  const reportCreate = jest.fn<Promise<Report>, [ReportCreateArg]>((arg) => {
    const row = report({
      reporterId: arg.data.reporterId,
      targetUserId: arg.data.targetUserId,
      moimId: arg.data.moimId,
      reason: arg.data.reason,
      contentType: arg.data.contentType,
      contentId: arg.data.contentId,
    });
    store.reports.push(row);
    return Promise.resolve(row);
  });

  const prisma = {
    block: {
      findMany: blockFindMany,
      create: blockCreate,
      findUniqueOrThrow: blockFindUniqueOrThrow,
      deleteMany: blockDeleteMany,
    },
    report: { findMany: reportFindMany, create: reportCreate },
  } as unknown as PrismaService;

  const service = new SafetyService(prisma);
  return {
    service,
    store,
    mocks: {
      blockFindMany,
      reportFindMany,
      blockCreate,
      blockFindUniqueOrThrow,
      blockDeleteMany,
      reportCreate,
    },
  };
}

describe('SafetyService (M2 조회 계약 — T-002)', () => {
  // ── getHiddenUserIds: block ∪ report union ─────────────────────────────────

  it('getHiddenUserIds: block(blockerId=sub) ∪ report(reporterId=sub) 를 union 해 숨김 userId 를 반환한다', async () => {
    const { service, mocks } = makeService({
      blocks: [block('sub-A', 'sub-B')],
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-C' })],
    });

    const hidden = await service.getHiddenUserIds('sub-A');

    // block 대상(B) + report 대상(C) 이 모두 포함된다.
    expect([...hidden].sort()).toEqual(['sub-B', 'sub-C']);
    // 정방향 block 조회(blockerId=sub) + report 조회(reporterId=sub) 각 1회(N+1 회피).
    expect(mocks.blockFindMany).toHaveBeenCalledWith({
      where: { blockerId: 'sub-A' },
    });
    expect(mocks.reportFindMany).toHaveBeenCalledWith({
      where: { reporterId: 'sub-A' },
    });
    expect(mocks.blockFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.reportFindMany).toHaveBeenCalledTimes(1);
  });

  it('getHiddenUserIds: 같은 대상을 block 하고 동시에 report 하면 union 에서 1번만 등장한다(중복 제거)', async () => {
    const { service } = makeService({
      blocks: [block('sub-A', 'sub-B')],
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-B' })],
    });

    const hidden = await service.getHiddenUserIds('sub-A');

    // B 는 block·report 두 소스 모두에 있지만 결과에는 1번만.
    expect(hidden).toEqual(['sub-B']);
    expect(hidden.filter((id) => id === 'sub-B')).toHaveLength(1);
  });

  it('getHiddenUserIds: report 만 있고 block 이 없어도 report 대상은 숨김에 포함된다(두 소스 독립)', async () => {
    const { service } = makeService({
      // block 없음 — report 만 존재.
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-B' })],
    });

    const hidden = await service.getHiddenUserIds('sub-A');

    // report 항은 block 유무와 무관하게 유지된다(차단 해제가 신고 숨김을 되살리지 않는 불변식의 근거).
    expect(hidden).toEqual(['sub-B']);
  });

  it('getHiddenUserIds: block·report 가 모두 없으면 빈 배열을 반환한다', async () => {
    const { service } = makeService({});

    const hidden = await service.getHiddenUserIds('sub-A');

    expect(hidden).toEqual([]);
  });

  it('getHiddenUserIds: 인가 격리 — blockerId=sub / reporterId=sub 로만 필터해 남의 차단·신고 대상을 반환하지 않는다', async () => {
    const { service } = makeService({
      blocks: [
        block('sub-A', 'sub-B'), // A 의 차단 — 포함
        block('sub-X', 'sub-Z'), // 남(X)의 차단 — 제외
      ],
      reports: [
        report({ reporterId: 'sub-A', targetUserId: 'sub-C' }), // A 의 신고 — 포함
        report({ reporterId: 'sub-X', targetUserId: 'sub-Y' }), // 남(X)의 신고 — 제외
      ],
    });

    const hidden = await service.getHiddenUserIds('sub-A');

    // A 자신이 차단/신고한 대상(B, C)만 — 남(X)이 차단/신고한 Z, Y 는 절대 노출되지 않는다.
    expect([...hidden].sort()).toEqual(['sub-B', 'sub-C']);
    expect(hidden).not.toContain('sub-Z');
    expect(hidden).not.toContain('sub-Y');
  });

  // ── getBlockersOf: 역방향(block 만) ────────────────────────────────────────

  it('getBlockersOf: blockedUserId in userIds 인 block 의 blocker 집합을 반환한다(report 미조회)', async () => {
    const { service, mocks } = makeService({
      blocks: [block('sub-A', 'sub-B')], // A 가 B 를 차단
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-B' })],
    });

    const blockers = await service.getBlockersOf(['sub-B']);

    // B 를 차단한 사람 = {A}.
    expect(blockers).toEqual(new Set(['sub-A']));
    // 역방향 block 조회(blockedUserId in)만 — report 는 발신 억제에 관여하지 않으므로 조회하지 않는다.
    expect(mocks.blockFindMany).toHaveBeenCalledWith({
      where: { blockedUserId: { in: ['sub-B'] } },
    });
    expect(mocks.reportFindMany).not.toHaveBeenCalled();
  });

  it('getBlockersOf: report 만 있고 block 이 없으면 blocker 집합은 비어 있다(신고는 push 억제 안 함)', async () => {
    const { service, mocks } = makeService({
      // block 없음 — report 만. report 는 발신(push) 역방향 필터에 포함되지 않는다(REQ-FLT-006).
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-B' })],
    });

    const blockers = await service.getBlockersOf(['sub-B']);

    expect(blockers.size).toBe(0);
    expect(mocks.reportFindMany).not.toHaveBeenCalled();
  });

  it('getBlockersOf: 한 대상을 여러 사람이 차단하면 blocker 집합에 모두 포함된다', async () => {
    const { service } = makeService({
      blocks: [
        block('sub-C', 'sub-B'),
        block('sub-D', 'sub-B'),
        block('sub-C', 'sub-E'), // 다른 대상 — B 조회에는 무관
      ],
    });

    const blockers = await service.getBlockersOf(['sub-B']);

    expect(blockers).toEqual(new Set(['sub-C', 'sub-D']));
  });

  it('getBlockersOf: userIds 가 비면 조회 없이 빈 집합을 반환한다(빈 in 회피)', async () => {
    const { service, mocks } = makeService({
      blocks: [block('sub-A', 'sub-B')],
    });

    const blockers = await service.getBlockersOf([]);

    expect(blockers.size).toBe(0);
    // 빈 in 절 쿼리를 만들지 않는다(불필요한 DB 왕복 회피).
    expect(mocks.blockFindMany).not.toHaveBeenCalled();
  });
});

describe('SafetyService (M2 변이 계약 — T-003)', () => {
  // ── createReport: 화이트리스트/빈 사유 400 + reporterId=sub 강제 + block 미생성 ──────────

  it('createReport: 유효한 신고를 report 행으로 저장하고 reporterId 를 sub 로 강제한다(body 불신)', async () => {
    const { service, store, mocks } = makeService({});

    const created = await service.createReport('sub-A', {
      targetUserId: 'sub-B',
      moimId: 'moim-M',
      reason: '스팸',
      contentType: 'chat_message',
      contentId: '42',
    });

    // reporterId 는 인자 sub-A 로 강제되며 DTO 에는 reporterId 필드가 없다(WHERE 내장 인가).
    expect(mocks.reportCreate).toHaveBeenCalledWith({
      data: {
        reporterId: 'sub-A',
        targetUserId: 'sub-B',
        moimId: 'moim-M',
        reason: '스팸',
        contentType: 'chat_message',
        contentId: '42',
      },
    });
    expect(created.reporterId).toBe('sub-A');
    expect(store.reports).toHaveLength(1);
  });

  it('createReport: 위조된 reporterId 를 body 에 넣어도 무시하고 sub 를 신고자로 쓴다(mass-assignment 차단)', async () => {
    const { service } = makeService({});

    // 런타임 위조 입력: DTO 타입에 없는 reporterId 를 강제로 끼워 넣어도 서비스가 무시해야 한다.
    const forgedDto = {
      reporterId: 'sub-ATTACKER',
      targetUserId: 'sub-B',
      moimId: 'moim-M',
      reason: '스팸',
      contentType: 'chat_message',
      contentId: '42',
    } as unknown as Parameters<typeof service.createReport>[1];

    const created = await service.createReport('sub-A', forgedDto);

    // 저장된 reporterId 는 위조값(sub-ATTACKER)이 아니라 가드-검증 sub(sub-A)여야 한다.
    expect(created.reporterId).toBe('sub-A');
  });

  it.each(['chat_message', 'poll', 'expense', 'settlement_request'])(
    'createReport: 단일 PK 화이트리스트 타입 %s 은 수용한다',
    async (contentType) => {
      const { service, store } = makeService({});

      await service.createReport('sub-A', {
        targetUserId: 'sub-B',
        moimId: 'moim-M',
        reason: '스팸',
        contentType,
        contentId: '42',
      });

      expect(store.reports).toHaveLength(1);
      expect(store.reports[0].contentType).toBe(contentType);
    },
  );

  it.each(['poll_vote', 'expense_share', 'schedule_slot', '', 'unknown'])(
    'createReport: 화이트리스트 외 content_type %s 은 400 으로 거부하고 아무 것도 쓰지 않는다',
    async (contentType) => {
      const { service, mocks } = makeService({});

      await expect(
        service.createReport('sub-A', {
          targetUserId: 'sub-B',
          moimId: 'moim-M',
          reason: '스팸',
          contentType,
          contentId: '42',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // 400 이면 report 도 block 도 생성되지 않는다.
      expect(mocks.reportCreate).not.toHaveBeenCalled();
      expect(mocks.blockCreate).not.toHaveBeenCalled();
    },
  );

  it.each(['', '   ', '\t\n'])(
    'createReport: 빈/공백 reason(%j)은 400 으로 거부한다',
    async (reason) => {
      const { service, mocks } = makeService({});

      await expect(
        service.createReport('sub-A', {
          targetUserId: 'sub-B',
          moimId: 'moim-M',
          reason,
          contentType: 'chat_message',
          contentId: '42',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.reportCreate).not.toHaveBeenCalled();
    },
  );

  it('createReport: report 행만 만들고 block 은 만들지 않는다(신고 ≠ 차단, REQ-RPT-002)', async () => {
    const { service, store, mocks } = makeService({});

    await service.createReport('sub-A', {
      targetUserId: 'sub-B',
      moimId: 'moim-M',
      reason: '스팸',
      contentType: 'chat_message',
      contentId: '42',
    });

    // 신고는 report 만 — block 은 생성 경로가 없어야 한다(REQ-RPT-003 prompt 수락 시에만 별도 createBlock).
    expect(mocks.blockCreate).not.toHaveBeenCalled();
    expect(store.blocks).toHaveLength(0);
  });

  // ── createBlock: 자기 차단 400 + 멱등(P2002 → 200) + blockerId=sub 강제 ──────────────────

  it('createBlock: block(blockerId=sub, blockedUserId) 행을 생성한다', async () => {
    const { service, store, mocks } = makeService({});

    await service.createBlock('sub-A', 'sub-B');

    expect(mocks.blockCreate).toHaveBeenCalledWith({
      data: { blockerId: 'sub-A', blockedUserId: 'sub-B' },
    });
    expect(store.blocks).toHaveLength(1);
    expect(store.blocks[0]).toMatchObject({
      blockerId: 'sub-A',
      blockedUserId: 'sub-B',
    });
  });

  it('createBlock: 자기 자신 차단(blockedUserId == sub)은 400 으로 거부하고 create 하지 않는다', async () => {
    const { service, mocks } = makeService({});

    await expect(service.createBlock('sub-A', 'sub-A')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mocks.blockCreate).not.toHaveBeenCalled();
  });

  it('createBlock: 이미 차단돼 있으면(P2002) 멱등 성공하고 중복 행을 만들지 않는다', async () => {
    const { service, store, mocks } = makeService({
      blocks: [block('sub-A', 'sub-B')],
    });

    // 2회차 호출(이미 존재) — create 가 P2002 를 던지지만 멱등 성공으로 흡수되어야 한다(throw 없음).
    await expect(service.createBlock('sub-A', 'sub-B')).resolves.not.toThrow();

    // create 는 시도됐지만(P2002 발생) 최종 행은 단일 — 중복 없음.
    expect(mocks.blockCreate).toHaveBeenCalledTimes(1);
    expect(
      store.blocks.filter(
        (b) => b.blockerId === 'sub-A' && b.blockedUserId === 'sub-B',
      ),
    ).toHaveLength(1);
  });

  it('createBlock: P2002 가 아닌 에러는 그대로 전파한다(멱등 처리 아님)', async () => {
    const { service, mocks } = makeService({});
    const boom = new Error('db down');
    mocks.blockCreate.mockRejectedValueOnce(boom);

    await expect(service.createBlock('sub-A', 'sub-B')).rejects.toBe(boom);
  });

  // ── unblock: 없는 행 멱등 + report 를 건드리지 않음 ────────────────────────────────────

  it('unblock: block 행을 삭제한다(blockerId=sub, blockedUserId 복합 매칭)', async () => {
    const { service, store, mocks } = makeService({
      blocks: [block('sub-A', 'sub-B')],
    });

    await service.unblock('sub-A', 'sub-B');

    expect(mocks.blockDeleteMany).toHaveBeenCalledWith({
      where: { blockerId: 'sub-A', blockedUserId: 'sub-B' },
    });
    expect(store.blocks).toHaveLength(0);
  });

  it('unblock: 존재하지 않는 차단을 해제해도 멱등 성공한다(throw 없음)', async () => {
    const { service } = makeService({});

    await expect(service.unblock('sub-A', 'sub-B')).resolves.not.toThrow();
  });

  it('unblock: block 만 삭제하고 report 는 건드리지 않는다(차단 해제 ≠ 신고 취소, report 숨김 불변)', async () => {
    const { service, store } = makeService({
      blocks: [block('sub-A', 'sub-B')],
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-B' })],
    });

    await service.unblock('sub-A', 'sub-B');

    // block 은 삭제되지만 report 는 그대로 남아 report 기반 숨김이 유지된다(AC-BLK-2).
    expect(store.blocks).toHaveLength(0);
    expect(store.reports).toHaveLength(1);
    // report 삭제 경로가 없어야 한다 — report 는 findMany/create 만 fake 로 노출(delete 미제공).
    const hidden = await service.getHiddenUserIds('sub-A');
    expect(hidden).toContain('sub-B');
  });

  it('unblock: 남의 차단은 삭제하지 않는다(blockerId=sub 격리)', async () => {
    const { service, store } = makeService({
      blocks: [
        block('sub-A', 'sub-B'), // 내 차단
        block('sub-X', 'sub-B'), // 남(X)의 차단 — 무관해야 함
      ],
    });

    await service.unblock('sub-A', 'sub-B');

    // A 의 차단만 지워지고 X 의 차단은 남는다(WHERE 에 blockerId=sub 내장).
    expect(store.blocks).toEqual([block('sub-X', 'sub-B')]);
  });

  // ── listBlocks: block 행만(신고 숨김 별도) ─────────────────────────────────────────────

  it('listBlocks: 내(sub)가 차단한 block 행만 반환한다(blockerId=sub 격리)', async () => {
    const { service, mocks } = makeService({
      blocks: [
        block('sub-A', 'sub-B'),
        block('sub-A', 'sub-C'),
        block('sub-X', 'sub-Z'), // 남의 차단 — 제외
      ],
    });

    const blocks = await service.listBlocks('sub-A');

    expect(mocks.blockFindMany).toHaveBeenCalledWith({
      where: { blockerId: 'sub-A' },
    });
    expect(blocks.map((b) => b.blockedUserId).sort()).toEqual([
      'sub-B',
      'sub-C',
    ]);
  });

  it('listBlocks: 신고(report)만 있고 block 이 없으면 빈 목록이다(신고 숨김은 목록에 안 나타남)', async () => {
    const { service, mocks } = makeService({
      // report 만 존재 — listBlocks 는 block 행만 조회한다(report 무관).
      reports: [report({ reporterId: 'sub-A', targetUserId: 'sub-B' })],
    });

    const blocks = await service.listBlocks('sub-A');

    expect(blocks).toEqual([]);
    // block.findMany 만 호출 — report 는 listBlocks 경로에서 조회하지 않는다.
    expect(mocks.reportFindMany).not.toHaveBeenCalled();
  });
});
