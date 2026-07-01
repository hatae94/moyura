import { Module } from '@nestjs/common';
import { NotificationListener } from './notification.listener';
import { NotificationService } from './notification.service';

// @MX:NOTE: [AUTO] 알림 도메인 모듈(SPEC-NOTIFICATIONS-001 M1 — 단방향 결합). NotificationListener 는
// app.module 의 EventEmitterModule.forRoot()가 전역 공급하는 EventEmitter2 디스패치로 moim.member.joined 를
// @OnEvent 구독한다(invite 는 notification 을 인식하지 않음 — 느슨한 결합). PrismaService 는 global 이라
// 재import 불필요. M1 은 HTTP 엔드포인트가 없어 컨트롤러/AuthModule 이 없다 — 읽기 API(GET/POST) + recipient==sub
// 인가는 M3 에서 AuthModule import 와 함께 추가된다(PushModule 처럼 app.module 뒤쪽에 등록).
@Module({
  providers: [NotificationService, NotificationListener],
})
export class NotificationModule {}
