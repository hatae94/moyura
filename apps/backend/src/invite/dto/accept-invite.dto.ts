import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 초대 수락 요청 바디(REQ-INV-005). nickname은 모임별 표시 이름(moim_member.nickname).
// ValidationPipe 부재(C-1)라 빈/공백 검사는 InviteService.accept가 명시적으로 수행한다(400).
export class AcceptInviteDto {
  @ApiProperty({
    description: '수락자의 모임별 표시 이름(비어 있을 수 없음)',
    example: '게스트1',
  })
  nickname!: string;
}
