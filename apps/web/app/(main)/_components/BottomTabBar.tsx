// 공유 하단 탭바 (SPEC-MOBILE-003 R-WB1, Figma Make BottomTabBar 적응).
//
// Figma 원본은 button + onTabChange 콜백으로 탭 전환을 처리했지만, Next.js App Router 에서는
// 각 탭을 <Link href> 로 만들어 라우트 이동으로 대체한다(R-WB1 적응 지침). active 상태는
// usePathname() 으로 도출하므로 클라이언트 컴포넌트다. notifications 배지는 mock 카운트 prop.
//
// 셸 모드(네이티브 WebView 내부)에서는 이 탭바를 숨긴다 — 네이티브 탭바만 보인다(R-WB3/R-WB4).
// 숨김은 layout.tsx 가 html[data-shell="native"] CSS 규칙으로 처리하므로 여기서는 마크업만 둔다.
"use client";

import { Home, Compass, Bell, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** 웹/앱 동일 라우트 트리(R-NC1) — URL 경로와 1:1 매핑된다. */
const TABS = [
  { href: "/home", label: "홈", icon: Home },
  { href: "/explore", label: "탐색", icon: Compass },
  { href: "/notifications", label: "알림", icon: Bell },
  { href: "/profile", label: "마이", icon: User },
] as const;

export interface BottomTabBarProps {
  /** 알림 탭 배지에 표시할 mock 카운트(0 이면 미표시). */
  notificationCount?: number;
}

/**
 * 하단 탭바(R-WB1). 4개 탭을 next/link 로 렌더하고 usePathname() 으로 active 를 도출한다.
 * 셸 모드에서는 상위 CSS 규칙(html[data-shell="native"])으로 숨겨진다(R-WB3).
 */
export function BottomTabBar({ notificationCount = 0 }: BottomTabBarProps) {
  const pathname = usePathname();

  return (
    <nav
      data-bottom-tab-bar
      className="relative border-t border-border bg-card"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch">
        {TABS.map((tab) => {
          // 정확 일치 + 하위 경로 매칭(예: /home/[id] 에서도 home 탭 active 유지).
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center justify-center gap-1 py-3 transition-colors"
            >
              <div className="relative">
                <Icon
                  size={22}
                  strokeWidth={isActive ? 2.5 : 1.8}
                  className={isActive ? "text-primary" : "text-muted-foreground"}
                />
                {tab.href === "/notifications" && notificationCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
                    {notificationCount > 9 ? "9+" : notificationCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] font-semibold leading-none ${
                  isActive ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span className="absolute left-1/2 top-0 h-0.5 w-8 -translate-x-1/2 rounded-full bg-primary" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
