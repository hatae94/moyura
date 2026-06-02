import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

// @MX:ANCHOR: [AUTO] PrismaService is the single DB access seam for the backend.
// @MX:REASON: Extends the Prisma 7 generated client with the pg driver adapter;
// every DB consumer (health probe, future domain modules) depends on this contract.
//
// Prisma 7 requires a driver adapter at runtime — the pooled DATABASE_URL is wired
// through PrismaPg here, while migrations use DIRECT_URL via prisma.config.ts (R-B5).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
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
}
