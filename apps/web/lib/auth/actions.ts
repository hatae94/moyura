// 이메일/비밀번호 + 소셜 인증 Server Actions (SPEC-AUTH-001 group G + R-F2).
//
// Server Action 컨텍스트에서는 쿠키 쓰기가 가능하므로(server.ts 의 setAll 이 동작),
// signInWithPassword / signUp / signOut 호출 후 세션 쿠키가 응답에 기록된다(R-D1/G1/G2/G3/D5).
//
// 이메일 회원가입 검증: enable_confirmations=true 환경에서 signUp 은 세션 대신 6자리 코드 메일을 보낸다.
// signUpAction 이 "확인 필요"를 신호하면 UI 가 코드 입력 화면으로 전환하고, verifyEmailOtpAction 이
// verifyOtp 로 코드를 검증해 세션을 확립한다. (비밀번호 재설정 흐름은 여전히 범위 밖 — R-G6.)
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

// 소셜 OAuth redirectTo 는 요청 origin 에서 동적 구성한다(local/prod 공통 — 하드코딩 금지).
// Vercel 등 리버스 프록시 뒤에서는 x-forwarded-host / x-forwarded-proto 가 실제 외부 호스트·스킴을 담는다.
// 결과 URL 은 Supabase Redirect URLs 허용목록과 정확히 일치해야 한다(local: http://localhost:3000/auth/callback,
// prod: https://<web-domain>/auth/callback) — 불일치 시 GoTrue 가 Site URL 로 폴백해 ?code= 가 "/" 로 떨어진다.
async function resolveCallbackUrl(): Promise<string> {
  const h = await headers();
  const rawHost = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const host = (rawHost.split(",")[0] ?? rawHost).trim();
  const isLocal = host.startsWith("localhost") || host.startsWith("127.");
  const rawProto = h.get("x-forwarded-proto") ?? (isLocal ? "http" : "https");
  const proto = (rawProto.split(",")[0] ?? rawProto).trim();
  return `${proto}://${host}/auth/callback`;
}

/**
 * 인증 결과 상태(useActionState 등에서 소비).
 * - error: 사용자에게 보일 오류 메시지.
 * - needsConfirmation: 이메일 확인(6자리 코드) 대기 — UI 가 코드 입력 화면으로 전환한다.
 * - email: 코드 입력·재전송에 필요한 대상 이메일(needsConfirmation 동반).
 */
export type AuthActionState =
  | { error?: string; needsConfirmation?: boolean; email?: string }
  | undefined;

// user_metadata.name 을 안전하게 추출한다(any 회피 — no-unsafe). 문자열이 아니면 빈 값.
function metaName(user: { user_metadata?: unknown } | null | undefined): string {
  const meta = user?.user_metadata as { name?: unknown } | undefined;
  return typeof meta?.name === "string" ? meta.name.trim() : "";
}

// 세션 access_token 으로 Profile.name 을 백엔드에 영속한다(provider 비종속 PATCH /me). 실패는 삼키되 로그.
async function persistName(accessToken: string, name: string): Promise<void> {
  if (!name) {
    return;
  }
  try {
    const api = createApiClient({ baseUrl: API_BASE_URL, getToken: () => accessToken });
    await api.patchMe(name);
  } catch {
    // 이름 미영속 시 (main) 가드가 온보딩으로 리다이렉트한다(AC-1/AC-3 안전망 — 단일 출처는 Profile.name).
    console.error("auth: Profile.name 영속 실패(온보딩 가드가 보강)");
  }
}

