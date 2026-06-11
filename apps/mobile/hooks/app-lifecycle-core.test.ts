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
