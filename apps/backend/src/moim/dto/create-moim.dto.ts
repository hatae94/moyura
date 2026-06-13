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
}
