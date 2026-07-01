import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import { MarkReadDto } from './dto/mark-read.dto';
import {
  MarkReadResponseDto,
  NotificationDto,
  NotificationListResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import type {
  MarkReadInput,
  NotificationFeedItem,
} from './notification.service';
import { NotificationService } from './notification.service';

// 피드 페이지 기본/최대 크기(과대 요청 방지). plan §2 기본 limit 20.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// @MX:NOTE: [AUTO] 알림 읽기 HTTP 표면(SPEC-NOTIFICATIONS-001 M3). 세 라우트 모두 per-route
// @UseGuards(SupabaseAuthGuard)로 401 을 선처리하고, 인가는 assertMember 가 아니라 recipientId==sub 로
// NotificationService 의 where 절에서 판정된다(추방당한 사용자도 자기 알림 열람 가능 — plan §6). body/query 는
// 절대 신뢰하지 않고 가드-검증 user.sub 만 쿼리 키로 쓴다(교차 사용자 접근 차단). ValidationPipe 부재(코드베이스
// 컨벤션) → cursor/limit/read 바디는 여기(또는 서비스 parseCursor)에서 명시적으로 400 을 던진다. BigInt id 는
// JSON 직렬화 불가라 DTO 매핑 시 id.toString() 으로 변환한다(chat 선례).
@ApiTags('notification')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  // GET /notifications?cursor=&limit= — 수신자(sub) keyset 피드(최신순). 200. 잘못된 cursor 는 400.
  @Get()
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({
    description: 'keyset 내림차순(최신순) 알림 목록 + nextCursor',
    type: NotificationListResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiBadRequestResponse({ description: '잘못된 cursor — 400' })
  async list(
    @CurrentUser() user: VerifiedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<NotificationListResponseDto> {
    // 조회 키는 가드-검증 sub 만 사용한다(query/body 미신뢰 — 교차 사용자 접근 불가).
    const page = await this.notifications.listForRecipient(user.sub, {
      cursor: cursor === undefined || cursor === '' ? undefined : cursor,
      limit: resolveLimit(limit),
    });
    return {
      items: page.items.map(toNotificationDto),
      nextCursor: page.nextCursor,
    };
  }

  // GET /notifications/unread-count — 수신자(sub) 미읽음 개수. 200.
  @Get('unread-count')
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({
    description: '수신자의 미읽음 알림 개수',
    type: UnreadCountResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  async unreadCount(
    @CurrentUser() user: VerifiedUser,
  ): Promise<UnreadCountResponseDto> {
    const count = await this.notifications.unreadCount(user.sub);
    return { count };
  }

  // POST /notifications/read — 읽음 처리(ids[] 또는 all:true). 200 { updated }. 빈/불량 바디는 400.
  @Post('read')
  @HttpCode(200)
  @UseGuards(SupabaseAuthGuard)
  @ApiOkResponse({
    description: '읽음 처리 결과(실제 갱신된 행 수)',
    type: MarkReadResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiBadRequestResponse({
    description: 'ids/all 둘 다 없거나 ids 형식 불량 — 400',
  })
  async markRead(
    @CurrentUser() user: VerifiedUser,
    @Body() body: MarkReadDto,
  ): Promise<MarkReadResponseDto> {
    // ValidationPipe 부재 → 바디를 명시적으로 검증한다(ids[] 또는 all:true 중 하나 필수).
    const input = parseMarkReadBody(body);
    // 갱신 키는 가드-검증 sub 만 — 서비스 where 의 recipientId=sub 가 남의 알림 갱신을 구조적으로 차단한다.
    const { updated } = await this.notifications.markRead(user.sub, input);
    return { updated };
  }
}

// ── 검증 헬퍼(ValidationPipe 부재 보완, chat/schedule 선례) ────────────────────

// limit 쿼리(문자열) → 1..MAX_LIMIT 정수. 미지정/비정수면 기본값(20)으로 정규화한다(chat resolveLimit 미러).
function resolveLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}

// POST /read 바디 검증: all:true 이거나, 유효한 BigInt 문자열의 비어있지 않은 ids 배열이어야 한다. 그 외 400.
// 런타임 입력은 신뢰할 수 없으므로 unknown 으로 재캐스팅해 각 원소를 명시 검증한다(schedule requireSlotArray 패턴).
function parseMarkReadBody(body: MarkReadDto | undefined): MarkReadInput {
  const raw = (body ?? {}) as { ids?: unknown; all?: unknown };
  if (raw.all === true) {
    return { all: true };
  }
  if (raw.ids !== undefined) {
    if (
      !Array.isArray(raw.ids) ||
      raw.ids.length === 0 ||
      (raw.ids as unknown[]).some((id) => !isBigIntString(id))
    ) {
      throw new BadRequestException(
        'ids 는 유효한 알림 id(BigInt 문자열)의 비어있지 않은 배열이어야 합니다',
      );
    }
    return { ids: raw.ids as string[] };
  }
  throw new BadRequestException('ids 또는 all:true 중 하나가 필요합니다');
}

// 값이 파싱 가능한 BigInt 문자열인지 검사한다(빈 문자열/비문자열/파싱 불가는 false).
function isBigIntString(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

// ── DTO 변환 ──────────────────────────────────────────────────────────────────

// 해석 완료 피드 아이템 → 공개 DTO. BigInt id 를 문자열로(필수), 날짜를 ISO-8601 로 직렬화한다.
function toNotificationDto(item: NotificationFeedItem): NotificationDto {
  return {
    id: item.id.toString(),
    type: item.type,
    moimId: item.moimId,
    moimName: item.moimName,
    actor: item.actor,
    data: item.data,
    readAt: item.readAt ? item.readAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  };
}
