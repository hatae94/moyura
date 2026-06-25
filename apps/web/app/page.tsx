// 루트 진입 라우터 (/) — 세션 유무로 앱(/home) 또는 로그인(/login)으로 보낸다.
//
// 앱 셸의 루트는 랜딩/스타터 페이지가 아니라 진입점이다. 모바일 앱 WebView 는 /login·/home 등 구체
// 경로를 직접 로드하므로 / 를 거치지 않지만, 웹 루트 방문과 앱 내 "돌아가기"(예: /invite)가 이 경로로
// 들어온다. 이름 온보딩 가드는 /home 의 requireNamedSession() 가 이어받는다(name 미보유 → /onboarding)
// — 여기서 GET /me 를 중복 호출하지 않는다(책임 분리). getSession()(쿠키) 기반이라 항상 동적 렌더이므로
// 기존 connection() 동적-강제(SPEC-MOBILE-002 R-T8 CSP nonce)도 불필요하다 — 리다이렉트라 스크립트 렌더 자체가 없다.
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export default async function RootEntry() {
  const supabase = await createClient();
  // 쿠키 세션을 읽어 분기한다(신원의 권위 있는 검증은 다운스트림 가드/백엔드가 수행).
  const {
    data: { session },
  } = await supabase.auth.getSession();
  redirect(session ? "/home" : "/login");
}
