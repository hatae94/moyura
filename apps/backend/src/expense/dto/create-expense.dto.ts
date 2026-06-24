import { ApiProperty } from '@nestjs/swagger';

// SPEC-MOIM-EXPENSE-001 REQ-EXP-002/003/004: 경비 기록 요청 바디.
// splitMethod 기본='equal'. participantUserIds 생략 시 컨트롤러가 전 멤버로 채운다.
export class CreateExpenseDto {
  @ApiProperty({ description: '지출 금액(KRW 정수, ≥1)', example: 30000 })
  amount!: number;

  @ApiProperty({
    description: '카테고리 프리셋(식비/교통/숙박/입장/준비물/기타)',
    example: '식비',
  })
  category!: string;

  @ApiProperty({
    description: '결제자 sub(그 모임의 멤버 sub)',
    example: '00000000-0000-4000-8000-000000000001',
  })
  payerUserId!: string;

  @ApiProperty({
    description: '메모(선택)',
    example: '점심 식사',
    required: false,
  })
  memo?: string;

  @ApiProperty({
    description:
      '분배 방식: equal(N빵 기본) / custom(멤버별 금액) / ratio(멤버별 비율)',
    example: 'equal',
    required: false,
  })
  splitMethod?: string;

  @ApiProperty({
    description: '참가자 sub 배열(equal 시 — 생략하면 전 멤버)',
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
