import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationController } from './notification.controller';
import { NotificationListener } from './notification.listener';
import { NotificationService } from './notification.service';

// @MX:NOTE: [AUTO] 알림 도메인 모듈(SPEC-NOTIFICATIONS-001 M1/M3). NotificationListener 는 app.module 의
// EventEmitterModule.forRoot()가 전역 공급하는 EventEmitter2 디스패치로 도메인 이벤트를 @OnEvent 구독한다
// (생산 도메인은 notification 을 인식하지 않음 — 느슨한 결합). M3: 읽기 API(GET 목록/unread-count, POST read)를
// 위한 NotificationController 를 등록하고, SupabaseAuthGuard 주입을 위해 AuthModule 을 import 한다(profile/schedule
// 선례). 인가는 컨트롤러가 아니라 recipientId==sub 로 NotificationService where 절에서 판정한다(MoimModule 불필요 —
// 모임명/닉네임 해석은 global PrismaService 로 직접 조회). PrismaService 는 global 이라 재import 불필요.
@Module({
  imports: [AuthModule],
  controllers: [NotificationController],
  providers: [NotificationService, NotificationListener],
})
export class NotificationModule {}
