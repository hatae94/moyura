// 모임 상세(/home/[id]) 로딩 스켈레톤 (Server Component).
//
// page.tsx 가 서버에서 GET /moims/:id + members + polls 를 블로킹 조회하는 동안 즉시 표시된다.
// 상세 헤더(이름/일정/장소) + 액션 카드 2개(채팅/경비) + 멤버 자리표시자를 미러해 전환 즉시 피드백을 준다.
export default function MoimDetailLoading() {
  return (
    // 문서 스크롤: flex-1 로 셸을 채우고 콘텐츠가 길면 흐름대로 자란다.
    <div className="flex flex-1 flex-col bg-background" aria-busy="true" aria-label="불러오는 중">
      {/* 헤더: 모임 아바타 + 이름 + 일정/장소 라인 자리표시자(상세 헤더 구조 미러). sticky top-0 으로 상단 고정. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-5 pb-4 pt-page backdrop-blur-xl">
        <div className="flex items-center gap-3.5">
          <div className="skeleton h-14 w-14 shrink-0 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="skeleton h-6 w-40 rounded-lg" />
            <div className="skeleton h-4 w-32 rounded-full" />
          </div>
        </div>
        <div className="skeleton mt-2 h-3 w-24 rounded-full" />
      </header>

      {/* 문서 스크롤: overflow-y-auto 제거. */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-4">
        {/* 채팅 입장 / 경비 액션 카드 자리표시자. */}
        <div className="skeleton h-[5.25rem] w-full rounded-3xl" />
        <div className="skeleton h-[5.25rem] w-full rounded-3xl" />

        {/* 멤버 목록 자리표시자. */}
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-14 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </div>
  );
}
