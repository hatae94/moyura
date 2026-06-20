import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 투표 선택지의 공개 표현(SPEC-MOIM-005 REQ-MOIM5-004). voteCount 는 PollVote 집계이며 표 0 옵션도 0 으로 포함된다.
export class PollOptionResponseDto {
  @ApiProperty({
    description: '선택지 id',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  id!: string;

  @ApiProperty({ description: '선택지 라벨', example: '토요일' })
  label!: string;

  @ApiProperty({
    description: '이 선택지의 득표 수(표 0 이면 0)',
    example: 3,
  })
  voteCount!: number;
}

// @MX:NOTE: [AUTO] 투표 공개 표현(SPEC-MOIM-007 REQ-MOIM7-005 — MOIM-006 확장). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// options 는 각 선택지의 voteCount(집계, 표 0 포함)를 담고, myVotes 는 호출자 자신이 고른 optionId 목록이다
// (단일 선택은 0/1요소, 다중 선택은 0..N요소, 미투표 시 빈 배열). multiSelect 는 poll 별 다중 선택 여부다.
// SPEC-MOIM-007: closesAt(ISO|null) + isClosed(서버 계산)를 추가한다 — 클라이언트 시계 오차 차단.
// 누가 무엇에 투표했는지(타인 식별)는 노출하지 않는다(spec §4 익명/공개 토글 비범위 — 집계 + 자기 표만).
export class PollResponseDto {
  @ApiProperty({
    description: '투표 id(uuid)',
    example: '15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8',
  })
  id!: string;

  @ApiProperty({ description: '투표 질문', example: '다음 모임 날짜는?' })
  question!: string;

  @ApiProperty({
    description: '생성자 sub(= profile.id)',
    example: '00000000-0000-4000-8000-000000000001',
  })
  createdBy!: string;

  @ApiProperty({
    description: '투표 생성 시각(ISO-8601)',
    example: '2026-06-20T00:00:00.000Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '여러 개 선택 허용 여부(true=다중 선택/토글, false=단일 선택/교체).',
    example: false,
  })
  multiSelect!: boolean;

  @ApiProperty({
    description: '선택지 목록(각 선택지의 득표 수 포함)',
    type: [PollOptionResponseDto],
  })
  options!: PollOptionResponseDto[];

  @ApiProperty({
    description:
      '호출자 자신이 고른 선택지 id 목록(미투표 시 빈 배열). 단일 선택은 0/1요소, 다중 선택은 0..N요소.',
    type: [String],
    example: ['15ebe4ba-7f12-4e2c-bfa4-a0a9eb5022b8'],
  })
  myVotes!: string[];

  @ApiProperty({
    description:
      '마감 시각(ISO-8601). null 이면 마감 없음(영구히 열림). 마감 판정은 isClosed 를 권위 있는 출처로 사용한다.',
    nullable: true,
    type: String,
    example: '2026-06-25T12:00:00.000Z',
  })
  closesAt!: string | null;

  @ApiProperty({
    description:
      '서버 계산 마감 여부(closesAt != null AND closesAt <= 서버 now). 클라이언트 시계 오차 차단용 — 차단/배지 판정에 사용한다.',
    example: false,
  })
  isClosed!: boolean;
}
