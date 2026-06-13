import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MoimModule } from '../moim/moim.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

// @MX:NOTE: [AUTO] 채팅 도메인 모듈(SPEC-CHAT-001). AuthModule을 import해 SupabaseAuthGuard를 주입받고
// ChatController 2개 라우트에 per-route로 적용한다(401). MoimModule을 import해 MoimService.assertMember
// 단일 출처를 재사용한다(403/404 인가 — 재구현 금지). EventEmitter2는 app.module의 EventEmitterModule.forRoot()가
// 전역 공급하므로 여기서 imports 불필요. PrismaService도 global이라 재import 불필요.
// chat-events.ts(도메인 이벤트 계약)는 export하지 않아도 CHAT-002가 직접 import한다(타입/상수는 모듈 경계 무관).
@Module({
  imports: [AuthModule, MoimModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
