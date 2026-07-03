// 네이티브 브리지 전송 코어 — 도메인 무관(zero domain deps). SPEC-MOBILE-002 R-T4/R-T8/R-T9.
//
// 이 모듈은 웹↔네이티브 postMessage 전송 계층만 담당한다: (1) 셸(WebView) 판별, (2) per-session nonce +
// 신뢰 origin 확립, (3) 아웃바운드 직렬화 메시지 전송, (4) 인바운드 메시지의 origin+nonce 인증 후 파싱
// 결과 디스패치. supabase/auth/nav/invite 등 어떤 도메인도 import 하지 않는다 — 도메인 핸들러(session-bridge,
// bridge-signals)가 이 코어 위에 얹혀 각자의 message type 만 소비한다. 순수 웹(브라우저)에서는 브리지가
// 부재하므로 모든 진입점이 no-op 이다(forward-compat 가드레일, R-T4).
//
// 보안(SPEC-MOBILE-002 v0.2.0 — C-1/H-1/R-T8): 인바운드 메시지를 도메인 핸들러로 넘기기 전, 이 코어가
//   (1) event.origin === 신뢰 origin AND (2) per-session nonce 상수시간 일치를 강제한다(installInboundListener).
//   통과 못 한 메시지는 디스패치하지 않는다 — 동일 page 임의 스크립트의 위조 메시지를 원천 차단한다.
"use client";

import {
  parseInboundMessage,
  verifyInboundMessage,
  type InboundNativeMessage,
} from "./bridge-protocol";

/** React Native WebView 가 주입하는 전역. 존재하면 네이티브 셸 안에서 실행 중이다(R-T4). */
export interface ReactNativeWebViewBridge {
  postMessage: (data: string) => void;
}

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
    /** R-T8/OD-11: 네이티브가 injectedJavaScriptBeforeContentLoaded 로 확립한 per-session nonce. */
    __MOYURA_BRIDGE_NONCE__?: string;
  }
}

/** 네이티브 셸(WebView) 안에서 실행 중인지 판별한다(R-T4 가드 — 일반 브라우저면 null). */
export function getNativeBridge(): ReactNativeWebViewBridge | null {
  if (typeof window === "undefined") {
    return null; // SSR — 브리지 없음.
  }
  return window.ReactNativeWebView ?? null;
}

/** R-T8: 네이티브가 확립한 per-session nonce 를 읽는다(미확립이면 빈 문자열 — 인증 항상 실패). */
export function getExpectedNonce(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.__MOYURA_BRIDGE_NONCE__ ?? "";
}

/** R-T8: 신뢰 origin — WebView 는 WEB_URL origin 에 잠겨 있으므로 곧 현재 페이지 origin 이다(R-T9). */
export function getTrustedOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
}

/** 네이티브로 직렬화된 메시지를 전송한다(브리지 없으면 no-op — R-T4). */
export function postToNative(
  bridge: ReactNativeWebViewBridge,
  serialized: string,
): void {
  bridge.postMessage(serialized);
}

/**
 * 인바운드 네이티브 메시지 리스너를 설치한다 — 도메인 무관 공용 플러밍(R-T8/C-1). 일반 브라우저면 no-op(R-T4).
 *
 * 네이티브가 window.postMessage(JSON) 으로 메시지를 주입하면 이 리스너가 (1) event.origin === 신뢰 origin
 * AND (2) per-session nonce 상수시간 일치를 먼저 검증하고(위조/foreign-origin 거부), 통과한 메시지만
 * 파싱 결과와 브리지 핸들을 `onVerified` 콜백으로 넘긴다. 도메인 핸들러(session-bridge/bridge-signals)는
 * message.type 으로 자신의 메시지만 필터링해 처리한다 — 인증·파싱 책임은 이 코어가 단독으로 소유한다.
 *
 * @param onVerified origin+nonce 인증을 통과한 파싱 메시지 핸들러(브리지 핸들 동봉 — 회신용).
 * @returns 리스너 해제 함수(컴포넌트 unmount cleanup). 브리지 없으면 no-op cleanup.
 */
export function installInboundListener(
  onVerified: (
    message: InboundNativeMessage,
    bridge: ReactNativeWebViewBridge,
  ) => void,
): () => void {
  const bridge = getNativeBridge();
  if (!bridge) {
    return () => undefined; // 일반 브라우저 — 미설치(순수 웹 무영향, R-T4).
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
    // (도메인 핸들러 미호출 — 동일 page 임의 스크립트의 위조 메시지 차단).
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
    onVerified(message, bridge);
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
