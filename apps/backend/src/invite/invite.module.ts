import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import {
  InviteAcceptController,
  MoimInviteController,
} from './invite.controller';
import { InviteService } from './invite.service';

// @MX:NOTE: [AUTO] 초대 도메인 모듈(SPEC-MOIM-002). AuthModule을 import해 SupabaseAuthGuard를 주입받고,
// MoimModule을 import해 MoimService.assertOwner(owner 인가 단일 출처, MOIM-001)를 재사용한다(재구현 금지).
// PrismaService는 global이라 재import 불필요. 두 컨트롤러(관리 /moims/:id/invites + 수락 /invites/:token)를
// 등록한다. 수락 라우트는 익명 로그인 sub도 동일하게 가드를 통과한다(REQ-INV-007 전제).
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [MoimInviteController, InviteAcceptController],
  providers: [InviteService],
})
export class InviteModule {}
