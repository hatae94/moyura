// @supabase/ssr 서버 클라이언트 (Server Components / Route Handlers / Server Actions, R-D1).
//
// Next 16: cookies() 는 async 함수다(await 필수). @supabase/ssr 0.10.3 의 CookieMethodsServer 는
// getAll/setAll 을 요구하며, setAll 은 (cookiesToSet, headers) 2-인자 시그니처다(0.10.3 신규 —
// 구버전 문서와 다름, 타입 정의로 검증). Server Component 렌더 중에는 쿠키 쓰기가 불가하므로
// setAll 을 try/catch 로 감싸고, 실제 세션 갱신 쓰기는 미들웨어(updateSession)가 담당한다.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { SUPABASE_CONFIG } from "@/lib/env";

/**
 * 요청 스코프 Supabase 서버 클라이언트를 생성한다.
 * [HARD] 요청마다 새로 생성해야 하며 클라이언트를 요청 간 공유하면 안 된다(@supabase/ssr 권고).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Action / Route Handler 에서는 쿠키 쓰기가 가능하다.
        // Server Component 렌더 중에는 쓰기가 불가하므로 try/catch 로 무시하고,
        // 미들웨어(updateSession)가 응답에 Set-Cookie 를 기록하게 위임한다(R-D3).
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Component 컨텍스트 — 무시(미들웨어가 세션 갱신을 처리).
        }
      },
    },
  });
}
