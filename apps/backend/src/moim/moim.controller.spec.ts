import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Moim, MoimMember } from '../generated/prisma/client';
import type { VerifiedUser } from '../auth/token-verifier.service';
import type { PollWithResults } from '../poll/poll.service';
import type { PollService } from '../poll/poll.service';
import type { ScheduleEventWithSlots } from '../schedule/schedule.service';
import type { ScheduleService } from '../schedule/schedule.service';
import { MoimController } from './moim.controller';
import type { MoimService } from './moim.service';

// MoimController 단위 테스트(SPEC-MOIM-001). MoimService는 mock으로 대체해 라우팅 + DTO 매핑 +
// 수동 400 검증(C-1: class-validator/ValidationPipe 부재)만 검증한다. 401/403/404 가드/인가 배선은
// moim.integration.spec.ts(AppModule + 실제 가드)에서 검증한다.

const USER: VerifiedUser = { sub: 'sub-U', role: 'authenticated' };

const MOIM: Moim = {
  id: 'moim-A',
  name: '모임 A',
  startsAt: null,
  location: null,
  maxMembers: 15,
  budget: null,
  createdBy: 'sub-U',
  createdAt: new Date('2026-06-13T00:00:00.000Z'),
};

// SPEC-MOIM-004 AC-2/AC-3: 일정/장소가 채워진 모임(직렬화 검증용).
const MOIM_WITH_EVENT: Moim = {
  id: 'moim-E',
  name: '이벤트 모임',
  startsAt: new Date('2026-07-01T10:00:00.000Z'),
  location: '강남역 스타벅스',
  maxMembers: 15,
  budget: null,
  createdBy: 'sub-U',
  createdAt: new Date('2026-06-13T00:00:00.000Z'),
};

function makeService(): {
  service: MoimService;
  mocks: {
    createMoim: jest.Mock;
    listMyMoims: jest.Mock;
    getMoim: jest.Mock;
    listMembers: jest.Mock;
    deleteMoim: jest.Mock;
    leave: jest.Mock;
    kickMember: jest.Mock;
    transferOwner: jest.Mock;
  };
} {
  const mocks = {
    createMoim: jest.fn().mockResolvedValue(MOIM),
    listMyMoims: jest.fn().mockResolvedValue([MOIM]),
    getMoim: jest.fn().mockResolvedValue(MOIM),
    listMembers: jest.fn().mockResolvedValue([]),
    deleteMoim: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
    kickMember: jest.fn().mockResolvedValue(undefined),
    transferOwner: jest.fn().mockResolvedValue(undefined),
  };
  return { service: mocks as unknown as MoimService, mocks };
}

// SPEC-MOIM-DETAIL-001: 상세 집계 라우트는 PollService/ScheduleService 도 주입받으므로 컨트롤러 생성에
// 세 서비스가 모두 필요하다. 기존 단건 라우트 테스트는 poll/schedule 을 호출하지 않으므로 no-op mock 으로
// 채워도 무방하다 — new MoimController(service) 단일 인자 호출을 이 팩토리로 대체한다.
function makeController(service: MoimService): MoimController {
  const pollService = {
    listPolls: jest.fn().mockResolvedValue([]),
  } as unknown as PollService;
  const scheduleService = {
    getSchedule: jest.fn().mockResolvedValue(null),
  } as unknown as ScheduleService;
  return new MoimController(service, pollService, scheduleService);
}

