// webview-fade-core 순수 결정 모듈 단위 테스트 (SPEC-WEBVIEW-NATIVE-FEEL-001 M2/T-003 회귀 수정).
//
// 회귀: 1fced6b 가 WebView 를 opacity 0 으로 시작하는 Animated.View 로 감싸, iOS WKWebView 가
// 비가시(opacity 0)로 판정→JS/핸드셰이크 서스펜드→(tabs)/home 새 WebView 의 session:restore 핸드셰이크가
// session:none 으로 귀결→deriveAuthState 가 isSignedIn=false 로 뒤집어 메인 진입 직후 로그인으로 바운스.
//
// 이 테스트는 그 회귀의 load-bearing 불변식을 순수 레벨에서 고정한다: "페이드인은 WebView 를 숨겨서가
// 아니라 위에 덮인 커버를 페이드아웃해 구현하므로, WebView 자체의 opacity 는 항상 1(가시/활성)이다."
// (end-to-end 비가시→none 사슬 자체는 WKWebView 런타임/디바이스 레벨이라 node 에서 직접 재현 불가 —
//  여기서는 그 사슬을 유발하는 단일 원인 'WebView opacity 0 시작'을 금지하는 불변식을 검증한다.)
import { describe, it, expect } from "vitest";

import {
  WEBVIEW_VISIBLE_OPACITY,
  COVER_OPACITY_LOADING,
  COVER_OPACITY_LOADED,
  coverOpacityOnLoadStart,
  coverOpacityOnLoadEnd,
} from "./webview-fade-core";

describe("webview-fade-core (M2/T-003 회귀: WebView 를 숨기지 않는 페이드인)", () => {
  it("[HARD 불변] WebView 레이어 opacity 는 항상 1 — 절대 0 이 될 수 없다 (WKWebView 서스펜드→로그인 바운스 방지)", () => {
    // 회귀의 직접 원인은 WebView 가 opacity 0 으로 마운트돼 WKWebView 가 핸드셰이크를 서스펜드한 것.
    // 페이드는 커버가 담당하므로 WebView 자체는 항상 가시(=활성)여야 한다.
    expect(WEBVIEW_VISIBLE_OPACITY).toBe(1);
    expect(WEBVIEW_VISIBLE_OPACITY).not.toBe(0);
  });

  it("페이드 커버는 로드 시작에 불투명(1)으로 콘텐츠를 가린다 (흰 깜빡임 제거 — 시각 효과 보존)", () => {
    expect(COVER_OPACITY_LOADING).toBe(1);
    expect(coverOpacityOnLoadStart()).toBe(1);
  });

  it("페이드 커버는 로드 완료에 투명(0)으로 페이드아웃해 콘텐츠를 드러낸다 (콘텐츠 페이드인과 시각적 동일)", () => {
    expect(COVER_OPACITY_LOADED).toBe(0);
    expect(coverOpacityOnLoadEnd()).toBe(0);
  });

  it("페이드 방향이 1fced6b 와 반대다 — 사라지는 건 커버지 WebView 가 아니다 (가시성 보존 불변)", () => {
    // 1fced6b: WebView opacity 0→1 (WebView 가 숨겨졌다 나타남 — 서스펜드 유발).
    // 수정: cover opacity 1→0 (WebView 는 항상 1, 커버만 사라짐 — 서스펜드 없음).
    expect(coverOpacityOnLoadStart()).toBeGreaterThan(coverOpacityOnLoadEnd());
    expect(WEBVIEW_VISIBLE_OPACITY).toBeGreaterThan(COVER_OPACITY_LOADED);
  });
});
