import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// SPEC-SCHEDULE-001: 일정 조율 세션 설정/재설정 요청(owner). PUT /moims/:id/schedule.
// 검증(형식)은 컨트롤러 헬퍼가, 도메인 검증(범위/격자)은 ScheduleService 가 담당한다(ValidationPipe 부재).
export class SetScheduleDto {
  @ApiProperty({
    description: '후보 날짜 배열(ISO date "YYYY-MM-DD"). 최소 1개, 임의 다수.',
    example: ['2026-07-05', '2026-07-06', '2026-07-12'],
    type: [String],
  })
  dates!: string[];

  @ApiProperty({
    description: '하루 시작 시각(후보일 00:00 기준 분, 0~1440).',
    example: 1080,
  })
  startMinute!: number;

  @ApiProperty({
    description:
      '하루 종료 시각(후보일 00:00 기준 분). startMinute 초과 + 자정 넘김 시 1440 초과 가능(예: 익일 02:00 = 1560).',
    example: 1440,
  })
  endMinute!: number;

  @ApiPropertyOptional({
    description: '슬롯 단위(분). 15/30/60 중 하나. 생략 시 30.',
    example: 30,
    default: 30,
  })
  slotMinutes?: number;
}

// SPEC-SCHEDULE-001: 내 가능 슬롯 통째 교체 요청(멤버). PUT /moims/:id/schedule/me.
// 그리드에서 칠한 셀 전체를 매번 보낸다(증분 아님 — deleteMany+createMany 로 교체 저장). 빈 배열 = 전부 해제.
export class SetAvailabilityDto {
  @ApiProperty({
    description:
      '가능 슬롯 배열. 각 항목 { date, startMinute }. 세션의 dates·시간 범위·슬롯 격자에 정렬되어야 한다(미정렬 → 400).',
    example: [
      { date: '2026-07-05', startMinute: 1080 },
      { date: '2026-07-05', startMinute: 1110 },
    ],
    type: 'array',
    items: {
      type: 'object',
      properties: {
        date: { type: 'string', example: '2026-07-05' },
        startMinute: { type: 'number', example: 1080 },
      },
    },
  })
  slots!: Array<{ date: string; startMinute: number }>;
}

// SPEC-SCHEDULE-001: 일정 확정 요청(owner). POST /moims/:id/schedule/confirm.
// 선택한 (date, startMinute)을 moim.startsAt 으로 확정한다(KST 기준 절대 시각 계산).
export class ConfirmScheduleDto {
  @ApiProperty({
    description: '확정할 날짜(ISO date "YYYY-MM-DD"). 세션 dates 중 하나여야 한다.',
    example: '2026-07-05',
  })
  date!: string;

  @ApiProperty({
    description:
      '확정할 시작 시각(후보일 00:00 기준 분). 세션 시간 범위·격자에 정렬. >1440 이면 다음날 새벽(자정 넘김).',
    example: 1080,
  })
  startMinute!: number;
}
