import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 수락 결과 공개 표현(REQ-INV-005 / AC-8). token은 노출하지 않는다 — 수락 응답은
// 게스트가 받으므로 자격증명을 되돌려주지 않는다. 웹 랜딩(T-009)이 moimId로 /moims/:id/chat로 리다이렉트한다.
export class AcceptInviteResponseDto {
  @ApiProperty({
    description: '가입한 모임 id(웹 랜딩이 /moims/:id/chat 리다이렉트에 사용)',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  moimId!: string;
}
