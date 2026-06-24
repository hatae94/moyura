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
import type {
  Moim,
  MoimMember,
  Poll,
  PollOption,
  PollVote,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// 투표 통합 테스트(SPEC-MOIM-006 M3 — MOIM-005 확장). 실제 Nest app + 실제 가드 배선 + 실제 PollService/PollController.
// chat/moim integration 패턴을 확장한다: fakePrisma 에 poll/pollOption/pollVote(+moim/moimMember),
// TokenVerifierService 를 로컬-JWKS 로 오버라이드한다. Prisma 7 WASM 이 jest VM 에서 동작하지 않으므로 DB 는 fake.
//   - 전 라우트 가드(401) + 멤버/비멤버(403) + question 빈/옵션<2/잘못 optionId 400.
//   - 단일 선택 재투표 교체(합산 아님 — MOIM-005 회귀 0) end-to-end.
//   - 다중 선택 생성(multiSelect:true) → 토글(추가/제거) → 목록 myVotes/voteCount end-to-end.
//   - 옵션별 voteCount(표 0 포함) + 호출자 myVotes(빈 배열/목록) + multiSelect end-to-end.
// fake vote 테이블은 (pollId,optionId,userId) 복합 PK 를 흉내내 키로 삼는다(새 PK — 멤버당 옵션당 한 표).

interface Tables {
  moim: Map<string, Moim>;
  member: Map<string, MoimMember>; // key: `${moimId}:${userId}`
  poll: Map<string, Poll>;
  option: Map<string, PollOption>;
  vote: Map<string, PollVote>; // key: `${pollId}:${optionId}:${userId}` — 새 복합 PK
}

function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}
function voteKey(pollId: string, optionId: string, userId: string): string {
  return `${pollId}:${optionId}:${userId}`;
}

