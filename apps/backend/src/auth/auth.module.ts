import { Module } from '@nestjs/common';
import { SupabaseAuthGuard } from './supabase-auth.guard';
import { TokenVerifierService } from './token-verifier.service';

// @MX:NOTE: [AUTO] 인증 구성요소 모듈. TokenVerifierService(검증 경계)와 SupabaseAuthGuard(적용점)를
// 제공/내보내어, /me 같은 보호 라우트 모듈이 per-route @UseGuards로 가드를 주입받게 한다(R-A10/OD-7).
// global APP_GUARD로 등록하지 않는다 — public 누수 리스크(M-1)를 구조적으로 회피(OD-7 선택지 A).
@Module({
  providers: [TokenVerifierService, SupabaseAuthGuard],
  exports: [TokenVerifierService, SupabaseAuthGuard],
})
export class AuthModule {}
