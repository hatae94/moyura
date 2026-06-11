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
