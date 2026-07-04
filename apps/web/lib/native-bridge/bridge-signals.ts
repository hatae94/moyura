// 네이티브 브리지 도메인 시그널 — supabase 무의존(auth/invite/nav). SPEC-MOBILE-004/MOIM-011/MOBILE-NAV-001.
//
// bridge-transport 코어(전송/인증 플러밍) 위에 얹혀, 도메인별 아웃바운드 시그널 전송 + nav 인바운드 수신을
// 담당한다. supabase(@supabase/supabase-js)를 import 하지 않는 것이 핵심 — 이 모듈만 소비하는 정적 진입점
// (login-form·invite-invalid-handler·LogoutBridgeNotifier·NavBackListener)의 번들에서 supabase 를 배제한다.
// 세션 토큰 검증/갱신(supabase 의존)은 session-bridge.ts 로 분리돼 있다.
//
// 일반 브라우저(데스크톱)에서는 브리지가 부재하므로 모든 진입점이 no-op 이다(R-T4).
"use client";

import {
  getExpectedNonce,
  getNativeBridge,
  installInboundListener,
  postToNative,
} from "./bridge-transport";
import {
  BRIDGE_MESSAGE_TYPES,
  serializeClearedMessage,
  serializeGoogleSignInRequest,
  serializeInviteInvalidMessage,
} from "./bridge-protocol";

/**
 * 네이티브 셸 안에서 Google 로그인 버튼을 탭했을 때, 네이티브 Google Sign-In SDK 실행을 요청한다
 * (SPEC-MOBILE-004). 일반 브라우저(데스크톱)에서는 브리지가 없으므로 false 를 반환해 호출부가 기존
 * 웹 OAuth 흐름을 그대로 진행하게 한다.
 *
 * 셸 안에서는 auth:google-request 명령(per-session nonce 동봉)을 postMessage 로 보내고 true 를 반환한다.
 * 이로써 외부 브라우저 OAuth 네비게이션 없이 네이티브 인앱 로그인이 뜬다(OAuth 인터셉트 의존 제거).
 *
 * @returns 셸이라 네이티브로 요청을 보냈으면 true(호출부는 웹 OAuth 제출을 막아야 함), 데스크톱이면 false.
 */
export function requestNativeGoogleSignIn(): boolean {
  const bridge = getNativeBridge();
  if (!bridge) {
    return false; // 데스크톱 브라우저 — 네이티브 경로 없음(기존 웹 OAuth 흐름 유지).
  }
  postToNative(bridge, serializeGoogleSignInRequest(getExpectedNonce()));
  return true;
}

/**
 * 초대 수락 페이지 로드 시 초대가 무효(미지/만료/폐기)로 판정되면, 네이티브 셸에 invite:invalid 를 전달한다
 * (SPEC-MOIM-011 후속). 셸 안에서는 네이티브가 Alert + 라우팅을 수행하므로 호출부(InviteInvalidHandler)는
 * 자체 UI/네비게이션을 하지 않는다. 일반 브라우저(데스크톱)에서는 브리지가 없어 false 를 반환하므로,
 * 호출부가 웹 모달 + 웹 라우팅 폴백을 수행한다.
 *
 * @param loggedIn 실제 계정 세션 여부(true → 네이티브 Alert→(tabs)/home, false → (auth)/login)
 * @returns 셸이라 네이티브로 전달했으면 true(호출부는 웹 UI 생략), 데스크톱이면 false.
 */
export function notifyInviteInvalid(loggedIn: boolean): boolean {
  const bridge = getNativeBridge();
  if (!bridge) {
    return false; // 데스크톱 브라우저 — 네이티브 경로 없음(호출부가 웹 모달 폴백).
  }
  postToNative(bridge, serializeInviteInvalidMessage(loggedIn, getExpectedNonce()));
  return true;
}

