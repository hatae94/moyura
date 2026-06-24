// 초대 유효성 조회 헬퍼 (SPEC-MOIM-011 후속 — 로드 시점 무효 검출).
//
// @MX:NOTE: 공개(비인증) 읽기 전용 엔드포인트 GET /invites/:token 을 호출한다 — 멤버십 미생성/뮤테이션 없음.
// 초대 수락 페이지가 "폼을 그릴지 / 무효 처리를 할지"를 로드 시점에 결정하는 데 쓴다. 토큰은 256-bit
// 시크릿이라 열거가 비현실적이며, 응답은 valid/expired/revoked 상태 + moimId 만 노출한다(백엔드 계약).
import { ApiError, type ApiClient } from "@moyura/api-client";

// 유효성 결과: 유효(moimId)면 폼 렌더, 무효(404 미지 / 410 만료·폐기)면 무효 처리 분기.
export type InviteValidity =
  | { kind: "valid"; moimId: string }
  | { kind: "invalid"; status: 404 | 410 };

/**
 * GET /invites/:token 으로 초대 유효성을 조회한다(읽기 전용 공개 엔드포인트).
 *
 * 200 → valid(moimId). 404(미지)/410(만료·폐기) → invalid. 그 외(401/5xx/네트워크 예외)는
 * fail-open 으로 valid 취급한다 — transient 백엔드 오류가 정상 사용자의 수락을 막지 않게 하고, 실제
 * 오류는 제출 경로(submitAccept)의 기존 처리가 표면화한다(R-A9 정신 — 토큰/상세 비노출).
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
    const body = (await api.request(path as never, "get")) as { moimId: string };
    return { kind: "valid", moimId: body.moimId };
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
      return { kind: "invalid", status: err.status };
    }
    // fail-open: 폼을 렌더(제출 시 실제 오류가 표면화). 무효 판정은 명시적 404/410 에만 내린다.
    return { kind: "valid", moimId: "" };
  }
}
