import { ApiProperty } from '@nestjs/swagger';

// @MX:NOTE: [AUTO] 투표 선택지의 공개 표현(SPEC-MOIM-005 REQ-MOIM5-004). voteCount 는 PollVote 집계이며 표 0 옵션도 0 으로 포함된다.
// SPEC-MOIM-008 REQ-MOIM8-004: optionDate(ISO-8601|null) 추가 — 날짜 투표 옵션은 그 시각, 일반 투표는 null.
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

  // SPEC-MOIM-008 REQ-MOIM8-004: 날짜 옵션 시각(ISO-8601) 또는 null(일반 투표 옵션).
  // 웹이 이 값을 사람이 읽을 수 있게 포맷해 표시한다(raw ISO label 노출 금지).
  @ApiProperty({
    description: '날짜 투표 옵션의 시각(ISO-8601). 일반 투표 옵션은 null.',
    nullable: true,
    type: String,
    example: '2026-06-27T12:00:00.000Z',
  })
  optionDate!: string | null;
}

// @MX:NOTE: [AUTO] 투표 공개 표현(SPEC-MOIM-007 REQ-MOIM7-005 — MOIM-006 확장). @nestjs/swagger가 이 DTO로 OpenAPI 모델을 만든다.
// options 는 각 선택지의 voteCount(집계, 표 0 포함)를 담고, myVotes 는 호출자 자신이 고른 optionId 목록이다
// (단일 선택은 0/1요소, 다중 선택은 0..N요소, 미투표 시 빈 배열). multiSelect 는 poll 별 다중 선택 여부다.
// SPEC-MOIM-007: closesAt(ISO|null) + isClosed(서버 계산)를 추가한다 — 클라이언트 시계 오차 차단.
// SPEC-MOIM-008: kind + optionDate(옵션별) + finalizedStartsAt + finalizeSkippedReason 추가.
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
    description:
      '여러 개 선택 허용 여부(true=다중 선택/토글, false=단일 선택/교체).',
    example: false,
  })
  multiSelect!: boolean;

  // SPEC-MOIM-008/010 REQ-MOIM8-004/REQ-MOIM10-004: 투표 종류. "general"=일반, "date"=날짜, "place"=장소.
  @ApiProperty({
    description:
      '투표 종류. "general"=일반(자유 텍스트 옵션), "date"=날짜 투표(optionDate 있음), "place"=장소 투표(마감 시 승자 → location).',
    enum: ['general', 'date', 'place'],
    example: 'general',
  })
  kind!: string;

  @ApiProperty({
    description: '선택지 목록(각 선택지의 득표 수 + optionDate 포함)',
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

  // SPEC-MOIM-008 REQ-MOIM8-005: finalize 결과 필드. close 응답에서만 값을 가지며 vote/list 응답에선 항상 null.
  // finalizedStartsAt: 단일 승자 finalize 시 확정된 날짜(ISO) 또는 null(동점/무표/일반 투표/vote/list).
  @ApiProperty({
    description:
      '자동 확정된 모임 일정(ISO-8601). 날짜 투표 마감 시 단일 최다 득표 옵션의 날짜가 Moim.startsAt 으로 설정된 경우에만 값이 있다. vote/list 응답에선 항상 null.',
    nullable: true,
    type: String,
    example: '2026-06-27T12:00:00.000Z',
  })
  finalizedStartsAt!: string | null;

  // SPEC-MOIM-010 REQ-MOIM10-005: finalizedLocation — 장소 투표 마감 시 단일 최다 득표 옵션의 label(장소명)이
  // Moim.location 으로 설정된 경우에만 값이 있다. 날짜/일반 투표·동점·무표·vote/list 응답에선 null(finalizedStartsAt 과 상호 배타).
  @ApiProperty({
    description:
      '자동 확정된 모임 장소. 장소 투표 마감 시 단일 최다 득표 옵션의 장소명이 Moim.location 으로 설정된 경우에만 값이 있다. vote/list 응답·날짜 투표에선 null.',
    nullable: true,
    type: String,
    example: '강남역 2번 출구',
  })
  finalizedLocation!: string | null;

  // finalizeSkippedReason: 날짜·장소 투표 동점="tie" / 무표="no_votes" / finalize 성공·일반 투표·vote/list 응답=null.
  @ApiProperty({
    description:
      'finalize 건너뛴 이유. "tie"=동점, "no_votes"=표 없음, null=finalize 성공 또는 일반 투표 또는 vote/list 응답.',
    nullable: true,
    enum: ['tie', 'no_votes'],
    example: null,
  })
  finalizeSkippedReason!: string | null;
}
