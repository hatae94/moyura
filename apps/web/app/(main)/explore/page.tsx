// /explore (SPEC-MOBILE-003 R-WB2) — 받은 초대 링크/토큰으로 모임에 참여하는 진입점.
//
// 인라인 입력 폼은 통합 진입 페이지(/invite)로 일원화됐다 — 여기서는 그 페이지로 이동하는 버튼만 둔다.
// 통합 페이지가 디바운스 자동 검증·모임 미리보기를 제공한다(탐색 탭·로그인 화면 공통).
import Link from "next/link";

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
          받은 초대 링크로 모임에 참여할 수 있어요.
        </p>
      </div>
      <Link
        href="/invite"
        className="bg-gradient-brand animate-fade-in-up w-full max-w-sm rounded-2xl py-3.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-transform active:scale-[0.98] [animation-delay:0.08s]"
      >
        초대 링크로 참여
      </Link>
    </div>
  );
}
