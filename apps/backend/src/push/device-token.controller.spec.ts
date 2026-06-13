import { BadRequestException } from '@nestjs/common';
import type { VerifiedUser } from '../auth/token-verifier.service';
import type { DeviceToken } from '../generated/prisma/client';
import { DeviceTokenController } from './device-token.controller';
import type { DeviceTokenService } from './device-token.service';

// DeviceTokenController 단위 테스트(REQ-PUSH-002/003 / AC-2). DeviceTokenService는 mock으로 대체해
// 라우팅 + register sub-only(mass-assignment 차단) + 수동 400 검증(C-1: ValidationPipe 부재)만 검증한다.
// 401 가드 배선은 push.integration 또는 가드 재사용으로 보장된다(moim 패턴 동일).

const USER: VerifiedUser = { sub: 'sub-U', role: 'authenticated' };

const ROW: DeviceToken = {
  token: 'tok-1',
  userId: 'sub-U',
  platform: 'ios',
  createdAt: new Date('2026-06-14T00:00:00.000Z'),
  updatedAt: new Date('2026-06-14T00:00:00.000Z'),
};

function makeService(): {
  service: DeviceTokenService;
  mocks: { register: jest.Mock; unregisterByOwner: jest.Mock };
} {
  const mocks = {
    register: jest.fn().mockResolvedValue(ROW),
    unregisterByOwner: jest.fn().mockResolvedValue(undefined),
  };
  return { service: mocks as unknown as DeviceTokenService, mocks };
}

describe('DeviceTokenController', () => {
  describe('POST /devices (register, REQ-PUSH-002 / AC-2)', () => {
    it('가드 sub + token + platform으로 register를 호출한다 (201, sub-only)', async () => {
      const { service, mocks } = makeService();
      const controller = new DeviceTokenController(service);

      const res = await controller.register(USER, {
        token: 'tok-1',
        platform: 'ios',
      });

      // register는 가드 sub만 받는다(body의 어떤 userId도 끼워 넣지 않음 — mass-assignment 차단).
      expect(mocks.register).toHaveBeenCalledWith('sub-U', 'tok-1', 'ios');
      expect(res).toBeUndefined();
    });

    it('token이 빈 문자열이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new DeviceTokenController(service);

      await expect(
        controller.register(USER, { token: '   ', platform: 'ios' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.register).not.toHaveBeenCalled();
    });

    it('platform이 빈 문자열이면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new DeviceTokenController(service);

      await expect(
        controller.register(USER, { token: 'tok-1', platform: '' }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.register).not.toHaveBeenCalled();
    });

    it('token이 누락되면 400, 서비스 미호출', async () => {
      const { service, mocks } = makeService();
      const controller = new DeviceTokenController(service);

      await expect(
        controller.register(USER, {
          platform: 'ios',
        } as unknown as { token: string; platform: string }),
      ).rejects.toThrow(BadRequestException);
      expect(mocks.register).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /devices/:token (unregister, REQ-PUSH-003 / AC-2)', () => {
    it('가드 sub + path token으로 owner-scoped 해제를 호출한다 (204, IDOR 차단)', async () => {
      const { service, mocks } = makeService();
      const controller = new DeviceTokenController(service);

      // 해제는 가드 sub 와 path token 을 함께 넘긴다 — 서비스가 token AND userId 로 owner-scoped 삭제한다.
      const res = await controller.unregister(USER, 'tok-1');

      expect(mocks.unregisterByOwner).toHaveBeenCalledWith('sub-U', 'tok-1');
      expect(res).toBeUndefined();
    });

    it('다른 사용자의 sub 로는 그 사용자 토큰만 owner-scoped 삭제 대상이 된다 (타인 토큰 보호)', async () => {
      const { service, mocks } = makeService();
      const controller = new DeviceTokenController(service);
      const attacker: VerifiedUser = { sub: 'sub-attacker', role: 'authenticated' };

      // 공격자가 피해자 token 문자열을 path 로 넘겨도, 서비스에는 공격자 sub 가 전달된다 →
      // deleteMany(token AND userId=공격자)는 매칭 0건(피해자 등록 보호 — IDOR 차단).
      await controller.unregister(attacker, 'tok-of-victim');

      expect(mocks.unregisterByOwner).toHaveBeenCalledWith(
        'sub-attacker',
        'tok-of-victim',
      );
    });
  });
});
