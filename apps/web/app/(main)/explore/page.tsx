// /explore (SPEC-MOBILE-003 R-WB2) — 받은 초대 링크/토큰으로 모임에 참여하는 진입점.
import { JoinByLinkForm } from "./join-by-link-form";

export default function ExplorePage() {
  return (
    // (main) 셸 안의 중앙 정렬 페이지 — flex-1 로 셸(min-h-dvh 체인)을 채워 수직 중앙 정렬. h-full 제거
    // (불확정 높이 % 의존 회피). 하단 회피 여백은 (main) 콘텐츠 래퍼(pb-bottom-tab)가 담당.
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="text-5xl">🔍</div>
      <h2 className="text-xl font-extrabold text-foreground">탐색</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        받은 초대 링크로 모임에 참여할 수 있어요.
      </p>
      <JoinByLinkForm />
    </div>
  );
}
