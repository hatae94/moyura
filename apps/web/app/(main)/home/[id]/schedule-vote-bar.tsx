// 모임 상세 최상단 — 후보 날짜별 참여(투표) 현황 가로 스크롤 바 그래프 (일정 조율 요약).
//
// 일정 조율의 "가능 시간 칠하기"를 요약한다: 각 후보 날짜에 대해 가능 시간을 한 칸이라도 칠한
// 멤버 수(참여 멤버 수, 중복 제거)를 막대 높이 + 숫자로 보여준다. 위젯 탭 → 일정 조율 페이지.
// 미설정(schedule=null)이면 "일정 조율 시작" CTA 로 대체한다(발견성). 서버 컴포넌트(표시 전용 + Link).
//
// 요일/월일은 서버 TZ 에 의존하면 자정 경계에서 하루 밀릴 수 있어(00:00 KST = 전날 15:00 UTC),
// ISO 날짜 문자열을 UTC 로 파싱해 달력 날짜 그대로의 요일을 구한다(TZ 무관, 결정적).
import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";

import { type ScheduleEvent } from "@/lib/schedule/api";

const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];

// "YYYY-MM-DD" → { md: "M/D", weekday: 한글, dow }. UTC 고정 파싱(서버 TZ 무관).
function fmtDate(iso: string): { md: string; weekday: string; dow: number } {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { md: `${m}/${d}`, weekday: WEEKDAYS_KO[dow], dow };
}

// 주말 요일 색(일=빨강 계열, 토=브랜드 계열) — 나머지는 muted.
function weekdayColor(dow: number): string {
  if (dow === 0) return "text-destructive/70";
  if (dow === 6) return "text-primary/70";
  return "text-muted-foreground";
}

export function ScheduleVoteBar({
  moimId,
  schedule,
  memberCount,
}: {
  moimId: string;
  schedule: ScheduleEvent | null;
  memberCount: number;
}) {
  const href = `/moims/${encodeURIComponent(moimId)}/schedule`;

  // 미설정(또는 후보 날짜 없음) → 일정 조율 시작 CTA.
  if (!schedule || schedule.dates.length === 0) {
    return (
      <Link
        href={href}
        className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-transform active:scale-[0.99]"
      >
        <span className="bg-gradient-brand-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
          <CalendarClock size={20} className="text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">아직 일정 조율 전이에요</p>
          <p className="truncate text-xs text-muted-foreground">
            후보 날짜를 정하고 가능한 시간을 모아보세요
          </p>
        </div>
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" />
      </Link>
    );
  }

  // 후보 날짜별 참여 멤버 수(중복 제거) 집계.
  const voteByDate = new Map<string, Set<string>>();
  for (const slot of schedule.slots) {
    let set = voteByDate.get(slot.date);
    if (!set) {
      set = new Set();
      voteByDate.set(slot.date, set);
    }
    set.add(slot.userId);
  }
  const bars = schedule.dates.map((date) => ({
    date,
    votes: voteByDate.get(date)?.size ?? 0,
    ...fmtDate(date),
  }));
  const maxVotes = bars.reduce((mx, b) => Math.max(mx, b.votes), 0);

  return (
    <Link
      href={href}
      aria-label="날짜별 참여 현황 — 일정 조율로 이동"
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm transition-transform active:scale-[0.99]"
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
          <CalendarClock size={15} className="text-primary" />
          날짜별 참여 현황
        </span>
        <span className="flex items-center gap-0.5 text-xs font-semibold text-muted-foreground">
          멤버 {memberCount}명
          <ChevronRight size={14} />
        </span>
      </div>

      {/* 가로 스크롤 바 그래프 — 후보 날짜별 참여 멤버 수(막대 높이 + 숫자). */}
      <div className="-mx-1 flex items-end gap-3 overflow-x-auto px-1 pb-1">
        {bars.map((b) => {
          const isTop = b.votes > 0 && b.votes === maxVotes;
          // 막대 높이 — 최다 대비 비율. 참여 1명 이상이면 최소 10% 는 보이게 한다.
          const pct = maxVotes > 0 && b.votes > 0 ? Math.max((b.votes / maxVotes) * 100, 10) : 0;
          return (
            <div key={b.date} className="flex w-10 shrink-0 flex-col items-center gap-1.5">
              {/* 숫자 */}
              <span
                className={`text-sm font-extrabold ${
                  b.votes === 0
                    ? "text-muted-foreground/50"
                    : isTop
                      ? "text-gradient-brand"
                      : "text-foreground"
                }`}
              >
                {b.votes}
              </span>
              {/* 막대 트랙 + 채움 */}
              <div className="flex h-24 w-7 items-end overflow-hidden rounded-full bg-muted">
                <div
                  className="bg-gradient-brand w-full rounded-full transition-[height]"
                  style={{
                    height: `${pct}%`,
                    // 높이(참여도)에 따라 농도도 함께 — 낮은 막대는 옅게, 최다는 진하게.
                    opacity: maxVotes > 0 ? 0.4 + 0.6 * (b.votes / maxVotes) : 0,
                  }}
                />
              </div>
              {/* 날짜/요일 */}
              <div className="flex flex-col items-center leading-tight">
                <span className="text-[11px] font-bold text-foreground">{b.md}</span>
                <span className={`text-[10px] font-medium ${weekdayColor(b.dow)}`}>
                  {b.weekday}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Link>
  );
}
