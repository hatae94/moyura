import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
  forwardRef,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
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
import { resultToDto } from '../poll/poll.controller';
import { PollService } from '../poll/poll.service';
import { toScheduleDto } from '../schedule/schedule.controller';
import { ScheduleService } from '../schedule/schedule.service';
import { CreateMoimDto } from './dto/create-moim.dto';
import { MemberResponseDto } from './dto/member-response.dto';
import { MoimDetailResponseDto } from './dto/moim-detail-response.dto';
import { MoimResponseDto } from './dto/moim-response.dto';
import { TransferOwnerDto } from './dto/transfer-owner.dto';
import { UpdateMaxMembersDto } from './dto/update-max-members.dto';
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
  constructor(
    private readonly moimService: MoimService,
    // SPEC-MOIM-DETAIL-001: 상세 집계(GET /moims/:id/detail)가 개별 poll/schedule 엔드포인트와 동일한
    // 서비스 메서드를 재사용한다(listPolls/getSchedule). Moim↔Poll/Schedule 모듈 순환 때문에 두 서비스는
    // forwardRef 로 해석된 모듈에서 온다 — @Inject(forwardRef(...))로 명시해 순환 해석을 안전하게 처리한다.
    @Inject(forwardRef(() => PollService))
    private readonly pollService: PollService,
    @Inject(forwardRef(() => ScheduleService))
    private readonly scheduleService: ScheduleService,
  ) {}

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
    // SPEC-MOIM-012 REQ-MOIM12-001: optional 정원. 전달 시 1 이상의 정수만 허용(미달 시 400).
    const maxMembers = parseOptionalMaxMembers(body?.maxMembers);
    const moim = await this.moimService.createMoim(
      user.sub,
      name,
      nickname,
      startsAt,
      location,
      maxMembers,
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

  // @MX:NOTE: [AUTO] SPEC-MOIM-DETAIL-001: GET /moims/:id/detail — 모임+멤버+투표+일정을 1회로 합친 상세 집계.
  // 웹 SSR이 4개 병렬 백엔드 호출을 1개로 대체할 수 있게 한다. 인가 게이트는 개별 엔드포인트와 동일하다:
  // 401(가드가 JWT 부재 선처리) · 403(비멤버) · 404(없는 모임). getMoim(user.sub, id)을 먼저 호출해 게이트를
  // 통과시킨다(assertMember 단일 출처 재사용 — 여기서 재구현 금지). 통과하면 호출자는 확정 멤버이므로 이후
  // members/polls/schedule 은 인가된 상태다.
  // @MX:NOTE: [AUTO] 성능 최적화: 게이트는 상단 getMoim 1회로만 통과시키고, 이후 세 조회는 assertMember 를 다시
  // 수행하지 않는 unchecked 변형(listMembersUnchecked / listPollsUnchecked / getScheduleUnchecked)을 쓴다.
  // 예전엔 각 후속 조회가 assertMember(requireMoim + findMembership = 2 DB 쿼리)를 반복해 멤버십을 4회 판정했다
  // (~8 중복 cross-region 쿼리). Supabase DB 가 Railway 백엔드와 다른 리전이라 쿼리당 ~0.3s 라 이 중복이 비쌌다.
  // 이제 assertMember 는 1회뿐이다(인가 약화 없음 — 게이트 통과 후에만 unchecked 호출). 개별 엔드포인트
  // (GET /moims/:id/polls, /members, /schedule)는 각자 게이트를 유지한다. 세 조회는 독립적이라 Promise.all 로
  // 동시 실행한다. polls/schedule 은 graceful data([]/null 유효 — "투표 없음"/"일정 없음"에 500 금지). 각 필드
  // 형태는 개별 엔드포인트 매퍼(toMoimDto/toMemberDto/resultToDto/toScheduleDto)를 재사용해 byte-identical 하다.
  @Get(':id/detail')
  @ApiOkResponse({
    description: '모임 상세 집계(모임+멤버+투표+일정) — 웹 SSR 1회 호출용',
    type: MoimDetailResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 멤버가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async getDetail(
    @CurrentUser() user: VerifiedUser,
    @Param('id') id: string,
  ): Promise<MoimDetailResponseDto> {
    // 1) 인가 게이트(비멤버 403 / 없는 모임 404를 throw). 통과하면 호출자는 확정 멤버.
    //    getMoim 은 인가 판정 시 조회한 moim 을 그대로 반환한다(중복 moim read 없음).
    const moim = await this.moimService.getMoim(user.sub, id);

    // 2) 게이트 통과 후 나머지 세 조회를 동시에 수행한다(서로 독립적). unchecked 변형이라 assertMember 를 반복하지
    //    않는다(멤버십은 위 게이트로 이미 확정). polls/schedule 은 빈 배열/null 이 유효 — 호출자 myVotes 는
    //    user.sub 기준으로 채워진다(개별 GET /moims/:id/polls 와 동일).
    const [members, polls, schedule] = await Promise.all([
      this.moimService.listMembersUnchecked(id),
      this.pollService.listPollsUnchecked(user.sub, id),
      this.scheduleService.getScheduleUnchecked(user.sub, id),
    ]);

    return {
      moim: toMoimDto(moim),
      members: members.map(toMemberDto),
      polls: polls.map(resultToDto),
      // GET /moims/:id/schedule 의 body 형태({ schedule })와 동일하게 감싼다(미설정이면 { schedule: null }).
      schedule: { schedule: schedule ? toScheduleDto(schedule) : null },
    };
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

  // DELETE /moims/:moimId/members/:userId — 멤버 강제 퇴장(owner 전용). 204.
  // 비-owner 403, 대상 없음 404, 대상이 owner 403, 모임 없음 404.
  @Delete(':moimId/members/:userId')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '멤버 강제 퇴장(owner 전용)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '비-owner 또는 대상이 owner — 403',
  })
  @ApiNotFoundResponse({ description: '모임 없음 또는 대상 멤버십 없음 — 404' })
  async kick(
    @CurrentUser() user: VerifiedUser,
    @Param('moimId') moimId: string,
    @Param('userId') userId: string,
  ): Promise<void> {
    await this.moimService.kickMember(user.sub, moimId, userId);
  }

  // PATCH /moims/:id — 모임 설정 수정(owner 전용, SPEC-MOIM-012 + SPEC-MOIM-EXPENSE-001 REQ-EXP-010). 200.
  // maxMembers/budget 모두 optional 부분 갱신. 비-owner 403, 없는 모임 404.
  // maxMembers 1 미만 400, budget 음수/비정수 400(null=해제 허용).
  @Patch(':id')
  @ApiOkResponse({
    description: '모임 설정 수정(owner 전용) — maxMembers/budget 부분 갱신',
    type: MoimResponseDto,
  })
  @ApiBody({ type: UpdateMaxMembersDto })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '대상 모임의 owner가 아님 — 403' })
  @ApiNotFoundResponse({ description: '존재하지 않는 모임 — 404' })
  async updateMaxMembers(
    @CurrentUser() user: VerifiedUser,
    @Param('id') id: string,
    @Body() body: UpdateMaxMembersDto,
  ): Promise<MoimResponseDto> {
    // ValidationPipe 부재 보완: maxMembers/budget 각각 검증(미전달 undefined 허용).
    const maxMembers =
      body?.maxMembers !== undefined
        ? requireValidMaxMembers(body.maxMembers)
        : undefined;
    const budget = parseOptionalBudget(body?.budget);
    const moim = await this.moimService.updateMoimSettings(
      user.sub,
      id,
      maxMembers,
      budget,
    );
    return toMoimDto(moim);
  }

  // POST /moims/:moimId/owner — 소유권 이양(owner 전용). 204.
  // 비-owner 403, self-transfer 400, 빈 userId 400, 대상 없음 404, 모임 없음 404.
  @Post(':moimId/owner')
  @HttpCode(204)
  @ApiNoContentResponse({ description: '소유권 이양(owner → 대상 멤버)' })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({ description: '비-owner — 403' })
  @ApiNotFoundResponse({ description: '모임 없음 또는 대상 멤버십 없음 — 404' })
  async transferOwner(
    @CurrentUser() user: VerifiedUser,
    @Param('moimId') moimId: string,
    @Body() body: TransferOwnerDto,
  ): Promise<void> {
    await this.moimService.transferOwner(user.sub, moimId, body?.userId ?? '');
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
    throw new BadRequestException(
      'startsAt 은(는) 유효한 ISO-8601 날짜여야 합니다',
    );
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

// SPEC-MOIM-012 REQ-MOIM12-001: optional maxMembers 파싱. 미전달 → undefined(DB 기본값 15).
// 전달 시 1 이상의 정수만 허용(미달 시 400). 비정수/음수/0 모두 400.
function parseOptionalMaxMembers(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException('maxMembers는 1 이상의 정수여야 합니다');
  }
  return value as number;
}

