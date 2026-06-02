// Next 16 Proxy — 매 요청 전에 Supabase 세션을 갱신한다(SPEC-AUTH-001 R-D3).
//
// Next 16 부터 미들웨어 파일 컨벤션은 `proxy.ts`(export `proxy`)로 변경되었다(기능 동일,
// `middleware.ts`/export `middleware` 는 deprecated). AGENTS.md 의 "heed deprecation notices"
// 지침에 따라 현재 컨벤션을 사용한다. 정적 자산/이미지/파비콘은 세션 갱신이 불필요하므로 제외한다.
import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // _next 정적/이미지, 파비콘, 일반 이미지 확장자를 제외한 모든 경로에서 세션 갱신.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
