import {
  BadRequestException,
  Body,
  Controller,
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
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { CreatePollDto } from './dto/create-poll.dto';
import { PollResponseDto } from './dto/poll-response.dto';
import { VoteDto } from './dto/vote.dto';
import type { PollWithOptions, PollWithResults } from './poll.service';
import { PollService } from './poll.service';

// @MX:NOTE: [AUTO] 투표 HTTP 표면(SPEC-MOIM-005 REQ-MOIM5-002/003/004). 세 라우트 모두 per-route
// @UseGuards(SupabaseAuthGuard)로 401을 선처리하고, 멤버십 인가(403)·없는 모임(404)·poll-모임 일관성(404)·
// 잘못된 optionId(400)는 PollService→MoimService.assertMember 단일 출처가 판정한다. ChatController
// (moims/:id/messages) 미러 — moimId 가 항상 path 에 있어 assertMember 직접 호출(poll→moim 역방향 lookup 불필요).
// ValidationPipe 부재(MOIM-001 동일) → question 빈/유효 옵션<2/optionId 빈은 여기서 명시적으로 400을 던진다.
@ApiTags('polls')
@ApiBearerAuth('bearer')
@Controller('moims/:id/polls')
@UseGuards(SupabaseAuthGuard)
export class PollController {
  constructor(private readonly pollService: PollService) {}

  // POST /moims/:id/polls — 투표 생성(멤버 한정, REQ-MOIM5-002 / AC-2). 201.
  @Post()
  @ApiCreatedResponse({
    description: '투표 생성 + 옵션(투표 0 직후 상태)',
    type: PollResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '대상 모임의 멤버가 아님(또는 없는 모임) — 403/404',
  })
  @ApiBadRequestResponse({ description: '빈 question / 유효 옵션 <2 — 400' })
  async create(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: CreatePollDto,
  ): Promise<PollResponseDto> {
    // C-1: ValidationPipe 부재 → question 빈/옵션<2 를 명시적으로 검사(400).
    const question = requireNonEmpty(body?.question, 'question');
    const options = normalizeOptions(body?.options);
    const poll = await this.pollService.createPoll(
      user.sub,
      moimId,
      question,
      options,
    );
    // 갓 생성된 poll 은 투표 0(voteCount:0) + myVote null 로 매핑한다.
    return newPollToDto(poll);
  }

  // GET /moims/:id/polls — 투표 목록 + 결과 집계(멤버 한정, REQ-MOIM5-004 / AC-4). 200.
  @Get()
  @ApiOkResponse({
    description: '모임의 투표 목록(옵션별 voteCount + 호출자 myVote 포함)',
    type: [PollResponseDto],
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '대상 모임의 멤버가 아님(또는 없는 모임) — 403/404',
  })
  async list(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
  ): Promise<PollResponseDto[]> {
    const polls = await this.pollService.listPolls(user.sub, moimId);
    return polls.map(resultToDto);
  }

  // POST /moims/:id/polls/:pollId/vote — 단일 투표 + 재투표 교체(멤버 한정, REQ-MOIM5-003 / AC-3). 200.
  // upsert(생성 아니라 멱등 기록/교체)이므로 201 이 아닌 200 을 명시한다(@Post 기본 201 재정의).
  @Post(':pollId/vote')
  @HttpCode(200)
  @ApiOkResponse({
    description: '투표 기록/교체 + 갱신된 단건 poll 결과',
    type: PollResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 멤버가 아님 — 403' })
  @ApiNotFoundResponse({
    description: '해당 모임에 속하지 않는(또는 없는) pollId — 404',
  })
  @ApiBadRequestResponse({
    description: '빈 optionId / 해당 poll 의 선택지가 아닌 optionId — 400',
  })
  async vote(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Param('pollId') pollId: string,
    @Body() body: VoteDto,
  ): Promise<PollResponseDto> {
    const optionId = requireNonEmpty(body?.optionId, 'optionId');
    const poll = await this.pollService.vote(
      user.sub,
      moimId,
      pollId,
      optionId,
    );
    return resultToDto(poll);
  }
}

// C-1: 문자열 필드가 trim 후 비어 있으면 400(ValidationPipe 부재 보완 — moim/chat 선례).
function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field}은(는) 비어 있을 수 없습니다`);
  }
  return value.trim();
}

// 옵션 배열을 정규화한다: trim 후 비지 않은 항목만 모으고, 2개 미만이면 400(최소 2 선택지 — REQ-MOIM5-002).
function normalizeOptions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException('options 는 배열이어야 합니다');
  }
  const cleaned = value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
  if (cleaned.length < 2) {
    throw new BadRequestException('선택지는 2개 이상이어야 합니다');
  }
  return cleaned;
}

// 갓 생성된 poll(투표 전) → DTO. 모든 옵션 voteCount:0, myVote:null.
function newPollToDto(poll: PollWithOptions): PollResponseDto {
  return {
    id: poll.id,
    question: poll.question,
    createdBy: poll.createdBy,
    createdAt: poll.createdAt.toISOString(),
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: 0,
    })),
    myVote: null,
  };
}

// 집계 결과 poll → DTO(createdAt ISO-8601 직렬화, myVote null 허용).
function resultToDto(poll: PollWithResults): PollResponseDto {
  return {
    id: poll.id,
    question: poll.question,
    createdBy: poll.createdBy,
    createdAt: poll.createdAt.toISOString(),
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: o.voteCount,
    })),
    myVote: poll.myVote,
  };
}
