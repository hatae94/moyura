import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// actor sub 는 있으나 모임 멤버 행이 사라진 경우(탈퇴/추방 등) 표시 이름의 안전 기본값.
// actorId 자체가 null 이면 actor 를 노출하지 않지만(그때는 actor=null), sub 는 있는데 nickname 만 못 찾으면
// 알림 자체는 살아 있어야 하므로 null 로 지우지 않고 이 fallback 으로 채운다(push.listener 의 nickname 해석과 동형).
const UNKNOWN_ACTOR_NICKNAME = '알 수 없음';

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

// listForRecipient 입력(컨트롤러가 가드-검증 sub 와 함께 전달). cursor 는 문자열(쿼리 파라미터), limit 는 정규화된 정수.
export interface ListForRecipientInput {
  cursor?: string;
  limit: number;
}

// 응답 해석까지 끝낸 피드 아이템(모임명 + actor 표시 이름 채움). BigInt id·Date 는 컨트롤러가 DTO 로 직렬화한다.
export interface NotificationFeedActor {
  id: string;
  nickname: string;
}
export interface NotificationFeedItem {
  id: bigint;
  type: string;
  moimId: string;
  moimName: string | null;
  actor: NotificationFeedActor | null;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

// keyset 피드 페이지: 내림차순 아이템 + 다음 커서(더 오래된 페이지가 없으면 null).
export interface NotificationFeedPage {
  items: NotificationFeedItem[];
  nextCursor: string | null;
}

// markRead 입력(컨트롤러가 명시 검증 후 전달). ids 지정이면 그 중 미읽음만, 미지정이면 전체 미읽음(all).
export interface MarkReadInput {
  ids?: string[];
  all?: boolean;
}

// @MX:ANCHOR: [AUTO] 알림 읽기/쓰기 인가의 단일 출처(SPEC-NOTIFICATIONS-001 M3). 컨트롤러(GET 목록/unread-count,
// POST read)와 fan-out 쓰기(리스너)의 origin 이다. "모든 읽기·갱신 쿼리는 recipientId=sub 로 필터한다"는
// 불변식의 출처 — 이 필터 때문에 교차 사용자 접근이 구조적으로 불가능하다(다른 sub 의 행을 반환/갱신할 수 없음).
// @MX:REASON: 인가를 assertMember 가 아니라 recipientId==sub 로 판정하는 이유는, 추방(kick)당한 사용자도 자기
// 추방 알림을 읽어야 하기 때문이다(모임 멤버십이 사라져도 자기 알림은 열람 가능). 인가가 where 절 자체에 녹아
// 있어(별도 소유권 검사 없음) list/unreadCount/markRead 세 경로가 동일한 격리 규칙을 공유하고 드리프트가 없다.
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

  // 수신자(sub) 피드 keyset 페이지(REQ M3). recipientId=sub 로만 필터하므로 남의 알림은 구조적으로 노출 불가.
  // 반환 행의 (moimId, actorId) 를 한 번씩 배치 조회해 모임명/actor 닉네임을 응답 시점에 해석한다(트리거 thin 원칙).
  async listForRecipient(
    sub: string,
    input: ListForRecipientInput,
  ): Promise<NotificationFeedPage> {
    // cursor(문자열) → BigInt 파싱. 파싱 불가 시 400. 미지정이면 첫 페이지(최신순).
    const cursorId = parseCursor(input.cursor);

    const rows = await this.prisma.notification.findMany({
      where: {
        recipientId: sub,
        ...(cursorId === undefined ? {} : { id: { lt: cursorId } }),
      },
      orderBy: { id: 'desc' },
      take: input.limit,
    });

    // 다음 커서: 한 페이지를 가득 채웠으면(= 더 오래된 페이지가 있을 수 있음) 마지막(가장 오래된 반환분) id.
    const nextCursor =
      rows.length === input.limit && rows.length > 0
        ? rows[rows.length - 1].id.toString()
        : null;

    // 표시 필드 배치 해석: 반환 행의 고유 moimId / actorId 를 모아 각각 1회 조회한다(N+1 회피).
    const moimIds = [...new Set(rows.map((r) => r.moimId))];
    const actorIds = [
      ...new Set(
        rows
          .map((r) => r.actorId)
          .filter((actorId): actorId is string => actorId !== null),
      ),
    ];

    const moimNameById = await this.resolveMoimNames(moimIds);
    const nicknameByKey = await this.resolveActorNicknames(moimIds, actorIds);

    const items: NotificationFeedItem[] = rows.map((row) => ({
      id: row.id,
      type: row.type,
      moimId: row.moimId,
      moimName: moimNameById.get(row.moimId) ?? null,
      // actorId 가 null 이면 actor 없음(무행위자). 있으면 (moimId, actorId) 로 닉네임을 찾고, 없으면 fallback.
      actor:
        row.actorId === null
          ? null
          : {
              id: row.actorId,
              nickname:
                nicknameByKey.get(memberKey(row.moimId, row.actorId)) ??
                UNKNOWN_ACTOR_NICKNAME,
            },
      data: row.data,
      readAt: row.readAt,
      createdAt: row.createdAt,
    }));

    return { items, nextCursor };
  }

