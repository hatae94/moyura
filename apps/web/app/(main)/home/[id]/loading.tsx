// 모임 상세(/home/[id]) 로딩 스켈레톤 (Server Component).
//
// page.tsx 가 서버에서 GET /moims/:id + members + polls 를 블로킹 조회하는 동안 즉시 표시된다.
// 상세 헤더(이름/일정/장소) + 액션 카드 2개(채팅/경비) + 멤버 자리표시자를 미러해 전환 즉시 피드백을 준다.
export default function MoimDetailLoading() {
  return (
    // 문서 스크롤: flex-1 로 셸을 채우고 콘텐츠가 길면 흐름대로 자란다.
    <div className="flex flex-1 flex-col bg-background" aria-busy="true" aria-label="불러오는 중">
      {/* 헤더: 모임 이름 + 일정/장소/개설일 라인 자리표시자. sticky top-0 으로 상단 고정. */}
      <header className="sticky top-0 z-30 bg-background px-5 pb-5 pt-page">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-24 animate-pulse rounded bg-muted" />
      </header>

      {/* 문서 스크롤: overflow-y-auto 제거. */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-6">
        {/* 채팅 입장 / 경비 액션 카드 자리표시자. */}
        <div className="h-20 w-full animate-pulse rounded-2xl bg-muted" />
        <div className="h-20 w-full animate-pulse rounded-2xl border border-border bg-card" />

        {/* 멤버 목록 자리표시자. */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 w-full animate-pulse rounded-2xl border border-border bg-card"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
