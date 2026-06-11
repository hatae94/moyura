// auth-state-core 순수 결정 모듈 단위 테스트 (SPEC-MOBILE-003 R-AS1/2/4/5, AC-2).
//
// 네이티브 인증 상태(isSignedIn)와 진입 리다이렉트 목적지를 SecureStore 토큰 + bridge 신호만으로
// 도출하는 순수 결정 로직을 검증한다. 웹 /me 세션을 인증 소스로 읽지 않는다(R-AS5 — /me 참조 0).
// expo/RN import 0 — vitest node 환경에서 mock 없이 단위 테스트.
import { describe, it, expect } from "vitest";

import {
  deriveAuthState,
  ROUTE_SIGNED_IN,
  ROUTE_SIGNED_OUT,
} from "./auth-state-core";

const TOKENS = { access: "access-jwt", refresh: "refresh-token" };

describe("deriveAuthState (R-AS1/R-AS2: 토큰 + bridge 신호 → isSignedIn + redirectTo)", () => {
  it("session:synced + 토큰 보유 → 로그인 상태, (tabs)/home 으로", () => {
    expect(
      deriveAuthState({ tokens: TOKENS, lastBridgeSignal: "session:synced" }),
    ).toEqual({ isSignedIn: true, redirectTo: ROUTE_SIGNED_IN });
  });

  it("session:none → 미로그인, (auth)/login 으로", () => {
    expect(
      deriveAuthState({ tokens: null, lastBridgeSignal: "session:none" }),
    ).toEqual({ isSignedIn: false, redirectTo: ROUTE_SIGNED_OUT });
  });

  it("session:cleared(로그아웃) → 미로그인, (auth)/login 으로", () => {
    expect(
      deriveAuthState({ tokens: null, lastBridgeSignal: "session:cleared" }),
    ).toEqual({ isSignedIn: false, redirectTo: ROUTE_SIGNED_OUT });
  });

  it("토큰이 있어도 session:cleared 면 미로그인 (로그아웃 신호가 우선 — 보수적)", () => {
    expect(
      deriveAuthState({ tokens: TOKENS, lastBridgeSignal: "session:cleared" }),
    ).toEqual({ isSignedIn: false, redirectTo: ROUTE_SIGNED_OUT });
  });

  it("토큰이 있어도 session:none 면 미로그인", () => {
    expect(
      deriveAuthState({ tokens: TOKENS, lastBridgeSignal: "session:none" }),
    ).toEqual({ isSignedIn: false, redirectTo: ROUTE_SIGNED_OUT });
  });

  it("신호/토큰 모두 없으면 미로그인 (콜드스타트 미인증)", () => {
    expect(
      deriveAuthState({ tokens: null, lastBridgeSignal: null }),
    ).toEqual({ isSignedIn: false, redirectTo: ROUTE_SIGNED_OUT });
  });

  it("session:synced 인데 토큰 캐시 null 이면 미로그인 (신호만으로 인정 안 함 — 보수적)", () => {
    expect(
      deriveAuthState({ tokens: null, lastBridgeSignal: "session:synced" }),
    ).toEqual({ isSignedIn: false, redirectTo: ROUTE_SIGNED_OUT });
  });

  it("핸드셰이크 전(null 신호) + 토큰 보유면 provisional 로그인 (콜드스타트 스플래시 흐름 — MOBILE-002 R-N3)", () => {
    // 콜드스타트 시 SecureStore 캐시 토큰이 있고 아직 web→native 핸드셰이크(synced/none)가 도착하지
    // 않은 상태. 캐시 토큰을 신뢰해 provisional 로 로그인 처리한다 — splash 동안 (tabs)/home 으로 향하고,
    // 이후 핸드셰이크 결과(none/cleared)가 도착하면 그때 재평가된다.
    expect(
      deriveAuthState({ tokens: TOKENS, lastBridgeSignal: null }),
    ).toEqual({ isSignedIn: true, redirectTo: ROUTE_SIGNED_IN });
  });
});

describe("라우트 상수 (R-AS5: /me 미참조 — 네이티브 라우트만)", () => {
  it("로그인/미로그인 목적지는 네이티브 expo-router 그룹 경로다", () => {
    expect(ROUTE_SIGNED_IN).toBe("(tabs)/home");
    expect(ROUTE_SIGNED_OUT).toBe("(auth)/login");
  });

  it("어떤 결과도 /me 를 목적지로 쓰지 않는다 (R-AS5 부정 불변)", () => {
    expect(ROUTE_SIGNED_IN).not.toContain("/me");
    expect(ROUTE_SIGNED_OUT).not.toContain("/me");
  });
});
