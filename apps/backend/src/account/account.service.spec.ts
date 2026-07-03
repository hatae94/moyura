import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AccountService } from './account.service';
import type { SupabaseAdminClient } from './supabase-admin.client';

// AccountService.deleteAccount 단위 테스트(SPEC-ACCOUNT-001 T-04 / REQ-ACCOUNT-001·001b · AC-1-1/1-2/1-4).
// notification.service.spec 의 fake Prisma 패턴을 따른다 — jest.fn 은 async 대신 Promise.resolve 를 반환하고
// (require-await 회피), 인터랙티브 $transaction 은 콜백에 fake tx(= 동일 delegate 객체)를 넘겨 그대로 실행한다.
//
// 이 스펙이 검증하는 오케스트레이션 코어:
//   - 단일 트랜잭션에서 PII deleteMany/updateMany/upsert 가 각각 계약 인자로 호출(AC-1-1).
//   - 앱 데이터 정리(트랜잭션)가 auth 삭제(SupabaseAdminClient.deleteUser)보다 **선행**(AC-1-1).
//   - 멱등 재실행: 모든 deleteMany/updateMany/upsert 가 count 0/멱등으로 성공(P2025 없음) + deleteUser 재호출(AC-1-2).
//   - 원장 테이블(chat_message/schedule_slot/expense/settlement/poll_vote) delete 미호출(AC-1-4).
//   - safety 고아 행 정리: block/report deleteMany 를 OR 양측(blocker/blocked·reporter/target) 조건으로 호출(T-05 / AC-1-3).
// 소유자 고아화 방지(T-06)·컨트롤러(T-07)는 이 스펙 범위 밖이다.

const SUB = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-07-02T00:00:00.000Z');

// ── fake Prisma 인자 형태(no-unsafe 회피용 명시 타입) ──────────────────────────
interface DeleteManyArg {
  where: Record<string, unknown>;
}
interface MemberUpdateManyArg {
  where: { userId: string };
  data: { nickname: string; withdrawnAt: Date; role: string };
}
interface WithdrawnUpsertArg {
  where: { sub: string };
  create: { sub: string };
  update: Record<string, unknown>;
}

// ── 소유자 고아화 방지(T-06) fake 형태 ────────────────────────────────────────
// step 1 은 트랜잭션 밖(top-level prisma.moimMember)에서 두 종류의 findMany 를 호출한다:
//   (A) owner 조회: where { userId, role:'owner' } → 탈퇴자가 owner 인 모임 목록.
//   (B) 활성 이양 대상 조회: where { moimId, role:{not:'owner'}, withdrawnAt:null }, orderBy joinedAt asc, take 1.
interface OwnerFindManyArg {
  where: {
    userId?: string;
    moimId?: string;
    role?: string | { not: string };
    withdrawnAt?: null;
  };
  orderBy?: { joinedAt: 'asc' | 'desc' };
  take?: number;
}
interface OwnerMembership {
  moimId: string;
}
interface ActiveTarget {
  userId: string;
}

