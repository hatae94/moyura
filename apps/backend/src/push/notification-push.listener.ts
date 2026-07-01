import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MOIM_SETTLEMENT_COMPLETED,
  type MoimSettlementCompletedPayload,
} from '../expense/expense-events';
import {
  MOIM_MEMBER_JOINED,
  type MoimMemberJoinedPayload,
} from '../invite/invite-events';
import { PrismaService } from '../prisma/prisma.service';
import {
  MOIM_SCHEDULE_CONFIRMED,
  type MoimScheduleConfirmedPayload,
} from '../schedule/schedule-events';
import { FcmSender } from './fcm-sender';

// 고신호 푸시 알림 제목(고정 브랜드명). 채팅 푸시는 title=sender 닉네임이지만, 이 3종은 발신자 기반이 아니라
// 이벤트 기반이라 title 을 브랜드로 고정하고 컨텍스트(닉네임/모임명/금액)는 body 에 싣는다.
const PUSH_TITLE = 'moyura';

// data.type 값 = 인앱 notification.type 과 동일 문자열. 네이티브 셸(WebViewShell)이 type+moimId 로 웹 라우트를
// 딥링크한다(그 매핑은 backend 범위 밖 — 여기선 식별자만 실어 보낸다). 이벤트명(moim.*)과는 별개의 매핑 키다.
const PUSH_TYPE_MEMBER_JOINED = 'member.joined';
const PUSH_TYPE_SCHEDULE_CONFIRMED = 'schedule.confirmed';
const PUSH_TYPE_SETTLEMENT_COMPLETED = 'settlement.completed';

// 모임 행이 사라진 경우(삭제 등) body 에 들어갈 모임명 안전 기본값(빈 문자열 body 방지 — 채팅 푸시의 title 폴백 동형).
const UNKNOWN_MOIM_NAME = '모임';
// actor 멤버 행이 사라진 경우 닉네임 안전 기본값(notification.service 의 UNKNOWN_ACTOR_NICKNAME 과 동형).
const UNKNOWN_ACTOR_NICKNAME = '알 수 없음';

