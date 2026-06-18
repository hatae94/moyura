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
import type { Moim, MoimMember } from '../generated/prisma/client';
import { CreateMoimDto } from './dto/create-moim.dto';
import { MemberResponseDto } from './dto/member-response.dto';
import { MoimResponseDto } from './dto/moim-response.dto';
import { MoimService } from './moim.service';

// @MX:NOTE: [AUTO] 모임 HTTP 표면(REQ-MOIM-001~008). 6개 라우트 모두 per-route @UseGuards(SupabaseAuthGuard)로
// 보호되어 토큰 없는 요청은 401이 된다(REQ-MOIM-001 / AC-3). 인가(403)·존재(404) 판정은 MoimService가 단일
// 출처로 수행한다. 이 프로젝트에는 ValidationPipe가 없으므로(C-1) name/nickname 비어 있음 검사는 여기서
// 명시적으로 BadRequestException(400)을 던진다.
@ApiTags('moims')
@ApiBearerAuth('bearer')
@Controller('moims')
@UseGuards(SupabaseAuthGuard)
export class MoimController {
  constructor(private readonly moimService: MoimService) {}

  // POST /moims — 모임 생성 + 생성자 owner 멤버십(REQ-MOIM-004 / AC-1). 201.
  @Post()
  @ApiCreatedResponse({
    description: '모임 생성 + 생성자 owner 멤버십',
    type: MoimResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async create(
    @CurrentUser() user: VerifiedUser,
    @Body() body: CreateMoimDto,
  ): Promise<MoimResponseDto> {
    // C-1: ValidationPipe 부재 → name/nickname 비어 있음을 명시적으로 검사(400).
    const name = requireNonEmpty(body?.name, 'name');
    const nickname = requireNonEmpty(body?.nickname, 'nickname');
    // SPEC-MOIM-004 REQ-MOIM4-002: optional 일정/장소. startsAt 은 존재 시에만 ISO 유효성 최소 검증(400),
    // 부재/빈 값은 undefined → service 가 null 로 저장한다. location 은 trim 후 빈 값이면 undefined.
    const startsAt = parseOptionalStartsAt(body?.startsAt);
    const location = optionalTrimmed(body?.location);
    const moim = await this.moimService.createMoim(
      user.sub,
      name,
      nickname,
      startsAt,
      location,
    );
    return toMoimDto(moim);
  }

  // GET /moims — 자신이 속한 모임 목록(REQ-MOIM-005 / AC-6).
  @Get()
  @ApiOkResponse({
    description: '자신이 속한 모임 목록',
    type: [MoimResponseDto],
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async list(@CurrentUser() user: VerifiedUser): Promise<MoimResponseDto[]> {
    const moims = await this.moimService.listMyMoims(user.sub);
    return moims.map(toMoimDto);
  }

  // GET /moims/:id — 단건 모임 조회(멤버 한정, REQ-MOIM-005 / AC-6). 비멤버 403, 없는 모임 404.
  @Get(':id')
  @ApiOkResponse({
    description: '단건 모임 정보(멤버 한정)',
    type: MoimResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 멤버가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async getOne(
    @CurrentUser() user: VerifiedUser,
    @Param('id') id: string,
  ): Promise<MoimResponseDto> {
    const moim = await this.moimService.getMoim(user.sub, id);
    return toMoimDto(moim);
  }

  // GET /moims/:id/members — 멤버 목록(nickname 포함, 멤버 한정, REQ-MOIM-006 / AC-5).
  @Get(':id/members')
  @ApiOkResponse({
    description: '멤버 목록(nickname 포함)',
    type: [MemberResponseDto],
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 멤버가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async getMembers(
    @CurrentUser() user: VerifiedUser,
    @Param('id') id: string,
  ): Promise<MemberResponseDto[]> {
    const members = await this.moimService.listMembers(user.sub, id);
    return members.map(toMemberDto);
  }

  // DELETE /moims/:id — 모임 삭제(owner 전용, REQ-MOIM-003 / AC-7). 204. 비-owner 403, 없는 모임 404.
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '모임 삭제(owner 전용, Cascade)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 owner가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async remove(
    @CurrentUser() user: VerifiedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.moimService.deleteMoim(user.sub, id);
  }

  // DELETE /moims/:id/membership — 탈퇴(REQ-MOIM-007/008 / AC-4/AC-8). 204. owner 403, 비멤버 404.
  @Delete(':id/membership')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '멤버 탈퇴(owner 금지)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: 'owner는 탈퇴 불가 — 403' })
  @ApiNotFoundResponse({ description: '멤버십 부재(가입한 적 없음) — 404' })
  async leave(
    @CurrentUser() user: VerifiedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.moimService.leave(user.sub, id);
  }
}

// C-1: 문자열 필드가 trim 후 비어 있으면 400을 던진다(ValidationPipe 부재 보완).
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field}은(는) 비어 있을 수 없습니다`);
  }
  return value.trim();
}

// SPEC-MOIM-004 REQ-MOIM4-002: optional startsAt 을 검증·파싱한다(no-ValidationPipe 보완).
// 부재/빈 문자열 → undefined(null 저장). 존재하면 ISO-8601 로 파싱하고, 무효하면 400(BadRequestException).
function parseOptionalStartsAt(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }
  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('startsAt 은(는) 유효한 ISO-8601 날짜여야 합니다');
  }
  return date;
}

// SPEC-MOIM-004 REQ-MOIM4-002: optional 문자열을 trim 한다. 부재/빈 값 → undefined(null 저장).
function optionalTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

// Moim 엔티티 → 공개 DTO(createdAt/startsAt ISO-8601 직렬화, location null 허용).
function toMoimDto(moim: Moim): MoimResponseDto {
  return {
    id: moim.id,
    name: moim.name,
    // SPEC-MOIM-004 REQ-MOIM4-003: 일정/장소 정직 직렬화(미정이면 null — 허위 값 금지).
    startsAt: moim.startsAt ? moim.startsAt.toISOString() : null,
    location: moim.location ?? null,
    createdBy: moim.createdBy,
    createdAt: moim.createdAt.toISOString(),
  };
}

// MoimMember 엔티티 → 멤버 DTO(nickname 포함, joinedAt ISO-8601 직렬화).
function toMemberDto(member: MoimMember): MemberResponseDto {
  return {
    userId: member.userId,
    nickname: member.nickname,
    role: member.role,
    joinedAt: member.joinedAt.toISOString(),
  };
}
