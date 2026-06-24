import { ApiProperty } from '@nestjs/swagger';

// SPEC-MOIM-EXPENSE-001 REQ-EXP-007: 경비 수정 요청 바디.
// 검증 규칙은 CreateExpenseDto 와 동일(REQ-EXP-002/004).
export class UpdateExpenseDto {
  @ApiProperty({
    description: '지출 금액(KRW 정수, ≥1)',
    example: 30000,
    required: false,
  })
  amount?: number;

  @ApiProperty({
    description: '카테고리 프리셋(식비/교통/숙박/입장/준비물/기타)',
    example: '식비',
    required: false,
  })
  category?: string;

  @ApiProperty({
    description: '결제자 sub(그 모임의 멤버 sub)',
    required: false,
  })
  payerUserId?: string;

  @ApiProperty({ description: '메모(선택)', required: false })
  memo?: string | null;

  @ApiProperty({
    description: '분배 방식: equal / custom / ratio',
    required: false,
  })
  splitMethod?: string;

  @ApiProperty({
    description: '참가자 sub 배열(equal 시)',
    type: [String],
    required: false,
  })
  participantUserIds?: string[];

  @ApiProperty({
    description: 'custom: [{userId, amount}] / ratio: [{userId, ratio}]',
    required: false,
  })
  shares?: { userId: string; amount?: number; ratio?: number }[];
}
