import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimController } from './moim.controller';
import { MoimService } from './moim.service';

// @MX:NOTE: [AUTO] 모임 도메인 모듈(SPEC-MOIM-001). AuthModule을 import해 SupabaseAuthGuard를 주입받고
// MoimController 6개 라우트에 per-route로 적용한다(REQ-MOIM-001). PrismaService는 global이라 재import 불필요.
// MoimService를 export해 하위 SPEC(CHAT-001/CHAT-002/MOIM-002)이 assertMember/assertOwner 인가 단일
// 출처를 재사용할 수 있게 한다(@MX:ANCHOR fan_in 경계). owner 자동 가입(createMoim)이 이 경계의 진입점이다.
@Module({
  imports: [AuthModule],
  controllers: [MoimController],
  providers: [MoimService],
  exports: [MoimService],
})
export class MoimModule {}
