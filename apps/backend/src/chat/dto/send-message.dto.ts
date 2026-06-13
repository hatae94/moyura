import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 메시지 전송 요청 바디(REQ-CHAT-001). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(MOIM-001 동일) content 비어 있음/길이 초과 검사는
// 컨트롤러에서 명시적으로 한다(400). DB CHECK(char_length 1..2000)가 마지막 방어선이다.
export class SendMessageDto {
  @ApiProperty({
    description: '메시지 본문(비어 있을 수 없음, 최대 2000자)',
    example: '안녕하세요',
  })
  content!: string;
}
