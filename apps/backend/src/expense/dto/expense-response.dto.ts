import { ApiProperty } from '@nestjs/swagger';

// 개별 분담 행 DTO.
export class ExpenseShareDto {
  @ApiProperty({ description: '분담 멤버 sub', example: 'user-sub-1' })
  userId!: string;

  @ApiProperty({ description: '분담 금액(KRW 정수)', example: 10000 })
  shareAmount!: number;
}

// 경비 단건 DTO(shares 포함).
export class ExpenseDto {
  @ApiProperty({ description: '경비 id(uuid)' })
  id!: string;

  @ApiProperty({ description: '모임 id' })
  moimId!: string;

  @ApiProperty({ description: '금액(KRW 정수)', example: 30000 })
  amount!: number;

  @ApiProperty({ description: '카테고리 프리셋', example: '식비' })
  category!: string;

  @ApiProperty({ description: '결제자 sub' })
  payerUserId!: string;

  @ApiProperty({ description: '메모', nullable: true, type: String })
  memo!: string | null;

  @ApiProperty({ description: '기록자 sub' })
  createdBy!: string;

  @ApiProperty({ description: '생성 시각(ISO-8601)' })
  createdAt!: string;

  @ApiProperty({ description: '수정 시각(ISO-8601)' })
  updatedAt!: string;

  @ApiProperty({ description: '분담 행 목록', type: [ExpenseShareDto] })
  shares!: ExpenseShareDto[];
}

// 요약 DTO.
export class ExpenseSummaryDto {
  @ApiProperty({ description: '총 지출(KRW 정수)', example: 39000 })
  total!: number;

  @ApiProperty({
    description: '1인당(총지출÷멤버수, KRW 정수)',
    example: 13000,
  })
  perPerson!: number;

  @ApiProperty({
    description: '예산(KRW 정수 또는 null)',
    nullable: true,
    type: Number,
  })
  budget!: number | null;

  @ApiProperty({
    description: '남은 예산(budget-total 또는 null)',
    nullable: true,
    type: Number,
  })
  remaining!: number | null;
}

// 정산 거래 DTO(settled 플래그 포함).
export class SettlementTransactionDto {
  @ApiProperty({ description: '보내는 멤버 sub' })
  from!: string;

  @ApiProperty({ description: '받는 멤버 sub' })
  to!: string;

  @ApiProperty({ description: '정산 금액(KRW 정수)', example: 4000 })
  amount!: number;

  @ApiProperty({
    description: '정산 완료 여부(마커 존재하면 true)',
    example: false,
  })
  settled!: boolean;
}

// 정산 결과 DTO.
export class ExpenseSettlementDto {
  @ApiProperty({ description: '멤버별 balance(양수=받을 돈, 음수=낼 돈)' })
  balances!: { userId: string; balance: number }[];

  @ApiProperty({
    description: '최소 거래 목록',
    type: [SettlementTransactionDto],
  })
  transactions!: SettlementTransactionDto[];
}

// GET /moims/:id/expenses 응답 DTO.
export class ExpenseListResponseDto {
  @ApiProperty({ description: '경비 목록', type: [ExpenseDto] })
  expenses!: ExpenseDto[];

  @ApiProperty({
    description: '요약(총지출/1인당/예산/남은예산)',
    type: ExpenseSummaryDto,
  })
  summary!: ExpenseSummaryDto;

  @ApiProperty({
    description: '정산(balances + 최소 거래 목록)',
    type: ExpenseSettlementDto,
  })
  settlement!: ExpenseSettlementDto;
}

// Settlement 마커 생성 요청 바디 DTO.
export class CreateSettlementDto {
  @ApiProperty({ description: '보내는 멤버 sub' })
  fromUserId!: string;

  @ApiProperty({ description: '받는 멤버 sub' })
  toUserId!: string;

  @ApiProperty({ description: '정산 금액(KRW 정수)', example: 4000 })
  amount!: number;
}

// Settlement 마커 응답 DTO.
export class SettlementResponseDto {
  @ApiProperty({ description: 'Settlement 마커 id' })
  id!: string;

  @ApiProperty({ description: '모임 id' })
  moimId!: string;

  @ApiProperty({ description: '보내는 멤버 sub' })
  fromUserId!: string;

  @ApiProperty({ description: '받는 멤버 sub' })
  toUserId!: string;

  @ApiProperty({ description: '정산 금액' })
  amount!: number;

  @ApiProperty({ description: '토글한 owner sub' })
  settledBy!: string;

  @ApiProperty({ description: '정산 완료 시각(ISO-8601)' })
  settledAt!: string;
}
