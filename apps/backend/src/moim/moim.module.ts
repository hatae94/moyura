import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PollModule } from '../poll/poll.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { MoimController } from './moim.controller';
import { MoimService } from './moim.service';

// @MX:NOTE: [AUTO] 모임 도메인 모듈(SPEC-MOIM-001). AuthModule을 import해 SupabaseAuthGuard를 주입받고
// MoimController 라우트에 per-route로 적용한다(REQ-MOIM-001). PrismaService는 global이라 재import 불필요.
// MoimService를 export해 하위 SPEC(CHAT-001/CHAT-002/MOIM-002)이 assertMember/assertOwner 인가 단일
// 출처를 재사용할 수 있게 한다(@MX:ANCHOR fan_in 경계). owner 자동 가입(createMoim)이 이 경계의 진입점이다.
// SPEC-MOIM-DETAIL-001: 상세 집계(GET /moims/:id/detail)가 PollService.listPolls/ScheduleService.getSchedule 을
// 재사용하려면 두 모듈을 import 해야 한다. Poll/Schedule 이 이미 MoimModule 을 import(assertMember 단일 출처)하므로
// 모듈 그래프에 순환이 생긴다 — Nest 표준 해법대로 양쪽 모두 forwardRef 로 감싼다. provider 주입 그래프는 여전히
// 단방향(PollService/ScheduleService→MoimService, MoimController→PollService/ScheduleService)이라 MoimService 자체는
// Poll/Schedule 을 주입받지 않는다(인가 anchor 순수성 유지 — 집계는 컨트롤러의 얇은 HTTP-층 관심사).
@Module({
  imports: [
    AuthModule,
    forwardRef(() => PollModule),
    forwardRef(() => ScheduleModule),
  ],
  controllers: [MoimController],
  providers: [MoimService],
  exports: [MoimService],
})
export class MoimModule {}
