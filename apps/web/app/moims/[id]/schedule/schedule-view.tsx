// 일정 조율 클라이언트 뷰 (SPEC-SCHEDULE-001, When2meet 스타일).
//
// 미설정 + owner → 설정 폼(후보 날짜 + 시간 범위). 설정됨 → 드래그 그리드:
//   - "내 가능시간" 모드: 드래그/탭으로 가능 셀 토글 → 저장(통째 교체).
//   - "전체 보기" 모드: 그라데이션 히트맵(겹침 농도) + 셀 탭 시 가능/불가 멤버. owner 는 셀 탭 → 확정.
// 시간 범위가 자정을 넘으면(endMinute>1440) 다음날 새벽 슬롯이 "+1일" 구분으로 이어진다.
// 실시간: useScheduleChannel 로 다른 멤버 변경 시 그리드/히트맵을 서버 재조회로 갱신(편집 중이면 내 선택 보존).
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";

import {
  type ScheduleEvent,
  formatMinute,
  isNextDay,
} from "@/lib/schedule/api";
import { useScheduleChannel } from "@/lib/schedule/useScheduleChannel";
import {
  confirmScheduleAction,
  deleteScheduleAction,
  setMyAvailabilityAction,
  setScheduleAction,
} from "./schedule-actions";

// ─────────────────────────────────────────────
// 슬롯 키 헬퍼 — (date, minute) ↔ "date#minute"
// ─────────────────────────────────────────────
function slotKey(date: string, minute: number): string {
  return `${date}#${minute}`;
}
function parseKey(key: string): { date: string; startMinute: number } {
  const [date, m] = key.split("#");
  return { date, startMinute: Number(m) };
}

// 시간 행(startMinute~endMinute, slotMinutes 간격)을 배열로 만든다.
function buildRows(start: number, end: number, slot: number): number[] {
  const rows: number[] = [];
  for (let m = start; m < end; m += slot) {
    rows.push(m);
  }
  return rows;
}

// ISO date "YYYY-MM-DD" → 날짜 헤더 표기(월/일 + 한국어 요일). KST 기준.
const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"];
function formatDateHeader(iso: string): { md: string; weekday: string } {
  const d = new Date(`${iso}T00:00:00+09:00`);
  return {
    md: `${d.getMonth() + 1}/${d.getDate()}`,
    weekday: WEEKDAYS_KO[d.getDay()],
  };
}

