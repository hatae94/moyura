// 일정 조율 클라이언트 뷰 (SPEC-SCHEDULE-001, 포커스 데이 타임라인).
//
// 미설정 + owner → 설정 폼(후보 날짜 + 시간 범위). 설정됨 → 하루씩 포커스하는 세로 타임라인:
//   - 날짜 칩 레일: 하루씩 전환(스와이프), 칩마다 그날 최다 겹침 배지. 누구나 "＋날짜" 로 후보 추가.
//   - 브라우즈(기본): 넓은 행에 밀도바 + N명 + 아바타 스택 → "누가·언제" 를 좁은 셀 없이 노출. 행 탭 → 상세.
//   - 칠하기 모드(FAB): 전체화면 오버레이 + body 스크롤 잠금. 짧게 탭=한 칸 토글, 꾹 눌러 잡고 드래그=범위 칠하기.
//     → 페인팅 중엔 스크롤이 없어 드래그가 스크롤로 오인되지 않는다(When2meet 계열의 스크롤·드래그 충돌 원천 제거).
//   - 시간대 넓히기: 타임라인 위/아래 "＋이전/이후 시간" 으로 누구나 조율 범위를 앞뒤로 확장(넓히기 전용, 슬롯 보존).
// 시간 범위가 자정을 넘으면(endMinute>1440) 다음날 새벽 슬롯이 "+1일" 구분으로 이어진다.
// 실시간: useScheduleChannel 로 다른 멤버 변경 시 서버 재조회로 갱신(편집 중이면 내 선택은 dirty 가드로 보존).
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
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Check,
  Pencil,
  Plus,
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
  updateScheduleDatesAction,
  updateScheduleWindowAction,
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
// 날짜 편집 모달 — 멤버 누구나 후보 날짜 추가/제거(협업). MonthCalendar 재사용, bottom sheet.
// 저장 시 updateScheduleDatesAction → 서버 event touch → schedule_change 방송으로 다른 멤버 그리드도 실시간 갱신.
// ─────────────────────────────────────────────
function DateEditModal({
  moimId,
  currentDates,
  onClose,
}: {
  moimId: string;
  currentDates: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(currentDates));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleDate = useCallback((iso: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
  }, []);

  function handleSave() {
    setError(null);
    const dates = [...selected].sort();
    if (dates.length === 0) {
      setError("후보 날짜를 한 개 이상 남겨주세요.");
      return;
    }
    startTransition(async () => {
      const res = await updateScheduleDatesAction(moimId, dates);
      if (res?.error) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="후보 날짜 편집"
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-slide-up flex max-h-[88vh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-[1.75rem] bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="text-base font-extrabold text-foreground">후보 날짜 편집</span>
          <span className="text-xs font-bold text-gradient-brand">{selected.size}일</span>
        </div>
        <p className="text-xs text-muted-foreground">
          날짜를 탭해 후보를 추가하거나 뺄 수 있어요(누구나 가능). 뺀 날짜의 가능시간은 사라져요.
        </p>
        <MonthCalendar selected={selected} onToggle={toggleDate} />
        {selected.size > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {[...selected].sort().map((d) => {
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
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="flex-1 rounded-2xl border border-border py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted active:scale-[0.98] disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={handleSave}
            className="bg-gradient-brand flex-1 rounded-2xl py-3 text-sm font-bold text-white shadow-md shadow-primary/20 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
          >
            {pending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
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
    // z-20: 그리드의 좌측 시간축 라벨(sticky left, z-10)보다 위에 두어, 세로 스크롤 시 시간축이 헤더를
    // 가리지 않게 한다(둘 다 z-10 이던 문제 수정 — DOM 상 나중인 시간축이 헤더 위로 그려졌음).
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
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
// 그리드(설정됨) — 포커스 데이 타임라인 + 칠하기 오버레이 + 시간대 넓히기
// ─────────────────────────────────────────────

// 아바타 원형(닉네임 첫 글자). 프로필 이미지가 없어 이니셜로 "누가" 를 좁은 셀 없이 노출한다.
function Avatar({ name }: { name: string }) {
  return (
    <span className="bg-gradient-brand flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ring-2 ring-background">
      {name.slice(0, 1)}
    </span>
  );
}

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

  // 활성 날짜(하루 포커스). 후보 날짜가 추가/삭제로 바뀌어 활성 날짜가 사라지면 첫 날로 보정한다
  // (effect 대신 렌더 중 조정 — react-hooks/set-state-in-effect 회피, 아래 myInitial 동기화와 동일 패턴).
  const [activeDate, setActiveDate] = useState<string>(schedule.dates[0] ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [syncedDates, setSyncedDates] = useState(schedule.dates);
  if (syncedDates !== schedule.dates) {
    setSyncedDates(schedule.dates);
    if (!schedule.dates.includes(activeDate)) {
      setActiveDate(schedule.dates[0] ?? "");
      setSelected(null);
    }
  }

  // 날짜 전환 — 활성 날짜를 바꾸고 상세 선택을 초기화한다.
  const pickDate = useCallback((d: string) => {
    setActiveDate(d);
    setSelected(null);
  }, []);

  // 내 가능 슬롯(로컬 편집 상태, 전체 날짜 통합). 초기값 = 서버의 내 슬롯.
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

  // 실시간/서버 갱신으로 schedule 이 바뀌면, 내가 편집 중(dirty)이 아닐 때만 서버값과 동기화한다
  // (편집 중이면 미저장 선택을 덮어쓰지 않는다). effect 아닌 렌더 중 조정(React 공식 패턴).
  const [syncedInitial, setSyncedInitial] = useState(myInitial);
  if (syncedInitial !== myInitial && !dirty) {
    setSyncedInitial(myInitial);
    setMySlots(myInitial);
  }

  // mySlots 최신값을 ref 로 미러 — 롱프레스 타이머/네이티브 터치 리스너 콜백에서 stale 없이 참조한다.
  // (렌더 중 ref 대입은 react-hooks/refs 위반 → effect 로 커밋 후 동기화. 콜백은 항상 최신 값을 읽는다.)
  const mySlotsRef = useRef(mySlots);
  useEffect(() => {
    mySlotsRef.current = mySlots;
  }, [mySlots]);

  // 전체 멤버 히트맵 집계: slotKey → 가능 userId 배열.
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

  // 최다 겹침 수(밀도바 정규화 + 베스트 강조용).
  const maxCount = useMemo(() => {
    let max = 0;
    for (const arr of heatmap.values()) max = Math.max(max, arr.length);
    return max;
  }, [heatmap]);

  // 추천 슬롯(겹침 많은 순 TOP 3) — 어느 날·몇 시에·누가 가능한지 카드로 완전히 노출한다.
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

  // 날짜별 최대 겹침(날짜 칩 배지) — 어느 날에 인원이 몰리는지 한눈에 비교한다.
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

  // ── 셀 적용(add/remove) ──────────────────────────────────────────────────
  const applyCell = useCallback((key: string, m: "add" | "remove") => {
    setMySlots((prev) => {
      if (m === "add" ? prev.has(key) : !prev.has(key)) return prev;
      const next = new Set(prev);
      if (m === "add") next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // ── 칠하기 모드(전체화면 오버레이) ────────────────────────────────────────
  const [paintOpen, setPaintOpen] = useState(false);
  const paintingRef = useRef(false); // 활성 드래그(스크롤 차단 여부)
  const dragModeRef = useRef<null | "add" | "remove">(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressStartRef = useRef<{ x: number; y: number; key: string } | null>(null);
  const paintScrollRef = useRef<HTMLDivElement | null>(null);
  const paintBackupRef = useRef<Set<string>>(new Set());

  // 칠하기 오버레이 동안 body 스크롤 잠금(moim-action-dock 과 동일 기법 — 배경 스크롤 방지).
  useEffect(() => {
    if (!paintOpen) return;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = prev;
    };
  }, [paintOpen]);

  // 드래그 시작(잡기) — 현재 셀 상태로 add/remove 를 정하고 즉시 한 칸 반영한다.
  const beginPaint = useCallback(
    (key: string) => {
      paintingRef.current = true;
      const m: "add" | "remove" = mySlotsRef.current.has(key) ? "remove" : "add";
      dragModeRef.current = m;
      setDirty(true);
      setSaveError(null);
      applyCell(key, m);
    },
    [applyCell],
  );

  // 셀 pointerdown — 마우스는 즉시 칠하기, 터치/펜은 160ms 롱프레스로 "잡기"(스크롤 vs 드래그 구분).
  // 이 구분이 When2meet 계열의 "빠른 드래그가 스크롤로 오인" 문제를 없앤다(짧게 탭=한 칸 토글).
  const handleCellDown = useCallback(
    (e: React.PointerEvent, key: string) => {
      if (confirmed) return;
      if (e.pointerType === "mouse") {
        beginPaint(key);
        return;
      }
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      pressStartRef.current = { x: e.clientX, y: e.clientY, key };
      pressTimerRef.current = setTimeout(() => beginPaint(key), 160);
    },
    [confirmed, beginPaint],
  );

  // 마우스 드래그 — 컨테이너 위에서 elementFromPoint 로 현재 셀을 찾아 칠한다(터치는 아래 네이티브 리스너).
  const handlePaintMouseMove = useCallback(
    (e: React.PointerEvent) => {
      if (e.pointerType !== "mouse" || !paintingRef.current || !dragModeRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY) as Element | null;
      const key = el?.closest("[data-slot-key]")?.getAttribute("data-slot-key");
      if (key) applyCell(key, dragModeRef.current);
    },
    [applyCell],
  );

  // 네이티브 touchmove(non-passive) — 잡힌 상태면 preventDefault 로 스크롤을 막고 칠한다.
  // 잡기 전 8px 초과 이동은 스크롤 의도로 보고 롱프레스 타이머를 취소한다(스크롤 살림).
  useEffect(() => {
    if (!paintOpen) return;
    const el = paintScrollRef.current;
    if (!el) return;
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      if (paintingRef.current) {
        e.preventDefault();
        const target = document.elementFromPoint(t.clientX, t.clientY) as Element | null;
        const key = target?.closest("[data-slot-key]")?.getAttribute("data-slot-key");
        if (key && dragModeRef.current) applyCell(key, dragModeRef.current);
      } else if (pressStartRef.current) {
        const dx = t.clientX - pressStartRef.current.x;
        const dy = t.clientY - pressStartRef.current.y;
        if (Math.hypot(dx, dy) > 8) {
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
          pressStartRef.current = null;
        }
      }
    }
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => el.removeEventListener("touchmove", onTouchMove);
  }, [paintOpen, applyCell]);

  // 포인터 종료(전역) — 잡기 전 짧은 탭이면 한 칸 토글, 그 외엔 드래그 상태를 정리한다.
  useEffect(() => {
    function end() {
      if (!paintingRef.current && pressStartRef.current) {
        const key = pressStartRef.current.key;
        const m: "add" | "remove" = mySlotsRef.current.has(key) ? "remove" : "add";
        setDirty(true);
        applyCell(key, m);
      }
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
      pressStartRef.current = null;
      paintingRef.current = false;
      dragModeRef.current = null;
    }
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [applyCell]);

  function openPaint() {
    paintBackupRef.current = new Set(mySlots);
    setSaveError(null);
    setPaintOpen(true);
  }
  function cancelPaint() {
    setMySlots(paintBackupRef.current);
    setDirty(false);
    setPaintOpen(false);
  }

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
      setPaintOpen(false);
      router.refresh();
    });
  }

  // ── 확정 / 초기화 / 날짜편집 / 시간대 넓히기 ───────────────────────────────
  const [dialog, setDialog] = useState<{ date: string; minute: number } | null>(null);
  const [dateEditOpen, setDateEditOpen] = useState(false);
  const [confirmPending, startConfirm] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const [windowPending, startWindow] = useTransition();

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

  // 시간대 넓히기(멤버 누구나) — 앞/뒤로 60분씩 확장. 실시간 방송으로 전체 그리드가 갱신된다.
  function extendWindow(newStart: number, newEnd: number) {
    setSaveError(null);
    startWindow(async () => {
      const res = await updateScheduleWindowAction(moimId, newStart, newEnd);
      if (res?.error) {
        setSaveError(res.error);
        return;
      }
      router.refresh();
    });
  }
  const canExtendEarlier = !confirmed && schedule.startMinute >= 60;
  const canExtendLater = !confirmed && schedule.endMinute + 60 <= 2880;

  // 선택된 셀의 가능/불가 멤버(브라우즈 상세 패널).
  const selectedInfo = useMemo(() => {
    if (!selected) return null;
    const available = heatmap.get(selected) ?? [];
    const availSet = new Set(available);
    const unavailable = Object.keys(nicknameMap).filter((u) => !availSet.has(u));
    const { date, startMinute } = parseKey(selected);
    return { date, startMinute, available, unavailable };
  }, [selected, heatmap, nicknameMap]);

  const activeHeader = activeDate ? formatDateHeader(activeDate) : null;

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
                일정이 확정되었어요 · 모임 상세에서 확인
              </span>
            </div>
          </div>
        ) : null}

        {/* 날짜 칩 레일 — 하루씩 포커스. 칩마다 그날 최다 겹침 배지. 누구나 "＋날짜" 로 후보 추가. */}
        <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
          {schedule.dates.map((d) => {
            const { md, weekday } = formatDateHeader(d);
            const peak = dateMax.get(d) ?? 0;
            const active = d === activeDate;
            return (
              <button
                key={d}
                type="button"
                onClick={() => pickDate(d)}
                aria-pressed={active}
                className={`flex shrink-0 flex-col items-center gap-0.5 rounded-2xl border px-3 py-2 transition-transform active:scale-95 ${
                  active
                    ? "bg-gradient-brand border-transparent text-white shadow-md shadow-primary/20"
                    : "border-border bg-card text-foreground"
                }`}
              >
                <span className="text-sm font-extrabold">{md}</span>
                <span
                  className={`text-[10px] ${active ? "text-white/80" : "text-muted-foreground"}`}
                >
                  {weekday}
                </span>
                {peak > 0 ? (
                  <span
                    className={`rounded-full px-1.5 text-[9px] font-bold ${
                      active ? "bg-white/25 text-white" : "bg-gradient-brand-soft text-primary"
                    }`}
                  >
                    ●{peak}
                  </span>
                ) : null}
              </button>
            );
          })}
          {!confirmed ? (
            <button
              type="button"
              onClick={() => setDateEditOpen(true)}
              className="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border border-dashed border-primary/40 px-3 py-2 text-primary transition-transform active:scale-95"
            >
              <CalendarPlus size={16} />
              <span className="text-[10px] font-bold">날짜</span>
            </button>
          ) : null}
        </div>

        {/* 활성 날짜 헤더 + 멤버 수 */}
        {activeHeader ? (
          <div className="flex items-center justify-between">
            <span className="text-base font-extrabold text-foreground">
              {activeHeader.md} ({activeHeader.weekday})
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Users size={14} />
              {memberCount}명
            </span>
          </div>
        ) : null}

        {/* 안내 */}
        <p className="text-xs text-muted-foreground">
          {confirmed
            ? "겹친 가능시간 결과예요. 막대가 길수록 많은 멤버가 가능했어요."
            : maxCount > 0
              ? `막대가 길수록 많은 멤버가 가능해요. 행을 탭하면 누가 가능한지 보여요.${isOwner ? " 방장은 확정할 수 있어요." : ""}`
              : "아직 아무도 가능시간을 칠하지 않았어요. 아래 버튼으로 내 시간을 칠해보세요."}
        </p>

        {/* 추천 시간 TOP — 겹침 많은 슬롯을 카드로 꺼내, 어느 날·몇 시에·누가 가능한지 완전히 노출한다. */}
        {topSlots.length > 0 ? (
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
                      {/* 카드 탭 → 해당 날짜로 포커스 이동 + 그 슬롯 상세 선택(격자 밖에서 바로 점프). */}
                      <button
                        type="button"
                        onClick={() => {
                          pickDate(s.date);
                          setSelected(s.key);
                        }}
                        className="truncate text-left text-sm font-bold text-foreground"
                      >
                        {md}({weekday}) {isNextDay(s.startMinute) ? "익일 " : ""}
                        {formatMinute(s.startMinute)}
                      </button>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-gradient-brand">
                      {s.count}/{memberCount}명
                    </span>
                  </div>
                  {/* 가능 멤버 칩 — 인원이 몰려도 wrap 으로 전부 노출. */}
                  <div className="flex flex-wrap gap-1">
                    {s.users.map((u) => (
                      <span
                        key={u}
                        className="bg-gradient-brand-soft rounded-full px-2 py-0.5 text-[11px] font-semibold text-primary"
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

        {/* ── 활성 날짜 타임라인(브라우즈) ── */}
        <div className="flex flex-col gap-1.5">
          {/* 앞으로(이전 시간) 넓히기 — 누구나 */}
          {canExtendEarlier ? (
            <button
              type="button"
              disabled={windowPending}
              onClick={() => extendWindow(schedule.startMinute - 60, schedule.endMinute)}
              className="flex items-center justify-center gap-1.5 self-center rounded-full border border-dashed border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
            >
              <Plus size={12} />
              이전 시간 열기 ({formatMinute(schedule.startMinute - 60)}~)
            </button>
          ) : null}

          {rows.map((minute, ri) => {
            const showNextDayMark = isNextDay(minute) && !isNextDay(rows[ri - 1] ?? minute);
            const onHour = minute % 60 === 0;
            const key = slotKey(activeDate, minute);
            const users = heatmap.get(key) ?? [];
            const count = users.length;
            const ratio = maxCount > 0 ? count / maxCount : 0;
            const isBest = count > 0 && count === maxCount;
            const isSel = selected === key;
            const mine = mySlots.has(key);
            return (
              <div key={minute} className="flex flex-col">
                {showNextDayMark ? (
                  <div className="my-1 flex items-center gap-2">
                    <span className="h-px flex-1 bg-primary/30" />
                    <span className="text-[10px] font-bold text-primary">+1일 (다음날)</span>
                    <span className="h-px flex-1 bg-primary/30" />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelected(isSel ? null : key)}
                  aria-label={`${formatMinute(minute)}${count ? ` ${count}명 가능` : ""}`}
                  className={`flex items-center gap-2 rounded-xl px-1.5 py-1 text-left transition-transform active:scale-[0.99] ${
                    isSel ? "bg-muted" : ""
                  }`}
                >
                  <span className="w-12 shrink-0 text-right text-[11px] font-medium text-muted-foreground">
                    {onHour ? formatMinute(minute) : ""}
                  </span>
                  <div className="relative h-9 flex-1 overflow-hidden rounded-lg bg-muted">
                    {count > 0 ? (
                      <span
                        className="bg-gradient-brand absolute inset-y-0 left-0 rounded-lg"
                        style={{
                          width: `${Math.max(ratio * 100, 8)}%`,
                          opacity: 0.35 + 0.65 * ratio,
                        }}
                      />
                    ) : null}
                    {isBest ? (
                      <Sparkles
                        size={12}
                        className="absolute left-1.5 top-1/2 -translate-y-1/2 text-white drop-shadow"
                      />
                    ) : null}
                    {mine ? (
                      <span className="absolute inset-y-0 right-1.5 flex items-center">
                        <Check size={13} className="text-primary" />
                      </span>
                    ) : null}
                  </div>
                  <span className="w-8 shrink-0 text-right text-[11px] font-bold text-foreground">
                    {count > 0 ? `${count}명` : ""}
                  </span>
                  <div className="flex w-14 shrink-0 items-center">
                    {users.slice(0, 3).map((u, idx) => (
                      <span key={u} className={idx > 0 ? "-ml-1.5" : ""}>
                        <Avatar name={nicknameMap[u] ?? "멤"} />
                      </span>
                    ))}
                    {users.length > 3 ? (
                      <span className="-ml-1.5 flex h-5 items-center rounded-full bg-muted px-1 text-[9px] font-bold text-muted-foreground ring-2 ring-background">
                        +{users.length - 3}
                      </span>
                    ) : null}
                  </div>
                </button>
              </div>
            );
          })}

          {/* 뒤로(이후 시간) 넓히기 — 누구나. 60분 뒤 경계가 자정 넘김이면 "익일" 표기. */}
          {canExtendLater ? (
            <button
              type="button"
              disabled={windowPending}
              onClick={() => extendWindow(schedule.startMinute, schedule.endMinute + 60)}
              className="flex items-center justify-center gap-1.5 self-center rounded-full border border-dashed border-border px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
            >
              <Plus size={12} />
              이후 시간 열기 (~{schedule.endMinute + 60 > 1440 ? "익일 " : ""}
              {formatMinute(schedule.endMinute + 60)})
            </button>
          ) : null}
        </div>

        {/* 선택 셀 상세(브라우즈) */}
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
                    className="bg-gradient-brand-soft rounded-full px-2.5 py-1 text-xs font-semibold text-primary"
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

        {/* owner 초기화(미확정 시) */}
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

      {/* 칠하기 진입 FAB(미확정) — 하단 고정 */}
      {!confirmed && !paintOpen ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/90 p-3 backdrop-blur-xl"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={openPaint}
            className="bg-gradient-brand flex w-full items-center justify-center gap-2 rounded-2xl py-3.5 text-base font-bold text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
          >
            <Pencil size={18} />
            내 가능시간 칠하기{mySlots.size > 0 ? ` (${mySlots.size}칸)` : ""}
          </button>
        </div>
      ) : null}

      {/* 칠하기 오버레이 — 전체화면 + body 스크롤 잠금. 짧게 탭=토글, 꾹 눌러 드래그=범위 칠하기. */}
      {paintOpen ? (
        <div className="animate-fade-in fixed inset-0 z-50 flex flex-col bg-background">
          {/* 전용 헤더 */}
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <button
              type="button"
              onClick={cancelPaint}
              className="text-sm font-semibold text-muted-foreground"
            >
              취소
            </button>
            <span className="text-sm font-bold text-foreground">
              {activeHeader
                ? `${activeHeader.md}(${activeHeader.weekday}) 가능시간`
                : "가능시간 칠하기"}
            </span>
            <button
              type="button"
              disabled={savePending}
              onClick={handleSave}
              className="text-sm font-bold text-gradient-brand disabled:opacity-50"
            >
              {savePending ? "저장 중" : "저장"}
            </button>
          </header>

          {/* 날짜 칩(칠하기 중에도 날짜 전환) */}
          <div className="flex gap-2 overflow-x-auto border-b border-border px-4 py-2">
            {schedule.dates.map((d) => {
              const { md, weekday } = formatDateHeader(d);
              const active = d === activeDate;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => pickDate(d)}
                  className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold transition-transform active:scale-95 ${
                    active
                      ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                      : "border border-border bg-card text-muted-foreground"
                  }`}
                >
                  {md}({weekday})
                </button>
              );
            })}
          </div>

          <p className="px-4 py-2 text-xs text-muted-foreground">
            꾹 눌러 잡은 뒤 드래그하면 여러 칸을 한 번에 칠해요. 짧게 탭하면 한 칸씩 켜고 꺼요.
          </p>

          {/* 칠하기 타임라인 — touch-action pan-y 로 평소엔 스크롤, 잡힌 동안엔 네이티브 리스너가 스크롤 차단. */}
          <div
            ref={paintScrollRef}
            onPointerMove={handlePaintMouseMove}
            className="flex-1 select-none overflow-y-auto overscroll-contain px-4 pb-6"
            style={{ touchAction: "pan-y" }}
          >
            {rows.map((minute, ri) => {
              const showNextDayMark = isNextDay(minute) && !isNextDay(rows[ri - 1] ?? minute);
              const onHour = minute % 60 === 0;
              const key = slotKey(activeDate, minute);
              const mine = mySlots.has(key);
              return (
                <div key={minute} className="flex flex-col">
                  {showNextDayMark ? (
                    <div className="my-1 flex items-center gap-2">
                      <span className="h-px flex-1 bg-primary/30" />
                      <span className="text-[10px] font-bold text-primary">+1일 (다음날)</span>
                      <span className="h-px flex-1 bg-primary/30" />
                    </div>
                  ) : null}
                  <div className="flex items-stretch gap-2">
                    <span className="w-14 shrink-0 pt-3 text-right text-[11px] font-medium text-muted-foreground">
                      {onHour ? formatMinute(minute) : ""}
                    </span>
                    <button
                      type="button"
                      data-slot-key={key}
                      onPointerDown={(e) => handleCellDown(e, key)}
                      aria-pressed={mine}
                      className={`my-0.5 flex min-h-[2.75rem] flex-1 items-center justify-center rounded-xl text-sm font-bold transition-colors ${
                        mine
                          ? "bg-gradient-brand text-white shadow-sm shadow-primary/20"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {mine ? "가능" : ""}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 저장 바 */}
          <div
            className="border-t border-border p-3"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <button
              type="button"
              disabled={savePending}
              onClick={handleSave}
              className="bg-gradient-brand w-full rounded-2xl py-3.5 text-base font-bold text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100"
            >
              {savePending ? "저장 중..." : `저장 (${mySlots.size}칸)`}
            </button>
          </div>
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

      {/* 후보 날짜 편집 모달(멤버 누구나). 저장 시 실시간 방송으로 다른 멤버 화면도 갱신된다. */}
      {dateEditOpen ? (
        <DateEditModal
          moimId={moimId}
          currentDates={schedule.dates}
          onClose={() => setDateEditOpen(false)}
        />
      ) : null}
    </div>
  );
}
