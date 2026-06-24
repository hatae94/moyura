// 네이티브 토큰 동기화 브리지 — 웹 클라이언트 측 (SPEC-MOBILE-002 R-T3/R-T4/R-T7/R-R1).
//
// WebView 안에서 실행될 때(window.ReactNativeWebView 존재 — R-T4 가드)만 동작한다. 일반 브라우저
// 에서는 모든 진입점이 no-op 이므로 순수 웹 앱이 동일하게 동작한다(forward-compat 가드레일 3, AC-T4).
//
// 흐름(R-T3): 네이티브가 window.postMessage 로 session:restore / resume:revalidate 를 주입하면,
//   browser supabase 클라이언트(lib/supabase/client.ts — 신규 client-side wiring, B-1)로
//   setSession({access,refresh}) 을 호출해 검증/갱신한다. 그 결과:
//     - valid/refreshed → setSession 리턴(data.session)의 최신 토큰을 session:synced 로 회신(OD-9).
//     - empty/expired(data.session === null) → session:none(웹 가드가 /login 라우팅).
//     - throw/네트워크 예외 → session:none(R-T3 throw 폴백 — 핸드셰이크 미해결 방지, 별도 type 미도입).
//
// 권위(M-5): 유효성 권위는 setSession 갱신 성공 + 백엔드 JWKS 가드다. setSession 의 쿠키 쓰기가
//   server getSession(me/page.tsx)과 일관되게 세션을 확립한다(@supabase/ssr document.cookie 폴백).
// 보안(SPEC-MOBILE-002 v0.2.0 — C-1/H-1/R-T8): 인바운드 토큰 메시지를 처리하기 전 origin + per-session
//   nonce 인증을 강제한다(setSession 미호출 거부). 토큰 값을 로깅하지 않고 postMessage 로만 회신한다.
"use client";

import { createClient } from "@/lib/supabase/client";
import {
  parseInboundMessage,
  serializeSyncedMessage,
  serializeNoneMessage,
  serializeClearedMessage,
  serializeGoogleSignInRequest,
  serializeInviteInvalidMessage,
  verifyInboundMessage,
  BRIDGE_MESSAGE_TYPES,
  type TokenPayload,
} from "./bridge-protocol";

/** React Native WebView 가 주입하는 전역. 존재하면 네이티브 셸 안에서 실행 중이다(R-T4). */
interface ReactNativeWebViewBridge {
  postMessage: (data: string) => void;
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
    /** R-T8/OD-11: 네이티브가 injectedJavaScriptBeforeContentLoaded 로 확립한 per-session nonce. */
    __MOYURA_BRIDGE_NONCE__?: string;
  }
}

/** 네이티브 셸(WebView) 안에서 실행 중인지 판별한다(R-T4 가드 — 일반 브라우저면 false). */
function getNativeBridge(): ReactNativeWebViewBridge | null {
  if (typeof window === "undefined") {
    return null; // SSR — 브리지 없음.
  }
  return window.ReactNativeWebView ?? null;
}

/** R-T8: 네이티브가 확립한 per-session nonce 를 읽는다(미확립이면 빈 문자열 — 인증 항상 실패). */
function getExpectedNonce(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.__MOYURA_BRIDGE_NONCE__ ?? "";
}

/** R-T8: 신뢰 origin — WebView 는 WEB_URL origin 에 잠겨 있으므로 곧 현재 페이지 origin 이다(R-T9). */
function getTrustedOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
}

/** 네이티브로 직렬화된 메시지를 회신한다(브리지 없으면 no-op — R-T4). */
function postToNative(bridge: ReactNativeWebViewBridge, serialized: string): void {
  bridge.postMessage(serialized);
}

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
 * 네이티브가 주입한 토큰으로 setSession 검증/갱신 후 결과를 회신한다(R-T3, R-R1 공용).
 * 회신 메시지에도 동일 nonce 를 실어 네이티브가 인증할 수 있게 한다(R-T8 — 양방향 인증).
 *
 * @param bridge 네이티브 브리지(postMessage)
 * @param tokens 네이티브가 보낸 access/refresh
 * @param nonce 인증 통과한 per-session nonce(회신에 재사용)
 */