/**
 * 로그아웃 시 네이티브에 session:cleared 를 1회 post 한다(R-R2/OD-10). 일반 브라우저면 no-op(R-T4).
 *
 * server redirect(signOutAction) 와 경합하지 않는 client 지점에서 호출한다 — /login 도착 후 mount
 * (LogoutBridgeNotifier). 회신 cleared 메시지에도 per-session nonce 를 실어 네이티브가 인증한다(R-T8).
 * nonce 가 미확립이면(브리지 채널 비정상) clearTokens 는 R-R4 의 session:none→clear 멱등 경로가 백업한다.
 * 세션 토큰(supabase)에 의존하지 않는 순수 시그널이므로 이 모듈에 둔다(정적 진입점 supabase 배제 목적).
 */
export function notifyNativeSessionCleared(): void {
  const bridge = getNativeBridge();
  if (!bridge) {
    return; // 일반 브라우저 — no-op(R-T4).
  }
  postToNative(bridge, serializeClearedMessage(getExpectedNonce()));
}

/**
 * nav:back 리스너가 in-app back / 폴백을 수행하는 네비게이션 어댑터(SPEC-MOBILE-NAV-001 REQ-MOBNAV-020/021).
 *
 * bridge 모듈은 순수 비-React 모듈이라 useRouter 훅을 직접 쓸 수 없다. 따라서 Next router 를 소비하는
 * React 마운트 컴포넌트(NavBackListener)가 `router.back`/`router.replace` 를 이 어댑터로 주입한다 —
 * 라우팅 소유권을 호출부에 두고 이 모듈은 브리지 수신/판정만 담당한다.
 */
export interface NavBackNavigator {
  /** in-app 히스토리 back(이전 route 로 복귀 — REQ-MOBNAV-020). Next router.back() 을 위임한다. */
  back: () => void;
  /** 딥링크 첫 진입 폴백(히스토리 없음 → /home 로 replace — REQ-MOBNAV-021). Next router.replace() 위임. */
  replace: (path: string) => void;
}

/** REQ-MOBNAV-021: 딥링크 첫 진입(in-app 히스토리 부재) 시 폴백할 홈 route. */
const NAV_BACK_FALLBACK_PATH = "/home";

/**
 * 셸 모드 한정 — 네이티브 헤더 back chevron 탭 시 네이티브가 보내는 nav:back 을 수신해 in-app back 을
 * 실행한다(SPEC-MOBILE-NAV-001 REQ-MOBNAV-020/021). 일반 브라우저에서는 no-op(R-T4).
 *
 * 판정(단일 진실 출처 = 웹, OD-2/OD-3): 네이티브는 딥링크-첫-진입 vs in-app-히스토리를 알 수 없으므로
 *   webViewRef.goBack() 대신 nav:back 으로 웹에 위임한다. 웹은 window.history.length 로 판정한다:
 *     - history.length > 1(in-app 히스토리 존재) → navigate.back()(이전 route 로 복귀 — REQ-MOBNAV-020).
 *     - history.length <= 1(딥링크 첫 진입) → /home 폴백(navigate.replace — REQ-MOBNAV-021, fail-safe).
 *   canGoBack(NavStateReporter 의 history.length > 1)과 동일 판정식이라 헤더 가시성↔back 동작이 정합한다.
 *
 * 보안(bridge-transport.installInboundListener 가 소유 — 약화 금지): nav:back 처리 전 origin + per-session
 *   nonce 인증이 코어에서 강제된다(R-T8/C-1). 여기서는 인증 통과한 메시지 중 nav:back 만 필터링한다.
 *
 * @param navigate Next router 를 위임하는 어댑터(back/replace) — React 마운트 컴포넌트가 주입.
 * @returns 리스너 해제 함수(컴포넌트 unmount cleanup). 브리지 없으면 no-op cleanup.
 */
export function installNavBackListener(navigate: NavBackNavigator): () => void {
  return installInboundListener((message) => {
    if (message.type !== BRIDGE_MESSAGE_TYPES.NAV_BACK) {
      return; // nav:back 이외(restore/revalidate 등) — 이 리스너는 무시.
    }
    // REQ-MOBNAV-020/021: in-app 히스토리 있으면 back, 딥링크 첫 진입이면 /home 폴백(fail-safe).
    if (window.history.length > 1) {
      navigate.back();
    } else {
      navigate.replace(NAV_BACK_FALLBACK_PATH);
    }
  });
}
