import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// @MX:ANCHOR: [AUTO] PrismaService is the single DB access seam for the backend.
// @MX:REASON: Extends the Prisma 7 generated client with the pg driver adapter;
// every DB consumer (health probe, future domain modules) depends on this contract.
//
// Prisma 7 requires a driver adapter at runtime — the pooled DATABASE_URL is wired
// through PrismaPg here, while migrations use DIRECT_URL via prisma.config.ts (R-B5).
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  // @MX:NOTE: [AUTO] 연결성 프로브(R-B3/B4/B7). 도메인 모델 없이 raw `SELECT 1`만 실행한다.
  // 헬스 엔드포인트가 이 메서드로 DB 가용성을 판정한다(연결 실패 시 throw → /health가 down 처리).
  async pingDatabase(): Promise<boolean> {
    await this.$queryRaw`SELECT 1`;
    return true;
  }
}
