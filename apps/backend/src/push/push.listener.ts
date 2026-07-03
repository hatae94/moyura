import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  CHAT_MESSAGE_CREATED,
  type ChatMessageCreatedPayload,
} from '../chat/chat-events';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
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
    // @MX:NOTE: [AUTO] 발신 역방향 필터의 숨김 소스(SPEC-SAFETY-001 REQ-FLT-006 / AC-FLT-6). push→safety 단방향
    // (PushModule 이 SafetyModule 을 import). getBlockersOf([senderId]) 로 sender 를 차단한 수신자를 얻어 FCM 대상에서
    // 차감한다 — 차단 대상의 메시지 미리보기가 차단자 잠금화면에 도달하지 않도록. block 만 억제하며 report 는 미포함
    // (신고자는 push 억제를 기대하지 않음 — getBlockersOf 가 block.findMany 만 조회). 읽기 경로(getHiddenUserIds,
    // block∪report)와 의도적으로 다른 소스를 쓴다.
    private readonly safety: SafetyService,
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

      // 1.5) 발신 역방향 차감(REQ-FLT-006): sender 를 차단한 수신자를 제외한다(A→B block → B 발신 시 A 미발신).
      // block 만 억제하며 report 는 미포함(getBlockersOf 가 block.findMany 만 조회). 잠금화면에 차단 대상 UGC 도달 방지.
      const filteredRecipientUserIds = await this.excludeBlockersOfSender(
        recipientUserIds,
        senderId,
      );

      // 2) 수신 대상의 등록 디바이스 토큰을 모은다. 게스트(미등록)는 여기서 자연 제외된다(REQ-PUSH-006).
      const tokens = await this.resolveDeviceTokens(filteredRecipientUserIds);

      // 3) sender 표시 이름을 서버 측 멤버 조회로 해석한다(이벤트 페이로드엔 nickname 없음 — spec §2).
      const title = await this.resolveSenderNickname(moimId, senderId);

      // 4) best-effort 발송. 토큰 0개면 FcmSender.send가 no-op으로 처리한다(발송 0건은 에러 아님).
      await this.fcm.send(tokens, { title, body: preview }, { moimId });
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

  // 발신 역방향 차감(REQ-FLT-006): recipient 중 sender 를 차단한 사람(blocker)을 제외한다. getBlockersOf 를
  // 요청당 1회만 조회한다(N+1 회피). 수신 대상이 없으면 safety 왕복 없이 그대로 반환한다(불필요 조회 회피).
  // safety 조회 실패는 여기서 격리(fail-open) — 차감을 포기하고 원본 수신 대상을 반환해 발송을 막지 않는다
  // (best-effort: safety 장애가 채팅 push 전면 중단으로 번지지 않도록. 잔여 한계는 차단 대상에게 일시 노출 가능).
  private async excludeBlockersOfSender(
    recipientUserIds: string[],
    senderId: string,
  ): Promise<string[]> {
    if (recipientUserIds.length === 0) {
      return recipientUserIds;
    }
    try {
      const blockers = await this.safety.getBlockersOf([senderId]);
      if (blockers.size === 0) {
        return recipientUserIds;
      }
      return recipientUserIds.filter((userId) => !blockers.has(userId));
    } catch (err) {
      // fail-open: 역방향 차감 실패는 로깅만 하고 발송은 계속한다(외부 try/catch 와 별개 — 발송 자체는 막지 않음).
      console.error(
        `[PushListener] getBlockersOf 실패(best-effort, 역방향 차감 스킵, senderId=${senderId}):`,
        err instanceof Error ? err.message : 'unknown error',
      );
      return recipientUserIds;
    }
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
