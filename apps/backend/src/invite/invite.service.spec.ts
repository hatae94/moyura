import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '../generated/prisma/client';
import type { Moim, MoimInvite, MoimMember } from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MOIM_MEMBER_JOINED } from './invite-events';
import { InviteService } from './invite.service';

// InviteService 단위 테스트(SPEC-MOIM-002). 인메모리 fake prisma + stub MoimService(assertOwner)로
// 토큰 엔트로피·만료 상한·owner 인가 재사용·수락 멱등/원자 usedCount·고정 실패 코드를 검증한다.
// MoimService.assertOwner는 MOIM-001에서 검증된 단일 출처라 여기서는 재구현하지 않고 스텁한다(reuse 계약).

interface Tables {
  invite: Map<string, MoimInvite>; // key: invite.id
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
  moim: Map<string, Moim>; // key: moim.id (SPEC-MOIM-012 cap 검사용)
}

const NOW = new Date('2026-06-14T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

describe('InviteService', () => {
  let tables: Tables;
  let inviteSeq: number;
  // assertOwner가 403을 던지도록 만드는 owner sub 집합(모임별). 비어 있으면 모두 비-owner.
  let owners: Map<string, Set<string>>;

  function reset(): void {
    tables = { invite: new Map(), member: new Map(), moim: new Map() };
    inviteSeq = 0;
    owners = new Map();
  }

  // SPEC-MOIM-012: 테스트에서 모임을 미리 시드한다. 기본 maxMembers=15.
  function seedMoim(moimId: string, maxMembers = 15): Moim {
    const moim: Moim = {
      id: moimId,
      name: '테스트 모임',
      startsAt: null,
      location: null,
      maxMembers,
      createdBy: 'owner-sub',
      createdAt: NOW,
      budget: null,
    };
    tables.moim.set(moimId, moim);
    return moim;
  }

  function setOwner(moimId: string, sub: string): void {
    const set = owners.get(moimId) ?? new Set<string>();
    set.add(sub);
    owners.set(moimId, set);
  }

  function seedInvite(
    partial: Partial<MoimInvite> & { moimId: string },
  ): MoimInvite {
    inviteSeq += 1;
    const invite: MoimInvite = {
      id: partial.id ?? `invite-${inviteSeq}`,
      moimId: partial.moimId,
      token: partial.token ?? `token-${inviteSeq}`,
      expiresAt: partial.expiresAt ?? new Date(NOW.getTime() + 7 * DAY_MS),
      maxUses: partial.maxUses ?? null,
      usedCount: partial.usedCount ?? 0,
      revokedAt: partial.revokedAt ?? null,
      createdBy: partial.createdBy ?? 'owner-sub',
      createdAt: partial.createdAt ?? NOW,
    };
    tables.invite.set(invite.id, invite);
    return invite;
  }

  // assertOwner/assertMember를 스텁한 MoimService(owners 맵 기반 403 판정).
  function makeMoimService(): MoimService {
    return {
      assertOwner: jest.fn((sub: string, moimId: string) => {
        if (!owners.get(moimId)?.has(sub)) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve();
      }),
    } as unknown as MoimService;
  }

  // moimInvite + moimMember 테이블을 흉내내는 fake prisma(인터랙티브 $transaction 포함).
  function makePrisma(): PrismaService {
    const moimInvite = {
      create: jest.fn((arg: { data: Omit<MoimInvite, 'id' | 'createdAt'> }) => {
        inviteSeq += 1;
        const created: MoimInvite = {
          id: `invite-${inviteSeq}`,
          createdAt: NOW,
          ...arg.data,
        };
        tables.invite.set(created.id, created);
        return Promise.resolve(created);
      }),
      findUnique: jest.fn((arg: { where: { token?: string; id?: string } }) =>
        Promise.resolve(
          arg.where.token !== undefined
            ? ([...tables.invite.values()].find(
                (i) => i.token === arg.where.token,
              ) ?? null)
            : (tables.invite.get(arg.where.id) ?? null),
        ),
      ),
      findMany: jest.fn((arg: { where: { moimId: string } }) =>
        Promise.resolve(
          [...tables.invite.values()].filter(
            (i) => i.moimId === arg.where.moimId,
          ),
        ),
      ),
      update: jest.fn(
        (arg: { where: { id: string }; data: Partial<MoimInvite> }) => {
          const existing = tables.invite.get(arg.where.id);
          if (!existing) {
            return Promise.reject(new Error('not found'));
          }
          const updated = { ...existing, ...arg.data };
          tables.invite.set(updated.id, updated);
          return Promise.resolve(updated);
        },
      ),
      // 조건부 원자 증가 흉내: where 조건(id + revokedAt null + maxUses null|usedCount<lt)을 만족해야 count 1.
      updateMany: jest.fn(
        (arg: {
          where: {
            id: string;
            revokedAt: null;
            OR: ({ maxUses: null } | { usedCount: { lt: number } })[];
          };
          data: { usedCount: { increment: number } };
        }) => {
          const existing = tables.invite.get(arg.where.id);
          if (!existing || existing.revokedAt !== null) {
            return Promise.resolve({ count: 0 });
          }
          const lt = arg.where.OR.find(
            (c): c is { usedCount: { lt: number } } => 'usedCount' in c,
          )?.usedCount.lt;
          const unlimited = arg.where.OR.some((c) => 'maxUses' in c);
          const withinLimit =
            (unlimited && existing.maxUses === null) ||
            (lt !== undefined && existing.usedCount < lt);
          if (!withinLimit) {
            return Promise.resolve({ count: 0 });
          }
          existing.usedCount += arg.data.usedCount.increment;
          tables.invite.set(existing.id, existing);
          return Promise.resolve({ count: 1 });
        },
      ),
    };

    const moimMember = {
      findUnique: jest.fn(
        (arg: {
          where: { moimId_userId: { moimId: string; userId: string } };
        }) =>
          Promise.resolve(
            tables.member.get(
              memberKey(
                arg.where.moimId_userId.moimId,
                arg.where.moimId_userId.userId,
              ),
            ) ?? null,
          ),
      ),
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            userId: string;
            nickname: string;
            role: string;
          };
        }) => {
          const created: MoimMember = {
            moimId: arg.data.moimId,
            userId: arg.data.userId,
            nickname: arg.data.nickname,
            role: arg.data.role,
            joinedAt: NOW,
          };
          tables.member.set(memberKey(created.moimId, created.userId), created);
          return Promise.resolve(created);
        },
      ),
    };

    // SPEC-MOIM-012: accept()가 cap 검사를 위해 moim.findUnique와 moimMember.count를 호출한다.
    const moim = {
      findUnique: jest.fn((arg: { where: { id: string } }) =>
        Promise.resolve(tables.moim.get(arg.where.id) ?? null),
      ),
    };

    return {
      moimInvite,
      moimMember: {
        ...moimMember,
        // SPEC-MOIM-012: 현재 멤버 수 반환(accept cap 검사용).
        count: jest.fn((arg: { where: { moimId: string } }) =>
          Promise.resolve(
            [...tables.member.values()].filter(
              (m) => m.moimId === arg.where.moimId,
            ).length,
          ),
        ),
      },
      moim,
      // 실제 DB 트랜잭션의 원자성을 흉내낸다: 콜백이 throw하면 tentative write(invite/member)를 롤백한다.
      // invite/member 맵의 스냅샷을 떠 두고, 예외 시 원복해 "예외 → 부분 쓰기 잔존 없음"을 단위에서 증명한다.
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const inviteSnapshot = new Map(
          [...tables.invite.entries()].map(([k, v]) => [k, { ...v }]),
        );
        const memberSnapshot = new Map(
          [...tables.member.entries()].map(([k, v]) => [k, { ...v }]),
        );
        try {
          return await cb({ moimInvite, moimMember });
        } catch (err) {
          tables.invite = inviteSnapshot;
          tables.member = memberSnapshot;
          throw err;
        }
      }),
    } as unknown as PrismaService;
  }

  function makeService(): {
    service: InviteService;
    prisma: PrismaService;
    emit: jest.Mock;
  } {
    const prisma = makePrisma();
    // EventEmitter2 는 emit 만 사용한다(SPEC-NOTIFICATIONS-001 M1). standalone jest.fn 참조를 유지해
    // 호출 여부/인자를 unbound-method 경고 없이 단언한다(push.listener.spec 패턴 동일).
    const emit = jest.fn();
    const service = new InviteService(prisma, makeMoimService(), {
      emit,
    } as unknown as EventEmitter2);
    jest.useFakeTimers().setSystemTime(NOW);
    return { service, prisma, emit };
  }

  beforeEach(() => {
    reset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── T-007: checkValidity() — 읽기 전용 유효성 확인 + 초대 미리보기 요약(SPEC-MOIM-011) ──
  describe('checkValidity() (SPEC-MOIM-011)', () => {
    it('유효 토큰이면 moimId + 모임 요약(name·memberCount·maxMembers)을 반환한다', async () => {
      const { service } = makeService();
      // 모임(name='주말 모임', 정원 10) + 멤버 2명 시드 → memberCount=2 기대.
      // seedMoim이 반환하는 객체는 tables.moim에 저장된 동일 참조라 name만 덮어쓰면 된다.
      seedMoim('moim-A', 10).name = '주말 모임';
      tables.member.set(memberKey('moim-A', 'm1'), {
        moimId: 'moim-A',
        userId: 'm1',
        nickname: 'm1',
        role: 'owner',
        joinedAt: NOW,
      });
      tables.member.set(memberKey('moim-A', 'm2'), {
        moimId: 'moim-A',
        userId: 'm2',
        nickname: 'm2',
        role: 'member',
        joinedAt: NOW,
      });
      seedInvite({ moimId: 'moim-A', token: 'valid-token' });

      const result = await service.checkValidity('valid-token');

      expect(result).toEqual({
        moimId: 'moim-A',
        name: '주말 모임',
        memberCount: 2,
        maxMembers: 10,
      });
    });

    it('미지 토큰 → 404', async () => {
      const { service } = makeService();

      await expect(service.checkValidity('unknown')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('폐기 토큰 → 410(폐기된 초대입니다)', async () => {
      const { service } = makeService();
      seedMoim('moim-A');
      seedInvite({ moimId: 'moim-A', token: 'revoked', revokedAt: NOW });

      await expect(service.checkValidity('revoked')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('만료 토큰 → 410(만료된 초대입니다)', async () => {
      const { service } = makeService();
      seedMoim('moim-A');
      seedInvite({
        moimId: 'moim-A',
        token: 'expired',
        expiresAt: new Date(NOW.getTime() - DAY_MS),
      });

      await expect(service.checkValidity('expired')).rejects.toBeInstanceOf(
        GoneException,
      );
    });

    it('maxUses 소진 초대(usedCount >= maxUses)도 유효하다고 판정한다(checkValidity는 한도 검사 안 함)', async () => {
      const { service } = makeService();
      seedMoim('moim-A', 15);
      seedInvite({
        moimId: 'moim-A',
        token: 'exhausted',
        maxUses: 2,
        usedCount: 2,
      });

      // 한도 소진 상태여도 만료·폐기가 아니면 200(요약 반환). 멤버 0명 → memberCount=0.
      const result = await service.checkValidity('exhausted');
      expect(result).toEqual({
        moimId: 'moim-A',
        name: '테스트 모임',
        memberCount: 0,
        maxMembers: 15,
      });
    });

    it('유효성 검사는 통과했으나 모임이 없으면 404(방어적 — 고아 초대 빈 응답 방지)', async () => {
      const { service } = makeService();
      // moim 맵에 시드하지 않음 → moim.findUnique null → 404.
      seedInvite({ moimId: 'moim-A', token: 'orphan' });

      await expect(service.checkValidity('orphan')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // ── T-002: create() — assertOwner + 토큰 엔트로피 + 만료 기본/상한 ──
  describe('create() (REQ-INV-001 / AC-1)', () => {
    it('owner가 발급하면 토큰·기본 만료(now+7d)·usedCount=0 초대를 만든다', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');

      const invite = await service.create('owner-1', 'moim-A', {});

      expect(invite.moimId).toBe('moim-A');
      expect(invite.usedCount).toBe(0);
      expect(invite.maxUses).toBeNull();
      expect(invite.revokedAt).toBeNull();
      // 기본 만료 = now + 7일.
      expect(invite.expiresAt.getTime()).toBe(NOW.getTime() + 7 * DAY_MS);
    });

    it('토큰은 ≥128-bit 엔트로피(base64url 32바이트 = 256-bit)이며 매번 고유하다', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');

      const a = await service.create('owner-1', 'moim-A', {});
      const b = await service.create('owner-1', 'moim-A', {});

      // base64url(32 bytes) = 43자(패딩 없음). 최소 22자(=128-bit)는 충분히 상회.
      expect(a.token.length).toBeGreaterThanOrEqual(43);
      expect(a.token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(a.token).not.toBe(b.token);
    });

    it('maxUses를 지정하면 초대에 반영한다', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');

      const invite = await service.create('owner-1', 'moim-A', { maxUses: 5 });

      expect(invite.maxUses).toBe(5);
    });

    it('expiresAt를 owner가 조정할 수 있다(상한 이내)', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');
      const at = new Date(NOW.getTime() + 10 * DAY_MS).toISOString();

      const invite = await service.create('owner-1', 'moim-A', {
        expiresAt: at,
      });

      expect(invite.expiresAt.toISOString()).toBe(at);
    });

    it('비-owner가 발급을 시도하면 403(assertOwner 재사용) + 초대 미생성', async () => {
      const { service } = makeService();
      // owner 미등록 → assertOwner reject.

      await expect(
        service.create('stranger', 'moim-A', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // 부작용 없음: 초대가 생성되지 않았다(unbound-method 회피 — 상태로 단언).
      expect(tables.invite.size).toBe(0);
    });

    it('expiresAt가 상한(now+30d)을 초과하면 400 + 초대 미생성', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');
      const tooFar = new Date(NOW.getTime() + 31 * DAY_MS).toISOString();

      await expect(
        service.create('owner-1', 'moim-A', { expiresAt: tooFar }),
      ).rejects.toMatchObject({ status: 400 });
      expect(tables.invite.size).toBe(0);
    });

    it('maxUses가 양의 정수가 아니면 400 + 초대 미생성', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');

      await expect(
        service.create('owner-1', 'moim-A', { maxUses: 0 }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.create('owner-1', 'moim-A', { maxUses: -3 }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        service.create('owner-1', 'moim-A', { maxUses: 1.5 }),
      ).rejects.toMatchObject({ status: 400 });
      expect(tables.invite.size).toBe(0);
    });

    it('expiresAt 형식이 올바르지 않으면 400 + 초대 미생성', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');

      await expect(
        service.create('owner-1', 'moim-A', { expiresAt: 'not-a-date' }),
      ).rejects.toMatchObject({ status: 400 });
      expect(tables.invite.size).toBe(0);
    });
  });

  // ── T-003: list() — owner 전용(live 토큰 응답) ──
  describe('list() (REQ-INV-002 / AC-6, REQ-INV-004 / AC-5b)', () => {
    it('owner가 조회하면 해당 모임의 초대 목록(상태 포함)을 반환한다', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');
      seedInvite({ moimId: 'moim-A', token: 't1' });
      seedInvite({ moimId: 'moim-A', token: 't2', revokedAt: NOW });
      seedInvite({ moimId: 'moim-B', token: 't3' }); // 다른 모임 — 제외

      const invites = await service.list('owner-1', 'moim-A');

      const tokens = invites.map((i) => i.token).sort();
      expect(tokens).toEqual(['t1', 't2']);
    });

    it('비-owner가 조회를 시도하면 403(토큰 유출 방지)', async () => {
      const { service } = makeService();
      seedInvite({ moimId: 'moim-A', token: 't1' });

      await expect(service.list('stranger', 'moim-A')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ── T-003: revoke() — owner 전용 ──
  describe('revoke() (REQ-INV-003 / AC-4, REQ-INV-004 / AC-5c)', () => {
    it('owner가 폐기하면 revokedAt가 설정된다', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');
      const invite = seedInvite({ moimId: 'moim-A' });

      const revoked = await service.revoke('owner-1', 'moim-A', invite.id);

      expect(revoked.revokedAt).not.toBeNull();
      expect(tables.invite.get(invite.id)?.revokedAt).not.toBeNull();
    });

    it('비-owner가 폐기를 시도하면 403 + 초대 불변', async () => {
      const { service } = makeService();
      const invite = seedInvite({ moimId: 'moim-A' });

      await expect(
        service.revoke('stranger', 'moim-A', invite.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.invite.get(invite.id)?.revokedAt).toBeNull();
    });

    it('다른 모임의 초대를 폐기하려 하면 404(모임-초대 불일치)', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');
      const invite = seedInvite({ moimId: 'moim-B' }); // moim-B 소속

      await expect(
        service.revoke('owner-1', 'moim-A', invite.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('존재하지 않는 초대를 폐기하려 하면 404', async () => {
      const { service } = makeService();
      setOwner('moim-A', 'owner-1');

      await expect(
        service.revoke('owner-1', 'moim-A', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── T-004: accept() happy path — 멤버십 생성 + usedCount 원자 증가 ──
  describe('accept() happy path (REQ-INV-005 / AC-2)', () => {
    it('유효 토큰 + nickname으로 수락하면 member 멤버십 생성 + usedCount 1 증가 + moimId 반환', async () => {
      const { service } = makeService();
      const invite = seedInvite({ moimId: 'moim-A', token: 'good' });

      const result = await service.accept('guest-1', 'good', '게스트1');

      expect(result.moimId).toBe('moim-A');
      const member = tables.member.get(memberKey('moim-A', 'guest-1'));
      expect(member?.role).toBe('member');
      expect(member?.nickname).toBe('게스트1');
      expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
    });

    it('maxUses 여유가 있으면 usedCount가 한도 미만에서 증가한다', async () => {
      const { service } = makeService();
      const invite = seedInvite({
        moimId: 'moim-A',
        token: 'cap',
        maxUses: 3,
        usedCount: 1,
      });

      await service.accept('guest-1', 'cap', '게스트1');

      expect(tables.invite.get(invite.id)?.usedCount).toBe(2);
    });

    it('nickname이 빈 문자열/공백이면 400 + 멤버십 미생성 + usedCount 불변', async () => {
      const { service } = makeService();
      const invite = seedInvite({ moimId: 'moim-A', token: 'good' });

      await expect(
        service.accept('guest-1', 'good', '   '),
      ).rejects.toMatchObject({ status: 400 });
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false);
      expect(tables.invite.get(invite.id)?.usedCount).toBe(0);
    });
  });

  // ── T-005: accept() invalid token — 고정 코드 404/410/409, 부작용 없음 ──
  describe('accept() invalid token (REQ-INV-006 / AC-3)', () => {
    it('(a) 미지 토큰 → 404 + 멤버십 미생성', async () => {
      const { service } = makeService();

      await expect(
        service.accept('guest-1', 'unknown', '게스트1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tables.member.size).toBe(0);
    });

    it('(b) 만료 토큰 → 410 + usedCount 불변', async () => {
      const { service } = makeService();
      const invite = seedInvite({
        moimId: 'moim-A',
        token: 'expired',
        expiresAt: new Date(NOW.getTime() - DAY_MS), // 과거
      });

      await expect(
        service.accept('guest-1', 'expired', '게스트1'),
      ).rejects.toBeInstanceOf(GoneException);
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false);
      expect(tables.invite.get(invite.id)?.usedCount).toBe(0);
    });

    it('(c) 폐기 토큰 → 410 + usedCount 불변', async () => {
      const { service } = makeService();
      const invite = seedInvite({
        moimId: 'moim-A',
        token: 'revoked',
        revokedAt: NOW,
      });

      await expect(
        service.accept('guest-1', 'revoked', '게스트1'),
      ).rejects.toBeInstanceOf(GoneException);
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false);
      expect(tables.invite.get(invite.id)?.usedCount).toBe(0);
    });

    it('(d) max_uses 초과 토큰 → 409 + usedCount 불변', async () => {
      const { service } = makeService();
      const invite = seedInvite({
        moimId: 'moim-A',
        token: 'exhausted',
        maxUses: 2,
        usedCount: 2, // 이미 한도 도달
      });

      await expect(
        service.accept('guest-1', 'exhausted', '게스트1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false);
      expect(tables.invite.get(invite.id)?.usedCount).toBe(2);
    });
  });

  // ── T-006: accept() 멱등 — 이미 멤버의 재수락 ──
  describe('accept() idempotent (REQ-INV-005 / AC-7)', () => {
    it('이미 멤버인 사용자가 재수락하면 중복 미생성 + usedCount 불변 + 200', async () => {
      const { service } = makeService();
      const invite = seedInvite({ moimId: 'moim-A', token: 'good' });
      // 1차 수락: 멤버십 생성 + usedCount 1.
      await service.accept('guest-1', 'good', '게스트1');
      expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
      // 복합 PK (moimId,userId)라 멤버십은 정확히 1개여야 한다(중복 없음).
      const memberCount = tables.member.size;

      // 2차 수락(재호출): 멱등 — 멤버십 추가 생성 없음, usedCount 그대로.
      const result = await service.accept('guest-1', 'good', '게스트1');

      expect(result.moimId).toBe('moim-A');
      expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
      expect(tables.member.size).toBe(memberCount);
    });

    it('이미 멤버면 maxUses가 소진된 초대로 재수락해도 409가 아니라 200', async () => {
      const { service } = makeService();
      const invite = seedInvite({
        moimId: 'moim-A',
        token: 'cap1',
        maxUses: 1,
        usedCount: 0,
      });
      // 1차 수락: usedCount 0 → 1(한도 소진).
      await service.accept('guest-1', 'cap1', '게스트1');
      expect(tables.invite.get(invite.id)?.usedCount).toBe(1);

      // 같은 멤버 재수락: 멱등 선검사가 usedCount 검사보다 먼저 → 409 아님, usedCount 불변.
      const result = await service.accept('guest-1', 'cap1', '게스트1');

      expect(result.moimId).toBe('moim-A');
      expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
    });
  });

  // ── T-005 경계: 동시 수락 경합 — 선검사 통과 후 updateMany count=0 → 409 롤백 (AC-3d 경계 동시성) ──
  describe('accept() 동시성 경계 (REQ-INV-006 / AC-3d, acceptance 엣지)', () => {
    it('선검사는 통과했으나 동시 수락이 먼저 한도를 채우면(updateMany count=0) 409', async () => {
      const { service, prisma } = makeService();
      // 선검사 시점엔 usedCount(0) < maxUses(1)로 통과하지만, 증가 시점엔 경합으로 소진된 상황을 흉내낸다.
      seedInvite({ moimId: 'moim-A', token: 'race', maxUses: 1, usedCount: 0 });
      (prisma.moimInvite.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.accept('guest-1', 'race', '게스트1'),
      ).rejects.toBeInstanceOf(ConflictException);
      // 강화된 fake $transaction이 예외 시 롤백을 흉내내므로: usedCount 불변 + tentative 멤버십도 롤백되어
      // 잔존하지 않아야 한다(원자성 불변식을 단위에서 증명).
      expect(tables.invite.get('invite-1')?.usedCount).toBe(0);
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false);
    });

    it('동시 same-sub 수락 경합: 두 번째 create가 P2002(복합 PK 중복)이면 멱등 성공(200, usedCount 불변)', async () => {
      const { service, prisma } = makeService();
      const invite = seedInvite({ moimId: 'moim-A', token: 'dup' });
      // 멱등 선검사를 통과한 직후(아직 멤버 row 없음) 두 번째 동시 요청의 create가 던지는 P2002를 흉내낸다.
      (prisma.moimMember.create as jest.Mock).mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      const result = await service.accept('guest-1', 'dup', '게스트1');

      // 멱등 성공: 원본 모임 id 반환 + usedCount 미증가(중복은 슬롯 소비 아님 — updateMany가 증가시키지
      // 못했음을 상태로 증명, unbound-method 회피).
      expect(result.moimId).toBe('moim-A');
      expect(tables.invite.get(invite.id)?.usedCount).toBe(0);
    });

    it('create가 P2002가 아닌 에러를 던지면 그대로 전파한다(멱등 처리 아님)', async () => {
      const { service, prisma } = makeService();
      seedInvite({ moimId: 'moim-A', token: 'boom' });
      (prisma.moimMember.create as jest.Mock).mockRejectedValueOnce(
        new Error('DB connection lost'),
      );

      await expect(
        service.accept('guest-1', 'boom', '게스트1'),
      ).rejects.toThrow('DB connection lost');
    });
  });

  // ── SPEC-MOIM-012: accept() 모임 정원 cap 검사 ──
  describe('accept() 모임 정원 cap (SPEC-MOIM-012 REQ-MOIM12-001)', () => {
    it('현재 멤버 수가 maxMembers 미만이면 정상 가입된다(under-cap)', async () => {
      const { service } = makeService();
      // 정원 3, 현재 멤버 2명 → guest-1 가입 가능
      seedMoim('moim-A', 3);
      seedInvite({ moimId: 'moim-A', token: 'cap-ok' });
      tables.member.set(memberKey('moim-A', 'member-1'), {
        moimId: 'moim-A',
        userId: 'member-1',
        nickname: 'm1',
        role: 'member',
        joinedAt: NOW,
      });
      tables.member.set(memberKey('moim-A', 'member-2'), {
        moimId: 'moim-A',
        userId: 'member-2',
        nickname: 'm2',
        role: 'owner',
        joinedAt: NOW,
      });

      const result = await service.accept('guest-1', 'cap-ok', '게스트1');

      expect(result.moimId).toBe('moim-A');
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(true);
    });

    it('현재 멤버 수가 maxMembers 이상이면 409(정원 초과) + 멤버십 미생성', async () => {
      const { service } = makeService();
      // 정원 2, 현재 멤버 2명 → guest-1 가입 불가
      seedMoim('moim-A', 2);
      seedInvite({ moimId: 'moim-A', token: 'cap-full' });
      tables.member.set(memberKey('moim-A', 'member-1'), {
        moimId: 'moim-A',
        userId: 'member-1',
        nickname: 'm1',
        role: 'member',
        joinedAt: NOW,
      });
      tables.member.set(memberKey('moim-A', 'member-2'), {
        moimId: 'moim-A',
        userId: 'member-2',
        nickname: 'm2',
        role: 'owner',
        joinedAt: NOW,
      });

      await expect(
        service.accept('guest-1', 'cap-full', '게스트1'),
      ).rejects.toBeInstanceOf(ConflictException);
      // 멤버십이 생성되지 않는다.
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(false);
    });

    it('이미 멤버인 사용자는 정원이 가득 찼어도 재수락 시 200(멱등 — cap 체크 제외)', async () => {
      const { service } = makeService();
      // 정원 1, 현재 멤버 1명(= guest-1 자신)이 이미 멤버
      seedMoim('moim-A', 1);
      const invite = seedInvite({ moimId: 'moim-A', token: 'cap-existing' });
      // guest-1을 이미 멤버로 시드
      tables.member.set(memberKey('moim-A', 'guest-1'), {
        moimId: 'moim-A',
        userId: 'guest-1',
        nickname: '게스트1',
        role: 'member',
        joinedAt: NOW,
      });

      // 이미 멤버이므로 멱등 early return → cap 검사 안 함 → 200
      const result = await service.accept('guest-1', 'cap-existing', '게스트1');

      expect(result.moimId).toBe('moim-A');
      // usedCount 불변, 멤버십 추가 없음
      expect(tables.invite.get(invite.id)?.usedCount).toBe(0);
      expect(tables.member.size).toBe(1);
    });

    it('모임이 없는 경우(invite.moimId로 moim 조회 null) 정원 초과 없이 가입 진행', async () => {
      const { service } = makeService();
      // 모임을 moim 맵에 시드하지 않음 → findUnique null → cap 검사 생략
      seedInvite({ moimId: 'moim-B', token: 'no-moim' });

      // moim이 없어도 가입 진행된다(DB 무결성은 FK가 보장, 서비스 레이어에서는 cap skip)
      const result = await service.accept('guest-1', 'no-moim', '게스트1');

      expect(result.moimId).toBe('moim-B');
    });
  });

  // ── SPEC-NOTIFICATIONS-001 M1: accept() 이벤트 발행 — 신규 멤버십 성공 경로만 emit ──
  describe('accept() moim.member.joined 발행 (SPEC-NOTIFICATIONS-001 M1)', () => {
    it('신규 멤버십 성공 시 정확히 1회 발행한다(payload = {moimId, actorId=가입자 sub})', async () => {
      const { service, emit } = makeService();
      seedInvite({ moimId: 'moim-A', token: 'good' });

      await service.accept('guest-1', 'good', '게스트1');

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_MEMBER_JOINED, {
        moimId: 'moim-A',
        actorId: 'guest-1',
      });
    });

    it('이미 멤버(멱등 재수락) 경로는 발행하지 않는다', async () => {
      const { service, emit } = makeService();
      seedInvite({ moimId: 'moim-A', token: 'good' });
      // 1차 수락(신규) → 1회 발행. 이후 카운트를 초기화하고 재수락이 0회임을 검증한다.
      await service.accept('guest-1', 'good', '게스트1');
      expect(emit).toHaveBeenCalledTimes(1);
      emit.mockClear();

      // 2차(이미 멤버) → early return, 발행 없음.
      await service.accept('guest-1', 'good', '게스트1');

      expect(emit).not.toHaveBeenCalled();
    });

    it('동시 same-sub 경합(create P2002 → 멱등 성공) 경로는 발행하지 않는다', async () => {
      const { service, prisma, emit } = makeService();
      seedInvite({ moimId: 'moim-A', token: 'dup' });
      // 멱등 선검사 통과 직후 두 번째 동시 요청의 create 가 P2002 로 던지는 상황(멱등 성공, 멤버십 미생성).
      (prisma.moimMember.create as jest.Mock).mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await service.accept('guest-1', 'dup', '게스트1');

      // 경합 멱등 성공은 신규 멤버십 아님 → 발행 금지(중복/유령 발행 방지).
      expect(emit).not.toHaveBeenCalled();
    });

    it('한도 초과 경합(updateMany count=0 → 409 롤백) 경로는 발행하지 않는다', async () => {
      const { service, prisma, emit } = makeService();
      seedInvite({ moimId: 'moim-A', token: 'race', maxUses: 1, usedCount: 0 });
      // 선검사는 통과하지만 증가 시점에 경합으로 소진되어 count=0 → 409 로 롤백되는 상황.
      (prisma.moimInvite.updateMany as jest.Mock).mockResolvedValueOnce({
        count: 0,
      });

      await expect(
        service.accept('guest-1', 'race', '게스트1'),
      ).rejects.toBeInstanceOf(ConflictException);

      // 트랜잭션 롤백 경로 → 멤버십 미생성 → 발행 금지.
      expect(emit).not.toHaveBeenCalled();
    });

    it('유효하지 않은 토큰(404/410/409) 경로는 발행하지 않는다', async () => {
      const { service, emit } = makeService();
      seedInvite({
        moimId: 'moim-A',
        token: 'expired',
        expiresAt: new Date(NOW.getTime() - DAY_MS),
      });

      // 미지 토큰(404)
      await expect(
        service.accept('guest-1', 'unknown', '게스트1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      // 만료 토큰(410)
      await expect(
        service.accept('guest-1', 'expired', '게스트1'),
      ).rejects.toBeInstanceOf(GoneException);

      expect(emit).not.toHaveBeenCalled();
    });

    it('발행(emit)이 throw 해도 가입 성공을 무효화하지 않는다(best-effort 격리)', async () => {
      const { service, emit } = makeService();
      seedInvite({ moimId: 'moim-A', token: 'good' });
      // 동기 리스너 예외를 흉내: emit 이 던져도 accept 는 성공 결과를 반환해야 한다.
      emit.mockImplementationOnce(() => {
        throw new Error('listener boom');
      });

      const result = await service.accept('guest-1', 'good', '게스트1');

      // 저장은 성립(usedCount 증가) + 예외 미전파.
      expect(result.moimId).toBe('moim-A');
      expect(tables.member.has(memberKey('moim-A', 'guest-1'))).toBe(true);
      expect(emit).toHaveBeenCalledTimes(1);
    });
  });
});
