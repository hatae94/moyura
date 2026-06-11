// useAppLifecycle 의 순수 결정 로직 (SPEC-WEBVIEW-SHELL-001 R-S4/R-S6, AC-S4/AC-S6).
//
// 이 모듈은 expo/RN import 가 전혀 없는 순수 함수만 제공한다 — vitest node 환경에서 단위
// 테스트 가능하다. App.tsx 에 인라인이던 Android 하드웨어 백 분기를 행위 보존으로 추출한다.
//
// ── seam (SPEC-MOBILE-002) ──────────────────────────────────────────────────────
// 이 모듈은 SPEC-MOBILE-001 의 기존 동작만 담는다(토큰 로직 0). AppState/스플래시/토큰 로드는
// SPEC-MOBILE-002 가 채울 자리다 — 여기서는 비워둔다.

/**
 * Android 하드웨어 백 분기 결정(R-U1)을 순수 함수로 추출한다. App.tsx 의 onBackPress 분기를 담는다.
 *
 * - 히스토리가 있으면(canGoBack) WebView 를 뒤로 보낸다 → `"goBack"`.
 * - 히스토리가 없으면 기본 종료 동작을 허용한다 → `"exit"`.
 *
 * @param canGoBack WebView 네비게이션 히스토리 존재 여부(onNavigationStateChange 로 추적)
 * @returns `"goBack"` (WebView.goBack 호출 + 이벤트 소비) 또는 `"exit"` (기본 종료 허용)
 */
export function decideBackPress(canGoBack: boolean): "goBack" | "exit" {
  return canGoBack ? "goBack" : "exit";
}

// ── SPEC-MOBILE-002 토큰/라이프사이클 확장 (R-N6/R-R1) ──────────────────────────────
// 아래는 useAppLifecycle 가 스플래시/resume 처리에 호출할 순수 결정 로직이다(여전히 expo/RN import 0).

/** 콜드스타트 핸드셰이크 진행 상태 — 타임아웃 시점에 결과(synced/none)가 수신됐는지. */
export interface SplashTimeoutState {
  /** R-N4 결과(session:synced/none)를 이미 수신했는지. true 면 스플래시는 이미 숨겨졌다. */
  handshakeResolved: boolean;
}

/**
 * 콜드스타트 핸드셰이크 bounded 타임아웃 경과 시 스플래시 처리를 결정한다(R-N6).
 *
 * 웹 미응답/핸들러 미등록/네트워크 단절로 결과(synced/none)가 도착하지 않으면, 타임아웃이 스플래시를
 * 강제로 해제하고 기존 웹 가드 라우팅으로 폴백한다 — 무한 스플래시 금지(AC-N6). 타임아웃 전에 이미
 * 핸드셰이크가 해결됐으면 noop(결과 수신 시 R-N4 가 이미 스플래시를 숨겼다).
 *
 * @param state 타임아웃 시점의 핸드셰이크 해결 여부
 * @returns "hide-and-fallback"(스플래시 강제 해제 + 웹가드 폴백) | "noop"
 */
export function decideSplashOnTimeout(
  state: SplashTimeoutState,
): "hide-and-fallback" | "noop" {
  return state.handshakeResolved ? "noop" : "hide-and-fallback";
}

/** AppState 전이 — RN AppStateStatus 와 같은 문자열 집합(순수 유지 위해 string 으로 받는다). */
export interface AppStateTransition {
  /** 직전 AppState(예: "background" | "inactive" | "active"). */
  prev: string;
  /** 새 AppState. */
  next: string;
  /** 캐시된 토큰을 보유 중인지(재검증할 대상이 있는지). */
  hasTokens: boolean;
}

/**
 * AppState 전이로 resume 재검증을 트리거할지 결정한다(R-R1, debounce 포함).
 *
 * - 비활성(background/inactive) → active 전이이고 토큰 보유 시에만 revalidate.
 * - active → active 연속/중복 발화는 skip(debounce — 직전 상태 비교로 중복 주입·refresh 경합 방지, B-2).
 * - 토큰 미보유면 skip(재검증할 토큰 없음 — 콜드스타트 핸드셰이크 소관).
 * - active 가 아닌 전이는 skip.
 *
 * NOTE: origin allowlist 선통과(R-T6, H-3)는 useAuthBridge 의 isTrustedOrigin 가 주입 직전에 별도로
 * 강제한다 — 이 함수는 "전이가 resume 재검증을 유발하는가"만 결정한다.
 *
 * @param t 직전·새 AppState + 토큰 보유 여부
 * @returns "revalidate"(토큰 주입 + resume:revalidate) | "skip"
 */
export function decideResumeFromAppState(t: AppStateTransition): "revalidate" | "skip" {
  if (t.next !== "active") {
    return "skip";
  }
  if (t.prev === "active") {
    return "skip"; // active → active 중복 발화 — debounce.
  }
  if (!t.hasTokens) {
    return "skip"; // 재검증할 토큰 없음.
  }
  return "revalidate";
}
