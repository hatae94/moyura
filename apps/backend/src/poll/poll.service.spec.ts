import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Moim,
  Poll,
  PollOption,
  PollVote,
} from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import { MOIM_POLL_CLOSED, MOIM_POLL_CREATED } from './poll-events';
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
  moim: Map<string, Moim>; // SPEC-MOIM-008: setStartsAt 호출 대상
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
  // SPEC-NOTIFICATIONS-001 M2: EventEmitter2.emit 스텁(발행 검증용, per-test 초기화).
  let emit: jest.Mock;

  function reset(): void {
    members = new Map();
    existingMoims = new Set();
    tables = {
      moim: new Map(),
      poll: new Map(),
      option: new Map(),
      vote: new Map(),
    };
    idSeq = 0;
  }

  function nextId(prefix: string): string {
    idSeq += 1;
    return `${prefix}-${idSeq}`;
  }

  function setMember(moimId: string, sub: string): void {
    existingMoims.add(moimId);
    // SPEC-MOIM-008: moim 테이블도 함께 유지해 setStartsAt 스텁에서 업데이트할 수 있게 한다.
    if (!tables.moim.has(moimId)) {
      tables.moim.set(moimId, {
        id: moimId,
        name: `모임 ${moimId}`,
        startsAt: null,
        location: null,
        maxMembers: 15,
        createdBy: sub,
        createdAt: NOW,
        budget: null,
      });
    }
    const set = members.get(moimId) ?? new Set<string>();
    set.add(sub);
    members.set(moimId, set);
  }

  // 옵션 라벨 배열로 poll 을 시드한다(직접 DB 시드 — vote/list 테스트 준비용). multiSelect 기본 false(단일).
  // SPEC-MOIM-008: kind 와 optionDates 추가 — 날짜 투표 시드용. kind 기본 'general', optionDates 기본 null 배열.
  function seedPoll(
    moimId: string,
    question: string,
    labels: string[],
    multiSelect = false,
    createdBy = 'owner',
    closesAt: Date | null = null,
    kind = 'general',
    optionDates: (Date | null)[] = [],
  ): { poll: Poll; options: PollOption[] } {
    const poll: Poll = {
      id: nextId('poll'),
      moimId,
      question,
      multiSelect,
      createdBy,
      createdAt: NOW,
      closesAt,
      kind,
    };
    tables.poll.set(poll.id, poll);
    const options = labels.map((label, idx) => {
      const optionDate = optionDates[idx] ?? null;
      const option: PollOption = {
        id: nextId('opt'),
        pollId: poll.id,
        label,
        optionDate,
      };
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

  // assertMember + setStartsAt 을 스텁한 MoimService(존재+멤버십 기반 404/403 판정 — MOIM-001 계약 재현).
  // SPEC-MOIM-008: setStartsAt 은 moim 테이블의 startsAt 을 인메모리 업데이트한다(단일 출처 계약 검증).
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
      setStartsAt: jest.fn((moimId: string, startsAt: Date) => {
        const existing = tables.moim.get(moimId);
        if (existing) {
          tables.moim.set(moimId, { ...existing, startsAt });
        }
        return Promise.resolve();
      }),
      // SPEC-MOIM-010: setLocation 은 moim 테이블의 location 을 인메모리 업데이트한다(단일 출처 계약 검증).
      setLocation: jest.fn((moimId: string, location: string) => {
        const existing = tables.moim.get(moimId);
        if (existing) {
          tables.moim.set(moimId, { ...existing, location });
        }
        return Promise.resolve();
      }),
    } as unknown as MoimService;
  }

  // poll/pollOption/pollVote 테이블을 흉내내는 fake prisma. service 가 실제 호출하는 형태만 구현한다.
  function makePrisma(): PrismaService {
    const poll = {
      // create({ data: { ..., multiSelect, kind, options: { create: [{label, optionDate?}] } }, include:{options:true} }) 네스티드 생성.
      // SPEC-MOIM-008: kind + 옵션 optionDate 를 인자에서 읽어 저장한다.
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
          include?: { options?: boolean };
        }) => {
          const created: Poll = {
            id: nextId('poll'),
            moimId: arg.data.moimId,
            question: arg.data.question,
            multiSelect: arg.data.multiSelect ?? false,
            createdBy: arg.data.createdBy,
            createdAt: NOW,
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
      findMany: jest.fn(
        (arg: { where: { moimId: string }; include?: { options?: boolean } }) =>
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
      // update({ where: { id }, data: { closesAt } }) — closePoll 이 now 로 설정할 때 사용.
      update: jest.fn(
        (arg: { where: { id: string }; data: { closesAt?: Date | null } }) => {
          const existing = tables.poll.get(arg.where.id);
          if (!existing) return Promise.resolve(null);
          const updated: Poll = { ...existing, ...arg.data };
          tables.poll.set(arg.where.id, updated);
          return Promise.resolve(updated);
        },
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
    return new PollService(makePrisma(), makeMoimService(), {
      emit,
    } as unknown as EventEmitter2);
  }

  beforeEach(() => {
    reset();
    emit = jest.fn();
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

  // ── SPEC-MOIM-007: createPoll — closesAt 옵트인 ──
  describe('createPoll() — closesAt 옵트인(REQ-MOIM7-002 / AC-2)', () => {
    it('closesAt 를 전달하면 poll 의 closesAt 가 설정된다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const future = new Date(Date.now() + 86400000); // 내일

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '마감 있는 투표?',
        ['A', 'B'],
        false,
        future,
      );

      expect(poll.closesAt).toEqual(future);
    });

    it('closesAt 를 null 로 전달하면 마감 없는 poll 이 생성된다(MOIM-005/006 동작 보존)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '점심?',
        ['A', 'B'],
        false,
        null,
      );

      expect(poll.closesAt).toBeNull();
    });
  });

  // ── SPEC-MOIM-007: vote — 마감 poll 투표 차단(409) ──
  describe('vote() — 마감 poll 투표 차단(REQ-MOIM7-004 / AC-4)', () => {
    it('마감된 단일 poll(closesAt<=now) 에 투표하면 409(ConflictException) + 표 불변', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      // closesAt = now(=NOW) → CLOSED: closesAt <= NOW 이므로 마감.
      const { poll, options } = seedPoll(
        'moim-A',
        '마감 poll',
        ['A', 'B'],
        false,
        'owner',
        NOW,
      );

      await expect(
        service.vote('member-1', 'moim-A', poll.id, options[0].id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tables.vote.size).toBe(0);
    });

    it('마감된 다중 poll(closesAt<=now) 에 투표하면 409(단일/다중 공통 차단)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const past = new Date(NOW.getTime() - 1000); // 1초 전
      const { poll, options } = seedPoll(
        'moim-A',
        '마감 다중 poll',
        ['A', 'B'],
        true,
        'owner',
        past,
      );

      await expect(
        service.vote('member-1', 'moim-A', poll.id, options[0].id),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tables.vote.size).toBe(0);
    });

    it('마감된 poll 에 poll 에 없는 optionId 로 투표해도 409(마감 검사 우선)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll } = seedPoll(
        'moim-A',
        '마감 poll',
        ['A', 'B'],
        false,
        'owner',
        NOW,
      );

      await expect(
        service.vote('member-1', 'moim-A', poll.id, 'no-such-option'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tables.vote.size).toBe(0);
    });

    it('열린 poll(closesAt=null)에 투표하면 정상 처리된다(MOIM-005/006 회귀 0)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const { poll, options } = seedPoll(
        'moim-A',
        '열린 poll',
        ['A', 'B'],
        false,
        'owner',
        null, // 마감 없음
      );

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);

      expect(tables.vote.size).toBe(1);
    });

    it('closesAt 가 미래인 poll 에 투표하면 정상 처리된다(아직 열림)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const future = new Date(Date.now() + 86400000); // 내일
      const { poll, options } = seedPoll(
        'moim-A',
        '미래 마감 poll',
        ['A', 'B'],
        false,
        'owner',
        future,
      );

      await service.vote('member-1', 'moim-A', poll.id, options[0].id);

      expect(tables.vote.size).toBe(1);
    });
  });

  // ── SPEC-MOIM-007: closePoll — 생성자 전용 수동 마감 ──
  describe('closePoll() — 생성자 전용 수동 마감(REQ-MOIM7-003 / AC-3)', () => {
    it('생성자가 closePoll 을 호출하면 closesAt=now, isClosed:true 가 반환된다', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      seedPoll('moim-A', '열린 poll', ['A', 'B'], false, 'creator', null);
      const { poll } = seedPoll(
        'moim-A',
        '내 투표',
        ['X', 'Y'],
        false,
        'creator',
        null,
      );

      // 두 번째 poll 을 테스트 대상으로.
      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(result.isClosed).toBe(true);
      expect(result.closesAt).not.toBeNull();
      const closed = tables.poll.get(poll.id);
      expect(closed?.closesAt).not.toBeNull();
    });

    it('비생성자 멤버가 closePoll 을 호출하면 403(ForbiddenException)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      setMember('moim-A', 'other-member');
      const { poll } = seedPoll(
        'moim-A',
        '내 투표',
        ['A', 'B'],
        false,
        'creator',
        null,
      );

      await expect(
        service.closePoll('other-member', 'moim-A', poll.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // poll 은 변경되지 않는다.
      expect(tables.poll.get(poll.id)?.closesAt).toBeNull();
    });

    it('비멤버가 closePoll 을 호출하면 403(assertMember — 생성자 비교에 도달하지 않음)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const { poll } = seedPoll(
        'moim-A',
        '내 투표',
        ['A', 'B'],
        false,
        'creator',
        null,
      );

      await expect(
        service.closePoll('stranger', 'moim-A', poll.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('path 모임에 속하지 않는 pollId 로 closePoll 하면 404(NotFoundException)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      existingMoims.add('moim-B');
      const { poll } = seedPoll(
        'moim-B',
        '다른 모임 poll',
        ['A', 'B'],
        false,
        'creator',
        null,
      );

      await expect(
        service.closePoll('creator', 'moim-A', poll.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('이미 마감된 poll 에 다시 closePoll 하면 200(멱등 — isClosed:true 유지)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      // 이미 마감된 poll(closesAt=NOW).
      const { poll } = seedPoll(
        'moim-A',
        '마감 poll',
        ['A', 'B'],
        false,
        'creator',
        NOW,
      );

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(result.isClosed).toBe(true);
    });
  });

  // ── SPEC-MOIM-008: 날짜 투표 생성 (kind="date" + optionDate 저장) ──
  describe('createPoll() — 날짜 투표(REQ-MOIM8-002 / AC-2)', () => {
    it('kind="date" 로 생성하면 poll.kind="date" + 각 옵션 optionDate 가 저장된다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '언제 모일까?',
        [date1.toISOString(), date2.toISOString()],
        false,
        null,
        'date',
        [date1, date2],
      );

      expect(poll.kind).toBe('date');
      expect(poll.options[0].optionDate).toEqual(date1);
      expect(poll.options[1].optionDate).toEqual(date2);
      // 날짜 투표의 label 은 ISO 문자열(정규)이어야 한다.
      expect(poll.options[0].label).toBe(date1.toISOString());
    });

    it('kind="general"(기본) 로 생성하면 kind="general" + optionDate=null', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '점심?',
        ['A', 'B'],
        false,
      );

      expect(poll.kind).toBe('general');
      expect(poll.options[0].optionDate).toBeNull();
      expect(poll.options[1].optionDate).toBeNull();
    });

    it('kind 미전달 시 기본 "general" 이다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '점심?',
        ['A', 'B'],
        false,
        null,
      );

      expect(poll.kind).toBe('general');
    });
  });

  // ── SPEC-MOIM-008: closePoll 날짜 투표 자동 확정 ──
  describe('closePoll() — 날짜 투표 auto-finalize(REQ-MOIM8-003 / AC-3)', () => {
    it('단일 최다 득표 옵션이 있으면 Moim.startsAt 이 그 optionDate 로 설정된다', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');
      const { poll, options } = seedPoll(
        'moim-A',
        '날짜 투표',
        [date1.toISOString(), date2.toISOString()],
        false,
        'creator',
        null,
        'date',
        [date1, date2],
      );
      // options[0] 에 3표, options[1] 에 1표 — 단일 최다 득표 = options[0].
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');
      seedVote(poll.id, options[0].id, 'member-3');
      seedVote(poll.id, options[1].id, 'member-4');

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      // finalize: startsAt 이 date1(27일)로 설정된다.
      expect(tables.moim.get('moim-A')?.startsAt).toEqual(date1);
      expect(result.finalizedStartsAt).toEqual(date1);
      expect(result.finalizeSkippedReason).toBeNull();
    });

    it('동점이면 finalize 를 건너뛰고 finalizeSkippedReason="tie", startsAt 불변', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');
      const { poll, options } = seedPoll(
        'moim-A',
        '날짜 투표',
        [date1.toISOString(), date2.toISOString()],
        false,
        'creator',
        null,
        'date',
        [date1, date2],
      );
      // 각 2표 — 동점.
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');
      seedVote(poll.id, options[1].id, 'member-3');
      seedVote(poll.id, options[1].id, 'member-4');
      const originalStartsAt = tables.moim.get('moim-A')?.startsAt;

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.startsAt).toEqual(originalStartsAt);
      expect(result.finalizedStartsAt).toBeNull();
      expect(result.finalizeSkippedReason).toBe('tie');
    });

    it('표가 없으면 finalize 를 건너뛰고 finalizeSkippedReason="no_votes", startsAt 불변', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');
      const { poll } = seedPoll(
        'moim-A',
        '날짜 투표',
        [date1.toISOString(), date2.toISOString()],
        false,
        'creator',
        null,
        'date',
        [date1, date2],
      );
      const originalStartsAt = tables.moim.get('moim-A')?.startsAt;

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.startsAt).toEqual(originalStartsAt);
      expect(result.finalizedStartsAt).toBeNull();
      expect(result.finalizeSkippedReason).toBe('no_votes');
    });

    it('일반 투표(kind="general") 를 닫으면 finalize 를 수행하지 않는다(startsAt 불변, 두 필드 null)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const { poll, options } = seedPoll(
        'moim-A',
        '일반 투표',
        ['A', 'B'],
        false,
        'creator',
      );
      seedVote(poll.id, options[0].id, 'member-1');
      const originalStartsAt = tables.moim.get('moim-A')?.startsAt;

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.startsAt).toEqual(originalStartsAt);
      expect(result.finalizedStartsAt).toBeNull();
      expect(result.finalizeSkippedReason).toBeNull();
    });

    it('모임에 이미 startsAt 이 있는 경우 단일 승자 finalize 가 덮어쓴다', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const existingStartsAt = new Date('2026-06-01T00:00:00.000Z');
      // 기존 startsAt 을 모임에 설정한다.
      tables.moim.set('moim-A', {
        ...tables.moim.get('moim-A'),
        startsAt: existingStartsAt,
      });
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');
      const { poll, options } = seedPoll(
        'moim-A',
        '날짜 투표',
        [date1.toISOString(), date2.toISOString()],
        false,
        'creator',
        null,
        'date',
        [date1, date2],
      );
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');
      seedVote(poll.id, options[1].id, 'member-3');

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      // 기존 startsAt 이 date1 로 덮어써진다.
      expect(tables.moim.get('moim-A')?.startsAt).toEqual(date1);
      expect(result.finalizedStartsAt).toEqual(date1);
    });

    it('비생성자 멤버가 날짜 투표를 닫으면 403(finalize 미실행, startsAt 불변)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      setMember('moim-A', 'other-member');
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');
      const { poll, options } = seedPoll(
        'moim-A',
        '날짜 투표',
        [date1.toISOString(), date2.toISOString()],
        false,
        'creator',
        null,
        'date',
        [date1, date2],
      );
      seedVote(poll.id, options[0].id, 'member-1');
      const originalStartsAt = tables.moim.get('moim-A')?.startsAt;

      await expect(
        service.closePoll('other-member', 'moim-A', poll.id),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // finalize 가 실행되지 않는다.
      expect(tables.moim.get('moim-A')?.startsAt).toEqual(originalStartsAt);
    });
  });

  // ── SPEC-MOIM-010: closePoll 장소 투표 자동 확정 ──
  describe('closePoll() — 장소 투표 auto-finalize(REQ-MOIM10-003 / AC-3)', () => {
    it('단일 최다 득표 옵션이 있으면 Moim.location 이 그 label(장소명) 로 설정된다', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const { poll, options } = seedPoll(
        'moim-A',
        '장소 투표',
        ['강남역 2번 출구', '홍대입구역 9번 출구'],
        false,
        'creator',
        null,
        'place',
      );
      // options[0] 에 2표, options[1] 에 1표 — 단일 최다 득표 = options[0].
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');
      seedVote(poll.id, options[1].id, 'member-3');

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.location).toBe('강남역 2번 출구');
      expect(result.finalizedLocation).toBe('강남역 2번 출구');
      expect(result.finalizedStartsAt).toBeNull();
      expect(result.finalizeSkippedReason).toBeNull();
    });

    it('동점이면 finalize 를 건너뛰고 finalizeSkippedReason="tie", location 불변', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const { poll, options } = seedPoll(
        'moim-A',
        '장소 투표',
        ['강남역', '홍대입구'],
        false,
        'creator',
        null,
        'place',
      );
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[1].id, 'member-2');
      const originalLocation = tables.moim.get('moim-A')?.location;

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.location).toEqual(originalLocation);
      expect(result.finalizedLocation).toBeNull();
      expect(result.finalizeSkippedReason).toBe('tie');
    });

    it('표가 없으면 finalize 를 건너뛰고 finalizeSkippedReason="no_votes", location 불변', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      const { poll } = seedPoll(
        'moim-A',
        '장소 투표',
        ['강남역', '홍대입구'],
        false,
        'creator',
        null,
        'place',
      );
      const originalLocation = tables.moim.get('moim-A')?.location;

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.location).toEqual(originalLocation);
      expect(result.finalizedLocation).toBeNull();
      expect(result.finalizeSkippedReason).toBe('no_votes');
    });

    it('모임에 이미 location 이 있는 경우 단일 승자 finalize 가 덮어쓴다', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      tables.moim.set('moim-A', {
        ...tables.moim.get('moim-A'),
        location: '기존 장소',
      });
      const { poll, options } = seedPoll(
        'moim-A',
        '장소 투표',
        ['강남역', '홍대입구'],
        false,
        'creator',
        null,
        'place',
      );
      seedVote(poll.id, options[0].id, 'member-1');
      seedVote(poll.id, options[0].id, 'member-2');
      seedVote(poll.id, options[1].id, 'member-3');

      const result = await service.closePoll('creator', 'moim-A', poll.id);

      expect(tables.moim.get('moim-A')?.location).toBe('강남역');
      expect(result.finalizedLocation).toBe('강남역');
    });

    it('비생성자 멤버가 장소 투표를 닫으면 403(finalize 미실행, location 불변)', async () => {
      const service = makeService();
      setMember('moim-A', 'creator');
      setMember('moim-A', 'other-member');
      const { poll, options } = seedPoll(
        'moim-A',
        '장소 투표',
        ['강남역', '홍대입구'],
        false,
        'creator',
        null,
        'place',
      );
      seedVote(poll.id, options[0].id, 'member-1');
      const originalLocation = tables.moim.get('moim-A')?.location;

      await expect(
        service.closePoll('other-member', 'moim-A', poll.id),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(tables.moim.get('moim-A')?.location).toEqual(originalLocation);
    });
  });

  // ── SPEC-MOIM-008: aggregatePolls — kind + optionDate 노출 ──
  describe('aggregatePolls() — kind + optionDate 노출(REQ-MOIM8-004 / AC-4)', () => {
    it('날짜 투표 조회 시 kind="date" + optionDate 가 포함된다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const date1 = new Date('2026-06-27T12:00:00.000Z');
      const date2 = new Date('2026-06-28T12:00:00.000Z');
      seedPoll(
        'moim-A',
        '날짜 투표',
        [date1.toISOString(), date2.toISOString()],
        false,
        'owner',
        null,
        'date',
        [date1, date2],
      );

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].kind).toBe('date');
      expect(polls[0].options[0].optionDate).toEqual(date1);
      expect(polls[0].options[1].optionDate).toEqual(date2);
      // list 응답의 finalize 필드는 항상 null 이다.
      expect(polls[0].finalizedStartsAt).toBeNull();
      expect(polls[0].finalizeSkippedReason).toBeNull();
    });

    it('일반 투표 조회 시 kind="general" + optionDate=null', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      seedPoll('moim-A', '일반 투표', ['A', 'B']);

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].kind).toBe('general');
      expect(polls[0].options.every((o) => o.optionDate === null)).toBe(true);
    });
  });

  // ── SPEC-MOIM-007: isClosed 서버 계산 ──
  describe('aggregatePolls() — isClosed 서버 계산(REQ-MOIM7-005 / AC-5)', () => {
    it('closesAt=null 이면 isClosed:false', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      seedPoll('moim-A', '열린 poll', ['A', 'B'], false, 'owner', null);

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].isClosed).toBe(false);
      expect(polls[0].closesAt).toBeNull();
    });

    it('closesAt 가 미래이면 isClosed:false', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const future = new Date(Date.now() + 86400000);
      seedPoll('moim-A', '미래 마감', ['A', 'B'], false, 'owner', future);

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].isClosed).toBe(false);
      expect(polls[0].closesAt).toEqual(future);
    });

    it('closesAt<=now 이면 isClosed:true', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const past = new Date(NOW.getTime() - 1000);
      seedPoll('moim-A', '마감됨', ['A', 'B'], false, 'owner', past);

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].isClosed).toBe(true);
      expect(polls[0].closesAt).toEqual(past);
    });

    it('마감된 poll 도 voteCount/myVotes 결과 조회가 가능하다', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');
      const past = new Date(NOW.getTime() - 1000);
      const { poll, options } = seedPoll(
        'moim-A',
        '마감됨',
        ['A', 'B'],
        false,
        'owner',
        past,
      );
      seedVote(poll.id, options[0].id, 'member-1');

      const polls = await service.listPolls('member-1', 'moim-A');

      expect(polls[0].isClosed).toBe(true);
      expect(polls[0].myVotes).toEqual([options[0].id]);
      expect(
        polls[0].options.find((o) => o.id === options[0].id)?.voteCount,
      ).toBe(1);
    });
  });

  // ── SPEC-NOTIFICATIONS-001 M2: 도메인 이벤트 발행 ──────────────────────────────
  // createPoll → poll.created(멤버-actor), closePoll 신규 마감 → poll.closed(멤버-actor).
  // 멱등 재close/authz 실패는 미발행. 날짜/장소 finalize 여도 poll.closed 하나만(schedule.confirmed 추가 발행 안 함).
  describe('M2 이벤트 발행 (SPEC-NOTIFICATIONS-001)', () => {
    it('createPoll 성공 시 moim.poll.created 를 1회 발행한다(pollId/question 포함)', async () => {
      const service = makeService();
      setMember('moim-A', 'member-1');

      const poll = await service.createPoll(
        'member-1',
        'moim-A',
        '점심?',
        ['김밥', '라면'],
        false,
      );

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_POLL_CREATED, {
        moimId: 'moim-A',
        actorId: 'member-1',
        pollId: poll.id,
        question: '점심?',
      });
    });

    it('closePoll 신규 마감 시 moim.poll.closed 를 1회 발행한다(pollId/question 포함)', async () => {
      const service = makeService();
      setMember('moim-A', 'owner');
      const { poll } = seedPoll(
        'moim-A',
        '언제 만날까?',
        ['A', 'B'],
        false,
        'owner',
      );

      await service.closePoll('owner', 'moim-A', poll.id);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_POLL_CLOSED, {
        moimId: 'moim-A',
        actorId: 'owner',
        pollId: poll.id,
        question: '언제 만날까?',
      });
    });

    it('이미 마감된 poll 재close(멱등)는 발행하지 않는다', async () => {
      const service = makeService();
      setMember('moim-A', 'owner');
      const past = new Date(NOW.getTime() - 1000);
      const { poll } = seedPoll(
        'moim-A',
        '이미마감',
        ['A', 'B'],
        false,
        'owner',
        past,
      );

      await service.closePoll('owner', 'moim-A', poll.id);

      expect(emit).not.toHaveBeenCalled();
    });

    it('날짜 투표 close(finalize) 여도 poll.closed 하나만 발행한다(schedule.confirmed 추가 발행 안 함)', async () => {
      const service = makeService();
      setMember('moim-A', 'owner');
      const d0 = new Date('2026-07-10T10:00:00.000Z');
      const d1 = new Date('2026-07-11T10:00:00.000Z');
      const { poll, options } = seedPoll(
        'moim-A',
        '날짜 투표',
        [d0.toISOString(), d1.toISOString()],
        false,
        'owner',
        null,
        'date',
        [d0, d1],
      );
      // 단일 승자(옵션0)를 만들어 finalize 가 실제로 일어나게 한다.
      seedVote(poll.id, options[0].id, 'owner');

      await service.closePoll('owner', 'moim-A', poll.id);

      // 정확히 1회, poll.closed 만(schedule.* 이벤트 미발행).
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(
        MOIM_POLL_CLOSED,
        expect.objectContaining({ moimId: 'moim-A', pollId: poll.id }),
      );
    });

    it('비생성자 close(403) 경로는 발행하지 않는다', async () => {
      const service = makeService();
      setMember('moim-A', 'owner');
      setMember('moim-A', 'member-2');
      const { poll } = seedPoll('moim-A', 'q', ['A', 'B'], false, 'owner');

      await expect(
        service.closePoll('member-2', 'moim-A', poll.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(emit).not.toHaveBeenCalled();
    });

    it('createPoll authz 실패(비멤버 403) 경로는 발행하지 않는다', async () => {
      const service = makeService();
      // 모임은 존재하되 stranger 는 멤버 아님 → assertMember 가 403.
      setMember('moim-A', 'owner');

      await expect(
        service.createPoll('stranger', 'moim-A', 'q', ['A', 'B'], false),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
