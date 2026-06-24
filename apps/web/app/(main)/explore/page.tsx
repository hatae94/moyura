// /explore (SPEC-MOBILE-003 R-WB2) — 받은 초대 링크/토큰으로 모임에 참여하는 진입점.
import { JoinByLinkForm } from "./join-by-link-form";

export default function ExplorePage() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="text-5xl">🔍</div>
      <h2 className="text-xl font-extrabold text-foreground">탐색</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        받은 초대 링크로 모임에 참여할 수 있어요.
      </p>
      <JoinByLinkForm />
    </div>
  );
}
