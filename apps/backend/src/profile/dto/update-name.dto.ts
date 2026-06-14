import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] PATCH /me 요청 바디(SPEC-MOBILE-004 REQ-MOB4-003/004). @nestjs/swagger가 이 DTO로
// OpenAPI 모델을 만든다(api-client patchMe 타입 재생성 경로). 이 프로젝트에는 class-validator/
// ValidationPipe가 없으므로(C-1) name 비어 있음(trim 후 빈 문자열) 검사는 컨트롤러에서 명시적으로
// requireNonEmpty 로 한다(RegisterDeviceDto/CreateMoimDto 패턴 동일). id/sub 등 다른 필드는 받지 않는다.
export class UpdateNameDto {
  @ApiProperty({
    description: '설정할 사용자 표시 이름(trim 후 비어 있을 수 없음)',
    example: '홍길동',
  })
  name!: string;
}
