import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 투표 생성 요청 바디(SPEC-MOIM-007 REQ-MOIM7-002 — MOIM-006 확장). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(MOIM-001 동일) question 빈/유효 옵션<2 검사는
// 컨트롤러에서 명시적으로 한다(400). question 은 한 줄, options 는 trim 후 비지 않은 항목 ≥2 가 필요하다.
// multiSelect 는 poll 별 다중 선택 옵트인(생략/falsy 면 false = 단일 선택, MOIM-005 동작 동일).
// closesAt 는 마감 시각(ISO-8601 문자열, optional). 생략 시 null(마감 없음). 무효 ISO 는 컨트롤러가 400.
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

  @ApiProperty({
    description:
      '마감 시각(ISO-8601). 생략 시 null(마감 없음 — 영구히 열림). 무효 ISO 는 400 Bad Request.',
    required: false,
    nullable: true,
    type: String,
    example: '2026-06-25T12:00:00.000Z',
  })
  closesAt?: string;

  // SPEC-MOIM-008 REQ-MOIM8-002: 투표 종류(optional). "general"=일반(자유 텍스트 옵션, 기본),
  // "date"=날짜 투표(options[] 가 ISO-8601 datetime 문자열). 미지 값은 컨트롤러가 400 으로 거른다.
  @ApiProperty({
    description:
      '투표 종류. "date" 면 options 가 ISO-8601 날짜 문자열 배열(옵션별 optionDate 저장). 생략/"general" 이면 일반 자유 텍스트 옵션.',
    required: false,
    enum: ['general', 'date'],
    default: 'general',
    example: 'general',
  })
  kind?: string;
}
