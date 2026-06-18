// 모임 투표(poll) 조회/생성/투표 헬퍼 (SPEC-MOIM-005 REQ-MOIM5-005).
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

// 백엔드 PollResponseDto 미러 — 각 옵션의 voteCount(표 0 포함) + 호출자 myVote(optionId/null).
export interface PollWithResults {
  id: string;
  question: string;
  createdBy: string;
  createdAt: string;
  options: { id: string; label: string; voteCount: number }[];
  myVote: string | null;
}

/**
 * 모임의 투표 목록 + 결과를 조회한다(GET /moims/:id/polls). 멤버 한정 — 비멤버는 백엔드가 403(ApiError 전파).
 * 각 poll 은 옵션별 voteCount(표 0 포함)와 호출자 자신의 myVote(optionId 또는 null)를 포함한다.
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
 * 한 투표에 투표한다(POST /moims/:id/polls/:pollId/vote). 단일 선택 — 재투표 시 백엔드가 표를 교체(upsert).
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
