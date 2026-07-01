import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  MOIM_EXPENSE_ADDED,
  MOIM_SETTLEMENT_COMPLETED,
  MOIM_SETTLEMENT_REQUESTED,
  type MoimExpenseAddedPayload,
  type MoimSettlementCompletedPayload,
  type MoimSettlementRequestedPayload,
} from '../expense/expense-events';
import {
  MOIM_MEMBER_JOINED,
  type MoimMemberJoinedPayload,
} from '../invite/invite-events';
import {
  MOIM_MEMBER_KICKED,
  MOIM_OWNER_TRANSFERRED,
  type MoimMemberKickedPayload,
  type MoimOwnerTransferredPayload,
} from '../moim/moim-events';
import {
  MOIM_POLL_CLOSED,
  MOIM_POLL_CREATED,
  type MoimPollClosedPayload,
  type MoimPollCreatedPayload,
} from '../poll/poll-events';
import { PrismaService } from '../prisma/prisma.service';
import {
  MOIM_SCHEDULE_CONFIRMED,
  MOIM_SCHEDULE_DATES_CHANGED,
  MOIM_SCHEDULE_STARTED,
  MOIM_SCHEDULE_WINDOW_CHANGED,
  type MoimScheduleConfirmedPayload,
  type MoimScheduleDatesChangedPayload,
  type MoimScheduleStartedPayload,
  type MoimScheduleWindowChangedPayload,
} from '../schedule/schedule-events';
import { NotificationService } from './notification.service';

// notification.type 컬럼에 저장되는 종류 값(enum 아님 — plan §3.2 "허용값은 리스너 상수"). 이벤트명(moim.*)과는
// 별개의 딥링크·카피 매핑 키다(plan §6 type 표). M1(member.joined) + M2(나머지 10종).
const NOTIFICATION_TYPE_MEMBER_JOINED = 'member.joined';
const NOTIFICATION_TYPE_OWNER_DELEGATED = 'owner.delegated';
const NOTIFICATION_TYPE_MEMBER_KICKED = 'member.kicked';
const NOTIFICATION_TYPE_SCHEDULE_STARTED = 'schedule.started';
const NOTIFICATION_TYPE_SCHEDULE_DATES_CHANGED = 'schedule.dates_changed';
const NOTIFICATION_TYPE_SCHEDULE_WINDOW_CHANGED = 'schedule.window_changed';
const NOTIFICATION_TYPE_SCHEDULE_CONFIRMED = 'schedule.confirmed';
const NOTIFICATION_TYPE_POLL_CREATED = 'poll.created';
const NOTIFICATION_TYPE_POLL_CLOSED = 'poll.closed';
const NOTIFICATION_TYPE_EXPENSE_ADDED = 'expense.added';
const NOTIFICATION_TYPE_SETTLEMENT_REQUESTED = 'settlement.requested';
const NOTIFICATION_TYPE_SETTLEMENT_COMPLETED = 'settlement.completed';

