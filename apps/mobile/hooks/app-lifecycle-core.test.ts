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