// SPEC-MOIM-012: PATCH /moims/:id maxMembers 필수 검증. 부재/비정수/0 이하 → 400.
function requireValidMaxMembers(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException('maxMembers는 1 이상의 정수여야 합니다');
  }
  return value as number;
}

// SPEC-MOIM-EXPENSE-001 REQ-EXP-010: optional budget 파싱. 미전달 → undefined(budget 불변).
// null → null(예산 해제). 전달 시 0 이상의 정수여야 한다(음수/비정수 → 400).
function parseOptionalBudget(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null; // 명시적 해제
  }
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new BadRequestException(
      'budget 은 0 이상의 정수 또는 null 이어야 합니다',
    );
  }
  return value as number;
}

// Moim 엔티티 → 공개 DTO(createdAt/startsAt ISO-8601 직렬화, location/budget null 허용).
function toMoimDto(moim: Moim): MoimResponseDto {
  return {
    id: moim.id,
    name: moim.name,
    // SPEC-MOIM-004 REQ-MOIM4-003: 일정/장소 정직 직렬화(미정이면 null — 허위 값 금지).
    startsAt: moim.startsAt ? moim.startsAt.toISOString() : null,
    location: moim.location ?? null,
    // SPEC-MOIM-012 REQ-MOIM12-001: 정원 직렬화.
    maxMembers: moim.maxMembers,
    // SPEC-MOIM-EXPENSE-001 REQ-EXP-010: 예산(미설정 null).
    budget: (moim as Moim & { budget?: number | null }).budget ?? null,
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
