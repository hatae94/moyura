// nav:state / nav:back 브리지 nav 채널 단위 테스트 (SPEC-MOBILE-NAV-001 REQ-MOBNAV-011).
//
// nav:* 는 기존 v1 nonce + trusted-origin 봉투를 재사용하는 additive 신규 채널이다. 이 스위트는:
// (1) nav:state(web→native)/nav:back(native→web) round-trip,
// (2) nonce 검증(위조 nav:state 거부),
// (3) unknown-type graceful-ignore 계약 보존,
// (4) 기존 세션 타입(session:*/auth:google-request/invite:invalid) 회귀 0
// 을 검증한다. 순수 로직만(expo/RN import 0 — bridge-protocol.test.ts 패턴).
import { describe, it, expect } from "vitest";

import {
  BRIDGE_VERSION,
  BRIDGE_MESSAGE_TYPES,
  type BridgeMessage,
  serializeBridgeMessage,
  parseBridgeMessage,
  decideInboundAction,
} from "./bridge-protocol";

const NONCE = "test-nonce";

describe("nav 채널 type 집합 (REQ-MOBNAV-011: additive v1 — 기존 타입 무변경)", () => {
  it("type 집합에 nav:state / nav:back 이 additive 로 추가된다", () => {
    expect(BRIDGE_MESSAGE_TYPES.NAV_STATE).toBe("nav:state");
    expect(BRIDGE_MESSAGE_TYPES.NAV_BACK).toBe("nav:back");
    const values = Object.values(BRIDGE_MESSAGE_TYPES);
    expect(values).toContain("nav:state");
    expect(values).toContain("nav:back");
  });

  it("기존 세션/명령 타입은 값이 변하지 않는다 (회귀 0 — nonce 봉투 계약 불변)", () => {
    // REQ-MOBNAV-011: nav:* 추가가 기존 session:*/auth:google-request/invite:invalid 를 건드리지 않는다.
    expect(BRIDGE_MESSAGE_TYPES.RESTORE).toBe("session:restore");
    expect(BRIDGE_MESSAGE_TYPES.SYNCED).toBe("session:synced");
    expect(BRIDGE_MESSAGE_TYPES.NONE).toBe("session:none");
    expect(BRIDGE_MESSAGE_TYPES.CLEARED).toBe("session:cleared");
    expect(BRIDGE_MESSAGE_TYPES.REVALIDATE).toBe("resume:revalidate");
    expect(BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST).toBe("auth:google-request");
    expect(BRIDGE_MESSAGE_TYPES.INVITE_INVALID).toBe("invite:invalid");
  });
});

describe("nav:state round-trip (web→native — {pathname,title,canGoBack})", () => {
  it("nav:state 페이로드를 정확히 round-trip 한다 (canGoBack true)", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.NAV_STATE,
      nonce: NONCE,
      payload: { pathname: "/home/42", title: "우리 모임", canGoBack: true },
    };
    expect(parseBridgeMessage(serializeBridgeMessage(msg))).toEqual(msg);
  });

  it("nav:state 페이로드를 정확히 round-trip 한다 (canGoBack false — 헤더 chevron 숨김 케이스)", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.NAV_STATE,
      nonce: NONCE,
      payload: { pathname: "/home", title: "", canGoBack: false },
    };
    expect(parseBridgeMessage(serializeBridgeMessage(msg))).toEqual(msg);
  });

  it("payload 가 불완전하면 null 을 반환한다 (안전 무시 — 헤더 오작동 방지)", () => {
    const base = { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.NAV_STATE, nonce: NONCE };
    expect(parseBridgeMessage(JSON.stringify(base))).toBeNull(); // payload 누락
    expect(parseBridgeMessage(JSON.stringify({ ...base, payload: {} }))).toBeNull();
    // pathname 누락/빈값
    expect(
      parseBridgeMessage(JSON.stringify({ ...base, payload: { title: "x", canGoBack: true } })),
    ).toBeNull();
    expect(
      parseBridgeMessage(
        JSON.stringify({ ...base, payload: { pathname: "", title: "x", canGoBack: true } }),
      ),
    ).toBeNull();
    // canGoBack 이 boolean 이 아님
    expect(
      parseBridgeMessage(
        JSON.stringify({ ...base, payload: { pathname: "/home/1", title: "x", canGoBack: "yes" } }),
      ),
    ).toBeNull();
    // title 이 문자열이 아님
    expect(
      parseBridgeMessage(
        JSON.stringify({ ...base, payload: { pathname: "/home/1", title: 1, canGoBack: true } }),
      ),
    ).toBeNull();
  });
});

