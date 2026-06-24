import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 초대 유효성 공개 응답 DTO(SPEC-MOIM-011). 인증 없이 노출되므로
// 유효/만료/폐기 상태와 moimId만 반환한다 — token·maxUses·usedCount 등 민감 필드 제외.
export class InviteValidityDto {
  @ApiProperty({
    description: '초대가 속한 모임 id',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  moimId!: string;
}
