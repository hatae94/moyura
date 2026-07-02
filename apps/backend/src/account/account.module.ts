import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import {
  SupabaseAdminClient,
  SupabaseAdminClientImpl,
} from './supabase-admin.client';

// @MX:NOTE: [AUTO] 회원 탈퇴 도메인 모듈(SPEC-ACCOUNT-001 T-07). AuthModule 을 import 해 SupabaseAuthGuard 를,
// MoimModule 을 import 해 MoimService(transferOwner/deleteMoim — 소유자 고아화 방지 재사용)를 주입받는다
// (account→moim 단방향, moim→account back-edge 0). SupabaseAdminClient 는 추상 클래스(DI 토큰)라
// useClass 로 구현체를 바인딩한다 — jest mock 오버라이드가 가능한 seam. account 는 SafetyModule 을 import
// 하지 않는다(R-15 비순환) — safety 고아 행 정리는 AccountService 가 prisma.block/report 를 직접 접근한다.
// PrismaService·ConfigService 는 global 이라 재import 불필요.
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [AccountController],
  providers: [
    AccountService,
    { provide: SupabaseAdminClient, useClass: SupabaseAdminClientImpl },
  ],
})
export class AccountModule {}
