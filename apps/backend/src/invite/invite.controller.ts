import {
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiGoneResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import type { MoimInvite } from '../generated/prisma/client';
import { AcceptInviteResponseDto } from './dto/accept-response.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { CreateInviteDto } from './dto/create-invite.dto';
import { InviteResponseDto } from './dto/invite-response.dto';
import { InviteService } from './invite.service';

// @MX:NOTE: [AUTO] 초대 관리 HTTP 표면(REQ-INV-001~004). 3개 라우트 모두 per-route @UseGuards(SupabaseAuthGuard)
// 로 401을 선처리하고, owner 인가(403)는 InviteService→MoimService.assertOwner 단일 출처가 판정한다.
// 목록(list)은 live 토큰을 응답에 담으므로 owner 전용이다(REQ-INV-004 — 토큰 유출 채널 차단).
@ApiTags('invites')
@ApiBearerAuth('bearer')
@Controller('moims/:moimId/invites')
@UseGuards(SupabaseAuthGuard)
export class MoimInviteController {
  constructor(private readonly inviteService: InviteService) {}

  // POST /moims/:moimId/invites — 초대 발급(owner 전용, REQ-INV-001 / AC-1). 201.
  @Post()
  @ApiCreatedResponse({
    description: '초대 발급(owner 전용)',
    type: InviteResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 owner가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async create(
    @CurrentUser() user: VerifiedUser,
    @Param('moimId') moimId: string,
    @Body() body: CreateInviteDto,
  ): Promise<InviteResponseDto> {
    // @Body()는 항상 객체를 반환하므로(NestJS) body 자체는 null이 아니다 — 필드만 선택적이다.
    const invite = await this.inviteService.create(user.sub, moimId, {
      expiresAt: body.expiresAt,
      maxUses: body.maxUses,
    });
    return toInviteDto(invite);
  }

  // GET /moims/:moimId/invites — 초대 목록(owner 전용, REQ-INV-002 / AC-6). 200.
  @Get()
  @ApiOkResponse({
    description: '초대 목록(owner 전용, live 토큰 포함)',
    type: [InviteResponseDto],
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 owner가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async list(
    @CurrentUser() user: VerifiedUser,
    @Param('moimId') moimId: string,
  ): Promise<InviteResponseDto[]> {
    const invites = await this.inviteService.list(user.sub, moimId);
    return invites.map(toInviteDto);
  }

  // DELETE /moims/:moimId/invites/:inviteId — 초대 폐기(owner 전용, REQ-INV-003 / AC-4). 200.
  @Delete(':inviteId')
  @ApiOkResponse({
    description: '초대 폐기(owner 전용)',
    type: InviteResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 owner가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임/초대 — 404' })
  async revoke(
    @CurrentUser() user: VerifiedUser,
    @Param('moimId') moimId: string,
    @Param('inviteId') inviteId: string,
  ): Promise<InviteResponseDto> {
    const invite = await this.inviteService.revoke(user.sub, moimId, inviteId);
    return toInviteDto(invite);
  }
}

// @MX:NOTE: [AUTO] 초대 수락 HTTP 표면(REQ-INV-005/006 / AC-2/3/7). @UseGuards로 401 선처리 —
// 익명 로그인 sub도 검증된 JWT라 가드를 동일하게 통과한다(가드/RLS/FK 무수정 — REQ-INV-007 전제).
// 실패 코드는 InviteService가 고정한다: 미지 404 / 만료·폐기 410 / 초과 409 / nickname 빈 400.
@ApiTags('invites')
@ApiBearerAuth('bearer')
@Controller('invites/:token')
@UseGuards(SupabaseAuthGuard)
export class InviteAcceptController {
  constructor(private readonly inviteService: InviteService) {}

  // POST /invites/:token/accept — 초대 수락 + 게스트 가입(REQ-INV-005). 200.
  @Post('accept')
  @HttpCode(200)
  @ApiOkResponse({
    description: '초대 수락 + 멤버십 생성(멱등)',
    type: AcceptInviteResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiNotFoundResponse({ description: '미지 토큰 — 404' })
  @ApiGoneResponse({ description: '만료·폐기 토큰 — 410' })
  @ApiConflictResponse({ description: '사용 횟수 초과 — 409' })
  async accept(
    @CurrentUser() user: VerifiedUser,
    @Param('token') token: string,
    @Body() body: AcceptInviteDto,
  ): Promise<AcceptInviteResponseDto> {
    // @Body()는 항상 객체를 반환한다 — nickname 빈/누락 검사는 InviteService.accept가 수행(400).
    const invite = await this.inviteService.accept(
      user.sub,
      token,
      body.nickname,
    );
    return { moimId: invite.moimId };
  }
}

// MoimInvite 엔티티 → 공개 DTO(시각 ISO-8601 직렬화, null 보존).
function toInviteDto(invite: MoimInvite): InviteResponseDto {
  return {
    id: invite.id,
    moimId: invite.moimId,
    token: invite.token,
    expiresAt: invite.expiresAt.toISOString(),
    maxUses: invite.maxUses,
    usedCount: invite.usedCount,
    revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
    createdAt: invite.createdAt.toISOString(),
  };
}
