// 로딩 인디케이터 오버레이 (SPEC-WEBVIEW-SHELL-001 R-S2, AC-S2) — App.tsx 에서 추출.
//
// R-U3: 로딩 중 인디케이터 오버레이. App.tsx 의 인라인 로딩 JSX(+ StyleSheet)를 독립
// presentational 컴포넌트로 분리한다. 동작 보존 — 표시 여부 판단은 호출부가 한다.
import { ActivityIndicator, StyleSheet, View } from "react-native";

/**
 * 로딩 인디케이터 오버레이. 표시 중에는 터치를 가로채지 않는다(pointerEvents="none").
 * 표시 여부는 호출부(App.tsx)가 조건부 렌더링으로 결정한다(추출 전 동작 보존).
 */
export function LoadingOverlay(): React.JSX.Element {
  return (
    <View style={styles.overlay} pointerEvents="none">
      <ActivityIndicator size="large" />
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
