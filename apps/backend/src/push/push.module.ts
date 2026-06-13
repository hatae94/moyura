import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceTokenController } from './device-token.controller';
import { DeviceTokenService } from './device-token.service';
import { FcmSender } from './fcm-sender';
import { PushListener } from './push.listener';

// @MX:NOTE: [AUTO] 푸시 도메인 모듈(SPEC-CHAT-002 / REQ-PUSH-004 AC-3 — 단방향 결합).
// AuthModule을 import해 SupabaseAuthGuard를 주입받고 DeviceTokenController(POST/DELETE /devices)에
// per-route로 적용한다(401). PushListener는 app.module의 EventEmitterModule.forRoot()가 전역 공급하는
// EventEmitter2 디스패치로 chat.message.created를 @OnEvent 구독한다(chat은 push를 인식하지 않음 — 느슨한 결합).
// PrismaService는 global이라 재import 불필요. 이 모듈은 chat으로 아무것도 export하지 않는다(역방향 의존 0).
// app.module은 이 모듈을 ChatModule 뒤에 import한다(의존 방향: push → chat-events 계약, 단방향).
@Module({
  imports: [AuthModule],
  controllers: [DeviceTokenController],
  providers: [DeviceTokenService, FcmSender, PushListener],
})
export class PushModule {}
