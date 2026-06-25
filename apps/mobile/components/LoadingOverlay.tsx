// 로딩 인디케이터 오버레이 (SPEC-WEBVIEW-SHELL-001 R-S2, AC-S2) — App.tsx 에서 추출.
//
// R-U3 / R-NF2(M2/T-002): 로드 중 표시되는 브랜드색 스켈레톤. 흰 화면 대신 브랜드 컬러
// 스피너를 보여 "의도된 로딩"으로 체감시킨다(흰 플래시 제거). 이제 이 컴포넌트는
// WebViewShell 의 renderLoading 으로 단일 소유된다(startInLoadingState 가 표시/숨김 자동 관리).
// 호출부(BridgedWebView)는 더 이상 형제로 직접 렌더하지 않는다(double-overlay 해소).
import { ActivityIndicator, StyleSheet, View } from "react-native";

// 브랜드 primary 색(웹 globals.css `--primary:#ff6b35` 와 일치) — 스피너 틴트.
const BRAND_PRIMARY = "#ff6b35";

/**
 * 브랜드색 로딩 스켈레톤. 표시 중에는 터치를 가로채지 않는다(pointerEvents="none").
 * 표시 여부는 WebViewShell 의 startInLoadingState/renderLoading 이 자동 결정한다.
 */
export function LoadingOverlay(): React.JSX.Element {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <ActivityIndicator size="large" color={BRAND_PRIMARY} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#fff",
  },
});
