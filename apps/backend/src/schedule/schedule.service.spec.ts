import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Moim,
  ScheduleEvent,
  ScheduleSlot,
} from '../generated/prisma/client';
import type { MoimService } from '../moim/moim.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { SafetyService } from '../safety/safety.service';
import {
  MOIM_SCHEDULE_CONFIRMED,
  MOIM_SCHEDULE_DATES_CHANGED,
  MOIM_SCHEDULE_STARTED,
  MOIM_SCHEDULE_WINDOW_CHANGED,
} from './schedule-events';
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
  // SPEC-NOTIFICATIONS-001 M2: EventEmitter2.emit 스텁(발행 검증용, per-test 초기화).
  let emit: jest.Mock;
  // SPEC-SAFETY-001 T-007: 뷰어(sub)가 숨긴 userId 집합(block∪report). getHiddenUserIds 스텁이 읽는다.
  let hidden: string[];
  let getHiddenUserIds: jest.Mock<Promise<string[]>, [string]>;

  function reset(): void {
    tables = { event: new Map(), slot: new Map(), moim: new Map() };
    owners = new Map();
    members = new Set();
    hidden = [];
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
    emit = jest.fn();
    // SPEC-SAFETY-001 T-007: getHiddenUserIds 스텁 — hidden 배열을 반환한다(뷰어별 숨김, 요청당 1회 조회 계약 재현).
    getHiddenUserIds = jest.fn<Promise<string[]>, [string]>(() =>
      Promise.resolve(hidden),
    );
    const safety = { getHiddenUserIds } as unknown as SafetyService;
    service = new ScheduleService(
      prisma,
      moim,
      { emit } as unknown as EventEmitter2,
      safety,
    );
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

  // ── updateWindow (시간대 넓히기, 멤버 누구나) ─────────────────────────────────
  describe('updateWindow', () => {
    async function seedEvent(): Promise<void> {
      // 18:00~24:00 / 30분 격자.
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
        service.updateWindow('stranger', MOIM_ID, 1020, 1440),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('미설정 세션 → NotFound(throw)', async () => {
      await expect(
        service.updateWindow('m2', MOIM_ID, 1020, 1440),
      ).rejects.toThrow();
    });

    it('확정된 세션은 시간대 변경 불가(400)', async () => {
      await seedEvent();
      const ev = tables.event.get(MOIM_ID);
      tables.event.set(MOIM_ID, { ...ev, confirmedAt: NOW });
      await expect(
        service.updateWindow('m2', MOIM_ID, 1020, 1440),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('좁히기 시도(시작 증가) → 400', async () => {
      await seedEvent();
      await expect(
        service.updateWindow('m2', MOIM_ID, 1110, 1440),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('좁히기 시도(종료 감소) → 400', async () => {
      await seedEvent();
      await expect(
        service.updateWindow('m2', MOIM_ID, 1080, 1410),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('격자 어긋난 시작(1065) → 400', async () => {
      await seedEvent();
      await expect(
        service.updateWindow('m2', MOIM_ID, 1065, 1440),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('멤버가 앞으로 넓히기(17:00) 정상 + 기존 슬롯 보존', async () => {
      await seedEvent();
      // 멤버 슬롯 시드(18:00) — 넓혀도 유효해야 한다.
      await service.setMyAvailability('m2', MOIM_ID, [
        { date: '2026-07-04', startMinute: 1080 },
      ]);
      const ev = await service.updateWindow('m2', MOIM_ID, 1020, 1440);
      expect(ev.startMinute).toBe(1020);
      expect(ev.endMinute).toBe(1440);
      expect(ev.slots.filter((s) => s.userId === 'm2')).toHaveLength(1);
    });

    it('멤버가 뒤로(자정 넘김, 익일 01:00) 넓히기 정상', async () => {
      await seedEvent();
      const ev = await service.updateWindow('m2', MOIM_ID, 1080, 1500);
      expect(ev.startMinute).toBe(1080);
      expect(ev.endMinute).toBe(1500);
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

  // ── getSchedule 뷰어 필터 (SPEC-SAFETY-001 T-007) ────────────────────────────
  // REQ-FLT-004 / AC-FLT-4: 히트맵 응답의 event.slots 에서 차단·신고 대상(hidden) userId 슬롯을 제외한다.
  // 슬롯은 include:{slots:true} 로 이벤트에 중첩 로드되므로 top-level where 가 아니라 응답 매핑 시점에 필터한다.
  // dates/window 협업 편집 필드는 작성자 추적이 없어 필터 불가(한계) — 값이 원본 그대로 유지되는지도 검증한다.
  describe('getSchedule 뷰어 필터 (SPEC-SAFETY-001 T-007)', () => {
    async function seedWithSlots(): Promise<void> {
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1080,
        1440,
        30,
      );
      const ev = tables.event.get(MOIM_ID);
      // owner / m2 / blocked-user 슬롯을 시드한다(blocked-user 는 hidden 대상).
      for (const [uid, min] of [
        ['owner', 1080],
        ['m2', 1110],
        ['blocked-user', 1140],
      ] as const) {
        tables.slot.set(slotKey(ev.id, uid, '2026-07-04', min), {
          scheduleEventId: ev.id,
          userId: uid,
          date: '2026-07-04',
          startMinute: min,
          createdAt: NOW,
        });
      }
    }

    it('hidden userId 슬롯을 응답에서 제외한다(다른 멤버 슬롯은 유지)', async () => {
      await seedWithSlots();
      hidden = ['blocked-user'];
      const result = await service.getSchedule('owner', MOIM_ID);
      const userIds = result.slots.map((s) => s.userId);
      expect(userIds).toEqual(expect.arrayContaining(['owner', 'm2']));
      expect(userIds).not.toContain('blocked-user');
      expect(result.slots).toHaveLength(2);
      // 뷰어 sub 로 숨김 목록을 요청당 1회 조회한다.
      expect(getHiddenUserIds).toHaveBeenCalledWith('owner');
    });

    it('dates/window 협업 편집 필드는 필터하지 않는다(한계 — 원본 불변)', async () => {
      await seedWithSlots();
      hidden = ['blocked-user'];
      const result = await service.getSchedule('owner', MOIM_ID);
      // 슬롯만 제외될 뿐 이벤트 메타(dates/window/격자)는 원본 그대로여야 한다.
      expect(result.dates).toEqual(['2026-07-04']);
      expect(result.startMinute).toBe(1080);
      expect(result.endMinute).toBe(1440);
      expect(result.slotMinutes).toBe(30);
    });

    it('hidden 이 비어 있으면 모든 슬롯을 통과시킨다(no-op)', async () => {
      await seedWithSlots();
      hidden = [];
      const result = await service.getSchedule('owner', MOIM_ID);
      expect(result.slots).toHaveLength(3);
    });

    it('세션 미설정이면 null 을 반환한다(슬롯 없음 — 숨김 조회 생략)', async () => {
      const result = await service.getSchedule('owner', MOIM_ID);
      expect(result).toBeNull();
      // 이벤트가 없으면 필터할 슬롯도 없으므로 숨김 목록을 조회하지 않는다(불필요한 왕복 회피).
      expect(getHiddenUserIds).not.toHaveBeenCalled();
    });
  });

  // ── SPEC-NOTIFICATIONS-001 M2: 도메인 이벤트 발행 ──────────────────────────────
  // create 경로만 started 발행(재설정 update 는 미발행), 나머지는 성공 후 각 이벤트 1회 + authz 실패 미발행.
  describe('M2 이벤트 발행 (SPEC-NOTIFICATIONS-001)', () => {
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

    it('setSchedule create 경로는 schedule.started 를 1회 발행한다(scheduleEventId 포함)', async () => {
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-04'],
        1080,
        1440,
        30,
      );
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_SCHEDULE_STARTED, {
        moimId: MOIM_ID,
        actorId: 'owner',
        scheduleEventId: EVENT_ID,
      });
    });

    it('setSchedule 재설정(update) 경로는 started 를 발행하지 않는다', async () => {
      await seedEvent();
      emit.mockClear();
      // 이미 존재 → 재설정(update 경로).
      await service.setSchedule(
        'owner',
        MOIM_ID,
        ['2026-07-05'],
        1080,
        1440,
        30,
      );
      expect(emit).not.toHaveBeenCalled();
    });

    it('updateDates 는 schedule.dates_changed 를 1회 발행한다', async () => {
      await seedEvent();
      emit.mockClear();
      await service.updateDates('m2', MOIM_ID, ['2026-07-04', '2026-07-05']);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_SCHEDULE_DATES_CHANGED, {
        moimId: MOIM_ID,
        actorId: 'm2',
      });
    });

    it('updateWindow 는 schedule.window_changed 를 1회 발행한다', async () => {
      await seedEvent();
      emit.mockClear();
      await service.updateWindow('m2', MOIM_ID, 1020, 1440);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_SCHEDULE_WINDOW_CHANGED, {
        moimId: MOIM_ID,
        actorId: 'm2',
      });
    });

    it('confirmSchedule 은 schedule.confirmed 를 startsAt(ISO)과 함께 1회 발행한다', async () => {
      await seedEvent();
      emit.mockClear();
      await service.confirmSchedule('owner', MOIM_ID, '2026-07-04', 1320);
      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(MOIM_SCHEDULE_CONFIRMED, {
        moimId: MOIM_ID,
        actorId: 'owner',
        startsAt: '2026-07-04T13:00:00.000Z',
      });
    });

    it('authz 실패(비-owner setSchedule 403) 경로는 발행하지 않는다', async () => {
      await expect(
        service.setSchedule('m2', MOIM_ID, ['2026-07-04'], 1080, 1440, 30),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
