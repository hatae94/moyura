import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Poll, PollOption } from '../generated/prisma/client';
import { MoimService } from '../moim/moim.service';
import { PrismaService } from '../prisma/prisma.service';

// 생성된 poll + 그 옵션(투표 0 직후 상태). 컨트롤러가 PollResponseDto(voteCount:0/myVotes:[])로 매핑한다.
// Poll 타입에 multiSelect 컬럼이 생겼으므로(SPEC-MOIM-006) 그대로 흐른다.
export interface PollWithOptions extends Poll {
  options: PollOption[];
}

// 결과 집계가 포함된 poll(목록/투표 응답). 각 옵션은 voteCount(표 0 포함), myVotes 는 호출자가 고른 optionId 목록
// (단일 0/1요소·다중 0..N요소·미투표 빈 배열), multiSelect 는 poll 별 다중 선택 여부다(SPEC-MOIM-006).
export interface PollWithResults {
  id: string;
  question: string;
  createdBy: string;
  createdAt: Date;
  multiSelect: boolean;
  options: { id: string; label: string; voteCount: number }[];
  myVotes: string[];
}

@Injectable()
export class PollService {
  constructor(
    private readonly prisma: PrismaService,
    // @MX:NOTE: [AUTO] 멤버십 인가는 MOIM-001 MoimService.assertMember 단일 출처를 재사용한다(재구현 금지).
    // create/vote/list 모두 첫 줄에서 assertMember 를 호출해 비멤버 403·없는 모임 404 를 강제한다.
    private readonly moim: MoimService,
  ) {}

