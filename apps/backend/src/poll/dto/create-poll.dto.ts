import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 투표 생성 요청 바디(SPEC-MOIM-006 REQ-MOIM6-002). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(MOIM-001 동일) question 빈/유효 옵션<2 검사는
// 컨트롤러에서 명시적으로 한다(400). question 은 한 줄, options 는 trim 후 비지 않은 항목 ≥2 가 필요하다.
// multiSelect 는 poll 별 다중 선택 옵트인(생략/falsy 면 false = 단일 선택, MOIM-005 동작 동일).
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

  @ApiProperty({
    description:
      '여러 개 선택 허용 여부(poll 별 옵트인). true 면 다중 선택(토글), 생략/false 면 단일 선택(교체).',
    required: false,
    default: false,
    example: false,
  })
  multiSelect?: boolean;
}
