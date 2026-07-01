import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// createForRecipients 입력. 수신자 목록은 리스너가 이벤트별로 산정해 전달한다(서비스는 인가/수신자 계산을 하지 않음).
export interface CreateForRecipientsInput {
  // 수신자 sub 목록(이미 actor 제외됨). 빈 배열이면 쓰기 없이 0을 반환한다.
  recipientIds: string[];
  // 알림 종류 문자열(enum 아님). 리스너의 NOTIFICATION_TYPE_* 상수로 전달된다.
  type: string;
  // 컨텍스트 모임 id(FK).
  moimId: string;
  // 유발자 sub(nullable — 무행위자 알림 대비).
  actorId: string | null;
  // 타입별 미리보기 + 딥링크 타깃(선택). 미지정이면 {}(DB @default 와 동일).
  data?: Prisma.InputJsonValue;
}

// @MX:NOTE: [AUTO] 알림 fan-out 쓰기 단일 출처(SPEC-NOTIFICATIONS-001 M1). NotificationListener 가 이벤트별
// 수신자를 산정해 이 서비스로 넘기면, 수신자당 1행을 createMany 로 배치 삽입한다(정원 상한 ≈15로 유계).
// M3 에서 읽기 API(getFeed/unreadCount/markRead)가 이 서비스에 추가된다 — 인가(recipientId==sub)는 그때 컨트롤러
// 계층에서 다룬다. 여기서는 순수 영속만 담당하고 인가/수신자 계산은 하지 않는다(관심사 분리).
@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  // 수신자당 1행 알림을 배치 삽입한다(fan-out). 수신자 0명이면 DB 왕복 없이 0을 반환한다(빈 createMany 회피).
  async createForRecipients(input: CreateForRecipientsInput): Promise<number> {
    if (input.recipientIds.length === 0) {
      return 0;
    }
    const data = input.recipientIds.map((recipientId) => ({
      recipientId,
      type: input.type,
      moimId: input.moimId,
      actorId: input.actorId,
      data: input.data ?? {},
    }));
    const result = await this.prisma.notification.createMany({ data });
    return result.count;
  }
}
