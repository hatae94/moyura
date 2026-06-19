import { BadRequestException } from '@nestjs/common';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { PollController } from './poll.controller';
import type { PollWithResults, PollService } from './poll.service';

// PollController 단위 테스트(SPEC-MOIM-006 — MOIM-005 확장). PollService 는 mock 으로 대체해 라우팅 + DTO 매핑
// (multiSelect + myVotes) + 수동 400 검증(C-1: class-validator/ValidationPipe 부재)만 검증한다. 401/403/404
// 가드/인가 배선은 poll.integration.spec.ts(AppModule + 실제 가드)에서 검증한다.

const USER: VerifiedUser = { sub: 'sub-U', role: 'authenticated' };

const POLL_RESULT: PollWithResults = {
  id: 'poll-1',
  question: '점심?',
  createdBy: 'sub-U',
  createdAt: new Date('2026-06-20T00:00:00.000Z'),
  multiSelect: false,
  options: [
    { id: 'opt-A', label: '김밥', voteCount: 2 },
    { id: 'opt-B', label: '라면', voteCount: 0 },
  ],
  myVotes: ['opt-A'],
};

const POLL_DTO = {
  id: 'poll-1',
  question: '점심?',
  createdBy: 'sub-U',
  createdAt: '2026-06-20T00:00:00.000Z',
  multiSelect: false,
  options: [
    { id: 'opt-A', label: '김밥', voteCount: 2 },
    { id: 'opt-B', label: '라면', voteCount: 0 },
  ],
  myVotes: ['opt-A'],
};

function makeService(createdMultiSelect = false): {
  service: PollService;
  mocks: {
    createPoll: jest.Mock;
    vote: jest.Mock;
    listPolls: jest.Mock;
  };
} {
  // createPoll 은 Poll & { options } 를 반환(컨트롤러가 PollWithResults 형태로 매핑하므로 결과형 stub).
  const mocks = {
    createPoll: jest.fn().mockResolvedValue({
      id: 'poll-1',
      moimId: 'moim-A',
      question: '점심?',
      multiSelect: createdMultiSelect,
      createdBy: 'sub-U',
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      options: [
        { id: 'opt-A', pollId: 'poll-1', label: '김밥' },
        { id: 'opt-B', pollId: 'poll-1', label: '라면' },
      ],
    }),
    vote: jest.fn().mockResolvedValue(POLL_RESULT),
    listPolls: jest.fn().mockResolvedValue([POLL_RESULT]),
  };
  return { service: mocks as unknown as PollService, mocks };
}

describe('PollController', () => {
  describe('POST /moims/:id/polls (create, REQ-MOIM6-002 / AC-2)', () => {
    it('question + 유효 옵션 ≥2 로 createPoll(multiSelect 기본 false)을 호출하고 DTO 를 반환한다(201)', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      const res = await controller.create(USER, 'moim-A', {
        question: '점심?',
        options: ['김밥', '라면'],
      });

      // multiSelect 생략 → false 로 정규화해 전달한다.
      expect(mocks.createPoll).toHaveBeenCalledWith(
        'sub-U',
        'moim-A',
        '점심?',
        ['김밥', '라면'],
        false,
      );
      // 갓 생성된 poll 은 투표 0 + myVotes 빈 배열 + multiSelect:false 로 매핑된다.
      expect(res.id).toBe('poll-1');
      expect(res.question).toBe('점심?');
      expect(res.multiSelect).toBe(false);
      expect(res.options).toEqual([
        { id: 'opt-A', label: '김밥', voteCount: 0 },
        { id: 'opt-B', label: '라면', voteCount: 0 },
      ]);
      expect(res.myVotes).toEqual([]);
      expect(res.createdAt).toBe('2026-06-20T00:00:00.000Z');
    });

    it('multiSelect:true 를 전달하면 그 값으로 createPoll 을 호출하고 multiSelect:true DTO 를 반환한다', async () => {
      const { service, mocks } = makeService(true);
      const controller = new PollController(service);

      const res = await controller.create(USER, 'moim-A', {
        question: '가능한 날짜?',
        options: ['토', '일'],
        multiSelect: true,
      });

      expect(mocks.createPoll).toHaveBeenCalledWith(
        'sub-U',
        'moim-A',
        '가능한 날짜?',
        ['토', '일'],
        true,
      );
      expect(res.multiSelect).toBe(true);
      expect(res.myVotes).toEqual([]);
    });

    it('빈 옵션 항목은 무시하고 trim 후 유효 항목만 전달한다', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      await controller.create(USER, 'moim-A', {
        question: '  점심?  ',
        options: ['  김밥 ', '', '   ', '라면'],
      });

      expect(mocks.createPoll).toHaveBeenCalledWith(
        'sub-U',
        'moim-A',
        '점심?',
        ['김밥', '라면'],
        false,
      );
    });

    it('question 이 빈 문자열이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          question: '   ',
          options: ['A', 'B'],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createPoll).not.toHaveBeenCalled();
    });

    it('유효 옵션이 1개뿐이면 400, 서비스 미호출(최소 2 선택지)', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          question: '점심?',
          options: ['김밥', '   '],
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createPoll).not.toHaveBeenCalled();
    });

    it('options 가 배열이 아니면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      await expect(
        controller.create(USER, 'moim-A', {
          question: '점심?',
        } as unknown as { question: string; options: string[] }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createPoll).not.toHaveBeenCalled();
    });
  });

  describe('GET /moims/:id/polls (list, REQ-MOIM5-004 / AC-4)', () => {
    it('listPolls 결과를 DTO 배열로 매핑해 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      const res = await controller.list(USER, 'moim-A');

      expect(mocks.listPolls).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res).toEqual([POLL_DTO]);
    });
  });

  describe('POST /moims/:id/polls/:pollId/vote (vote, REQ-MOIM5-003 / AC-3)', () => {
    it('optionId 로 vote 를 호출하고 갱신된 poll DTO 를 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      const res = await controller.vote(USER, 'moim-A', 'poll-1', {
        optionId: 'opt-A',
      });

      expect(mocks.vote).toHaveBeenCalledWith(
        'sub-U',
        'moim-A',
        'poll-1',
        'opt-A',
      );
      expect(res).toEqual(POLL_DTO);
    });

    it('optionId 가 빈 문자열이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new PollController(service);

      await expect(
        controller.vote(USER, 'moim-A', 'poll-1', { optionId: '   ' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.vote).not.toHaveBeenCalled();
    });
  });
});
