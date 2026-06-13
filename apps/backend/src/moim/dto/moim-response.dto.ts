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
