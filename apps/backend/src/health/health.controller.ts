import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { HealthResponseDto } from './health-response.dto';

// @MX:ANCHOR: [AUTO] /health 는 frontend → backend → DB 배선의 end-to-end 증명 산출물(R-G4).
// @MX:REASON: 외부 시스템 통합 지점(Render health check path, 프론트 연결성 확인)이자
// DB 가용성 판정 경계. 응답 형태/상태 코드는 인프라 계약이므로 변경 시 운영 설정에 영향을 준다.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  // GET /health: DB 가용 시 200 {status:ok, db:up}, 프로브 실패 시 503 {status:degraded, db:down}.
  @Get()
  @ApiOkResponse({
    description: 'DB 접속 가능 — 정상',
    type: HealthResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'DB 접속 불가 — degraded',
    type: HealthResponseDto,
  })
  async check(@Res() res: Response): Promise<void> {
    try {
      await this.prisma.pingDatabase();
      // R-G2: DB reachable → 200 ok/up.
      res
        .status(HttpStatus.OK)
        .json({ status: 'ok', db: 'up' } satisfies HealthResponseDto);
    } catch {
      // R-G3: 프로브 실패 → 503 degraded/down (구체 에러는 노출하지 않는다).
      res
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .json({ status: 'degraded', db: 'down' } satisfies HealthResponseDto);
    }
  }
}
