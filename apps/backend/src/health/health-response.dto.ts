import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] /health 응답 스키마. @nestjs/swagger가 이 DTO로 OpenAPI 모델을 생성한다(R-D1).
export class HealthResponseDto {
  @ApiProperty({
    description: '전체 헬스 상태',
    enum: ['ok', 'degraded'],
    example: 'ok',
  })
  status!: 'ok' | 'degraded';

  @ApiProperty({
    description: '데이터베이스 연결성 결과',
    enum: ['up', 'down'],
    example: 'up',
  })
  db!: 'up' | 'down';
}