interface Mocks {
  deviceTokenDeleteMany: jest.Mock<Promise<{ count: number }>, [DeleteManyArg]>;
  notificationDeleteMany: jest.Mock<
    Promise<{ count: number }>,
    [DeleteManyArg]
  >;
  moimInviteDeleteMany: jest.Mock<Promise<{ count: number }>, [DeleteManyArg]>;
  moimMemberUpdateMany: jest.Mock<
    Promise<{ count: number }>,
    [MemberUpdateManyArg]
  >;
  withdrawnUpsert: jest.Mock<Promise<{ sub: string }>, [WithdrawnUpsertArg]>;
  profileDeleteMany: jest.Mock<Promise<{ count: number }>, [DeleteManyArg]>;
  // safety 고아 정리(T-05) — block/report deleteMany 를 OR 양측 조건으로 호출한다(AC-1-3).
  blockDeleteMany: jest.Mock<Promise<{ count: number }>, [DeleteManyArg]>;
  reportDeleteMany: jest.Mock<Promise<{ count: number }>, [DeleteManyArg]>;
  // 원장 테이블 delete 감시자 — deleteAccount 가 절대 호출하지 않아야 한다(AC-1-4).
  chatMessageDelete: jest.Mock;
  chatMessageDeleteMany: jest.Mock;
  scheduleSlotDelete: jest.Mock;
  scheduleSlotDeleteMany: jest.Mock;
  expenseDelete: jest.Mock;
  expenseDeleteMany: jest.Mock;
  settlementDelete: jest.Mock;
  settlementDeleteMany: jest.Mock;
  pollVoteDelete: jest.Mock;
  pollVoteDeleteMany: jest.Mock;
  $transaction: jest.Mock;
  deleteUser: jest.Mock<Promise<void>, [string]>;
  isConfigured: jest.Mock<boolean, []>;
  // 소유자 고아화 방지(T-06) — top-level moimMember.findMany + MoimService 이양/삭제 위임.
  moimMemberFindMany: jest.Mock<
    Promise<OwnerMembership[] | ActiveTarget[]>,
    [OwnerFindManyArg]
  >;
  transferOwner: jest.Mock<Promise<void>, [string, string, string]>;
  deleteMoim: jest.Mock<Promise<void>, [string, string]>;
  // step 1 의 활성 대상 조회(B) 인자 캡처 — where/orderBy/take 단언용(AC-2-3).
  targetQueries: OwnerFindManyArg[];
}

