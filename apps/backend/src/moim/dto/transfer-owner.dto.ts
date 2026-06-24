import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 소유권 이양 요청 바디. userId 비어 있음 검사는 서비스에서 명시적으로 수행한다(C-1 패턴).
export class TransferOwnerDto {
  @ApiProperty({
    description: '소유권을 이양받을 대상 멤버 userId(비어 있을 수 없음)',
    example: '00000000-0000-4000-8000-000000000002',
  })
  userId!: string;
}
