// 알림 아이템 — 타입별 표현(아이콘·카피·딥링크) 매핑 + 단건 행 (Notifications M5, plan §6.3 전 타입).
//
// 백엔드 계약(단방향): NotificationDto.data 는 타입별 미리보기+딥링크 타깃(자유 형식 JSON)이라 unknown 이다.
// 표현 계층에서 안전 추출한다(dataStr/dataNum). 라우팅은 비대칭이다 — 모임 허브는 /home/[id](멤버·투표 인라인),
// 일정·경비는 /moims/[id]/*. owner.delegated 는 새 방장 닉네임이 DTO 에 없고(actor=위임한 사람, data.newOwnerId 는
// 원시 id) 새 방장이 수신자에 포함되므로, 현재 사용자 sub 로 "위임받음/위임됨"을 구분하는 수신자 인지 카피를 쓴다.
"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import {
  BarChart3,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Crown,
  HandCoins,
  Receipt,
  UserMinus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { type NotificationDto } from "@/lib/notifications/api";

// ─────────────────────────────────────────────
// data(unknown) 안전 추출 헬퍼
// ─────────────────────────────────────────────
function dataStr(data: unknown, key: string): string | undefined {
  if (data !== null && typeof data === "object" && key in data) {
    const v = (data as Record<string, unknown>)[key];
    return typeof v === "string" ? v : undefined;
  }
  return undefined;
}
function dataNum(data: unknown, key: string): number | undefined {
  if (data !== null && typeof data === "object" && key in data) {
    const v = (data as Record<string, unknown>)[key];
    return typeof v === "number" ? v : undefined;
  }
  return undefined;
}

// ─────────────────────────────────────────────
// 표시 포맷 헬퍼 (KST)
// ─────────────────────────────────────────────
const KST = "Asia/Seoul";

/** 원화 금액 표기(경비/정산). expenses-view 의 `{n.toLocaleString()}원` 컨벤션과 동일. 값 없으면 "?" 폴백. */
function won(amount: number | undefined): string {
  return `${(amount ?? 0).toLocaleString()}원`;
}

/** ISO 시각 → "M월 D일 HH:MM"(KST). schedule.confirmed 의 startsAt 을 카피에 노출한다. */
function formatKstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

// 카피 내 강조(모임명/닉네임). 배경 유틸 없는 순수 텍스트 span 이라 text-gradient 충돌 규칙과 무관하다.
// text-foreground 를 하드코딩하지 않아 읽은 행(muted)에서는 함께 muted 로 상속된다.
function Em({ children }: { children: ReactNode }) {
  return <span className="font-semibold">{children}</span>;
}

// ─────────────────────────────────────────────
// 타입별 표현 매핑 (전 12종 + 방어적 기본값)
// ─────────────────────────────────────────────
interface Presentation {
  icon: LucideIcon;
  /** 카피 — dto + 현재 사용자 sub(owner.delegated 수신자 인지 분기용). */
  copy: (dto: NotificationDto, me: string) => ReactNode;
  /** 딥링크 경로(라우팅 비대칭 — plan §6.3 라우트 열 그대로). */
  href: (dto: NotificationDto) => string;
}

function moimNameOf(dto: NotificationDto): string {
  return dto.moimName ?? "모임";
}
function actorNameOf(dto: NotificationDto): string {
  return dto.actor?.nickname ?? "누군가";
}

