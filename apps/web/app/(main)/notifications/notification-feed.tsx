// 알림 피드 클라이언트 뷰 (Notifications M5 — 웹 알림 탭).
//
// 서버(page.tsx)가 첫 페이지를 낳고, 이 클라 컴포넌트가 마운트 후 리스트를 소유한다:
//   - 헤더: "알림" + 미읽음 존재 시 "모두 읽음"(all read 액션 + 낙관적 전체 읽음 + 배지 reset)
//   - 날짜 그룹: 오늘 / 어제 / 이전(createdAt KST 기준)
//   - 무한 스크롤: IntersectionObserver 센티넬 → nextCursor 있으면 다음 페이지를 클라에서 fetch·append
//   - 읽음: 아이템 탭 시 낙관적 로컬 읽음 + read 액션 + 배지 refresh(NotificationItem)
//   - 빈 상태: 아이콘 + "아직 알림이 없어요"(PlaceholderTab 톤)
//
// 상태 소유: initialItems 는 마운트 시드일 뿐, 이후 리스트(append·낙관적 읽음)는 클라가 소유한다 → initialItems
// 변경으로 재동기화하지 않는다(페이지네이션/낙관적 상태를 덮어쓰지 않도록). setState 는 이벤트/이펙트 콜백
// 안에서만 일어나(render 중 setState 금지 규칙 준수) react-hooks 위반이 없다.
"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { BellOff, CheckCheck } from "lucide-react";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import {
  type NotificationDto,
  listNotifications,
} from "@/lib/notifications/api";
import { useNotificationCount } from "../_components/NotificationCountProvider";
import { markNotificationsReadAction } from "./notifications-actions";
import { NotificationItem, kstDateKey } from "./notification-item";

// ─────────────────────────────────────────────
// 날짜 그룹 (오늘 / 어제 / 이전) — KST 기준
// ─────────────────────────────────────────────
type GroupLabel = "오늘" | "어제" | "이전";

/** 지금(now) 기준 오늘/어제의 KST 날짜 키. KST 는 DST 가 없어 하루=정확히 86400s 라 24h 빼면 어제가 된다. */
function todayYesterdayKeys(): { todayKey: string; yesterdayKey: string } {
  const now = Date.now();
  return {
    todayKey: kstDateKey(new Date(now).toISOString()),
    yesterdayKey: kstDateKey(new Date(now - 86400000).toISOString()),
  };
}

interface NotificationFeedProps {
  initialItems: NotificationDto[];
  initialNextCursor: string | null;
  /** 클라이언트 페이지네이션 fetch 의 Bearer 토큰(schedule-view 의 accessToken prop 패턴 — staleness 한계 상속). */
  accessToken: string;
  /** owner.delegated 수신자 인지 카피 분기용 현재 사용자 sub(session.user.id). */
  currentUserId: string;
}

