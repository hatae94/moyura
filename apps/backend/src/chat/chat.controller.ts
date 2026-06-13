import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard';
import type { VerifiedUser } from '../auth/token-verifier.service';
import type { ChatMessage } from '../generated/prisma/client';
import { ChatService } from './chat.service';
import { ChatHistoryResponseDto } from './dto/history-response.dto';
import { ChatMessageResponseDto } from './dto/message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';

// content 길이 상한(DB CHECK char_length 1..2000과 동일). 컨트롤러에서 선검사해 400으로 거른다.
const MAX_CONTENT_LENGTH = 2000;
// 히스토리 페이지 기본/최대 크기(과대 요청 방지).
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// @MX:NOTE: [AUTO] 채팅 HTTP 표면(REQ-CHAT-001/003/005). 두 라우트 모두 per-route @UseGuards(SupabaseAuthGuard)로
// 401을 선처리하고, 멤버십 인가(403)·없는 모임(404→403 변환)은 ChatService→MoimService.assertMember가 판정한다.
// ValidationPipe 부재(MOIM-001 동일) → content 빈/길이 초과는 여기서 명시적으로 400을 던진다.
// BigInt PK는 NestJS가 JSON 직렬화할 수 없으므로 DTO 매핑 시 id.toString()으로 변환한다(필수).
@ApiTags('chat')
@ApiBearerAuth('bearer')
@Controller('moims/:id/messages')
@UseGuards(SupabaseAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // POST /moims/:id/messages — 메시지 전송(멤버 한정, REQ-CHAT-001 / AC-1). 201.
  @Post()
  @ApiCreatedResponse({
    description: '메시지 전송 + 저장된 메시지 반환',
    type: ChatMessageResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '대상 모임의 멤버가 아님(또는 없는 모임) — 403',
  })
  @ApiBadRequestResponse({ description: '빈/과대 content — 400' })
  async send(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Body() body: SendMessageDto,
  ): Promise<ChatMessageResponseDto> {
    const content = requireContent(body?.content);
    const message = await this.chatService.sendMessage(
      user.sub,
      moimId,
      content,
    );
    return toMessageDto(message);
  }

  // GET /moims/:id/messages?cursor=&limit= — keyset 히스토리(멤버 한정, REQ-CHAT-003 / AC-2). 200.
  @Get()
  @ApiOkResponse({
    description: 'keyset 내림차순(최신순) 히스토리 + nextCursor',
    type: ChatHistoryResponseDto,
  })
  @ApiUnauthorizedResponse({ description: '유효한 Supabase JWT 부재 — 401' })
  @ApiForbiddenResponse({
    description: '대상 모임의 멤버가 아님(또는 없는 모임) — 403',
  })
  @ApiBadRequestResponse({ description: '잘못된 cursor — 400' })
  async history(
    @CurrentUser() user: VerifiedUser,
    @Param('id') moimId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ChatHistoryResponseDto> {
    const page = await this.chatService.getHistory(user.sub, moimId, {
      cursor: cursor === undefined || cursor === '' ? undefined : cursor,
      limit: resolveLimit(limit),
    });
    return {
      messages: page.messages.map(toMessageDto),
      nextCursor: page.nextCursor,
    };
  }
}

// content가 trim 후 비어 있거나 상한을 초과하면 400(ValidationPipe 부재 보완 — MOIM-001 패턴 동일).
function requireContent(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('content는 문자열이어야 합니다');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new BadRequestException('content는 비어 있을 수 없습니다');
  }
  if (trimmed.length > MAX_CONTENT_LENGTH) {
    throw new BadRequestException(
      `content는 ${MAX_CONTENT_LENGTH}자를 초과할 수 없습니다`,
    );
  }
  return trimmed;
}

// limit 쿼리(문자열) → 1..MAX_LIMIT 정수. 미지정/비정수면 기본값으로 정규화한다.
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

// ChatMessage 엔티티 → 공개 DTO. BigInt id를 문자열로(필수), createdAt을 ISO-8601로 직렬화한다.
function toMessageDto(message: ChatMessage): ChatMessageResponseDto {
  return {
    id: message.id.toString(),
    moimId: message.moimId,
    senderId: message.senderId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}
