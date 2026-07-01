import { ApiPropertyOptional } from '@nestjs/swagger';

// SPEC-NOTIFICATIONS-001 M3: POST /notifications/read 요청 바디. 둘 중 하나만 유효하다:
//   - ids: 읽음 처리할 알림 id(BigInt 문자열) 배열(비어 있으면 안 됨).
//   - all: true — 수신자의 전체 미읽음을 읽음 처리.
// ValidationPipe 부재(코드베이스 컨벤션)라 컨트롤러가 명시적으로 검증한다(둘 다 없으면/형식 불량이면 400).
export class MarkReadDto {
  @ApiPropertyOptional({
    description:
      '읽음 처리할 알림 id 배열(BigInt 문자열). all 과 배타 — 지정 시 비어 있으면 400.',
    type: [String],
    example: ['42', '41'],
  })
  ids?: string[];

  @ApiPropertyOptional({
    description: '전체 미읽음 읽음 처리(ids 미지정 시 true 여야 함).',
    example: true,
  })
  all?: boolean;
}
