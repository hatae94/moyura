import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';

// @MX:NOTE: [AUTO] 신고·차단 도메인 모듈(SPEC-SAFETY-001 M2 / T-004). SupabaseAuthGuard 주입을 위해 AuthModule 을
// import 하고(notification/profile 선례), M2 의 신고·차단 API(POST /reports·/blocks, DELETE /blocks/:id, GET /blocks)를
// 위한 SafetyController 를 등록한다. SafetyService 를 **exports** 해 소비 도메인(chat/poll/expense/schedule/
// notification/push)이 이 모듈만 import 하면 뷰어 측 필터(getHiddenUserIds)·발신 역방향 필터(getBlockersOf)를
// 주입받게 한다(REQ-CPL-002 — safety→도메인 단방향 금지, 도메인→safety 만 허용). PrismaService 는 global 이라 재import 불필요.
@Module({
  imports: [AuthModule],
  controllers: [SafetyController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
