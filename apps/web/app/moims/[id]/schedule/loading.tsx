// 일정 조율(/moims/[id]/schedule) 로딩 스켈레톤 (Server Component).
//
// page.tsx 가 서버에서 GET members + schedule 을 블로킹 조회하는 동안 즉시 표시된다.
// 헤더(뒤로 + 타이틀) + 모드 토글 + 그리드 자리표시자를 미러해 전환 즉시 피드백을 준다.
export default function ScheduleLoading() {
  return (
    <main className="flex min-h-dvh flex-col bg-background" aria-busy="true" aria-label="불러오는 중">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-3 backdrop-blur">
        <div className="skeleton h-9 w-9 rounded-full" />
        <div className="skeleton h-6 w-24 rounded-lg" />
      </header>

      <div className="flex flex-1 flex-col gap-3 px-3 pt-3">
        {/* 모드 토글 자리표시자. */}
        <div className="skeleton h-11 w-full rounded-2xl" />
        {/* 그리드 자리표시자(시머). */}
        <div className="skeleton h-72 w-full rounded-2xl" />
        <div className="skeleton h-20 w-full rounded-2xl" />
      </div>
    </main>
  );
}