// @MX:NOTE: [AUTO] 단방향 의존 경계(SPEC-NOTIFICATIONS-001 M1/M2). notification 은 각 생산 도메인이 export 한
// 이벤트 계약(invite/moim/schedule/poll/expense-events)만 import 하고, 생산 도메인은 notification 의 존재를
// 인식하지 않는다(도메인 → notification import 0 — 느슨한 결합 HARD). 이벤트 페이로드에는 nickname 이 없으므로
// 표시 이름은 M3 응답 시점에 해석한다(트리거 thin 원칙). 수신 대상 전략은 이벤트별로 다르다:
//   - moim-wide(멤버 − actor): owner.transferred, schedule.*, poll.created, poll.closed, member.joined
//   - targeted single: member.kicked → [targetId], settlement.requested → [debtorId], settlement.completed → [counterpartyId]
//   - share-based: expense.added → shareUserIds − actor
// 모든 핸들러는 best-effort(try/catch 격리) — 알림 fan-out 실패가 이미 커밋된 도메인 액션을 무효화하지 않는다
// (재시도/큐 비범위). 배지 실시간은 리스너가 아니라 DB 트리거가 담당한다(M4).
@Injectable()
export class NotificationListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // moim.member.joined(SPEC-NOTIFICATIONS-001 M1). 수신 대상 = 모임 멤버 − actor. data 미리보기 없음({}).
  @OnEvent(MOIM_MEMBER_JOINED)
  async handleMemberJoined(payload: MoimMemberJoinedPayload): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_MEMBER_JOINED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: {},
      });
    } catch (err) {
      this.logFailure(MOIM_MEMBER_JOINED, payload.moimId, err);
    }
  }

  // moim.owner.transferred → 모임 전체 − actor. 신 방장 강조는 data.newOwnerId 로 전달(type=owner.delegated).
  @OnEvent(MOIM_OWNER_TRANSFERRED)
  async handleOwnerTransferred(
    payload: MoimOwnerTransferredPayload,
  ): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_OWNER_DELEGATED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: { newOwnerId: payload.newOwnerId },
      });
    } catch (err) {
      this.logFailure(MOIM_OWNER_TRANSFERRED, payload.moimId, err);
    }
  }

  // moim.member.kicked → 퇴장 당사자(targetId)에게만. 모임 전체 방송 아님(개인 통지).
  @OnEvent(MOIM_MEMBER_KICKED)
  async handleMemberKicked(payload: MoimMemberKickedPayload): Promise<void> {
    try {
      await this.notifications.createForRecipients({
        recipientIds: [payload.targetId],
        type: NOTIFICATION_TYPE_MEMBER_KICKED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: {},
      });
    } catch (err) {
      this.logFailure(MOIM_MEMBER_KICKED, payload.moimId, err);
    }
  }

  // moim.schedule.started → 모임 멤버 − actor. 일정 조율 시작 공지(추가 미리보기 없음).
  @OnEvent(MOIM_SCHEDULE_STARTED)
  async handleScheduleStarted(
    payload: MoimScheduleStartedPayload,
  ): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_SCHEDULE_STARTED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: {},
      });
    } catch (err) {
      this.logFailure(MOIM_SCHEDULE_STARTED, payload.moimId, err);
    }
  }

  // moim.schedule.dates_changed → 모임 멤버 − actor. 후보 날짜 변경 공지.
  @OnEvent(MOIM_SCHEDULE_DATES_CHANGED)
  async handleScheduleDatesChanged(
    payload: MoimScheduleDatesChangedPayload,
  ): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_SCHEDULE_DATES_CHANGED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: {},
      });
    } catch (err) {
      this.logFailure(MOIM_SCHEDULE_DATES_CHANGED, payload.moimId, err);
    }
  }

  // moim.schedule.window_changed → 모임 멤버 − actor. 조율 시간대 확장 공지.
  @OnEvent(MOIM_SCHEDULE_WINDOW_CHANGED)
  async handleScheduleWindowChanged(
    payload: MoimScheduleWindowChangedPayload,
  ): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_SCHEDULE_WINDOW_CHANGED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: {},
      });
    } catch (err) {
      this.logFailure(MOIM_SCHEDULE_WINDOW_CHANGED, payload.moimId, err);
    }
  }

  // moim.schedule.confirmed → 모임 멤버 − actor. 확정 시각을 data.startsAt(ISO)로 담아 카피에 노출한다.
  @OnEvent(MOIM_SCHEDULE_CONFIRMED)
  async handleScheduleConfirmed(
    payload: MoimScheduleConfirmedPayload,
  ): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_SCHEDULE_CONFIRMED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: { startsAt: payload.startsAt },
      });
    } catch (err) {
      this.logFailure(MOIM_SCHEDULE_CONFIRMED, payload.moimId, err);
    }
  }

  // moim.poll.created → 모임 멤버 − actor. 딥링크(pollId) + 질문 미리보기(question)를 data 에 담는다.
  @OnEvent(MOIM_POLL_CREATED)
  async handlePollCreated(payload: MoimPollCreatedPayload): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_POLL_CREATED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: { pollId: payload.pollId, question: payload.question },
      });
    } catch (err) {
      this.logFailure(MOIM_POLL_CREATED, payload.moimId, err);
    }
  }

  // moim.poll.closed → 모임 멤버 − actor. 딥링크(pollId) + 질문 미리보기(question)를 data 에 담는다.
  @OnEvent(MOIM_POLL_CLOSED)
  async handlePollClosed(payload: MoimPollClosedPayload): Promise<void> {
    try {
      const recipientIds = await this.moimMembersExcept(
        payload.moimId,
        payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_POLL_CLOSED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: { pollId: payload.pollId, question: payload.question },
      });
    } catch (err) {
      this.logFailure(MOIM_POLL_CLOSED, payload.moimId, err);
    }
  }

  // moim.expense.added → 분담 참가자(shareUserIds) − actor. 경비를 나눠 낼 사람에게만 알린다(모임 전체 아님).
  // data 에 expenseId(딥링크) + amount/category(카피 미리보기)를 담는다.
  @OnEvent(MOIM_EXPENSE_ADDED)
  async handleExpenseAdded(payload: MoimExpenseAddedPayload): Promise<void> {
    try {
      const recipientIds = payload.shareUserIds.filter(
        (userId) => userId !== payload.actorId,
      );
      await this.notifications.createForRecipients({
        recipientIds,
        type: NOTIFICATION_TYPE_EXPENSE_ADDED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: {
          expenseId: payload.expenseId,
          amount: payload.amount,
          category: payload.category,
        },
      });
    } catch (err) {
      this.logFailure(MOIM_EXPENSE_ADDED, payload.moimId, err);
    }
  }

  // moim.settlement.requested → 채무자(debtorId)에게만. 금액 미리보기(amount)를 data 에 담는다.
  @OnEvent(MOIM_SETTLEMENT_REQUESTED)
  async handleSettlementRequested(
    payload: MoimSettlementRequestedPayload,
  ): Promise<void> {
    try {
      await this.notifications.createForRecipients({
        recipientIds: [payload.debtorId],
        type: NOTIFICATION_TYPE_SETTLEMENT_REQUESTED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: { amount: payload.amount },
      });
    } catch (err) {
      this.logFailure(MOIM_SETTLEMENT_REQUESTED, payload.moimId, err);
    }
  }

  // moim.settlement.completed → 상대방(counterpartyId)에게만. 금액 미리보기(amount)를 data 에 담는다.
  @OnEvent(MOIM_SETTLEMENT_COMPLETED)
  async handleSettlementCompleted(
    payload: MoimSettlementCompletedPayload,
  ): Promise<void> {
    try {
      await this.notifications.createForRecipients({
        recipientIds: [payload.counterpartyId],
        type: NOTIFICATION_TYPE_SETTLEMENT_COMPLETED,
        moimId: payload.moimId,
        actorId: payload.actorId,
        data: { amount: payload.amount },
      });
    } catch (err) {
      this.logFailure(MOIM_SETTLEMENT_COMPLETED, payload.moimId, err);
    }
  }

  // 모임 멤버 sub 목록에서 actor 를 제외해 반환한다(moim-wide 수신 대상 산정 — push.listener 미러).
  // 수신자 0명이면 서비스가 no-op(빈 createMany 회피). moim_member 조회는 payload.moimId 기준.
  private async moimMembersExcept(
    moimId: string,
    actorId: string,
  ): Promise<string[]> {
    const members = await this.prisma.moimMember.findMany({
      where: { moimId },
    });
    return members.map((m) => m.userId).filter((userId) => userId !== actorId);
  }

  // best-effort 격리 로깅(삼킴 아님). 발행 측으로 예외를 전파하지 않고 이벤트/모임 컨텍스트만 기록한다.
  private logFailure(eventName: string, moimId: string, err: unknown): void {
    console.error(
      `[NotificationListener] ${eventName} 처리 실패(best-effort, moimId=${moimId}):`,
      err instanceof Error ? err.message : 'unknown error',
    );
  }
}
