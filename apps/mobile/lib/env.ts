// 모바일 앱 환경변수 가드 (SPEC-ENV-SETUP-001 R-E2 / R-E4, AC-E2 / AC-E4).
//
// 배경: Expo(babel-preset-expo)는 `EXPO_PUBLIC_*` 멤버 접근을 bundle 시점에 인라인(prod)
// 하거나 expo/virtual/env 참조로 치환(dev)한다. 미설정 시 자동 실패하지 않고
// `process.env.EXPO_PUBLIC_API_BASE_URL` 가 `undefined` 가 되어 silent 하게
// 잘못된 호스트로 동작할 수 있으므로(R-E4 근거), 앱 부팅 경로에서 명시적으로 throw 하는
// in-app 가드를 둔다.
//
// 주의: Expo 의 변환은 `process.env.EXPO_PUBLIC_API_BASE_URL` 처럼 키가 정적으로
// `EXPO_PUBLIC_` 로 시작하는 멤버 접근에만 적용된다. 동적 조회(`process.env[key]`)는
// 변환되지 않으므로, 아래에서 반드시 리터럴 키로 직접 접근한다.

/**
 * API 베이스 URL 가드 (순수 함수 — 테스트 가능 단위).
 *
 * 미설정(`undefined`)이거나 공백뿐인 문자열이면 설명 메시지와 함께 throw 하고,
 * 설정되어 있으면 trim 한 값을 반환한다.
 *
 * @param value `process.env.EXPO_PUBLIC_API_BASE_URL` 의 인라인/참조 결과
 * @returns 검증된 API 베이스 URL
 * @throws 미설정/빈 문자열일 때 설정 에러
 */
export function resolveApiBaseUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      "[moyura/mobile] EXPO_PUBLIC_API_BASE_URL 이 설정되지 않았습니다. " +
        "apps/mobile/.env 또는 EAS 프로파일 env 에 EXPO_PUBLIC_API_BASE_URL=http://localhost:3000 형태로 지정하세요. " +
        "(EXPO_PUBLIC_* 는 bundle 시점에 인라인되므로 미설정 시 자동 실패하지 않습니다 — R-E4)",
    );
  }
  return trimmed;
}

// @MX:ANCHOR: [AUTO] 검증된 API 베이스 URL — mobile 앱의 모든 백엔드 호출 진입점이 의존한다.
// @MX:REASON: 앱 부팅 시 1회 평가되는 환경 가드 결과로, index/api 등 다수 모듈이 import 한다(fan_in >= 3 예상).
// 리터럴 키 직접 접근(`process.env.EXPO_PUBLIC_API_BASE_URL`)으로 Expo 인라인이 동작하게 한다.
export const API_BASE_URL: string = resolveApiBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL,
);

/**
 * 공개 Supabase 설정 가드 (SPEC-AUTH-001 R-I4 / AC-I4).
 *
 * 모바일은 `EXPO_PUBLIC_*` 로 공개 설정(`SUPABASE_URL`/`SUPABASE_ANON_KEY`)만 읽는다.
 * provider 시크릿은 절대 `EXPO_PUBLIC_*` 에 노출하지 않는다(시크릿은 config.toml env() 전용).
 *
 * `name` 은 에러 메시지용 변수명(예: "EXPO_PUBLIC_SUPABASE_URL").
 * `resolveApiBaseUrl` 과 동일한 throw 패턴 — 미설정/공백이면 설명 메시지와 함께 throw 한다.
 *
 * @param value `process.env.EXPO_PUBLIC_SUPABASE_*` 의 인라인/참조 결과
 * @param name 변수명(에러 메시지용)
 * @returns 검증된 값(trim)
 * @throws 미설정/빈 문자열일 때 설정 에러
 */
export function resolvePublicSupabaseValue(
  value: string | undefined,
  name: string,
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `[moyura/mobile] ${name} 이 설정되지 않았습니다. ` +
        `apps/mobile/.env 또는 EAS 프로파일 env 에 ${name}=... 형태로 지정하세요. ` +
        "(EXPO_PUBLIC_* 는 bundle 시점에 인라인되므로 미설정 시 자동 실패하지 않습니다 — R-I4)",
    );
  }
  return trimmed;
}

// 공개 Supabase 설정 — 모바일 OAuth 진입(시스템 브라우저) 시 redirect/anon 컨텍스트 구성에 사용한다(R-I4).
// 리터럴 키 직접 접근으로 Expo 인라인을 보장한다(동적 조회는 변환되지 않음).
export const SUPABASE_URL: string = resolvePublicSupabaseValue(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  "EXPO_PUBLIC_SUPABASE_URL",
);

export const SUPABASE_ANON_KEY: string = resolvePublicSupabaseValue(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
);
