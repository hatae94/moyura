// 앱 라이프사이클 훅 (SPEC-WEBVIEW-SHELL-001 R-S4 / SPEC-MOBILE-002 M1·M3) — App.tsx 에서 합성.
//
// SPEC-WEBVIEW-SHELL-001 의 기존 동작(Android 하드웨어 백 + 네비게이션 히스토리)을 보존하면서,
// SPEC-MOBILE-002 가 진입/재개 라이프사이클을 얹는다:
//   - 콜드스타트: SecureStore 토큰 로드(R-N3) → 호출부에 전달(주입은 useAuthBridge), 현재 origin 추적.
//   - 핸드셰이크 타임아웃: bounded 타이머 → 미해결 시 스플래시 강제 해제 폴백(R-N6, 무한 스플래시 금지).
//   - resume: AppState active 전이 + 토큰 보유 + debounce 통과 시 호출부에 resume 재검증 요청(R-R1).
//
// 분기 결정은 모두 순수 app-lifecycle-core.ts 에 위임한다(node 단위 테스트). 토큰 값은 다루되
// 로깅하지 않으며, origin allowlist 선통과는 useAuthBridge 의 inject 함수가 강제한다(R-T6/H-3).
import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  AppState,
  BackHandler,
  Platform,
  type AppStateStatus,
  type NativeEventSubscription,
} from "react-native";
import type WebView from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview/lib/WebViewTypes";

import type { SessionTokens } from "../lib/auth/token-store";
import {
  decideBackPress,
  decideSplashOnTimeout,
  decideResumeFromAppState,
} from "./app-lifecycle-core";

/** useAppLifecycle 인자. */
export interface UseAppLifecycleArgs {
  /** WebView 인스턴스 ref(호출부 소유 — 리마운트 회피, OD-1). */
  webViewRef: RefObject<WebView | null>;
  /**
   * resume(AppState active + 토큰 보유 + debounce 통과) 시 호출 — 호출부가 현재 URL 로
   * useAuthBridge.injectRevalidate 를 실행한다(R-R1). 토큰 보유 여부는 tokensRef 로 판단.
   */
  onResumeRevalidate: (tokens: SessionTokens, currentUrl: string) => void;
}

/** useAppLifecycle 리턴. */
export interface UseAppLifecycleResult {
  /** R-U1/R-R1: 네비게이션 히스토리(canGoBack) + 현재 URL(origin allowlist·resume 에 사용) 추적. */
  onNavigationStateChange: (nav: WebViewNavigation) => void;
  /** R-N3: 콜드스타트가 로드한 토큰을 라이프사이클에 등록한다(resume 재검증 대상 + 핸드셰이크 시작). */
  registerColdStartTokens: (tokens: SessionTokens | null) => void;
  /** R-N4: 콜드스타트 핸드셰이크가 해결됐음을 표시한다(타임아웃 타이머가 noop 으로 폴백). */
  markHandshakeResolved: () => void;
  /**
   * R-N3/R-N6: 콜드스타트 핸드셰이크 bounded 타임아웃을 시작한다 — 결과 미수신 시 onTimeout 으로
   * 스플래시 강제 해제 폴백(무한 스플래시 금지).
   */
  startHandshakeTimeout: (onTimeout: () => void) => void;
}

// 콜드스타트 핸드셰이크 bounded 타임아웃(ms) — 웹 미응답/핸들러 미등록/네트워크 단절 시 스플래시 해제(R-N6).
const HANDSHAKE_TIMEOUT_MS = 8000;

