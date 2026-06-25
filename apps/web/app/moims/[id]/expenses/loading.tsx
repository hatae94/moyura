// 경비 관리(/moims/[id]/expenses) 로딩 스켈레톤 (Server Component).
//
// page.tsx 가 서버에서 GET members + expenses 를 블로킹(Promise.all) 조회하는 동안 즉시 표시된다.
// 헤더(뒤로 + 타이틀) + 요약 카드 + 도넛 + 내역 리스트 자리표시자를 미러해 전환 즉시 피드백을 준다.
export default function ExpensesLoading() {
  return (
    <main className="flex min-h-dvh flex-col bg-background" aria-busy="true" aria-label="불러오는 중">
      {/* 헤더: 뒤로 버튼 + 타이틀 자리표시자. sticky top-0 으로 문서 스크롤 중 상단 고정. */}
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background px-3 pb-5 pt-page">
        <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
        <div className="h-6 w-24 animate-pulse rounded bg-muted" />
      </header>

      {/* 문서 스크롤: overflow-y-auto 제거. */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-6">
        {/* 요약 카드 자리표시자. */}
        <div className="h-24 w-full animate-pulse rounded-2xl border border-border bg-card" />
        {/* 카테고리 도넛 자리표시자. */}
        <div className="h-40 w-full animate-pulse rounded-2xl border border-border bg-card" />

        {/* 지출 내역 리스트 자리표시자. */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-16 w-full animate-pulse rounded-2xl border border-border bg-card"
            />
          ))}
        </div>
      </div>
    </main>
  );
}