// 폼 입력에서 email/password 를 추출한다(공백 trim, 누락 시 빈 문자열).
function readCredentials(formData: FormData): { email: string; password: string } {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

/**
 * 회원가입(R-G1 + SPEC-MOBILE-004 REQ-MOB4-003 / AC-4).
 * 로컬 GoTrue(enable_signup=true) 대상으로 계정을 생성한다. 이메일 확인이 꺼져 있으면 즉시 세션이 확립된다.
 *
 * 이름 영속(OD-2, provider 비종속 단일 경로):
 *  1) signUp options.data.name 으로 user_metadata 에 이름을 심는다(/home 표시·온보딩 prefill 용).
 *  2) 세션 확립 후 백엔드 PATCH /me 로 Profile.name 을 영속한다 — 온보딩 가드의 권위 있는 출처.
 * PATCH 가 실패해도 가입 자체는 성립하므로 /home 으로 보내고, 이름 미영속이면 (main) 가드가
 * 온보딩으로 리다이렉트한다(AC-1/AC-3 와 동일 안전망 — 단일 진실 출처는 Profile.name).
 */
export async function signUpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const { email, password } = readCredentials(formData);
  const name = String(formData.get("name") ?? "").trim();
  if (!email || !password) {
    return { error: "이메일과 비밀번호를 입력하세요." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // OD-2: user_metadata 에 이름을 심어 /home 표시·온보딩 prefill 에 재사용한다(이메일·소셜 통합).
    options: name ? { data: { name } } : undefined,
  });
  if (error) {
    // 에러 메시지에 자격증명/토큰을 포함하지 않는다(R-A9).
    return { error: error.message };
  }

  // 확인(enable_confirmations) ON: signUp 은 세션을 주지 않고 6자리 코드 메일을 보낸다 → 코드 입력 화면으로 전환.
  // 이미 가입된 이메일이면 GoTrue 가 열거 방지용으로 세션 없는 응답을 주므로, 동일하게 안내한다(계정 존재 비노출).
  if (!data.session) {
    return { needsConfirmation: true, email };
  }

  // 확인 OFF 환경(예: 프로덕션 대시보드 미토글): 즉시 세션 확립 → 이름 영속 후 /home(기존 경로 보존).
  await persistName(data.session.access_token, name);
  redirect("/home");
}

/**
 * 이메일 확인 코드(6자리 OTP) 검증(R-G1 후속). verifyOtp(type:"signup")로 코드를 확인해 세션을 확립한다.
 * 성공 시 user_metadata.name 을 Profile.name 으로 영속하고 /home 으로 보낸다. 실패(불일치·만료)는
 * 코드 화면을 유지하도록 needsConfirmation+email 을 되돌려준다.
 */
export async function verifyEmailOtpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("code") ?? "").replace(/\s/g, "");
  if (!email) {
    return { error: "이메일 정보가 없어요. 처음부터 다시 시도해 주세요." };
  }
  if (!/^\d{6}$/.test(token)) {
    return { error: "6자리 숫자 코드를 입력하세요.", needsConfirmation: true, email };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "signup",
  });
  if (error) {
    // 코드 불일치/만료 → 코드 화면 유지(자격증명/토큰 비노출 — R-A9).
    return {
      error: "인증 코드가 올바르지 않거나 만료되었어요. 다시 확인해 주세요.",
      needsConfirmation: true,
      email,
    };
  }

  // 확인 성공 → 세션 확립. signUp 때 심은 user_metadata.name 을 Profile.name 으로 영속한다.
  if (data.session) {
    await persistName(data.session.access_token, metaName(data.user));
  }
  redirect("/home");
}

/**
 * 이메일 확인 코드 재전송. resend(type:"signup")로 6자리 코드를 다시 보낸다.
 * 성공/실패 모두 코드 화면을 유지한다(needsConfirmation+email). 레이트리밋(email_sent)에 걸리면 에러 안내.
 */
export async function resendEmailOtpAction(
  _prev: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "이메일 정보가 없어요. 처음부터 다시 시도해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) {
    return {
      error: "코드 재전송에 실패했어요. 잠시 후 다시 시도해 주세요.",
      needsConfirmation: true,
      email,
    };
  }
  return { needsConfirmation: true, email };
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

  const callbackUrl = await resolveCallbackUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    // 소셜 로그인 성공 후 도착지를 /home 으로 고정한다(콜백이 ?next= 를 읽어 redirect — 비번 로그인과 일관, R-PR3).
    options: { redirectTo: `${callbackUrl}?next=/home` },
  });

  if (error || !data?.url) {
    // 키 미배선/미설정 provider → 복구 가능한 에러 상태(R-F3).
    redirect(`/login?error=oauth_${provider}_unavailable`);
  }

  // 시스템 브라우저/탭에서 provider 인증 페이지로 이동(R-E2 의 웹 측 진입점).
  redirect(data.url);
}
