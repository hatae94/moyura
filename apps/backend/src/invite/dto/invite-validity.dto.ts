import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 초대 유효성 공개 응답 DTO(SPEC-MOIM-011). 인증 없이 노출되므로
// moimId + 초대 미리보기용 모임 요약(name·memberCount·maxMembers)만 반환한다.
// 토큰이 256-bit 비밀이라 링크 수신자에게만 보이는 의도된 공개 정보다 —
// token·maxUses·usedCount·expiresAt·createdBy 등 민감 필드는 노출하지 않는다.
export class InviteValidityDto {
  @ApiProperty({
    description: '초대가 속한 모임 id',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  moimId!: string;

  @ApiProperty({
    description: '모임 이름(초대 미리보기 표시용)',
    example: '주말 등산 모임',
  })
  name!: string;

  @ApiProperty({
    description: '현재 모임 멤버 수(초대 미리보기 표시용)',
    example: 7,
  })
  memberCount!: number;

  @ApiProperty({
    description: '모임 최대 정원',
    example: 15,
  })
  maxMembers!: number;
}
