import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './chat/chat.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { InviteModule } from './invite/invite.module';
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
    // SPEC-CHAT-001: 도메인 이벤트 인프라(EventEmitter2). chat.message.created 발행 + CHAT-002 구독의 기반.
    // 전역 등록이라 ChatService(발행)와 향후 PushListener(구독)가 별도 imports 없이 EventEmitter2를 주입받는다.
    EventEmitterModule.forRoot(),
    PrismaModule,
    HealthModule,
    ProfileModule,
    MoimModule,
    InviteModule,
    ChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