// @MX:ANCHOR: [AUTO] 알림 타입 → 표현(아이콘·카피·딥링크) 단일 매핑(SPEC-NOTIFICATIONS-001 M5, plan §6.3).
// @MX:REASON: NotificationItem 렌더·href 계산·아이콘 선택이 모두 이 한 곳을 참조한다(표현 규칙의 fan-in 지점).
// 백엔드 리스너의 type 상수(member.joined 등 12종)와 1:1 로 대응해야 하며, 어긋나면 UNKNOWN 폴백으로 흐른다.
// 새 알림 타입 추가 시 리스너 상수와 이 맵을 함께 갱신한다(계약 동기화 지점).
const PRESENTATION: Record<string, Presentation> = {
  "member.joined": {
    icon: UserPlus,
    copy: (dto) => (
      <>
        <Em>{actorNameOf(dto)}</Em>님이 <Em>{moimNameOf(dto)}</Em>에 참여했어요
      </>
    ),
    href: (dto) => `/home/${dto.moimId}`,
  },
  "owner.delegated": {
    icon: Crown,
    copy: (dto, me) => {
      const moim = <Em>{moimNameOf(dto)}</Em>;
      // 새 방장 닉네임은 DTO 에 없다(actor=위임한 사람). data.newOwnerId 로 "내가 위임받았는지"만 판별한다.
      const newOwnerId = dataStr(dto.data, "newOwnerId");
      if (newOwnerId !== undefined && newOwnerId === me) {
        return <>{moim} 방장을 위임받았어요</>;
      }
      return <>{moim}의 방장이 새로 위임됐어요</>;
    },
    href: (dto) => `/home/${dto.moimId}`,
  },
  "member.kicked": {
    icon: UserMinus,
    // 퇴장 당사자에게만 도착하는 개인 통지 → 항상 "나" 기준 카피. 딥링크는 모임 밖(홈 목록)으로.
    copy: (dto) => (
      <>
        <Em>{moimNameOf(dto)}</Em>에서 내보내졌어요
      </>
    ),
    href: () => `/home`,
  },
  "schedule.started": {
    icon: CalendarClock,
    copy: (dto) => (
      <>
        <Em>{moimNameOf(dto)}</Em> 일정 조율이 시작됐어요
      </>
    ),
    href: (dto) => `/moims/${dto.moimId}/schedule`,
  },
  "schedule.dates_changed": {
    icon: CalendarDays,
    copy: (dto) => (
      <>
        <Em>{moimNameOf(dto)}</Em> 후보 날짜가 바뀌었어요
      </>
    ),
    href: (dto) => `/moims/${dto.moimId}/schedule`,
  },
  "schedule.window_changed": {
    icon: Clock,
    copy: (dto) => (
      <>
        <Em>{moimNameOf(dto)}</Em> 조율 시간대가 넓어졌어요
      </>
    ),
    href: (dto) => `/moims/${dto.moimId}/schedule`,
  },
  "schedule.confirmed": {
    icon: CalendarCheck,
    copy: (dto) => {
      const startsAt = dataStr(dto.data, "startsAt");
      const when = startsAt ? formatKstDateTime(startsAt) : "새 시간";
      return (
        <>
          <Em>{moimNameOf(dto)}</Em> 일정이 <Em>{when}</Em>로 확정됐어요
        </>
      );
    },
    href: (dto) => `/moims/${dto.moimId}/schedule`,
  },
  "poll.created": {
    icon: BarChart3,
    copy: (dto) => {
      const question = dataStr(dto.data, "question") ?? "새 투표";
      return (
        <>
          <Em>{actorNameOf(dto)}</Em>님이 투표를 만들었어요: {question}
        </>
      );
    },
    href: (dto) => `/home/${dto.moimId}`,
  },
  "poll.closed": {
    icon: CheckCircle2,
    copy: (dto) => {
      const question = dataStr(dto.data, "question") ?? "투표";
      return <>투표가 마감됐어요: {question}</>;
    },
    href: (dto) => `/home/${dto.moimId}`,
  },
  "expense.added": {
    icon: Receipt,
    copy: (dto) => {
      const amount = dataNum(dto.data, "amount");
      const category = dataStr(dto.data, "category");
      return (
        <>
          <Em>{moimNameOf(dto)}</Em>에 경비 {won(amount)}
          {category ? `(${category})` : ""}이 추가됐어요
        </>
      );
    },
    href: (dto) => `/moims/${dto.moimId}/expenses`,
  },
  "settlement.requested": {
    icon: HandCoins,
    copy: (dto) => {
      const amount = dataNum(dto.data, "amount");
      return (
        <>
          <Em>{actorNameOf(dto)}</Em>님이 {won(amount)} 정산을 요청했어요
        </>
      );
    },
    href: (dto) => `/moims/${dto.moimId}/expenses`,
  },
  "settlement.completed": {
    icon: HandCoins,
    copy: (dto) => {
      const amount = dataNum(dto.data, "amount");
      return <>정산 {won(amount)}이 완료됐어요</>;
    },
    href: (dto) => `/moims/${dto.moimId}/expenses`,
  },
};

