// 미읽음 알림 카운트 컨텍스트 프로바이더 (Notifications M4b).
//
// 서버가 초기 카운트를 낳고(layout 의 GET /notifications/unread-count) 웹이 실시간으로 반영한다:
//   - initialCount 로 state 를 시드(SSR 페인트부터 정확한 배지 — 깜빡임 없음)
//   - useNotificationChannel(user:{sub}) 구독 → 'notification_new' 수신 시 unread-count 를 재조회(authoritative)
//     하여 setCount 한다(낙관적 +1 대신 재조회 → 드리프트 방지). setState 는 콜백/이펙트 안에서만 일어나므로
//     render 중 setState 금지 규칙(react-hooks)에 걸리지 않는다.
//
// M5(웹 알림 탭)가 소비할 표면: useNotificationCount() → { count, refresh, reset }.
//   - refresh(): 서버 재조회로 카운트 동기화(예: 탭 진입 시)
//   - reset(): 낙관적 0 + 재조회(예: "모두 읽음" 직후) — 순서 가드로 이전 in-flight 재조회가 0 을 되돌리지 못한다.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { getUnreadCount } from "@/lib/notifications/api";
import { useNotificationChannel } from "@/lib/notifications/useNotificationChannel";

interface NotificationCountContextValue {
  /** 현재 미읽음 알림 개수(배지). */
  count: number;
  /** 서버 재조회로 카운트를 동기화한다(실패 시 기존 값 유지 — 비차단). */
  refresh: () => void;
  /** 낙관적 0 세팅 후 재조회한다("모두 읽음" 직후 등). */
  reset: () => void;
}

const NotificationCountContext = createContext<NotificationCountContextValue | null>(
  null,
);

export interface NotificationCountProviderProps {
  /** 서버에서 fetch 한 초기 미읽음 개수(layout). */
  initialCount: number;
  /** 구독/조회 대상 사용자 sub(session.user.id). */
  sub: string;
  /** realtime.setAuth + 클라이언트 API Bearer 에 쓸 access_token(session.access_token). */
  accessToken: string;
  children: ReactNode;
}

/**
 * (main) 셸에서 미읽음 알림 카운트를 제공한다. 초기값은 서버 fetch, 이후는 user:{sub} 실시간 신호마다 재조회한다.
 * BottomTabBar 가 useNotificationCount() 로 실카운트를 소비한다(하드코딩 mock 대체).
 */
export function NotificationCountProvider({
  initialCount,
  sub,
  accessToken,
  children,
}: NotificationCountProviderProps) {
  const [count, setCount] = useState(initialCount);

  // out-of-order 응답 가드: 매 재조회마다 seq 를 증가시키고, 응답 반영 시 자신이 최신 요청인지 확인한다.
  // reset() 의 낙관적 0 직후 이전 in-flight 재조회가 옛 카운트로 되돌리는 플리커를 막는다.
  const requestSeqRef = useRef(0);

  const refresh = useCallback(() => {
    const seq = ++requestSeqRef.current;
    // 클라이언트 API 클라이언트(Bearer via getToken). 전달받은 access token 을 그대로 쓴다
    // (schedule-view 의 accessToken prop 패턴과 동형 — 토큰 staleness 한계도 동일하게 상속).
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => accessToken,
    });
    getUnreadCount(api)
      .then((next) => {
        if (seq === requestSeqRef.current) {
          setCount(next);
        }
      })
      .catch(() => {
        // 배지 UX 비차단: 재조회 실패 시 기존 카운트를 유지한다(다음 신호/refresh 에서 자가 치유).
      });
  }, [accessToken]);

  const reset = useCallback(() => {
    setCount(0);
    refresh();
  }, [refresh]);

  // per-user 전역 1구독. 'notification_new' 수신 시 authoritative 재조회로 배지를 올린다.
  useNotificationChannel(sub, accessToken, refresh);

  const value = useMemo<NotificationCountContextValue>(
    () => ({ count, refresh, reset }),
    [count, refresh, reset],
  );

  return (
    <NotificationCountContext.Provider value={value}>
      {children}
    </NotificationCountContext.Provider>
  );
}

/**
 * (main) 셸 하위에서 미읽음 카운트 컨텍스트를 읽는다. 프로바이더 밖에서 호출하면 명시적으로 throw 한다
 * (개발 시점 배선 오류를 조용한 undefined 대신 즉시 드러낸다).
 */
export function useNotificationCount(): NotificationCountContextValue {
  const ctx = useContext(NotificationCountContext);
  if (ctx === null) {
    throw new Error(
      "useNotificationCount 는 <NotificationCountProvider> 안에서만 사용할 수 있습니다.",
    );
  }
  return ctx;
}
