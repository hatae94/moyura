// 웹 앱 환경변수 가드 (SPEC-ENV-SETUP-001 R-E1 / R-E4, AC-E1 / AC-E4 +
// SPEC-AUTH-001 R-I4, AC-I4).
//
// 배경: Next.js 는 `NEXT_PUBLIC_*` 를 build 시점에 정적으로 인라인하며, 미설정 시
// 자동으로 실패하지 않고 `process.env.NEXT_PUBLIC_*` 가 `undefined`/빈 문자열로
// 치환된다. 그대로 두면 silent 하게 잘못된 호스트로 동작할 수 있으므로(R-E4 근거),
// 앱 부팅 경로에서 명시적으로 throw 하는 in-app 가드를 둔다.
//
// 주의: Next 의 인라인은 `process.env.NEXT_PUBLIC_*` 같은 "정적 멤버 접근"에만
// 적용된다. `process.env[key]` 나 구조분해 같은 동적 조회는 인라인되지 않으므로,
// 아래에서 반드시 리터럴 키로 직접 접근한 뒤 그 값을 순수 함수에 넘긴다.

/**
 * API 베이스 URL 가드 (순수 함수 — 테스트 가능 단위).
 *
 * 미설정(`undefined`)이거나 공백뿐인 문자열이면 설명 메시지와 함께 throw 하고,
 * 설정되어 있으면 trim 한 값을 반환한다.
 *
 * @param value `process.env.NEXT_PUBLIC_API_BASE_URL` 의 정적 인라인 결과
 * @returns 검증된 API 베이스 URL
 * @throws 미설정/빈 문자열일 때 설정 에러
 */
export function resolveApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      "[moyura/web] NEXT_PUBLIC_API_BASE_URL 이 설정되지 않았습니다. " +
        "apps/web/.env.local 에 NEXT_PUBLIC_API_BASE_URL=http://192.168.219.102:3001 형태로 지정하세요. " +
        "(NEXT_PUBLIC_* 는 build 시점에 인라인되므로 미설정 시 자동 실패하지 않습니다 — R-E4)",
    );
  }
  return trimmed;
}

/**
 * Supabase 공개 설정 가드 (순수 함수 — 테스트 가능 단위, SPEC-AUTH-001 R-I4).
 *
 * `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 중 하나라도
 * 미설정/공백이면 설명 메시지와 함께 throw 한다. 둘 다 있으면 trim 한 값을 반환한다.
 * 이 값들은 @supabase/ssr 브라우저/서버 클라이언트의 생성 인자로 쓰인다(R-D1).
 *
 * @throws 미설정/빈 문자열일 때 설정 에러
 */
export function resolveSupabaseConfig(
  url: string | undefined,
  anonKey: string | undefined,
): { url: string; anonKey: string } {
  const trimmedUrl = url?.trim();
  const trimmedKey = anonKey?.trim();
  if (!trimmedUrl || !trimmedKey) {
    throw new Error(
      "[moyura/web] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 설정되지 않았습니다. " +
        "apps/web/.env.local 에 로컬 Supabase 스택 값(supabase status 의 API URL/ANON_KEY)을 지정하세요. " +
        "(NEXT_PUBLIC_* 는 build 시점에 인라인되므로 미설정 시 자동 실패하지 않습니다 — R-I4)",
    );
  }
  return { url: trimmedUrl, anonKey: trimmedKey };
}

// @MX:ANCHOR: [AUTO] 검증된 API 베이스 URL — web 앱의 모든 백엔드 호출 진입점이 의존한다.
// @MX:REASON: 앱 부팅 시 1회 평가되는 환경 가드 결과로, layout/api 등 다수 모듈이 import 한다(fan_in >= 3 예상).
// 리터럴 키 직접 접근(`process.env.NEXT_PUBLIC_API_BASE_URL`)으로 Next 인라인이 동작하게 한다.
export const API_BASE_URL: string = resolveApiBaseUrl(
  process.env.NEXT_PUBLIC_API_BASE_URL,
);

// @MX:ANCHOR: [AUTO] 검증된 Supabase 공개 설정 — @supabase/ssr 브라우저/서버 클라이언트의 단일 진입점.
// @MX:REASON: 부팅 시 1회 평가되는 환경 가드 결과로, supabase 클라이언트 팩토리(client/server/middleware)가
// 모두 이 값에 의존한다(fan_in >= 3). 리터럴 키 직접 접근으로 Next 인라인을 보장한다(R-I4).
export const SUPABASE_CONFIG: { url: string; anonKey: string } =
  resolveSupabaseConfig(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
