// 네이티브 헤더 바 (SPEC-MOBILE-NAV-001 M1 — REQ-MOBNAV-001/002/003) — WebView 뷰포트 위 오버레이.
//
// 셸 모드 (tabs) 컨텍스트에서 헤더 필요 5페이지에 대해 WebView 위에 렌더되는 순수 프리젠테이셔널
// 헤더다. back chevron 영역 + 컨텍스트 타이틀을 그리며, status-bar top safe-area 인셋을 소유한다
// (BridgedWebView 가 이 헤더를 렌더할 때 WebViewShell edges 에서 top 을 제거해 이중 인셋을 막는다).
//
// [프리젠테이셔널 — 결정 로직 미보유] "헤더를 그릴지/chevron 을 보일지"는 nav-header-core.decideHeader
// 순수 함수가 결정한다. 이 컴포넌트는 navState 를 받아 decideHeader 로 결정을 산출하고 그 결정만 그린다
// (단일 진실 출처 = 웹 → decideHeader). 라우트 gating(어느 그룹에서 마운트할지)은 BridgedWebView 가
// 소유한다 — 이 컴포넌트는 (auth)/공개 라우트에서는 애초에 마운트되지 않고, 마운트돼도 headerVisible
// (헤더 필요 5페이지)이 false 면 렌더하지 않는다.
//
// 아이콘: 이 설치 레이아웃은 @expo/vector-icons/lucide-react-native 가 부재하므로((tabs)/_layout 의
// TabGlyph 와 동일 divergence) 의존성 추가 없이 텍스트 chevron 글리프(‹)로 근사한다(신규 의존성 0 — plan §11).
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { decideHeader, type NavState } from "../lib/nav-header-core";

export interface NativeHeaderBarProps {
  /**
   * 웹이 nav:state 로 보고한 현재 nav 상태({pathname,title,canGoBack}). null 이면(아직 미보고) 렌더하지
   * 않는다 — 첫 보고 전 빈 헤더 깜빡임을 피한다. decideHeader 로 헤더 가시성·chevron·타이틀을 산출한다.
   */
  navState: NavState | null;
  /**
   * back chevron 탭 콜백(REQ-MOBNAV-020). 호출부(BridgedWebView)가 useAuthBridge.injectNavBack 을
   * 연결해 nav:back 을 웹에 위임한다 — 웹이 router.back()/딥링크 첫 진입 시 /home 폴백을 결정한다(OD-2/OD-3).
   */
  onBackPress: () => void;
}

/**
 * 네이티브 헤더 바 — nav-header-core.decideHeader 결정을 그리는 프리젠테이셔널 컴포넌트.
 *
 * - headerVisible=false(헤더 필요 5페이지 아님) → null 렌더(탭 루트·보류 3페이지는 헤더 없음 — REQ-MOBNAV-003).
 * - showBackChevron=true(웹이 in-app back 가능 보고) → chevron 을 상호작용 어포던스로 표시(REQ-MOBNAV-002).
 *   false 면 chevron 자리를 비워 타이틀 정렬을 유지한다(title-only 헤더).
 * - headerTitle → 웹이 보고한 컨텍스트 타이틀(모임명 등 — 네이티브 미가공, 단일 진실 출처 = 웹).
 */
export function NativeHeaderBar({
  navState,
  onBackPress,
}: NativeHeaderBarProps): React.JSX.Element | null {
  // 첫 nav:state 보고 전에는 렌더하지 않는다(빈 헤더 방지). 보고 후 decideHeader 로 결정을 산출한다.
  if (!navState) {
    return null;
  }
  const { headerVisible, showBackChevron, headerTitle } = decideHeader(navState);
  // 헤더 필요 5페이지가 아니면 헤더 자체를 렌더하지 않는다(REQ-MOBNAV-003 — 크롬 오노출 방지).
  if (!headerVisible) {
    return null;
  }
  return (
    // top safe-area 인셋을 이 헤더가 소유한다(status bar). 좌우도 노치/랜드스케이프 대비 인셋한다.
    // BridgedWebView 는 헤더 가시 시 WebViewShell edges 에서 top 을 제거한다(이중 인셋 방지).
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <View style={styles.headerRow}>
        {/* 왼쪽 back chevron 영역 — showBackChevron 이 true 일 때만 상호작용 어포던스를 렌더한다.
            false 면 같은 크기의 빈 spacer 로 자리를 유지해 타이틀 정렬이 흔들리지 않게 한다. */}
        {showBackChevron ? (
          <Pressable
            onPress={onBackPress}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
            style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
          >
            <Text style={styles.chevron}>‹</Text>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {headerTitle}
        </Text>
        {/* 오른쪽 spacer — 타이틀을 back 영역과 대칭 오프셋으로 두어 시각 중심을 맞춘다(우측 액션 없음). */}
        <View style={styles.backButton} />
      </View>
    </SafeAreaView>
  );
}

// Figma 헤더 토큰(수동 추출 — 디자인 토큰 파이프라인 없음, (tabs)/_layout 와 동일 divergence).
const HEADER_BAR_HEIGHT = 52; // 헤더 행 높이(top 인셋 제외 — 웹 sticky 헤더 60px 와 근사, 정확값은 device-verify R-9).
const ACTIVE_TEXT = "#1a1a1a"; // 타이틀/chevron 색(웹 헤더 텍스트와 근사).
const HEADER_BG = "#fff"; // 헤더 배경(WebViewShell #fff 와 일치 — 인셋 영역 이음새 없음).
const BORDER = "#ece7e0"; // 하단 경계선(웹 sticky 헤더 border 와 근사).

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: HEADER_BG,
  },
  headerRow: {
    height: HEADER_BAR_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: HEADER_BG,
  },
  backButton: {
    // chevron 터치 타깃(44 최소 접근성 폭 근사) — 좌우 대칭 spacer 로도 재사용해 타이틀을 중앙 정렬한다.
    width: 40,
    height: HEADER_BAR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  backButtonPressed: {
    opacity: 0.5,
  },
  chevron: {
    fontSize: 30,
    lineHeight: 34,
    color: ACTIVE_TEXT,
  },
  title: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    color: ACTIVE_TEXT,
  },
});
