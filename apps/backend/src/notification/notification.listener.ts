import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MOIM_MEMBER_JOINED,
  type MoimMemberJoinedPayload,
} from '../invite/invite-events';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';

// notification.type 컬럼에 저장되는 종류 값(enum 아님 — plan §3.2 "허용값은 리스너 상수").
// 이벤트명(MOIM_MEMBER_JOINED='moim.member.joined')과는 별개의 값이다(알림 종류는 딥링크·카피 매핑 키).
const NOTIFICATION_TYPE_MEMBER_JOINED = 'member.joined';

// @MX:NOTE: [AUTO] 단방향 의존 경계(SPEC-NOTIFICATIONS-001 M1). notification 은 invite 가 export 한 이벤트 계약
// (invite-events.ts: MOIM_MEMBER_JOINED + MoimMemberJoinedPayload)만 import 하고, invite 는 notification 의
// 존재를 인식하지 않는다(invite → notification import 0 — 느슨한 결합 HARD). 이벤트 페이로드에는 nickname 이
// 없으므로 표시 이름은 M3 응답 시점에 해석한다(트리거 thin 원칙). 수신 대상 = moim_member(moimId) − actor
// (push.listener 수신자 산정 미러). 모든 작업은 best-effort(try/catch 격리) — 알림 fan-out 실패가 이미 커밋된
// 멤버십 가입(InviteService.accept)을 무효화하지 않는다(재시도/큐 비범위).
@Injectable()
export class NotificationListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // moim.member.joined 도메인 이벤트 단방향 구독(SPEC-NOTIFICATIONS-001 M1). async 리스너이므로 EventEmitter2 는
  // 결과를 await 하지 않는다 — 예외가 발행 측(InviteService.accept)으로 전파되지 않도록 전 경로를 try/catch 로 격리한다.
  @OnEvent(MOIM_MEMBER_JOINED)
  async handleMemberJoined(payload: MoimMemberJoinedPayload): Promise<void> {
    try {
      const { moimId, actorId } = payload;

      // 수신 대상 = 모임 멤버 − actor(새로 가입한 당사자). actor 는 자기 가입 알림을 받지 않는다(push.listener 미러).
      const members = await this.prisma.moimMember.findMany({
        where: { moimId },
      });
      const recipientIds = members
        .map((m) => m.userId)
        .filter((userId) => userId !== actorId);

      // 수신자당 1행 fan-out(수신자 0명이면 서비스가 no-op). data 는 member.joined 미리보기가 없어 {}.
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_MEMBER_JOINED,
        moimId,
        actorId,
        data: {},
      });
    } catch (err) {
      // best-effort 격리: 수신 대상 조회/삽입 실패는 로깅만(삼킴 아님). 발행 측으로 전파 금지.
      console.error(
        `[NotificationListener] ${MOIM_MEMBER_JOINED} 처리 실패(best-effort, moimId=${payload.moimId}):`,
        err instanceof Error ? err.message : 'unknown error',
      );
    }
  }
}
