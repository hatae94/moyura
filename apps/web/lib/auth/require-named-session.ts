// 이름 온보딩 가드 — 보호 경로 진입 전 (1) 세션 + (2) Profile.name 보유를 함께 강제한다
// (SPEC-MOBILE-004 REQ-MOB4-004 / AC-1/AC-3/AC-7).
//
// 단일 진실 출처: Profile.name(백엔드 GET /me) — created_at 비의존, provider 비종속.
//   - 세션 없음           → /login (기존 가드와 동일)
//   - 세션 있음 + name 없음 → /onboarding (온보딩 페이지는 (main) 밖이라 가드 루프가 없다)
//   - 세션 있음 + name 있음 → 통과, { session, profile } 반환
//
// (main)/layout.tsx 와 me/page.tsx 가 공유한다. 데스크톱 웹도 server-side 가드라 자동 커버된다(AC-7).
import { redirect } from "next/navigation";

import { ApiError, createApiClient, type ProfileResponse } from "@moyura/api-client";
import type { Session } from "@supabase/supabase-js";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export interface NamedSession {
  /** 쿠키에서 읽은 Supabase 세션(access_token 보유 — 다운스트림이 재사용). */
  session: Session;
  /** name 이 보장된 백엔드 profile(GET /me). */
  profile: ProfileResponse;
}

/**
 * 세션 + Profile.name 을 함께 강제하는 서버 가드. 미충족 시 적절한 경로로 redirect 하여 반환하지 않는다.
 * redirect()는 내부적으로 throw 하므로 호출부는 반환값이 항상 NamedSession 임을 신뢰할 수 있다.
 */
export async function requireNamedSession(): Promise<NamedSession> {
  const supabase = await createClient();

  // getSession() 은 쿠키에서 세션을 읽는다(/me·(main) 와 동일 가드 패턴).
  // (신원의 권위 있는 검증은 백엔드 가드가 JWKS 로 수행한다.)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  // 백엔드 GET /me 로 Profile.name 보유 여부를 확인한다(권위 있는 출처). 토큰은 Bearer 헤더로만 전달.
  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });

  let profile: ProfileResponse;
  try {
    profile = await api.getMe();
  } catch (err) {
    // 백엔드 401/오류는 미인증으로 간주해 /login 으로 보낸다(토큰 내용 비노출 — R-A9).
    if (err instanceof ApiError && err.status === 401) {
      redirect("/login");
    }
    // 그 외 오류도 보호 경로 진입을 차단한다(가드 fail-closed).
    redirect("/login");
  }

  // 이름 미보유(null/빈 값) → 온보딩으로 강제 리다이렉트(REQ-MOB4-004).
  if (!profile.name || profile.name.trim().length === 0) {
    redirect("/onboarding");
  }

  return { session, profile };
}
