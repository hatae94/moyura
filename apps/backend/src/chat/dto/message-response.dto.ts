import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 채팅 메시지 공개 표현(REQ-CHAT-001/003). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// id는 ChatMessage.id(BigInt PK)를 문자열로 직렬화한 값이다 — NestJS는 BigInt를 JSON 직렬화할 수 없으므로
// (런타임 TypeError) 반드시 id.toString()으로 매핑한다(BINDING CORRECTION). createdAt은 ISO-8601 문자열.
export class ChatMessageResponseDto {
  @ApiProperty({
    description:
      '메시지 id(BigInt PK의 문자열 표현 — 단조 증가, keyset 커서 기준)',
    example: '42',
  })
  id!: string;

  @ApiProperty({
    description: '메시지가 속한 모임 id',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  moimId!: string;

  @ApiProperty({
    description:
      '발신자 sub(= profile.id). 표시 이름은 멤버 목록에서 클라이언트가 해석한다.',
    example: '00000000-0000-4000-8000-000000000001',
  })
  senderId!: string;

  @ApiProperty({ description: '메시지 본문', example: '안녕하세요' })
  content!: string;

  @ApiProperty({
    description: '메시지 생성 시각(ISO-8601)',
    example: '2026-06-14T00:00:00.000Z',
  })
  createdAt!: string;
}
