import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { SafetyModule } from '../safety/safety.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

// @MX:NOTE: [AUTO] 일정 조율 도메인 모듈(SPEC-SCHEDULE-001). ExpenseModule 선례 — AuthModule + MoimModule import.
// MoimModule(assertOwner/assertMember 단일 출처)에 의존. PrismaService 는 global 이라 재import 불필요.
// SPEC-SAFETY-001 T-007: SafetyModule 을 import 해 SafetyService(getHiddenUserIds)를 주입받는다 — schedule→
// safety 단방향(REQ-CPL-002). getSchedule 이 히트맵 응답에서 뷰어 측 숨김 슬롯 제외(REQ-FLT-004)에 사용한다.
@Module({
  imports: [AuthModule, MoimModule, SafetyModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
})
export class ScheduleModule {}
