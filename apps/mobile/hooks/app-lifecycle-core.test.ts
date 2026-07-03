// useAppLifecycle 추출 분기 특성화 테스트 (SPEC-WEBVIEW-SHELL-001 R-S6/AC-S6).
//
// 행위 보존(characterization) 게이트: App.tsx 에서 추출한 Android 하드웨어 백 분기가 추출 전후
// 동일함을 자동으로 검증한다. oauth-bridge.test.ts 패턴(expo/RN import 0, 순수 로직)을 따른다.
import { describe, it, expect } from "vitest";

import { decideBackPress } from "./app-lifecycle-core";

describe("decideBackPress (R-U1 / AC-S6: Android 백 핸들러 분기)", () => {
  it("canGoBack true → goBack (WebView.goBack 호출, 이벤트 소비)", () => {
    expect(decideBackPress(true)).toBe("goBack");
  });

  it("canGoBack false → exit (기본 종료 동작 허용)", () => {
    expect(decideBackPress(false)).toBe("exit");
  });
});

// ── SPEC-MOBILE-003 route-context 확장 (R-NC4 / AC-6) — additive ────────────────────
describe("decideBackPress — route-context 확장 (R-NC4 / AC-6: (tabs) 네이티브 back)", () => {
  it("(tabs) 컨텍스트면 native-back (canGoBack 무관 — expo-router 네이티브 네비게이션 위임)", () => {
    expect(decideBackPress(true, "(tabs)")).toBe("native-back");
    expect(decideBackPress(false, "(tabs)")).toBe("native-back");
  });

  it("(auth) 컨텍스트는 기존 동작 보존 ((auth)/login WebView back 유지)", () => {
    expect(decideBackPress(true, "(auth)")).toBe("goBack");
    expect(decideBackPress(false, "(auth)")).toBe("exit");
  });

  it("routeContext 미지정(undefined)은 기존 동작 그대로 (회귀 0)", () => {
    expect(decideBackPress(true)).toBe("goBack");
    expect(decideBackPress(false)).toBe("exit");
  });
});

// ── SPEC-MOBILE-NAV-001 web-history 정합 확장 (REQ-MOBNAV-022) — additive ────────────
// (tabs) 안에서 chat/schedule/expenses 는 home/[id] WebView 안 soft-nav 다. native-back 이 상세
// 전체를 pop 하지 않도록, 웹이 in-app back 가능(webCanGoBack)을 보고하면 web-history 경로(nav:back)
// 로 위임한다. 웹이 route root 라고 보고하면 기존 (tabs) native-back 동작을 유지한다.
describe("decideBackPress — web-history 정합 확장 (REQ-MOBNAV-022)", () => {
  it("(tabs) + 웹이 in-app back 가능(webCanGoBack=true) → web-back (nav:back 위임 — 상세 전체 pop 아님)", () => {
    expect(decideBackPress(true, "(tabs)", true)).toBe("web-back");
    // canGoBack(WebView 레벨)과 무관 — webCanGoBack 이 웹 in-app 히스토리 신호다.
    expect(decideBackPress(false, "(tabs)", true)).toBe("web-back");
  });

  it("(tabs) + 웹이 route root(webCanGoBack=false) → native-back (기존 (tabs) 동작 유지)", () => {
    expect(decideBackPress(true, "(tabs)", false)).toBe("native-back");
    expect(decideBackPress(false, "(tabs)", false)).toBe("native-back");
  });

  it("(tabs) + webCanGoBack 미지정(undefined) → native-back (기본값 = 기존 동작 보존, 회귀 0)", () => {
    // 4번째 인자 부재 시 (tabs) 는 기존과 동일하게 native-back 이어야 한다(Phase 3 배선 전 무회귀).
    expect(decideBackPress(true, "(tabs)")).toBe("native-back");
    expect(decideBackPress(false, "(tabs)")).toBe("native-back");
  });

  it("(auth) 는 webCanGoBack 신호와 무관하게 기존 동작 보존 (web-back 은 (tabs) 전용)", () => {
    // REQ-MOBNAV-022 는 "WHILE in (tabs) shell context" 한정 — (auth) 는 WebView 히스토리 그대로.
    expect(decideBackPress(true, "(auth)", true)).toBe("goBack");
    expect(decideBackPress(false, "(auth)", true)).toBe("exit");
    expect(decideBackPress(true, "(auth)", false)).toBe("goBack");
  });

  it("routeContext 미지정 + webCanGoBack 지정도 기존 동작 보존 (web-back 은 (tabs) 전용)", () => {
    expect(decideBackPress(true, undefined, true)).toBe("goBack");
    expect(decideBackPress(false, undefined, true)).toBe("exit");
  });
});
