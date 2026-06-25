// 초대 유효성 조회 헬퍼 (SPEC-MOIM-011 후속 — 로드 시점 무효 검출).
//
// @MX:NOTE: 공개(비인증) 읽기 전용 엔드포인트 GET /invites/:token 을 호출한다 — 멤버십 미생성/뮤테이션 없음.
// 초대 수락 페이지가 "폼을 그릴지 / 무효 처리를 할지"를 로드 시점에 결정하는 데 쓴다. 토큰은 256-bit
// 시크릿이라 열거가 비현실적이며, 응답은 valid/expired/revoked 상태 + 모임 미리보기(moimId/name/멤버 수/정원)만
// 노출한다(백엔드 InviteValidityDto 계약).
import { ApiError, type ApiClient } from "@moyura/api-client";

// 유효성 결과: 유효면 폼 렌더 + 모임 미리보기(통합 진입 페이지가 name/멤버 수/정원으로 어떤 모임에 참여하는지
// 안내), 무효(미확인 포함)면 무효 처리 분기. status 는 진단용(404/410 또는 ApiError 면 그 코드,
// 네트워크/백엔드 다운 등 비-ApiError 면 0).
//
// 하위 호환: invite/[token]/page.tsx 는 valid 에서 moimId 만 읽으므로(미리보기 필드는 무시) 추가 필드는
// 비파괴적이다. 통합 진입 페이지(app/invite/page.tsx)가 name/memberCount/maxMembers 를 미리보기 카드에 쓴다.
export type InviteValidity =
  | {
      kind: "valid";
      moimId: string;
      name: string;
      memberCount: number;
      maxMembers: number;
    }
  | { kind: "invalid"; status: number };

/**
 * GET /invites/:token 으로 초대 유효성을 조회한다(읽기 전용 공개 엔드포인트).
 *
 * 200 → valid(moimId). 그 외 모든 경우(404 미지 / 410 만료·폐기 / 401 / 5xx / 네트워크 / 백엔드 다운)는
 * **fail-closed** 로 invalid 처리한다 — 닉네임 입력 폼(InviteAcceptForm)은 유효가 200 으로 확정된 초대에만
 * 노출하고, 확인할 수 없는 초대로 가입 폼에 진입시키지 않는다(무효 안내 alert 로 분기). 백엔드 일시 다운
 * 등 transient 오류 시에도 유효 초대가 잠깐 무효로 보일 수 있으나, 그 상황은 가입 자체가 불가하므로
 * 닉네임 폼을 띄워 헛수고시키는 것보다 안전하다. 토큰/상세는 노출하지 않는다(R-A9 정신).
 *
 * @param api baseUrl 로 구성된 api-client(공개 엔드포인트라 토큰 불필요 — 있어도 무해).
 * @param token 초대 토큰(경로 파라미터).
 */
export async function fetchInviteValidity(
  api: ApiClient,
  token: string,
): Promise<InviteValidity> {
  try {
    const path = `/invites/${encodeURIComponent(token)}`;
    const body = (await api.request(path as never, "get")) as {
      moimId: string;
      name: string;
      memberCount: number;
      maxMembers: number;
    };
    return {
      kind: "valid",
      moimId: body.moimId,
      name: body.name,
      memberCount: body.memberCount,
      maxMembers: body.maxMembers,
    };
  } catch (err) {
    // fail-closed: 200 으로 유효를 확정하지 못하면 무효로 처리한다(닉네임 폼은 확정된 초대에만).
    const status = err instanceof ApiError ? err.status : 0;
    return { kind: "invalid", status };
  }
}
