// 멤버 강퇴·방장 위임 API 헬퍼 (SPEC-MOIM-012).
//
// invites.ts 의 구체-경로 패턴을 미러한다(moimId/userId 인코딩 + request(path as never)).
// api-client.request 는 path 를 baseUrl 뒤에 그대로 연결하므로(템플릿 치환 없음) 여기서 경로를 완성한다.
import { type ApiClient } from "@moyura/api-client";

/**
 * 멤버를 강퇴한다(DELETE /moims/:moimId/members/:userId). owner 전용.
 * - 비-owner 호출 / target 이 owner 인 경우 → 백엔드 403(ApiError 전파).
 * - target 이 멤버가 아닌 경우 → 404.
 * - 성공 시 204(응답 바디 없음).
 */
export async function kickMember(
  api: ApiClient,
  moimId: string,
  userId: string,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/members/${encodeURIComponent(userId)}`;
  await api.request(path as never, "delete");
}

/**
 * 방장 권한을 위임한다(POST /moims/:moimId/owner). 현재 owner 전용.
 * - 비-owner 호출 → 403. 자기 자신 또는 빈 userId → 400. target 이 멤버가 아닌 경우 → 404.
 * - 성공 시 204. 효과: 호출자 role=owner→member, target role=member→owner (Moim.createdBy 불변).
 */
export async function transferOwner(
  api: ApiClient,
  moimId: string,
  userId: string,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}/owner`;
  await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
}

/**
 * 모임 최대 인원(정원)을 수정한다(PATCH /moims/:moimId). owner 전용.
 * - 비-owner 호출 → 403. maxMembers < 1 또는 현재 멤버 수보다 작은 값 → 400. 모임 미존재 → 404.
 * - 성공 시 업데이트된 MoimResponseDto 를 반환한다(사용하지 않으므로 void).
 */
export async function updateMaxMembers(
  api: ApiClient,
  moimId: string,
  maxMembers: number,
): Promise<void> {
  const path = `/moims/${encodeURIComponent(moimId)}`;
  await api.request(path as never, "patch", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ maxMembers }),
  });
}
