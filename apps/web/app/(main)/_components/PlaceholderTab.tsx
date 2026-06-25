// 플레이스홀더 탭 (SPEC-MOBILE-003 R-WB2, Figma Make PlaceholderTab 적응).
//
// explore/notifications/profile 은 기능 없이 플레이스홀더만 표시한다(Exclusions). 순수 표시
// 컴포넌트라 서버 컴포넌트로 둔다.
export interface PlaceholderTabProps {
  emoji: string;
  title: string;
  description: string;
}

export function PlaceholderTab({ emoji, title, description }: PlaceholderTabProps) {
  return (
    // (main) 셸 안의 중앙 정렬 페이지 — flex-1 로 셸을 채워 수직 중앙 정렬(h-full 제거). 하단 회피 여백은
    // (main) 콘텐츠 래퍼(pb-bottom-tab)가 담당.
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="text-5xl">{emoji}</div>
      <h2 className="text-xl font-extrabold text-foreground">{title}</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      <div className="mt-2 rounded-full bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground">
        준비 중이에요
      </div>
    </div>
  );
}