async function handleRestoreTokens(
  bridge: ReactNativeWebViewBridge,
  tokens: TokenPayload,
  nonce: string,
): Promise<void> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.access,
      refresh_token: tokens.refresh,
    });

    // OD-9: setSession 리턴값(data.session)에 검증/갱신된 최신 토큰이 담긴다. 만료 시 내부적으로
    // refresh 된 세션이, 유효 시 기존 세션이 들어온다(@supabase/auth-js _setSession 확인).
    if (!error && data.session?.access_token && data.session.refresh_token) {
      // valid/refreshed → 최신 토큰 회신(R-T3). 라우팅은 웹이 소유한다(네이티브 reload 없음).
      postToNative(
        bridge,
        serializeSyncedMessage(
          {
            access: data.session.access_token,
            refresh: data.session.refresh_token,
          },
          nonce,
        ),
      );
      return;
    }

    // empty/expired refresh(data.session === null) 또는 auth 에러 → session:none(웹 가드가 /login).
    postToNative(bridge, serializeNoneMessage(nonce));
  } catch {
    // R-T3 throw 폴백: setSession 이 네트워크/런타임 예외로 throw → session:none(별도 type 미도입).
    // 핸드셰이크가 미해결로 남지 않게 한다(네이티브가 스플래시 해제 + 로그인 폴백 — R-N6 와 함께 동작).
    // 토큰/에러 내용은 노출하지 않는다(R-V2).
    postToNative(bridge, serializeNoneMessage(nonce));
  }
}

/**
 * 네이티브 토큰 동기화 리스너를 설치한다(R-T3/R-T7/R-R1/R-T8). 일반 브라우저에서는 no-op(R-T4).
 *
 * 네이티브가 window.postMessage(JSON) 으로 session:restore / resume:revalidate 를 주입하면, 그 메시지의
 * (1) event.origin === 신뢰 origin AND (2) nonce 인증을 먼저 검증하고(R-T8 — 위조/foreign-origin 거부),
 * 통과한 메시지만 setSession 검증/갱신 후 synced/none 을 회신한다. 핸들러는 mount 즉시 등록되므로,
 * 네이티브의 bounded 재시도(R-T7)가 onLoadEnd↔핸들러 등록 race 를 흡수해 메시지 미유실을 보장한다.
 *
 * @returns 리스너 해제 함수(컴포넌트 unmount cleanup). 브리지 없으면 no-op cleanup.
 */
