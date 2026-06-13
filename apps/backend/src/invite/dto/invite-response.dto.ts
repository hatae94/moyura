import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 초대 공개 표현(REQ-INV-001/002). token은 가입 자격증명이므로 owner 전용 응답(발급/목록)
// 에서만 노출된다 — list()가 owner 전용인 이유(REQ-INV-004). 시각 필드는 ISO-8601로 직렬화한다.
export class InviteResponseDto {
  @ApiProperty({
    description: '초대 id(uuid)',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  id!: string;

  @ApiProperty({
    description: '대상 모임 id',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  moimId!: string;

  @ApiProperty({
    description:
      '추측 불가 초대 토큰(base64url, ≥128-bit). 수락 링크에 사용한다.',
    example: 'k3J9_aZ...base64url43chars',
  })
  token!: string;

  @ApiProperty({
    description: '만료 시각(ISO-8601)',
    example: '2026-06-21T00:00:00.000Z',
  })
  expiresAt!: string;

  @ApiProperty({
    description: '사용 횟수 제한(null이면 무제한)',
    example: 5,
    nullable: true,
  })
  maxUses!: number | null;

  @ApiProperty({ description: '현재 사용 횟수', example: 0 })
  usedCount!: number;

  @ApiProperty({
    description: '폐기 시각(ISO-8601). null이면 미폐기(유효).',
    example: null,
    nullable: true,
  })
  revokedAt!: string | null;

  @ApiProperty({
    description: '발급 시각(ISO-8601)',
    example: '2026-06-14T00:00:00.000Z',
  })
  createdAt!: string;
}
