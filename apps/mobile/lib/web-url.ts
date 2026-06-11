// 모바일 셸이 호스팅할 웹 URL 가드 (SPEC-MOBILE-001 R-W1 / R-W2 / R-W3, AC-W2).
//
// 배경: 모바일 앱(apps/mobile)은 웹(apps/web)을 풀스크린 WebView 로 호스팅하는 씬 셸이다.
// 띄울 웹 호스트는 환경별로 다르므로(에뮬레이터/시뮬레이터/실기기/prod) 하드코딩하지 않고
// EXPO_PUBLIC_WEB_URL 로 주입한다(R-W3). 미설정 시 silent 하게 `undefined` 호스트로
// 로드하지 않도록(R-W2) 앱 부팅 경로에서 명시적으로 throw 하는 in-app 가드를 둔다 —
// lib/env.ts 의 resolveApiBaseUrl 패턴을 그대로 따른다.
//
// 주의: Expo(babel-preset-expo)의 EXPO_PUBLIC_* 인라인은 키가 정적으로 EXPO_PUBLIC_ 로
// 시작하는 멤버 접근(`process.env.EXPO_PUBLIC_WEB_URL`)에만 적용된다. 동적 조회
// (`process.env[key]`)는 변환되지 않으므로, 아래에서 반드시 리터럴 키로 직접 접근한다.

/**
 * 웹 URL 가드 (순수 함수 — 테스트 가능 단위).
 *
 * 미설정(`undefined`)이거나 공백뿐인 문자열이면 설명 메시지와 함께 throw 하고,
 * 설정되어 있으면 trim 한 값을 반환한다.
 *
 * @param value `process.env.EXPO_PUBLIC_WEB_URL` 의 인라인/참조 결과
 * @returns 검증된 웹 URL
 * @throws 미설정/빈 문자열일 때 설정 에러
 */
export function resolveWebUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      "[moyura/mobile] EXPO_PUBLIC_WEB_URL 이 설정되지 않았습니다. " +
        "apps/mobile/.env 또는 EAS 프로파일 env 에 EXPO_PUBLIC_WEB_URL=http://localhost:3000 형태로 지정하세요. " +
        "(Android 에뮬레이터는 http://10.0.2.2:3000, iOS 시뮬레이터는 http://localhost:3000, 실기기는 LAN IP 호스트 — R-W3) " +
        "(EXPO_PUBLIC_* 는 bundle 시점에 인라인되므로 미설정 시 자동 실패하지 않습니다 — R-W2)",
    );
  }
  return trimmed;
}

// @MX:ANCHOR: [AUTO] 검증된 웹 URL — 셸(App.tsx)이 로드할 WebView source 와 OAuth 콜백 호스트의 단일 출처다.
// @MX:REASON: 앱 부팅 시 1회 평가되는 환경 가드 결과로, App.tsx(WebView source)와 oauth.ts 브리지(콜백 URL 조립)
//   등 다수 모듈이 의존한다(fan_in >= 3 예상). 앱/콜백 호스트 일관성(R-O6)을 이 단일 값이 보장한다.
//   리터럴 키 직접 접근(`process.env.EXPO_PUBLIC_WEB_URL`)으로 Expo 인라인이 동작하게 한다.
export const WEB_URL: string = resolveWebUrl(process.env.EXPO_PUBLIC_WEB_URL);
