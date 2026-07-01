// 공유 하단 탭바 (SPEC-MOBILE-003 R-WB1, Figma Make BottomTabBar 적응).
//
// Figma 원본은 button + onTabChange 콜백으로 탭 전환을 처리했지만, Next.js App Router 에서는
// 각 탭을 <Link href> 로 만들어 라우트 이동으로 대체한다(R-WB1 적응 지침). active 상태는
// usePathname() 으로 도출하므로 클라이언트 컴포넌트다. notifications 배지는 NotificationCountProvider
// 컨텍스트에서 실시간 미읽음 카운트를 소비한다(Notifications M4b — 과거 mock prop 대체).
//
// 셸 모드(네이티브 WebView 내부)에서는 이 탭바를 숨긴다 — 네이티브 탭바만 보인다(R-WB3/R-WB4).
// 숨김은 layout.tsx 가 html[data-shell="native"] CSS 규칙으로 처리하므로 여기서는 마크업만 둔다.
"use client";

import { Home, Compass, Bell, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useNotificationCount } from "./NotificationCountProvider";

/** 웹/앱 동일 라우트 트리(R-NC1) — URL 경로와 1:1 매핑된다. */
const TABS = [
  { href: "/home", label: "홈", icon: Home },
  { href: "/explore", label: "탐색", icon: Compass },
  { href: "/notifications", label: "알림", icon: Bell },
  { href: "/profile", label: "마이", icon: User },
] as const;

/**
 * 하단 탭바(R-WB1). 4개 탭을 next/link 로 렌더하고 usePathname() 으로 active 를 도출한다.
 * 셸 모드에서는 상위 CSS 규칙(html[data-shell="native"])으로 숨겨진다(R-WB3).
 * 알림 배지 카운트는 NotificationCountProvider 컨텍스트에서 실시간으로 소비한다(반드시 프로바이더 하위에서 렌더).
 */
export function BottomTabBar() {
  const pathname = usePathname();
  const { count: notificationCount } = useNotificationCount();

  return (
    <nav
      data-bottom-tab-bar
      // 흐름 밖 position:fixed 로 뷰포트 하단에 핀 고정한다(스크롤 캔버스 위가 아니라 그 위에 떠 있음) —
      // 문서가 스크롤돼 브라우저 크롬이 접혀도 탭바는 항상 보이는 영역 하단에 남고 절대 잘리지 않는다.
      // z-40: 콘텐츠 위, 모달(z-50, 예: invite) 아래. inset-x-0 bottom-0 으로 전체 너비 하단 고정.
      // paddingBottom env(safe-area-inset-bottom): 홈 인디케이터 영역 회피(viewport-fit=cover 로 실효).
      // [확인] 조상(html/body/(main) 셸/Provider)에 transform/filter/backdrop-filter/will-change/contain
      // 가 없어 containing block 이 만들어지지 않으므로 fixed 는 뷰포트 기준으로 정착한다. 자신의
      // backdrop-blur 는 자신만 containing block 으로 만들 뿐 자식 fixed 가 없으므로 무해(반투명 유리 효과).
      // 네이티브 셸에서는 globals.css 의 html[data-shell="native"] [data-bottom-tab-bar]{display:none} 으로 숨김.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/85 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-stretch px-1.5 pt-1.5">
        {TABS.map((tab) => {
          // 정확 일치 + 하위 경로 매칭(예: /home/[id] 에서도 home 탭 active 유지).
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? "page" : undefined}
              // 탭 press 피드백: 누르면 살짝 줄어들었다 spring 으로 복원(네이티브 탭 감각).
              className="group relative flex flex-1 flex-col items-center justify-center gap-1 py-1.5 transition-transform duration-200 active:scale-90"
            >
              <div className="relative">
                {/* 활성 탭: 그라데이션 알약(인스타 시그니처) 안에 흰 아이콘. 비활성: 투명 배경 회색 아이콘.
                    h/w·배경·그림자가 transition 으로 부드럽게 전환된다(spring easing). */}
                <span
                  className={`flex items-center justify-center rounded-2xl transition-all duration-300 ${
                    isActive
                      ? "h-9 w-14 bg-gradient-brand shadow-lg shadow-primary/30"
                      : "h-9 w-14 bg-transparent"
                  }`}
                  style={{ transitionTimingFunction: "var(--ease-spring)" }}
                >
                  <Icon
                    size={22}
                    strokeWidth={isActive ? 2.4 : 1.9}
                    className={`transition-colors duration-200 ${
                      isActive
                        ? "text-white"
                        : "text-muted-foreground group-hover:text-foreground"
                    }`}
                  />
                </span>
                {tab.href === "/notifications" && notificationCount > 0 && (
                  <span className="animate-pop absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-brand text-[9px] font-bold text-white ring-2 ring-card">
                    {notificationCount > 9 ? "9+" : notificationCount}
                  </span>
                )}
              </div>
              <span
                className={`text-[10px] leading-none transition-colors duration-200 ${
                  isActive ? "font-bold text-foreground" : "font-semibold text-muted-foreground"
                }`}
              >
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
