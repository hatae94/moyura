// 이메일/비밀번호 + 소셜 인증 Server Actions (SPEC-AUTH-001 group G + R-F2).
//
// Server Action 컨텍스트에서는 쿠키 쓰기가 가능하므로(server.ts 의 setAll 이 동작),
// signInWithPassword / signUp / signOut 호출 후 세션 쿠키가 응답에 기록된다(R-D1/G1/G2/G3/D5).
//
// 범위 제약(R-G6): 이메일 확인/비밀번호 재설정 흐름은 구현하지 않는다.
"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// 소셜 OAuth redirectTo 의 로컬 host 리터럴(site_url host = localhost, http scheme).
const CALLBACK_URL = "http://localhost:3000/auth/callback";

/** 인증 결과 상태(useActionState 등에서 소비). */
export type AuthActionState = { error?: string } | undefined;

// 폼 입력에서 email/password 를 추출한다(공백 trim, 누락 시 빈 문자열).
function readCredentials(formData: FormData): { email: string; password: string } {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

/**
 * 회원가입(R-G1). 로컬 GoTrue(enable_signup=true) 대상으로 계정을 생성한다.
 * 이메일 확인이 꺼져 있으면 즉시 세션이 확립된다(로컬 기본값).
 */
export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력하세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    // 에러 메시지에 자격증명/토큰을 포함하지 않는다(R-A9).
    return { error: error.message };
  }

  redirect("/home");
}

/** 로그인(R-G2). signInWithPassword 로 세션을 확립하고 쿠키에 저장한다(group D). */
export async function signInAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력하세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  redirect("/home");
}

/** 로그아웃(R-G3/R-D5). signOut 으로 세션 쿠키를 제거한다 → 이후 백엔드 호출은 미인증. */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * 소셜 OAuth 진입점 스캐폴드(R-F2). provider 문자열 + 웹 PKCE 콜백 redirectTo 로 signInWithOAuth 호출.
 * provider 키가 미배선이면 GoTrue 가 에러를 반환하므로, 그 경우 로그인 화면으로 복구 redirect 한다(R-F3).
 */
export async function signInWithOAuthAction(formData: FormData): Promise<void> {
  const provider = String(formData.get("provider") ?? "") as
    | "google"
    | "apple"
    | "kakao";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    // 소셜 로그인 성공 후 도착지를 /home 으로 고정한다(콜백이 ?next= 를 읽어 redirect — 비번 로그인과 일관, R-PR3).
    options: { redirectTo: `${CALLBACK_URL}?next=/home` },
  });

  if (error || !data?.url) {
    // 키 미배선/미설정 provider → 복구 가능한 에러 상태(R-F3).
    redirect(`/login?error=oauth_${provider}_unavailable`);
  }

  // 시스템 브라우저/탭에서 provider 인증 페이지로 이동(R-E2 의 웹 측 진입점).
  redirect(data.url);
}
