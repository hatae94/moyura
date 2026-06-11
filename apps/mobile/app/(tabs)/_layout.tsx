// (tabs) 그룹 레이아웃 (SPEC-MOBILE-003 R-WB5/R-AS3/R-PR5) — 네이티브 탭바 + 가드.
//
// expo-router Tabs 로 Figma BottomTabBar 를 RN 네이티브 탭바로 재해석한다(R-WB5): 4개 탭(홈/탐색/
// 알림/마이), active #ff6b35 primary / inactive #8a8074 muted, 알림 배지 mock 카운트 2(tabBarBadge),
// safe-area 는 Tabs + react-native-safe-area-context 가 처리한다. 아이콘은 @expo/vector-icons 가
// 이 설치 레이아웃에 부재하므로(divergence) 의존성 추가 없이 이모지 글리프(Text)로 근사한다 —
// lucide-react-native 는 도입하지 않는다(Exclusions).
//
// 가드(R-AS3/R-PR5): isSignedIn=false 면 (tabs) 진입 금지 → (auth)/login 으로 선언적 <Redirect>.
// 로그아웃(session:cleared) → AuthContext isSignedIn=false → 이 레이아웃 재평가 → login 전환(R-PR5,
// imperative 전환 없이 선언적 가드로 처리). Tabs.Protected 대신 그룹 레이아웃 <Redirect> 가드를
// 택했다(전 패치 버전에서 가용 보장 + 디바이스 검증 흐름이 명시적 — 권장 폴백, tasks.md T-009 #3).
import { Redirect, Tabs } from "expo-router";
import { StyleSheet, Text, type ColorValue } from "react-native";

import { useAuth } from "../../lib/auth/AuthContext";
import { ROUTE_SIGNED_OUT } from "../../lib/auth/auth-state-core";

// Figma 탭바 토큰 — active(primary)/inactive(muted). 디자인 토큰 파이프라인 없이 수동 추출(Exclusions).
const ACTIVE_TINT = "#ff6b35";
const INACTIVE_TINT = "#8a8074";

// 알림 탭 mock 배지 카운트(실 데이터/API 연동 없음 — Exclusions: 알림 배지 mock).
const NOTIFICATIONS_BADGE_MOCK = 2;

/** 의존성 없는 이모지 탭 아이콘(Home/Compass/Bell/User 근사 — @expo/vector-icons 부재 divergence). */
function TabGlyph({ glyph, color }: { glyph: string; color: ColorValue }): React.JSX.Element {
  return <Text style={[styles.glyph, { color }]}>{glyph}</Text>;
}

export default function TabsLayout(): React.JSX.Element {
  const { isSignedIn } = useAuth();
  // R-AS3/R-PR5: 미로그인이면 탭 진입 금지 → (auth)/login 으로 선언적 전환.
  if (!isSignedIn) {
    return <Redirect href={`/${ROUTE_SIGNED_OUT}` as never} />;
  }
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE_TINT,
        tabBarInactiveTintColor: INACTIVE_TINT,
        // OD-4: 탭 WebView 는 lazy 마운트(첫 포커스 시 마운트) — bottom-tabs 기본값을 명시한다.
        lazy: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "홈",
          tabBarIcon: ({ color }) => <TabGlyph glyph="🏠" color={color} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "탐색",
          tabBarIcon: ({ color }) => <TabGlyph glyph="🧭" color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: "알림",
          tabBarIcon: ({ color }) => <TabGlyph glyph="🔔" color={color} />,
          // R-WB5: 알림 배지 mock 카운트(네이티브 탭바 배지).
          tabBarBadge: NOTIFICATIONS_BADGE_MOCK,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "마이",
          tabBarIcon: ({ color }) => <TabGlyph glyph="👤" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontSize: 22,
    lineHeight: 26,
  },
});
