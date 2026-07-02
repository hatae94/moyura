import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 차단 생성 요청 바디(SPEC-SAFETY-001 REQ-BLK-001). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// **blockerId는 이 DTO에 없다** — 차단자는 가드-검증 sub 로만 결정되며(WHERE 내장 인가, REQ-CPL-003) body 의
// 위조된 blockerId 를 신뢰하지 않는다(mass-assignment 차단). 자기 차단(blockedUserId == sub)은 서비스가 400 으로 거른다.
export class CreateBlockDto {
  @ApiProperty({
    description:
      '차단 대상 sub(profile.id). 자기 자신(sub)이면 400. 이미 차단돼 있으면 멱등 성공(200).',
    example: 'user-b',
  })
  blockedUserId!: string;
}
