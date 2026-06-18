// 모임 상세/멤버 조회 헬퍼 (SPEC-MOIM-003 REQ-MOIM3-002/006).
//
// api-client.request 는 path 를 baseUrl 뒤에 그대로 연결하므로(템플릿 치환 없음 — verified), 여기서
// moimId 를 인코딩해 구체 경로를 만든다(chat/api.ts 와 동일 패턴). 타입 키와 런타임 경로가 달라 캐스팅이
// 필요하다. 목록(GET /moims)은 api-client 의 listMoims() 편의 메서드를 쓴다 — 여기는 path 파라미터가 있는
// 상세/멤버 조회만 담는다. chat 모듈 의존을 피해 독립 헬퍼로 둔다(상세는 chat realtime 비의존 — Exclusions).
import { ApiError, type ApiClient } from "@moyura/api-client";

// 백엔드 MoimResponseDto — 현재 모델은 { id, name, createdBy, createdAt } 뿐이다(스키마 확장 없음 — Exclusions).
export interface MoimDetail {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

// 멤버 목록 항목(MemberResponseDto) — nickname + role(owner/member) 표시에 쓴다.
export interface MoimMember {
  userId: string;
  nickname: string;
  role: string;
  joinedAt: string;
}

/**
 * 모임 상세를 조회한다(GET /moims/:id). 비멤버는 백엔드가 403, 미존재는 404 를 반환하며 ApiError 로 전파한다
 * (인가를 약화시키지 않는다 — REQ-MOIM3-005). 호출부가 status 로 안전 처리(notFound/안내)한다.
 */
export async function getMoim(api: ApiClient, moimId: string): Promise<MoimDetail> {
  const path = `/moims/${encodeURIComponent(moimId)}`;
  return (await api.request(path as never, "get")) as MoimDetail;
}

/**
 * 모임 멤버 목록을 조회한다(GET /moims/:id/members). 멤버 nickname + role 출처.
 * 비멤버/미존재는 getMoim 과 동일하게 백엔드 인가가 ApiError(403/404)로 전파한다.
 */
export async function getMoimMembers(
  api: ApiClient,
  moimId: string,
): Promise<MoimMember[]> {
  const path = `/moims/${encodeURIComponent(moimId)}/members`;
  return (await api.request(path as never, "get")) as MoimMember[];
}

/** 모임 상세 조회 실패를 status 로 분류한다(403 비멤버 / 404 미존재 분기 — 토큰/오류 상세 비노출, REQ-MOIM3-005). */
export function moimErrorStatus(err: unknown): number {
  return err instanceof ApiError ? err.status : 0;
}
