import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../app.module';
import {
  TEST_AUDIENCE,
  TEST_HS256_SECRET,
  TEST_ISSUER,
  type TestKeys,
  generateEs256Keys,
  makeLocalJwks,
  signEs256,
} from '../auth/test-tokens.helper';
import { TokenVerifierService } from '../auth/token-verifier.service';
import type { Moim, MoimInvite, MoimMember } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 초대 통합 테스트(SPEC-MOIM-002). 실제 Nest app + 실제 가드 배선 + 실제 InviteService/MoimService/컨트롤러.
// TokenVerifierService는 로컬-JWKS로, PrismaService는 인메모리 fake로 오버라이드(moim.integration.spec.ts 패턴 확장).
// 증명: 전 라우트 401 / owner 관리 라우트 403(비-owner) / 수락 고정 코드(404/410/409) / 멱등(usedCount 불변) /
//       익명 sub도 가드를 동일 통과(REQ-INV-007 전제 — anonymous sub passes guard identically).

interface Tables {
  moim: Map<string, Moim>;
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
  invite: Map<string, MoimInvite>; // key: invite.id
}

const NOW = new Date('2026-06-14T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

describe('/invites + /moims/:id/invites (통합 — 가드 + owner 인가 + 수락 고정 코드)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;
  let tables: Tables;
  let inviteSeq: number;

  function resetStore(): void {
    tables = { moim: new Map(), member: new Map(), invite: new Map() };
    inviteSeq = 0;
  }

  function seedMoimWithOwner(moimId: string, ownerSub: string): void {
    tables.moim.set(moimId, {
      id: moimId,
      name: `모임 ${moimId}`,
      // SPEC-MOIM-004: Moim 에 추가된 nullable 이벤트 필드(초대 테스트와 무관 — null).
      startsAt: null,
      location: null,
      maxMembers: 15,
      createdBy: ownerSub,
      createdAt: NOW,
      budget: null,
    });
    tables.member.set(memberKey(moimId, ownerSub), {
      moimId,
      userId: ownerSub,
      nickname: '호스트',
      role: 'owner',
      joinedAt: NOW,
    });
  }

  function addMember(moimId: string, sub: string, nickname = '참가자'): void {
    tables.member.set(memberKey(moimId, sub), {
      moimId,
      userId: sub,
      nickname,
      role: 'member',
      joinedAt: NOW,
    });
  }

  function seedInvite(
    partial: Partial<MoimInvite> & { moimId: string; token: string },
  ): MoimInvite {
    inviteSeq += 1;
    const invite: MoimInvite = {
      id: partial.id ?? `invite-${inviteSeq}`,
      moimId: partial.moimId,
      token: partial.token,
      expiresAt: partial.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
      maxUses: partial.maxUses ?? null,
      usedCount: partial.usedCount ?? 0,
      revokedAt: partial.revokedAt ?? null,
      createdBy: partial.createdBy ?? 'owner-sub',
      createdAt: partial.createdAt ?? NOW,
    };
    tables.invite.set(invite.id, invite);
    return invite;
  }

  beforeAll(async () => {
    keys = await generateEs256Keys();
    resetStore();

    const findMember = (where: {
      moimId_userId: { moimId: string; userId: string };
    }): MoimMember | null =>
      tables.member.get(
        memberKey(where.moimId_userId.moimId, where.moimId_userId.userId),
      ) ?? null;

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
        }) => Promise.resolve(findMember(arg.where)),
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
      findMany: jest.fn(
        (arg: { where: { userId?: string; moimId?: string } }) =>
          Promise.resolve(
            [...tables.member.values()].filter((m) =>
              arg.where.userId !== undefined
                ? m.userId === arg.where.userId
                : m.moimId === arg.where.moimId,
            ),
          ),
      ),
      // SPEC-MOIM-012: cap 검사를 위한 현재 멤버 수 조회.
      count: jest.fn((arg: { where: { moimId: string } }) =>
        Promise.resolve(
          [...tables.member.values()].filter(
            (m) => m.moimId === arg.where.moimId,
          ).length,
        ),
      ),
    };

    const fakePrisma = {
      moim: {
        findUnique: jest.fn((arg: { where: { id: string } }) =>
          Promise.resolve(tables.moim.get(arg.where.id) ?? null),
        ),
      },
      moimMember,
      moimInvite,
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
        cb({ moimInvite, moimMember }),
      ),
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
      pingDatabase: jest.fn().mockResolvedValue(true),
    } as unknown as PrismaService;

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(TokenVerifierService)
      .useFactory({
        factory: () => {
          const verifier = new TokenVerifierService({} as never);
          verifier.configureForTest(
            {
              jwksUrl: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
              issuer: TEST_ISSUER,
              audience: TEST_AUDIENCE,
              jwtSecret: TEST_HS256_SECRET,
            },
            makeLocalJwks(keys.publicJwk),
          );
          return verifier;
        },
      })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetStore();
  });

  let subSeq = 0;
  function uniqueSub(): string {
    subSeq += 1;
    return `00000000-0000-4000-8000-${subSeq.toString(16).padStart(12, '0')}`;
  }
  async function tokenFor(sub: string): Promise<string> {
    return signEs256(keys.privateKey, { sub });
  }
  // 익명 로그인 sub는 is_anonymous 클레임만 다를 뿐 검증 가능한 JWT다(role=authenticated 동일) → 가드를
  // 일반 사용자와 똑같이 통과한다. 여기서는 다른 sub만 부여해 "익명도 동일 경로"를 증명한다(REQ-INV-007 전제).
  async function anonTokenFor(sub: string): Promise<string> {
    return signEs256(keys.privateKey, { sub });
  }

  // ── 전 라우트 401 (토큰 없음, 부작용 없음) ──
  describe('전 라우트 401 (REQ-INV — 가드 선처리)', () => {
    const routes: { method: 'get' | 'post' | 'delete'; path: string }[] = [
      { method: 'post', path: '/moims/moim-x/invites' },
      { method: 'get', path: '/moims/moim-x/invites' },
      { method: 'delete', path: '/moims/moim-x/invites/invite-x' },
      { method: 'post', path: '/invites/tok-x/accept' },
    ];

    it.each(routes)('$method $path → 401', async ({ method, path }) => {
      seedMoimWithOwner('moim-x', uniqueSub());
      seedInvite({ moimId: 'moim-x', token: 'tok-x', id: 'invite-x' });
      const before = tables.invite.size + tables.member.size;

      await request(app.getHttpServer())[method](path).expect(401);

      expect(tables.invite.size + tables.member.size).toBe(before);
    });
  });

  // ── AC-1: owner 발급 201 ──
  it('AC-1: owner POST /moims/:id/invites → 201 + token·usedCount=0', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const token = await tokenFor(ownerSub);

    const res = await request(app.getHttpServer())
      .post('/moims/moim-A/invites')
      .set('Authorization', `Bearer ${token}`)
      .send({ maxUses: 5 })
      .expect(201);

    const body = res.body as {
      token: string;
      usedCount: number;
      maxUses: number;
    };
    expect(body.token.length).toBeGreaterThanOrEqual(43);
    expect(body.usedCount).toBe(0);
    expect(body.maxUses).toBe(5);
  });

  // ── AC-5: 비-owner 관리 라우트 403 (발급/목록/폐기) ──
  describe('AC-5: 비-owner 관리 라우트 403 + 부작용 없음', () => {
    it('(a) 비-owner POST → 403', async () => {
      const ownerSub = uniqueSub();
      const memberSub = uniqueSub();
      seedMoimWithOwner('moim-A', ownerSub);
      addMember('moim-A', memberSub);
      const token = await tokenFor(memberSub);

      await request(app.getHttpServer())
        .post('/moims/moim-A/invites')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(403);
      expect(tables.invite.size).toBe(0);
    });

    it('(b) 비-owner GET → 403 (live 토큰 미노출)', async () => {
      const ownerSub = uniqueSub();
      const memberSub = uniqueSub();
      seedMoimWithOwner('moim-A', ownerSub);
      addMember('moim-A', memberSub);
      seedInvite({ moimId: 'moim-A', token: 'secret' });
      const token = await tokenFor(memberSub);

      await request(app.getHttpServer())
        .get('/moims/moim-A/invites')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('(c) 비-owner DELETE → 403 + 초대 불변', async () => {
      const ownerSub = uniqueSub();
      const memberSub = uniqueSub();
      seedMoimWithOwner('moim-A', ownerSub);
      addMember('moim-A', memberSub);
      const invite = seedInvite({ moimId: 'moim-A', token: 'secret' });
      const token = await tokenFor(memberSub);

      await request(app.getHttpServer())
        .delete(`/moims/moim-A/invites/${invite.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
      expect(tables.invite.get(invite.id)?.revokedAt).toBeNull();
    });
  });

  // ── AC-6: owner 목록 조회 200 ──
  it('AC-6: owner GET /moims/:id/invites → 200 + 목록', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    seedInvite({ moimId: 'moim-A', token: 't1' });
    seedInvite({ moimId: 'moim-A', token: 't2', revokedAt: NOW });
    const token = await tokenFor(ownerSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/invites')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const tokens = (res.body as { token: string }[]).map((i) => i.token).sort();
    expect(tokens).toEqual(['t1', 't2']);
  });

  // ── AC-4: owner 폐기 200 → 이후 수락 410 ──
  it('AC-4: owner DELETE 초대 → 200 + revokedAt 설정', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const invite = seedInvite({ moimId: 'moim-A', token: 'tok-rev' });
    const token = await tokenFor(ownerSub);

    await request(app.getHttpServer())
      .delete(`/moims/moim-A/invites/${invite.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(tables.invite.get(invite.id)?.revokedAt).not.toBeNull();
  });

  // ── AC-2: 익명 sub 수락 200 + 멤버십 + usedCount 증가 ──
  it('AC-2: 익명 sub POST /invites/:token/accept → 200 + member 멤버십 + usedCount 1', async () => {
    const ownerSub = uniqueSub();
    const guestSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const invite = seedInvite({ moimId: 'moim-A', token: 'join-me' });
    const token = await anonTokenFor(guestSub);

    const res = await request(app.getHttpServer())
      .post('/invites/join-me/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(200);

    expect((res.body as { moimId: string }).moimId).toBe('moim-A');
    const member = tables.member.get(memberKey('moim-A', guestSub));
    expect(member?.role).toBe('member');
    expect(member?.nickname).toBe('게스트1');
    expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
  });

  // ── AC-3: 수락 고정 실패 코드 (404/410/409) + usedCount 불변 ──
  it('AC-3a: 미지 토큰 → 404', async () => {
    const token = await anonTokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/invites/unknown/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(404);
  });

  it('AC-3b: 만료 토큰 → 410 + usedCount 불변', async () => {
    seedInvite({
      moimId: 'moim-A',
      token: 'expired',
      expiresAt: new Date(NOW.getTime() - DAY_MS),
    });
    const token = await anonTokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/invites/expired/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(410);
    expect([...tables.invite.values()][0].usedCount).toBe(0);
  });

  it('AC-3c: 폐기 토큰 → 410', async () => {
    seedInvite({ moimId: 'moim-A', token: 'revoked', revokedAt: NOW });
    const token = await anonTokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/invites/revoked/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(410);
  });

  it('AC-3d: max_uses 초과 토큰 → 409 + usedCount 불변', async () => {
    const invite = seedInvite({
      moimId: 'moim-A',
      token: 'full',
      maxUses: 1,
      usedCount: 1,
    });
    const token = await anonTokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/invites/full/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(409);
    expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
  });

  // ── 엣지: nickname 빈 → 400 ──
  it('엣지: nickname 빈 문자열 → 400 + 멤버십 미생성', async () => {
    seedInvite({ moimId: 'moim-A', token: 'good' });
    const guestSub = uniqueSub();
    const token = await anonTokenFor(guestSub);
    await request(app.getHttpServer())
      .post('/invites/good/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '   ' })
      .expect(400);
    expect(tables.member.has(memberKey('moim-A', guestSub))).toBe(false);
  });

  // ── AC-7: 멱등 재수락 — 중복 미생성 + usedCount 불변 ──
  it('AC-7: 이미 멤버 재수락 → 200 + usedCount 불변', async () => {
    const ownerSub = uniqueSub();
    const guestSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const invite = seedInvite({ moimId: 'moim-A', token: 're-accept' });
    const token = await anonTokenFor(guestSub);

    await request(app.getHttpServer())
      .post('/invites/re-accept/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(200);
    expect(tables.invite.get(invite.id)?.usedCount).toBe(1);

    await request(app.getHttpServer())
      .post('/invites/re-accept/accept')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '게스트1' })
      .expect(200);
    expect(tables.invite.get(invite.id)?.usedCount).toBe(1);
  });
});
