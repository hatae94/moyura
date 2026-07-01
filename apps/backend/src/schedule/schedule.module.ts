import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

// @MX:NOTE: [AUTO] 일정 조율 도메인 모듈(SPEC-SCHEDULE-001). ExpenseModule 선례 — AuthModule + MoimModule import.
// MoimModule(assertOwner/assertMember 단일 출처)에 의존. PrismaService 는 global 이라 재import 불필요.
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
})
export class ScheduleModule {}