// 미지정 타입(백엔드가 새 type 을 먼저 배포한 경우) 방어적 폴백 — 크래시 대신 일반 카피 + 허브 딥링크.
const UNKNOWN_PRESENTATION: Presentation = {
  icon: Bell,
  copy: (dto) => (
    <>
      <Em>{moimNameOf(dto)}</Em>에 새 소식이 있어요
    </>
  ),
  href: (dto) => `/home/${dto.moimId}`,
};

function presentationFor(type: string): Presentation {
  return PRESENTATION[type] ?? UNKNOWN_PRESENTATION;
}

// ─────────────────────────────────────────────
// 상대 시간 (방금 / N분 전 / N시간 전 / 어제 / M월 D일) — KST 기준
// ─────────────────────────────────────────────
export function relativeTime(iso: string, todayKey: string, yesterdayKey: string): string {
  const then = new Date(iso).getTime();
  const diffMin = Math.floor((Date.now() - then) / 60000);
  if (diffMin < 1) {
    return "방금";
  }
  if (diffMin < 60) {
    return `${diffMin}분 전`;
  }
  const key = kstDateKey(iso);
  if (key === todayKey) {
    return `${Math.floor(diffMin / 60)}시간 전`;
  }
  if (key === yesterdayKey) {
    return "어제";
  }
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/** ISO 시각 → KST 달력 날짜 키("YYYY-MM-DD"). 날짜 그룹핑·상대시간 경계 판정의 단일 기준. */
export function kstDateKey(iso: string): string {
  // en-CA 로케일은 YYYY-MM-DD 형태를 준다(정렬·동등 비교에 안전).
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST }).format(new Date(iso));
}

// ─────────────────────────────────────────────
// 아이템 행
// ─────────────────────────────────────────────
interface NotificationItemProps {
  item: NotificationDto;
  currentUserId: string;
  todayKey: string;
  yesterdayKey: string;
  /**
   * 탭 시(미읽음일 때만) 부모가 읽음 처리를 수행한다: 낙관적 로컬 읽음 + read 액션 발사 + 배지 refresh.
   * 부모(NotificationFeed)가 컨텍스트(useNotificationCount)와 리스트 상태를 소유하므로 이 콜백에 위임한다.
   */
  onRead: (id: string) => void;
}

/**
 * 알림 단건 행. 전체가 딥링크(Link)다 — 탭하면 (1) 미읽음이면 부모 onRead 로 읽음 처리를 위임하고,
 * (2) Link 기본 내비게이션으로 href 로 이동한다. 내비게이션을 막지 않아 접근성(anchor 시맨틱)이 보존된다.
 */
export function NotificationItem({
  item,
  currentUserId,
  todayKey,
  yesterdayKey,
  onRead,
}: NotificationItemProps) {
  const { icon: Icon, copy, href } = presentationFor(item.type);
  const unread = item.readAt === null;
  const target = href(item);

  function handleClick() {
    if (unread) {
      onRead(item.id);
    }
  }

  return (
    <Link
      href={target}
      onClick={handleClick}
      className={`flex items-start gap-3 rounded-2xl border border-border p-3.5 shadow-sm transition-transform active:scale-[0.99] ${
        unread ? "bg-card" : "bg-card/60"
      }`}
    >
      {/* 타입 아이콘 — 옅은 그라데이션 원형 배지(PlaceholderTab 배지·경비 칩과 동일 언어). bg 유틸 + lucide
          아이콘이라 text-gradient 충돌 규칙과 무관. 읽은 행은 살짝 흐리게. */}
      <span
        className={`bg-gradient-brand-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary ring-1 ring-border ${
          unread ? "" : "opacity-70"
        }`}
        aria-hidden
      >
        <Icon size={18} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          className={`line-clamp-2 text-sm leading-snug ${
            unread ? "font-medium text-foreground" : "text-muted-foreground"
          }`}
        >
          {copy(item, currentUserId)}
        </p>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {item.moimName ? (
            <>
              <span className="truncate">{item.moimName}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="shrink-0">
            {relativeTime(item.createdAt, todayKey, yesterdayKey)}
          </span>
        </div>
      </div>

      {/* 안읽음 점 — bg-gradient-brand(텍스트 아님)라 배경 충돌 규칙과 무관(plan §7 주의). */}
      {unread ? (
        <span
          className="bg-gradient-brand mt-1.5 h-2 w-2 shrink-0 rounded-full"
          aria-label="안읽음"
        />
      ) : null}
    </Link>
  );
}
