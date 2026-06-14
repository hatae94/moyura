// 이름 온보딩 페이지 (Server Component, SPEC-MOBILE-004 REQ-MOB4-004 / AC-1/AC-3).
//
// [HARD] 이 페이지는 (main) 라우트 그룹 밖에 있다 — (main) 가드(requireNamedSession)가 이름 미보유 시
// /onboarding 으로 보내므로, 온보딩 페이지가 (main) 안에 있으면 무한 리다이렉트 루프가 된다. 밖에 둠으로써
// 루프가 구조적으로 불가능하다(온보딩에는 이름 가드가 걸리지 않는다).
//
// 자체 가드(loop-safe): 세션 없음 → /login. 이미 Profile.name 보유 → /home(온보딩 불필요).
// prefill: Google user_metadata.name / given_name 을 입력 필드 기본값으로 제공(확인·수정 가능, REQ-MOB4-004).
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

import { OnboardingForm } from "./onboarding-form";

/** Google user_metadata 에서 prefill 이름을 도출한다(없으면 빈 값 — 입력 강제). */
function resolvePrefillName(metadata: Record<string, unknown> | undefined): string {
  const name = metadata?.["name"];
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  const givenName = metadata?.["given_name"];
  if (typeof givenName === "string" && givenName.trim().length > 0) {
    return givenName.trim();
  }
  return "";
}

export default async function OnboardingPage() {
  const supabase = await createClient();

  const {
    data: { session },
  } = await supabase.auth.getSession();

  // 세션 없음 → 로그인(온보딩은 인증 사용자 전용).
  if (!session) {
    redirect("/login");
  }

  // 이미 이름을 보유했으면 온보딩이 불필요하므로 /home 으로 보낸다(loop-safe: name 보유 시 머무르지 않음).
  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });

  let alreadyNamed = false;
  try {
    const profile = await api.getMe();
    alreadyNamed = Boolean(profile.name && profile.name.trim().length > 0);
  } catch (err) {
    // 백엔드 401 → 미인증으로 간주해 로그인으로 보낸다(토큰 비노출 — R-A9). 그 외 오류는 온보딩 유지.
    if (err instanceof ApiError && err.status === 401) {
      redirect("/login");
    }
  }

  if (alreadyNamed) {
    redirect("/home");
  }

  const prefillName = resolvePrefillName(
    session.user.user_metadata as Record<string, unknown> | undefined,
  );

  return <OnboardingForm prefillName={prefillName} />;
}
