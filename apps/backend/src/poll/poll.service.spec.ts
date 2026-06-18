import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  Poll,
  PollOption,
  PollVote,
} from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import { PollService } from './poll.service';

// PollService 단위 테스트(SPEC-MOIM-005). 인메모리 fake prisma + stub MoimService(assertMember)로 검증한다:
//   - createPoll: assertMember 후 poll + options 를 하나의 트랜잭션으로 생성하고 createdBy=sub.
//   - vote: assertMember 후 pollId 가 moim 소속인지(아니면 404) + optionId 가 poll 소속인지(아니면 400) 검증하고
//           (pollId, userId) upsert(없으면 생성, 있으면 optionId 교체 — 재투표는 추가 아님).
//   - listPolls: assertMember 후 옵션별 voteCount(표 0 포함) + 호출자 myVote(optionId/null) 집계.
//   - 모든 진입(create/vote/list)은 비멤버 → assertMember 가 403(ForbiddenException) 전파.
// MoimService.assertMember 는 MOIM-001 검증 단일 출처라 재구현하지 않고 스텁한다(reuse 계약).

const NOW = new Date('2026-06-19T00:00:00.000Z');

interface Tables {
  poll: Map<string, Poll>;
  option: Map<string, PollOption>;
  vote: Map<string, PollVote>; // key: `${pollId}:${userId}`
}

function voteKey(pollId: string, userId: string): string {
  return `${pollId}:${userId}`;
}

