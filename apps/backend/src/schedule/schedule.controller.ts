import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { ConfirmScheduleDto } from './dto/schedule-request.dto';
import { SetAvailabilityDto } from './dto/schedule-request.dto';
import { SetScheduleDto } from './dto/schedule-request.dto';
import { ScheduleResponseDto } from './dto/schedule-response.dto';
import type { ScheduleEventWithSlots, SlotInput } from './schedule.service';
import { ScheduleService } from './schedule.service';

// @MX:NOTE: [AUTO] 일정 조율 HTTP 표면(SPEC-SCHEDULE-001). ExpenseController 미러 — moimId 가 항상 path 에
// 있어 ScheduleService 가 assertOwner/assertMember 로 인가를 단일 판정한다. ValidationPipe 부재(MOIM-001 동일)
// → 명시적 검증 헬퍼로 400 을 던진다. 도메인 검증(범위/격자/날짜)은 ScheduleService 가 담당한다.
@ApiTags('schedule')
@ApiBearerAuth('bearer')
@Controller('moims/:id/schedule')
@UseGuards(SupabaseAuthGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  // PUT /moims/:id/schedule — 세션 설정/재설정(owner 전용). 200. 재설정은 멤버 슬롯을 초기화한다.
  @Put()
  @ApiOkResponse({
    description: '일정 조율 세션 설정/재설정',
    type: ScheduleResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({
    description: '날짜/시간 범위/슬롯 단위 검증 실패 — 400',
  })
  async set(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: SetScheduleDto,
  ): Promise<ScheduleResponseDto> {
    const dates = requireStringArray(body?.dates, 'dates');
    const startMinute = requireInt(body?.startMinute, 'startMinute');
    const endMinute = requireInt(body?.endMinute, 'endMinute');
    const slotMinutes =
      body?.slotMinutes === undefined || body.slotMinutes === null
        ? 30
        : requireInt(body.slotMinutes, 'slotMinutes');

    const event = await this.scheduleService.setSchedule(
      user.sub,
      moimId,
      dates,
      startMinute,
      endMinute,
      slotMinutes,
    );
    return { schedule: toScheduleDto(event) };
  }

  // GET /moims/:id/schedule — 세션 + 전체 멤버 슬롯(멤버 한정). 200. 미설정이면 schedule=null.
  @Get()
  @ApiOkResponse({
    description: '일정 조율 세션(미설정이면 null)',
    type: ScheduleResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '멤버 아님(또는 모임 미존재) — 403' })
  async get(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
  ): Promise<ScheduleResponseDto> {
    const event = await this.scheduleService.getSchedule(user.sub, moimId);
    return { schedule: event ? toScheduleDto(event) : null };
  }

  // PUT /moims/:id/schedule/me — 내 가능 슬롯 통째 교체(멤버). 204. 확정된 세션은 400.
  @Put('me')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '내 가능 슬롯 교체 저장' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '멤버 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({ description: '미설정/확정됨/범위 밖 슬롯 — 400' })
  async setMine(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: SetAvailabilityDto,
  ): Promise<void> {
    const slots = requireSlotArray(body?.slots);
    await this.scheduleService.setMyAvailability(user.sub, moimId, slots);
  }

  // PUT /moims/:id/schedule/dates — 후보 날짜 편집(멤버 누구나, 협업). 200. 시간범위/슬롯 유지·슬롯 보존.
  @Put('dates')
  @ApiOkResponse({
    description: '후보 날짜 편집(멤버 누구나)',
    type: ScheduleResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '멤버 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({ description: '미설정/확정됨/날짜 형식 — 400' })
  async setDates(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: { dates?: unknown },
  ): Promise<ScheduleResponseDto> {
    const dates = requireStringArray(body?.dates, 'dates');
    const event = await this.scheduleService.updateDates(
      user.sub,
      moimId,
      dates,
    );
    return { schedule: toScheduleDto(event) };
  }

  // PUT /moims/:id/schedule/window — 시간대 넓히기(멤버 누구나, 협업). 200. 넓히기 전용·슬롯 보존.
  @Put('window')
  @ApiOkResponse({
    description: '시간대 넓히기(멤버 누구나)',
    type: ScheduleResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '멤버 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({
    description: '미설정/확정됨/좁히기/격자 어긋남 — 400',
  })
  async setWindow(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: { startMinute?: unknown; endMinute?: unknown },
  ): Promise<ScheduleResponseDto> {
    const startMinute = requireInt(body?.startMinute, 'startMinute');
    const endMinute = requireInt(body?.endMinute, 'endMinute');
    const event = await this.scheduleService.updateWindow(
      user.sub,
      moimId,
      startMinute,
      endMinute,
    );
    return { schedule: toScheduleDto(event) };
  }

  // POST /moims/:id/schedule/confirm — 일정 확정(owner). 204. moim.startsAt 이 갱신된다.
  @Post('confirm')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '일정 확정(moim.startsAt 갱신)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({
    description: '미설정/후보 밖 날짜/범위 밖 시각 — 400',
  })
  async confirm(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: ConfirmScheduleDto,
  ): Promise<void> {
    const date = requireNonEmpty(body?.date, 'date');
    const startMinute = requireInt(body?.startMinute, 'startMinute');
    await this.scheduleService.confirmSchedule(
      user.sub,
      moimId,
      date,
      startMinute,
    );
  }

  // DELETE /moims/:id/schedule — 세션 삭제/초기화(owner). 204. 멱등.
  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse({ description: '일정 조율 세션 삭제(초기화)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  async remove(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
  ): Promise<void> {
    await this.scheduleService.deleteSchedule(user.sub, moimId);
  }
}

// ── 검증 헬퍼(ValidationPipe 부재 보완, expense/poll 선례) ────────────────────

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field}은(는) 비어 있을 수 없습니다`);
  }
  return value.trim();
}

function requireInt(value: unknown, field: string): number {
  if (!Number.isInteger(value)) {
    throw new BadRequestException(`${field}은(는) 정수여야 합니다`);
  }
  return value as number;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BadRequestException(`${field}은(는) 문자열 배열이어야 합니다`);
  }
  return value as string[];
}

// 슬롯 배열 형식 검증(각 항목 { date:string, startMinute:int }). 빈 배열 허용(전부 해제).
function requireSlotArray(value: unknown): SlotInput[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('slots 는 배열이어야 합니다');
  }
  // Array.isArray 는 any[] 로 좁히므로 unknown[] 로 재캐스팅해 각 원소를 명시적으로 검증한다(no-unsafe 회피).
  return (value as unknown[]).map((raw, i): SlotInput => {
    const s = raw as { date?: unknown; startMinute?: unknown };
    if (
      typeof s.date !== 'string' ||
      s.date.trim().length === 0 ||
      !Number.isInteger(s.startMinute)
    ) {
      throw new BadRequestException(
        `slots[${i}] 형식이 올바르지 않습니다(date:string, startMinute:int)`,
      );
    }
    return { date: s.date, startMinute: s.startMinute as number };
  });
}

// ── DTO 변환 ────────────────────────────────────────────────────────────────

function toScheduleDto(event: ScheduleEventWithSlots) {
  return {
    id: event.id,
    moimId: event.moimId,
    createdBy: event.createdBy,
    dates: event.dates,
    startMinute: event.startMinute,
    endMinute: event.endMinute,
    slotMinutes: event.slotMinutes,
    confirmedAt: event.confirmedAt ? event.confirmedAt.toISOString() : null,
    slots: event.slots.map((s) => ({
      userId: s.userId,
      date: s.date,
      startMinute: s.startMinute,
    })),
  };
}
