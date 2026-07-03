import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { ChatMessage } from '../generated/prisma/client';
import { MoimService } from '../moim/moim.service';
import { PrismaService } from '../prisma/prisma.service';
import { SafetyService } from '../safety/safety.service';
import {
  CHAT_MESSAGE_CREATED,
  type ChatMessageCreatedPayload,
} from './chat-events';

// getHistory 입력(컨트롤러가 가드-검증 sub와 함께 전달). cursor는 문자열(쿼리 파라미터), limit는 정규화된 정수.
export interface GetHistoryInput {
  cursor?: string;
  limit: number;
}

// keyset 히스토리 페이지: 내림차순 메시지 + 다음 커서(더 오래된 페이지가 없으면 null).
export interface ChatHistoryPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    // @MX:NOTE: [AUTO] 멤버십 인가는 MOIM-001 MoimService.assertMember 단일 출처를 재사용한다(재구현 금지).
    // 다만 assertMember는 "없는 모임 → 404"를 던지는데, 채팅 AC는 모임 존재 여부 비노출을 위해 403을 요구한다
    // (acceptance 엣지). 그래서 chat은 NotFoundException(404)을 ForbiddenException(403)으로 변환한다.
    private readonly moim: MoimService,
    private readonly events: EventEmitter2,
    // @MX:NOTE: [AUTO] 뷰어 측 읽기 필터의 숨김 목록 단일 출처(SPEC-SAFETY-001 T-005 / REQ-CPL-002). safety→chat
    // 역방향 import 는 없고 chat→safety 단방향만 허용된다(ChatModule 이 SafetyModule 을 import). getHistory 가
    // 뷰어의 hidden(block∪report) 발신자를 WHERE 에서 제외하는 데 쓴다.
    private readonly safety: SafetyService,
  ) {}

  // @MX:ANCHOR: [AUTO] 채팅 메시지 전송의 단일 진입점(REQ-CHAT-001/005 / AC-1,3). 컨트롤러(T-006)와
  // 이벤트 발행(CHAT-002 구독)의 origin이다. "멤버만 저장하고 저장 후 정확히 한 번 발행한다"는 불변식의 출처.
  // @MX:REASON: 인가(assertMember 재사용, 404→403 변환) → insert → emit 순서가 한 곳에 모여 드리프트를 막는다.
  // 비멤버/없는 모임은 insert·emit 둘 다 일어나지 않아야 한다(가드는 throw로 이후 단계를 차단). emit은 저장
  // 성공 이후에만 발행되어 "저장 없는 발행"이 없도록 보장한다(AC-3 — 미저장 시 미발행).
  // @MX:NOTE: [AUTO] emit은 best-effort로 격리한다(try/catch). @nestjs/event-emitter의 emit은 동기 호출이라
  // CHAT-002가 @OnEvent 리스너를 등록하면 리스너 예외가 sendMessage로 전파되어, 이미 영속된 메시지가 HTTP 500이
  // 될 수 있다. 메시지는 이미 저장되었고 이벤트 전달은 느슨히 결합된 부가 작업이므로, emit 실패는 console.error로
  // 로깅하고(무시·삼킴 아님) 저장된 메시지를 그대로 반환한다 — 발행 실패가 전송 성공을 무효화하지 않는다.
  async sendMessage(
    sub: string,
    moimId: string,
    content: string,
  ): Promise<ChatMessage> {
    // 멤버십 인가(없는 모임 404 → 403 변환, 비멤버 403). throw 시 insert/emit에 도달하지 않는다(AC-3).
    await this.assertChatAccess(sub, moimId);

    // 저장된 메시지(BigInt PK는 DB가 발급). senderId는 가드-검증 sub만 받는다(mass-assignment 차단).
    const message = await this.prisma.chatMessage.create({
      data: { moimId, senderId: sub, content },
    });

    // 저장 성공 이후에만 도메인 이벤트 발행(REQ-CHAT-001). BigInt id는 이벤트 경계에서 문자열로 운반한다.
    const payload: ChatMessageCreatedPayload = {
      messageId: message.id.toString(),
      moimId: message.moimId,
      senderId: message.senderId,
      preview: message.content,
    };
    // best-effort 격리: 동기 리스너(CHAT-002 @OnEvent)의 예외가 영속된 메시지를 500으로 만들지 않도록 한다.
    try {
      this.events.emit(CHAT_MESSAGE_CREATED, payload);
    } catch (err) {
      // 발행 실패는 로깅만 하고(삼키지 않음) 저장된 메시지를 반환한다 — 전달은 느슨히 결합된 부가 작업이다.
      console.error(
        `[ChatService] ${CHAT_MESSAGE_CREATED} 발행 실패(messageId=${payload.messageId}):`,
        err,
      );
    }

    return message;
  }

  // keyset 히스토리(REQ-CHAT-003 / AC-2). 멤버 한정 — 비멤버/없는 모임 403. 내림차순(최신순) + cursor 이전 K개.
  async getHistory(
    sub: string,
    moimId: string,
    input: GetHistoryInput,
  ): Promise<ChatHistoryPage> {
    await this.assertChatAccess(sub, moimId);

    // cursor(문자열) → BigInt 파싱. 파싱 불가 시 400(잘못된 커서). 미지정이면 첫 페이지(최신순).
    const cursorId = parseCursor(input.cursor);

    // @MX:NOTE: [AUTO] SPEC-SAFETY-001 REQ-FLT-001 / AC-FLT-1: 뷰어(sub)가 숨긴 발신자(block∪report)를 요청당 1회
    // 조회해 senderId notIn 으로 서버에서 제외한다. notIn 은 WHERE 에서 take 이전에 적용되므로(DB 가 take 이전 필터)
    // 가시 메시지가 충분하면 페이지 크기(limit)가 보존된다 — over-fetch/trim 을 DB 가 수행(별도 app trim 불필요, R-1).
    // senderId 는 UUID 문자열이라 BigInt 캐스팅이 필요 없다(BigInt 캐스팅은 content_id 가 chat 일 때만, REQ-RPT-005).
    // 실시간 신규 메시지의 동시 필터는 클라이언트(T-009 handleIncoming)가 담당한다(양경로 — 서버는 히스토리만).
    const hiddenIds = await this.safety.getHiddenUserIds(sub);

    const messages = await this.prisma.chatMessage.findMany({
      where: {
        moimId,
        ...(cursorId === undefined ? {} : { id: { lt: cursorId } }),
        senderId: { notIn: hiddenIds },
      },
      orderBy: { id: 'desc' },
      take: input.limit,
    });

    // 다음 커서: 한 페이지를 가득 채웠으면(= 더 오래된 페이지가 있을 수 있음) 마지막(가장 오래된 반환분) id.
    // 가득 채우지 못했으면 더 이상 없음 → null.
    const nextCursor =
      messages.length === input.limit && messages.length > 0
        ? messages[messages.length - 1].id.toString()
        : null;

    return { messages, nextCursor };
  }

  // 멤버십 인가 + 404→403 변환을 한곳에 모은다(sendMessage/getHistory 공용).
  // assertMember는 없는 모임을 404로 던지지만, 채팅은 모임 존재 여부 비노출을 위해 403으로 통일한다(엣지 케이스).
  private async assertChatAccess(sub: string, moimId: string): Promise<void> {
    try {
      await this.moim.assertMember(sub, moimId);
    } catch (err) {
      // 없는 모임(404) → 403으로 변환(비멤버 처리와 동일 — 모임 존재 노출 방지). 그 외(이미 403)는 그대로 전파.
      if (err instanceof NotFoundException) {
        throw new ForbiddenException();
      }
      throw err;
    }
  }
}

// cursor 문자열을 BigInt로 파싱한다. 미지정이면 undefined, 파싱 불가면 400(BadRequestException).
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
