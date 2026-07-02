import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { ChatMessage } from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SafetyService } from '../safety/safety.service';
import {
  CHAT_MESSAGE_CREATED,
  type ChatMessageCreatedPayload,
} from './chat-events';
import { ChatService } from './chat.service';

// ChatService 단위 테스트(SPEC-CHAT-001 T-003/004/005 + SPEC-SAFETY-001 T-005). 인메모리 fake prisma +
// stub MoimService(assertMember) + spy EventEmitter2 + stub SafetyService(getHiddenUserIds)로 다음을 검증한다:
//   - sendMessage: 멤버 전송 시 insert + 저장 메시지 반환 + chat.message.created 발행(REQ-CHAT-001 / AC-1).
//   - sendMessage: 비멤버/없는 모임은 403(404→403 변환)으로 거부하고 insert/emit 둘 다 없음(REQ-CHAT-005 / AC-3).
//   - getHistory: keyset 내림차순(최신순) + cursor 이전 K개 + nextCursor(REQ-CHAT-003 / AC-2).
//   - getHistory: 뷰어가 숨긴 senderId(block∪report)를 서버 WHERE(notIn)로 제외 + 페이지 크기 보존(REQ-FLT-001 / AC-FLT-1).
// MoimService.assertMember·SafetyService.getHiddenUserIds는 각 SPEC에서 검증된 단일 출처라 여기서는 스텁한다(reuse 계약).

const NOW = new Date('2026-06-14T00:00:00.000Z');

