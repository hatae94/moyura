import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MeController } from './me.controller';
import { ProfileService } from './profile.service';

// @MX:NOTE: [AUTO] profile 도메인 모듈. AuthModule을 import해 SupabaseAuthGuard를 주입받고
// MeController(/me)에 per-route로 적용한다(R-A10/OD-7). PrismaService는 global module이라 재import 불필요.
@Module({
  imports: [AuthModule],
  controllers: [MeController],
  providers: [ProfileService],
})
export class ProfileModule {}
