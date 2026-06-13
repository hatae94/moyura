import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 디바이스 토큰 등록 요청 바디(REQ-PUSH-002). @nestjs/swagger가 이 DTO로 OpenAPI 모델을
// 만든다(api-client 타입 재생성 경로). 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(C-1)
// token/platform 비어 있음 검사는 컨트롤러에서 명시적으로 한다(moim CreateMoimDto 패턴 동일).
export class RegisterDeviceDto {
  @ApiProperty({
    description: 'FCM/Expo 디바이스 push 토큰(비어 있을 수 없음)',
    example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
  })
  token!: string;

  @ApiProperty({
    description: '디바이스 플랫폼(비어 있을 수 없음)',
    example: 'ios',
    enum: ['android', 'ios'],
  })
  platform!: string;
}
