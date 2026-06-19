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

// PollService 단위 테스트(SPEC-MOIM-006 — MOIM-005 단일 선택 확장). 인메모리 fake prisma + stub MoimService 로 검증한다:
//   - createPoll: assertMember 후 poll + options 를 하나의 트랜잭션으로 생성하고 createdBy=sub + multiSelect(기본 false).
//   - vote: assertMember → pollId-moim 일관성(404) → optionId-poll 소속(400) 검증 후 poll.multiSelect 분기:
//       · 단일(false): deleteMany({pollId,userId}) + create — 멤버당 한 표 교체(MOIM-005 회귀 0).
//       · 다중(true): (pollId,optionId,userId) 토글 — 없으면 create, 있으면 delete(멤버 0..N 표).
//   - listPolls: assertMember 후 옵션별 voteCount(표 0 포함) + 호출자 myVotes(목록, 미투표 빈 배열) + multiSelect 집계.
//   - 모든 진입(create/vote/list)은 비멤버 → assertMember 가 403(ForbiddenException) 전파.
// MoimService.assertMember 는 MOIM-001 검증 단일 출처라 재구현하지 않고 스텁한다(reuse 계약).
// fake vote 테이블은 (pollId,optionId,userId) 복합 PK 를 흉내내 키로 삼는다(새 PK — 멤버당 옵션당 한 표).

const NOW = new Date('2026-06-20T00:00:00.000Z');

interface Tables {
  poll: Map<string, Poll>;
  option: Map<string, PollOption>;
  vote: Map<string, PollVote>; // key: `${pollId}:${optionId}:${userId}` — 새 복합 PK
}