export function NotificationFeed({
  initialItems,
  initialNextCursor,
  accessToken,
  currentUserId,
}: NotificationFeedProps) {
  const { reset, refresh } = useNotificationCount();
  // read 액션 발사용 트랜지션(fire-and-forget). isPending 은 쓰지 않는다 — 낙관적 UI 가 즉시 반영되고,
  // 실패 시엔 배지 refresh/다음 페이지 로드가 자가 치유하므로 대기 표시가 불필요하다.
  const [, startReadTransition] = useTransition();

  const [items, setItems] = useState<NotificationDto[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  // 동시(중복) 페이지 fetch 가드 — 센티넬이 짧은 시간에 여러 번 교차해도 한 번만 나간다.
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const hasUnread = useMemo(() => items.some((i) => i.readAt === null), [items]);

  // 오늘/어제 키는 마운트 시 한 번 고정한다(피드 열람 세션 동안 그룹 라벨을 안정화 — 자정 경계 재계산 불필요).
  const { todayKey, yesterdayKey } = useMemo(() => todayYesterdayKeys(), []);

  // 단건 읽음(아이템 탭) — 낙관적 로컬 읽음(readAt 즉시 채움) + read 액션 발사 + 배지 refresh(authoritative 재조회).
  // read 액션은 fire-and-forget: 딥링크 이동으로 이 컴포넌트가 언마운트돼도 POST 는 이미 발사됐고, 실패는 다음
  // 신호/refresh 로 자가 치유한다. refresh() 는 컨텍스트 재조회라 (main) 셸에 남아 있으면 배지를 정확히 낮춘다.
  function handleItemRead(id: string) {
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.readAt === null ? { ...it, readAt: nowIso } : it,
      ),
    );
    startReadTransition(() => {
      void markNotificationsReadAction({ ids: [id] });
    });
    refresh();
  }

  // "모두 읽음" — 낙관적 전체 읽음 + all-read 액션(트랜지션) + 배지 reset(컨텍스트 낙관적 0 후 재조회).
  function handleMarkAll() {
    const nowIso = new Date().toISOString();
    setItems((prev) =>
      prev.map((it) => (it.readAt === null ? { ...it, readAt: nowIso } : it)),
    );
    // all-read 가 백엔드에 반영된 뒤 배지를 리셋한다. reset() 의 authoritative 재조회가 POST 완료 전에
    // 실행되면 이전(미읽음) 카운트로 배지를 덮는 레이스가 생기므로, DB 마킹 완료 후 재조회해 정확히 0 이 되게 한다.
    startReadTransition(async () => {
      await markNotificationsReadAction({ all: true });
      reset();
    });
  }

  // 무한 스크롤 — 센티넬이 뷰포트에 들어오고 nextCursor 가 있으면 다음 페이지를 클라에서 fetch·append.
  // cursor 를 이펙트 클로저에서 직접 읽고, 페이지 로드 시 setCursor 로 이펙트가 재구독된다(ref 불필요).
  useEffect(() => {
    if (cursor === null) {
      return;
    }
    const el = sentinelRef.current;
    if (el === null) {
      return;
    }
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || loadingRef.current) {
          return;
        }
        loadingRef.current = true;
        setLoadingMore(true);
        const api = createApiClient({
          baseUrl: API_BASE_URL,
          getToken: () => accessToken,
        });
        listNotifications(api, { cursor })
          .then((page) => {
            if (cancelled) {
              return;
            }
            setItems((prev) => [...prev, ...page.items]);
            setCursor(page.nextCursor);
          })
          .catch((err) => {
            // 비차단: 다음 페이지 로드 실패는 피드를 깨지 않는다(재교차 시 재시도 가능).
            console.error("[moyura/web] 알림 다음 페이지 로드 실패", err);
          })
          .finally(() => {
            loadingRef.current = false;
            if (!cancelled) {
              setLoadingMore(false);
            }
          });
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cursor, accessToken]);

  // 아이템을 오늘/어제/이전 순서로 버킷팅(입력은 최신순이라 각 그룹 내부도 최신순 보존).
  const groups = useMemo(() => {
    const buckets: Record<GroupLabel, NotificationDto[]> = {
      오늘: [],
      어제: [],
      이전: [],
    };
    for (const it of items) {
      const key = kstDateKey(it.createdAt);
      const label: GroupLabel =
        key === todayKey ? "오늘" : key === yesterdayKey ? "어제" : "이전";
      buckets[label].push(it);
    }
    return (["오늘", "어제", "이전"] as GroupLabel[])
      .map((label) => ({ label, items: buckets[label] }))
      .filter((g) => g.items.length > 0);
  }, [items, todayKey, yesterdayKey]);

  return (
    <div className="flex flex-1 flex-col">
      {/* 헤더 — "알림" + (미읽음 존재 시) "모두 읽음". 스크롤 시 상단 고정(chat/schedule 헤더 토큰과 동일). */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <h1 className="text-lg font-extrabold text-foreground">알림</h1>
        {hasUnread ? (
          <button
            type="button"
            onClick={handleMarkAll}
            className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-transform active:scale-95"
          >
            <CheckCheck size={14} />
            모두 읽음
          </button>
        ) : null}
      </header>

      {items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-4 px-4 py-4">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-2">
              <h2 className="px-1 text-xs font-bold text-muted-foreground">
                {group.label}
              </h2>
              <div className="flex flex-col gap-2">
                {group.items.map((item) => (
                  <NotificationItem
                    key={item.id}
                    item={item}
                    currentUserId={currentUserId}
                    todayKey={todayKey}
                    yesterdayKey={yesterdayKey}
                    onRead={handleItemRead}
                  />
                ))}
              </div>
            </section>
          ))}

          {/* 무한 스크롤 센티넬 + 로더. cursor 가 있을 때만 렌더(없으면 관찰 대상 부재 = 종료). */}
          {cursor !== null ? (
            <div
              ref={sentinelRef}
              className="flex items-center justify-center py-4 text-xs text-muted-foreground"
            >
              {loadingMore ? "불러오는 중..." : ""}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// 빈 상태 — PlaceholderTab 톤(옅은 그라데이션 원형 배지 + 안내).
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
      <div className="bg-gradient-brand-soft flex h-20 w-20 items-center justify-center rounded-full text-primary ring-1 ring-border">
        <BellOff size={30} />
      </div>
      <div className="flex flex-col items-center gap-1">
        <p className="text-lg font-bold text-foreground">아직 알림이 없어요</p>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          모임 참여, 일정 변경, 투표, 정산 소식이 여기에 모여요.
        </p>
      </div>
    </div>
  );
}
