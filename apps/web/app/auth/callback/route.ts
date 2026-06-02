// PKCE 콜백 Route Handler (SPEC-AUTH-001 R-D2 / R-D2a / OD-5, AC-D2 / AC-D6 / AC-D7).
//
// 소셜 OAuth(또는 매직링크 등 PKCE 흐름)가 ?code= 로 복귀하는 진입점이다.
// 로컬 host 리터럴은 site_url host 와 일치하는 http://127.0.0.1:3000/auth/callback 이어야 한다(M-4).
//
// 정상 경로: 유효 code + error 없음 → exchangeCodeForSession(code) 로 세션 확립 + 쿠키 설정 → 앱 redirect.
// 음성 경로(R-D2a/M-6): error param / 누락·빈 code / state·verifier 불일치(교환 실패)
//   → 세션 미확립, 쿠키 미설정, /login?error=... 로 복구 가능한 redirect.
import { NextResponse, type NextRequest } from "next/server";

import { resolveCallbackOutcome } from "@/lib/auth/callback";
import { createClient } from "@/lib/supabase/server";

// 콜백 후 이동할 안전한 내부 경로만 허용한다(open-redirect 방지). 외부/프로토콜-상대 경로는 거부.
function safeNextPath(raw: string | null): string {
  if (!raw) {
    return "/";
  }
  // 반드시 "/" 로 시작하고 "//" (프로토콜-상대) 가 아니어야 한다.
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const outcome = resolveCallbackOutcome(url.searchParams);
  const nextPath = safeNextPath(url.searchParams.get("next"));

  // 음성 경로: error param / 누락·빈 code → 세션 미확립, 로그인 화면으로 복구 redirect(R-D2a).
  if (outcome.kind === "error") {
    const redirect = new URL("/login", url.origin);
    redirect.searchParams.set("error", outcome.reason);
    return NextResponse.redirect(redirect);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(outcome.code);

  if (error) {
    // state/PKCE verifier 불일치 등 교환 실패 → 세션 미확립, 쿠키 미설정(R-D2a/AC-D7).
    // 토큰/코드 내용을 노출하지 않도록 일반화된 사유만 전달한다(R-A9).
    const redirect = new URL("/login", url.origin);
    redirect.searchParams.set("error", "exchange_failed");
    return NextResponse.redirect(redirect);
  }

  // 정상 경로: 세션 쿠키가 설정된 상태로 앱 내부 경로로 redirect(R-D2/AC-D2).
  return NextResponse.redirect(new URL(nextPath, url.origin));
}
