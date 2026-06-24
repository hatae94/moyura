import { ApiProperty } from '@nestjs/swagger';

// SPEC-MOIM-012 REQ-MOIM12-001 + SPEC-MOIM-EXPENSE-001 REQ-EXP-010: 모임 설정 수정 요청 바디.
// maxMembers/budget 모두 optional — 전달된 필드만 갱신(부분 갱신). 둘 다 미전달이면 아무것도 바뀌지 않는다.
export class UpdateMaxMembersDto {
  @ApiProperty({
    description: '수정할 모임 정원(1 이상의 정수). 현재 멤버 수 미만으로 낮춰도 소급 퇴장 없음(신규 가입만 차단).',
    example: 20,
    required: false,
  })
  maxMembers?: number;

  // SPEC-MOIM-EXPENSE-001 REQ-EXP-010: 선택적 모임 예산(KRW 정수 ≥0, null=해제). 미전달 시 budget 불변.
  @ApiProperty({
    description: '모임 예산(KRW 정수 ≥0). null 전달 시 예산 해제. 미전달 시 불변.',
    example: 100000,
    nullable: true,
    required: false,
  })
  budget?: number | null;
}