// @MX:ANCHOR: [AUTO] 진입/재개 라이프사이클의 단일 조정점 — 콜드스타트 토큰 로드·핸드셰이크 타임아웃·
//   resume 재검증이 모두 이 훅을 통과한다(App.tsx + resume + 콜드스타트 fan_in >= 3).
// @MX:REASON: R-N6 무한 스플래시 금지(타임아웃 폴백)와 R-R1 resume debounce(중복 주입·refresh 경합
//   방지)가 핸드셰이크 안정성의 핵심 불변식이다. 타이머/AppState 구독 누수 시 무한 스플래시나
//   중복 재검증이 발생할 수 있어 정리(cleanup)가 필수다.
export function useAppLifecycle({
  webViewRef,
  onResumeRevalidate,
}: UseAppLifecycleArgs): UseAppLifecycleResult {
  // R-U1: Android 하드웨어 백 분기용 네비게이션 히스토리.
  const canGoBackRef = useRef<boolean>(false);
  // R-T6/R-R1: origin allowlist·resume 재주입에 쓸 현재 WebView URL.
  const currentUrlRef = useRef<string>("");
  // R-R1: resume 재검증 대상 토큰(콜드스타트/synced 갱신 시 등록).
  const tokensRef = useRef<SessionTokens | null>(null);
  // R-N4/R-N6: 콜드스타트 핸드셰이크 해결 여부 + 타임아웃 타이머.
  const handshakeResolvedRef = useRef<boolean>(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // R-U1: Android 하드웨어 백 — 히스토리가 있으면 WebView.goBack(), 없으면 기본 종료(보존).
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }
    const onBackPress = (): boolean => {
      if (decideBackPress(canGoBackRef.current) === "goBack") {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    };
    const subscription: NativeEventSubscription = BackHandler.addEventListener(
      "hardwareBackPress",
      onBackPress,
    );
    return () => subscription.remove();
  }, [webViewRef]);

  // R-R1: AppState 구독 — active 전이 + 토큰 보유 + debounce 통과 시 resume 재검증을 호출부에 위임.
  useEffect(() => {
    let prev: AppStateStatus = AppState.currentState;
    const onChange = (next: AppStateStatus): void => {
      const tokens = tokensRef.current;
      const decision = decideResumeFromAppState({
        prev,
        next,
        hasTokens: tokens !== null,
      });
      prev = next; // 직전 상태 갱신(debounce 비교 기준 — B-2).
      if (decision === "revalidate" && tokens) {
        // origin allowlist 선통과(R-T6/H-3)는 onResumeRevalidate → injectRevalidate 가 강제한다.
        onResumeRevalidate(tokens, currentUrlRef.current);
      }
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [onResumeRevalidate]);

  // 타임아웃 타이머 정리(언마운트/해결 시 누수 방지).
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // R-U1/R-R1: 네비게이션 히스토리 + 현재 URL 추적(origin allowlist·resume 에 사용).
  const onNavigationStateChange = useCallback((nav: WebViewNavigation): void => {
    canGoBackRef.current = nav.canGoBack;
    currentUrlRef.current = nav.url;
  }, []);

  // R-N3: 콜드스타트가 로드한 토큰을 등록한다(resume 재검증 대상 — synced 수신 시 App.tsx 가 갱신).
  const registerColdStartTokens = useCallback((tokens: SessionTokens | null): void => {
    tokensRef.current = tokens;
  }, []);

  // R-N4: 핸드셰이크 해결 표시 — 타임아웃 타이머가 발화해도 noop 으로 폴백(이미 스플래시 숨김).
  const markHandshakeResolved = useCallback((): void => {
    handshakeResolvedRef.current = true;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // R-N6: 콜드스타트 핸드셰이크 bounded 타임아웃 — 결과 미수신 시 스플래시 강제 해제 폴백.
  const startHandshakeTimeout = useCallback((onTimeout: () => void): void => {
    handshakeResolvedRef.current = false;
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      // 타임아웃 시점에 미해결이면 스플래시 강제 해제 + 웹가드 폴백(무한 스플래시 금지).
      if (decideSplashOnTimeout({ handshakeResolved: handshakeResolvedRef.current }) === "hide-and-fallback") {
        onTimeout();
      }
    }, HANDSHAKE_TIMEOUT_MS);
  }, []);

  return {
    onNavigationStateChange,
    registerColdStartTokens,
    markHandshakeResolved,
    startHandshakeTimeout,
  };
}