  // @MX:ANCHOR: [AUTO] 투표 생성의 단일 진입점(REQ-MOIM6-002 / AC-2). 컨트롤러(POST /moims/:id/polls)가 호출한다.
  // @MX:REASON: "멤버만 생성하고 poll+옵션을 항상 함께(원자) 만든다"는 불변식의 출처(createMoim 의 owner 멤버십
  // 원자 생성 선례 동일). createdBy 는 가드-검증 sub 만 받는다(mass-assignment 차단). question/options 정규화
  // (빈/<2 400)는 컨트롤러가 선처리하므로 여기서는 멤버십 + 원자 생성만 책임진다. multiSelect 는 poll 별 옵트인
  // (기본 false = 단일 선택)으로 그대로 저장한다 — 투표 의미론(교체/토글)은 vote 가 이 값으로 분기한다.
  async createPoll(
    sub: string,
    moimId: string,
    question: string,
    options: string[],
    multiSelect: boolean,
  ): Promise<PollWithOptions> {
    // 멤버십 인가(없는 모임 404, 비멤버 403). throw 시 생성에 도달하지 않는다.
    await this.moim.assertMember(sub, moimId);

    // poll + 옵션을 하나의 트랜잭션(네스티드 create)으로 생성한다 — 옵션 없는 poll 이 영속되지 않게 한다.
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.poll.create({
        data: {
          moimId,
          question,
          multiSelect,
          createdBy: sub,
          options: { create: options.map((label) => ({ label })) },
        },
        include: { options: true },
      });
      return created as PollWithOptions;
    });
  }

  // @MX:ANCHOR: [AUTO] 투표(단일 교체 / 다중 토글)의 단일 진입점(REQ-MOIM6-003 / AC-3). 컨트롤러가 호출한다.
  // @MX:REASON: poll.multiSelect 가 투표 의미론을 가른다 — 단일(false)은 "멤버당 한 표(교체)", 다중(true)은
  // "멤버당 옵션당 한 표(토글, 0..N)"다. PK 가 (pollId,optionId,userId)로 바뀌어 MOIM-005 의 (pollId,userId)
  // upsert 는 무효 → 단일은 deleteMany+create(교체), 다중은 (pollId,optionId,userId) find→delete/create(토글)로
  // 재작성한다. 인가(assertMember) → poll-모임 일관성(404) → optionId-poll 소속(400) → 분기 순서가 한 곳에
  // 모여 드리프트를 막는다. 잘못된 순서면 교차-poll 옵션이 집계를 오염시킬 수 있다(리스크 — 테스트로 고정).
  async vote(
    sub: string,
    moimId: string,
    pollId: string,
    optionId: string,
  ): Promise<PollWithResults> {
    // 멤버십 인가(없는 모임 404, 비멤버 403).
    await this.moim.assertMember(sub, moimId);

    // poll 이 path 의 moimId 에 속하는지 일관성 검증(다른 모임/미존재 poll → 404).
    const poll = await this.prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll || poll.moimId !== moimId) {
      throw new NotFoundException();
    }

    // optionId 가 그 poll 에 속한 옵션인지 검증(교차-poll/미존재 → 400, 집계 오염 차단). 단일/다중 공통.
    const option = await this.prisma.pollOption.findUnique({
      where: { id: optionId },
    });
    if (!option || option.pollId !== pollId) {
      throw new BadRequestException('optionId 가 해당 투표의 선택지가 아닙니다');
    }

    if (poll.multiSelect) {
      // 다중: (pollId,optionId,userId) 토글 — 이미 있으면 제거(off), 없으면 추가(on). 멤버 0..N 표.
      const existing = await this.prisma.pollVote.findUnique({
        where: {
          pollId_optionId_userId: { pollId, optionId, userId: sub },
        },
      });
      if (existing) {
        await this.prisma.pollVote.delete({
          where: {
            pollId_optionId_userId: { pollId, optionId, userId: sub },
          },
        });
      } else {
        await this.prisma.pollVote.create({
          data: { pollId, optionId, userId: sub },
        });
      }
    } else {
      // 단일: 교체 — 그 멤버의 그 poll 표를 모두 제거하고 선택한 한 표만 남긴다(트랜잭션, 멤버당 1표 — MOIM-005 보존).
      await this.prisma.$transaction(async (tx) => {
        await tx.pollVote.deleteMany({ where: { pollId, userId: sub } });
        await tx.pollVote.create({ data: { pollId, optionId, userId: sub } });
      });
    }

    // 갱신된 단건 poll 결과(집계 + 내 표 목록)를 반환해 web 이 재조회 없이 즉시 반영할 수 있게 한다.
    const [result] = await this.aggregatePolls(sub, [poll]);
    return result;
  }

  // 투표 목록 + 결과 조회(REQ-MOIM6-004 / AC-4). 멤버 한정 — 비멤버 403/없는 모임 404. poll 없으면 빈 배열.
  async listPolls(sub: string, moimId: string): Promise<PollWithResults[]> {
    // 멤버십 인가(비멤버에게 투표 내용 비노출).
    await this.moim.assertMember(sub, moimId);

    const polls = await this.prisma.poll.findMany({ where: { moimId } });
    if (polls.length === 0) {
      return [];
    }
    return this.aggregatePolls(sub, polls);
  }

  // poll 들에 multiSelect·옵션·voteCount(표 0 포함)·호출자 myVotes(목록)를 채워 PollWithResults 로 만든다.
  // 옵션은 결정적 키(id)로 정렬해 안정 표시한다(position 컬럼 부재 — spec §4). voteCount 는 멤버당 옵션당 한 표라
  // 그 옵션을 고른 멤버 수와 같다(다중 선택도 동일 — 옵션마다 독립 집계).
  private async aggregatePolls(
    sub: string,
    polls: Poll[],
  ): Promise<PollWithResults[]> {
    const pollIds = polls.map((p) => p.id);

    // 옵션을 한 번에 조회(표 0 옵션도 빠뜨리지 않기 위해 옵션 목록이 voteCount 의 기준이다).
    const options = await this.prisma.pollOption.findMany({
      where: { pollId: { in: pollIds } },
    });

    // 옵션별 득표 수 집계(groupBy by optionId). 표 0 옵션은 집계에 안 나오므로 옵션 목록에서 0 으로 채운다.
    const grouped = await this.prisma.pollVote.groupBy({
      by: ['optionId'],
      where: { pollId: { in: pollIds } },
      _count: { _all: true },
    });
    const countByOption = new Map<string, number>(
      grouped.map((g) => [g.optionId, g._count._all]),
    );

    // 호출자 자신의 표(pollId → optionId 목록). 다중 선택은 한 poll 에 여러 표를 가질 수 있어 목록으로 모은다.
    const mine = await this.prisma.pollVote.findMany({
      where: { pollId: { in: pollIds }, userId: sub },
    });
    const myVotesByPoll = new Map<string, string[]>();
    for (const v of mine) {
      const list = myVotesByPoll.get(v.pollId) ?? [];
      list.push(v.optionId);
      myVotesByPoll.set(v.pollId, list);
    }

    return polls.map((poll) => ({
      id: poll.id,
      question: poll.question,
      createdBy: poll.createdBy,
      createdAt: poll.createdAt,
      multiSelect: poll.multiSelect,
      options: options
        .filter((o) => o.pollId === poll.id)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((o) => ({
          id: o.id,
          label: o.label,
          voteCount: countByOption.get(o.id) ?? 0,
        })),
      myVotes: myVotesByPoll.get(poll.id) ?? [],
    }));
  }
}