describe('ChatService', () => {
  // moimId별 멤버 sub 집합(assertMember가 멤버면 resolve). 비어 있으면 비멤버.
  let members: Map<string, Set<string>>;
  // 존재하는 모임 id 집합(assertMember가 없는 모임은 NotFoundException으로 거른다 — MOIM-001 계약 재현).
  let existingMoims: Set<string>;
  let store: ChatMessage[];
  let idSeq: bigint;
  // 뷰어(sub)별 숨김 userId 집합(block∪report). getHiddenUserIds 스텁이 이 맵에서 읽는다. 기본 빈 배열.
  let hiddenBySub: Map<string, string[]>;

  function reset(): void {
    members = new Map();
    existingMoims = new Set();
    store = [];
    idSeq = 0n;
    hiddenBySub = new Map();
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
      // keyset desc: where moimId (+ id < cursor) (+ senderId notIn hidden) order by id desc take limit.
      // notIn 은 WHERE 에서 hidden 발신자를 제거한 뒤 take 를 적용하므로(= DB 가 take 이전에 필터) 반환 페이지
      // 크기가 보존된다(over-fetch/trim 을 DB 가 수행). notIn 이 빈 배열이면 아무도 제외하지 않는다(Prisma no-op).
      findMany: jest.fn(
        (arg: {
          where: {
            moimId: string;
            id?: { lt: bigint };
            senderId?: { notIn: string[] };
          };
          orderBy: { id: 'desc' };
          take: number;
        }) => {
          const cursorLt = arg.where.id?.lt;
          const notIn = arg.where.senderId?.notIn ?? [];
          const rows = store
            .filter(
              (m) =>
                m.moimId === arg.where.moimId &&
                (cursorLt === undefined || m.id < cursorLt) &&
                !notIn.includes(m.senderId),
            )
            .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
            .slice(0, arg.take);
          return Promise.resolve(rows);
        },
      ),
    };
    return { chatMessage } as unknown as PrismaService;
  }

  // getHiddenUserIds(sub) 를 스텁한 SafetyService(뷰어별 숨김 목록 반환 — 요청당 1회 조회 계약 재현).
  function makeSafetyService(): {
    safety: SafetyService;
    getHiddenUserIds: jest.Mock<Promise<string[]>, [string]>;
  } {
    const getHiddenUserIds = jest.fn<Promise<string[]>, [string]>(
      (sub: string) => Promise.resolve(hiddenBySub.get(sub) ?? []),
    );
    const safety = { getHiddenUserIds } as unknown as SafetyService;
    return { safety, getHiddenUserIds };
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
    getHiddenUserIds: jest.Mock<Promise<string[]>, [string]>;
  } {
    const { emitter, emit } = makeEmitter();
    const { safety, getHiddenUserIds } = makeSafetyService();
    const service = new ChatService(
      makePrisma(),
      makeMoimService(),
      emitter,
      safety,
    );
    return { service, emit, getHiddenUserIds };
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

  // ── T-005(SAFETY): getHistory 뷰어 측 필터 — 숨긴 발신자 메시지 제외 + 페이지 크기 보존 ──
  describe('getHistory() 뷰어 측 필터 (REQ-FLT-001 / AC-FLT-1)', () => {
    it('뷰어가 숨긴 발신자(block∪report)의 메시지를 서버 WHERE(notIn)로 제외한다', async () => {
      const { service, getHiddenUserIds } = makeService();
      setMember('moim-A', 'viewer');
      // viewer 가 userB 를 차단/신고 → hidden 목록에 userB.
      hiddenBySub.set('viewer', ['userB']);
      // userB 와 다른 멤버 메시지가 섞여 있다.
      seedMessage({
        id: 1n,
        moimId: 'moim-A',
        senderId: 'userA',
        content: 'a1',
      });
      seedMessage({
        id: 2n,
        moimId: 'moim-A',
        senderId: 'userB',
        content: 'b1',
      });
      seedMessage({
        id: 3n,
        moimId: 'moim-A',
        senderId: 'userA',
        content: 'a2',
      });

      const page = await service.getHistory('viewer', 'moim-A', { limit: 10 });

      // userB(2n) 는 제외되고 userA 메시지만 남는다(내림차순).
      expect(page.messages.map((m) => m.id)).toEqual([3n, 1n]);
      expect(page.messages.every((m) => m.senderId !== 'userB')).toBe(true);
      // hidden 목록은 뷰어 sub 로 1회 조회된다(요청당 1회 — N+1 회피 계약).
      expect(getHiddenUserIds).toHaveBeenCalledWith('viewer');
    });

    it('숨긴 발신자가 있어도 over-fetch/trim(WHERE notIn+take)으로 페이지 크기를 보존한다(E-1)', async () => {
      const { service } = makeService();
      setMember('moim-A', 'viewer');
      hiddenBySub.set('viewer', ['userB']);
      // 14개 메시지 중 3개(2,5,8)가 userB → 가시 11개. take=10 → 정확히 10개 반환(페이지 축소 없음).
      for (let i = 1; i <= 14; i += 1) {
        seedMessage({
          id: BigInt(i),
          moimId: 'moim-A',
          senderId: i === 2 || i === 5 || i === 8 ? 'userB' : 'userA',
          content: `m-${i}`,
        });
      }

      const page = await service.getHistory('viewer', 'moim-A', { limit: 10 });

      // 가시 메시지가 충분(11개)하므로 정확히 limit(10)개 반환 + userB 미포함.
      expect(page.messages).toHaveLength(10);
      expect(page.messages.every((m) => m.senderId !== 'userB')).toBe(true);
      // 커서는 반환분 마지막(가장 오래된 가시) id 여야 한다(더 오래된 가시 페이지 남음).
      expect(page.nextCursor).toBe(page.messages[9].id.toString());
    });

    it('필터 후 가시 메시지가 limit 미만이면 반환 < limit + nextCursor=null(M3-2)', async () => {
      const { service } = makeService();
      setMember('moim-A', 'viewer');
      hiddenBySub.set('viewer', ['userB']);
      // 5개 중 3개가 userB → 가시 2개. take=10 → 2개 반환, 더 없음 → nextCursor null.
      seedMessage({
        id: 1n,
        moimId: 'moim-A',
        senderId: 'userA',
        content: 'a1',
      });
      seedMessage({
        id: 2n,
        moimId: 'moim-A',
        senderId: 'userB',
        content: 'b1',
      });
      seedMessage({
        id: 3n,
        moimId: 'moim-A',
        senderId: 'userB',
        content: 'b2',
      });
      seedMessage({
        id: 4n,
        moimId: 'moim-A',
        senderId: 'userB',
        content: 'b3',
      });
      seedMessage({
        id: 5n,
        moimId: 'moim-A',
        senderId: 'userA',
        content: 'a2',
      });

      const page = await service.getHistory('viewer', 'moim-A', { limit: 10 });

      expect(page.messages.map((m) => m.id)).toEqual([5n, 1n]);
      expect(page.nextCursor).toBeNull();
    });

    it('hidden 목록이 비면 아무도 제외하지 않는다(notIn 빈 배열 = no-op)', async () => {
      const { service } = makeService();
      setMember('moim-A', 'viewer');
      // hiddenBySub 미설정 → 빈 배열.
      seedMessage({
        id: 1n,
        moimId: 'moim-A',
        senderId: 'userA',
        content: 'a1',
      });
      seedMessage({
        id: 2n,
        moimId: 'moim-A',
        senderId: 'userB',
        content: 'b1',
      });

      const page = await service.getHistory('viewer', 'moim-A', { limit: 10 });

      expect(page.messages.map((m) => m.id)).toEqual([2n, 1n]);
    });
  });
});
