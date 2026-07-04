// 알림 탭 딥링크 intent 브로커 (SPEC-CHAT-002 R-PUSH-007 / SPEC-MOBILE-NAV-001 정합) — 순수 모듈.
//
// 알림 탭 핸들러(root _layout)가 대상 채팅 URL 을 여기 저장하고 home 탭을 focus 하면, home 탭의
// BridgedWebView 가 이 intent 를 소비해 자신의 *기존* WebView 를 setSourceUri(URL)로 이동한다(리마운트
// 없음 — 세션 쿠키 보존, OD-1). detail-push(router.push → 별도 BridgedWebView 생성)를 대체한다:
//   detail-push 는 새 WebView 가 세션 쿠키 미공유라 /moims/{id}/chat 초기 GET 이 /login 으로 바운스 →
//   /login 의 LogoutBridgeNotifier 가 session:cleared post → 네이티브가 clearWebViewCookies → *로그아웃*
//   연쇄가 터진다. 기존 WebView 이동은 쿠키가 이미 있어 이 연쇄를 원천 제거한다.
//
// expo/RN 의존이 없는 순수 모듈이라 vitest 로 단위 테스트 가능하다(mobile-pure-core-test-seam 컨벤션).
// 대상은 단 하나(home 탭 WebView) — 단일 pending + 단일 subscriber 만 유지한다.

let pendingTarget: string | null = null;
let subscriber: (() => void) | null = null;

/**
 * 알림 탭이 대상 채팅 URL 을 저장한다. 구독자(마운트된 home 탭)가 있으면 즉시 통지해 소비를 촉발한다.
 * 아직 구독자가 없으면(home 탭 미마운트) pending 으로 남아 다음 구독/전이 시점에 소비된다.
 */
export function setDeepLinkTarget(url: string): void {
  pendingTarget = url;
  subscriber?.();
}

/** 대기 중인 대상 URL 을 1회성으로 소비한다(반환 후 비운다 — 재소비/중복 이동 방지). 없으면 null. */
export function consumeDeepLinkTarget(): string | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

/**
 * 대상 저장 시 통지받을 구독자를 등록한다(마운트된 home 탭 BridgedWebView). home 탭은 하나이므로 단일
 * 구독자만 유지한다 — 재등록 시 이전 구독자를 대체한다. 반환값은 해제 함수(언마운트 cleanup).
 */
export function subscribeDeepLinkTarget(callback: () => void): () => void {
  subscriber = callback;
  return () => {
    if (subscriber === callback) {
      subscriber = null;
    }
  };
}
