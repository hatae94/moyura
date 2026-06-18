// 모임 생성 페이지 (Server Component, SPEC-MOIM-004 REQ-MOIM4-005 / AC-4).
//
// app/moims 그룹 하위라 moims/layout.tsx 의 requireNamedSession() 가드를 상속한다(SPEC-WEB-GUARD-001):
//   미인증 → /login, 이름 미보유 → /onboarding. 여기서 다시 호출하는 것은 직접 URL 진입 시 가드 재확인
//   목적이다(idempotent — 쿠키 세션 읽기). 세션 access_token 은 폼이 제출 시 Server Action(createMoimAction)
//   에서 직접 다시 읽으므로(onboarding 패턴) page → form 으로 토큰을 prop 전달하지 않는다.
//
// 모바일에서는 moims/* 가 비-앱-라우트라 in-WebView 로 로드된다(네이티브 라우트 무변경 — SPEC §5).
import { requireNamedSession } from "@/lib/auth/require-named-session";

import { CreateMoimForm } from "./create-moim-form";

export default async function CreateMoimPage() {
  // moims 그룹 가드 상속 + 직접 진입 보호(idempotent). 미충족 시 내부 redirect 로 통과하지 않는다.
  await requireNamedSession();

  return <CreateMoimForm />;
}
