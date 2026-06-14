// 네이티브 Google Sign-In 얇은 래퍼 (SPEC-MOBILE-004 R-MOB4-001, AC-1/2/6a).
//
// @react-native-google-signin/google-signin 의 무료 "Original" API(GoogleSignin.configure + signIn)를
// 호출하는 네이티브 경계 래퍼다. 결정/분류 로직은 순수 google-signin-core.ts(classifyGoogleSignInResult)에
// 위임한다 — 이 파일은 네이티브 SDK 호출 + try/catch 흡수만 담는다(oauth.ts launchSocialOAuth 패턴).
//
// ── 무료 Original API 사용 (유료 Universal/OneTap 미사용) ──────────────────────────
// GoogleSignin(Original) 의 configure/signIn/getTokens 만 사용한다. GoogleOneTapSignIn(Universal,
// 유료 정책)은 import 하지 않는다 — Original API 의 signIn() 이 반환하는 idToken 을
// Supabase signInWithIdToken 에 그대로 전달한다(SPEC-MOBILE-004 리스크 "Universal/OneTap 유료").
//
// ── Expo Go 불가 / EAS dev build 필요 (런타임 디바이스 게이트) ──────────────────────
// 네이티브 모듈이라 Expo Go 에서 동작하지 않는다 — EAS dev build 에서만 런타임 검증된다. 이 래퍼는
// tsc/expo export 로 정적 검증되며, 실제 signIn 동작은 디바이스 종단 검증(T-010)에서 확인한다.
//
// 보안(AC-6b): idToken 값을 로깅하지 않는다 — core 분류 결과만 호출부에 돌려준다.
import {
  GoogleSignin,
  type ConfigureParams,
} from "@react-native-google-signin/google-signin";

import {
  classifyGoogleSignInResult,
  type GoogleSignInResult,
} from "./google-signin-core";

/**
 * Google Sign-In SDK 를 1회 설정한다(R-MOB4-001).
 *
 * webClientId 는 Supabase signInWithIdToken({provider:'google'}) 가 검증하는 audience 와 일치해야
 * 한다(Supabase 의 Google provider authorized client ID). iOS 는 추가로 iosClientId(app.json
 * config plugin 의 iosUrlScheme 와 연동)가 필요하다. 실제 클라이언트 ID 는 Google Cloud Console
 * 발급분으로, prod 배선(OD-4)·디바이스 검증(T-010)에서 주입된다 — 여기서는 인자로만 받는다.
 *
 * @param params webClientId/iosClientId/scopes 등 GoogleSignin.configure 옵션
 */
export function configureGoogleSignIn(params: ConfigureParams): void {
  GoogleSignin.configure(params);
}

/**
 * 네이티브 Google Sign-In 을 실행하고 결과를 순수 core 로 분류해 돌려준다(R-MOB4-001/005).
 *
 * signIn() 의 resolve 응답(success/cancelled/...)과 throw 한 에러(취소/PLAY_SERVICES/...)를 모두
 * classifyGoogleSignInResult 에 넘긴다 — core 가 취소 코드는 cancelled, 그 외는 error 로 흡수한다.
 * 어떤 경우에도 throw 하지 않고 복구 가능한 분류를 반환한다(미인증 유지 — AC-6a/6b). idToken 값은
 * 로깅하지 않는다(AC-6b).
 *
 * @returns idToken(획득) | cancelled(사용자 취소) | error(복구 가능한 실패) — 토큰 값 비노출
 */
// @MX:NOTE: [AUTO] 네이티브 Google SDK 호출 경계(SPEC-MOBILE-004) — Expo Go 불가, EAS dev build
//   런타임 게이트. signIn resolve/throw 를 core 분류기로 흡수한다(throw 없음, 토큰 비로깅 — AC-6b).
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  try {
    const response = await GoogleSignin.signIn();
    return classifyGoogleSignInResult(response);
  } catch (error) {
    // signIn() 은 statusCodes 기반 에러를 throw 할 수 있다(취소/IN_PROGRESS/PLAY_SERVICES) —
    // core 가 취소 코드는 cancelled, 그 외는 error 로 분류한다(토큰/상세 비노출 — AC-6b).
    return classifyGoogleSignInResult(error);
  }
}
