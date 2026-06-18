import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { PollController } from './poll.controller';
import { PollService } from './poll.service';

// @MX:NOTE: [AUTO] 투표 도메인 모듈(SPEC-MOIM-005). AuthModule을 import해 SupabaseAuthGuard를 주입받고
// PollController 3개 라우트에 per-route로 적용한다(401). MoimModule을 import해 MoimService.assertMember
// 단일 출처를 재사용한다(403/404 인가 — 재구현 금지, ChatModule 선례 동일). PrismaService는 global이라 재import 불필요.
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [PollController],
  providers: [PollService],
})
export class PollModule {}
