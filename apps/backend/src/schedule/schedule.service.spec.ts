import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type {
  Moim,
  ScheduleEvent,
  ScheduleSlot,
} from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import { ScheduleService, computeStartsAt } from './schedule.service';

// ScheduleService 단위 테스트(SPEC-SCHEDULE-001). 인메모리 fake Prisma + stub MoimService 로 검증한다:
//   - computeStartsAt: KST 환산 + 자정 넘김(startMinute>1440 = 다음날 새벽).
//   - setSchedule: owner 인가 + 날짜/시간/격자 검증 + 재설정 시 슬롯 초기화·확정 해제.
//   - setMyAvailability: member 인가 + 미설정 404 + 확정됨 400 + 범위/격자 검증 + 교체 저장.
//   - confirmSchedule: owner 인가 + 후보/범위 검증 + moim.startsAt 갱신.
//   - deleteSchedule: owner 인가 + 멱등.
// expense.service.spec 패턴 미러 — fake 테이블 Map + stub MoimService.

const NOW = new Date('2026-07-01T00:00:00.000Z');
const MOIM_ID = 'moim-1';
const EVENT_ID = 'ev-1';

interface Tables {
  event: Map<string, ScheduleEvent>; // key: moimId(@unique)
  slot: Map<string, ScheduleSlot>; // key: `${eventId}:${userId}:${date}:${startMinute}`
  moim: Map<string, Moim>;
}

function slotKey(e: string, u: string, d: string, m: number): string {
  return `${e}:${u}:${d}:${m}`;
}

