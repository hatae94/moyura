// 로그아웃 WebView 쿠키 clear 결정 단위 테스트 (SPEC-MOBILE-002 R-R4 (c) — 디바이스 검증 쿠키 부활 결함).
//
// 디바이스 인터랙티브 종단 검증에서 측정된 결함: 로그아웃 후 콜드 재시작 시 세션이 ≤1시간 부활.
// 원인 — 웹의 로그아웃 쿠키 삭제(Set-Cookie)가 앱 영속 쿠키 저장소(binarycookies)에 영속되지 않음.
// 조치 — session:cleared(명시 로그아웃) 수신 시 clearTokens() 에 더해 네이티브가 WebView 쿠키도 제거.
//
// 이 파일은 순수 결정 로직만 검증한다(expo/RN import 0): decideInboundAction 이 cleared 에서만
// clearCookies:true 를, none/synced-불완전 에서는 clearCookies:false 를 반환하는지 — 즉 쿠키 clear 가
// session:cleared 에만 스코프되고 session:none(setSession network-throw 폴백)에는 적용되지 않음을
// 결정 단계에서 보장한다(R-R4 (c): none 에서 쿠키를 지우면 transient 오류 시 유효 세션 파괴).
import { describe, it, expect } from "vitest";

import {
  BRIDGE_VERSION,
  BRIDGE_MESSAGE_TYPES,
  decideInboundAction,
} from "./bridge-protocol";

const NONCE = "cookie-nonce-xyz";

describe("decideInboundAction clearCookies 플래그 (R-R4 (c): 쿠키 clear 는 cleared 에만)", () => {
  it("session:cleared → clear + clearCookies:true (로그아웃 — WebView 쿠키 부활 차단)", () => {
    const action = decideInboundAction(
      { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.CLEARED, nonce: NONCE },
      NONCE,
    );
    expect(action).toEqual({
      kind: "clear",
      resolvesHandshake: false,
      clearCookies: true,
    });
  });

  it("session:none → clear + clearCookies:false (네트워크-throw 폴백에서 유효 쿠키 세션 파괴 방지)", () => {
    const action = decideInboundAction(
      { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.NONE, nonce: NONCE },
      NONCE,
    );
    // R-R4 (c): none 에는 쿠키 clear 를 적용하지 않는다 — 웹이 그 경로의 세션 권위(R-T3).
    expect(action).toEqual({
      kind: "clear",
      resolvesHandshake: true,
      clearCookies: false,
    });
  });

  it("session:synced 인데 토큰 불완전 → clear + clearCookies:false (none 처럼 처리, 쿠키는 보존)", () => {
    const action = decideInboundAction(
      {
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.SYNCED,
        nonce: NONCE,
        payload: { access: "a", refresh: "" },
      },
      NONCE,
    );
    expect(action).toEqual({
      kind: "clear",
      resolvesHandshake: true,
      clearCookies: false,
    });
  });

  it("session:synced + 유효 토큰 → save (clear 도 cookie clear 도 아님)", () => {
    const action = decideInboundAction(
      {
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.SYNCED,
        nonce: NONCE,
        payload: { access: "a", refresh: "r" },
      },
      NONCE,
    );
    // save 분기에는 clearCookies 필드가 없다(쿠키 clear 미발생).
    expect(action).toEqual({
      kind: "save",
      tokens: { access: "a", refresh: "r" },
      resolvesHandshake: true,
    });
  });

  it("위조 session:cleared(nonce 불일치) → ignore (쿠키 clear 도 트리거되지 않음 — C-1)", () => {
    const action = decideInboundAction(
      { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.CLEARED, nonce: "forged" },
      NONCE,
    );
    expect(action).toEqual({ kind: "ignore" });
  });
});
