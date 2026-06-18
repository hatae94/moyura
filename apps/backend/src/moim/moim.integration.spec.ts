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
import type { Moim, MoimMember } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 모임 통합 테스트(SPEC-MOIM-001). 실제 Nest app + 실제 가드 배선 + 실제 MoimService/MoimController.
// TokenVerifierService는 로컬-JWKS로, PrismaService는 인메모리 fake로 오버라이드한다(me.controller.spec.ts 패턴).
//   - 토큰 검증 경로는 라이브 GoTrue 의존 없이 결정적(forged ES256).
//   - DB는 Prisma 7 WASM 컴파일러가 jest VM에서 동작하지 않으므로 fake로 대체 — Cascade/복합 PK 흉내.
// 이 스펙은 "전 라우트 가드 적용(401, AC-3) + 인증된 비멤버/비owner/owner-leave 구분(403) + 부재 404"를 증명한다.

interface Tables {
  moim: Map<string, Moim>;
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
}

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

describe('/moims (통합 — 가드 배선 + 멤버십 인가 401/403/404)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;
  let tables: Tables;
  let seq: number;

  function resetStore(): void {
    tables = { moim: new Map(), member: new Map() };
    seq = 0;
  }

  function seedMoimWithOwner(
    moimId: string,
    ownerSub: string,
    extraMembers: { userId: string; nickname: string }[] = [],
    // SPEC-MOIM-004 AC-3: 일정/장소를 선택적으로 시드한다(값 있는 모임 vs null 모임 혼합 검증).
    event: { startsAt?: Date; location?: string } = {},
  ): void {
    tables.moim.set(moimId, {
      id: moimId,
      name: `모임 ${moimId}`,
      startsAt: event.startsAt ?? null,
      location: event.location ?? null,
      createdBy: ownerSub,
      createdAt: new Date('2026-06-13T00:00:00.000Z'),
    });
    tables.member.set(memberKey(moimId, ownerSub), {
      moimId,
      userId: ownerSub,
      nickname: '호스트',
      role: 'owner',
      joinedAt: new Date('2026-06-13T00:00:00.000Z'),
    });
    for (const m of extraMembers) {
      tables.member.set(memberKey(moimId, m.userId), {
        moimId,
        userId: m.userId,
        nickname: m.nickname,
        role: 'member',
        joinedAt: new Date('2026-06-13T00:00:00.000Z'),
      });
    }
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

    const fakePrisma = {
      $transaction: jest.fn(
        // 인터랙티브 콜백 형태만 지원(createMoim).
        (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            moim: {
              // SPEC-MOIM-004: data 에 optional startsAt/location 을 포함한다.
              create: jest.fn(
                (arg: {
                  data: {
                    name: string;
                    createdBy: string;
                    startsAt?: Date | null;
                    location?: string | null;
                  };
                }) => {
                  seq += 1;
                  const created: Moim = {
                    id: `moim-${seq}`,
                    name: arg.data.name,
                    startsAt: arg.data.startsAt ?? null,
                    location: arg.data.location ?? null,
                    createdBy: arg.data.createdBy,
                    createdAt: new Date('2026-06-13T00:00:00.000Z'),
                  };
                  tables.moim.set(created.id, created);
                  return Promise.resolve(created);
                },
              ),
            },
            moimMember: {
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
                    joinedAt: new Date('2026-06-13T00:00:00.000Z'),
                  };
                  tables.member.set(
                    memberKey(created.moimId, created.userId),
                    created,
                  );
                  return Promise.resolve(created);
                },
              ),
            },
          }),
      ),
      moim: {
        findUnique: jest.fn((arg: { where: { id: string } }) =>
          Promise.resolve(tables.moim.get(arg.where.id) ?? null),
        ),
        findMany: jest.fn((arg: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            arg.where.id.in
              .map((id) => tables.moim.get(id))
              .filter((m): m is Moim => m !== undefined),
          ),
        ),
        delete: jest.fn((arg: { where: { id: string } }) => {
          const existing = tables.moim.get(arg.where.id) ?? null;
          tables.moim.delete(arg.where.id);
          for (const key of [...tables.member.keys()]) {
            if (key.startsWith(`${arg.where.id}:`)) {
              tables.member.delete(key);
            }
          }
          return Promise.resolve(existing);
        }),
      },
      moimMember: {
        findUnique: jest.fn(
          (arg: {
            where: { moimId_userId: { moimId: string; userId: string } };
          }) => Promise.resolve(findMember(arg.where)),
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
        delete: jest.fn(
          (arg: {
            where: { moimId_userId: { moimId: string; userId: string } };
          }) => {
            const existing = findMember(arg.where);
            tables.member.delete(
              memberKey(
                arg.where.moimId_userId.moimId,
                arg.where.moimId_userId.userId,
              ),
            );
            return Promise.resolve(existing);
          },
        ),
      },
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

  // ── AC-3: 미인증 401 (전 라우트, 파라미터라이즈드, 부작용 없음) ──
  describe('AC-3 — 토큰 없이 전 라우트 401 (REQ-MOIM-001)', () => {
    const routes: { method: 'get' | 'post' | 'delete'; path: string }[] = [
      { method: 'post', path: '/moims' },
      { method: 'get', path: '/moims' },
      { method: 'get', path: '/moims/moim-x' },
      { method: 'get', path: '/moims/moim-x/members' },
      { method: 'delete', path: '/moims/moim-x' },
      { method: 'delete', path: '/moims/moim-x/membership' },
    ];

    it.each(routes)('$method $path → 401', async ({ method, path }) => {
      seedMoimWithOwner('moim-x', uniqueSub());
      const before = tables.moim.size + tables.member.size;

      await request(app.getHttpServer())[method](path).expect(401);

      // 부작용 없음: 가드가 핸들러 진입 전에 차단.
      expect(tables.moim.size + tables.member.size).toBe(before);
    });
  });

  // ── AC-1: 모임 생성 201 + owner 멤버십 ──
  it('AC-1: POST /moims → 201 + owner 멤버십(host nickname)', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .post('/moims')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '주말 모임', nickname: '호스트' })
      .expect(201);

    const created = res.body as {
      id: string;
      name: string;
      createdBy: string;
      startsAt: string | null;
      location: string | null;
    };
    expect(created.name).toBe('주말 모임');
    expect(created.createdBy).toBe(sub);
    // 일정/장소 미포함 → null (SPEC-MOIM-004 AC-2).
    expect(created.startsAt).toBeNull();
    expect(created.location).toBeNull();
    const owner = tables.member.get(memberKey(created.id, sub));
    expect(owner?.role).toBe('owner');
    expect(owner?.nickname).toBe('호스트');
  });

  // ── SPEC-MOIM-004 AC-2: 일정/장소 포함 생성 201 + 두 필드 영속 ──
  it('AC-2: POST /moims (startsAt+location) → 201 + 두 필드 영속/직렬화', async () => {
    const sub = uniqueSub();
    const token = await tokenFor(sub);

    const res = await request(app.getHttpServer())
      .post('/moims')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: '이벤트 모임',
        nickname: '호스트',
        startsAt: '2026-07-01T10:00:00.000Z',
        location: '강남역 스타벅스',
      })
      .expect(201);

    const created = res.body as { startsAt: string | null; location: string | null };
    expect(created.startsAt).toBe('2026-07-01T10:00:00.000Z');
    expect(created.location).toBe('강남역 스타벅스');
  });

  // ── SPEC-MOIM-004 AC-2(Unwanted): 무효 startsAt → 400 ──
  it('AC-2: POST /moims (무효 startsAt) → 400', async () => {
    const token = await tokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/moims')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '모임', nickname: '호스트', startsAt: 'not-a-date' })
      .expect(400);
  });

  // ── SPEC-MOIM-004 AC-3: 목록/상세 응답에 일정/장소 포함(값 있는 모임 + null 모임 혼합) ──
  it('AC-3: GET /moims·GET /moims/:id 응답에 startsAt/location 포함(값/null 혼합)', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-EVT', ownerSub, [], {
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      location: '강남역 스타벅스',
    });
    seedMoimWithOwner('moim-NIL', ownerSub); // 일정/장소 없는 모임
    const token = await tokenFor(ownerSub);

    // 목록: 두 모임 모두 두 필드를 정확히 포함한다.
    const list = await request(app.getHttpServer())
      .get('/moims')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const byId = new Map(
      (list.body as { id: string; startsAt: string | null; location: string | null }[]).map(
        (m) => [m.id, m],
      ),
    );
    expect(byId.get('moim-EVT')?.startsAt).toBe('2026-07-01T10:00:00.000Z');
    expect(byId.get('moim-EVT')?.location).toBe('강남역 스타벅스');
    expect(byId.get('moim-NIL')?.startsAt).toBeNull();
    expect(byId.get('moim-NIL')?.location).toBeNull();

    // 상세: 값 있는 모임도 정확히 포함한다.
    const detail = await request(app.getHttpServer())
      .get('/moims/moim-EVT')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const one = detail.body as { startsAt: string | null; location: string | null };
    expect(one.startsAt).toBe('2026-07-01T10:00:00.000Z');
    expect(one.location).toBe('강남역 스타벅스');
  });

  // ── AC-edge: 빈/누락 nickname·name → 400 ──
  it('AC-edge: nickname 빈 문자열 → 400', async () => {
    const token = await tokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/moims')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '모임', nickname: '   ' })
      .expect(400);
  });

  it('AC-edge: name 누락 → 400', async () => {
    const token = await tokenFor(uniqueSub());
    await request(app.getHttpServer())
      .post('/moims')
      .set('Authorization', `Bearer ${token}`)
      .send({ nickname: '호스트' })
      .expect(400);
  });

  // ── AC-2: 인증된 비멤버 단건/멤버 조회 403 (401 아님) ──
  it('AC-2: 비멤버의 GET /moims/:id → 403', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .get('/moims/moim-A')
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  it('AC-2: 비멤버의 GET /moims/:id/members → 403', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .get('/moims/moim-A/members')
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });

  // ── AC-6: 멤버 단건/목록 조회 ──
  it('AC-6: 멤버의 GET /moims/:id → 200 + 모임 정보, GET /moims → 자신이 속한 모임만', async () => {
    const ownerSub = uniqueSub();
    const memberSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub, [
      { userId: memberSub, nickname: '참가자1' },
    ]);
    seedMoimWithOwner('moim-B', memberSub); // memberSub가 owner인 별도 모임
    seedMoimWithOwner('moim-C', uniqueSub()); // memberSub 비소속
    const token = await tokenFor(memberSub);

    const one = await request(app.getHttpServer())
      .get('/moims/moim-A')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((one.body as { id: string }).id).toBe('moim-A');

    const list = await request(app.getHttpServer())
      .get('/moims')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const ids = (list.body as { id: string }[]).map((m) => m.id).sort();
    expect(ids).toEqual(['moim-A', 'moim-B']);
  });

  // ── AC-5: 멤버 목록 nickname 포함 ──
  it('AC-5: GET /moims/:id/members → 200 + 각 멤버 nickname', async () => {
    const ownerSub = uniqueSub();
    const memberSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub, [
      { userId: memberSub, nickname: '참가자1' },
    ]);
    const token = await tokenFor(ownerSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const nicknames = (res.body as { nickname: string }[])
      .map((m) => m.nickname)
      .sort();
    expect(nicknames).toEqual(['참가자1', '호스트']);
  });

  // ── 엣지: 존재하지 않는 모임 조회 404 ──
  it('엣지: GET /moims/:id (없는 모임) → 404', async () => {
    const token = await tokenFor(uniqueSub());
    await request(app.getHttpServer())
      .get('/moims/missing')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // ── AC-4: 일반 멤버 탈퇴 204 ──
  it('AC-4: 멤버의 DELETE /moims/:id/membership → 204 + 해당 멤버십만 제거', async () => {
    const ownerSub = uniqueSub();
    const memberSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub, [
      { userId: memberSub, nickname: '참가자1' },
    ]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .delete('/moims/moim-A/membership')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(tables.member.has(memberKey('moim-A', memberSub))).toBe(false);
    expect(tables.member.has(memberKey('moim-A', ownerSub))).toBe(true);
  });

  // ── AC-8: owner 탈퇴 403 + 멤버십 불변 ──
  it('AC-8: owner의 DELETE /moims/:id/membership → 403 + owner 멤버십 불변', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const token = await tokenFor(ownerSub);

    await request(app.getHttpServer())
      .delete('/moims/moim-A/membership')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(tables.member.has(memberKey('moim-A', ownerSub))).toBe(true);
  });

  // ── 엣지: 비멤버 탈퇴 404 ──
  it('엣지: 비멤버의 DELETE /moims/:id/membership → 404 (멤버십 부재)', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub);
    const token = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .delete('/moims/moim-A/membership')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // ── AC-7: owner 전용 삭제 (비-owner 403, owner 204 + Cascade) ──
  it('AC-7: 비-owner 멤버의 DELETE /moims/:id → 403 + 모임 불변', async () => {
    const ownerSub = uniqueSub();
    const memberSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub, [
      { userId: memberSub, nickname: '참가자1' },
    ]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .delete('/moims/moim-A')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    expect(tables.moim.has('moim-A')).toBe(true);
  });

  it('AC-7: owner의 DELETE /moims/:id → 204 + 모임 및 멤버십 Cascade 삭제', async () => {
    const ownerSub = uniqueSub();
    const memberSub = uniqueSub();
    seedMoimWithOwner('moim-A', ownerSub, [
      { userId: memberSub, nickname: '참가자1' },
    ]);
    const token = await tokenFor(ownerSub);

    await request(app.getHttpServer())
      .delete('/moims/moim-A')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    expect(tables.moim.has('moim-A')).toBe(false);
    expect(tables.member.has(memberKey('moim-A', ownerSub))).toBe(false);
    expect(tables.member.has(memberKey('moim-A', memberSub))).toBe(false);
  });

  // ── 엣지: 없는 모임 삭제 404 ──
  it('엣지: DELETE /moims/:id (없는 모임) → 404', async () => {
    const token = await tokenFor(uniqueSub());
    await request(app.getHttpServer())
      .delete('/moims/missing')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