// ISO date 조립("YYYY-MM-DD").
function toIsoDate(y: number, m0: number, d: number): string {
  return `${y}-${String(m0 + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────
// 월 캘린더 — 날짜 다중 선택(터치). 키보드 입력 없이 탭으로만 후보 날짜를 고른다.
// 과거 날짜는 비활성, 오늘은 ring, 선택은 그라데이션. ‹ › 로 월 이동(현재 달 이전으로는 못 감).
// ─────────────────────────────────────────────
function MonthCalendar({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (iso: string) => void;
}) {
  const now = new Date();
  const todayIso = toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const canPrev =
    viewYear > now.getFullYear() ||
    (viewYear === now.getFullYear() && viewMonth > now.getMonth());

  function shift(delta: number) {
    let y = viewYear;
    let m = viewMonth + delta;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewYear(y);
    setViewMonth(m);
  }

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(toIsoDate(viewYear, viewMonth, d));

  return (
    <div className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      {/* 월 네비 */}
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          disabled={!canPrev}
          onClick={() => shift(-1)}
          aria-label="이전 달"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted disabled:opacity-30"
        >
          <ChevronLeft size={20} />
        </button>
        <span className="text-base font-extrabold text-foreground">
          {viewYear}년 {viewMonth + 1}월
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label="다음 달"
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {/* 요일 헤더 */}
      <div className="mb-1 grid grid-cols-7">
        {WEEKDAYS_KO.map((w, i) => (
          <span
            key={w}
            className={`text-center text-[11px] font-semibold ${
              i === 0 ? "text-destructive/60" : i === 6 ? "text-primary/70" : "text-muted-foreground"
            }`}
          >
            {w}
          </span>
        ))}
      </div>
      {/* 날짜 그리드 */}
      <div className="grid grid-cols-7 gap-1">
        {cells.map((iso, i) => {
          if (!iso) return <span key={`empty-${i}`} aria-hidden />;
          const day = Number(iso.slice(8));
          const past = iso < todayIso;
          const isToday = iso === todayIso;
          const isSel = selected.has(iso);
          return (
            <button
              key={iso}
              type="button"
              disabled={past}
              onClick={() => onToggle(iso)}
              aria-pressed={isSel}
              className={`flex aspect-square items-center justify-center rounded-xl text-sm font-semibold transition-transform active:scale-90 ${
                past
                  ? "cursor-default text-muted-foreground/30"
                  : isSel
                    ? "bg-gradient-brand text-white shadow-md shadow-primary/25"
                    : "text-foreground hover:bg-muted"
              } ${isToday && !isSel ? "ring-1 ring-primary/40" : ""}`}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 시간 칩 행 — 가로 스크롤 칩을 탭해 시각 선택(키보드/드롭다운 없이 터치).
// ─────────────────────────────────────────────
function HourChips({
  label,
  value,
  options,
  formatLabel,
  onSelect,
}: {
  label: string;
  value: number;
  options: number[];
  formatLabel: (h: number) => string;
  onSelect: (h: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {options.map((h) => (
          <button
            key={h}
            type="button"
            onClick={() => onSelect(h)}
            aria-pressed={value === h}
            className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-semibold transition-transform active:scale-95 ${
              value === h
                ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                : "border border-border bg-card text-muted-foreground"
            }`}
          >
            {formatLabel(h)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 설정 폼 — 미설정 + owner (터치 캘린더 날짜 + 시간 칩 + 슬롯 단위)
// ─────────────────────────────────────────────
function SetupForm({ moimId }: { moimId: string }) {
  const router = useRouter();
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  // 시간 범위(hour 단위). endHour 25~30 = 익일 1~6시(자정 넘김).
  const [startHour, setStartHour] = useState(18);
  const [endHour, setEndHour] = useState(24);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleDate = useCallback((iso: string) => {
    setSelectedDates((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }, []);

  // 시작 시각을 바꾸면 종료가 그 이하가 되지 않도록 보정(터치 UX — 모순 상태 방지).
  function handleStart(h: number) {
    setStartHour(h);
    if (endHour <= h) setEndHour(h + 1);
  }

  function handleSubmit() {
    setError(null);
    const dates = [...selectedDates].sort();
    if (dates.length === 0) {
      setError("후보 날짜를 한 개 이상 선택해 주세요.");
      return;
    }
    const startMinute = startHour * 60;
    const endMinute = endHour * 60;
    if (endMinute <= startMinute) {
      setError("종료 시각은 시작 시각보다 늦어야 해요.");
      return;
    }
    if ((endMinute - startMinute) % slotMinutes !== 0) {
      setError("시간 범위가 슬롯 단위로 나누어떨어지지 않아요.");
      return;
    }
    startTransition(async () => {
      const res = await setScheduleAction(moimId, {
        dates,
        startMinute,
        endMinute,
        slotMinutes,
      });
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  const startOptions = Array.from({ length: 24 }, (_, i) => i);
  // 종료 옵션 — (시작+1)~30시(24 초과는 익일 새벽). label 로 자정 넘김을 명시한다.
  const endOptions = Array.from({ length: 30 }, (_, i) => i + 1).filter(
    (h) => h > startHour,
  );

  return (
    <div className="animate-fade-in-up flex flex-col gap-5 px-5 pb-8 pt-4">
      <div className="bg-gradient-brand-soft flex flex-col gap-1 rounded-3xl border border-border p-5">
        <span className="text-base font-extrabold text-foreground">
          언제 모일지 같이 정해요
        </span>
        <span className="text-sm text-muted-foreground">
          후보 날짜와 시간대를 정하면, 멤버들이 각자 가능한 시간을 칠해요. 겹치는 시간이 한눈에 보여요.
        </span>
      </div>

      {/* 후보 날짜 — 터치 캘린더 */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">후보 날짜</span>
          {selectedDates.size > 0 ? (
            <span className="text-xs font-bold text-gradient-brand">
              {selectedDates.size}일 선택됨
            </span>
          ) : null}
        </div>
        <MonthCalendar selected={selectedDates} onToggle={toggleDate} />
        {selectedDates.size > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {[...selectedDates].sort().map((d) => {
              const { md, weekday } = formatDateHeader(d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDate(d)}
                  className="bg-gradient-brand-soft flex items-center gap-1 rounded-full border border-primary/30 px-2.5 py-1 text-xs font-semibold transition-transform active:scale-95"
                >
                  <span className="text-gradient-brand">
                    {md}({weekday})
                  </span>
                  <span className="text-primary">×</span>
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            달력에서 날짜를 탭해 선택하세요(여러 개 가능).
          </span>
        )}
      </div>

      {/* 시간대 — 터치 칩 */}
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-semibold text-foreground">시간대</span>
        <HourChips
          label="시작"
          value={startHour}
          options={startOptions}
          formatLabel={(h) => `${String(h).padStart(2, "0")}:00`}
          onSelect={handleStart}
        />
        <HourChips
          label="종료"
          value={endHour}
          options={endOptions}
          formatLabel={(h) =>
            h <= 24
              ? `${String(h).padStart(2, "0")}:00`
              : `익일 ${String(h - 24).padStart(2, "0")}:00`
          }
          onSelect={setEndHour}
        />
        <span className="text-xs text-muted-foreground">
          종료가 다음날 새벽이면 익일로 표시돼요(밤샘 모임도 OK).
        </span>
      </div>

      {/* 슬롯 단위 */}
      <div className="flex flex-col gap-2.5">
        <span className="text-sm font-semibold text-foreground">시간 간격</span>
        <div className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border bg-card p-1">
          {[15, 30, 60].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSlotMinutes(s)}
              className={`rounded-xl py-2.5 text-sm font-semibold transition-all active:scale-95 ${
                slotMinutes === s
                  ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}분
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        disabled={pending}
        onClick={handleSubmit}
        className="bg-gradient-brand w-full rounded-2xl py-3.5 text-base font-bold text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
      >
        {pending ? "만드는 중..." : "일정 조율 시작하기"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// 확정 다이얼로그
// ─────────────────────────────────────────────
function ConfirmDialog({
  label,
  isPending,
  onCancel,
  onConfirm,
}: {
  label: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div className="animate-scale-in mx-4 w-full max-w-sm rounded-3xl bg-card p-6 shadow-2xl">
        <p className="text-center text-base font-bold text-foreground">
          이 시간으로 모임 일정을 확정할까요?
        </p>
        <p className="mt-2 text-center text-sm font-semibold text-gradient-brand">{label}</p>
        <p className="mt-1 text-center text-xs text-muted-foreground">
          확정하면 모임 일정이 이 시간으로 설정되고, 멤버는 가능시간을 더 바꿀 수 없어요.
        </p>
        <div className="mt-5 flex gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={onCancel}
            className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className="bg-gradient-brand flex-1 rounded-2xl py-3 text-sm font-bold text-white shadow-md shadow-primary/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {isPending ? "확정 중..." : "확정하기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 메인 뷰
// ─────────────────────────────────────────────
interface ScheduleViewProps {
  moimId: string;
  schedule: ScheduleEvent | null;
  nicknameMap: Record<string, string>;
  memberCount: number;
  isOwner: boolean;
  currentUserId: string;
  accessToken: string;
}

export function ScheduleView({
  moimId,
  schedule,
  nicknameMap,
  memberCount,
  isOwner,
  currentUserId,
  accessToken,
}: ScheduleViewProps) {
  const router = useRouter();

  // 실시간 — 다른 멤버 변경 시 서버 재조회(편집 중이면 내 선택은 dirty 가드로 보존).
  const handleChange = useCallback(() => {
    router.refresh();
  }, [router]);
  useScheduleChannel(moimId, accessToken, handleChange);

  if (!schedule) {
    return (
      <div className="flex min-h-dvh flex-col bg-background">
        <ScheduleHeader moimId={moimId} title="일정 조율" />
        {isOwner ? (
          <SetupForm moimId={moimId} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="bg-gradient-brand-soft flex h-24 w-24 items-center justify-center rounded-full text-4xl ring-1 ring-border">
              🗓️
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-lg font-bold text-foreground">아직 일정 조율 전이에요</p>
              <p className="text-sm text-muted-foreground">
                방장이 후보 날짜를 정하면 가능한 시간을 칠할 수 있어요.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <ScheduleGrid
      moimId={moimId}
      schedule={schedule}
      nicknameMap={nicknameMap}
      memberCount={memberCount}
      isOwner={isOwner}
      currentUserId={currentUserId}
    />
  );
}

// 상단 헤더(뒤로 + 타이틀). chat/expenses 헤더와 동일 토큰.
function ScheduleHeader({ moimId, title }: { moimId: string; title: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
      <Link
        href={`/home/${moimId}`}
        aria-label="모임 상세로 돌아가기"
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
      >
        <ChevronLeft size={22} />
      </Link>
      <h1 className="text-lg font-bold text-foreground">{title}</h1>
    </header>
  );
}

// ─────────────────────────────────────────────
// 그리드(설정됨) — 드래그 편집 + 히트맵 + 확정
// ─────────────────────────────────────────────
function ScheduleGrid({
  moimId,
  schedule,
  nicknameMap,
  memberCount,
  isOwner,
  currentUserId,
}: {
  moimId: string;
  schedule: ScheduleEvent;
  nicknameMap: Record<string, string>;
  memberCount: number;
  isOwner: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const confirmed = schedule.confirmedAt !== null;

  // 모드: 편집(내 가능시간) / 전체(히트맵). 확정되면 전체 보기 고정.
  const [mode, setMode] = useState<"edit" | "all">(confirmed ? "all" : "edit");

  // 내 가능 슬롯(로컬 편집 상태). 초기값 = 서버의 내 슬롯.
  const myInitial = useMemo(() => {
    const s = new Set<string>();
    for (const slot of schedule.slots) {
      if (slot.userId === currentUserId) s.add(slotKey(slot.date, slot.startMinute));
    }
    return s;
  }, [schedule.slots, currentUserId]);

  const [mySlots, setMySlots] = useState<Set<string>>(myInitial);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savePending, startSave] = useTransition();

  // 실시간/서버 갱신으로 schedule 이 바뀌면, 내가 편집 중(dirty)이 아닐 때만 내 슬롯을 서버값과 동기화한다
  // (편집 중이면 내 미저장 선택을 덮어쓰지 않는다 — 다른 멤버 변경은 히트맵에만 반영).
  // [react-hooks/set-state-in-effect 회피] effect 가 아니라 "이전 렌더 값과 비교 후 렌더 중 조정"하는 React
  // 공식 패턴(Adjusting state when a prop changes)을 쓴다 — myInitial 참조가 바뀌고 비-dirty 일 때만 동기화한다.
  const [syncedInitial, setSyncedInitial] = useState(myInitial);
  if (syncedInitial !== myInitial && !dirty) {
    setSyncedInitial(myInitial);
    setMySlots(myInitial);
  }

  // 전체 멤버 히트맵 집계: slotKey → 가능 userId 집합.
  const heatmap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const slot of schedule.slots) {
      const k = slotKey(slot.date, slot.startMinute);
      const arr = m.get(k);
      if (arr) arr.push(slot.userId);
      else m.set(k, [slot.userId]);
    }
    return m;
  }, [schedule.slots]);

  // 최다 겹침 수(베스트 슬롯 강조용).
  const maxCount = useMemo(() => {
    let max = 0;
    for (const arr of heatmap.values()) max = Math.max(max, arr.length);
    return max;
  }, [heatmap]);

  // 추천 슬롯(겹침 많은 순 TOP 3) — 좁은 격자 셀이 인원 몰림 정보를 다 못 보여주는 제약을 보완한다.
  // 격자 밖 카드로 "어느 날·몇 시에·누가" 가능한지 멤버 칩까지 완전히 노출한다.
  const topSlots = useMemo(() => {
    return [...heatmap.entries()]
      .map(([key, users]) => ({ key, ...parseKey(key), users, count: users.length }))
      .filter((s) => s.count > 0)
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.date.localeCompare(b.date) ||
          a.startMinute - b.startMinute,
      )
      .slice(0, 3);
  }, [heatmap]);

  // 날짜별 최대 겹침(컬럼 헤더 배지) — 어느 날에 인원이 몰리는지 한눈에 비교한다.
  const dateMax = useMemo(() => {
    const m = new Map<string, number>();
    for (const [key, users] of heatmap) {
      const { date } = parseKey(key);
      m.set(date, Math.max(m.get(date) ?? 0, users.length));
    }
    return m;
  }, [heatmap]);

  const rows = useMemo(
    () => buildRows(schedule.startMinute, schedule.endMinute, schedule.slotMinutes),
    [schedule.startMinute, schedule.endMinute, schedule.slotMinutes],
  );

  // ── 드래그 편집(마우스 + 터치 통합) ──────────────────────────────────────
  const dragModeRef = useRef<null | "add" | "remove">(null);

  const applyCell = useCallback((key: string, m: "add" | "remove") => {
    setMySlots((prev) => {
      if (m === "add" ? prev.has(key) : !prev.has(key)) return prev;
      const next = new Set(prev);
      if (m === "add") next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  function startDrag(key: string) {
    if (confirmed || mode !== "edit") return;
    const m: "add" | "remove" = mySlots.has(key) ? "remove" : "add";
    dragModeRef.current = m;
    setDirty(true);
    setSaveError(null);
    applyCell(key, m);
  }

  // 터치 드래그는 onPointerEnter 가 신뢰성 낮아 컨테이너 pointermove + elementFromPoint 로 현재 셀을 찾는다.
  function handleGridPointerMove(e: React.PointerEvent) {
    if (!dragModeRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const key = el?.getAttribute("data-slot-key");
    if (key) applyCell(key, dragModeRef.current);
  }

  useEffect(() => {
    function end() {
      dragModeRef.current = null;
    }
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, []);

  function handleSave() {
    setSaveError(null);
    startSave(async () => {
      const slots = [...mySlots].map(parseKey);
      const res = await setMyAvailabilityAction(moimId, slots);
      if (res?.error) {
        setSaveError(res.error);
        return;
      }
      setDirty(false);
      router.refresh();
    });
  }

  // ── 셀 선택(히트맵 정보 / 확정 후보) ────────────────────────────────────
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ date: string; minute: number } | null>(null);
  const [confirmPending, startConfirm] = useTransition();
  const [deletePending, startDelete] = useTransition();

  function handleConfirm() {
    if (!dialog) return;
    startConfirm(async () => {
      const res = await confirmScheduleAction(moimId, dialog.date, dialog.minute);
      if (res?.error) {
        setSaveError(res.error);
        setDialog(null);
        return;
      }
      setDialog(null);
      router.refresh();
    });
  }

  function handleReset() {
    startDelete(async () => {
      await deleteScheduleAction(moimId);
      router.refresh();
    });
  }

  // 선택된 셀의 가능/불가 멤버.
  const selectedInfo = useMemo(() => {
    if (!selected) return null;
    const available = heatmap.get(selected) ?? [];
    const availSet = new Set(available);
    const unavailable = Object.keys(nicknameMap).filter((u) => !availSet.has(u));
    const { date, startMinute } = parseKey(selected);
    return { date, startMinute, available, unavailable };
  }, [selected, heatmap, nicknameMap]);

  // 그리드 컬럼 폭(날짜 수 기준). 시간 라벨 56px + 날짜 컬럼들.
  const colTemplate = `56px repeat(${schedule.dates.length}, minmax(48px, 1fr))`;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <ScheduleHeader moimId={moimId} title="일정 조율" />

      <div className="flex flex-1 flex-col gap-3 px-3 pb-28 pt-3">
        {/* 확정 배너 */}
        {confirmed && schedule.confirmedAt ? (
          <div className="bg-gradient-brand-soft animate-fade-in-up flex items-center gap-2 rounded-2xl border border-primary/30 px-4 py-3">
            <Check size={18} className="shrink-0 text-primary" />
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-semibold text-muted-foreground">확정된 모임 일정</span>
              <span className="truncate text-sm font-bold text-gradient-brand">
                {/* confirmedAt 은 확정 처리 시각이라, 모임 일정은 startsAt(상세 헤더)이 정확.
                    여기선 "확정됨" 사실만 보여주고 정확한 시각은 상세 페이지에서 확인하도록 안내. */}
                일정이 확정되었어요 · 모임 상세에서 확인
              </span>
            </div>
          </div>
        ) : null}

        {/* 모드 토글 + 멤버 수 */}
        {!confirmed ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-1 gap-1 rounded-2xl border border-border bg-card p-1">
              {(
                [
                  { v: "edit", label: "내 가능시간" },
                  { v: "all", label: "전체 보기" },
                ] as const
              ).map((t) => (
                <button
                  key={t.v}
                  type="button"
                  onClick={() => setMode(t.v)}
                  className={`flex-1 rounded-xl py-2 text-sm font-semibold transition-all active:scale-95 ${
                    mode === t.v
                      ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                      : "text-muted-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Users size={14} />
              {memberCount}명
            </span>
          </div>
        ) : null}

        {/* 안내 */}
        <p className="text-xs text-muted-foreground">
          {confirmed
            ? "겹친 가능시간 결과예요. 진할수록 많은 멤버가 가능했어요."
            : mode === "edit"
              ? "가능한 시간을 드래그하거나 탭해서 칠해주세요. 다 칠했으면 저장하세요."
              : maxCount > 0
                ? `진할수록 많은 멤버가 가능해요. 셀을 탭하면 누가 가능한지 보여요.${isOwner ? " 방장은 탭해서 확정할 수 있어요." : ""}`
                : "아직 아무도 가능시간을 칠하지 않았어요."}
        </p>

        {/* 추천 시간 TOP — 좁은 격자 셀이 인원 몰림 정보를 다 못 보여주는 제약을 보완한다.
            겹침 많은 슬롯을 카드로 꺼내, 어느 날·몇 시에·누가 가능한지 멤버 칩까지 완전히 노출한다.
            전체/확정 모드에서만 표시(편집 모드는 내 가능시간 칠하기에 집중). */}
        {(mode === "all" || confirmed) && topSlots.length > 0 ? (
          <div className="animate-fade-in-up flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-bold text-foreground">
              <Sparkles size={15} className="text-primary" />
              가장 많이 겹치는 시간
            </span>
            {topSlots.map((s, i) => {
              const { md, weekday } = formatDateHeader(s.date);
              return (
                <div
                  key={s.key}
                  className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${
                          i === 0
                            ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className="truncate text-sm font-bold text-foreground">
                        {md}({weekday}){" "}
                        {isNextDay(s.startMinute) ? "익일 " : ""}
                        {formatMinute(s.startMinute)}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-gradient-brand">
                      {s.count}/{memberCount}명
                    </span>
                  </div>
                  {/* 가능 멤버 칩 — 인원이 몰려도 wrap 으로 전부 노출(격자 셀의 정보 제약 해소). */}
                  <div className="flex flex-wrap gap-1">
                    {s.users.map((u) => (
                      <span
                        key={u}
                        className="bg-gradient-brand-soft rounded-full px-2 py-0.5 text-[11px] font-semibold text-gradient-brand"
                      >
                        {nicknameMap[u] ?? "멤버"}
                      </span>
                    ))}
                  </div>
                  {isOwner && !confirmed ? (
                    <button
                      type="button"
                      onClick={() => setDialog({ date: s.date, minute: s.startMinute })}
                      className="bg-gradient-brand mt-0.5 w-full rounded-xl py-2 text-xs font-bold text-white shadow-sm shadow-primary/20 transition-transform active:scale-[0.98]"
                    >
                      이 시간으로 확정
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {/* ── 그리드 ── */}
        <div className="overflow-x-auto pb-1">
          <div
            className="select-none"
            style={{ touchAction: mode === "edit" && !confirmed ? "pan-y" : "auto" }}
            onPointerMove={handleGridPointerMove}
          >
            {/* 날짜 헤더 */}
            <div className="grid gap-px" style={{ gridTemplateColumns: colTemplate }}>
              <div className="sticky left-0 z-10 bg-background" />
              {schedule.dates.map((d) => {
                const { md, weekday } = formatDateHeader(d);
                return (
                  <div
                    key={d}
                    className="flex flex-col items-center justify-center rounded-t-lg bg-card py-1.5"
                  >
                    <span className="text-[11px] font-bold text-foreground">{md}</span>
                    <span className="text-[10px] text-muted-foreground">{weekday}</span>
                    {/* 그 날 최대 겹침 배지 — 어느 날에 인원이 몰리는지 한눈에(격자 정보 제약 보완). */}
                    {(mode === "all" || confirmed) && (dateMax.get(d) ?? 0) > 0 ? (
                      <span className="bg-gradient-brand-soft mt-0.5 rounded-full px-1.5 py-px text-[9px] font-bold text-gradient-brand">
                        최대 {dateMax.get(d)}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* 시간 행들 */}
            {rows.map((minute, ri) => {
              const showNextDayMark = isNextDay(minute) && !isNextDay(rows[ri - 1] ?? minute);
              const onHour = minute % 60 === 0;
              return (
                <div
                  key={minute}
                  className="grid gap-px"
                  style={{ gridTemplateColumns: colTemplate }}
                >
                  {/* 시간 라벨(sticky left) */}
                  <div className="sticky left-0 z-10 flex items-start justify-end bg-background pr-1.5">
                    {onHour ? (
                      <span className="-mt-1.5 text-[10px] font-medium text-muted-foreground">
                        {isNextDay(minute) && showNextDayMark ? (
                          <span className="text-primary">+1일 </span>
                        ) : null}
                        {formatMinute(minute)}
                      </span>
                    ) : null}
                  </div>

                  {/* 날짜별 셀 */}
                  {schedule.dates.map((d) => {
                    const key = slotKey(d, minute);
                    const mine = mySlots.has(key);
                    const arr = heatmap.get(key);
                    const count = arr?.length ?? 0;
                    const isBest = count > 0 && count === maxCount;
                    const isSel = selected === key;

                    // 셀 배경: 편집 모드면 내 선택 강조, 전체/확정 모드면 히트맵 농도.
                    let bg: string;
                    let opacity = 1;
                    if (mode === "edit" && !confirmed) {
                      bg = mine ? "bg-gradient-brand" : "bg-muted";
                    } else {
                      // 히트맵 — 농도(opacity)로 겹침 표현. 0이면 옅은 muted.
                      if (count === 0) {
                        bg = "bg-muted";
                      } else {
                        bg = "bg-gradient-brand";
                        opacity = 0.25 + 0.75 * (count / Math.max(maxCount, 1));
                      }
                    }

                    return (
                      <button
                        key={key}
                        type="button"
                        data-slot-key={key}
                        aria-label={`${formatDateHeader(d).md} ${formatMinute(minute)}${count ? ` ${count}명 가능` : ""}`}
                        onPointerDown={() => {
                          if (mode === "edit" && !confirmed) startDrag(key);
                        }}
                        onClick={() => {
                          if (mode === "all" || confirmed) {
                            setSelected(isSel ? null : key);
                          }
                        }}
                        className={`relative h-7 overflow-hidden ${
                          ri === 0 ? "" : ""
                        } ${onHour ? "border-t border-border/40" : ""} ${
                          isSel ? "ring-2 ring-primary ring-inset" : ""
                        } transition-transform active:scale-[0.97]`}
                      >
                        <span className={`absolute inset-0 ${bg}`} style={{ opacity }} />
                        {isBest && (mode === "all" || confirmed) ? (
                          <Sparkles
                            size={11}
                            className="absolute inset-0 m-auto text-white drop-shadow"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* 선택 셀 정보(전체/확정 모드) */}
        {selectedInfo ? (
          <div className="animate-scale-in flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">
                {formatDateHeader(selectedInfo.date).md} (
                {formatDateHeader(selectedInfo.date).weekday}){" "}
                {isNextDay(selectedInfo.startMinute) ? "익일 " : ""}
                {formatMinute(selectedInfo.startMinute)}
              </span>
              <span className="text-xs font-semibold text-gradient-brand">
                {selectedInfo.available.length}/{memberCount}명 가능
              </span>
            </div>
            {selectedInfo.available.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {selectedInfo.available.map((u) => (
                  <span
                    key={u}
                    className="bg-gradient-brand-soft rounded-full px-2.5 py-1 text-xs font-semibold text-gradient-brand"
                  >
                    {nicknameMap[u] ?? "멤버"}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">아직 가능한 멤버가 없어요.</span>
            )}
            {selectedInfo.unavailable.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 opacity-60">
                {selectedInfo.unavailable.map((u) => (
                  <span
                    key={u}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground line-through"
                  >
                    {nicknameMap[u] ?? "멤버"}
                  </span>
                ))}
              </div>
            ) : null}
            {/* owner 확정 버튼(미확정 시) */}
            {isOwner && !confirmed ? (
              <button
                type="button"
                onClick={() =>
                  setDialog({ date: selectedInfo.date, minute: selectedInfo.startMinute })
                }
                className="bg-gradient-brand mt-1 w-full rounded-xl py-2.5 text-sm font-bold text-white shadow-md shadow-primary/20 transition-transform active:scale-[0.98]"
              >
                이 시간으로 확정하기
              </button>
            ) : null}
          </div>
        ) : null}

        {saveError ? (
          <p role="alert" className="text-sm text-destructive">
            {saveError}
          </p>
        ) : null}

        {/* owner 초기화(미확정 시, 그리드 하단) */}
        {isOwner && !confirmed ? (
          <button
            type="button"
            disabled={deletePending}
            onClick={handleReset}
            className="mt-1 flex items-center justify-center gap-1.5 self-center rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
          >
            <Trash2 size={13} />
            {deletePending ? "초기화 중..." : "일정 조율 초기화"}
          </button>
        ) : null}
      </div>

      {/* 저장 바(편집 모드 + 변경됨) — 하단 고정 */}
      {mode === "edit" && !confirmed && dirty ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/90 p-3 backdrop-blur-xl">
          <button
            type="button"
            disabled={savePending}
            onClick={handleSave}
            className="bg-gradient-brand w-full rounded-2xl py-3.5 text-base font-bold text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {savePending ? "저장 중..." : `내 가능시간 저장 (${mySlots.size}칸)`}
          </button>
        </div>
      ) : null}

      {/* 확정 다이얼로그 */}
      {dialog ? (
        <ConfirmDialog
          label={`${formatDateHeader(dialog.date).md} (${formatDateHeader(dialog.date).weekday}) ${isNextDay(dialog.minute) ? "익일 " : ""}${formatMinute(dialog.minute)}`}
          isPending={confirmPending}
          onCancel={() => setDialog(null)}
          onConfirm={handleConfirm}
        />
      ) : null}
    </div>
  );
}