function makeService(opts?: {
  serviceRoleConfigured?: boolean;
  // 탈퇴자가 owner 인 모임 목록(step 1 (A) 반환값). 기본 [] → 소유 모임 없음(T-04/T-05 기존 테스트 불변).
  ownerMemberships?: OwnerMembership[];
  // moimId 별 활성(withdrawnAt:null) 비-owner 이양 대상(step 1 (B) 반환값). 없으면 [] = 활성 대상 0 → deleteMoim.
  activeTargets?: Record<string, ActiveTarget[]>;
}): {
  service: AccountService;
  mocks: Mocks;
  order: string[];
} {
  const order: string[] = [];

  const deviceTokenDeleteMany = jest.fn<
    Promise<{ count: number }>,
    [DeleteManyArg]
  >(() => Promise.resolve({ count: 0 }));
  const notificationDeleteMany = jest.fn<
    Promise<{ count: number }>,
    [DeleteManyArg]
  >(() => Promise.resolve({ count: 0 }));
  const moimInviteDeleteMany = jest.fn<
    Promise<{ count: number }>,
    [DeleteManyArg]
  >(() => Promise.resolve({ count: 0 }));
  const moimMemberUpdateMany = jest.fn<
    Promise<{ count: number }>,
    [MemberUpdateManyArg]
  >(() => Promise.resolve({ count: 0 }));
  const withdrawnUpsert = jest.fn<
    Promise<{ sub: string }>,
    [WithdrawnUpsertArg]
  >((arg) => Promise.resolve({ sub: arg.create.sub }));
  const profileDeleteMany = jest.fn<
    Promise<{ count: number }>,
    [DeleteManyArg]
  >(() => Promise.resolve({ count: 0 }));
  // safety 고아 정리(T-05) — block/report deleteMany(OR 양측). 재실행 멱등이라 count 0 을 반환한다.
  const blockDeleteMany = jest.fn<Promise<{ count: number }>, [DeleteManyArg]>(
    () => Promise.resolve({ count: 0 }),
  );
  const reportDeleteMany = jest.fn<Promise<{ count: number }>, [DeleteManyArg]>(
    () => Promise.resolve({ count: 0 }),
  );

  // 원장 delete 감시자 — 호출되면 테스트가 잡아낸다(AC-1-4).
  const ledgerSpy = (): jest.Mock =>
    jest.fn(() => Promise.resolve({ count: 0 }));
  const chatMessageDelete = ledgerSpy();
  const chatMessageDeleteMany = ledgerSpy();
  const scheduleSlotDelete = ledgerSpy();
  const scheduleSlotDeleteMany = ledgerSpy();
  const expenseDelete = ledgerSpy();
  const expenseDeleteMany = ledgerSpy();
  const settlementDelete = ledgerSpy();
  const settlementDeleteMany = ledgerSpy();
  const pollVoteDelete = ledgerSpy();
  const pollVoteDeleteMany = ledgerSpy();

  // 트랜잭션 콜백에 넘길 fake tx delegate — 순서 추적을 위해 각 mock 을 감싼다.
  const txClient = {
    deviceToken: {
      deleteMany: jest.fn((arg: DeleteManyArg) => {
        order.push('deviceToken.deleteMany');
        return deviceTokenDeleteMany(arg);
      }),
    },
    notification: {
      deleteMany: jest.fn((arg: DeleteManyArg) => {
        order.push('notification.deleteMany');
        return notificationDeleteMany(arg);
      }),
    },
    moimInvite: {
      deleteMany: jest.fn((arg: DeleteManyArg) => {
        order.push('moimInvite.deleteMany');
        return moimInviteDeleteMany(arg);
      }),
    },
    moimMember: {
      updateMany: jest.fn((arg: MemberUpdateManyArg) => {
        order.push('moimMember.updateMany');
        return moimMemberUpdateMany(arg);
      }),
    },
    withdrawnAccount: {
      upsert: jest.fn((arg: WithdrawnUpsertArg) => {
        order.push('withdrawnAccount.upsert');
        return withdrawnUpsert(arg);
      }),
    },
    profile: {
      deleteMany: jest.fn((arg: DeleteManyArg) => {
        order.push('profile.deleteMany');
        return profileDeleteMany(arg);
      }),
    },
    // safety 고아 행 — SafetyModule import 없이 prisma 직접 접근(비순환, T-05). OR 양측 조건으로 정리한다.
    block: {
      deleteMany: jest.fn((arg: DeleteManyArg) => {
        order.push('block.deleteMany');
        return blockDeleteMany(arg);
      }),
    },
    report: {
      deleteMany: jest.fn((arg: DeleteManyArg) => {
        order.push('report.deleteMany');
        return reportDeleteMany(arg);
      }),
    },
    // 원장 테이블 — 호출되면 즉시 감지(AC-1-4). deleteAccount 는 이들을 절대 만지지 않아야 한다.
    chatMessage: {
      delete: chatMessageDelete,
      deleteMany: chatMessageDeleteMany,
    },
    scheduleSlot: {
      delete: scheduleSlotDelete,
      deleteMany: scheduleSlotDeleteMany,
    },
    expense: { delete: expenseDelete, deleteMany: expenseDeleteMany },
    settlement: { delete: settlementDelete, deleteMany: settlementDeleteMany },
    pollVote: { delete: pollVoteDelete, deleteMany: pollVoteDeleteMany },
  };

  // 인터랙티브 $transaction — 콜백에 fake tx 를 넘겨 그대로 실행한다(poll/expense.service.spec 패턴).
  const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) => {
    order.push('$transaction:begin');
    return cb(txClient);
  });

  // ── 소유자 고아화 방지(T-06) — top-level moimMember.findMany 라우터 ──────────────
  // (A) owner 조회(where.role==='owner') → ownerMemberships. (B) 활성 대상 조회(where.role={not:'owner'}) → activeTargets[moimId].
  const ownerMemberships = opts?.ownerMemberships ?? [];
  const activeTargets = opts?.activeTargets ?? {};
  const targetQueries: OwnerFindManyArg[] = [];
  const moimMemberFindMany = jest.fn<
    Promise<OwnerMembership[] | ActiveTarget[]>,
    [OwnerFindManyArg]
  >((arg) => {
    if (arg.where.role === 'owner') {
      order.push('moimMember.findMany:owner');
      return Promise.resolve(ownerMemberships);
    }
    // 활성 이양 대상 조회 — 인자를 캡처(where withdrawnAt:null / role {not:'owner'} / orderBy / take 단언).
    order.push('moimMember.findMany:target');
    targetQueries.push(arg);
    const moimId = arg.where.moimId ?? '';
    return Promise.resolve(activeTargets[moimId] ?? []);
  });

  const prisma = {
    $transaction,
    moimMember: { findMany: moimMemberFindMany },
  } as unknown as PrismaService;

  const deleteUser = jest.fn<Promise<void>, [string]>(() => {
    order.push('deleteUser');
    return Promise.resolve();
  });
  const isConfigured = jest.fn<boolean, []>(
    () => opts?.serviceRoleConfigured ?? true,
  );
  const admin = { deleteUser, isConfigured } as unknown as SupabaseAdminClient;

  // MoimService 위임 mock — 이양/삭제 호출을 캡처한다(실제 로직 미실행).
  const transferOwner = jest.fn<Promise<void>, [string, string, string]>(
    (_sub, moimId) => {
      order.push(`transferOwner:${moimId}`);
      return Promise.resolve();
    },
  );
  const deleteMoim = jest.fn<Promise<void>, [string, string]>(
    (_sub, moimId) => {
      order.push(`deleteMoim:${moimId}`);
      return Promise.resolve();
    },
  );
  const moim = { transferOwner, deleteMoim } as unknown as MoimService;

  const service = new AccountService(prisma, admin, moim);
  return {
    service,
    order,
    mocks: {
      deviceTokenDeleteMany,
      notificationDeleteMany,
      moimInviteDeleteMany,
      moimMemberUpdateMany,
      withdrawnUpsert,
      profileDeleteMany,
      blockDeleteMany,
      reportDeleteMany,
      chatMessageDelete,
      chatMessageDeleteMany,
      scheduleSlotDelete,
      scheduleSlotDeleteMany,
      expenseDelete,
      expenseDeleteMany,
      settlementDelete,
      settlementDeleteMany,
      pollVoteDelete,
      pollVoteDeleteMany,
      $transaction,
      deleteUser,
      isConfigured,
      moimMemberFindMany,
      transferOwner,
      deleteMoim,
      targetQueries,
    },
  };
}

