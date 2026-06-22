// 모임 초대 발급 헬퍼 (SPEC-MOIM-011 REQ-MOIM11-002).
//
// 초대 라우트는 path 파라미터(`/moims/:moimId/invites`)가 있어 api-client 의 리터럴-경로 편의 메서드에
// 넣지 않고, lib/moim/polls.ts 의 구체-경로 헬퍼 패턴을 그대로 미러한다(moimId 인코딩 + request(path as never)).
// 백엔드 무변경 — POST /moims/:moimId/invites(owner 전용, REQ-INV-001)는 이미 존재한다.
import { type ApiClient } from "@moyura/api-client";

// 백엔드 InviteResponseDto 미러(owner 전용 응답 — token 은 가입 자격증명). 발급 UI 는 token + expiresAt 만 쓴다.
export interface InviteResult {
  id: string;
  moimId: string;
  token: string;
  expiresAt: string;
  maxUses: number | null;
  usedCount: number;
}

/**
 * 모임 초대를 발급한다(POST /moims/:moimId/invites). owner 전용 — 비-owner 는 백엔드가 403(ApiError 전파).
 * body 는 생략 가능(expiresAt/maxUses 미지정 → 백엔드 기본값: +7일 만료·무제한). 발급된 토큰을 포함한 초대를 반환한다.
 */
export async function createInvite(
  api: ApiClient,
  moimId: string,
): Promise<InviteResult> {
  const path = `/moims/${encodeURIComponent(moimId)}/invites`;
  return (await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  })) as InviteResult;
}
