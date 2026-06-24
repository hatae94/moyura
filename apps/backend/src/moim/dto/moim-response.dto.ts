import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 모임 공개 표현(REQ-MOIM-004/005). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// createdAt은 ISO-8601 문자열로 직렬화한다(profile-response.dto.ts 패턴 동일).
export class MoimResponseDto {
  @ApiProperty({
    description: '모임 id(uuid)',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  id!: string;

  @ApiProperty({ description: '모임 이름', example: '주말 등산 모임' })
  name!: string;

  // SPEC-MOIM-004 REQ-MOIM4-003: 이벤트 일정(ISO-8601 또는 null). 일정 미정 모임은 null.
  @ApiProperty({
    description: '이벤트 일정(ISO-8601) 또는 null(일정 미정)',
    type: String,
    nullable: true,
    example: '2026-07-01T10:00:00.000Z',
  })
  startsAt!: string | null;

  // SPEC-MOIM-004 REQ-MOIM4-003: 자유 텍스트 장소 또는 null(장소 미정).
  @ApiProperty({
    description: '이벤트 장소(자유 텍스트) 또는 null',
    type: String,
    nullable: true,
    example: '강남역 스타벅스',
  })
  location!: string | null;

  // SPEC-MOIM-012 REQ-MOIM12-001: 모임 정원. 기본 15, 1 이상.
  @ApiProperty({
    description: '모임 정원(기본 15). 현재 멤버 수가 이 값 이상이면 신규 가입이 409로 거부된다.',
    example: 15,
  })
  maxMembers!: number;

  // SPEC-MOIM-EXPENSE-001 REQ-EXP-010: 선택적 모임 예산(KRW 정수 또는 null). 미설정 모임은 null.
  @ApiProperty({
    description: '모임 예산(KRW 정수 또는 null). null = 예산 미설정.',
    type: Number,
    nullable: true,
    example: null,
  })
  budget!: number | null;

  @ApiProperty({
    description: '생성자 sub(= profile.id)',
    example: '00000000-0000-4000-8000-000000000001',
  })
  createdBy!: string;

  @ApiProperty({
    description: '모임 생성 시각(ISO-8601)',
    example: '2026-06-13T00:00:00.000Z',
  })
  createdAt!: string;
}
