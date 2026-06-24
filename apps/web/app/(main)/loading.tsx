// (main) 탭 그룹 공통 로딩 스켈레톤 (Server Component).
//
// (main)/layout.tsx 의 가드(requireNamedSession) 통과 후, 하위 탭 page(home/explore/profile/
// notifications) 가 서버 데이터를 스트리밍하는 동안 즉시 표시되는 경량 셸이다. 헤더 + 카드 자리표시자만
// 그려 전환 즉시 피드백을 준다(globals.css 토큰: bg-background/bg-muted/bg-card/border-border/rounded-2xl).
export default function MainLoading() {
  return (
    <div className="flex flex-1 flex-col bg-background" aria-busy="true" aria-label="불러오는 중">
      {/* 헤더 자리표시자: 인사말 두 줄 + 아바타 원형(HomeTab 헤더 구조 미러). */}
      <header className="px-5 pb-5 pt-page">
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-2">
            <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            <div className="h-7 w-40 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        </div>
      </header>

      {/* 스크롤 영역: CTA 카드 + 리스트 카드 자리표시자. */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
        <div className="h-24 w-full animate-pulse rounded-2xl bg-muted" />
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 w-full animate-pulse rounded-2xl border border-border bg-card"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
