import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] safety HTTP 응답 DTO(SPEC-SAFETY-001 M2 / T-004). @nestjs/swagger가 이 DTO로 OpenAPI 모델을
// 만든다. Block/Report 엔티티의 createdAt(Date)은 JSON 직렬화를 위해 ISO-8601 문자열로 매핑한다(notification 선례).

// POST /reports 응답. 저장된 신고 행의 공개 표현(신고자 측 숨김의 진실 공급원 — REQ-RPT-001).
export class ReportResponseDto {
  @ApiProperty({ description: '신고 id(uuid)', example: 'uuid' })
  id!: string;

  @ApiProperty({ description: '신고자 sub(가드-검증 sub)', example: 'user-a' })
  reporterId!: string;

  @ApiProperty({ description: '신고 대상 sub', example: 'user-b' })
  targetUserId!: string;

  @ApiProperty({ description: '신고 컨텍스트 모임 id', example: 'moim-a' })
  moimId!: string;

  @ApiProperty({ description: '신고 사유', example: '스팸' })
  reason!: string;

  @ApiProperty({
    description: '신고 콘텐츠 타입(단일 PK 4종)',
    example: 'chat_message',
  })
  contentType!: string;

  @ApiProperty({ description: '신고 콘텐츠 id(TEXT)', example: '42' })
  contentId!: string;

  @ApiProperty({
    description: '생성 시각(ISO-8601)',
    example: '2026-07-02T00:00:00.000Z',
  })
  createdAt!: string;
}

// POST /blocks 응답 + GET /blocks 목록 원소. 차단 행의 공개 표현(멤버 목록/프로필 "차단한 멤버" 섹션 소비).
export class BlockResponseDto {
  @ApiProperty({ description: '차단자 sub(가드-검증 sub)', example: 'user-a' })
  blockerId!: string;

  @ApiProperty({ description: '차단 대상 sub', example: 'user-b' })
  blockedUserId!: string;

  @ApiProperty({
    description: '생성 시각(ISO-8601)',
    example: '2026-07-02T00:00:00.000Z',
  })
  createdAt!: string;
}

// GET /blocks 응답. 내(sub)가 차단한 목록(block 행만 — 신고 기반 숨김은 미포함).
export class BlockListResponseDto {
  @ApiProperty({
    description: '내가 차단한 목록(block 행만)',
    type: [BlockResponseDto],
  })
  items!: BlockResponseDto[];
}
