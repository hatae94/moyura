import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 투표 요청 바디(SPEC-MOIM-005 REQ-MOIM5-003). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// optionId 가 비어 있으면 컨트롤러가 400(ValidationPipe 부재 보완). 해당 poll 소속 옵션인지의 검증은 service 가 한다.
export class VoteDto {
  @ApiProperty({
    description: '선택지 id(해당 poll 에 속해야 함 — 아니면 400)',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  optionId!: string;
}