describe('/moims/:id/polls (통합 — 생성/투표/재투표/집계/인가)', () => {
  let app: INestApplication<App>;
  let keys: TestKeys;
  let tables: Tables;
  let seq: number;

  function resetStore(): void {
    tables = {
      moim: new Map(),
      member: new Map(),
      poll: new Map(),
      option: new Map(),
      vote: new Map(),
    };
    seq = 0;
  }
  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}-${seq}`;
  }

  function seedMoimWithMembers(moimId: string, memberSubs: string[]): void {
    tables.moim.set(moimId, {
      id: moimId,
      name: `모임 ${moimId}`,
      startsAt: null,
      location: null,
      maxMembers: 15,
      createdBy: memberSubs[0] ?? 'owner',
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
      budget: null,
    });
    memberSubs.forEach((sub, idx) => {
      tables.member.set(memberKey(moimId, sub), {
        moimId,
        userId: sub,
        nickname: `멤버${idx}`,
        role: idx === 0 ? 'owner' : 'member',
        joinedAt: new Date('2026-06-19T00:00:00.000Z'),
      });
    });
  }

  function seedPoll(
    moimId: string,
    question: string,
    labels: string[],
    multiSelect = false,
  ): { poll: Poll; options: PollOption[] } {
    const poll: Poll = {
      id: nextId('poll'),
      moimId,
      question,
      multiSelect,
      createdBy: 'owner',
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      closesAt: null,
      kind: 'general',
    };
    tables.poll.set(poll.id, poll);
    const options = labels.map((label) => {
      const option: PollOption = {
        id: nextId('opt'),
        pollId: poll.id,
        label,
        optionDate: null,
      };
      tables.option.set(option.id, option);
      return option;
    });
    return { poll, options };
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

    // poll 위임(create 는 네스티드 옵션 생성, findUnique/findMany 조회).
    const pollDelegate = {
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            question: string;
            createdBy: string;
            multiSelect?: boolean;
            closesAt?: Date | null;
            kind?: string;
            options?: { create: { label: string; optionDate?: Date | null }[] };
          };
        }) => {
          const created: Poll = {
            id: nextId('poll'),
            moimId: arg.data.moimId,
            question: arg.data.question,
            multiSelect: arg.data.multiSelect ?? false,
            createdBy: arg.data.createdBy,
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
            closesAt: arg.data.closesAt ?? null,
            kind: arg.data.kind ?? 'general',
          };
          tables.poll.set(created.id, created);
          const opts = (arg.data.options?.create ?? []).map((o) => {
            const option: PollOption = {
              id: nextId('opt'),
              pollId: created.id,
              label: o.label,
              optionDate: o.optionDate ?? null,
            };
            tables.option.set(option.id, option);
            return option;
          });
          return Promise.resolve({ ...created, options: opts });
        },
      ),
      findUnique: jest.fn((arg: { where: { id: string } }) =>
        Promise.resolve(tables.poll.get(arg.where.id) ?? null),
      ),
      findMany: jest.fn((arg: { where: { moimId: string } }) =>
        Promise.resolve(
          [...tables.poll.values()].filter(
            (p) => p.moimId === arg.where.moimId,
          ),
        ),
      ),
    };
    const pollOptionDelegate = {
      findUnique: jest.fn((arg: { where: { id: string } }) =>
        Promise.resolve(tables.option.get(arg.where.id) ?? null),
      ),
      findMany: jest.fn((arg: { where: { pollId: { in: string[] } } }) =>
        Promise.resolve(
          [...tables.option.values()].filter((o) =>
            arg.where.pollId.in.includes(o.pollId),
          ),
        ),
      ),
    };
    const pollVoteDelegate = {
      // create — 한 표 기록(단일=교체 후, 다중=토글 on).
      create: jest.fn(
        (arg: {
          data: { pollId: string; optionId: string; userId: string };
        }) => {
          const next: PollVote = {
            pollId: arg.data.pollId,
            optionId: arg.data.optionId,
            userId: arg.data.userId,
            createdAt: new Date('2026-06-20T00:00:00.000Z'),
          };
          tables.vote.set(
            voteKey(next.pollId, next.optionId, next.userId),
            next,
          );
          return Promise.resolve(next);
        },
      ),
      // deleteMany({ where: { pollId, userId } }) — 단일 선택 교체 시 그 멤버의 그 poll 표를 모두 제거.
      deleteMany: jest.fn(
        (arg: { where: { pollId: string; userId: string } }) => {
          let count = 0;
          for (const [key, v] of [...tables.vote.entries()]) {
            if (
              v.pollId === arg.where.pollId &&
              v.userId === arg.where.userId
            ) {
              tables.vote.delete(key);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        },
      ),
      // findUnique({ where: { pollId_optionId_userId } }) — 다중 토글 시 표 존재 여부 판정.
      findUnique: jest.fn(
        (arg: {
          where: {
            pollId_optionId_userId: {
              pollId: string;
              optionId: string;
              userId: string;
            };
          };
        }) => {
          const { pollId, optionId, userId } = arg.where.pollId_optionId_userId;
          return Promise.resolve(
            tables.vote.get(voteKey(pollId, optionId, userId)) ?? null,
          );
        },
      ),
      // delete({ where: { pollId_optionId_userId } }) — 다중 토글 off.
      delete: jest.fn(
        (arg: {
          where: {
            pollId_optionId_userId: {
              pollId: string;
              optionId: string;
              userId: string;
            };
          };
        }) => {
          const { pollId, optionId, userId } = arg.where.pollId_optionId_userId;
          const key = voteKey(pollId, optionId, userId);
          const existing = tables.vote.get(key);
          tables.vote.delete(key);
          return Promise.resolve(existing ?? null);
        },
      ),
      groupBy: jest.fn((arg: { where: { pollId: { in: string[] } } }) => {
        const counts = new Map<string, number>();
        for (const v of tables.vote.values()) {
          if (arg.where.pollId.in.includes(v.pollId)) {
            counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);
          }
        }
        return Promise.resolve(
          [...counts.entries()].map(([optionId, count]) => ({
            optionId,
            _count: { _all: count },
          })),
        );
      }),
      findMany: jest.fn(
        (arg: { where: { pollId: { in: string[] }; userId: string } }) =>
          Promise.resolve(
            [...tables.vote.values()].filter(
              (v) =>
                arg.where.pollId.in.includes(v.pollId) &&
                v.userId === arg.where.userId,
            ),
          ),
      ),
    };

    const fakePrisma = {
      $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          poll: pollDelegate,
          pollOption: pollOptionDelegate,
          pollVote: pollVoteDelegate,
        }),
      ),
      moim: {
        findUnique: jest.fn((arg: { where: { id: string } }) =>
          Promise.resolve(tables.moim.get(arg.where.id) ?? null),
        ),
      },
      moimMember: {
        findUnique: jest.fn(
          (arg: {
            where: { moimId_userId: { moimId: string; userId: string } };
          }) => Promise.resolve(findMember(arg.where)),
        ),
      },
      poll: pollDelegate,
      pollOption: pollOptionDelegate,
      pollVote: pollVoteDelegate,
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

  // ── 미인증 401 (전 라우트, 부작용 없음) ──
  describe('미인증 401', () => {
    const routes: { method: 'get' | 'post'; path: string }[] = [
      { method: 'post', path: '/moims/moim-x/polls' },
      { method: 'get', path: '/moims/moim-x/polls' },
      { method: 'post', path: '/moims/moim-x/polls/poll-x/vote' },
    ];

    it.each(routes)('$method $path → 401', async ({ method, path }) => {
      seedMoimWithMembers('moim-x', [uniqueSub()]);
      const before = tables.poll.size;

      await request(app.getHttpServer())[method](path).expect(401);

      expect(tables.poll.size).toBe(before);
    });
  });

  // ── AC-2: 멤버 생성 201 + createdBy=sub + 옵션 2개 ──
  it('AC-2: 멤버의 POST → 201 + poll + 옵션 생성, createdBy=sub', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .post('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '점심?', options: ['김밥', '라면'] })
      .expect(201);

    const body = res.body as {
      id: string;
      question: string;
      createdBy: string;
      multiSelect: boolean;
      options: { id: string; label: string; voteCount: number }[];
      myVotes: string[];
    };
    expect(body.question).toBe('점심?');
    expect(body.createdBy).toBe(memberSub);
    // multiSelect 생략 → false(단일 선택, MOIM-005 동작 동일).
    expect(body.multiSelect).toBe(false);
    expect(body.options.map((o) => o.label)).toEqual(['김밥', '라면']);
    expect(body.options.every((o) => o.voteCount === 0)).toBe(true);
    expect(body.myVotes).toEqual([]);
    expect(tables.poll.size).toBe(1);
    expect(tables.option.size).toBe(2);
  });

  // ── AC-2: multiSelect:true 생성 → multiSelect:true poll ──
  it('AC-2: multiSelect:true POST → 201 + multiSelect:true poll', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .post('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '가능한 날짜?', options: ['토', '일', '월'], multiSelect: true })
      .expect(201);

    const body = res.body as { multiSelect: boolean; myVotes: string[] };
    expect(body.multiSelect).toBe(true);
    expect(body.myVotes).toEqual([]);
    expect(tables.poll.size).toBe(1);
    expect(tables.option.size).toBe(3);
  });

  // ── AC-2(Unwanted): 빈 question → 400 + 미생성 ──
  it('AC-2: 빈 question → 400 + poll 미생성', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .post('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '   ', options: ['A', 'B'] })
      .expect(400);

    expect(tables.poll.size).toBe(0);
  });

  // ── AC-2(Unwanted): 유효 옵션 <2 → 400 (빈 항목 혼재) ──
  it('AC-2: 유효 옵션 <2(빈 항목 혼재) → 400 + 미생성', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .post('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${token}`)
      .send({ question: '점심?', options: ['김밥', '   ', ''] })
      .expect(400);

    expect(tables.poll.size).toBe(0);
  });

  // ── AC-2(Unwanted): 비멤버 생성 → 403 + 미생성 ──
  it('AC-2: 비멤버의 POST → 403 + poll 미생성', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithMembers('moim-A', [ownerSub]);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .post('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ question: '점심?', options: ['A', 'B'] })
      .expect(403);

    expect(tables.poll.size).toBe(0);
  });

  // ── AC-3: 단일 선택 투표 기록 + 재투표 교체(합산 아님 — MOIM-005 회귀 0) ──
  it('AC-3: 단일 멤버 투표 → 200 + 표 기록, 재투표 시 교체(여전히 1표)', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B'], false);
    const token = await tokenFor(memberSub);

    // 1차: A 에 투표.
    const first = await request(app.getHttpServer())
      .post(`/moims/moim-A/polls/${poll.id}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: options[0].id })
      .expect(200);
    const firstBody = first.body as {
      multiSelect: boolean;
      options: { id: string; voteCount: number }[];
      myVotes: string[];
    };
    expect(firstBody.multiSelect).toBe(false);
    expect(firstBody.myVotes).toEqual([options[0].id]);
    expect(
      firstBody.options.find((o) => o.id === options[0].id)?.voteCount,
    ).toBe(1);
    expect(tables.vote.size).toBe(1);

    // 2차: B 로 재투표 → 교체(여전히 1표, A 0 / B 1).
    const second = await request(app.getHttpServer())
      .post(`/moims/moim-A/polls/${poll.id}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: options[1].id })
      .expect(200);
    const secondBody = second.body as {
      options: { id: string; voteCount: number }[];
      myVotes: string[];
    };
    expect(secondBody.myVotes).toEqual([options[1].id]);
    expect(
      secondBody.options.find((o) => o.id === options[0].id)?.voteCount,
    ).toBe(0);
    expect(
      secondBody.options.find((o) => o.id === options[1].id)?.voteCount,
    ).toBe(1);
    // 합산이 아니라 교체 — 표는 여전히 1개.
    expect(tables.vote.size).toBe(1);
  });

  // ── AC-3: 다중 선택 토글(추가/제거) end-to-end ──
  it('AC-3: 다중 멤버 투표 → 토글(A 추가 → B 추가 둘 다 보유 → A 다시 제거)', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const { poll, options } = seedPoll('moim-A', '가능?', ['A', 'B', 'C'], true);
    const token = await tokenFor(memberSub);
    const voteUrl = `/moims/moim-A/polls/${poll.id}/vote`;

    // A 추가.
    await request(app.getHttpServer())
      .post(voteUrl)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: options[0].id })
      .expect(200);
    expect(tables.vote.size).toBe(1);

    // B 추가 → A,B 동시 보유.
    const afterB = await request(app.getHttpServer())
      .post(voteUrl)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: options[1].id })
      .expect(200);
    const afterBBody = afterB.body as {
      multiSelect: boolean;
      myVotes: string[];
    };
    expect(afterBBody.multiSelect).toBe(true);
    expect(afterBBody.myVotes.sort()).toEqual(
      [options[0].id, options[1].id].sort(),
    );
    expect(tables.vote.size).toBe(2);

    // A 다시 → 토글 off(B 만 남음).
    const afterToggleOff = await request(app.getHttpServer())
      .post(voteUrl)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: options[0].id })
      .expect(200);
    const offBody = afterToggleOff.body as {
      options: { id: string; voteCount: number }[];
      myVotes: string[];
    };
    expect(offBody.myVotes).toEqual([options[1].id]);
    // A voteCount 감소, B 유지.
    expect(offBody.options.find((o) => o.id === options[0].id)?.voteCount).toBe(
      0,
    );
    expect(offBody.options.find((o) => o.id === options[1].id)?.voteCount).toBe(
      1,
    );
    expect(tables.vote.size).toBe(1);
  });

  // ── AC-3(Unwanted): 잘못된 optionId(교차-poll) → 400 ──
  it('AC-3: 다른 poll 의 optionId 로 투표 → 400 + 미기록', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const target = seedPoll('moim-A', '점심?', ['A', 'B']);
    const other = seedPoll('moim-A', '저녁?', ['C', 'D']);
    const token = await tokenFor(memberSub);

    await request(app.getHttpServer())
      .post(`/moims/moim-A/polls/${target.poll.id}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: other.options[0].id })
      .expect(400);

    expect(tables.vote.size).toBe(0);
  });

  // ── AC-3(Unwanted): 다른 모임의 pollId → 404 ──
  it('AC-3: 다른 모임에 속한 pollId 로 투표 → 404 + 미기록', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    seedMoimWithMembers('moim-B', [memberSub]);
    const otherMoimPoll = seedPoll('moim-B', '점심?', ['A', 'B']);
    const token = await tokenFor(memberSub);

    // path 는 moim-A 인데 poll 은 moim-B 소속.
    await request(app.getHttpServer())
      .post(`/moims/moim-A/polls/${otherMoimPoll.poll.id}/vote`)
      .set('Authorization', `Bearer ${token}`)
      .send({ optionId: otherMoimPoll.options[0].id })
      .expect(404);

    expect(tables.vote.size).toBe(0);
  });

  // ── AC-3(Unwanted): 비멤버 투표 → 403 ──
  it('AC-3: 비멤버의 투표 → 403 + 미기록', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithMembers('moim-A', [ownerSub]);
    const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .post(`/moims/moim-A/polls/${poll.id}/vote`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ optionId: options[0].id })
      .expect(403);

    expect(tables.vote.size).toBe(0);
  });

  // ── AC-4: 목록 + 결과 집계 + myVotes(단일 + 다중) ──
  it('AC-4: 멤버의 GET → 200 + 옵션별 voteCount(표 0 포함) + multiSelect + myVotes', async () => {
    const memberSub = uniqueSub();
    const otherSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub, otherSub]);
    // 단일 poll: A 에 2표(member, other), B 0표. 호출자는 A.
    const single = seedPoll('moim-A', '점심?', ['A', 'B'], false);
    tables.vote.set(voteKey(single.poll.id, single.options[0].id, memberSub), {
      pollId: single.poll.id,
      optionId: single.options[0].id,
      userId: memberSub,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
    });
    tables.vote.set(voteKey(single.poll.id, single.options[0].id, otherSub), {
      pollId: single.poll.id,
      optionId: single.options[0].id,
      userId: otherSub,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
    });
    // 다중 poll: 호출자가 A,C 동시 보유.
    const multi = seedPoll('moim-A', '가능?', ['A', 'B', 'C'], true);
    tables.vote.set(voteKey(multi.poll.id, multi.options[0].id, memberSub), {
      pollId: multi.poll.id,
      optionId: multi.options[0].id,
      userId: memberSub,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
    });
    tables.vote.set(voteKey(multi.poll.id, multi.options[2].id, memberSub), {
      pollId: multi.poll.id,
      optionId: multi.options[2].id,
      userId: memberSub,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
    });
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      id: string;
      multiSelect: boolean;
      options: { id: string; label: string; voteCount: number }[];
      myVotes: string[];
    }[];
    expect(body).toHaveLength(2);

    const singleDto = body.find((p) => p.id === single.poll.id)!;
    expect(singleDto.multiSelect).toBe(false);
    const singleCounts = new Map(
      singleDto.options.map((o) => [o.label, o.voteCount]),
    );
    expect(singleCounts.get('A')).toBe(2);
    expect(singleCounts.get('B')).toBe(0);
    expect(singleDto.myVotes).toEqual([single.options[0].id]);

    const multiDto = body.find((p) => p.id === multi.poll.id)!;
    expect(multiDto.multiSelect).toBe(true);
    expect(multiDto.myVotes.sort()).toEqual(
      [multi.options[0].id, multi.options[2].id].sort(),
    );
    const multiCounts = new Map(
      multiDto.options.map((o) => [o.label, o.voteCount]),
    );
    expect(multiCounts.get('A')).toBe(1);
    expect(multiCounts.get('B')).toBe(0);
    expect(multiCounts.get('C')).toBe(1);
  });

  // ── AC-4: poll 없는 모임 → 빈 배열 ──
  it('AC-4: poll 없는 모임의 GET → 빈 배열(에러 아님)', async () => {
    const memberSub = uniqueSub();
    seedMoimWithMembers('moim-A', [memberSub]);
    const token = await tokenFor(memberSub);

    const res = await request(app.getHttpServer())
      .get('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([]);
  });

  // ── AC-4: 비멤버 조회 → 403 ──
  it('AC-4: 비멤버의 GET → 403(투표 내용 비노출)', async () => {
    const ownerSub = uniqueSub();
    seedMoimWithMembers('moim-A', [ownerSub]);
    seedPoll('moim-A', '점심?', ['A', 'B']);
    const strangerToken = await tokenFor(uniqueSub());

    await request(app.getHttpServer())
      .get('/moims/moim-A/polls')
      .set('Authorization', `Bearer ${strangerToken}`)
      .expect(403);
  });
});