describe('ScheduleService', () => {
  let tables: Tables;
  let owners: Map<string, string>; // moimId → owner sub
  let members: Set<string>; // `${moimId}:${sub}`
  let service: ScheduleService;

  function reset(): void {
    tables = { event: new Map(), slot: new Map(), moim: new Map() };
    owners = new Map();
    members = new Set();
  }

  function slotsFor(eventId: string): ScheduleSlot[] {
    return [...tables.slot.values()].filter(
      (s) => s.scheduleEventId === eventId,
    );
  }

  // ── fake Prisma (ScheduleService 가 쓰는 메서드만 구현) ──────────────────────
  // expense.service.spec 패턴: async 대신 Promise.resolve/reject 반환(require-await 회피, 반환은 Promise 유지).
  const prisma = {
    scheduleEvent: {
      findUnique: ({
        where: { moimId },
        include,
      }: {
        where: { moimId: string };
        include?: { slots: true };
      }) => {
        const ev = tables.event.get(moimId) ?? null;
        if (!ev) return Promise.resolve(null);
        return Promise.resolve(
          include ? { ...ev, slots: slotsFor(ev.id) } : ev,
        );
      },
      create: ({
        data,
        include,
      }: {
        data: Omit<
          ScheduleEvent,
          'id' | 'confirmedAt' | 'createdAt' | 'updatedAt'
        >;
        include?: { slots: true };
      }) => {
        const ev: ScheduleEvent = {
          ...data,
          id: EVENT_ID,
          confirmedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        };
        tables.event.set(data.moimId, ev);
        return Promise.resolve(
          include ? { ...ev, slots: slotsFor(ev.id) } : ev,
        );
      },
      update: ({
        where,
        data,
        include,
      }: {
        where: { moimId?: string; id?: string };
        data: Partial<ScheduleEvent>;
        include?: { slots: true };
      }) => {
        const ev = where.moimId
          ? tables.event.get(where.moimId)
          : [...tables.event.values()].find((e) => e.id === where.id);
        if (!ev) return Promise.reject(new Error('event not found'));
        const next = { ...ev, ...data, updatedAt: NOW };
        tables.event.set(ev.moimId, next);
        return Promise.resolve(
          include ? { ...next, slots: slotsFor(ev.id) } : next,
        );
      },
      deleteMany: ({ where: { moimId } }: { where: { moimId: string } }) => {
        const ev = tables.event.get(moimId);
        if (ev) {
          for (const k of [...tables.slot.keys()]) {
            if (tables.slot.get(k)?.scheduleEventId === ev.id)
              tables.slot.delete(k);
          }
          tables.event.delete(moimId);
        }
        return Promise.resolve({ count: ev ? 1 : 0 });
      },
    },
    scheduleSlot: {
      deleteMany: ({
        where: { scheduleEventId, userId },
      }: {
        where: { scheduleEventId: string; userId?: string };
      }) => {
        let count = 0;
        for (const [k, v] of [...tables.slot.entries()]) {
          if (
            v.scheduleEventId === scheduleEventId &&
            (userId === undefined || v.userId === userId)
          ) {
            tables.slot.delete(k);
            count += 1;
          }
        }
        return Promise.resolve({ count });
      },
      createMany: ({
        data,
      }: {
        data: Array<{
          scheduleEventId: string;
          userId: string;
          date: string;
          startMinute: number;
        }>;
        skipDuplicates?: boolean;
      }) => {
        for (const d of data) {
          const k = slotKey(d.scheduleEventId, d.userId, d.date, d.startMinute);
          tables.slot.set(k, { ...d, createdAt: NOW });
        }
        return Promise.resolve({ count: data.length });
      },
    },
    moim: {
      update: ({
        where: { id },
        data,
      }: {
        where: { id: string };
        data: Partial<Moim>;
      }) => {
        const m = tables.moim.get(id) ?? ({ id } as Moim);
        const next = { ...m, ...data };
        tables.moim.set(id, next);
        return Promise.resolve(next);
      },
    },
    // ScheduleService 는 $transaction(배열)을 쓴다. fake 는 eager 평가된 Promise 들을 모아 await 한다.
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  } as unknown as PrismaService;

  // ── stub MoimService (owner/member 집합 기반 인가) ──────────────────────────
  const moim = {
    assertOwner: (sub: string, moimId: string) =>
      owners.get(moimId) === sub
        ? Promise.resolve()
        : Promise.reject(new ForbiddenException()),
    assertMember: (sub: string, moimId: string) =>
      members.has(`${moimId}:${sub}`)
        ? Promise.resolve()
        : Promise.reject(new ForbiddenException()),
  } as unknown as MoimService;

  beforeEach(() => {
    reset();
    service = new ScheduleService(prisma, moim);
    owners.set(MOIM_ID, 'owner');
    members.add(`${MOIM_ID}:owner`);
    members.add(`${MOIM_ID}:m2`);
  });

  // ── computeStartsAt (KST + 자정 넘김) ──────────────────────────────────────
  describe('computeStartsAt', () => {
    it('22:00 KST → 같은 날 13:00 UTC', () => {
      // 2026-07-04 22:00 KST = 2026-07-04 13:00 UTC.
      expect(computeStartsAt('2026-07-04', 1320).toISOString()).toBe(
        '2026-07-04T13:00:00.000Z',
      );
    });

    it('자정 넘김(익일 02:00) → 다음날로 자연 환산', () => {
      // 후보일 0시 기준 1560분 = 26시간 = 익일 02:00 KST = 2026-07-05 17:00 UTC.
      expect(computeStartsAt('2026-07-04', 1560).toISOString()).toBe(
        '2026-07-04T17:00:00.000Z',
      );
    });

    it('00:00(자정 정각) KST 환산', () => {
      expect(computeStartsAt('2026-07-04', 0).toISOString()).toBe(
        '2026-07-03T15:00:00.000Z',
      );
    });
  });

  // ── setSchedule ───────────────────────────────────────────────────────────
  describe('setSchedule', () => {
    it('비-owner 는 403', async () => {
      await expect(
        service.setSchedule('m2', MOIM_ID, ['2026-07-04'], 1080, 1440, 30),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('빈 날짜 → 400', async () => {
      await expect(
        service.setSchedule('owner', MOIM_ID, [], 1080, 1440, 30),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('end <= start → 400', async () => {
      await expect(
        service.setSchedule('owner', MOIM_ID, ['2026-07-04'], 1080, 1080, 30),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('격자 불일치(범위 % 슬롯 != 0) → 400', async () => {
      await expect(
        service.setSchedule('owner', MOIM_ID, ['2026-07-04'], 1080, 1100, 30),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('잘못된 슬롯 단위(45분) → 400', async () => {
      await expect(
        service.setSchedule('owner', MOIM_ID, ['2026-07-04'], 1080, 1440, 45),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('자정 넘김 범위(1320~1560) 정상 생성', async () => {
      const ev = await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1320,
        1560,
        30,
      );
      expect(ev.startMinute).toBe(1320);
      expect(ev.endMinute).toBe(1560);
      expect(ev.slots).toEqual([]);
    });

    it('재설정 시 기존 슬롯 초기화 + 확정 해제', async () => {
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1080,
        1440,
        30,
      );
      // 멤버 슬롯 + 확정 시드
      const ev = tables.event.get(MOIM_ID);
      tables.slot.set(slotKey(ev.id, 'm2', '2026-07-04', 1080), {
        scheduleEventId: ev.id,
        userId: 'm2',
        date: '2026-07-04',
        startMinute: 1080,
        createdAt: NOW,
      });
      tables.event.set(MOIM_ID, { ...ev, confirmedAt: NOW });

      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-05'],
        1080,
        1440,
        30,
      );
      expect(slotsFor(EVENT_ID)).toHaveLength(0);
      expect(tables.event.get(MOIM_ID).confirmedAt).toBeNull();
      expect(tables.event.get(MOIM_ID).dates).toEqual(['2026-07-05']);
    });
  });

  // ── setMyAvailability ─────────────────────────────────────────────────────
  describe('setMyAvailability', () => {
    async function seedEvent(): Promise<void> {
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1080,
        1440,
        30,
      );
    }

    it('비멤버 403', async () => {
      await seedEvent();
      await expect(
        service.setMyAvailability('stranger', MOIM_ID, []),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('미설정 세션 → (NotFound) 400 계열 에러', async () => {
      await expect(
        service.setMyAvailability('owner', MOIM_ID, []),
      ).rejects.toThrow();
    });

    it('확정된 세션은 수정 불가(400)', async () => {
      await seedEvent();
      const ev = tables.event.get(MOIM_ID);
      tables.event.set(MOIM_ID, { ...ev, confirmedAt: NOW });
      await expect(
        service.setMyAvailability('owner', MOIM_ID, [
          { date: '2026-07-04', startMinute: 1080 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('후보 밖 날짜 슬롯 → 400', async () => {
      await seedEvent();
      await expect(
        service.setMyAvailability('owner', MOIM_ID, [
          { date: '2026-07-09', startMinute: 1080 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('범위 밖 시각 → 400', async () => {
      await seedEvent();
      await expect(
        service.setMyAvailability('owner', MOIM_ID, [
          { date: '2026-07-04', startMinute: 1500 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('격자 어긋난 시각 → 400', async () => {
      await seedEvent();
      await expect(
        service.setMyAvailability('owner', MOIM_ID, [
          { date: '2026-07-04', startMinute: 1095 },
        ]),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('정상 교체 저장 + 중복 제거', async () => {
      await seedEvent();
      await service.setMyAvailability('owner', MOIM_ID, [
        { date: '2026-07-04', startMinute: 1080 },
        { date: '2026-07-04', startMinute: 1080 }, // 중복
        { date: '2026-07-04', startMinute: 1110 },
      ]);
      const mine = slotsFor(EVENT_ID).filter((s) => s.userId === 'owner');
      expect(mine).toHaveLength(2);
    });

    it('재호출 시 내 슬롯만 교체(다른 멤버 보존)', async () => {
      await seedEvent();
      await service.setMyAvailability('owner', MOIM_ID, [
        { date: '2026-07-04', startMinute: 1080 },
      ]);
      await service.setMyAvailability('m2', MOIM_ID, [
        { date: '2026-07-04', startMinute: 1110 },
      ]);
      // owner 재교체
      await service.setMyAvailability('owner', MOIM_ID, [
        { date: '2026-07-04', startMinute: 1140 },
      ]);
      const all = slotsFor(EVENT_ID);
      expect(all.filter((s) => s.userId === 'owner')).toHaveLength(1);
      expect(all.filter((s) => s.userId === 'm2')).toHaveLength(1);
      expect(all.find((s) => s.userId === 'owner').startMinute).toBe(1140);
    });
  });

  // ── confirmSchedule ───────────────────────────────────────────────────────
  describe('confirmSchedule', () => {
    async function seedEvent(): Promise<void> {
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1080,
        1440,
        30,
      );
    }

    it('비-owner 403', async () => {
      await seedEvent();
      await expect(
        service.confirmSchedule('m2', MOIM_ID, '2026-07-04', 1080),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('후보 밖 날짜 → 400', async () => {
      await seedEvent();
      await expect(
        service.confirmSchedule('owner', MOIM_ID, '2026-07-09', 1080),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('정상 확정 → moim.startsAt 갱신 + confirmedAt', async () => {
      await seedEvent();
      await service.confirmSchedule('owner', MOIM_ID, '2026-07-04', 1320);
      expect(tables.moim.get(MOIM_ID).startsAt.toISOString()).toBe(
        '2026-07-04T13:00:00.000Z',
      );
      expect(tables.event.get(MOIM_ID).confirmedAt).not.toBeNull();
    });
  });

  // ── deleteSchedule ────────────────────────────────────────────────────────
  describe('deleteSchedule', () => {
    it('비-owner 403', async () => {
      await expect(
        service.deleteSchedule('m2', MOIM_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('owner 삭제 + 멱등(없어도 성공)', async () => {
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1080,
        1440,
        30,
      );
      await service.deleteSchedule('owner', MOIM_ID);
      expect(tables.event.get(MOIM_ID)).toBeUndefined();
      // 멱등 — 다시 호출해도 throw 하지 않음
      await expect(
        service.deleteSchedule('owner', MOIM_ID),
      ).resolves.toBeUndefined();
    });
  });
});