// @MX:NOTE: [AUTO] 고신호 알림 FCM 푸시 구독자(SPEC-NOTIFICATIONS-001 M6). 인앱 피드를 쓰는
// NotificationListener 와 "독립적인" 추가 @OnEvent 구독자다(EventEmitter2 다중 구독) — 두 리스너는 서로를
// 인식하지 않고 각자 best-effort 로 격리된다(하나의 실패가 다른 하나/도메인 액션을 무효화하지 않음). 채팅 푸시
// (PushListener) 와도 분리했다(수신자 전략·카피가 완전히 다름 + 독립 테스트). 소음 방지를 위해 인앱 피드 전체가
// 아니라 "고신호 3종"(member.joined·schedule.confirmed·settlement.completed)만 네이티브 푸시로 승격한다.
// 생산 도메인(invite/schedule/expense)이 export 한 *-events 계약만 단방향 import 하고, 도메인은 push 를 인식하지
// 않는다(느슨한 결합 HARD). 수신자 산정은 NotificationListener 를 참조하지 않고 독립 재계산한다(push 는 device_token
// 조인이 추가로 필요 — 인앱 알림은 불필요). 페이로드는 식별자만 운반하므로 모임명/닉네임은 발송 시점에 해석한다.
@Injectable()
export class NotificationPushListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmSender,
  ) {}

  // moim.member.joined → 모임 멤버 − actor(신규 가입자)에게 FCM. body: {닉}님이 {모임}에 참여했어요.
  @OnEvent(MOIM_MEMBER_JOINED)
  async handleMemberJoined(payload: MoimMemberJoinedPayload): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      const tokens = await this.resolveDeviceTokens(recipientIds);
      // 등록 디바이스가 하나도 없으면(웹/게스트만 존재) 모임명/닉네임 조회 없이 종료한다(불필요 쿼리·발송 회피).
      if (tokens.length === 0) {
        return;
      }
      const moimName = await this.resolveMoimName(payload.moimId);
      const nickname = await this.resolveNickname(
        payload.moimId,
        payload.actorId,
      );
      await this.fcm.send(
        tokens,
        { title: PUSH_TITLE, body: `${nickname}님이 ${moimName}에 참여했어요` },
        { type: PUSH_TYPE_MEMBER_JOINED, moimId: payload.moimId },
      );
    } catch (err) {
      this.logFailure(MOIM_MEMBER_JOINED, payload.moimId, err);
    }
  }

  // moim.schedule.confirmed → 모임 멤버 − actor 에게 FCM. body: {모임} 일정이 확정됐어요.
  @OnEvent(MOIM_SCHEDULE_CONFIRMED)
  async handleScheduleConfirmed(
    payload: MoimScheduleConfirmedPayload,
  ): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      const tokens = await this.resolveDeviceTokens(recipientIds);
      if (tokens.length === 0) {
        return;
      }
      const moimName = await this.resolveMoimName(payload.moimId);
      await this.fcm.send(
        tokens,
        { title: PUSH_TITLE, body: `${moimName} 일정이 확정됐어요` },
        { type: PUSH_TYPE_SCHEDULE_CONFIRMED, moimId: payload.moimId },
      );
    } catch (err) {
      this.logFailure(MOIM_SCHEDULE_CONFIRMED, payload.moimId, err);
    }
  }

  // moim.settlement.completed → 상대방(counterpartyId=요청자) 1명에게만 FCM. body: {금액}원 정산이 완료됐어요.
  // 모임명/닉네임이 body 에 필요 없어(금액만) 표시 이름을 해석하지 않는다 — data 의 딥링크용 moimId 만 운반한다.
  @OnEvent(MOIM_SETTLEMENT_COMPLETED)
  async handleSettlementCompleted(
    payload: MoimSettlementCompletedPayload,
  ): Promise<void> {
    try {
      const tokens = await this.resolveDeviceTokens([payload.counterpartyId]);
      if (tokens.length === 0) {
        return;
      }
      await this.fcm.send(
        tokens,
        { title: PUSH_TITLE, body: `${payload.amount}원 정산이 완료됐어요` },
        { type: PUSH_TYPE_SETTLEMENT_COMPLETED, moimId: payload.moimId },
      );
    } catch (err) {
      this.logFailure(MOIM_SETTLEMENT_COMPLETED, payload.moimId, err);
    }
  }

  // 모임 멤버 sub 목록에서 actor 를 제외해 반환한다(moim-wide 수신자 산정 — notification.listener 미러, 독립 재계산).
  private async moimMembersExcept(
    moimId: string,
    actorId: string,
  ): Promise<string[]> {
    const members = await this.prisma.moimMember.findMany({
      where: { moimId },
    });
    return members.map((m) => m.userId).filter((userId) => userId !== actorId);
  }

  // 수신자 userId 집합의 등록 디바이스 토큰을 모은다. 수신자 0명이면 조회 없이 빈 배열(빈 in 회피 — push.listener 미러).
  // 게스트/웹(디바이스 미등록)은 device_token 이 없어 여기서 자연 제외된다(채팅 푸시와 동일).
  private async resolveDeviceTokens(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }
    const devices = await this.prisma.deviceToken.findMany({
      where: { userId: { in: userIds } },
    });
    return devices.map((d) => d.token);
  }

  // 모임 표시 이름을 조회한다(발송 시점 해석 — 페이로드엔 모임명 없음). 모임 행이 사라졌으면 안전 기본값.
  private async resolveMoimName(moimId: string): Promise<string> {
    const moim = await this.prisma.moim.findUnique({ where: { id: moimId } });
    return moim?.name ?? UNKNOWN_MOIM_NAME;
  }

  // (moimId, userId) 복합키로 모임별 표시 이름(nickname)을 조회한다. 멤버 행이 없으면 안전 기본값(빈 이름 방지).
  private async resolveNickname(
    moimId: string,
    userId: string,
  ): Promise<string> {
    const member = await this.prisma.moimMember.findUnique({
      where: { moimId_userId: { moimId, userId } },
    });
    return member?.nickname ?? UNKNOWN_ACTOR_NICKNAME;
  }

  // best-effort 격리 로깅(삼킴 아님). 발행 측(도메인 서비스)으로 예외를 전파하지 않고 컨텍스트만 기록한다 —
  // 푸시 실패가 이미 커밋된 도메인 액션이나 인앱 알림 fan-out(NotificationListener)에 영향을 주지 않는다.
  private logFailure(eventName: string, moimId: string, err: unknown): void {
    console.error(
      `[NotificationPushListener] ${eventName} 처리 실패(best-effort, moimId=${moimId}):`,
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}
