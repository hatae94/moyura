import { ApiProperty } from '@nestjs/swagger';

// SPEC-MOIM-012 REQ-MOIM12-001: 모임 정원 수정 요청 바디.
// maxMembers는 1 이상의 정수여야 한다(미달 시 컨트롤러가 400을 던진다).
export class UpdateMaxMembersDto {
  @ApiProperty({
    description: '수정할 모임 정원(1 이상의 정수). 현재 멤버 수 미만으로 낮춰도 소급 퇴장 없음(신규 가입만 차단).',
    example: 20,
  })
  maxMembers!: number;
}
