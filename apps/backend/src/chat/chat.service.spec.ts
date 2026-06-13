import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { ChatMessage } from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  CHAT_MESSAGE_CREATED,
  type ChatMessageCreatedPayload,
} from './chat-events';
import { ChatService } from './chat.service';

// ChatService 단위 테스트(SPEC-CHAT-001 T-003/004/005). 인메모리 fake prisma + stub MoimService(assertMember)
// + spy EventEmitter2로 다음을 검증한다:
//   - sendMessage: 멤버 전송 시 insert + 저장 메시지 반환 + chat.message.created 발행(REQ-CHAT-001 / AC-1).
//   - sendMessage: 비멤버/없는 모임은 403(404→403 변환)으로 거부하고 insert/emit 둘 다 없음(REQ-CHAT-005 / AC-3).
//   - getHistory: keyset 내림차순(최신순) + cursor 이전 K개 + nextCursor(REQ-CHAT-003 / AC-2).
// MoimService.assertMember는 MOIM-001에서 검증된 단일 출처라 여기서는 재구현하지 않고 스텁한다(reuse 계약).

const NOW = new Date('2026-06-14T00:00:00.000Z');

describe('ChatService', () => {
  // moimId별 멤버 sub 집합(assertMember가 멤버면 resolve). 비어 있으면 비멤버.
  let members: Map<string, Set<string>>;
  // 존재하는 모임 id 집합(assertMember가 없는 모임은 NotFoundException으로 거른다 — MOIM-001 계약 재현).
  let existingMoims: Set<string>;
  let store: ChatMessage[];
  let idSeq: bigint;

  function reset(): void {
    members = new Map();
    existingMoims = new Set();
    store = [];
    idSeq = 0n;
  }

  function setMember(moimId: string, sub: string): void {
    existingMoims.add(moimId);
    const set = members.get(moimId) ?? new Set<string>();
    set.add(sub);
    members.set(moimId, set);
  }

  function seedMessage(partial: {
    id: bigint;
    moimId: string;
    senderId: string;
    content: string;
    createdAt?: Date;
  }): ChatMessage {
    const msg: ChatMessage = {
      id: partial.id,
      moimId: partial.moimId,
      senderId: partial.senderId,
      content: partial.content,
      createdAt: partial.createdAt ?? NOW,
    };
    store.push(msg);
    if (partial.id > idSeq) {
      idSeq = partial.id;
    }
    return msg;
  }

  // assertMember를 스텁한 MoimService(존재+멤버십 기반 404/403 판정 — MOIM-001 계약 재현).
  function makeMoimService(): MoimService {
    return {
      assertMember: jest.fn((sub: string, moimId: string) => {
        // 존재하지 않는 모임 → NotFoundException(404). MOIM-001 assertMember 실제 동작.
        if (!existingMoims.has(moimId)) {
          return Promise.reject(new NotFoundException());
        }
        // 인증되었으나 비멤버 → ForbiddenException(403).
        if (!members.get(moimId)?.has(sub)) {
          return Promise.reject(new ForbiddenException());
        }
        return Promise.resolve();
      }),
    } as unknown as MoimService;
  }

  // chatMessage 테이블을 흉내내는 fake prisma. create는 단조 증가 BigInt PK를 발급한다.
  function makePrisma(): PrismaService {
    const chatMessage = {
      create: jest.fn(
        (arg: {
          data: { moimId: string; senderId: string; content: string };
        }) => {
          idSeq += 1n;
          const created: ChatMessage = {
            id: idSeq,
            moimId: arg.data.moimId,
            senderId: arg.data.senderId,
            content: arg.data.content,
            createdAt: NOW,
          };
          store.push(created);
          return Promise.resolve(created);
        },
      ),
      // keyset desc: where moimId (+ id < cursor) order by id desc take limit.
      findMany: jest.fn(
        (arg: {
          where: { moimId: string; id?: { lt: bigint } };
          orderBy: { id: 'desc' };
          take: number;
        }) => {
          const cursorLt = arg.where.id?.lt;
          const rows = store
            .filter(
              (m) =>
                m.moimId === arg.where.moimId &&
                (cursorLt === undefined || m.id < cursorLt),
            )
            .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
            .slice(0, arg.take);
          return Promise.resolve(rows);
        },
      ),
    };
    return { chatMessage } as unknown as PrismaService;
  }

  // chat.message.created 발행을 캡처하는 spy EventEmitter2.
  function makeEmitter(): {
    emitter: EventEmitter2;
    emit: jest.Mock<boolean, [string, ChatMessageCreatedPayload]>;
  } {
    const emit = jest.fn<boolean, [string, ChatMessageCreatedPayload]>(
      () => true,
    );
    const emitter = { emit } as unknown as EventEmitter2;
    return { emitter, emit };
  }

  function makeService(): {
    service: ChatService;
    emit: jest.Mock<boolean, [string, ChatMessageCreatedPayload]>;
  } {
    const { emitter, emit } = makeEmitter();
    const service = new ChatService(makePrisma(), makeMoimService(), emitter);
    return { service, emit };
  }

  beforeEach(() => {
    reset();
  });

  // ── T-003/T-005: sendMessage happy path — insert + 반환 + 이벤트 발행 ──
  describe('sendMessage() (REQ-CHAT-001 / AC-1)', () => {
    it('멤버가 전송하면 메시지를 저장하고 저장된 메시지를 반환한다', async () => {
      const { service } = makeService();
      setMember('moim-A', 'member-1');

      const msg = await service.sendMessage('member-1', 'moim-A', '안녕하세요');

      expect(msg.moimId).toBe('moim-A');
      expect(msg.senderId).toBe('member-1');
      expect(msg.content).toBe('안녕하세요');
      expect(typeof msg.id).toBe('bigint');
      expect(store).toHaveLength(1);
    });

    it('저장 직후 chat.message.created를 발행한다(messageId 문자열 + nickname 미포함)', async () => {
      const { service, emit } = makeService();
      setMember('moim-A', 'member-1');

      const msg = await service.sendMessage('member-1', 'moim-A', '안녕하세요');

      expect(emit).toHaveBeenCalledTimes(1);
      const [eventName, payload] = emit.mock.calls[0];
      expect(eventName).toBe(CHAT_MESSAGE_CREATED);
      // messageId는 BigInt PK의 문자열 표현이어야 한다(이벤트 경계에서 BigInt 직렬화 불가).
      expect(payload.messageId).toBe(msg.id.toString());
      expect(typeof payload.messageId).toBe('string');
      expect(payload.moimId).toBe('moim-A');
      expect(payload.senderId).toBe('member-1');
      expect(payload.preview).toBe('안녕하세요');
      // nickname은 페이로드에 포함되지 않는다(소비 측 해석 — 게이트 결정).
      expect(payload).not.toHaveProperty('nickname');
    });

    it('emit이 throw해도(리스너 예외) 저장된 메시지를 반환한다(best-effort 격리 — 500 아님)', async () => {
      const { service, emit } = makeService();
      setMember('moim-A', 'member-1');
      // CHAT-002 @OnEvent 리스너가 동기 예외를 던지는 상황을 흉내낸다(emit은 동기 호출).
      emit.mockImplementationOnce(() => {
        throw new Error('listener boom');
      });
      // 발행 실패는 console.error로 로깅된다(삼킴 아님) — 테스트 출력 노이즈를 막기 위해 spy로 캡처.
      const errSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      // emit 예외가 전파되지 않고 저장된 메시지가 정상 반환되어야 한다.
      const msg = await service.sendMessage('member-1', 'moim-A', '안녕하세요');

      expect(msg.content).toBe('안녕하세요');
      // 메시지는 이미 영속되었다(emit 실패가 저장을 무효화하지 않음).
      expect(store).toHaveLength(1);
      // 발행 실패는 로깅되었다(무시·삼킴 아님).
      expect(errSpy).toHaveBeenCalled();

      errSpy.mockRestore();
    });
  });

  // ── T-003/T-005: sendMessage 비멤버/없는 모임 — 403 + insert/emit 둘 다 없음 ──
  describe('sendMessage() 비멤버 차단 (REQ-CHAT-005 / AC-3)', () => {
    it('비멤버가 전송하면 403 + 메시지 미저장 + 이벤트 미발행', async () => {
      const { service, emit } = makeService();
      // moim 존재하나 member-1은 비멤버.
      setMember('moim-A', 'owner-1');

      await expect(
        service.sendMessage('stranger', 'moim-A', '안녕'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(store).toHaveLength(0);
      expect(emit).not.toHaveBeenCalled();
    });

    it('존재하지 않는 모임으로 전송하면 403(404→403 변환) + 미저장 + 미발행', async () => {
      const { service, emit } = makeService();
      // moim 미존재 → assertMember가 NotFoundException(404)을 던지지만 chat은 403으로 변환한다.

      await expect(
        service.sendMessage('member-1', 'missing', '안녕'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(store).toHaveLength(0);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  // ── T-004: getHistory — keyset 내림차순 + cursor + nextCursor ──
  describe('getHistory() (REQ-CHAT-003 / AC-2)', () => {
    it('비멤버/없는 모임 조회는 403(404→403 변환)', async () => {
      const { service } = makeService();
      setMember('moim-A', 'owner-1');

      await expect(
        service.getHistory('stranger', 'moim-A', { limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.getHistory('member-1', 'missing', { limit: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cursor 없이 첫 페이지는 최신 K개를 내림차순으로 반환한다', async () => {
      const { service } = makeService();
      setMember('moim-A', 'member-1');
      for (let i = 1; i <= 5; i += 1) {
        seedMessage({
          id: BigInt(i),
          moimId: 'moim-A',
          senderId: 'member-1',
          content: `msg-${i}`,
        });
      }

      const page = await service.getHistory('member-1', 'moim-A', { limit: 3 });

      // 최신순(내림차순): 5,4,3.
      expect(page.messages.map((m) => m.id)).toEqual([5n, 4n, 3n]);
      // 더 오래된 페이지가 남아 있으므로 nextCursor는 마지막(가장 오래된 반환분)의 id.
      expect(page.nextCursor).toBe('3');
    });

    it('cursor를 주면 그 식별자보다 작은(더 오래된) 메시지만 내림차순으로 반환한다', async () => {
      const { service } = makeService();
      setMember('moim-A', 'member-1');
      for (let i = 1; i <= 5; i += 1) {
        seedMessage({
          id: BigInt(i),
          moimId: 'moim-A',
          senderId: 'member-1',
          content: `msg-${i}`,
        });
      }

      // cursor=3 → id<3인 2,1을 내림차순으로.
      const page = await service.getHistory('member-1', 'moim-A', {
        cursor: '3',
        limit: 10,
      });

      expect(page.messages.map((m) => m.id)).toEqual([2n, 1n]);
      // 더 이상 남은 게 없으면 nextCursor는 null.
      expect(page.nextCursor).toBeNull();
    });

    it('잘못된 cursor(파싱 불가)는 400을 던진다', async () => {
      const { service } = makeService();
      setMember('moim-A', 'member-1');

      await expect(
        service.getHistory('member-1', 'moim-A', {
          cursor: 'not-a-number',
          limit: 10,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