  // 수신자(sub) 미읽음 개수. (recipientId, readAt) 인덱스로 O(log n). 남의 미읽음은 세지 않는다.
  async unreadCount(sub: string): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientId: sub, readAt: null },
    });
  }

  // 수신자(sub) 알림을 읽음 처리한다. ids 지정이면 그 중 미읽음만, 미지정(all)이면 전체 미읽음.
  // where 에 recipientId=sub 가 항상 포함되어 남의 알림은 갱신 대상에서 구조적으로 제외된다(교차 갱신 불가).
  // 이미 읽은 행은 readAt: null 조건으로 자연 제외되어 재갱신되지 않는다(멱등 mark-all).
  async markRead(
    sub: string,
    input: MarkReadInput,
  ): Promise<{ updated: number }> {
    // ids 는 컨트롤러가 유효 BigInt 문자열 배열임을 이미 검증했다. 여기서는 BigInt 로만 변환한다.
    const idsBigInt = input.ids?.map((id) => BigInt(id));
    const result = await this.prisma.notification.updateMany({
      where: {
        recipientId: sub,
        readAt: null,
        ...(idsBigInt === undefined ? {} : { id: { in: idsBigInt } }),
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  // moimId 목록 → { moimId: name } 맵. 빈 목록이면 조회 없이 빈 맵(빈 in 회피).
  private async resolveMoimNames(
    moimIds: string[],
  ): Promise<Map<string, string>> {
    if (moimIds.length === 0) {
      return new Map();
    }
    const moims = await this.prisma.moim.findMany({
      where: { id: { in: moimIds } },
    });
    return new Map(moims.map((m) => [m.id, m.name]));
  }

  // (moimId, actorId) 조합 → nickname 맵(키: `${moimId}:${userId}`). 닉네임은 모임별이라 복합키로 해석한다.
  // 둘 중 하나라도 비면 조회 없이 빈 맵(빈 in 회피).
  private async resolveActorNicknames(
    moimIds: string[],
    actorIds: string[],
  ): Promise<Map<string, string>> {
    if (moimIds.length === 0 || actorIds.length === 0) {
      return new Map();
    }
    const members = await this.prisma.moimMember.findMany({
      where: { moimId: { in: moimIds }, userId: { in: actorIds } },
    });
    return new Map(
      members.map((m) => [memberKey(m.moimId, m.userId), m.nickname]),
    );
  }
}

// moim_member 복합키 룩업용 문자열 키(닉네임은 모임별 — moimId 와 userId 둘 다 필요).
function memberKey(moimId: string, userId: string): string {
  return `${moimId}:${userId}`;
}

// cursor 문자열을 BigInt 로 파싱한다. 미지정이면 undefined, 파싱 불가면 400(chat parseCursor 미러).
function parseCursor(cursor: string | undefined): bigint | undefined {
  if (cursor === undefined) {
    return undefined;
  }
  try {
    return BigInt(cursor);
  } catch {
    throw new BadRequestException('cursor 형식이 올바르지 않습니다');
  }
}
