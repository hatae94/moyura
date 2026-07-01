import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ScheduleEvent, ScheduleSlot } from '../generated/prisma/client';
import { MoimService } from '../moim/moim.service';
import { PrismaService } from '../prisma/prisma.service';

// 세션 + 전체 멤버 슬롯(GET 응답 / 변경 후 반환의 형태).
export type ScheduleEventWithSlots = ScheduleEvent & { slots: ScheduleSlot[] };

// 허용 슬롯 단위(분). When2meet 표준 30분 + 15/60 옵션.
export const ALLOWED_SLOT_MINUTES = [15, 30, 60] as const;
// 하루 시간 범위 상한(분). 자정 넘김(>1440) 허용하되 최대 48시간(이틀)까지 — 비현실적 범위 방어.
const MAX_END_MINUTE = 2880;

// 멤버가 제출하는 가능 슬롯 1건.
export interface SlotInput {
  date: string;
  startMinute: number;
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly prisma: PrismaService,
    // 인가는 MoimService.assertOwner/assertMember 단일 출처를 재사용한다(재구현 금지 — expense/poll 동일).
    private readonly moim: MoimService,
  ) {}

  // 일정 조율 세션 설정/재설정(owner 전용). moimId @unique 라 모임당 1개 — 재설정은 upsert.
  // 재설정 시 후보 날짜/시간 범위가 바뀌어 기존 슬롯이 무효가 되므로 전부 삭제하고 confirmedAt 도 리셋한다.
  async setSchedule(
    sub: string,
    moimId: string,
    dates: string[],
    startMinute: number,
    endMinute: number,
    slotMinutes: number,
  ): Promise<ScheduleEventWithSlots> {
    await this.moim.assertOwner(sub, moimId);
    this.validateConfig(dates, startMinute, endMinute, slotMinutes);

    const existing = await this.prisma.scheduleEvent.findUnique({
      where: { moimId },
    });

    if (existing) {
      // 재설정: 무효 슬롯 정리 + 메타 갱신 + 확정 해제. update 가 트리거를 1회 발화(방송).
      await this.prisma.scheduleSlot.deleteMany({
        where: { scheduleEventId: existing.id },
      });
      return this.prisma.scheduleEvent.update({
        where: { moimId },
        data: {
          createdBy: sub,
          dates,
          startMinute,
          endMinute,
          slotMinutes,
          confirmedAt: null,
        },
        include: { slots: true },
      });
    }

    return this.prisma.scheduleEvent.create({
      data: { moimId, createdBy: sub, dates, startMinute, endMinute, slotMinutes },
      include: { slots: true },
    });
  }

  // 세션 + 전체 멤버 슬롯 조회(멤버 한정). 미설정이면 null(빈 상태 UI). 비멤버/없는 모임 → assertMember 가 throw.
  async getSchedule(
    sub: string,
    moimId: string,
  ): Promise<ScheduleEventWithSlots | null> {
    await this.moim.assertMember(sub, moimId);
    return this.prisma.scheduleEvent.findUnique({
      where: { moimId },
      include: { slots: true },
    });
  }

  // 내 가능 슬롯 통째 교체(멤버). 그리드에서 칠한 셀 전체를 매번 받아 deleteMany+createMany 로 교체한다.
  // 확정 후에는 수정 불가(읽기 전용). 모든 변경은 schedule_event touch 로 트리거를 1회만 발화(방송 폭주 방지).
  async setMyAvailability(
    sub: string,
    moimId: string,
    slots: SlotInput[],
  ): Promise<void> {
    await this.moim.assertMember(sub, moimId);

    const event = await this.prisma.scheduleEvent.findUnique({
      where: { moimId },
    });
    if (!event) {
      throw new NotFoundException('일정 조율이 아직 설정되지 않았습니다');
    }
    if (event.confirmedAt) {
      throw new BadRequestException('이미 확정된 일정이라 수정할 수 없습니다');
    }

    // 각 슬롯이 세션의 날짜·시간 범위·격자에 정렬되는지 검증한 뒤 (date,startMinute) 중복을 제거한다.
    const validated = this.validateSlots(event, slots);

    // 트랜잭션: 내 슬롯 삭제 → 새 슬롯 생성 → event touch(updated_at 갱신 = 트리거 1회 방송).
    // schedule_slot 자체에는 트리거가 없으므로(폭주 방지), event touch 가 실시간 신호의 유일한 발화점이다.
    await this.prisma.$transaction([
      this.prisma.scheduleSlot.deleteMany({
        where: { scheduleEventId: event.id, userId: sub },
      }),
      ...(validated.length > 0
        ? [
            this.prisma.scheduleSlot.createMany({
              data: validated.map((s) => ({
                scheduleEventId: event.id,
                userId: sub,
                date: s.date,
                startMinute: s.startMinute,
              })),
              skipDuplicates: true,
            }),
          ]
        : []),
      this.prisma.scheduleEvent.update({
        where: { id: event.id },
        data: { updatedAt: new Date() },
      }),
    ]);
  }

  // 일정 확정(owner). 선택한 (date, startMinute)을 KST 기준 절대 시각으로 환산해 moim.startsAt 에 기록하고
  // confirmedAt 을 남긴다(이후 멤버 슬롯 수정 불가). poll.service 의 setStartsAt 과 동일한 "확정→startsAt" 계약.
  async confirmSchedule(
    sub: string,
    moimId: string,
    date: string,
    startMinute: number,
  ): Promise<void> {
    await this.moim.assertOwner(sub, moimId);

    const event = await this.prisma.scheduleEvent.findUnique({
      where: { moimId },
    });
    if (!event) {
      throw new NotFoundException('일정 조율이 아직 설정되지 않았습니다');
    }
    if (!event.dates.includes(date)) {
      throw new BadRequestException('확정 날짜가 후보 날짜에 없습니다');
    }
    this.assertSlotAligned(event, startMinute);

    const startsAt = computeStartsAt(date, startMinute);

    // 트랜잭션: moim.startsAt 확정 + event.confirmedAt 기록(= touch → 트리거 1회 방송).
    await this.prisma.$transaction([
      this.prisma.moim.update({
        where: { id: moimId },
        data: { startsAt },
      }),
      this.prisma.scheduleEvent.update({
        where: { id: event.id },
        data: { confirmedAt: new Date() },
      }),
    ]);
  }

  // 세션 삭제/초기화(owner). 없어도 멱등(no-op). event DELETE 트리거가 방송, 슬롯은 Cascade 정리.
  async deleteSchedule(sub: string, moimId: string): Promise<void> {
    await this.moim.assertOwner(sub, moimId);
    await this.prisma.scheduleEvent.deleteMany({ where: { moimId } });
  }

  // ── 검증 ────────────────────────────────────────────────────────────────────

  // 세션 설정 검증: 날짜 1개 이상·형식, 시간 범위 정합(start<end, 상한, 격자), 슬롯 단위 허용.
  private validateConfig(
    dates: string[],
    startMinute: number,
    endMinute: number,
    slotMinutes: number,
  ): void {
    if (!Array.isArray(dates) || dates.length === 0) {
      throw new BadRequestException('후보 날짜를 한 개 이상 선택해 주세요');
    }
    if (dates.length > 31) {
      throw new BadRequestException('후보 날짜는 최대 31개까지 가능합니다');
    }
    for (const d of dates) {
      if (!isValidIsoDate(d)) {
        throw new BadRequestException(`날짜 형식이 올바르지 않습니다: ${d}`);
      }
    }
    // 후보 날짜 중복 금지(같은 날 두 번 → 그리드 컬럼 중복).
    if (new Set(dates).size !== dates.length) {
      throw new BadRequestException('후보 날짜에 중복이 있습니다');
    }
    if (!ALLOWED_SLOT_MINUTES.includes(slotMinutes as never)) {
      throw new BadRequestException('슬롯 단위는 15/30/60분 중 하나여야 합니다');
    }
    if (!Number.isInteger(startMinute) || startMinute < 0 || startMinute > 1440) {
      throw new BadRequestException('시작 시각이 올바르지 않습니다(0~1440분)');
    }
    if (!Number.isInteger(endMinute) || endMinute <= startMinute) {
      throw new BadRequestException('종료 시각은 시작 시각보다 커야 합니다');
    }
    if (endMinute > MAX_END_MINUTE) {
      throw new BadRequestException('시간 범위가 너무 넓습니다(최대 48시간)');
    }
    if ((endMinute - startMinute) % slotMinutes !== 0) {
      throw new BadRequestException('시간 범위가 슬롯 단위로 나누어떨어지지 않습니다');
    }
  }

  // 멤버 슬롯 검증: 각 슬롯의 날짜가 후보에 있고, startMinute 이 시간 범위·격자에 정렬되는지 확인 후 중복 제거.
  private validateSlots(
    event: ScheduleEvent,
    slots: SlotInput[],
  ): SlotInput[] {
    if (!Array.isArray(slots)) {
      throw new BadRequestException('슬롯 형식이 올바르지 않습니다');
    }
    const dateSet = new Set(event.dates);
    const seen = new Set<string>();
    const result: SlotInput[] = [];
    for (const s of slots) {
      if (typeof s?.date !== 'string' || !dateSet.has(s.date)) {
        throw new BadRequestException(`후보 날짜가 아닌 슬롯입니다: ${s?.date}`);
      }
      this.assertSlotAligned(event, s.startMinute);
      const key = `${s.date}#${s.startMinute}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ date: s.date, startMinute: s.startMinute });
      }
    }
    return result;
  }

  // startMinute 이 세션 시간 범위 [start, end) 안 + 슬롯 격자에 정렬되는지 확인.
  private assertSlotAligned(event: ScheduleEvent, startMinute: number): void {
    if (
      !Number.isInteger(startMinute) ||
      startMinute < event.startMinute ||
      startMinute >= event.endMinute
    ) {
      throw new BadRequestException('시간 범위를 벗어난 슬롯입니다');
    }
    if ((startMinute - event.startMinute) % event.slotMinutes !== 0) {
      throw new BadRequestException('슬롯 격자에 맞지 않습니다');
    }
  }
}

// ── 순수 헬퍼 ──────────────────────────────────────────────────────────────────

// "YYYY-MM-DD" 형식 + 실제 유효 날짜(2026-02-30 같은 비존재 거부) 검증.
function isValidIsoDate(s: string): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// (date, startMinute) → 절대 시각(Date). startMinute 은 후보일 00:00 KST 기준 분이라,
// KST 자정에 분을 더해 환산한다. startMinute>1440 이면 자연히 다음날 새벽이 된다(자정 넘김).
// 명시 offset(+09:00)이라 서버 TZ 와 무관하게 결정적이다(절대 시각 — UTC 로 저장된다).
export function computeStartsAt(date: string, startMinute: number): Date {
  const base = new Date(`${date}T00:00:00+09:00`);
  if (isNaN(base.getTime())) {
    throw new BadRequestException('확정 날짜가 올바르지 않습니다');
  }
  return new Date(base.getTime() + startMinute * 60_000);
}
