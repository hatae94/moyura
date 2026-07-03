import { BadRequestException } from '@nestjs/common';
import type { Moim, MoimMember } from '../generated/prisma/client';
import type { VerifiedUser } from '../auth/token-verifier.service';
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

describe('MoimController', () => {
  describe('POST /moims (createMoim, REQ-MOIM-004 / AC-1)', () => {
    it('검증된 sub + name + nickname으로 createMoim을 호출하고 DTO를 반환한다(일정/장소 미포함 → null)', async () => {
      const { service, mocks } = makeService();
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

      await expect(
        controller.create(USER, { name: '   ', nickname: '호스트' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createMoim).not.toHaveBeenCalled();
    });

    it('nickname이 빈 문자열이면 400(BadRequestException), 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new MoimController(service);

      await expect(
        controller.create(USER, { name: '모임 A', nickname: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.createMoim).not.toHaveBeenCalled();
    });

    it('nickname이 누락되면 400(BadRequestException), 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

      const res = await controller.remove(USER, 'moim-A');

      expect(mocks.deleteMoim).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res).toBeUndefined();
    });
  });

  describe('DELETE /moims/:id/membership (leave, REQ-MOIM-007/008 / AC-4/AC-8)', () => {
    it('검증된 sub + moimId로 leave를 호출한다(204, 본문 없음)', async () => {
      const { service, mocks } = makeService();
      const controller = new MoimController(service);

      const res = await controller.leave(USER, 'moim-A');

      expect(mocks.leave).toHaveBeenCalledWith('sub-U', 'moim-A');
      expect(res).toBeUndefined();
    });
  });

  describe('DELETE /moims/:moimId/members/:userId (kick)', () => {
    it('검증된 sub + moimId + targetUserId로 kickMember를 호출한다(204, 본문 없음)', async () => {
      const { service, mocks } = makeService();
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

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
      const controller = new MoimController(service);

      await controller.transferOwner(USER, 'moim-A', {} as { userId: string });

      // 컨트롤러는 body?.userId ?? '' 를 그대로 전달 — 400 판정은 서비스 책임.
      expect(mocks.transferOwner).toHaveBeenCalledWith('sub-U', 'moim-A', '');
    });
  });
});
