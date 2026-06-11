// useAppLifecycle 토큰/라이프사이클 확장의 순수 결정 로직 테스트 (SPEC-MOBILE-002 R-N6/R-R1, AC-N6/AC-R1).
//
// SPEC-WEBVIEW-SHELL-001 의 Android 백 분기(app-lifecycle-core.test.ts)와 별개로, MOBILE-002 가
// useAppLifecycle 에 얹는 결정만 검증한다: 콜드스타트 핸드셰이크 타임아웃 → 스플래시 강제 해제 폴백
// 결정(R-N6), AppState 전이 debounce → 중복 resume 억제 결정(R-R1). expo/RN import 0.
import { describe, it, expect } from "vitest";

import {
  decideSplashOnTimeout,
  decideResumeFromAppState,
} from "./app-lifecycle-core";

describe("decideSplashOnTimeout (R-N6 / AC-N6: 콜드스타트 타임아웃 → 무한 스플래시 금지)", () => {
  it("핸드셰이크가 아직 미해결인데 타임아웃이 경과하면 hide-and-fallback", () => {
    expect(decideSplashOnTimeout({ handshakeResolved: false })).toBe("hide-and-fallback");
  });

  it("타임아웃 전에 이미 핸드셰이크가 해결됐으면 noop (스플래시는 결과 수신 시 이미 숨김)", () => {
    expect(decideSplashOnTimeout({ handshakeResolved: true })).toBe("noop");
  });
});

describe("decideResumeFromAppState (R-R1 / AC-R1: AppState debounce — 중복 active 억제)", () => {
  it("background → active 전이이고 토큰 보유면 revalidate (재검증 트리거)", () => {
    expect(
      decideResumeFromAppState({ prev: "background", next: "active", hasTokens: true }),
    ).toBe("revalidate");
  });

  it("inactive → active 전이도 resume 으로 취급한다 (iOS 포커스 복귀)", () => {
    expect(
      decideResumeFromAppState({ prev: "inactive", next: "active", hasTokens: true }),
    ).toBe("revalidate");
  });

  it("active → active 연속 발화는 skip (중복 억제 — debounce, refresh 경합 방지)", () => {
    expect(
      decideResumeFromAppState({ prev: "active", next: "active", hasTokens: true }),
    ).toBe("skip");
  });

  it("토큰 미보유면 active 전이라도 skip (재검증할 토큰 없음 — 콜드스타트 핸드셰이크 소관)", () => {
    expect(
      decideResumeFromAppState({ prev: "background", next: "active", hasTokens: false }),
    ).toBe("skip");
  });

  it("active 가 아닌 전이(→background/inactive)는 skip", () => {
    expect(
      decideResumeFromAppState({ prev: "active", next: "background", hasTokens: true }),
    ).toBe("skip");
    expect(
      decideResumeFromAppState({ prev: "active", next: "inactive", hasTokens: true }),
    ).toBe("skip");
  });
});