describe('AccountService.deleteAccount (T-04 / REQ-ACCOUNT-001·001b)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // ── AC-1-1: PII 삭제 + 익명화 + 툼스톤 + auth 삭제 순서 ──────────────────────
  describe('AC-1-1 — PII deleteMany/updateMany/upsert + profile 삭제가 auth 삭제보다 선행', () => {
    it('단일 트랜잭션에서 각 테이블 정리를 계약 인자로 호출한다', async () => {
      const { service, mocks } = makeService();

      await service.deleteAccount(SUB);

      // device_token: userId=sub 벌크 삭제.
      expect(mocks.deviceTokenDeleteMany).toHaveBeenCalledTimes(1);
      expect(mocks.deviceTokenDeleteMany).toHaveBeenCalledWith({
        where: { userId: SUB },
      });
      // notification: recipientId=sub 삭제.
      expect(mocks.notificationDeleteMany).toHaveBeenCalledWith({
        where: { recipientId: SUB },
      });
      // moim_invite: createdBy=sub 삭제(본인 발행 초대).
      expect(mocks.moimInviteDeleteMany).toHaveBeenCalledWith({
        where: { createdBy: SUB },
      });
      // moim_member: 익명화(nickname) + withdrawnAt=now + role='member'.
      expect(mocks.moimMemberUpdateMany).toHaveBeenCalledWith({
        where: { userId: SUB },
        data: {
          nickname: '탈퇴한 사용자',
          withdrawnAt: NOW,
          role: 'member',
        },
      });
      // withdrawn 툼스톤 upsert(멱등).
      expect(mocks.withdrawnUpsert).toHaveBeenCalledWith({
        where: { sub: SUB },
        create: { sub: SUB },
        update: {},
      });
      // profile: id=sub 삭제(deleteMany 라 멱등 — 재실행 시 count 0).
      expect(mocks.profileDeleteMany).toHaveBeenCalledWith({
        where: { id: SUB },
      });
    });

    it('앱 데이터 정리(트랜잭션)를 마친 뒤에 auth 계정 삭제를 1회 호출한다', async () => {
      const { service, mocks, order } = makeService();

      await service.deleteAccount(SUB);

      // 트랜잭션이 deleteUser 보다 먼저 실행돼야 한다(앱 데이터 정리 선행).
      const txIndex = order.indexOf('$transaction:begin');
      const deleteUserIndex = order.indexOf('deleteUser');
      expect(txIndex).toBeGreaterThanOrEqual(0);
      expect(deleteUserIndex).toBeGreaterThan(txIndex);
      // 툼스톤 upsert / profile 삭제도 auth 삭제보다 앞선다.
      expect(order.indexOf('withdrawnAccount.upsert')).toBeLessThan(
        deleteUserIndex,
      );
      expect(order.indexOf('profile.deleteMany')).toBeLessThan(deleteUserIndex);

      expect(mocks.deleteUser).toHaveBeenCalledTimes(1);
      expect(mocks.deleteUser).toHaveBeenCalledWith(SUB);
    });

    it('service-role 키가 없으면 트랜잭션 착수 전 500 으로 fail-closed(부분 삭제 방지)', async () => {
      const { service, mocks } = makeService({ serviceRoleConfigured: false });

      await expect(service.deleteAccount(SUB)).rejects.toBeInstanceOf(Error);
      // 키 부재를 사전에 감지 → 앱 데이터 트랜잭션·auth 삭제 모두 미착수.
      expect(mocks.$transaction).not.toHaveBeenCalled();
      expect(mocks.profileDeleteMany).not.toHaveBeenCalled();
      expect(mocks.deleteUser).not.toHaveBeenCalled();
    });
  });

  // ── AC-1-2: 멱등 재실행 ─────────────────────────────────────────────────────
  describe('AC-1-2 — 멱등 재실행(P2025 없음, deleteUser 재호출 복구)', () => {
    it('동일 sub 로 재호출해도 모든 정리가 count 0/멱등으로 성공하고 deleteUser 를 다시 호출한다', async () => {
      const { service, mocks } = makeService();

      // 1회차(앱 데이터 정리 + auth 삭제).
      await service.deleteAccount(SUB);
      // 2회차(auth 단계 실패 후 재실행 시나리오) — deleteMany/updateMany/upsert 는 멱등.
      await expect(service.deleteAccount(SUB)).resolves.toBeUndefined();

      // 각 정리가 2회씩 호출됐고(멱등), 예외 없이 완료됐다.
      expect(mocks.profileDeleteMany).toHaveBeenCalledTimes(2);
      expect(mocks.withdrawnUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.moimMemberUpdateMany).toHaveBeenCalledTimes(2);
      // deleteUser 도 재호출(복구 경로).
      expect(mocks.deleteUser).toHaveBeenCalledTimes(2);
    });

    // ── EC-3 / 계약 4.4: auth 삭제 실패 → 재실행 복구 ────────────────────────────
    // 툼스톤 기록(2단계) 뒤 auth 삭제(3단계)가 실패하면, 앱 데이터는 이미 무력화됐지만 auth 는 잔존한다.
    // 이 불변식의 핵심은 "재호출이 멱등 복구"라는 것 — 1차 deleteUser throw 로 예외가 전파돼도
    // 2차 deleteAccount 는 count 0 멱등 트랜잭션을 다시 완료하고 deleteUser 를 재시도해 성공해야 한다.
    it('1차 deleteUser 가 throw 하면 예외가 전파되지만, 2차 재호출은 멱등 복구로 성공한다', async () => {
      const { service, mocks } = makeService();

      // 1차: auth 삭제 단계에서 실패(툼스톤은 이미 기록된 상태 — 앱 데이터 정리는 완료).
      mocks.deleteUser.mockRejectedValueOnce(
        new Error('supabase auth deleteUser 실패'),
      );

      await expect(service.deleteAccount(SUB)).rejects.toThrow(
        'supabase auth deleteUser 실패',
      );
      // 1차에서 앱 데이터 트랜잭션은 완료됐고(툼스톤 기록됨), deleteUser 는 1회 시도됐다.
      expect(mocks.withdrawnUpsert).toHaveBeenCalledTimes(1);
      expect(mocks.deleteUser).toHaveBeenCalledTimes(1);

      // 2차: 재호출 — 모든 정리는 멱등(count 0, P2025 없음)으로 다시 완료되고 deleteUser 재시도가 성공한다.
      await expect(service.deleteAccount(SUB)).resolves.toBeUndefined();

      // 트랜잭션 정리는 2회씩(멱등 재실행), deleteUser 는 2회 시도(1차 실패 + 2차 성공 복구).
      expect(mocks.profileDeleteMany).toHaveBeenCalledTimes(2);
      expect(mocks.withdrawnUpsert).toHaveBeenCalledTimes(2);
      expect(mocks.deleteUser).toHaveBeenCalledTimes(2);
    });
  });

  // ── AC-1-3: safety 고아 행 정리(block/report) ────────────────────────────────
  // 탈퇴자가 남긴 차단/신고 행은 소유자 부재로 운영자 조치가 불가능한 고아가 된다(plan §10-3). 트랜잭션 내에서
  // SafetyModule/BlockService import 없이 prisma.block/report 를 직접 deleteMany 한다(R-15 비순환 계약).
  // 매칭 대상은 sub 가 관여한 **양측** — 차단자/피차단자, 신고자/피신고자 — 이므로 OR 조건으로 정리한다.
  describe('AC-1-3 (T-05 / REQ-ACCOUNT-001) — safety 고아 행(block/report) 정리', () => {
    it('block.deleteMany 를 blocker/blocked 양측 OR 조건으로 트랜잭션 내에서 호출한다', async () => {
      const { service, mocks } = makeService();

      await service.deleteAccount(SUB);

      expect(mocks.blockDeleteMany).toHaveBeenCalledTimes(1);
      expect(mocks.blockDeleteMany).toHaveBeenCalledWith({
        where: { OR: [{ blockerId: SUB }, { blockedUserId: SUB }] },
      });
    });

    it('report.deleteMany 를 reporter/target 양측 OR 조건으로 트랜잭션 내에서 호출한다', async () => {
      const { service, mocks } = makeService();

      await service.deleteAccount(SUB);

      expect(mocks.reportDeleteMany).toHaveBeenCalledTimes(1);
      expect(mocks.reportDeleteMany).toHaveBeenCalledWith({
        where: { OR: [{ reporterId: SUB }, { targetUserId: SUB }] },
      });
    });

    it('safety 정리도 트랜잭션 안(auth 삭제보다 선행)에서 수행한다', async () => {
      const { service, order } = makeService();

      await service.deleteAccount(SUB);

      const txIndex = order.indexOf('$transaction:begin');
      const deleteUserIndex = order.indexOf('deleteUser');
      const blockIndex = order.indexOf('block.deleteMany');
      const reportIndex = order.indexOf('report.deleteMany');
      // 트랜잭션 시작 이후, auth 삭제 이전에 block/report 정리가 위치한다.
      expect(blockIndex).toBeGreaterThan(txIndex);
      expect(reportIndex).toBeGreaterThan(txIndex);
      expect(blockIndex).toBeLessThan(deleteUserIndex);
      expect(reportIndex).toBeLessThan(deleteUserIndex);
    });

    it('멱등 재실행 시 block/report 정리도 count 0 으로 다시 성공한다(P2025 없음)', async () => {
      const { service, mocks } = makeService();

      await service.deleteAccount(SUB);
      await expect(service.deleteAccount(SUB)).resolves.toBeUndefined();

      expect(mocks.blockDeleteMany).toHaveBeenCalledTimes(2);
      expect(mocks.reportDeleteMany).toHaveBeenCalledTimes(2);
    });
  });

  // ── AC-1-4: 원장 행 삭제 금지 ────────────────────────────────────────────────
  describe('AC-1-4 (REQ-ACCOUNT-001b) — 원장 테이블 delete 미호출', () => {
    it('chat_message/schedule_slot/expense/settlement/poll_vote 에 delete 를 호출하지 않는다', async () => {
      const { service, mocks } = makeService();

      await service.deleteAccount(SUB);

      for (const spy of [
        mocks.chatMessageDelete,
        mocks.chatMessageDeleteMany,
        mocks.scheduleSlotDelete,
        mocks.scheduleSlotDeleteMany,
        mocks.expenseDelete,
        mocks.expenseDeleteMany,
        mocks.settlementDelete,
        mocks.settlementDeleteMany,
        mocks.pollVoteDelete,
        mocks.pollVoteDeleteMany,
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });
});

// ── T-06: 소유자 고아화 방지 (REQ-ACCOUNT-002·002b · AC-2-1/2-2/2-3) ────────────
// deleteAccount 는 익명화 트랜잭션(step 2)에 착수하기 **전에**(step 1) 탈퇴자가 owner 인 각 모임을 처리한다:
//   활성(withdrawnAt:null) 비-owner 멤버 ≥1 → MoimService.transferOwner(sub, moimId, 가장 오래된 활성 멤버).
//   활성 비-owner 0(잔여 없음 또는 전원 유령) → MoimService.deleteMoim(sub, moimId).
// step 1 이 step 2 보다 선행해야 하는 이유: transferOwner/deleteMoim 내부 assertOwner 가 sub 의 owner role 을
// 요구하는데, 익명화(step 2)가 role='member' 로 강등하므로 순서가 뒤바뀌면 403 이 된다(AC-2-1: 이양 후 익명화).
// 유령 이양 금지(R-4b): 활성 대상 선정 쿼리에 withdrawnAt:null 필터 필수 — 탈퇴 마킹 멤버는 새 owner 후보에서 배제.
const M1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const M2 = 'bbbbbbbb-0000-0000-0000-000000000002';
const ACTIVE_V = '22222222-2222-2222-2222-222222222222';

describe('AccountService.deleteAccount — T-06 소유자 고아화 방지 (REQ-ACCOUNT-002·002b)', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  // ── AC-2-1: 활성 타 멤버 존재 → 소유권 이양 ──────────────────────────────────
  describe('AC-2-1 — 활성 비-owner 멤버 존재 시 transferOwner(활성 대상)', () => {
    it('transferOwner 를 활성(withdrawnAt:null) 대상 userId 로 호출하고 deleteMoim 은 호출하지 않는다', async () => {
      const { service, mocks } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [{ userId: ACTIVE_V }] },
      });

      await service.deleteAccount(SUB);

      expect(mocks.transferOwner).toHaveBeenCalledTimes(1);
      expect(mocks.transferOwner).toHaveBeenCalledWith(SUB, M1, ACTIVE_V);
      expect(mocks.deleteMoim).not.toHaveBeenCalled();
    });

    it('소유권 이양(step 1)이 익명화 트랜잭션(step 2)보다 선행한다', async () => {
      const { service, order } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [{ userId: ACTIVE_V }] },
      });

      await service.deleteAccount(SUB);

      // assertOwner 가 owner role 을 요구하므로 transferOwner 는 반드시 익명화 전에 실행돼야 한다.
      const transferIndex = order.indexOf(`transferOwner:${M1}`);
      const txIndex = order.indexOf('$transaction:begin');
      expect(transferIndex).toBeGreaterThanOrEqual(0);
      expect(txIndex).toBeGreaterThanOrEqual(0);
      expect(transferIndex).toBeLessThan(txIndex);
    });
  });

  // ── AC-2-2: 유일 활성 멤버 owner → 모임 삭제 ────────────────────────────────
  describe('AC-2-2 — 활성 비-owner 멤버 0(잔여 없음) 시 deleteMoim', () => {
    it('활성 대상이 없으면 deleteMoim 을 호출하고 transferOwner 는 호출하지 않는다', async () => {
      const { service, mocks } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [] },
      });

      await service.deleteAccount(SUB);

      expect(mocks.deleteMoim).toHaveBeenCalledTimes(1);
      expect(mocks.deleteMoim).toHaveBeenCalledWith(SUB, M1);
      expect(mocks.transferOwner).not.toHaveBeenCalled();
    });

    it('모임 삭제(step 1)도 익명화 트랜잭션(step 2)보다 선행한다', async () => {
      const { service, order } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [] },
      });

      await service.deleteAccount(SUB);

      const deleteMoimIndex = order.indexOf(`deleteMoim:${M1}`);
      const txIndex = order.indexOf('$transaction:begin');
      expect(deleteMoimIndex).toBeGreaterThanOrEqual(0);
      expect(deleteMoimIndex).toBeLessThan(txIndex);
    });
  });

  // ── AC-2-3: 유령 이양 금지 (활성 카운트 기준) ────────────────────────────────
  describe('AC-2-3 — 유령 배제 선정(withdrawnAt:null 필터)', () => {
    it('[EDGE] 비-owner 전원 유령 → 활성 대상 0 → deleteMoim, transferOwner 미호출', async () => {
      // 전원 탈퇴 마킹이면 (B) 활성 대상 조회(withdrawnAt:null)가 [] 를 반환한다 → deleteMoim 경로.
      const { service, mocks } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [] },
      });

      await service.deleteAccount(SUB);

      expect(mocks.transferOwner).not.toHaveBeenCalled();
      expect(mocks.deleteMoim).toHaveBeenCalledWith(SUB, M1);
    });

    it('활성 대상 선정 쿼리에 withdrawnAt:null / role{not:owner} / orderBy joinedAt asc / take 1 을 적용한다', async () => {
      const { service, mocks } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [{ userId: ACTIVE_V }] },
      });

      await service.deleteAccount(SUB);

      // 활성 1 + 유령 N 혼재 상황에서도 유령을 배제하도록 선정 쿼리는 반드시 이 조건을 포함한다(EC-2).
      expect(mocks.targetQueries).toHaveLength(1);
      expect(mocks.targetQueries[0]).toEqual({
        where: { moimId: M1, role: { not: 'owner' }, withdrawnAt: null },
        orderBy: { joinedAt: 'asc' },
        take: 1,
      });
    });
  });

  // ── 다중 소유 모임 순회 ──────────────────────────────────────────────────────
  describe('다중 owner 모임 순회', () => {
    it('활성 대상이 있는 모임은 transferOwner, 없는 모임은 deleteMoim 으로 각각 처리한다', async () => {
      const { service, mocks } = makeService({
        ownerMemberships: [{ moimId: M1 }, { moimId: M2 }],
        activeTargets: { [M1]: [{ userId: ACTIVE_V }], [M2]: [] },
      });

      await service.deleteAccount(SUB);

      expect(mocks.transferOwner).toHaveBeenCalledTimes(1);
      expect(mocks.transferOwner).toHaveBeenCalledWith(SUB, M1, ACTIVE_V);
      expect(mocks.deleteMoim).toHaveBeenCalledTimes(1);
      expect(mocks.deleteMoim).toHaveBeenCalledWith(SUB, M2);
    });
  });

  // ── owner 조회 쿼리 계약 + 소유 모임 없음(no-op) ─────────────────────────────
  describe('owner 조회 및 no-op', () => {
    it('owner 모임 조회를 where{userId, role:owner} 로 수행한다', async () => {
      const { service, mocks } = makeService({
        ownerMemberships: [{ moimId: M1 }],
        activeTargets: { [M1]: [{ userId: ACTIVE_V }] },
      });

      await service.deleteAccount(SUB);

      expect(mocks.moimMemberFindMany).toHaveBeenCalledWith({
        where: { userId: SUB, role: 'owner' },
      });
    });

    it('소유한 모임이 없으면 transferOwner·deleteMoim 을 호출하지 않는다(step 1 no-op)', async () => {
      const { service, mocks } = makeService();

      await service.deleteAccount(SUB);

      expect(mocks.transferOwner).not.toHaveBeenCalled();
      expect(mocks.deleteMoim).not.toHaveBeenCalled();
    });
  });
});