describe('MoimController', () => {
  describe('POST /moims (createMoim, REQ-MOIM-004 / AC-1)', () => {
    it('검증된 sub + name + nickname으로 createMoim을 호출하고 DTO를 반환한다(일정/장소 미포함 → null)', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.create(USER, {
        name: '모임 A',
        nickname: '호스트',
      });

      // SPEC-MOIM-004 AC-2: startsAt/location 미포함 → service 에 undefined 전달.
      expect(mocks.createMoim).toHaveBeenCalledWith(
        'sub-U',
        '모임 A',
        '호스트',
        undefined,
        undefined,
        undefined,
      );
      expect(res).toEqual({
        id: 'moim-A',
        name: '모임 A',
        startsAt: null,
        location: null,
        maxMembers: 15,
        budget: null,
        createdBy: 'sub-U',
        createdAt: '2026-06-13T00:00:00.000Z',
      });
    });

    // SPEC-MOIM-004 AC-2: optional 일정/장소 포함 생성 → service 가 Date/문자열로 받고 DTO 가 두 필드 직렬화.
    it('startsAt(ISO)/location 포함 생성 시 Date/문자열로 service 에 전달하고 DTO 에 두 필드를 반환한다', async () => {
      const { service, mocks } = makeService();
      mocks.createMoim.mockResolvedValueOnce(MOIM_WITH_EVENT);
      const controller = makeController(service);

      const res = await controller.create(USER, {
        name: '이벤트 모임',
        nickname: '호스트',
        startsAt: '2026-07-01T10:00:00.000Z',
        location: '강남역 스타벅스',
      });

      expect(mocks.createMoim).toHaveBeenCalledWith(
        'sub-U',
        '이벤트 모임',
        '호스트',
        new Date('2026-07-01T10:00:00.000Z'),
        '강남역 스타벅스',
        undefined,
      );
      expect(res).toEqual({
        id: 'moim-E',
        name: '이벤트 모임',
        startsAt: '2026-07-01T10:00:00.000Z',
        location: '강남역 스타벅스',
        maxMembers: 15,
        budget: null,
        createdBy: 'sub-U',
        createdAt: '2026-06-13T00:00:00.000Z',
      });
    });

    // SPEC-MOIM-004 AC-2(Unwanted): startsAt 이 유효 ISO 가 아니면 400, service 미호출.
    it('startsAt 이 무효 문자열이면 400(BadRequestException), 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      await expect(
        controller.create(USER, {
          name: '모임 A',
          nickname: '호스트',
          startsAt: 'not-a-date',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createMoim).not.toHaveBeenCalled();
    });

    // SPEC-MOIM-004 AC-2: 빈 location 은 검증 대상이 아니라 null 로 흘러간다(undefined 전달).
    it('빈 startsAt/location 은 검증하지 않고 service 에 undefined 로 전달한다', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      await controller.create(USER, {
        name: '모임 A',
        nickname: '호스트',
        startsAt: '',
        location: '   ',
      });

      expect(mocks.createMoim).toHaveBeenCalledWith(
        'sub-U',
        '모임 A',
        '호스트',
        undefined,
        undefined,
        undefined,
      );
    });

    it('name이 빈 문자열이면 400(BadRequestException), 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      await expect(
        controller.create(USER, { name: '   ', nickname: '호스트' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createMoim).not.toHaveBeenCalled();
    });

    it('nickname이 빈 문자열이면 400(BadRequestException), 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      await expect(
        controller.create(USER, { name: '모임 A', nickname: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createMoim).not.toHaveBeenCalled();
    });

    it('nickname이 누락되면 400(BadRequestException), 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      await expect(
        controller.create(USER, {
          name: '모임 A',
        } as unknown as { name: string; nickname: string }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createMoim).not.toHaveBeenCalled();
    });
  });

  describe('GET /moims (listMyMoims, REQ-MOIM-005 / AC-6)', () => {
    it('검증된 sub로 listMyMoims를 호출하고 DTO 배열을 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.list(USER);

      expect(mocks.listMyMoims).toHaveBeenCalledWith('sub-U');
      expect(res).toEqual([
        {
          id: 'moim-A',
          name: '모임 A',
          startsAt: null,
          location: null,
          maxMembers: 15,
          budget: null,
          createdBy: 'sub-U',
          createdAt: '2026-06-13T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('GET /moims/:id (getMoim, REQ-MOIM-005 / AC-6)', () => {
    it('검증된 sub + moimId로 getMoim을 호출하고 DTO를 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.getOne(USER, 'moim-A');

      expect(mocks.getMoim).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res.id).toBe('moim-A');
    });
  });

  describe('GET /moims/:id/members (listMembers, REQ-MOIM-006 / AC-5)', () => {
    it('멤버 엔티티를 nickname 포함 DTO로 매핑해 반환한다', async () => {
      const { service, mocks } = makeService();
      const members: MoimMember[] = [
        {
          moimId: 'moim-A',
          userId: 'sub-U',
          nickname: '호스트',
          role: 'owner',
          joinedAt: new Date('2026-06-13T00:00:00.000Z'),
          withdrawnAt: null,
        },
      ];
      mocks.listMembers.mockResolvedValueOnce(members);
      const controller = makeController(service);

      const res = await controller.getMembers(USER, 'moim-A');

      expect(mocks.listMembers).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res).toEqual([
        {
          userId: 'sub-U',
          nickname: '호스트',
          role: 'owner',
          joinedAt: '2026-06-13T00:00:00.000Z',
        },
      ]);
    });
  });

  describe('DELETE /moims/:id (deleteMoim, REQ-MOIM-003 / AC-7)', () => {
    it('검증된 sub + moimId로 deleteMoim을 호출한다(204, 본문 없음)', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.remove(USER, 'moim-A');

      expect(mocks.deleteMoim).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res).toBeUndefined();
    });
  });

  describe('DELETE /moims/:id/membership (leave, REQ-MOIM-007/008 / AC-4/AC-8)', () => {
    it('검증된 sub + moimId로 leave를 호출한다(204, 본문 없음)', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.leave(USER, 'moim-A');

      expect(mocks.leave).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res).toBeUndefined();
    });
  });

  describe('DELETE /moims/:moimId/members/:userId (kick)', () => {
    it('검증된 sub + moimId + targetUserId로 kickMember를 호출한다(204, 본문 없음)', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.kick(USER, 'moim-A', 'sub-target');

      expect(mocks.kickMember).toHaveBeenCalledWith(
        'sub-U',
        'moim-A',
        'sub-target',
      );
      expect(res).toBeUndefined();
    });
  });

  describe('POST /moims/:moimId/owner (transferOwner)', () => {
    it('검증된 sub + moimId + body.userId로 transferOwner를 호출한다(204, 본문 없음)', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      const res = await controller.transferOwner(USER, 'moim-A', {
        userId: 'sub-target',
      });

      expect(mocks.transferOwner).toHaveBeenCalledWith(
        'sub-U',
        'moim-A',
        'sub-target',
      );
      expect(res).toBeUndefined();
    });

    it('body.userId 가 누락(undefined)이면 서비스에 빈 문자열을 전달한다(서비스가 400 처리)', async () => {
      const { service, mocks } = makeService();
      const controller = makeController(service);

      await controller.transferOwner(USER, 'moim-A', {} as { userId: string });

      // 컨트롤러는 body?.userId ?? '' 를 그대로 전달 — 400 판정은 서비스 책임.
      expect(mocks.transferOwner).toHaveBeenCalledWith('sub-U', 'moim-A', '');
    });
  });

  // SPEC-MOIM-DETAIL-001: GET /moims/:id/detail — 모임+멤버+투표+일정 상세 집계.
  describe('GET /moims/:id/detail (getDetail, SPEC-MOIM-DETAIL-001)', () => {
    // 집계 검증용 픽스처: 멤버 1명 + 투표 1건(집계 결과) + 일정 세션 1건.
    const MEMBER: MoimMember = {
      moimId: 'moim-A',
      userId: 'sub-U',
      nickname: '호스트',
      role: 'owner',
      joinedAt: new Date('2026-06-13T00:00:00.000Z'),
      withdrawnAt: null,
    };

    const POLL: PollWithResults = {
      id: 'poll-1',
      question: '다음 모임 날짜는?',
      createdBy: 'sub-U',
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      multiSelect: false,
      kind: 'general',
      options: [
        { id: 'opt-1', label: '토요일', voteCount: 2, optionDate: null },
        { id: 'opt-2', label: '일요일', voteCount: 1, optionDate: null },
      ],
      myVotes: ['opt-1'],
      closesAt: null,
      isClosed: false,
      finalizedStartsAt: null,
      finalizedLocation: null,
      finalizeSkippedReason: null,
    };

    const SCHEDULE: ScheduleEventWithSlots = {
      id: 'sched-1',
      moimId: 'moim-A',
      createdBy: 'sub-U',
      dates: ['2026-07-05', '2026-07-06'],
      startMinute: 1080,
      endMinute: 1440,
      slotMinutes: 30,
      confirmedAt: null,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      updatedAt: new Date('2026-06-20T00:00:00.000Z'),
      slots: [
        {
          scheduleEventId: 'sched-1',
          userId: 'sub-U',
          date: '2026-07-05',
          startMinute: 1080,
        },
      ],
    } as unknown as ScheduleEventWithSlots;

    // 상세 라우트 전용 컨트롤러 팩토리 — poll/schedule mock 을 명시적으로 주입해 집계 형태를 검증한다.
    function makeDetailController(): {
      controller: MoimController;
      moimMocks: {
        getMoim: jest.Mock;
        listMembers: jest.Mock;
      };
      listPolls: jest.Mock;
      getSchedule: jest.Mock;
    } {
      const getMoim = jest.fn().mockResolvedValue(MOIM);
      const listMembers = jest.fn().mockResolvedValue([MEMBER]);
      const moimService = {
        getMoim,
        listMembers,
      } as unknown as MoimService;
      const listPolls = jest.fn().mockResolvedValue([POLL]);
      const getSchedule = jest.fn().mockResolvedValue(SCHEDULE);
      const pollService = { listPolls } as unknown as PollService;
      const scheduleService = { getSchedule } as unknown as ScheduleService;
      return {
        controller: new MoimController(
          moimService,
          pollService,
          scheduleService,
        ),
        moimMocks: { getMoim, listMembers },
        listPolls,
        getSchedule,
      };
    }

    it('멤버에게 모임+멤버+투표+일정을 개별 엔드포인트와 byte-identical 하게 합쳐 반환한다(200)', async () => {
      const { controller, moimMocks, listPolls, getSchedule } =
        makeDetailController();

      const res = await controller.getDetail(USER, 'moim-A');

      // 게이트(getMoim) + 세 조회 모두 user.sub + id 로 호출된다(myVotes 는 호출자 기준).
      expect(moimMocks.getMoim).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(moimMocks.listMembers).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(listPolls).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(getSchedule).toHaveBeenCalledWith('sub-U', 'moim-A');

      // moim: toMoimDto 형태(GET /moims/:id 동일).
      expect(res.moim).toEqual({
        id: 'moim-A',
        name: '모임 A',
        startsAt: null,
        location: null,
        maxMembers: 15,
        budget: null,
        createdBy: 'sub-U',
        createdAt: '2026-06-13T00:00:00.000Z',
      });
      // members: toMemberDto 형태(GET /moims/:id/members 동일).
      expect(res.members).toEqual([
        {
          userId: 'sub-U',
          nickname: '호스트',
          role: 'owner',
          joinedAt: '2026-06-13T00:00:00.000Z',
        },
      ]);
      // polls: resultToDto 형태(GET /moims/:id/polls 동일 — voteCount + myVotes + finalize null).
      expect(res.polls).toEqual([
        {
          id: 'poll-1',
          question: '다음 모임 날짜는?',
          createdBy: 'sub-U',
          createdAt: '2026-06-20T00:00:00.000Z',
          multiSelect: false,
          kind: 'general',
          options: [
            { id: 'opt-1', label: '토요일', voteCount: 2, optionDate: null },
            { id: 'opt-2', label: '일요일', voteCount: 1, optionDate: null },
          ],
          myVotes: ['opt-1'],
          closesAt: null,
          isClosed: false,
          finalizedStartsAt: null,
          finalizedLocation: null,
          finalizeSkippedReason: null,
        },
      ]);
      // schedule: GET /moims/:id/schedule 의 body({ schedule })와 동일하게 감싼다.
      expect(res.schedule).toEqual({
        schedule: {
          id: 'sched-1',
          moimId: 'moim-A',
          createdBy: 'sub-U',
          dates: ['2026-07-05', '2026-07-06'],
          startMinute: 1080,
          endMinute: 1440,
          slotMinutes: 30,
          confirmedAt: null,
          slots: [{ userId: 'sub-U', date: '2026-07-05', startMinute: 1080 }],
        },
      });
    });

    it('투표 없음/일정 미설정은 500 없이 [] / { schedule: null } 로 반환한다(graceful)', async () => {
      const { controller, listPolls, getSchedule } = makeDetailController();
      listPolls.mockResolvedValueOnce([]);
      getSchedule.mockResolvedValueOnce(null);

      const res = await controller.getDetail(USER, 'moim-A');

      expect(res.polls).toEqual([]);
      expect(res.schedule).toEqual({ schedule: null });
    });

    it('비멤버면 게이트(getMoim)가 던진 403 을 전파하고 후속 조회를 하지 않는다', async () => {
      const { controller, moimMocks, listPolls, getSchedule } =
        makeDetailController();
      moimMocks.getMoim.mockRejectedValueOnce(new ForbiddenException());

      await expect(controller.getDetail(USER, 'moim-A')).rejects.toThrow(
        ForbiddenException,
      );
      // 게이트 실패 시 members/polls/schedule 은 호출되지 않는다(인가 약화 없음).
      expect(moimMocks.listMembers).not.toHaveBeenCalled();
      expect(listPolls).not.toHaveBeenCalled();
      expect(getSchedule).not.toHaveBeenCalled();
    });

    it('없는 모임이면 게이트(getMoim)가 던진 404 를 전파하고 후속 조회를 하지 않는다', async () => {
      const { controller, moimMocks, listPolls, getSchedule } =
        makeDetailController();
      moimMocks.getMoim.mockRejectedValueOnce(new NotFoundException());

      await expect(controller.getDetail(USER, 'moim-A')).rejects.toThrow(
        NotFoundException,
      );
      expect(moimMocks.listMembers).not.toHaveBeenCalled();
      expect(listPolls).not.toHaveBeenCalled();
      expect(getSchedule).not.toHaveBeenCalled();
    });
  });
});
