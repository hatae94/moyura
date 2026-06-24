// 게스트 초대 랜딩 페이지 (Server Component, SPEC-MOIM-002 / SPEC-MOIM-011).
//
// @MX:NOTE: 공개 랜딩 — 인증 가드 없음(미인증 게스트도 진입). 서버에서 쿠키 세션을 선택적으로 읽어
// 이미 가입된 회원이면 Profile.name(백엔드 GET /me)을 폼 초기 닉네임으로 내려 prefill 한다. 세션이 없거나
// (게스트), 이름이 없거나(익명 sub), GET /me 가 실패하면 빈 값으로 폴백한다 — 가드/리다이렉트는 하지
// 않는다(공개 랜딩이라 게스트 진입을 막으면 안 됨). 실제 수락 흐름(익명 로그인 → 닉네임 → POST
// /invites/:token/accept → /moims/:id/chat)과 모바일 딥링크 자동 열기는 클라이언트 폼(InviteAcceptForm)이 담당한다.
import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { fetchInviteValidity } from "@/lib/invite/validity";

import { InviteAcceptForm } from "./invite-accept-form";
import { InviteInvalidHandler } from "./invite-invalid-handler";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // 세션을 best-effort 로 읽는다(실패 시 null). 실제 계정 여부(is_anonymous 아님)는 무효 분기와 prefill 에
  // 함께 쓰고, 세션 자체는 prefill 용 GET /me 의 Bearer 로 쓴다. 공개 랜딩이라 가드/리다이렉트는 하지 않는다.
  const session = await (async () => {
    try {
      const supabase = await createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return session;
    } catch {
      return null;
    }
  })();
  // SPEC-MOIM-011 후속: 실제 계정 세션만 "로그인"으로 본다 — 익명(게스트) 세션은 false(무효 시 로그인 페이지로).
  const loggedIn = !!session && session.user?.is_anonymous !== true;

  // SPEC-MOIM-011 후속: 로드 시점 유효성 검사(공개 GET /invites/:token). 무효(404 미지 / 410 만료·폐기)면
  // 폼 대신 무효 처리 컴포넌트를 렌더한다 — 앱이면 네이티브 Alert + 라우팅, 데스크톱이면 웹 모달 + 라우팅.
  const validity = await fetchInviteValidity(
    createApiClient({ baseUrl: API_BASE_URL }),
    token,
  );
  if (validity.kind === "invalid") {
    return <InviteInvalidHandler loggedIn={loggedIn} />;
  }

  // SPEC-MOIM-011: 유효한 초대 — 이미 가입된 회원이면 기존 닉네임(Profile.name)을 best-effort prefill 한다.
  let initialNickname = "";
  if (session) {
    try {
      const api = createApiClient({
        baseUrl: API_BASE_URL,
        getToken: () => session.access_token,
      });
      const profile = await api.getMe();
      initialNickname = profile.name?.trim() ?? "";
    } catch (err) {
      // 게스트/익명(401)·네트워크 등은 prefill 없이 진행한다(토큰/오류 상세 비노출 — R-A9).
      // 예상 밖 오류만 일반 메시지로 로깅하고 빈 값으로 폴백한다(에러를 조용히 삼키지 않음).
      if (!(err instanceof ApiError)) {
        console.error("invite prefill: failed to load profile name (fallback to empty)");
      }
      initialNickname = "";
    }
  }

  return <InviteAcceptForm token={token} initialNickname={initialNickname} />;
}
