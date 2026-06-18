import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 투표 생성 요청 바디(SPEC-MOIM-005 REQ-MOIM5-002). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(MOIM-001 동일) question 빈/유효 옵션<2 검사는
// 컨트롤러에서 명시적으로 한다(400). question 은 한 줄, options 는 trim 후 비지 않은 항목 ≥2 가 필요하다.
export class CreatePollDto {
  @ApiProperty({
    description: '투표 질문(trim 후 비어 있을 수 없음)',
    example: '다음 모임 날짜는?',
  })
  question!: string;

  @ApiProperty({
    description: '선택지 라벨 배열(trim 후 비지 않은 항목 2개 이상 필요)',
    example: ['토요일', '일요일'],
    type: [String],
  })
  options!: string[];
}
