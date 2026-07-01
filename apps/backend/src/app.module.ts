import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './chat/chat.module';
import { validateEnv } from './config/env.validation';
import { ExpenseModule } from './expense/expense.module';
import { HealthModule } from './health/health.module';
import { InviteModule } from './invite/invite.module';
import { MoimModule } from './moim/moim.module';
import { PollModule } from './poll/poll.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProfileModule } from './profile/profile.module';
import { PushModule } from './push/push.module';
import { ScheduleModule } from './schedule/schedule.module';

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
    // SPEC-MOIM-005: 투표 도메인. MoimModule(assertMember 단일 출처)에 의존하므로 MoimModule 뒤에 등록한다.
    PollModule,
    // SPEC-MOIM-EXPENSE-001: 경비 도메인. MoimModule(assertOwner/assertMember 단일 출처)에 의존.
    ExpenseModule,
    // SPEC-SCHEDULE-001: 일정 조율(When2meet 스타일). MoimModule(assertOwner/assertMember)에 의존.
    ScheduleModule,
    // SPEC-CHAT-002: 푸시는 ChatModule 뒤에 등록한다. push는 chat.message.created 이벤트 계약에만
    // 단방향 의존하고(@OnEvent 구독), chat은 push의 존재를 인식하지 않는다(REQ-PUSH-004 — 느슨한 결합 HARD).
    // FIREBASE_CREDENTIALS 부재 시 FcmSender는 no-op으로 동작해 자격증명 없이도 부팅이 성립한다(graceful degrade).
    PushModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
