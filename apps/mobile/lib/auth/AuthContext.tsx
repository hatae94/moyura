// 네이티브 인증 상태 컨텍스트 (SPEC-MOBILE-003 R-AS1/R-AS2/R-NC5/R-PR2/R-PR5).
//
// 네이티브 라우트 가드(R-AS3)의 단일 인증 소스다. isSignedIn 은 오직 SecureStore 토큰 캐시 +
// bridge `session:synced/none/cleared` 신호로만 도출한다(deriveAuthState — R-AS1/R-AS5). 웹 `/me`
// 페이지의 세션 상태를 네이티브 인증 소스로 읽지 않는다(R-AS5 부정 불변).
//
// 책임 분담(App.tsx 행위 보존 분해):
//   - AuthContext(여기): per-session nonce 1회 생성, 콜드스타트 토큰 로드, lastBridgeSignal 추적,
//     isSignedIn/isLoading 도출. 가드/진입 분기(index/(auth)/(tabs))가 이 값을 소비한다.
//   - BridgedWebView(components): 화면별 WebView + useAuthBridge + useAppLifecycle 오케스트레이션
//     (App.tsx 본문 보존). 콜드스타트 session:restore 주입·스플래시 해제·핸드셰이크 타임아웃은
//     랜딩 화면의 useAppLifecycle 가 수행하고, 수신 신호를 reportSignal 로 이 컨텍스트에 보고한다.
//
// 전환 메커니즘(선언적 가드 — imperative router.replace 중복 회피):
//   - 로그인 완료(session:synced) → reportSignal → isSignedIn=true → (auth)/_layout 가
//     <Redirect href="/(tabs)/home"/> 로 전환한다(R-NC5).
//   - 로그아웃(session:cleared) → reportSignal → isSignedIn=false → (tabs)/_layout 가
//     <Redirect href="/(auth)/login"/> 로 전환한다(R-PR5).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { loadTokens, type SessionTokens } from "./token-store";
import { generateBridgeNonce } from "./nonce-core";
import {
  deriveAuthState,
  type AuthBridgeSignal,
} from "./auth-state-core";

/** AuthContext 가 노출하는 인증 상태 + 신호 보고 채널. */
export interface AuthContextValue {
  /** R-AS1/R-AS2: SecureStore 토큰 + bridge 신호로 도출한 로그인 여부(가드 결정의 단일 소스). */
  isSignedIn: boolean;
  /** 콜드스타트 토큰 로드가 끝나기 전(true) — index 진입 분기가 깜빡임 없이 대기한다. */
  isLoading: boolean;
  /** R-T8/OD-11: per-session one-time nonce. 모든 화면의 BridgedWebView 가 공유한다(콜드스타트 1회 생성). */
  nonce: string;
  /**
   * web→native 상태 신호를 보고한다(BridgedWebView 의 useAuthBridge onMessage 경로에서 호출).
   * synced 면 갱신 토큰을 함께 받아 캐시를 동기화한다 — 가드가 즉시 재평가된다(R-NC5/R-PR5).
   */
  reportSignal: (signal: AuthBridgeSignal, tokens?: SessionTokens | null) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * 네이티브 인증 상태 공급자(root _layout 에 1회 마운트). 콜드스타트 토큰 로드 + bridge 신호 추적으로
 * isSignedIn 을 도출하고, 화면의 BridgedWebView 가 보고하는 신호로 상태를 갱신한다.
 *
 * @MX:ANCHOR: [AUTO] 네이티브 인증 상태의 단일 공급원 — index 진입 분기·(auth)/(tabs) 가드·모든
 *             BridgedWebView 가 useAuth 로 소비한다(fan_in >= 3).
 * @MX:REASON: 이 컨텍스트가 틀리면 미인증 사용자가 (tabs) 에 진입하거나(보안) 로그인 사용자가 로그인
 *             화면에 갇힌다(R-AS3 가드 계약). 신호/토큰 동기화 누락 시 R-NC5(로그인 후 전환)·R-PR5
 *             (로그아웃 전환)가 깨진다. 인증 소스는 토큰+bridge 신호뿐이다(웹 /me 미참조 — R-AS5).
 */
export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  // R-T8: per-session one-time nonce — 콜드스타트 시 1회 생성(앱 인스턴스 수명 동안 고정, App.tsx nonceRef 보존).
  const nonceRef = useRef<string>("");
  if (!nonceRef.current) {
    nonceRef.current = generateBridgeNonce();
  }

  // R-AS1: SecureStore 토큰 캐시(콜드스타트 로드 + synced/none/cleared 로 갱신).
  const [tokens, setTokens] = useState<SessionTokens | null>(null);
  // R-AS2: 마지막 web→native 상태 신호(핸드셰이크 전이면 null — 콜드스타트 provisional).
  const [lastBridgeSignal, setLastBridgeSignal] = useState<AuthBridgeSignal>(null);
  // 콜드스타트 토큰 로드 완료 여부(진입 분기 깜빡임 방지).
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // R-AS1/R-N3: 콜드스타트 — SecureStore 토큰 로드(provisional 인증 시드). App.tsx 콜드스타트 진입 보존.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let loaded: SessionTokens | null = null;
      try {
        loaded = await loadTokens();
      } catch (error) {
        // 토큰 로드 실패 시 미로그인 fail-safe 로 진행(무한 로딩/크래시 금지) — 원인은 로그로 보존.
        console.error("[AuthContext] 콜드스타트 loadTokens 실패 — 미로그인으로 진행:", error);
      }
      if (cancelled) {
        return;
      }
      setTokens(loaded);
      setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // R-NC5/R-PR5/R-AS2: 화면이 보고한 신호로 상태를 갱신한다(synced 면 갱신 토큰 캐시 동기화,
  // none/cleared 면 토큰 캐시 무효화 — deriveAuthState 가 부정 신호를 우선해 미로그인 처리).
  const reportSignal = useCallback(
    (signal: AuthBridgeSignal, nextTokens?: SessionTokens | null): void => {
      setLastBridgeSignal(signal);
      if (signal === "session:synced" && nextTokens) {
        setTokens(nextTokens);
      } else if (signal === "session:none" || signal === "session:cleared") {
        // 부정 신호 — 토큰 캐시도 무효화한다(SecureStore clearTokens 는 useAuthBridge 가 별도 수행).
        setTokens(null);
      }
      // 신호 수신은 콜드스타트 핸드셰이크 결과이기도 하므로 로딩을 종료한다(스플래시는 화면이 해제).
      setIsLoading(false);
    },
    [],
  );

  const value = useMemo<AuthContextValue>(() => {
    const { isSignedIn } = deriveAuthState({ tokens, lastBridgeSignal });
    return {
      isSignedIn,
      isLoading,
      nonce: nonceRef.current,
      reportSignal,
    };
  }, [tokens, lastBridgeSignal, isLoading, reportSignal]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** AuthProvider 하위에서 인증 상태를 읽는다. Provider 밖 사용은 개발 단계 실수이므로 throw 한다. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("[moyura/mobile] useAuth 는 <AuthProvider> 내부에서만 사용할 수 있습니다.");
  }
  return ctx;
}
