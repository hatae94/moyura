// (main) 탭 그룹 공통 로딩 스켈레톤 (Server Component).
//
// (main)/layout.tsx 의 가드(requireNamedSession) 통과 후, 하위 탭 page(home/explore/profile/
// notifications) 가 서버 데이터를 스트리밍하는 동안 즉시 표시되는 경량 셸이다. 헤더 + 카드 자리표시자만
// 그려 전환 즉시 피드백을 준다(globals.css 토큰: bg-background/bg-muted/bg-card/border-border/rounded-2xl).
export default function MainLoading() {
  return (
    // 문서 스크롤: flex-1 로 셸을 채우고 콘텐츠가 길면 흐름대로 자란다(스켈레톤은 짧아 보통 화면 내).
    <div className="flex flex-1 flex-col bg-background" aria-busy="true" aria-label="불러오는 중">
      {/* 헤더 자리표시자: 인사말 두 줄 + 스토리링 아바타 원형(HomeTab 헤더 구조 미러). sticky top-0 으로 상단 고정. */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 px-5 pb-4 pt-page backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <div className="skeleton h-4 w-24 rounded-full" />
            <div className="skeleton h-7 w-40 rounded-lg" />
          </div>
          <div className="skeleton h-11 w-11 rounded-full" />
        </div>
      </header>

      {/* 콘텐츠 자리표시자: CTA 카드 + 리스트 카드(좌측 아바타 + 텍스트 라인 미러). 시머 스윕으로 로딩 감각. */}
      <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-4">
        <div className="skeleton h-[5.5rem] w-full rounded-3xl" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3.5 rounded-3xl border border-border bg-card p-3.5"
            >
              <div className="skeleton h-13 w-13 shrink-0 rounded-2xl" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="skeleton h-4 w-2/3 rounded-full" />
                <div className="skeleton h-3 w-1/2 rounded-full" />
                <div className="skeleton h-3 w-1/3 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
