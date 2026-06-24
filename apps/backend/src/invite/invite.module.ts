import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import {
  InviteAcceptController,
  InvitePublicController,
  MoimInviteController,
} from './invite.controller';
import { InviteService } from './invite.service';

// @MX:NOTE: [AUTO] 초대 도메인 모듈(SPEC-MOIM-002). AuthModule을 import해 SupabaseAuthGuard를 주입받고,
// MoimModule을 import해 MoimService.assertOwner(owner 인가 단일 출처, MOIM-001)를 재사용한다(재구현 금지).
// PrismaService는 global이라 재import 불필요. 3개 컨트롤러를 등록한다:
//   - MoimInviteController: 관리 /moims/:id/invites (인증 필요, owner 전용)
//   - InvitePublicController: 공개 GET /invites/:token (인증 불필요, SPEC-MOIM-011)
//   - InviteAcceptController: 수락 POST /invites/:token/accept (인증 필요)
// 공개 컨트롤러를 수락 컨트롤러 앞에 등록해 NestJS 라우터가 GET을 먼저 매칭한다.
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [
    MoimInviteController,
    InvitePublicController,
    InviteAcceptController,
  ],
  providers: [InviteService],
})
export class InviteModule {}
