// WebView 페이드인 모델의 순수 결정 로직 (SPEC-WEBVIEW-NATIVE-FEEL-001 M2/T-003 회귀 수정).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 상수/함수만 제공한다 — vitest node 환경에서 mock 없이
// 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션). WebViewShell 의 "흰 깜빡임 제거" 페이드인을
// "WebView 자체를 숨기지 않고" 구현하기 위한 불변식을 데이터로 표현한다.
//
// ── 회귀 배경(왜 이 모듈이 필요한가) ───────────────────────────────────────────────
// 1fced6b 는 WebView 를 opacity 0 으로 시작하는 Animated.View 로 감쌌다(로드 완료 시 0→1 페이드).
// iOS WKWebView 는 자신의 레이어가 완전 투명(opacity 0)이면 "비가시(occluded)"로 판정해 페이지의
// ActivityState.IsVisible 을 false 로 두고, 비가시 페이지의 JS/타이머/렌더를 스로틀·서스펜드한다
// (document.visibilityState='hidden'). 그 결과 (tabs)/home 의 *새* WebView 가 opacity 0 으로 마운트되는
// 동안 session:restore 핸드셰이크(setSession→synced/none 회신)가 비가시 상태에서 구동돼 회신이
// 지연·교란되고, 서버 가드의 fail-closed + 교차 WebView 쿠키 타이밍과 맞물려 핸드셰이크가 결정적으로
// session:none 으로 귀결된다 → reportSignal('session:none') → deriveAuthState 가 isSignedIn 을 false 로
// 뒤집어 메인 진입 직후 로그인으로 바운스한다.
//
// ── 불변식(이 모듈이 강제) ──────────────────────────────────────────────────────────
// 페이드인은 WebView 를 숨겨서가 아니라, WebView 위에 덮인 *불투명 커버(스켈레톤 배경)* 를 1→0 으로
// 페이드아웃해 구현한다. WebView 자체의 opacity 는 항상 1(가시/활성)이라 WKWebView 가 핸드셰이크 도중
// 서스펜드되지 않는다. 시각 효과(브랜드 배경에서 콘텐츠가 떠오르는 페이드)는 동일하게 보존된다.

/**
 * WebView 레이어의 고정 opacity. 항상 1(가시/활성)이어야 한다.
 *
 * [HARD 불변] 이 값은 절대 0 이 될 수 없다. WKWebView 가 비가시(opacity 0)면 JS/핸드셰이크를 서스펜드해
 * 홈 진입 핸드셰이크가 session:none 으로 귀결되고 로그인 바운스가 발생한다(위 회귀 배경 참조).
 */
export const WEBVIEW_VISIBLE_OPACITY = 1 as const;

/**
 * 페이드 커버(WebView 위에 덮이는 불투명 스켈레톤 배경)의 로드 시작 시 opacity.
 * 로드 시작에는 커버가 불투명(1)이라 흰 깜빡임/미완성 콘텐츠를 가린다.
 */
export const COVER_OPACITY_LOADING = 1 as const;

/**
 * 페이드 커버의 로드 완료 시 목표 opacity. 0 으로 페이드아웃하면 아래의 WebView 콘텐츠가 드러난다
 * (콘텐츠가 브랜드 배경에서 떠오르는 페이드인과 시각적으로 동일).
 */
export const COVER_OPACITY_LOADED = 0 as const;

/** 페이드아웃 지속 시간(ms) — 1fced6b 의 200ms 페이드 체감을 보존한다. */
export const COVER_FADE_DURATION_MS = 200 as const;

/**
 * 페이드 커버의 로드 시작 시 초기 opacity 를 돌려준다(재로드/handleLoadStart 에서 커버를 다시 불투명으로 리셋).
 * @returns 1(커버 불투명 — 콘텐츠 가림)
 */
export function coverOpacityOnLoadStart(): typeof COVER_OPACITY_LOADING {
  return COVER_OPACITY_LOADING;
}

/**
 * 페이드 커버의 로드 완료 시 목표 opacity 를 돌려준다(handleLoadEnd 에서 커버를 0 으로 페이드아웃).
 * @returns 0(커버 투명 — 콘텐츠 노출)
 */
export function coverOpacityOnLoadEnd(): typeof COVER_OPACITY_LOADED {
  return COVER_OPACITY_LOADED;
}
