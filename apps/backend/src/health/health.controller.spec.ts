import { HttpStatus } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

// pingDatabase만 모킹 — DB up/down 분기를 결정론적으로 검증한다(AC-G1/G2/G3).
const pingDatabase = jest.fn();

function createMockResponse(): {
  res: Response;
  status: jest.Mock;
  json: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status } as unknown as Response;
  return { res, status, json };
}

describe('HealthController (AC-G1 / AC-G2 / AC-G3)', () => {
  let controller: HealthController;

  beforeEach(async () => {
    pingDatabase.mockReset();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { pingDatabase } }],
    }).compile();
    controller = moduleRef.get(HealthController);
  });

  it('DB 접속 가능 시 200 { status: "ok", db: "up" }을 반환한다 (R-G2)', async () => {
    pingDatabase.mockResolvedValue(true);
    const { res, status, json } = createMockResponse();

    await controller.check(res);

    expect(status).toHaveBeenCalledWith(HttpStatus.OK);
    expect(json).toHaveBeenCalledWith({ status: 'ok', db: 'up' });
  });

  it('DB 프로브 실패 시 503 { status: "degraded", db: "down" }을 반환한다 (R-G3)', async () => {
    pingDatabase.mockRejectedValue(new Error('connection refused'));
    const { res, status, json } = createMockResponse();

    await controller.check(res);

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({ status: 'degraded', db: 'down' });
  });
});
