import { ApiProperty } from '@nestjs/swagger';
import { PollResponseDto } from '../../poll/dto/poll-response.dto';
import { ScheduleResponseDto } from '../../schedule/dto/schedule-response.dto';
import { MemberResponseDto } from './member-response.dto';
import { MoimResponseDto } from './moim-response.dto';

// @MX:NOTE: [AUTO] 모임 상세 집계 응답(SPEC-MOIM-DETAIL-001). GET /moims/:id/detail 이 개별 4개 엔드포인트
// (GET /moims/:id, .../members, .../polls, .../schedule)를 서버측에서 1회로 합쳐 웹 SSR의 4개 병렬 백엔드
// 호출을 1개로 줄인다. 각 필드는 기존 DTO를 그대로 재사용하므로 개별 엔드포인트와 형태가 byte-identical 하다 —
// 웹이 데이터 헬퍼를 투명하게 스왑할 수 있다(형태 드리프트 금지). @nestjs/swagger가 이 조합 DTO로 중첩 모델을
// 만들며, poll/schedule 은 nullable/isArray 를 명시해 openapi-typescript 가 정확한 중첩 타입을 생성하게 한다.
export class MoimDetailResponseDto {
  @ApiProperty({
    description: '모임 단건 정보(GET /moims/:id 와 동일 형태)',
    type: MoimResponseDto,
  })
  moim!: MoimResponseDto;

  @ApiProperty({
    description: '멤버 목록(GET /moims/:id/members 와 동일 형태)',
    type: MemberResponseDto,
    isArray: true,
  })
  members!: MemberResponseDto[];

  @ApiProperty({
    description:
      '투표 목록(GET /moims/:id/polls 와 동일 형태 — 각 옵션 voteCount + 호출자 myVotes 포함). 투표 없으면 빈 배열.',
    type: PollResponseDto,
    isArray: true,
  })
  polls!: PollResponseDto[];

  @ApiProperty({
    description:
      '일정 조율 세션(GET /moims/:id/schedule 의 body.schedule 과 동일 형태). 미설정이면 null.',
    type: ScheduleResponseDto,
    nullable: true,
  })
  schedule!: ScheduleResponseDto | null;
}
