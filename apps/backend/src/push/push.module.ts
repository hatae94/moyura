import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceTokenController } from './device-token.controller';
import { DeviceTokenService } from './device-token.service';
import { FcmSender } from './fcm-sender';
import { NotificationPushListener } from './notification-push.listener';
import { PushListener } from './push.listener';

// @MX:NOTE: [AUTO] 푸시 도메인 모듈(SPEC-CHAT-002 / REQ-PUSH-004 AC-3 — 단방향 결합).
// AuthModule을 import해 SupabaseAuthGuard를 주입받고 DeviceTokenController(POST/DELETE /devices)에
// per-route로 적용한다(401). PushListener는 app.module의 EventEmitterModule.forRoot()가 전역 공급하는
// EventEmitter2 디스패치로 chat.message.created를 @OnEvent 구독한다(chat은 push를 인식하지 않음 — 느슨한 결합).
// NotificationPushListener(SPEC-NOTIFICATIONS-001 M6)는 고신호 3종(member.joined·schedule.confirmed·
// settlement.completed)을 별도로 @OnEvent 구독해 FCM 으로 승격한다(인앱 NotificationListener 와 독립 구독 —
// EventEmitter2 다중 구독). PrismaService는 global이라 재import 불필요. 이 모듈은 chat/invite/schedule/expense 로
// 아무것도 export하지 않는다(역방향 의존 0 — 생산 도메인의 *-events 계약에만 단방향 의존).
@Module({
  imports: [AuthModule],
  controllers: [DeviceTokenController],
  providers: [
    DeviceTokenService,
    FcmSender,
    PushListener,
    NotificationPushListener,
  ],
})
export class PushModule {}
