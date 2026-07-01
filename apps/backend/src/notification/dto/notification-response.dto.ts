import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// SPEC-NOTIFICATIONS-001 M3: 알림 유발자 표시 정보. actorId 가 있을 때만 채워지며, 모임 멤버 행이 사라졌으면
// nickname 은 안전 기본값('알 수 없음')으로 채운다(actor 자체를 지우지는 않는다 — 알림은 살아 있어야 함).
export class NotificationActorDto {
  @ApiProperty({ description: '유발자 sub(= profile.id)', example: 'uuid' })
  id!: string;

  @ApiProperty({
    description: '모임별 표시 이름(해석 실패 시 기본값)',
    example: '홍길동',
  })
  nickname!: string;
}

// SPEC-NOTIFICATIONS-001 M3: 알림 단건 DTO. BigInt id 는 문자열로, 날짜는 ISO-8601 문자열로 직렬화한다.
// moimName/actor 는 응답 시점 배치 해석 결과이며, 대상이 사라졌으면 각각 null / fallback 닉네임이 된다.
export class NotificationDto {
  @ApiProperty({
    description: '알림 id(BigInt → 문자열, keyset 커서)',
    example: '42',
  })
  id!: string;

  @ApiProperty({
    description: '알림 종류(예: member.joined)',
    example: 'member.joined',
  })
  type!: string;

  @ApiProperty({ description: '컨텍스트 모임 id', example: 'uuid' })
  moimId!: string;

  @ApiProperty({
    description: '모임명(모임이 삭제됐으면 null)',
    nullable: true,
    type: String,
    example: '금요일 저녁 모임',
  })
  moimName!: string | null;

  @ApiPropertyOptional({
    description: '유발자(무행위자 알림이면 null)',
    type: NotificationActorDto,
    nullable: true,
  })
  actor!: NotificationActorDto | null;

  @ApiProperty({
    description: '타입별 미리보기 + 딥링크 타깃(자유 형식 JSON)',
    type: Object,
    example: { pollId: 'uuid', question: '점심 뭐 먹지?' },
  })
  data!: unknown;

  @ApiProperty({
    description: '읽음 시각(ISO-8601, 안읽음이면 null)',
    nullable: true,
    type: String,
    example: '2026-07-01T12:00:00.000Z',
  })
  readAt!: string | null;

  @ApiProperty({
    description: '생성 시각(ISO-8601)',
    example: '2026-07-01T12:00:00.000Z',
  })
  createdAt!: string;
}

// GET /notifications 응답. nextCursor 가 null 이면 더 오래된 페이지가 없다(무한 스크롤 종료).
export class NotificationListResponseDto {
  @ApiProperty({ description: '알림 목록(최신순)', type: [NotificationDto] })
  items!: NotificationDto[];

  @ApiProperty({
    description: '다음 페이지 커서(없으면 null)',
    nullable: true,
    type: String,
    example: '17',
  })
  nextCursor!: string | null;
}

// GET /notifications/unread-count 응답.
export class UnreadCountResponseDto {
  @ApiProperty({ description: '미읽음 알림 개수', example: 3 })
  count!: number;
}

// POST /notifications/read 응답. updated 는 이번 호출로 실제 읽음 처리된 행 수(이미 읽은 행은 제외).
export class MarkReadResponseDto {
  @ApiProperty({ description: '읽음 처리된 알림 수', example: 5 })
  updated!: number;
}
