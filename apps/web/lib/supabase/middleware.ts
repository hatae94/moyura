// 세션 갱신 미들웨어 유틸 (@supabase/ssr updateSession 패턴, SPEC-AUTH-001 R-D3).
//
// 미들웨어는 모든 렌더링 전에 실행되어 만료에 근접한 access_token 을 갱신하고, 갱신된 세션을
// 응답 쿠키에 기록한다. 이렇게 해야 Server Component / Route Handler 가 항상 유효한 세션을
// 읽고, 백엔드(NestJS 가드)로 보내는 JWT 가 유효 상태를 유지한다(R-D3/G4).
//
// @supabase/ssr 0.10.3 의 setAll 은 (cookiesToSet, headers) 2-인자다. headers 는 세션 쿠키를
// 설정하는 응답이 CDN/프록시에 캐시되지 않도록 강제하는 Cache-Control 류 헤더이며,
// 반드시 응답에 함께 기록해야 한다(다른 사용자에게 세션이 새는 것을 방지).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_CONFIG } from "@/lib/env";

/**
 * 들어온 요청의 세션을 갱신하고, 갱신 결과를 담은 NextResponse 를 반환한다.
 *
 * [HARD] supabase.auth.getClaims() 를 응답 생성 전에 호출해 토큰 갱신을 트리거하고,
 * 그 결과를 setAll 로 응답 쿠키에 기록해야 한다(@supabase/ssr 권고). 여기서는
 * getUser() 대신 getClaims() 를 쓴다(JWT 클레임 로컬 검증, Auth 서버 왕복 최소화).
 */
export async function updateSession(
  request: NextRequest,
): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_CONFIG.url,
    SUPABASE_CONFIG.anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // 1) 들어온 요청 쿠키에 반영(다운스트림 핸들러가 최신 값을 읽도록).
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          // 2) 응답을 새로 만들어 Set-Cookie 를 기록.
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
          // 3) no-store 류 캐시 헤더를 응답에 강제(세션 쿠키 캐시 방지 — 0.10.3 신규 인자).
          Object.entries(headers).forEach(([key, headerValue]) => {
            supabaseResponse.headers.set(key, headerValue);
          });
        },
      },
    },
  );

  // 토큰 갱신을 트리거한다. 반환값은 사용하지 않지만 호출 자체가 갱신/쿠키 쓰기를 유발한다.
  await supabase.auth.getClaims();

  return supabaseResponse;
}
