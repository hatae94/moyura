// 홈 탭 액션 speed dial (Client Component) — 우측 하단 플로팅 햄버거 FAB.
//
// MoimActionDock(모임 상세용)와 구조는 동일하되 액션이 다르다: 새 모임 만들기(/moims/new) · 초대 링크 참여
// (/invite). 진입점 화면이 서로 달라(홈 탭 vs 모임 상세) 별도 컴포넌트로 둔다.
//   - staggered 등장: FAB 가까운 액션(초대)부터 순차로 튀어 오른다(transition-delay).
//   - 햄버거(Menu) ↔ X 크로스페이드 모핑으로 열림/닫힘 상태를 표현한다.
//   - backdrop scrim: 열린 동안 배경을 어둡게 + 탭하면 닫힌다.
//   - next/link 의 Link 와 lucide 의 Link 아이콘 이름 충돌을 피해 초대 아이콘은 lucide Link2 를 쓴다.
//
// [중요] data 속성 data-home-action-dock — 웹 기본값(bottom 5.5rem)은 MoimActionDock 과 동일하게 웹 하단
// 탭바를 회피한다. 네이티브 셸에서는 웹 탭바가 숨겨지고 네이티브 탭바가 WebView 뷰포트 밖(아래)에 있어 뷰포트
// 내부에 회피할 하단 크롬이 없다 → globals.css 가 data-moim-action-dock 과 함께 이 속성도 bottom 1.5rem 으로
// 낮춰, 홈 FAB 를 모임 상세 FAB 와 정확히 같은 위치로 맞춘다(홈/상세 화면 모두 동일한 네이티브 탭바 아래 구조).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Link2, Menu, Plus, X } from "lucide-react";

// 액션 정의(위에서부터 이 순서로 쌓이고 FAB 는 맨 아래): 새 모임 만들기 → 초대 링크 참여.
const ACTIONS = [
  {
    key: "create",
    href: "/moims/new",
    icon: Plus,
    label: "새 모임 만들기",
    // 새 모임은 기본 액션 — 그라데이션으로 강조(초대는 카드 + 그라데이션 아이콘).
    primary: true,
  },
  {
    key: "invite",
    href: "/invite",
    icon: Link2,
    label: "초대 링크 참여",
    primary: false,
  },
] as const;

export function HomeActionDock() {
  const [open, setOpen] = useState(false);

  // 메뉴가 열려(backdrop blur) 있는 동안 배경(홈 문서) 스크롤을 잠근다 — 열린 상태에서 뒤 콘텐츠가 스크롤되던
  // UX 문제 방지. body overflow 를 hidden 으로 두고 overscroll-behavior 로 스크롤 체이닝도 차단한다.
  // 닫히거나 언마운트 시 원래 값으로 복원한다.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const prevOverflow = body.style.overflow;
    const prevOverscroll = body.style.overscrollBehavior;
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    return () => {
      body.style.overflow = prevOverflow;
      body.style.overscrollBehavior = prevOverscroll;
    };
  }, [open]);

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

      {/* dock — 우측 하단 고정. items-end 로 우측 정렬, FAB 는 마지막(맨 아래). 웹 기본 bottom 5.5rem;
          네이티브 셸에서는 globals.css 가 data-home-action-dock 을 data-moim-action-dock 과 함께 1.5rem 으로
          내려 모임 상세 FAB 와 위치를 일치시킨다. */}
      <div
        data-home-action-dock
        className="fixed right-5 z-40 flex flex-col items-end gap-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
      >
        {ACTIONS.map((a, i) => {
          const Icon = a.icon;
          // FAB 가까운 액션(마지막=초대, i 큼)부터 등장 → 위로 stagger. 닫힐 땐 지연 없이 함께 사라진다.
          const delay = open ? (ACTIONS.length - 1 - i) * 55 : 0;
          return (
            <Link
              key={a.key}
              href={a.href}
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
              {/* 원형 아이콘 버튼(오른쪽) — 새 모임은 그라데이션 채움, 초대는 카드 + 그라데이션 아이콘 */}
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
          aria-label={open ? "메뉴 닫기" : "메뉴 열기"}
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
