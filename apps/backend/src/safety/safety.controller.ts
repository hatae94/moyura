import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import type { Block, Report } from '../generated/prisma/client';
import { CreateBlockDto } from './dto/create-block.dto';
import { CreateReportDto } from './dto/create-report.dto';
import {
  BlockListResponseDto,
  BlockResponseDto,
  ReportResponseDto,
} from './dto/safety-response.dto';
import { SafetyService } from './safety.service';

// @MX:NOTE: [AUTO] 신고·차단 HTTP 표면(SPEC-SAFETY-001 M2 / T-004). 네 라우트 모두 per-route
// @UseGuards(SupabaseAuthGuard)로 401 을 선처리하고(global APP_GUARD 미사용 — public 누수 회피), 인가는
// notification.controller 처럼 컨트롤러가 아니라 SafetyService 의 where 절에서 판정된다(reporterId==sub /
// blockerId==sub). body/param 의 어떤 userId 필드도 신고자·차단자 결정에 쓰지 않는다(mass-assignment 차단,
// REQ-CPL-003). ValidationPipe 부재(코드베이스 컨벤션) → 바디 타입 검증은 여기(또는 서비스 화이트리스트)에서
// 명시적으로 400 을 던진다. Block/Report 의 createdAt(Date)은 DTO 매핑 시 ISO-8601 문자열로 직렬화한다.
@ApiTags('safety')
@ApiBearerAuth()
@Controller()
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  // POST /reports — UGC 신고 저장(REQ-RPT-001). report 만 생성하며 block 은 만들지 않는다(신고 ≠ 차단).
  // content_type 화이트리스트 위반·빈 reason 은 서비스가 400 으로 거른다. 201 Created.
  @Post('reports')
  @UseGuards(SupabaseAuthGuard)
  @ApiCreatedResponse({
    description: '신고 저장 결과',
    type: ReportResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiBadRequestResponse({
    description: 'content_type 화이트리스트 외 또는 빈 reason — 400',
  })
  async createReport(
    @CurrentUser() user: VerifiedUser,
    @Body() body: CreateReportDto,
  ): Promise<ReportResponseDto> {
    // ValidationPipe 부재 → 바디 필수 필드를 명시적으로 검증한다(빈 값 = 400). 신고자는 가드-검증 sub 만 사용한다.
    const dto = parseCreateReportBody(body);
    const report = await this.safety.createReport(user.sub, dto);
    return toReportDto(report);
  }

  // POST /blocks — 차단 생성(REQ-BLK-001, 멱등). 자기 차단은 400, 이미 차단됐으면 멱등 성공(201). blockerId=검증 sub.
  @Post('blocks')
  @UseGuards(SupabaseAuthGuard)
  @ApiCreatedResponse({
    description: '차단 생성 결과(멱등 — 이미 존재해도 201)',
    type: BlockResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiBadRequestResponse({
    description: '자기 차단 또는 blockedUserId 누락 — 400',
  })
  async createBlock(
    @CurrentUser() user: VerifiedUser,
    @Body() body: CreateBlockDto,
  ): Promise<BlockResponseDto> {
    // 차단 대상 sub 만 바디에서 받는다(차단자는 검증 sub 강제). 빈 값은 400.
    const blockedUserId = parseBlockedUserId(body);
    const block = await this.safety.createBlock(user.sub, blockedUserId);
    return toBlockDto(block);
  }

  // DELETE /blocks/:blockedUserId — 차단 해제(REQ-BLK-002, 멱등). block 행만 삭제하며 report 숨김은 불변.
  // blockerId=검증 sub 로 남의 차단은 구조적으로 지울 수 없다. 204 No Content.
  @Delete('blocks/:blockedUserId')
  @HttpCode(204)
  @UseGuards(SupabaseAuthGuard)
  @ApiNoContentResponse({ description: '차단 해제 완료(없는 행도 멱등 204)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async unblock(
    @CurrentUser() user: VerifiedUser,
    @Param('blockedUserId') blockedUserId: string,
  ): Promise<void> {
    await this.safety.unblock(user.sub, blockedUserId);
  }

  // GET /blocks — 내(sub)가 차단한 목록(REQ-BLK-004). block 행만 반환(신고 기반 숨김 미포함). 200.
  @Get('blocks')
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({
    description: '내가 차단한 목록(block 행만)',
    type: BlockListResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async listBlocks(
    @CurrentUser() user: VerifiedUser,
  ): Promise<BlockListResponseDto> {
    const blocks = await this.safety.listBlocks(user.sub);
    return { items: blocks.map(toBlockDto) };
  }
}

// ── 검증 헬퍼(ValidationPipe 부재 보완, notification.controller 선례) ─────────────

// POST /reports 바디 검증: 문자열 필수 필드가 모두 채워졌는지 확인한다(contentType 화이트리스트/빈 reason 은
// 서비스가 판정). 런타임 입력은 신뢰할 수 없으므로 unknown 으로 재캐스팅해 각 필드를 명시 검증한다.
// **reporterId 등 신고자 필드는 여기서 읽지 않는다** — 신고자는 오직 가드-검증 sub 로 결정된다(WHERE 내장 인가).
function parseCreateReportBody(
  body: CreateReportDto | undefined,
): CreateReportDto {
  const raw = (body ?? {}) as {
    targetUserId?: unknown;
    moimId?: unknown;
    reason?: unknown;
    contentType?: unknown;
    contentId?: unknown;
  };
  if (
    !isNonEmptyString(raw.targetUserId) ||
    !isNonEmptyString(raw.moimId) ||
    typeof raw.reason !== 'string' ||
    !isNonEmptyString(raw.contentType) ||
    !isNonEmptyString(raw.contentId)
  ) {
    throw new BadRequestException(
      'targetUserId·moimId·reason·contentType·contentId 는 문자열 필수입니다',
    );
  }
  return {
    targetUserId: raw.targetUserId,
    moimId: raw.moimId,
    reason: raw.reason,
    contentType: raw.contentType,
    contentId: raw.contentId,
  };
}

// POST /blocks 바디에서 차단 대상 sub 만 추출한다(비어 있으면 400). 차단자 필드(blockerId)는 신뢰하지 않는다.
function parseBlockedUserId(body: CreateBlockDto | undefined): string {
  const raw = (body ?? {}) as { blockedUserId?: unknown };
  if (!isNonEmptyString(raw.blockedUserId)) {
    throw new BadRequestException(
      'blockedUserId 는 비어 있지 않은 문자열이어야 합니다',
    );
  }
  return raw.blockedUserId;
}

// 값이 trim 후 비어있지 않은 문자열인지 검사한다(비문자열/빈 문자열/공백은 false).
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ── DTO 변환 ──────────────────────────────────────────────────────────────────

// Report 엔티티 → 공개 DTO. createdAt(Date)을 ISO-8601 문자열로 직렬화한다.
function toReportDto(report: Report): ReportResponseDto {
  return {
    id: report.id,
    reporterId: report.reporterId,
    targetUserId: report.targetUserId,
    moimId: report.moimId,
    reason: report.reason,
    contentType: report.contentType,
    contentId: report.contentId,
    createdAt: report.createdAt.toISOString(),
  };
}

// Block 엔티티 → 공개 DTO. createdAt(Date)을 ISO-8601 문자열로 직렬화한다.
function toBlockDto(block: Block): BlockResponseDto {
  return {
    blockerId: block.blockerId,
    blockedUserId: block.blockedUserId,
    createdAt: block.createdAt.toISOString(),
  };
}
