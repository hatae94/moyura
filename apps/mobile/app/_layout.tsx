// 루트 레이아웃 (SPEC-MOBILE-003 R-RT3/R-RT5) — App.tsx 루트 오케스트레이션 행위 보존 이전.
//
// expo-router 단일 진입(R-RT5). App.tsx 의 라우터 우회 default-export 렌더 경로를 대체한다.
// App.tsx 가 모듈 평가 시점에 하던 SplashScreen.preventAutoHideAsync 를 여기서 보존하고(콜드스타트
// 핸드셰이크 동안 스플래시 유지 — R-N3/OD-8), AuthProvider 를 마운트해 인증 상태 단일 소스를 제공한다.
// 콜드스타트 토큰 로드/핸드셰이크 타임아웃/세션 주입 등 화면 결합 오케스트레이션은 AuthProvider 와
// 랜딩 화면의 BridgedWebView(useAppLifecycle/useAuthBridge)가 행위 보존해 수행한다(App.tsx 분해).
//
// @MX:WARN: [AUTO] 엔트리 포인트 전환 지점 — registerRootComponent(App) → expo-router/entry + 이 루트
//           레이아웃. 스플래시 자동 숨김 방지·AuthProvider 마운트·루트 Stack 그룹 정의가 여기 모인다.
// @MX:REASON: 엔트리 전환은 세션 부트/스플래시 회귀 위험 HIGH(SPEC-MOBILE-003 R-RT3 risk #1). 모듈
//   평가 시점 preventAutoHideAsync 누락 시 콜드스타트에서 스플래시가 즉시 사라져 핸드셰이크 깜빡임이
//   노출되고, AuthProvider 미마운트 시 useAuth 가 throw 해 전 라우트가 깨진다. 콜드스타트 스플래시/
//   핸드셰이크/타임아웃 보존은 디바이스 검증 대상이다(AC-4 런타임).
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../lib/auth/AuthContext";
import { configureGoogleSignIn } from "../lib/auth/google-signin";
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from "../lib/env";
import { registerNotificationTapHandler } from "../lib/push/notification-handler";

// R-N3/OD-8: 콜드스타트 핸드셰이크 동안 스플래시를 유지한다 — 모듈 평가 시점에 자동 숨김을 막는다
// (App.tsx 모듈 평가 시점 호출 보존). 실패해도 throw 하지 않게 흡수(스플래시 미지원/이미 숨김 등).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

// SPEC-MOBILE-004 R-MOB4-001: Google Sign-In SDK 를 부팅 시 1회 설정한다(signInWithGoogle 선행 조건).
// 두 client ID 가 모두 설정된 경우에만 호출한다 — 미설정 시(이메일/비번 전용 환경) Google 로그인만
// 비활성화되고 앱 부팅은 정상 진행된다(env 가 옵셔널인 이유). webClientId 는 signInWithIdToken 의
// audience(Supabase Google provider client_id 와 동일), iosClientId 는 네이티브 iOS Sign-In 용.
if (GOOGLE_WEB_CLIENT_ID && GOOGLE_IOS_CLIENT_ID) {
  configureGoogleSignIn({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    iosClientId: GOOGLE_IOS_CLIENT_ID,
  });
}

// SPEC-CHAT-002 R-PUSH-007: 포그라운드에서도 알림 배너/목록을 표시한다(기본은 포그라운드 비표시 — 앱이
// 떠 있을 때 새 메시지 알림이 묻히는 것을 막는다). 소리는 켜고 배지는 쓰지 않는다(인앱 배지 미사용).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// 채팅 URL(`${WEB_URL}/moims/{id}/chat`)에서 moimId 를 추출한다 — 탭 핸들러가 준 URL 을 네이티브 라우트
// 파라미터로 변환하기 위함. 형식이 어긋나면 null(이동 생략 — 앱 열기만).
function moimIdFromChatUrl(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const index = segments.indexOf("moims");
    const moimId = index >= 0 ? segments[index + 1] : undefined;
    return moimId && moimId.length > 0 ? moimId : null;
  } catch {
    return null;
  }
}

/**
 * 루트 레이아웃 — AuthProvider + 루트 Stack((auth)/(tabs) 그룹). 헤더는 전 그룹에서 숨긴다
 * (네이티브 크롬은 (tabs) 의 Tabs 가, 인증 화면은 WebView 가 담당 — headerShown:false).
 */
export default function RootLayout(): React.JSX.Element {
  // SPEC-CHAT-002 R-PUSH-007: 알림 탭 → 대상 모임 채팅으로 네이티브 이동. 포그라운드/백그라운드 탭과
  // 콜드스타트(앱 종료 상태에서 탭으로 기동)를 핸들러가 모두 처리한다. 대상 모임은 `?target=chat` 으로
  // (tabs)/home/[id] 에 넘겨 채팅 화면을 직접 로드한다(detail-push 와 동일한 router.push 패턴 — OD-1 안전).
  useEffect(() => {
    return registerNotificationTapHandler((url) => {
      const moimId = moimIdFromChatUrl(url);
      if (!moimId) {
        return;
      }
      router.push(`/(tabs)/home/${encodeURIComponent(moimId)}?target=chat` as never);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        {/* animation:"none" — 페이지 전환 슬라이드(iOS slide-from-right)를 제거한다(요청). */}
        <Stack screenOptions={{ headerShown: false, animation: "none" }}>
          {/* 진입 분기(index) + (auth)/(tabs) 그룹은 파일 기반으로 자동 등록된다. */}
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          {/* SPEC-MOIM-011: 초대 수락 딥링크(moyura://invite/{token}) — (tabs)/(auth) 밖 공개 라우트. */}
          <Stack.Screen name="invite/[token]" />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
