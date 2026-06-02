// /me 페이지 (Server Component, SPEC-AUTH-001 R-D4 / AC-C1 / AC-G5).
//
// 흐름: Supabase 세션에서 access_token 추출 → @moyura/api-client 에 getToken 으로 주입 →
//       백엔드 GET /me 를 Authorization: Bearer 로 호출 → profile 표시.
// 토큰은 헤더로만 전달되며(R-A9) URL/query 에 싣지 않는다. 세션이 없으면 /login 으로 보낸다.
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { signOutAction } from "@/lib/auth/actions";
import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export default async function MePage() {
  const supabase = await createClient();

  // getSession() 은 쿠키에서 세션을 읽는다 — access_token 을 백엔드로 전달하기 위한 용도.
  // (사용자 신원의 권위 있는 검증은 백엔드 가드가 JWKS 로 수행한다.)
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  // R-D4/OD-3: access_token 을 Bearer 로 주입하는 api-client. 토큰은 호출 시점에 공급된다.
  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });

  let body: { id: string; createdAt: string } | null = null;
  let errorMessage: string | null = null;
  try {
    body = await api.getMe();
  } catch (err) {
    // 백엔드 가드가 401 등을 반환하면 ApiError 로 전파된다. 토큰 내용은 노출하지 않는다(R-A9).
    errorMessage =
      err instanceof ApiError
        ? `백엔드 /me 호출 실패 (status ${err.status})`
        : "백엔드 /me 호출 중 알 수 없는 오류";
  }

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">내 프로필 (/me)</h1>

      {body ? (
        <dl className="text-sm">
          <div className="flex gap-2">
            <dt className="font-medium">id (sub):</dt>
            <dd className="font-mono">{body.id}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="font-medium">createdAt:</dt>
            <dd className="font-mono">{body.createdAt}</dd>
          </div>
        </dl>
      ) : (
        <p role="alert" className="text-sm text-red-600">
          {errorMessage}
        </p>
      )}

      <form action={signOutAction}>
        <button type="submit" className="border rounded px-3 py-1">
          로그아웃
        </button>
      </form>
    </main>
  );
}
