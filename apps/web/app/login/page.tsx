// 로그인/회원가입 페이지 (Server Component, SPEC-AUTH-001 group G + F2 scaffold).
//
// 콜백 음성 경로(R-D2a)나 OAuth 미배선(R-F3)에서 ?error= 로 복귀하면 여기서 메시지를 표시한다.
import { signInWithOAuthAction } from "@/lib/auth/actions";

import { LoginForm } from "./login-form";

// Next 16: searchParams 는 Promise 다(await 필수).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">moyura 로그인</h1>

      <LoginForm initialError={error} />

      {/* 소셜 OAuth 진입점 스캐폴드(R-F2). 로컬에는 provider 키가 없으므로 호출 시
          복구 가능한 에러로 돌아온다(R-F3) — flow + 진입점 배선만 증명한다. */}
      <div className="flex flex-col gap-2 w-full max-w-sm">
        <p className="text-xs text-zinc-500">소셜 로그인 (키 미배선 — 스캐폴드)</p>
        <div className="flex gap-2">
          {(["google", "apple", "kakao"] as const).map((provider) => (
            <form key={provider} action={signInWithOAuthAction}>
              <input type="hidden" name="provider" value={provider} />
              <button
                type="submit"
                className="border rounded px-3 py-1 text-sm capitalize"
              >
                {provider}
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
