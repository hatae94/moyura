import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHAT_MESSAGE_CREATED,
  type ChatMessageCreatedPayload,
} from '../chat/chat-events';
import { PrismaService } from '../prisma/prisma.service';
import { FcmSender } from './fcm-sender';

// sender 닉네임을 해석하지 못했을 때(멤버 부재 등) 알림 제목의 안전 기본값. 빈 title을 보내지 않는다.
const DEFAULT_NOTIFICATION_TITLE = '새 메시지';

// @MX:NOTE: [AUTO] 단방향 의존 경계(REQ-PUSH-004 / AC-3). push는 chat이 export한 이벤트 계약
// (chat-events.ts: CHAT_MESSAGE_CREATED + ChatMessageCreatedPayload)만 import하고, chat은 push의 존재를
// 인식하지 않는다(chat → push import 0 — 느슨한 결합 HARD). 이벤트 페이로드에는 nickname이 없으므로
// (트리거 thin 유지) sender 표시 이름은 여기서 서버 측 멤버 조회로 해석한다(spec §2 게이트 결정).
// 수신 대상 = moim_member(moimId) − sender ⋈ device_token. 게스트(웹, 디바이스 미등록)는 device_token이
// 없어 자연 제외된다(REQ-PUSH-006). 모든 작업은 best-effort(try/catch 격리) — 발송 실패가 이미 영속된
// 메시지 전송(ChatService.emit)을 무효화하지 않는다(재시도/큐 비범위 — spec §5).
@Injectable()
export class PushListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmSender,
  ) {}

  // chat.message.created 도메인 이벤트 단방향 구독(REQ-PUSH-001/006 / AC-1,4).
  // async 리스너이므로 EventEmitter2는 결과를 await하지 않는다 — 예외가 발행 측(ChatService.emit)으로
  // 전파되지 않도록 내부에서 전 경로를 try/catch로 격리한다(best-effort).
  @OnEvent(CHAT_MESSAGE_CREATED)
  async handleChatMessageCreated(
    payload: ChatMessageCreatedPayload,
  ): Promise<void> {
    try {
      const { moimId, senderId, preview } = payload;

      // 1) 수신 대상 멤버 = 모임 멤버 − sender. sender는 자기 메시지 알림을 받지 않는다.
      const members = await this.prisma.moimMember.findMany({
        where: { moimId },
      });
      const recipientUserIds = members
        .map((m) => m.userId)
        .filter((userId) => userId !== senderId);

      // 2) 수신 대상의 등록 디바이스 토큰을 모은다. 게스트(미등록)는 여기서 자연 제외된다(REQ-PUSH-006).
      const tokens = await this.resolveDeviceTokens(recipientUserIds);

      // 3) sender 표시 이름을 서버 측 멤버 조회로 해석한다(이벤트 페이로드엔 nickname 없음 — spec §2).
      const title = await this.resolveSenderNickname(moimId, senderId);

      // 4) best-effort 발송. 토큰 0개면 FcmSender.send가 no-op으로 처리한다(발송 0건은 에러 아님).
      await this.fcm.send(
        tokens,
        { title, body: preview },
        { moimId },
      );
    } catch (err) {
      // best-effort 격리: 수신 대상 조회/닉네임 해석 실패는 로깅만(삼킴 아님). 발행 측으로 전파 금지.
      console.error(
        `[PushListener] ${CHAT_MESSAGE_CREATED} 처리 실패(best-effort, messageId=${payload.messageId}):`,
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }

  // 수신 대상 userId 집합의 등록 디바이스 토큰을 모은다. 대상이 없으면 조회 없이 빈 배열을 반환한다.
  private async resolveDeviceTokens(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
    });
    return devices.map((d) => d.token);
  }

  // (moimId, senderId) 복합키로 sender의 모임별 표시 이름(nickname)을 조회한다. 없으면 안전 기본값.
  private async resolveSenderNickname(
    moimId: string,
    senderId: string,
  ): Promise<string> {
    const sender = await this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId, userId: senderId } },
    });
    return sender?.nickname ?? DEFAULT_NOTIFICATION_TITLE;
  }
}
