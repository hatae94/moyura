// Next 16 Proxy — 매 요청 전에 Supabase 세션을 갱신한다(SPEC-AUTH-001 R-D3) +
// per-request nonce 기반 Content-Security-Policy 를 적용한다(SPEC-MOBILE-002 R-T8/R-V2 — XSS 표면 축소).
//
// Next 16 부터 미들웨어 파일 컨벤션은 `proxy.ts`(export `proxy`)로 변경되었다(기능 동일,
// `middleware.ts`/export `middleware` 는 deprecated). AGENTS.md 의 "heed deprecation notices"
// 지침에 따라 현재 컨벤션을 사용한다. 정적 자산/이미지/파비콘은 세션 갱신이 불필요하므로 제외한다.
//
// CSP(R-T8 병행 보강): `script-src 'self' 'nonce-...' 'strict-dynamic'`(prod)로 인라인/서드파티
// 스크립트 surface 를 축소해, 브리지 nonce(window.__MOYURA_BRIDGE_NONCE__)를 읽을 수 있는 XSS/공급망
// 표면을 줄인다.
//
// [HARD] Next 공식 nonce 패턴(node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md):
//   Next.js 는 *요청 헤더*의 `Content-Security-Policy` 에서 `'nonce-{value}'` 를 파싱해, 자신의
//   프레임워크/hydration/chunk 스크립트에 그 nonce 를 자동 부여한다. 따라서 CSP 는 응답 헤더(브라우저용)뿐
//   아니라 *요청 헤더에도* 반드시 설정해야 한다. 응답 헤더에만 두면 hydration 스크립트가 nonce 를 못 받아
//   prod 에서 차단되거나(`'unsafe-inline'` 폴백 강제 → nonce 무력화) hydration 이 깨진다(N-1 결함).
//   여기서는 nonce + CSP 문자열을 만들어 updateSession 에 넘기고, updateSession 이 supabase 세션 쿠키를
//   보존한 채 요청 헤더에 CSP/x-nonce 를 주입(NextResponse.next({ request: { headers } }))한다.
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/** Web Crypto 로 per-request CSP nonce(base64)를 생성한다(Edge 런타임 호환, CSPRNG). */
function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * per-request nonce 기반 CSP 정책 문자열을 만든다(R-T8 병행 — XSS 표면 축소).
 *
 * - prod: `script-src 'self' 'nonce-...' 'strict-dynamic'`. `'strict-dynamic'` 은 nonce 로
 *   신뢰된 스크립트가 동적으로 주입하는 후속 스크립트(Next 의 chunk loader 등)까지 신뢰를 전파해,
 *   host 화이트리스트 없이도 프레임워크 코드 스플리팅이 동작하게 한다(Next 공식 권장).
 * - dev: HMR/React eval 디버깅을 위해 `'unsafe-eval' 'unsafe-inline'` 을 추가한다(prod 미적용).
 * - style-src: Tailwind/Next 폰트(next/font)·인라인 스타일 변수가 인라인 <style>/style 속성을 내보내므로
 *   `'unsafe-inline'` 을 유지한다(잔여 caveat — 토큰 exfiltration 벡터로는 약함, 보고서 참조).
 */
/**
 * SPEC-CHAT-001 R-2: Realtime WebSocket(wss://) 연결을 허용할 connect-src 토큰을 만든다.
 *
 * 보안(MEDIUM-SEC): `wss:` 전체 스킴을 열면 임의 wss 호스트로의 연결을 허용해 토큰 exfiltration 표면이
 * 생긴다. NEXT_PUBLIC_SUPABASE_URL이 있으면 그 호스트로 핀(`wss://<host>`)해 Supabase Realtime만 허용한다.
 * URL이 없거나 파싱 불가하면(부팅 가드는 별도 — env.ts) bare `wss:`로 폴백하되, try/catch로 CSP 빌드는
 * 절대 throw하지 않는다(미들웨어 전 요청 차단 방지).
 */
function realtimeWssSource(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) {
    return "wss: ws:";
  }
  try {
    const host = new URL(supabaseUrl).host;
    // 호스트-핀 + 양 스킴: prod(https Supabase)는 wss://, 로컬(http Supabase)은 ws:// 로 realtime 연결한다.
    // http origin 토큰이 ws:// 연결을 허용하지 않으므로(브라우저 실측 — CSP 차단) ws:// 를 명시 추가한다.
    return `wss://${host} ws://${host}`;
  } catch {
    // 파싱 불가(잘못된 URL) — CSP 빌드를 깨뜨리지 않도록 bare wss:/ws:로 안전 폴백.
    return "wss: ws:";
  }
}

/**
 * 클라이언트 측 백엔드 API(NestJS) 호출을 허용할 connect-src origin 을 만든다.
 * 채팅 페이지(Client Component)가 브라우저에서 직접 GET /moims/:id/messages·/members 를 호출하므로
 * connect-src 에 API origin 이 없으면 CSP 가 차단한다. NEXT_PUBLIC_API_BASE_URL 의 origin 으로 핀한다
 * (서버 컴포넌트 fetch 는 CSP 비대상이라 그동안 드러나지 않았다 — 채팅이 첫 클라이언트 측 API 호출).
 */
function apiOriginSource(apiBaseUrl: string | undefined): string {
  if (!apiBaseUrl) {
    return "";
  }
  try {
    return new URL(apiBaseUrl).origin;
  } catch {
    return "";
  }
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval' 'unsafe-inline'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // Supabase Realtime broadcast 구독은 ws(s)://로 연결한다. http(s) origin + 호스트-핀 wss/ws origin 모두 허용한다.
  const wssSource = realtimeWssSource(
    supabaseUrl === "" ? undefined : supabaseUrl,
  );
  // 채팅 등 클라이언트 측 백엔드 API 호출(localhost:3001)을 위한 origin(서버 fetch 는 CSP 비대상).
  const apiSource = apiOriginSource(process.env.NEXT_PUBLIC_API_BASE_URL);
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    // SPEC-CHAT-001 R-2 + MEDIUM-SEC: 호스트-핀 Supabase REST(http(s)) + realtime(wss/ws) + 백엔드 API origin
    // 만 허용한다(open-wss/open-connect 표면 제거). 클라이언트 채팅 fetch + realtime 구독이 통과한다.
    `connect-src 'self' ${wssSource} ${supabaseUrl} ${apiSource}`.trim().replace(/\s+/g, " "),
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  // R-T8/R-V2: per-request nonce + CSP 를 만들어 updateSession 에 넘긴다.
  // updateSession 이 (1) 요청 헤더에 CSP/x-nonce 주입(Next 가 nonce 를 자기 스크립트에 적용),
  // (2) supabase 세션 쿠키 보존, (3) 응답 헤더에 CSP 부착을 모두 수행한다.
  const nonce = generateCspNonce();
  const csp = buildCsp(nonce);
  return updateSession(request, { nonce, csp });
}

export const config = {
  matcher: [
    // _next 정적/이미지, 파비콘, 일반 이미지 확장자를 제외한 모든 경로에서 세션 갱신.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