describe("nav:back round-trip (native→web — payload 없는 신호)", () => {
  it("nav:back 을 payload 없는 신호 메시지로 정확히 round-trip 한다", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.NAV_BACK,
      nonce: NONCE,
    };
    expect(parseBridgeMessage(serializeBridgeMessage(msg))).toEqual(msg);
  });
});

describe("decideInboundAction nav 분기 (nonce 검증 + native-발신 무시)", () => {
  it("nav:state + nonce 일치 → nav-state 액션(pathname/title/canGoBack 그대로)", () => {
    const action = decideInboundAction(
      {
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.NAV_STATE,
        nonce: NONCE,
        payload: { pathname: "/moims/7/chat", title: "번개 모임", canGoBack: true },
      },
      NONCE,
    );
    expect(action).toEqual({
      kind: "nav-state",
      pathname: "/moims/7/chat",
      title: "번개 모임",
      canGoBack: true,
    });
  });

  it("nav:state + nonce 불일치(위조) → ignore (헤더 미갱신 — 위조 nav 거부)", () => {
    const action = decideInboundAction(
      {
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.NAV_STATE,
        nonce: "forged",
        payload: { pathname: "/home/1", title: "x", canGoBack: true },
      },
      NONCE,
    );
    expect(action).toEqual({ kind: "ignore" });
  });

  it("nav:back 은 네이티브 발신 type 이므로 네이티브 수신 분기에서 무시한다 (ignore)", () => {
    const action = decideInboundAction(
      { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.NAV_BACK, nonce: NONCE },
      NONCE,
    );
    expect(action).toEqual({ kind: "ignore" });
  });
});

describe("기존 계약 회귀 0 (nav 추가 후에도 unknown 무시 + 세션 타입 결정 불변)", () => {
  it("unknown type 은 여전히 null 로 안전 무시된다 (nav 오타 포함)", () => {
    // nav 채널 추가가 unknown-type graceful-ignore 계약을 깨지 않음을 확인한다.
    expect(
      parseBridgeMessage(JSON.stringify({ version: BRIDGE_VERSION, type: "nav:states", nonce: NONCE })),
    ).toBeNull(); // 오타
    expect(
      parseBridgeMessage(JSON.stringify({ version: BRIDGE_VERSION, type: "nav:forward", nonce: NONCE })),
    ).toBeNull(); // 미지 nav type
  });

  it("기존 세션 타입 결정이 변하지 않는다 (synced→save / none→clear / cleared→clear+쿠키)", () => {
    expect(
      decideInboundAction(
        {
          version: BRIDGE_VERSION,
          type: BRIDGE_MESSAGE_TYPES.SYNCED,
          nonce: NONCE,
          payload: { access: "a", refresh: "r" },
        },
        NONCE,
      ),
    ).toEqual({ kind: "save", tokens: { access: "a", refresh: "r" }, resolvesHandshake: true });
    expect(
      decideInboundAction(
        { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.NONE, nonce: NONCE },
        NONCE,
      ),
    ).toEqual({ kind: "clear", resolvesHandshake: true, clearCookies: false });
    expect(
      decideInboundAction(
        { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.CLEARED, nonce: NONCE },
        NONCE,
      ),
    ).toEqual({ kind: "clear", resolvesHandshake: false, clearCookies: true });
  });
});
