import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { SafetyModule } from '../safety/safety.module';
import { PollController } from './poll.controller';
import { PollService } from './poll.service';

// @MX:NOTE: [AUTO] 투표 도메인 모듈(SPEC-MOIM-005). AuthModule을 import해 SupabaseAuthGuard를 주입받고
// PollController 3개 라우트에 per-route로 적용한다(401). MoimModule을 import해 MoimService.assertMember
// 단일 출처를 재사용한다(403/404 인가 — 재구현 금지, ChatModule 선례 동일). PrismaService는 global이라 재import 불필요.
// SPEC-SAFETY-001 T-005: SafetyModule 을 import 해 SafetyService(getHiddenUserIds)를 주입받는다 — poll→safety
// 단방향(REQ-CPL-002). listPolls 가 뷰어 측 숨김 생성자 poll 제외(REQ-FLT-002)에 사용한다.
// SPEC-MOIM-DETAIL-001: MoimController 의 상세 집계(GET /moims/:id/detail)가 PollService.listPolls 를
// 재사용하므로 MoimModule 이 이 모듈을 import 한다 — Moim↔Poll 모듈 간 순환이 생기므로 양쪽 모두 forwardRef 로
// 감싼다(provider 그래프는 여전히 단방향: PollService→MoimService 만, 역방향 없음). PollService 를 export 한다.
@Module({
  imports: [AuthModule, forwardRef(() => MoimModule), SafetyModule],
  controllers: [PollController],
  providers: [PollService],
  exports: [PollService],
})
export class PollModule {}
