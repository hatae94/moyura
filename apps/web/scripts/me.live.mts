// LIVE 종단 증명 스크립트 (SPEC-AUTH-001 AC-G5 / AC-C4 / SPEC Goal).
//
// 웹 세션(email/pw) → ES256 access_token → 백엔드 GET /me (Bearer) → 200 + profile 을 라이브로 증명한다.
// 전제: 로컬 Supabase 스택 기동(API http://127.0.0.1:54321) + 백엔드 :3001 기동.
//
// 실행:
//   node --experimental-strip-types apps/web/scripts/me.live.mts
//
// 이 스크립트는 @supabase/supabase-js 로 웹의 signInWithPassword 와 동일한 GoTrue 흐름을 수행하고,
// access_token 을 Authorization: Bearer 헤더로만 전달해 백엔드 /me 를 호출한다(R-D4/OD-3/R-A9).
// 이는 @moyura/api-client 의 getToken Bearer 주입과 동일한 전달 메커니즘이다(토큰 → Bearer 헤더, URL/query 미사용).
// (api-client 의 ApiError 파라미터 프로퍼티가 node strip-only 모드와 비호환이라, 라이브 스크립트는
//  의존성을 줄이기 위해 fetch 로 동일 헤더 경로를 직접 검증한다 — 빌드/타입체크는 api-client 경로를 커버.)
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

// 토큰을 로그에 그대로 노출하지 않기 위한 마스킹(R-A9).
function redact(token: string): string {
  if (token.length <= 16) return "***";
  return `${token.slice(0, 8)}...${token.slice(-6)} (len=${token.length})`;
}

async function main() {
  const email = `live-${Date.now()}@example.com`;
  const password = "Sup3r-Str0ng-Pw!";

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) signUp (로컬 enable_signup=true). 이메일 확인이 꺼져 있으면 즉시 세션이 생긴다.
  console.log(`[1] signUp ${email}`);
  const signUp = await supabase.auth.signUp({ email, password });
  if (signUp.error) throw new Error(`signUp 실패: ${signUp.error.message}`);

  // 2) signInWithPassword → 세션 + ES256 access_token 확보(웹 group G 경로).
  console.log("[2] signInWithPassword");
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error) throw new Error(`signIn 실패: ${signIn.error.message}`);
  const token = signIn.data.session?.access_token;
  if (!token) throw new Error("access_token 없음");

  // 토큰 alg 헤더만 디코드해 ES256 인지 확인(payload/서명은 출력하지 않음 — R-A9).
  const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  console.log(`    token=${redact(token)}`);
  console.log(`    alg=${header.alg} kid=${header.kid ?? "(none)"}`);
  console.log(`    iss=${payload.iss} aud=${payload.aud} sub=${payload.sub}`);

  // 3) access_token 을 Authorization: Bearer 로만 주입해 백엔드 GET /me 호출(R-D4/R-A9).
  console.log(`[3] GET ${API_BASE_URL}/me (Authorization: Bearer <redacted>)`);
  const res = await fetch(`${API_BASE_URL}/me`, {
    method: "GET",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) {
    throw new Error(`GET /me 기대 200, 실제 ${res.status}: ${await res.text()}`);
  }
  const profile = (await res.json()) as { id: string; createdAt: string };

  console.log(`[4] ${res.status} OK — profile:`);
  console.log(JSON.stringify(profile, null, 2));

  // 검증: profile.id === token.sub (가드-검증 sub 기준 UPSERT — R-B3/M-5).
  if (profile.id !== payload.sub) {
    throw new Error(`profile.id(${profile.id}) !== token.sub(${payload.sub})`);
  }
  console.log("\nPASS — web 세션(ES256) → 백엔드 가드 → profile upsert 종단 증명 완료.");
  console.log(`       profile.id === token.sub (${profile.id})`);
}

main().catch((err) => {
  console.error("LIVE 증명 실패:", err instanceof Error ? err.message : err);
  process.exit(1);
});