export function installNativeTokenBridge(): () => void {
  const bridge = getNativeBridge();
  if (!bridge) {
    return () => undefined; // 일반 브라우저 — 브리지 미설치(순수 웹 무영향, R-T4).
  }

  const onMessage = (event: MessageEvent): void => {
    if (typeof event.data !== "string") {
      return;
    }
    const message = parseInboundMessage(event.data);
    if (!message) {
      return; // unknown/오타/파싱 실패/nonce 누락 — 안전 무시(throw 없음).
    }
    // R-T8/C-1: origin + nonce 인증 — schema 형태만으로는 발신자를 신뢰하지 않는다. 통과 못 하면 거부
    // (setSession 미호출 — 동일 page 임의 스크립트의 session:restore 위조/세션 고정 차단).
    if (
      !verifyInboundMessage({
        eventOrigin: event.origin,
        trustedOrigin: getTrustedOrigin(),
        messageNonce: message.nonce,
        expectedNonce: getExpectedNonce(),
      })
    ) {
      return; // foreign-origin 또는 미인증(nonce 불일치) — 거부.
    }
    // restore(콜드스타트) 와 revalidate(resume) 모두 setSession 검증/갱신 경로를 탄다(R-T3/R-R1).
    if (
      message.type === BRIDGE_MESSAGE_TYPES.RESTORE ||
      message.type === BRIDGE_MESSAGE_TYPES.REVALIDATE
    ) {
      void handleRestoreTokens(bridge, message.payload, message.nonce);
    }
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

// 직전에 announce 한 access_token 을 모듈 스코프에 기억해 중복 발신을 줄인다(F1/F1' 공용).
// 네이티브 save 분기는 멱등이므로 이는 *정확성*이 아니라 *노이즈 감소*다 — onAuthStateChange announcer 와
// (main) mount announcer 두 경로가 동일 토큰으로 중복 announce 하는 것을 막는다(예: 갱신 없는 라우트 재방문).
let lastAnnouncedAccessToken: string | null = null;

/**
 * 셸 모드 한정 — 토큰을 네이티브로 session:synced push 한다(F1/F1' 공용 헬퍼).
 *
 * 보안 HARD 제약(약화 금지): v1 프로토콜만(serializeSyncedMessage), nonce 필수(미확립 시 silent skip),
 *   토큰 값 미로깅, ReactNativeWebView 채널로만 post. dedupe(lastAnnouncedAccessToken)로 중복 억제.
 *
 * @param bridge 네이티브 브리지(getNativeBridge 가 셸 모드에서만 반환).
 * @param access 회신할 access token.
 * @param refresh 회신할 refresh token.
 */
function announceTokens(
  bridge: ReactNativeWebViewBridge,
  access: string,
  refresh: string,
): void {
  const nonce = getExpectedNonce();
  if (!nonce) {
    return; // nonce 미확립 — skip(네이티브 restore/타임아웃 경로가 콜드스타트를 여전히 커버).
  }
  if (access === lastAnnouncedAccessToken) {
    return; // 이미 동일 토큰을 announce 함 — 중복 억제(멱등이라 노이즈 감소 목적).
  }
  lastAnnouncedAccessToken = access;
  // 기존 v1 직렬화 + nonce 동봉(토큰 값 미로깅). 네이티브가 SecureStore 시딩 + isSignedIn 전환.
  postToNative(bridge, serializeSyncedMessage({ access, refresh }, nonce));
}

/**
 * 셸 모드(WebView) 한정 웹→네이티브 로그인 announcement 를 설치한다(SPEC-MOBILE-003 F1 — D-V2 수정).
 * 일반 브라우저에서는 no-op(R-T4).
 *
 * 적용 범위(중요): 이 onAuthStateChange 경로는 *클라이언트 측* auth state 전이(TOKEN_REFRESHED 자동 갱신,
 *   향후 client-side signInWithPassword 등)를 커버한다. 단, 이메일 로그인은 SERVER ACTION 으로 서버에서
 *   세션을 확립하므로 브라우저 클라이언트가 SIGNED_IN 을 발생시키지 않는다 — 그 경로는 announceSessionFromCookies
 *   ((main) mount)가 보강한다(F1'). 둘은 additive 이며 dedupe 를 공유한다.
 *
 * 보안(SPEC-MOBILE-002 surface — 약화 금지):
 *   - 프로토콜 v1 빌더 재사용(serializeSyncedMessage) — 신규 메시지 type/버전 없음.
 *   - per-session nonce 동봉(미확립이면 skip — 네이티브 decideInboundAction 은 nonce 불일치 시 거부).
 *   - 토큰 값 미로깅(postMessage 로만 전달).
 *   - ReactNativeWebView 채널로만 post(데스크톱은 getNativeBridge null → no-op).
 *
 * 멱등성(duplicate-synced 분석): 네이티브 onMessage 의 save 분기(useAuthBridge.ts)는
 *   ack 세팅·재시도타이머 정리·saveTokens(동일 토큰 덮어쓰기)·핸드셰이크 해제·onAuthSignal(synced) 로
 *   전부 멱등하다. 따라서 announcement 의 synced 와 (콜드스타트) restore-응답의 synced 가 모두 도착해도
 *   무해하다 — 두 번째는 동일 토큰 재저장·isSignedIn=true 재확정일 뿐이다.
 *
 * @returns 구독 해제 함수(컴포넌트 unmount cleanup). 브리지 없으면 no-op cleanup.
 */
export function installSessionAnnouncer(): () => void {
  const bridge = getNativeBridge();
  if (!bridge) {
    return () => undefined; // 일반 브라우저 — 미설치(순수 웹 무영향, R-T4).
  }

  const supabase = createClient();
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => {
    // 로그인 확립/토큰 갱신 시점에만 announce(SIGNED_OUT/INITIAL_SESSION 등은 무시 — 토큰 누설 방지).
    if (event !== "SIGNED_IN" && event !== "TOKEN_REFRESHED") {
      return;
    }
    const access = session?.access_token;
    const refresh = session?.refresh_token;
    if (!access || !refresh) {
      return; // 이벤트에 토큰 부재 — skip(불완전 synced 미발신).
    }
    announceTokens(bridge, access, refresh);
  });

  return () => subscription.unsubscribe();
}

/**
 * 셸 모드 한정 — 쿠키 세션을 읽어 네이티브로 session:synced 를 push 한다(SPEC-MOBILE-003 F1' — D-V2 재수정).
 * 일반 브라우저면 no-op(R-T4).
 *
 * 배경(F1 의 onAuthStateChange announcer 가 안 먹은 이유): 이메일 로그인은 SERVER ACTION(signInAction)
 *   으로 *서버에서* signInWithPassword → 쿠키 세션을 확립한다. 브라우저 supabase 클라이언트는 로그인을
 *   수행하지 않으므로 WebView 안에서 onAuthStateChange 가 SIGNED_IN 을 발생시키지 않는다 → F1 announcer
 *   미발화 → 네이티브가 토큰을 못 받아 (tabs) 미마운트. (main) 진입 = 서버 검증 세션 보장((main) 가드가
 *   세션 없으면 /login redirect)이므로, (main) mount 시 쿠키 세션을 읽어 직접 핸드오버한다.
 *
 * 동작: getNativeBridge() 셸 가드 → supabase 브라우저 클라이언트 getSession()(@supabase/ssr 가
 *   document.cookie 폴백으로 쿠키 세션을 읽음) → access/refresh 보유 시 announceTokens 로 push.
 *   (main) mount/soft-nav 마다 재실행되어도 dedupe 로 중복 발신은 억제된다.
 *
 * 보안(F1 과 동일 HARD 제약 — announceTokens 가 강제): v1 프로토콜만, nonce 필수(미확립 시 silent skip),
 *   토큰 값 미로깅, ReactNativeWebView 채널로만 post, 데스크톱 no-op.
 *
 * @returns cleanup(in-flight 무시용). 브리지 없으면 no-op cleanup.
 */
export function announceSessionFromCookies(): () => void {
  const bridge = getNativeBridge();
  if (!bridge) {
    return () => undefined; // 일반 브라우저 — no-op(R-T4).
  }

  let cancelled = false;
  void (async () => {
    try {
      const supabase = createClient();
      // @supabase/ssr 브라우저 클라이언트는 document.cookie 폴백으로 서버가 세팅한 쿠키 세션을 읽는다.
      const { data, error } = await supabase.auth.getSession();
      if (cancelled || error) {
        return;
      }
      const access = data.session?.access_token;
      const refresh = data.session?.refresh_token;
      if (!access || !refresh) {
        return; // 세션/토큰 부재 — skip((main) 가드가 정상이면 도달하기 어렵다).
      }
      announceTokens(bridge, access, refresh);
    } catch {
      // getSession 네트워크/런타임 예외 — silent(announce 생략). 토큰/에러 내용 미노출(R-V2).
    }
  })();

  return () => {
    cancelled = true;
  };
}

/**
 * 로그아웃 시 네이티브에 session:cleared 를 1회 post 한다(R-R2/OD-10). 일반 브라우저면 no-op(R-T4).
 *
 * server redirect(signOutAction) 와 경합하지 않는 client 지점에서 호출한다 — /login 도착 후 mount
 * 또는 /me 로그아웃 버튼의 signOut 호출 전(Server Action 본문 밖, H-2). 본 SPEC 은 /login mount 지점을
 * 택한다(LogoutBridgeNotifier) — server redirect 가 이미 완료된 안정 시점이라 emit 유실이 없다.
 *
 * 회신 cleared 메시지에도 per-session nonce 를 실어 네이티브가 인증한다(R-T8). nonce 가 미확립이면
 * (브리지 채널이 정상이 아님) clearTokens 는 R-R4 의 session:none→clear 멱등 경로가 백업한다.
 */
export function notifyNativeSessionCleared(): void {
  const bridge = getNativeBridge();
  if (!bridge) {
    return; // 일반 브라우저 — no-op(R-T4).
  }
  postToNative(bridge, serializeClearedMessage(getExpectedNonce()));
}