function voteKey(pollId: string, optionId: string, userId: string): string {
  return `${pollId}:${optionId}:${userId}`;
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

  // 옵션 라벨 배열로 poll 을 시드한다(직접 DB 시드 — vote/list 테스트 준비용). multiSelect 기본 false(단일).
  function seedPoll(
    moimId: string,
    question: string,
    labels: string[],
    multiSelect = false,
    createdBy = 'owner',
  ): { poll: Poll; options: PollOption[] } {
    const poll: Poll = {
      id: nextId('poll'),
      moimId,
      question,
      multiSelect,
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
    tables.vote.set(voteKey(pollId, optionId, userId), {
      pollId,
      optionId,
      userId,
      createdAt: NOW,
    });
  }

  // 한 멤버가 한 poll 에서 보유한 표(optionId 들). 다중 선택 토글 결과 확인용.
  function myVoteOptionIds(pollId: string, userId: string): string[] {
    return [...tables.vote.values()]
      .filter((v) => v.pollId === pollId && v.userId === userId)
      .map((v) => v.optionId);
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
      // create({ data: { ..., multiSelect, options: { create: [{label}] } }, include:{options:true} }) 네스티드 생성.
      create: jest.fn(
        (arg: {
          data: {
            moimId: string;
            question: string;
            createdBy: string;
            multiSelect?: boolean;
            options?: { create: { label: string }[] };
          };
          include?: { options?: boolean };
        }) => {
          const created: Poll = {
            id: nextId('poll'),
            moimId: arg.data.moimId,
            question: arg.data.question,
            multiSelect: arg.data.multiSelect ?? false,
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
      // create({ data: { pollId, optionId, userId } }) — 한 표 기록(단일=교체 후, 다중=토글 on).
      create: jest.fn(
        (arg: {
          data: { pollId: string; optionId: string; userId: string };
        }) => {
          const next: PollVote = {
            pollId: arg.data.pollId,
            optionId: arg.data.optionId,
            userId: arg.data.userId,
            createdAt: NOW,
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
      // findMany({ where: { pollId: { in }, userId } }) — 호출자 myVotes 매핑용.
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
    // $transaction(인터랙티브 콜백) — createPoll 의 네스티드 생성 + vote 단일 교체를 그대로 실행한다.
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

  // ── REQ-MOIM6-002: createPoll (단일 기본 + multiSelect 옵트인) ──
  describe('createPoll() (REQ-MOIM6-002 / AC-2)', () => {
    it('멤버가 생성하면 poll + 옵션을 만들고 createdBy=sub, multiSelect 기본 false', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '점심?',
        ['김밥', '라면'],
        false,
      );

      expect(poll.moimId).toBe('moim-A');
      expect(poll.question).toBe('점심?');
      expect(poll.createdBy).toBe('member-1');
      // multiSelect 생략 → false(단일 선택, MOIM-005 동작 동일).
      expect(poll.multiSelect).toBe(false);
      expect(poll.options.map((o) => o.label)).toEqual(['김밥', '라면']);
      expect(tables.poll.size).toBe(1);
      expect(tables.option.size).toBe(2);
    });

    it('multiSelect=true 로 생성하면 다중 선택 poll 이 만들어진다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '가능한 날짜?',
        ['토', '일', '월'],
        true,
      );

      expect(poll.multiSelect).toBe(true);
      expect(poll.options.map((o) => o.label)).toEqual(['토', '일', '월']);
      expect(tables.poll.get(poll.id)?.multiSelect).toBe(true);
    });

    it('비멤버가 생성하면 403(ForbiddenException) + poll 미생성', async () => {
      const service = makeService();
      setMember('moim-A', 'owner-1');

      await expect(
        service.createPoll('stranger', 'moim-A', '점심?', ['A', 'B'], false),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tables.poll.size).toBe(0);
    });

    it('존재하지 않는 모임이면 NotFoundException 이 전파된다(컨트롤러 가드 이전 단계)', async () => {
      const service = makeService();

      await expect(
        service.createPoll('member-1', 'missing', '점심?', ['A', 'B'], false),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(tables.poll.size).toBe(0);
    });
  });

  // ── REQ-MOIM6-003: vote (단일 교체 — MOIM-005 회귀 0) ──
  describe('vote() — 단일 선택 교체(REQ-MOIM6-003 / AC-3, MOIM-005 회귀)', () => {
    it('멤버가 투표하면 표가 기록된다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B'], false);

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);

      expect(tables.vote.size).toBe(1);
      expect(myVoteOptionIds(poll.id, 'member-1')).toEqual([options[0].id]);
    });

    it('같은 멤버가 다시 투표하면 표가 교체된다(합산 아님 — 여전히 1표)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B'], false);

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);
      await service.vote('member-1', 'moim-A', poll.id, options[1].id);

      // 단일 선택은 deleteMany+create 로 교체 — 표는 여전히 1개이며 optionId 만 B 로 바뀐다.
      expect(tables.vote.size).toBe(1);
      expect(myVoteOptionIds(poll.id, 'member-1')).toEqual([options[1].id]);
    });

    it('vote 반환에 multiSelect:false + myVotes(1요소)가 담긴다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B'], false);

      const result = await service.vote(
        'member-1',
        'moim-A',
        poll.id,
        options[0].id,
      );

      expect(result.multiSelect).toBe(false);
      expect(result.myVotes).toEqual([options[0].id]);
    });
  });

  // ── REQ-MOIM6-003: vote (다중 선택 토글) ──
  describe('vote() — 다중 선택 토글(REQ-MOIM6-003 / AC-3)', () => {
    it('다중 poll 에서 A,B 를 고르면 둘 다 동시 보유한다(교체 아님)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll(
        'moim-A',
        '가능한 날짜?',
        ['A', 'B', 'C'],
        true,
      );

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);
      const afterB = await service.vote(
        'member-1',
        'moim-A',
        poll.id,
        options[1].id,
      );

      // 멤버 표 = {A, B} 동시 보유.
      expect(myVoteOptionIds(poll.id, 'member-1').sort()).toEqual(
        [options[0].id, options[1].id].sort(),
      );
      expect(tables.vote.size).toBe(2);
      expect(afterB.myVotes.sort()).toEqual(
        [options[0].id, options[1].id].sort(),
      );
    });

    it('이미 고른 선택지를 다시 투표하면 그 표만 제거된다(토글 off)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll(
        'moim-A',
        '가능한 날짜?',
        ['A', 'B', 'C'],
        true,
      );

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);
      await service.vote('member-1', 'moim-A', poll.id, options[1].id);
      const afterToggleOff = await service.vote(
        'member-1',
        'moim-A',
        poll.id,
        options[0].id, // A 다시 → 토글 off
      );

      // A 제거, B 만 남는다.
      expect(myVoteOptionIds(poll.id, 'member-1')).toEqual([options[1].id]);
      expect(afterToggleOff.myVotes).toEqual([options[1].id]);
    });

    it('자기 표를 모두 토글 off 하면 myVotes 는 빈 배열(0표 보유 가능)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '가능?', ['A', 'B'], true);

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);
      const result = await service.vote(
        'member-1',
        'moim-A',
        poll.id,
        options[0].id, // 토글 off
      );

      expect(myVoteOptionIds(poll.id, 'member-1')).toEqual([]);
      expect(result.myVotes).toEqual([]);
    });

    it('다중 voteCount 는 그 옵션을 고른 멤버 수와 같다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      setMember('moim-A', 'member-2');
      const { poll, options } = seedPoll('moim-A', '가능?', ['A', 'B'], true);
      // member-2 는 A,B 둘 다 고른 상태로 시드.
      seedVote(poll.id, options[0].id, 'member-2');
      seedVote(poll.id, options[1].id, 'member-2');

      // member-1 이 A 에 투표 → A voteCount=2(member-1,2), B voteCount=1(member-2).
      const result = await service.vote(
        'member-1',
        'moim-A',
        poll.id,
        options[0].id,
      );

      const counts = new Map(result.options.map((o) => [o.label, o.voteCount]));
      expect(counts.get('A')).toBe(2);
      expect(counts.get('B')).toBe(1);
      expect(result.myVotes).toEqual([options[0].id]);
    });
  });

  // ── REQ-MOIM6-003: vote 검증(단일/다중 공통) ──
  describe('vote() — 검증(단일/다중 공통)', () => {
    it.each([false, true])(
      'multiSelect=%s — 해당 poll 에 속하지 않는 optionId 로 투표하면 400',
      async (multiSelect) => {
        const service = makeService();
        setMember('moim-A', 'member-1');
        const { poll } = seedPoll('moim-A', '점심?', ['A', 'B'], multiSelect);
        // 다른 poll 의 옵션.
        const other = seedPoll('moim-A', '저녁?', ['C', 'D'], multiSelect);

        await expect(
          service.vote('member-1', 'moim-A', poll.id, other.options[0].id),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(tables.vote.size).toBe(0);
      },
    );

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

  // ── REQ-MOIM6-004: listPolls (목록 + 결과 집계 + myVotes + multiSelect) ──
  describe('listPolls() (REQ-MOIM6-004 / AC-4)', () => {
    it('단일 poll — 옵션별 voteCount(표 0 포함) + 호출자 myVotes(1요소) + multiSelect:false', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      setMember('moim-A', 'member-2');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B'], false);
      // A 에 2표(member-1, member-2), B 에 0표. 호출자(member-1)는 A.
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls).toHaveLength(1);
      expect(polls[0].multiSelect).toBe(false);
      const optionMap = new Map(
        polls[0].options.map((o) => [o.label, o.voteCount]),
      );
      expect(optionMap.get('A')).toBe(2);
      // 표 0 옵션도 voteCount:0 으로 포함(빠뜨리지 않음).
      expect(optionMap.get('B')).toBe(0);
      expect(polls[0].myVotes).toEqual([options[0].id]);
    });

    it('다중 poll — 호출자가 A,C 를 고르면 myVotes=[A,C], multiSelect:true', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll(
        'moim-A',
        '가능한 날짜?',
        ['A', 'B', 'C'],
        true,
      );
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[2].id, 'member-1');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].multiSelect).toBe(true);
      expect(polls[0].myVotes.sort()).toEqual(
        [options[0].id, options[2].id].sort(),
      );
      const optionMap = new Map(
        polls[0].options.map((o) => [o.label, o.voteCount]),
      );
      expect(optionMap.get('A')).toBe(1);
      expect(optionMap.get('B')).toBe(0);
      expect(optionMap.get('C')).toBe(1);
    });

    it('호출자가 투표하지 않았으면 myVotes 는 빈 배열', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll('moim-A', '점심?', ['A', 'B']);
      seedVote(poll.id, options[0].id, 'other');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].myVotes).toEqual([]);
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
