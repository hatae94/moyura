// 복구 가능한 에러/재시도 오버레이 (SPEC-WEBVIEW-SHELL-001 R-S2, AC-S2) — App.tsx 에서 추출.
//
// R-U4: 복구 가능한 에러/오프라인 UI(재시도 제공) — 빈 화면/크래시 금지. App.tsx 의 인라인
// 에러 JSX(+ StyleSheet)를 독립 presentational 컴포넌트로 분리한다. 동작 보존.
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export interface WebViewErrorOverlayProps {
  /** 에러 메시지에 표시할 웹 URL(WEB_URL). */
  webUrl: string;
  /** R-U4 복구: 재시도 버튼 핸들러(에러/로딩 상태 초기화 + 재로드). */
  onRetry: () => void;
}

/**
 * 복구 가능한 에러 오버레이. 네트워크/도달 불가 시 빈 화면 대신 설명 + 재시도 버튼을 보인다.
 * 표시 여부는 호출부(App.tsx)가 조건부 렌더링으로 결정한다(추출 전 동작 보존).
 */
export function WebViewErrorOverlay({
  webUrl,
  onRetry,
}: WebViewErrorOverlayProps): React.JSX.Element {
  return (
    <View style={styles.overlay}>
      <Text style={styles.errorTitle}>연결할 수 없습니다</Text>
      <Text style={styles.errorBody}>
        웹 서버({webUrl})에 연결하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하세요.
      </Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryLabel}>다시 시도</Text>
      </TouchableOpacity>
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
  errorTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 8,
  },
  errorBody: {
    fontSize: 14,
    color: "#555",
    textAlign: "center",
    marginBottom: 20,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#1a73e8",
  },
  retryLabel: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
});
