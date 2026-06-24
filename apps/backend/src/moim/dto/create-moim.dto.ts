import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 모임 생성 요청 바디(REQ-MOIM-004). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// 이 프로젝트에는 class-validator/ValidationPipe가 없으므로(main.ts에 useGlobalPipes 부재) 런타임
// 검증자(@IsNotEmpty 등)는 동작하지 않는다 — name/nickname 비어 있음 검사는 컨트롤러에서 명시적으로 한다.
export class CreateMoimDto {
  @ApiProperty({
    description: '모임 이름(비어 있을 수 없음)',
    example: '주말 등산 모임',
  })
  name!: string;

  @ApiProperty({
    description:
      '생성자의 모임별 표시 이름(host nickname, 비어 있을 수 없음). owner 멤버십에 주입된다.',
    example: '호스트',
  })
  nickname!: string;

  // SPEC-MOIM-004 REQ-MOIM4-002: 이벤트 일정(optional, ISO-8601). 존재 시에만 컨트롤러가 ISO 유효성을
  // 최소 검증한다(파싱 실패 400). 부재/빈 값이면 null 로 저장된다(일정 없는 모임도 유효).
  @ApiProperty({
    description: '이벤트 일정(ISO-8601, optional). 부재/빈 값이면 일정 미정.',
    required: false,
    example: '2026-07-01T10:00:00.000Z',
  })
  startsAt?: string;

  // SPEC-MOIM-004 REQ-MOIM4-002: 자유 텍스트 장소(optional). 부재/빈 값이면 null 로 저장된다.
  @ApiProperty({
    description: '이벤트 장소(자유 텍스트, optional).',
    required: false,
    example: '강남역 스타벅스',
  })
  location?: string;

  // SPEC-MOIM-012 REQ-MOIM12-001: 모임 정원(optional, 기본 15). 1 이상의 정수여야 한다(미달 시 400).
  @ApiProperty({
    description: '모임 정원(optional, 기본 15). 1 이상의 정수.',
    required: false,
    example: 20,
  })
  maxMembers?: number;
}
