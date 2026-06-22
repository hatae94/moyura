// 모임 투표(poll) 조회/생성/투표 헬퍼 (SPEC-MOIM-006 REQ-MOIM6-005).
//
// poll 라우트는 path 파라미터가 있어(`/moims/:id/polls`, `/moims/:id/polls/:pollId/vote`) api-client 의
// 편의 메서드 표면(리터럴 경로 전용)에 넣지 않는다 — lib/moim/api.ts 의 getMoim/getMoimMembers 와 동일하게
// 여기서 moimId/pollId 를 인코딩해 구체 경로를 만든다. api-client.request 는 path 를 baseUrl 뒤에 그대로
// 연결하므로(템플릿 치환 없음 — verified) 타입 키와 런타임 경로가 달라 `path as never` 캐스팅이 필요하다.
import {
  type ApiClient,
  type CreatePollRequest,
  type PollResponse,
} from "@moyura/api-client";

// 백엔드 PollResponseDto 미러 — multiSelect(다중 선택 여부) + 각 옵션의 voteCount(표 0 포함) + 호출자
// myVotes(고른 optionId 목록, 미투표 빈 배열). MOIM-006: 단일 myVote(string|null)를 myVotes(string[])로 대체.
// SPEC-MOIM-007: closesAt(ISO|null — 마감 시각) + isClosed(서버 계산 마감 여부 — 차단/배지 판정의 권위 출처)
// 추가. 클라이언트는 closesAt 를 자기 시계로 비교하지 않고 isClosed 만 신뢰한다(시계 오차 차단 — §5).
// SPEC-MOIM-008: kind("general"|"date") + 옵션별 optionDate(ISO|null — 날짜 투표 선택지의 시각) +
// finalize 결과(finalizedStartsAt/finalizeSkippedReason — close 응답에서만 채워지고 list/vote 에선 null).
export interface PollWithResults {
  id: string;
  question: string;
  createdBy: string;
  createdAt: string;
  multiSelect: boolean;
  // SPEC-MOIM-010: "place"(장소 투표) 추가 — 옵션 label 이 장소명, 마감 시 승자 label → Moim.location.
  kind: "general" | "date" | "place";
  options: { id: string; label: string; voteCount: number; optionDate: string | null }[];
  myVotes: string[];
  closesAt: string | null;
  isClosed: boolean;
  finalizedStartsAt: string | null;
  // SPEC-MOIM-010: 장소 투표 close 시 확정된 장소(승자 label) 또는 null(날짜/일반/동점/무표/vote/list).
  finalizedLocation: string | null;
  finalizeSkippedReason: "tie" | "no_votes" | null;
}

/**
 * 모임의 투표 목록 + 결과를 조회한다(GET /moims/:id/polls). 멤버 한정 — 비멤버는 백엔드가 403(ApiError 전파).
 * 각 poll 은 multiSelect 와 옵션별 voteCount(표 0 포함), 호출자 자신의 myVotes(고른 optionId 목록)를 포함한다.
 */
export async function listPolls(
  api: ApiClient,
  moimId: string,
): Promise<PollWithResults[]> {
  const path = `/moims/${encodeURIComponent(moimId)}/polls`;
  return (await api.request(path as never, "get")) as PollWithResults[];
}

/**
 * 투표를 생성한다(POST /moims/:id/polls). question(필수) + options(유효 ≥2). 생성된 poll(투표 0)을 반환한다.
 * question 빈/유효 옵션<2/비멤버는 백엔드가 400/403 → ApiError 로 전파한다(액션이 일반화 오류로 처리).
 */
export async function createPoll(
  api: ApiClient,
  moimId: string,
  body: CreatePollRequest,
): Promise<PollResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/polls`;
  return (await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as PollResponse;
}

/**
 * 한 선택지에 투표한다(POST /moims/:id/polls/:pollId/vote). 단일 선택은 백엔드가 표를 교체, 다중 선택은 토글
 * (추가/제거)한다 — 요청 형태는 동일({ optionId }), 의미론은 poll.multiSelect 로 백엔드가 분기한다.
 * 갱신된 단건 poll 결과를 반환한다. 잘못된 optionId 400 / 다른 모임 pollId 404 / 비멤버 403 은 ApiError 전파.
 */
export async function votePoll(
  api: ApiClient,
  moimId: string,
  pollId: string,
  optionId: string,
): Promise<PollResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/polls/${encodeURIComponent(
    pollId,
  )}/vote`;
  return (await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optionId }),
  })) as PollResponse;
}

/**
 * 투표를 수동으로 마감한다(POST /moims/:id/polls/:pollId/close, SPEC-MOIM-007 REQ-MOIM7-003). 생성자 전용 —
 * 비생성자 멤버 403 / 비멤버 403 / 다른 모임 pollId 404 는 백엔드가 판정해 ApiError 로 전파한다. body 없음
 * (마감 시각 = 서버 now). 마감된 단건 poll 결과(closesAt=now, isClosed:true)를 반환한다. 이미 마감이면 멱등(200).
 */
export async function closePoll(
  api: ApiClient,
  moimId: string,
  pollId: string,
): Promise<PollResponse> {
  const path = `/moims/${encodeURIComponent(moimId)}/polls/${encodeURIComponent(
    pollId,
  )}/close`;
  return (await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
  })) as PollResponse;
}
