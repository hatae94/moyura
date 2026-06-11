// 세션 갱신 미들웨어 유틸 (@supabase/ssr updateSession 패턴, SPEC-AUTH-001 R-D3).
//
// 미들웨어는 모든 렌더링 전에 실행되어 만료에 근접한 access_token 을 갱신하고, 갱신된 세션을
// 응답 쿠키에 기록한다. 이렇게 해야 Server Component / Route Handler 가 항상 유효한 세션을
// 읽고, 백엔드(NestJS 가드)로 보내는 JWT 가 유효 상태를 유지한다(R-D3/G4).
//
// @supabase/ssr 0.10.3 의 setAll 은 (cookiesToSet, headers) 2-인자다. headers 는 세션 쿠키를
// 설정하는 응답이 CDN/프록시에 캐시되지 않도록 강제하는 Cache-Control 류 헤더이며,
// 반드시 응답에 함께 기록해야 한다(다른 사용자에게 세션이 새는 것을 방지).
//
// SPEC-MOBILE-002 R-T8/R-V2 (N-1 수정): CSP nonce 가 Next.js 자기 스크립트에 자동 적용되려면,
// Next 공식 패턴대로 `Content-Security-Policy` 를 *요청 헤더*에 설정해야 한다(Next 가 요청 헤더의
// CSP 에서 `'nonce-...'` 를 파싱). 따라서 요청 헤더에 CSP/x-nonce 를 주입한 동일 옵션(nextOptions)을
// supabase 가 만드는 *모든* NextResponse.next 에 전달하고, 추가로 응답 헤더에도 CSP 를 부착한다.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_CONFIG } from "@/lib/env";

/** per-request CSP 컨텍스트(proxy 가 생성). nonce 와 완성된 CSP 정책 문자열을 함께 전달한다. */
export interface CspContext {
  /** per-request nonce(base64). Next 가 요청 헤더 CSP 에서 파싱해 자기 스크립트에 부여한다. */
  nonce: string;
  /** 완성된 Content-Security-Policy 정책 문자열(`'nonce-...'` 포함). */
  csp: string;
}

/**
 * 들어온 요청의 세션을 갱신하고, 갱신 결과를 담은 NextResponse 를 반환한다.
 *
 * [HARD] supabase.auth.getClaims() 를 응답 생성 전에 호출해 토큰 갱신을 트리거하고,
 * 그 결과를 setAll 로 응답 쿠키에 기록해야 한다(@supabase/ssr 권고). 여기서는
 * getUser() 대신 getClaims() 를 쓴다(JWT 클레임 로컬 검증, Auth 서버 왕복 최소화).
 *
 * [HARD] supabase 세션 쿠키 보존 규칙: setAll 안에서 새 응답을 만들 때 반드시 동일한
 * nextOptions(요청 헤더 보존)로 만들고 cookiesToSet 을 모두 재기록해야 한다. 그렇지 않으면
 * 브라우저-서버 세션이 어긋나 "random logouts"(세션 조기 종료)가 발생한다.
 *
 * [HARD] CSP nonce(N-1 수정): csp 가 주어지면 *요청 헤더*에 `Content-Security-Policy` 와
 * `x-nonce` 를 함께 설정한다. Next App Router 의 프레임워크/hydration/chunk 스크립트가 이 요청 헤더
 * CSP 의 nonce 를 자동으로 부여받는다(Next 공식 nonce 패턴). 응답 헤더의 CSP 는 브라우저 적용용으로
 * 별도로 부착한다(요청·응답 양쪽에 동일 CSP).
 *
 * @param request 들어온 요청
 * @param csp per-request CSP 컨텍스트(proxy 가 생성). 미지정 시 CSP/nonce 주입을 생략한다.
 */
export async function updateSession(
  request: NextRequest,
  csp?: CspContext,
): Promise<NextResponse> {
  // R-T8: 요청 헤더에 CSP/x-nonce 주입(NextResponse.next 가 다운스트림 렌더에 전달 →
  // Next 가 요청 헤더 CSP 의 nonce 를 자기 스크립트에 적용).
  const requestHeaders = new Headers(request.headers);
  if (csp) {
    requestHeaders.set("Content-Security-Policy", csp.csp);
    requestHeaders.set("x-nonce", csp.nonce);
  }
  const nextOptions = { request: { headers: requestHeaders } };
  let supabaseResponse = NextResponse.next(nextOptions);

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
          // 2) 응답을 새로 만들어 Set-Cookie 를 기록(CSP/x-nonce 전파 요청 헤더 유지).
          supabaseResponse = NextResponse.next(nextOptions);
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

  // 응답 헤더에도 CSP 부착(브라우저 적용용). setAll 이 supabaseResponse 를 새로 만들 수 있으므로
  // getClaims() 이후의 최종 supabaseResponse 에 설정해야 누락되지 않는다.
  if (csp) {
    supabaseResponse.headers.set("Content-Security-Policy", csp.csp);
  }

  return supabaseResponse;
}
