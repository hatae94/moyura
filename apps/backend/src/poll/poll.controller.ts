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
  ApiConflictResponse,
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

  // POST /moims/:id/polls — 투표 생성(멤버 한정, REQ-MOIM7-002 / AC-2). 201.
  @Post()
  @ApiCreatedResponse({
    description: '투표 생성 + 옵션(투표 0 직후 상태)',
    type: PollResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '대상 모임의 멤버가 아님(또는 없는 모임) — 403/404',
  })
  @ApiBadRequestResponse({
    description: '빈 question / 유효 옵션 <2 / 무효 closesAt ISO — 400',
  })
  async create(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: CreatePollDto,
  ): Promise<PollResponseDto> {
    // C-1: ValidationPipe 부재 → question 빈/옵션<2 를 명시적으로 검사(400).
    const question = requireNonEmpty(body?.question, 'question');
    const options = normalizeOptions(body?.options);
    // multiSelect 옵트인 — 명시적으로 true 일 때만 다중 선택(생략/falsy → false 단일 선택).
    const multiSelect = body?.multiSelect === true;
    // SPEC-MOIM-007: closesAt optional — 있으면 파싱(무효 ISO → 400), 없으면 null(마감 없음).
    const closesAt = parseClosesAt(body?.closesAt);
    const poll = await this.pollService.createPoll(
      user.sub,
      moimId,
      question,
      options,
      multiSelect,
      closesAt,
    );
    // 갓 생성된 poll 은 투표 0(voteCount:0) + myVotes 빈 배열로 매핑한다.
    return newPollToDto(poll);
  }

  // GET /moims/:id/polls — 투표 목록 + 결과 집계(멤버 한정, REQ-MOIM5-004 / AC-4). 200.
  @Get()
  @ApiOkResponse({
    description: '모임의 투표 목록(옵션별 voteCount + multiSelect + 호출자 myVotes 포함)',
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

  // POST /moims/:id/polls/:pollId/vote — 단일 투표 + 재투표 교체(멤버 한정, REQ-MOIM7-004 / AC-4). 200.
  // upsert(생성 아니라 멱등 기록/교체)이므로 201 이 아닌 200 을 명시한다(@Post 기본 201 재정의).
  // SPEC-MOIM-007: 마감된 poll 에 투표하면 409 Conflict("마감된 투표입니다") — service 가 처리.
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
  @ApiConflictResponse({ description: '마감된 투표에 투표 시도 — 409' })
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

  // POST /moims/:id/polls/:pollId/close — 수동 마감(생성자 전용, REQ-MOIM7-003 / AC-3). 200.
  // closesAt = now 로 설정해 즉시 마감. 이미 마감된 poll 에 다시 호출해도 200(멱등).
  @Post(':pollId/close')
  @HttpCode(200)
  @ApiOkResponse({
    description: '마감된 poll 결과(closesAt=now, isClosed:true)',
    type: PollResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '비멤버 또는 생성자가 아닌 멤버 — 403',
  })
  @ApiNotFoundResponse({
    description: '해당 모임에 속하지 않는(또는 없는) pollId — 404',
  })
  async close(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Param('pollId') pollId: string,
  ): Promise<PollResponseDto> {
    const poll = await this.pollService.closePoll(user.sub, moimId, pollId);
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

// SPEC-MOIM-007: closesAt optional ISO-8601 파싱 헬퍼. 생략/빈 값 → null(마감 없음). 무효 ISO → 400.
// moims/new/actions.ts 의 toIsoOrUndefined 와 달리 무효 입력을 undefined 로 떨어뜨리지 않고 명시 400 으로 차단한다
// (API 직접 호출 시 무효 closesAt 도 거른다 — REQ-MOIM7-002 Unwanted behavior).
function parseClosesAt(value: unknown): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException('closesAt 은 ISO-8601 문자열이어야 합니다');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException('closesAt 은 유효한 날짜/시각이어야 합니다');
  }
  return date;
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

// 갓 생성된 poll(투표 전) → DTO. 모든 옵션 voteCount:0, myVotes 빈 배열, multiSelect 는 생성값 반영.
// SPEC-MOIM-007: closesAt(ISO|null) + isClosed(서버 계산 — 생성 직후 미래 시각이면 false) 추가.
function newPollToDto(poll: PollWithOptions): PollResponseDto {
  const closesAt = poll.closesAt ?? null;
  return {
    id: poll.id,
    question: poll.question,
    createdBy: poll.createdBy,
    createdAt: poll.createdAt.toISOString(),
    multiSelect: poll.multiSelect,
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: 0,
    })),
    myVotes: [],
    closesAt: closesAt ? closesAt.toISOString() : null,
    isClosed: closesAt != null && closesAt <= new Date(),
  };
}

// 집계 결과 poll → DTO(createdAt ISO-8601 직렬화, multiSelect + myVotes 목록).
// SPEC-MOIM-007: closesAt(ISO|null) + isClosed(서버 계산, aggregatePolls 가 이미 계산) 추가.
function resultToDto(poll: PollWithResults): PollResponseDto {
  return {
    id: poll.id,
    question: poll.question,
    createdBy: poll.createdBy,
    createdAt: poll.createdAt.toISOString(),
    multiSelect: poll.multiSelect,
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      voteCount: o.voteCount,
    })),
    myVotes: poll.myVotes,
    closesAt: poll.closesAt ? poll.closesAt.toISOString() : null,
    isClosed: poll.isClosed,
  };
}
