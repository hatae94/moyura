import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { ExpenseController, SettlementController } from './expense.controller';
import { ExpenseService } from './expense.service';

// @MX:NOTE: [AUTO] 경비 도메인 모듈(SPEC-MOIM-EXPENSE-001). PollModule 선례 — AuthModule + MoimModule import.
// SettlementController 는 같은 ExpenseService 를 공유하므로 동일 모듈에 등록한다.
// PrismaService 는 global 이라 재import 불필요.
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [ExpenseController, SettlementController],
  providers: [ExpenseService],
})
export class ExpenseModule {}
