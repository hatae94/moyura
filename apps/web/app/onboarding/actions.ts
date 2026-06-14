// 이름 온보딩 제출 Server Action (SPEC-MOBILE-004 REQ-MOB4-004/005 / AC-1/AC-8).
//
// provider 비종속: 이메일·Google(향후 Apple) 어느 경로로 들어와도 동일하게 Profile.name 을 영속한다.
// 빈 값/백엔드 실패 → 보호 경로 진입을 차단하고 온보딩 페이지에 머무른 채 일반화된 오류를 표시한다(AC-8).
// 성공 → /home 으로 redirect 한다(이후 (main) 가드가 통과).
"use server";

import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** 온보딩 제출 결과 상태(useActionState 로 소비 — 에러 시 폼에 머무른다). */
export type OnboardingActionState = { error?: string } | undefined;

const GENERIC_ERROR = "이름을 저장하지 못했습니다. 다시 시도해 주세요.";

/**
 * 이름을 Profile.name 으로 영속한다. 세션은 쿠키에서 읽어 Bearer 로 백엔드 PATCH /me 에 전달한다.
 * 빈 값(trim 후) → 일반화된 오류 반환(보호 경로 미진입). 백엔드 오류 → 일반화된 오류 반환(자격증명 비노출).
 */
export async function submitNameAction(
  _prev: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    // AC-8: 빈 값 제출 → 머무르며 일반화된 오류 표시(재제출 가능).
    return { error: "이름을 입력해 주세요." };
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // 세션 만료/부재 → 로그인으로 보낸다(보호 경로 미진입).
    redirect("/login");
  }

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    await api.patchMe(name);
  } catch (err) {
    // AC-8: 백엔드 저장 실패 → 머무르며 일반화된 오류 표시(토큰/상세 비노출 — R-A9). 재제출 가능.
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`submitNameAction: PATCH /me 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  // 성공: 이름이 영속되었으므로 /home 으로 진입한다((main) 가드가 통과).
  redirect("/home");
}
