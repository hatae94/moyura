import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import {
  CreateSettlementDto,
  ExpenseDto,
  ExpenseListResponseDto,
  ExpenseShareDto,
  ExpenseSettlementDto,
  ExpenseSummaryDto,
  RequestSettlementDto,
  SettlementRequestResponseDto,
  SettlementResponseDto,
  SettlementTransactionDto,
} from './dto/expense-response.dto';
import type { ExpenseWithShares } from './expense.service';
import { EXPENSE_CATEGORIES, ExpenseService } from './expense.service';
import type { Settlement, SettlementRequest } from '../generated/prisma/client';

// @MX:NOTE: [AUTO] 경비 HTTP 표면(SPEC-MOIM-EXPENSE-001 REQ-EXP-002~010). 모든 라우트는 per-route
// @UseGuards(SupabaseAuthGuard)로 401 선처리. 인가(403)/존재(404)/검증(400)은 ExpenseService 가 단일 판정.
// PollController 미러 — moimId 가 항상 path 에 있어 assertOwner/assertMember 직접 호출.
// ValidationPipe 부재(MOIM-001 동일) → 명시적 검증 함수로 400 을 던진다.
@ApiTags('expenses')
@ApiBearerAuth('bearer')
@Controller('moims/:id/expenses')
@UseGuards(SupabaseAuthGuard)
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  // POST /moims/:id/expenses — 경비 기록(owner 전용, REQ-EXP-002/004 / AC-1/2/2b). 201.
  @Post()
  @ApiCreatedResponse({
    description: '경비 생성(Expense+ExpenseShare)',
    type: ExpenseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({
    description: '금액/카테고리/결제자/분배 검증 실패 — 400',
  })
  async create(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: CreateExpenseDto,
  ): Promise<ExpenseDto> {
    const amount = requirePositiveInt(body?.amount, 'amount');
    const category = requireCategory(body?.category);
    const payerUserId = requireNonEmpty(body?.payerUserId, 'payerUserId');
    const splitMethod = parseSplitMethod(body?.splitMethod);

    const expense = await this.expenseService.createExpense(
      user.sub,
      moimId,
      amount,
      category,
      payerUserId,
      body?.memo,
      splitMethod,
      body?.participantUserIds,
      body?.shares,
    );
    return toExpenseDto(expense);
  }

  // GET /moims/:id/expenses — 경비 목록 + 요약 + 정산(멤버 한정, REQ-EXP-005 / AC-5). 200.
  @Get()
  @ApiOkResponse({
    description: '경비 목록 + 요약 + 정산(settled 포함)',
    type: ExpenseListResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '멤버 아님(또는 모임 미존재) — 403' })
  async list(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
  ): Promise<ExpenseListResponseDto> {
    const result = await this.expenseService.listExpenses(user.sub, moimId);
    return {
      expenses: result.expenses.map(toExpenseDto),
      summary: toSummaryDto(result.summary),
      settlement: toSettlementDto(result.settlement),
    };
  }

  // PATCH /moims/:id/expenses/:expenseId — 경비 수정(owner 전용, REQ-EXP-007 / AC-11). 200.
  @Patch(':expenseId')
  @ApiOkResponse({
    description: '경비 수정(ExpenseShare 재 materialize)',
    type: ExpenseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiNotFoundResponse({ description: '타-모임 또는 미존재 expenseId — 404' })
  @ApiBadRequestResponse({ description: '검증 실패 — 400' })
  async update(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Param('expenseId') expenseId: string,
    @Body() body: UpdateExpenseDto,
  ): Promise<ExpenseDto> {
    // 전달된 필드만 검증(미전달 undefined 허용).
    const amount =
      body?.amount !== undefined
        ? requirePositiveInt(body.amount, 'amount')
        : undefined;
    const category =
      body?.category !== undefined ? requireCategory(body.category) : undefined;
    const payerUserId =
      body?.payerUserId !== undefined
        ? requireNonEmpty(body.payerUserId, 'payerUserId')
        : undefined;
    const splitMethod =
      body?.splitMethod !== undefined
        ? parseSplitMethod(body.splitMethod)
        : undefined;

    const expense = await this.expenseService.updateExpense(
      user.sub,
      moimId,
      expenseId,
      amount,
      category,
      payerUserId,
      body?.memo,
      splitMethod,
      body?.participantUserIds,
      body?.shares,
    );
    return toExpenseDto(expense);
  }

  // DELETE /moims/:id/expenses/:expenseId — 경비 삭제(owner 전용, REQ-EXP-006 / AC-7). 204.
  @Delete(':expenseId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '경비 삭제(ExpenseShare cascade)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiNotFoundResponse({ description: '타-모임 또는 미존재 expenseId — 404' })
  async remove(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Param('expenseId') expenseId: string,
  ): Promise<void> {
    await this.expenseService.deleteExpense(user.sub, moimId, expenseId);
  }
}

// @MX:NOTE: [AUTO] 정산 완료 마커 라우트(REQ-EXP-009 / AC-12). 별도 컨트롤러 클래스로 분리해
// /moims/:id/settlements 경로를 담당한다. ExpenseController 와 같은 모듈/서비스를 공유한다.
@ApiTags('settlements')
@ApiBearerAuth('bearer')
@Controller('moims/:id/settlements')
@UseGuards(SupabaseAuthGuard)
export class SettlementController {
  constructor(private readonly expenseService: ExpenseService) {}

  // POST /moims/:id/settlements — 정산 완료 마커 생성(owner 전용, REQ-EXP-009 / AC-12). 201. 멱등.
  @Post()
  @ApiCreatedResponse({
    description: '정산 완료 마커 생성(멱등)',
    type: SettlementResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({
    description: '현재 거래 집합에 존재하지 않는 거래 — 400',
  })
  async create(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: CreateSettlementDto,
  ): Promise<SettlementResponseDto> {
    const fromUserId = requireNonEmpty(body?.fromUserId, 'fromUserId');
    const toUserId = requireNonEmpty(body?.toUserId, 'toUserId');
    const amount = requirePositiveInt(body?.amount, 'amount');

    const settlement = await this.expenseService.createSettlement(
      user.sub,
      moimId,
      fromUserId,
      toUserId,
      amount,
    );
    return toSettlementResponseDto(settlement);
  }

  // POST /moims/:id/settlements/request — 정산 요청 생성(멤버 누구나 — 채권자가 스스로 요청, SPEC-NOTIFICATIONS-001 M2). 201.
  // 완료 마커(POST /settlements)와 별 경로·별 테이블. moim.settlement.requested 를 채무자 수신 대상으로 발행한다.
  @Post('request')
  @ApiCreatedResponse({
    description: '정산 요청 생성(채권자 → 채무자)',
    type: SettlementRequestResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '멤버 아님(또는 모임 미존재) — 403' })
  @ApiBadRequestResponse({
    description:
      '금액/채무자 검증 실패(비멤버 채무자·자기 요청·비정수 금액) — 400',
  })
  async request(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: RequestSettlementDto,
  ): Promise<SettlementRequestResponseDto> {
    const debtorId = requireNonEmpty(body?.debtorId, 'debtorId');
    const amount = requirePositiveInt(body?.amount, 'amount');

    const created = await this.expenseService.requestSettlement(
      user.sub,
      moimId,
      debtorId,
      amount,
    );
    return toSettlementRequestResponseDto(created);
  }

  // DELETE /moims/:id/settlements — (from,to,amount) 로 마커 삭제(owner 전용, REQ-EXP-009). 204.
  @Delete()
  @HttpCode(204)
  @ApiNoContentResponse({ description: '정산 완료 마커 삭제(완료 해제)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  async removeByFields(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: CreateSettlementDto,
    @Query('fromUserId') qFrom?: string,
    @Query('toUserId') qTo?: string,
    @Query('amount') qAmount?: string,
  ): Promise<void> {
    // body 우선, 없으면 query params.
    const fromUserId = requireNonEmpty(body?.fromUserId ?? qFrom, 'fromUserId');
    const toUserId = requireNonEmpty(body?.toUserId ?? qTo, 'toUserId');
    const rawAmount =
      body?.amount ?? (qAmount !== undefined ? Number(qAmount) : undefined);
    const amount = requirePositiveInt(rawAmount, 'amount');
    await this.expenseService.deleteSettlement(
      user.sub,
      moimId,
      fromUserId,
      toUserId,
      amount,
    );
  }

  // DELETE /moims/:id/settlements/:settlementId — settlementId 로 마커 삭제. 204.
  @Delete(':settlementId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '정산 완료 마커 삭제(id 기준)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner 아님(또는 모임 미존재) — 403' })
  @ApiNotFoundResponse({
    description: '타-모임 또는 미존재 settlementId — 404',
  })
  async removeById(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Param('settlementId') settlementId: string,
  ): Promise<void> {
    await this.expenseService.deleteSettlementById(
      user.sub,
      moimId,
      settlementId,
    );
  }
}

// ── 검증 헬퍼(ValidationPipe 부재 보완, poll.controller.ts 선례) ──────────────

// 문자열 필드 비어 있음 검사(400).
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field}은(는) 비어 있을 수 없습니다`);
  }
  return value.trim();
}

// 1 이상의 정수 검증(400). KRW 정수 정책(REQ-EXP-002).
function requirePositiveInt(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException(
      `${field}은(는) 1 이상의 정수여야 합니다(KRW 정수)`,
    );
  }
  return value as number;
}

// 카테고리 프리셋 검증(400, REQ-EXP-003).
function requireCategory(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !EXPENSE_CATEGORIES.includes(value as never)
  ) {
    throw new BadRequestException(
      `category 는 ${EXPENSE_CATEGORIES.join('/')} 중 하나여야 합니다`,
    );
  }
  return value;
}

// splitMethod 파싱(생략='equal', REQ-EXP-004).
function parseSplitMethod(value: unknown): 'equal' | 'custom' | 'ratio' {
  if (value === undefined || value === null || value === '') {
    return 'equal';
  }
  if (value === 'equal' || value === 'custom' || value === 'ratio') {
    return value;
  }
  throw new BadRequestException(
    'splitMethod 는 equal/custom/ratio 중 하나여야 합니다',
  );
}

// ── DTO 변환 함수 ─────────────────────────────────────────────────────────────

function toExpenseDto(expense: ExpenseWithShares): ExpenseDto {
  return {
    id: expense.id,
    moimId: expense.moimId,
    amount: expense.amount,
    category: expense.category,
    payerUserId: expense.payerUserId,
    memo: expense.memo,
    createdBy: expense.createdBy,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
    shares: expense.shares.map(
      (s): ExpenseShareDto => ({
        userId: s.userId,
        shareAmount: s.shareAmount,
      }),
    ),
  };
}

function toSummaryDto(
  summary: ExpenseListResult['summary'],
): ExpenseSummaryDto {
  return {
    total: summary.total,
    perPerson: summary.perPerson,
    budget: summary.budget,
    remaining: summary.remaining,
  };
}

function toSettlementDto(
  settlement: ExpenseListResult['settlement'],
): ExpenseSettlementDto {
  return {
    balances: settlement.balances,
    transactions: settlement.transactions.map(
      (t): SettlementTransactionDto => ({
        from: t.from,
        to: t.to,
        amount: t.amount,
        settled: t.settled,
      }),
    ),
  };
}

function toSettlementResponseDto(s: Settlement): SettlementResponseDto {
  return {
    id: s.id,
    moimId: s.moimId,
    fromUserId: s.fromUserId,
    toUserId: s.toUserId,
    amount: s.amount,
    settledBy: s.settledBy,
    settledAt: s.settledAt.toISOString(),
  };
}

// SPEC-NOTIFICATIONS-001 M2: 정산 요청 → 응답 DTO 매핑(createdAt ISO 직렬화).
function toSettlementRequestResponseDto(
  r: SettlementRequest,
): SettlementRequestResponseDto {
  return {
    id: r.id,
    moimId: r.moimId,
    requesterId: r.requesterId,
    debtorId: r.debtorId,
    amount: r.amount,
    createdAt: r.createdAt.toISOString(),
  };
}

// 로컬 타입 참조(컨트롤러 내부용).
type ExpenseListResult = Awaited<ReturnType<ExpenseService['listExpenses']>>;
