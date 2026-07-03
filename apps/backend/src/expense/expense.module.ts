import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { SafetyModule } from '../safety/safety.module';
import { ExpenseController, SettlementController } from './expense.controller';
import { ExpenseService } from './expense.service';

// @MX:NOTE: [AUTO] 경비 도메인 모듈(SPEC-MOIM-EXPENSE-001). PollModule 선례 — AuthModule + MoimModule import.
// SettlementController 는 같은 ExpenseService 를 공유하므로 동일 모듈에 등록한다.
// PrismaService 는 global 이라 재import 불필요.
// SPEC-SAFETY-001 T-006: SafetyModule 을 import 해 SafetyService(getHiddenUserIds)를 주입받는다 — expense→safety
// 단방향(REQ-CPL-002). listExpenses 가 표시 목록의 차단 대상 작성자 마스킹(REQ-FLT-003)에 사용한다.
@Module({
  imports: [AuthModule, MoimModule, SafetyModule],
  controllers: [ExpenseController, SettlementController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
