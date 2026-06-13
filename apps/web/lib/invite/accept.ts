// 초대 수락 헬퍼 (SPEC-MOIM-002 REQ-INV-007 / AC-8).
//
// @MX:NOTE: 게스트 가입 = Supabase 익명 로그인(signInAnonymously)로 실제 sub를 받은 뒤, 그 access_token을
// Bearer로 백엔드 POST /invites/:token/accept에 전달하는 흐름이다. 익명 sub도 검증 가능한 JWT라 백엔드
// 가드/RLS/FK가 모두 무수정으로 동작한다(REQ-INV-007 전제). 세션은 쿠키 기반이므로 쿠키 삭제 시 세션이
// 소실되고, 같은 링크로 재방문하면 "새 익명 sub = 새 게스트"가 되어 기존 멤버십과 분리된다(문서화된 제약).
import { ApiError, type ApiClient } from "@moyura/api-client";

// 수락 결과: 가입한 모임 id(웹이 /moims/:id/chat로 리다이렉트하는 데 사용).
export interface AcceptResult {
  moimId: string;
}

// 수락 실패 분류(사용자 메시지 결정용). 토큰 내용은 노출하지 않는다(R-A9 정신).
export type AcceptOutcome =
  | { kind: "ok"; moimId: string }
  | { kind: "error"; status: number; message: string };

// 백엔드 고정 코드 → 한국어 사용자 메시지(미지 404 / 만료·폐기 410 / 초과 409 / 입력 400 / 그 외).
function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "닉네임을 입력해주세요.";
    case 401:
      return "인증에 실패했습니다. 다시 시도해주세요.";
    case 404:
      return "유효하지 않은 초대 링크입니다.";
    case 410:
      return "만료되었거나 폐기된 초대입니다.";
    case 409:
      return "초대 사용 횟수를 초과했습니다.";
    default:
      return "초대 수락 중 오류가 발생했습니다.";
  }
}

/**
 * 초대 수락을 백엔드에 제출한다(REQ-INV-005 / AC-8).
 *
 * api-client는 익명 세션의 access_token을 getToken으로 주입하도록 구성되어 있어야 한다(호출자 책임).
 * 토큰은 Authorization Bearer 헤더로만 전달되며 URL/query에는 싣지 않는다(R-A9).
 *
 * @param api access_token을 Bearer로 주입하는 api-client 인스턴스
 * @param token 초대 토큰(경로 파라미터)
 * @param nickname 모임별 표시 이름
 */
export async function submitAccept(
  api: ApiClient,
  token: string,
  nickname: string,
): Promise<AcceptOutcome> {
  try {
    // api-client.request는 path를 baseUrl 뒤에 그대로 연결하므로(템플릿 치환 없음), 여기서 token을 인코딩해
    // 구체 경로를 만든다. 타입 키(`/invites/{token}/accept`)와 런타임 경로가 달라 캐스팅이 필요하다.
    const concretePath = `/invites/${encodeURIComponent(token)}/accept`;
    const body = (await api.request(concretePath as never, "post", {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname }),
    })) as AcceptResult;
    return { kind: "ok", moimId: body.moimId };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        kind: "error",
        status: err.status,
        message: messageForStatus(err.status),
      };
    }
    return { kind: "error", status: 0, message: messageForStatus(0) };
  }
}
