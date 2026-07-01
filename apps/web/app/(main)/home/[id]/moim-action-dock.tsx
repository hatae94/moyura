// 모임 액션 speed dial (Client Component) — 우측 하단 플로팅 햄버거 FAB.
//
// Material 3 Expressive FAB Menu 패턴 참고: FAB 탭 → 관련 액션(채팅·일정조율·경비)이 위로 수직 펼쳐진다.
//   - staggered 등장: FAB 가까운 액션(경비)부터 순차로 튀어 오른다(transition-delay).
//   - 햄버거(Menu) ↔ X 크로스페이드 모핑으로 열림/닫힘 상태를 표현한다.
//   - backdrop scrim: 열린 동안 배경을 어둡게 + 탭하면 닫힌다.
// 기존 3개 카드 CTA(채팅/일정조율/경비 Link)를 대체한다 — 목적지/기능은 동일, 표현만 speed dial 로 교체.
//
// (main) 그룹이라 하단 탭바(z-40, ~4.5rem)가 있어 FAB 를 그 위에 띄운다(bottom 5.5rem). 네이티브 셸은
// 탭바가 숨겨지므로 globals.css 가 html[data-shell="native"] [data-moim-action-dock] 로 bottom 을 낮춘다.
"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Menu, MessageCircle, Receipt, X } from "lucide-react";

// 액션 정의(사용자 지정 순서: 채팅 → 일정 조율 → 경비). 위에서부터 이 순서로 쌓이고 FAB 는 맨 아래.
const ACTIONS = [
  {
    key: "chat",
    path: (id: string) => `/moims/${id}/chat`,
    icon: MessageCircle,
    label: "채팅",
    // 채팅은 기본 액션 — 그라데이션으로 강조(나머지는 카드 + 그라데이션 아이콘).
    primary: true,
  },
  {
    key: "schedule",
    path: (id: string) => `/moims/${id}/schedule`,
    icon: CalendarClock,
    label: "일정 조율",
    primary: false,
  },
  {
    key: "expenses",
    path: (id: string) => `/moims/${id}/expenses`,
    icon: Receipt,
    label: "경비",
    primary: false,
  },
] as const;

export function MoimActionDock({ moimId }: { moimId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* backdrop scrim — 열린 동안만 상호작용. 탭하면 닫힌다. z-30(dock z-40 아래, 탭바 z-40 아래). */}
      <div
        aria-hidden="true"
        onClick={() => setOpen(false)}
        className={`fixed inset-0 z-30 bg-black/25 backdrop-blur-sm transition-opacity duration-300 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* dock — 우측 하단 고정. items-end 로 우측 정렬, FAB 는 마지막(맨 아래). bottom 은 클래스로 두어
          globals.css 의 셸 오버라이드(attr 셀렉터, 더 높은 우선순위)가 이길 수 있게 한다(인라인 style 금지). */}
      <div
        data-moim-action-dock
        className="fixed right-5 z-40 flex flex-col items-end gap-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
      >
        {ACTIONS.map((a, i) => {
          const Icon = a.icon;
          // FAB 가까운 액션(마지막=경비, i 큼)부터 등장 → 위로 stagger. 닫힐 땐 지연 없이 함께 사라진다.
          const delay = open ? (ACTIONS.length - 1 - i) * 55 : 0;
          return (
            <Link
              key={a.key}
              href={a.path(moimId)}
              tabIndex={open ? 0 : -1}
              aria-hidden={!open}
              onClick={() => setOpen(false)}
              style={{ transitionDelay: `${delay}ms` }}
              className={`flex items-center gap-2.5 transition-all duration-300 ease-out ${
                open
                  ? "translate-y-0 scale-100 opacity-100"
                  : "pointer-events-none translate-y-3 scale-90 opacity-0"
              }`}
            >
              {/* 라벨 칩(왼쪽) */}
              <span className="rounded-full bg-card px-3.5 py-1.5 text-sm font-bold text-foreground shadow-lg shadow-black/10">
                {a.label}
              </span>
              {/* 원형 아이콘 버튼(오른쪽) — 채팅은 그라데이션 채움, 나머지는 카드 + 그라데이션 아이콘 */}
              <span
                className={`flex h-12 w-12 items-center justify-center rounded-full shadow-lg ${
                  a.primary
                    ? "bg-gradient-brand text-white shadow-primary/30"
                    : "bg-card shadow-black/10"
                }`}
              >
                <Icon size={21} className={a.primary ? "" : "text-primary"} />
              </span>
            </Link>
          );
        })}

        {/* FAB — 햄버거(Menu) ↔ X 크로스페이드 모핑. 스프링 press 피드백. */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "메뉴 닫기" : "모임 메뉴 열기"}
          className="bg-gradient-brand flex h-14 w-14 items-center justify-center rounded-full text-white shadow-xl shadow-primary/35 transition-transform duration-200 active:scale-90"
        >
          <span className="relative flex h-7 w-7 items-center justify-center">
            <Menu
              size={26}
              className={`absolute transition-all duration-300 ${
                open ? "rotate-90 opacity-0" : "rotate-0 opacity-100"
              }`}
            />
            <X
              size={26}
              className={`absolute transition-all duration-300 ${
                open ? "rotate-0 opacity-100" : "-rotate-90 opacity-0"
              }`}
            />
          </span>
        </button>
      </div>
    </>
  );
}
