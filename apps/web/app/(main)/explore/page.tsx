// /explore (SPEC-MOBILE-003 R-WB2) — 향후 모임 탐색 기능을 위한 자리(현재 준비 중 안내).
//
// 초대 링크/토큰 참여 진입점은 홈 탭 우측 하단 FAB(HomeActionDock 의 "초대 링크 참여")로 이전됐다.
// 참여 기능 자체(/invite: 디바운스 자동 검증·모임 미리보기)는 그대로 유지된다 — 여기서는 진입점을 두지 않는다.

export default function ExplorePage() {
  return (
    // (main) 셸 안의 중앙 정렬 페이지 — flex-1 로 셸(min-h-dvh 체인)을 채워 수직 중앙 정렬. h-full 제거
    // (불확정 높이 % 의존 회피). 하단 회피 여백은 (main) 콘텐츠 래퍼(pb-bottom-tab)가 담당.
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="bg-gradient-brand-soft animate-scale-in flex h-24 w-24 items-center justify-center rounded-full text-5xl ring-1 ring-border">
        🔍
      </div>
      <div className="animate-fade-in-up flex flex-col gap-2">
        <h2 className="text-2xl font-extrabold text-foreground">탐색</h2>
        <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
          곧 관심 있는 모임을 둘러볼 수 있어요.
        </p>
      </div>
    </div>
  );
}