describe('PollService', () => {
  // moimId별 멤버 sub 집합(assertMember 가 멤버면 resolve). 존재하는 모임 + 멤버십 판정 — MOIM-001 계약 재현.
  let members: Map<string, Set<string>>;
  let existingMoims: Set<string>;
  let tables: Tables;
  let idSeq: number;

  function reset(): void {
    members = new Map();
    existingMoims = new Set();
    tables = { poll: new Map(), option: new Map(), vote: new Map() };
    idSeq = 0;
  }

  function nextId(prefix: string): string {
    idSeq += 1;
    return `${prefix}-${idSeq}`;
  }

  function setMember(moimId: string, sub: string): void {
    existingMoims.add(moimId);
    const set = members.get(moimId) ?? new Set<string>();
    set.add(sub);
    members.set(moimId, set);
  }

  // 옵션 라벨 배열로 poll 을 시드한다(직접 DB 시드 — vote/list 테스트 준비용).
  function seedPoll(
    moimId: string,
    question: string,
    labels: string[],
    createdBy = 'owner',
  ): { poll: Poll; options: PollOption[] } {
    const poll: Poll = {
      id: nextId('poll'),
      moimId,
      question,
      createdBy,
      createdAt: NOW,
    };
    tables.poll.set(poll.id, poll);
    const options = labels.map((label) => {
      const option: PollOption = { id: nextId('opt'), pollId: poll.id, label };
      tables.option.set(option.id, option);
      return option;
    });
    return { poll, options };
  }

  function seedVote(pollId: string, optionId: string, userId: string): void {
    tables.vote.set(voteKey(pollId, userId), {
      pollId,
      optionId,
      userId,
      createdAt: NOW,
    });
  }

  // assertMember 를 스텁한 MoimService(존재+멤버십 기반 404/403 판정 — MOIM-001 계약 재현).
  function makeMoimService(): MoimService {
    return {
      assertMember: jest.fn((sub: string, moimId: string) => {
        if (!existingMoims.has(moimId)) {
          return Promise.reject(new NotFoundException());
        }
        if (!members.get(moimId)?.has(sub)) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve();
      }),
    } as unknown as MoimService;
  }

  // poll/pollOption/pollVote 테이블을 흉내내는 fake prisma. service 가 실제 호출하는 형태만 구현한다.
  function makePrisma(): PrismaService {
    const poll = {
      // create({ data: { ..., options: { create: [{label}] } }, include:{options:true} }) 네스티드 생성.
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            question: string;
            createdBy: string;
            options?: { create: { label: string }[] };
          };
          include?: { options?: boolean };
        }) => {
          const created: Poll = {
            id: nextId('poll'),
            moimId: arg.data.moimId,
            question: arg.data.question,
            createdBy: arg.data.createdBy,
            createdAt: NOW,
          };
          tables.poll.set(created.id, created);
          const opts = (arg.data.options?.create ?? []).map((o) => {
            const option: PollOption = {
              id: nextId('opt'),
              pollId: created.id,
              label: o.label,
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
      findMany: jest.fn(
        (arg: {
          where: { moimId: string };
          include?: { options?: boolean };
        }) =>
          Promise.resolve(
            [...tables.poll.values()]
              .filter((p) => p.moimId === arg.where.moimId)
              .map((p) => ({
                ...p,
                options: [...tables.option.values()].filter(
                  (o) => o.pollId === p.id,
                ),
              })),
          ),
      ),
    };
    const pollOption = {
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
    const pollVote = {
      // upsert({ where: { pollId_userId }, create, update: { optionId } }).
      upsert: jest.fn(
        (arg: {
          where: { pollId_userId: { pollId: string; userId: string } };
          create: { pollId: string; optionId: string; userId: string };
          update: { optionId: string };
        }) => {
          const { pollId, userId } = arg.where.pollId_userId;
          const key = voteKey(pollId, userId);
          const existing = tables.vote.get(key);
          const next: PollVote = existing
            ? { ...existing, optionId: arg.update.optionId }
            : {
                pollId: arg.create.pollId,
                optionId: arg.create.optionId,
                userId: arg.create.userId,
                createdAt: NOW,
              };
          tables.vote.set(key, next);
          return Promise.resolve(next);
        },
      ),
      // groupBy({ by: ['optionId'], where: { pollId: { in } }, _count }) — 옵션별 득표 수 집계.
      groupBy: jest.fn(
        (arg: { by: ['optionId']; where: { pollId: { in: string[] } } }) => {
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
        },
      ),
      // findMany({ where: { pollId: { in }, userId } }) — 호출자 myVote 매핑용.
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
    // $transaction(인터랙티브 콜백) — createPoll 의 네스티드 생성을 그대로 실행한다.
    const $transaction = jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
      cb({ poll, pollOption, pollVote }),
    );
    return {
      poll,
      pollOption,
      pollVote,
      $transaction,
    } as unknown as PrismaService;
  }

  function makeService(): PollService {
    return new PollService(makePrisma(), makeMoimService());
  }

  beforeEach(() => {
    reset();
  });

  // ── REQ-MOIM5-002: createPoll ──
  describe('createPoll() (REQ-MOIM5-002 / AC-2)', () => {
    it('멤버가 생성하면 poll + 옵션을 만들고 createdBy=sub 다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll('member-1', 'moim-A', '점심?', [
        '김밥',
        '라면',
      ]);

      expect(poll.moimId).toBe('moim-A');
      expect(poll.question).toBe('점심?');
      expect(poll.createdBy).toBe('member-1');
      expect(poll.options.map((o) => o.label)).toEqual(['김밥', '라면']);
      expect(tables.poll.size).toBe(1);
      expect(tables.option.size).toBe(2);
    });

    it('비멤버가 생성하면 403(ForbiddenException) + poll 미생성', async () => {
      const service = makeService();
      setMember('moim-A', 'owner-1');

      await expect(
        service.createPoll('stranger', 'moim-A', '점심?', ['A', 'B']),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.poll.size).toBe(0);
    });

    it('존재하지 않는 모임이면 NotFoundException 이 전파된다(컨트롤러 가드 이전 단계)', async () => {
      const service = makeService();

      await expect(
        service.createPoll('member-1', 'missing', '점심?', ['A', 'B']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tables.poll.size).toBe(0);
    });
  });

  // ── REQ-MOIM5-003: vote (단일 투표 + 재투표 교체) ──
  describe('vote() (REQ-MOIM5-003 / AC-3)', () => {
    it('멤버가 투표하면 (pollId,userId) 표가 기록된다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);

      expect(tables.vote.size).toBe(1);
      expect(tables.vote.get(voteKey(poll.id, 'member-1'))?.optionId).toBe(
        options[0].id,
      );
    });

    it('같은 멤버가 다시 투표하면 표가 교체된다(합산 아님 — 여전히 1표)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);
      await service.vote('member-1', 'moim-A', poll.id, options[1].id);

      // (pollId,userId) PK 라 표는 여전히 1개이며 optionId 만 B 로 교체된다.
      expect(tables.vote.size).toBe(1);
      expect(tables.vote.get(voteKey(poll.id, 'member-1'))?.optionId).toBe(
        options[1].id,
      );
    });

    it('해당 poll 에 속하지 않는 optionId 로 투표하면 400(BadRequestException)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll } = seedPoll('moim-A', '점심?', ['A', 'B']);
      // 다른 poll 의 옵션.
      const other = seedPoll('moim-A', '저녁?', ['C', 'D']);

      await expect(
        service.vote('member-1', 'moim-A', poll.id, other.options[0].id),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tables.vote.size).toBe(0);
    });

    it('존재하지 않는 optionId 로 투표하면 400', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll } = seedPoll('moim-A', '점심?', ['A', 'B']);

      await expect(
        service.vote('member-1', 'moim-A', poll.id, 'no-such-option'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tables.vote.size).toBe(0);
    });

    it('다른 모임에 속한 pollId 로 투표하면 404(NotFoundException)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      // poll 은 moim-B 소속인데 path 는 moim-A.
      existingMoims.add('moim-B');
      const { poll, options } = seedPoll('moim-B', '점심?', ['A', 'B']);

      await expect(
        service.vote('member-1', 'moim-A', poll.id, options[0].id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tables.vote.size).toBe(0);
    });

    it('존재하지 않는 pollId 로 투표하면 404', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      await expect(
        service.vote('member-1', 'moim-A', 'no-such-poll', 'opt'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tables.vote.size).toBe(0);
    });

    it('비멤버가 투표하면 403 + 표 미기록', async () => {
      const service = makeService();
      setMember('moim-A', 'owner-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);

      await expect(
        service.vote('stranger', 'moim-A', poll.id, options[0].id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.vote.size).toBe(0);
    });
  });

  // ── REQ-MOIM5-004: listPolls (목록 + 결과 집계 + myVote) ──
  describe('listPolls() (REQ-MOIM5-004 / AC-4)', () => {
    it('옵션별 voteCount(표 0 포함) + 호출자 myVote 를 반환한다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      setMember('moim-A', 'member-2');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);
      // A 에 2표(member-1, member-2), B 에 0표. 호출자(member-1)는 A 에 투표.
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls).toHaveLength(1);
      const optionMap = new Map(
        polls[0].options.map((o) => [o.label, o.voteCount]),
      );
      expect(optionMap.get('A')).toBe(2);
      // 표 0 옵션도 voteCount:0 으로 포함(빠뜨리지 않음).
      expect(optionMap.get('B')).toBe(0);
      expect(polls[0].myVote).toBe(options[0].id);
    });

    it('호출자가 투표하지 않았으면 myVote 는 null', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);
      seedVote(poll.id, options[0].id, 'other');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].myVote).toBeNull();
    });

    it('poll 이 하나도 없으면 빈 배열을 반환한다(에러 아님)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls).toEqual([]);
    });

    it('비멤버가 조회하면 403(투표 내용 비노출)', async () => {
      const service = makeService();
      setMember('moim-A', 'owner-1');
      seedPoll('moim-A', '점심?', ['A', 'B']);

      await expect(
        service.listPolls('stranger', 'moim-A'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
