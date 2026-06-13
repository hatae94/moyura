import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { MoimModule } from './moim/moim.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';

@Module({
  imports: [
    // 전역 설정 + Zod 부팅 검증 (R-B1). 검증 실패 시 validateEnv가 throw → fail-fast (R-B2).
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    HealthModule,
    ProfileModule,
    MoimModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
