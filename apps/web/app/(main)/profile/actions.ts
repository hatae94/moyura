// 마이 페이지 — 개인정보(표시 이름) 수정 Server Action (SPEC-PROFILE-001).
//
// 기존 PATCH /me(UpdateNameDto, SPEC-MOBILE-004)를 재사용한다 — 백엔드 무변경. 세션은 쿠키에서 읽어
// Bearer 로 전달한다(R-A9 — 토큰/오류 상세 비노출). 빈 값/백엔드 실패 → 페이지에 머무르며 일반화된 오류.
// 성공 → revalidatePath 로 서버 컴포넌트 재렌더 + ok 상태 반환(머무르며 "저장됨" 피드백, onboarding 과 달리
// redirect 하지 않음 — 설정 페이지는 같은 화면 유지).
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** 프로필 수정 결과 상태(useActionState 로 소비 — 성공 시 ok, 실패 시 error 로 폼에 머무른다). */
export type ProfileActionState = { ok?: boolean; error?: string } | undefined;

/** 회원 탈퇴 결과 상태(useActionState 로 소비 — 성공 시 redirect 하므로 실패 error 만 표현한다). */
export type DeleteAccountState = { error?: string } | undefined;

const GENERIC_ERROR = "프로필을 저장하지 못했습니다. 다시 시도해 주세요.";

const DELETE_ACCOUNT_ERROR = "탈퇴 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.";

/**
 * 표시 이름을 Profile.name 으로 영속한다. 세션 부재 → /login. 빈 값 → 일반화된 오류(머무름).
 * 백엔드 오류 → 일반화된 오류(자격증명 비노출). 성공 → /profile revalidate + { ok: true }.
 */
export async function updateProfileAction(
  _prev: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) {
    return { error: "이름을 입력해 주세요." };
  }

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    await api.patchMe(name);
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`updateProfileAction: PATCH /me 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * 회원 탈퇴(SPEC-ACCOUNT-001 T-09 / REQ-ACCOUNT-004). 확인 단계(account-deletion.tsx)를 거친 뒤에만 호출된다.
 * 세션 부재 → /login. 세션 access_token 을 Bearer 로 DELETE /me/account 를 호출한다(삭제 대상은 백엔드 가드가
 * 검증 sub 로만 강제 — body 없음). 성공(204) → 로그아웃 경로 재사용(supabase.auth.signOut() + /login redirect):
 * 웹은 쿠키 세션이 제거되고, 모바일 WebView 는 기존 session:cleared 브리지가 SecureStore/쿠키를 정리한다.
 * 실패 → 자격증명·상태 비노출 일반화 오류(R-A9 — 폼에 머무르며 재시도 안내).
 */
export async function deleteAccountAction(): Promise<DeleteAccountState> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    // DELETE /me/account — 성공 시 본문 없는 204. 삭제 키는 백엔드 가드-검증 sub 만 사용(body 미전송).
    await api.request("/me/account", "delete");
  } catch (err) {
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`deleteAccountAction: DELETE /me/account 실패 (status ${status})`);
    return { error: DELETE_ACCOUNT_ERROR };
  }

  // 성공 → 로그아웃 경로 재사용(signOutAction 미러): 세션 쿠키 제거 후 /login.
  await supabase.auth.signOut();
  redirect("/login");
}
