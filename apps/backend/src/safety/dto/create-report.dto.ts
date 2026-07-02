import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 신고 생성 요청 바디(SPEC-SAFETY-001 REQ-RPT-001). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(MOIM-001 동일) contentType 화이트리스트/빈 reason
// 검사는 서비스에서 명시적으로 한다(400). **reporterId는 이 DTO에 없다** — 신고자는 가드-검증 sub 로만 결정되며
// (WHERE 내장 인가, REQ-CPL-003) body 의 위조된 reporterId 를 신뢰하지 않는다(mass-assignment 차단).
export class CreateReportDto {
  @ApiProperty({
    description: '신고 대상(피신고 콘텐츠 작성자) sub(profile.id).',
    example: 'user-b',
  })
  targetUserId!: string;

  @ApiProperty({
    description: '신고 컨텍스트 모임 id.',
    example: 'moim-a',
  })
  moimId!: string;

  @ApiProperty({
    description: '신고 사유(trim 후 비어 있을 수 없음 — 빈 값은 400).',
    example: '스팸',
  })
  reason!: string;

  @ApiProperty({
    description:
      '신고 콘텐츠 타입. 단일 PK 4종만 허용(복합 PK 콘텐츠는 400, REQ-RPT-004).',
    enum: ['chat_message', 'poll', 'expense', 'settlement_request'],
    example: 'chat_message',
  })
  contentType!: string;

  @ApiProperty({
    description:
      '신고 콘텐츠 id(TEXT 통일). chat_message(BigInt PK)는 필터 시 BigInt 캐스팅(REQ-RPT-005).',
    example: '42',
  })
  contentId!: string;
}
