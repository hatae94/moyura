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
  };
} {
  const mocks = {
    createMoim: jest.fn().mockResolvedValue(MOIM),
    listMyMoims: jest.fn().mockResolvedValue([MOIM]),
    getMoim: jest.fn().mockResolvedValue(MOIM),
    listMembers: jest.fn().mockResolvedValue([]),
    deleteMoim: jest.fn().mockResolvedValue(undefined),
    leave: jest.fn().mockResolvedValue(undefined),
  };
  return { service: mocks as unknown as MoimService, mocks };
}

describe('MoimController', () => {
  describe('POST /moims (createMoim, REQ-MOIM-004 / AC-1)', () => {
    it('검증된 sub + name + nickname으로 createMoim을 호출하고 DTO를 반환한다', async () => {
      const { service, mocks } = makeService();
      const controller = new MoimController(service);

      const res = await controller.create(USER, {
        name: '모임 A',
        nickname: '호스트',
      });

      expect(mocks.createMoim).toHaveBeenCalledWith(
        'sub-U',
        '모임 A',
        '호스트',
      );
      expect(res).toEqual({
        id: 'moim-A',
        name: '모임 A',
        createdBy: 'sub-U',
        createdAt: '2026-06-13T00:00:00.000Z',
      });
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
});
