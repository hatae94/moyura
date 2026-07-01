import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// SPEC-SCHEDULE-001: 멤버별 가능 슬롯(히트맵 집계 원자료). nickname 은 포함하지 않는다 —
// 웹이 멤버 목록(GET /moims/:id/members)으로 userId→nickname 을 해석한다(expense/chat 의 thin 원칙 동일).
export class ScheduleSlotDto {
  @ApiProperty({ description: '가능 멤버 sub(= profile.id)', example: 'uuid' })
  userId!: string;

  @ApiProperty({ description: '슬롯 날짜(ISO date)', example: '2026-07-05' })
  date!: string;

  @ApiProperty({
    description: '슬롯 시작(후보일 00:00 기준 분, >=1440 이면 다음날)',
    example: 1080,
  })
  startMinute!: number;
}

// SPEC-SCHEDULE-001: 일정 조율 세션 + 전체 멤버 슬롯. confirmedAt 이 있으면 확정 완료(읽기 전용).
export class ScheduleEventDto {
  @ApiProperty({ example: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'uuid' })
  moimId!: string;

  @ApiProperty({ description: '생성자 sub', example: 'uuid' })
  createdBy!: string;

  @ApiProperty({
    description: '후보 날짜 배열',
    type: [String],
    example: ['2026-07-05', '2026-07-06'],
  })
  dates!: string[];

  @ApiProperty({ description: '하루 시작(분)', example: 1080 })
  startMinute!: number;

  @ApiProperty({ description: '하루 종료(분, >1440=자정 넘김)', example: 1440 })
  endMinute!: number;

  @ApiProperty({ description: '슬롯 단위(분)', example: 30 })
  slotMinutes!: number;

  @ApiPropertyOptional({
    description:
      '확정 시각(ISO datetime, nullable). 있으면 moim.startsAt 이 확정되어 그리드가 읽기 전용.',
    example: '2026-07-01T12:00:00.000Z',
    nullable: true,
  })
  confirmedAt!: string | null;

  @ApiProperty({ description: '전체 멤버 가능 슬롯', type: [ScheduleSlotDto] })
  slots!: ScheduleSlotDto[];
}

// SPEC-SCHEDULE-001: GET /moims/:id/schedule 응답. schedule=null 이면 아직 미설정(빈 상태 UI).
export class ScheduleResponseDto {
  @ApiPropertyOptional({
    description: '일정 조율 세션(미설정이면 null)',
    type: ScheduleEventDto,
    nullable: true,
  })
  schedule!: ScheduleEventDto | null;
}
