// @supabase/ssr 브라우저 클라이언트 (Client Components 전용, SPEC-AUTH-001 R-D1).
//
// 브라우저 컨텍스트에서 세션을 읽고/쓰는 Supabase 클라이언트를 만든다. @supabase/ssr 0.10.3 은
// 브라우저에서 cookies 옵션을 생략하면 document.cookie 폴백으로 자동 처리하므로(타입 정의 확인),
// 여기서는 url/anonKey 만 주입한다. 같은 세션을 createServerClient(server.ts)가 쿠키로 공유한다.
"use client";

import { createBrowserClient } from "@supabase/ssr";

import { SUPABASE_CONFIG } from "@/lib/env";

/** 브라우저용 Supabase 클라이언트를 생성한다(Client Component / 이벤트 핸들러에서 호출). */
export function createClient() {
  return createBrowserClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
}
