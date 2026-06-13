import { ApiPropertyOptional } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 초대 발급 요청 바디(REQ-INV-001). 두 필드 모두 선택적이다 — 미지정 시 만료 now+7d,
// maxUses null(무제한). class-validator/ValidationPipe 부재(C-1)라 상한(30일)·양의 정수 검사는
// InviteService가 명시적으로 수행한다(400). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
export class CreateInviteDto {
  @ApiPropertyOptional({
    description:
      '만료 시각(ISO-8601). 미지정 시 발급 시점 +7일. 상한 +30일(초과 400).',
    example: '2026-06-21T00:00:00.000Z',
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    description: '선택적 사용 횟수 제한(1 이상의 정수). 미지정 시 무제한.',
    example: 5,
  })
  maxUses?: number;
}
