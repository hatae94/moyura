import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 멤버 공개 표현(REQ-MOIM-006 / AC-5). nickname은 profile에 name 필드가 없는 것을
// 보완하는 표시 이름 출처다(채팅 sender 해석). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
export class MemberResponseDto {
  @ApiProperty({
    description: '멤버 sub(= profile.id)',
    example: '00000000-0000-4000-8000-000000000001',
  })
  userId!: string;

  @ApiProperty({ description: '모임별 표시 이름', example: '호스트' })
  nickname!: string;

  @ApiProperty({
    description: '멤버 역할("owner" | "member")',
    example: 'owner',
  })
  role!: string;

  @ApiProperty({
    description: '가입(생성) 시각(ISO-8601)',
    example: '2026-06-13T00:00:00.000Z',
  })
  joinedAt!: string;
}
