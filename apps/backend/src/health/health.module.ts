import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// @MX:NOTE: [AUTO] PrismaService는 @Global PrismaModule에서 주입되므로 여기서 재import하지 않는다.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
