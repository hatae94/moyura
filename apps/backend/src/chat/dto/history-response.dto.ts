import { ApiProperty } from '@nestjs/swagger';
import { ChatMessageResponseDto } from './message-response.dto';

// @MX:NOTE: [AUTO] keyset 히스토리 응답(REQ-CHAT-003 / AC-2). 내림차순(최신순) 메시지 + 다음 커서.
// nextCursor는 마지막(가장 오래된 반환분) 메시지 id의 문자열이며, 더 오래된 페이지가 없으면 null이다.
export class ChatHistoryResponseDto {
  @ApiProperty({
    description: '커서 이전 최신순(내림차순) 메시지 목록',
    type: [ChatMessageResponseDto],
  })
  messages!: ChatMessageResponseDto[];

  @ApiProperty({
    description: '다음 페이지 커서(가장 오래된 반환분의 id). 더 없으면 null.',
    example: '37',
    nullable: true,
    type: String,
  })
  nextCursor!: string | null;
}
