// /home 페이지 (Server Component, SPEC-MOBILE-003 R-WB2) — Figma HomeTab 의 메인 화면.
//
// 세션 가드는 상위 (main)/layout.tsx 가 수행한다(없으면 /login). 이 페이지는 세션 user 에서
// 표시 이름/아바타 이니셜/인사말을 도출해 클라이언트 HomeTab(필터 상태 보유)에 prop 으로 넘긴다.
// 인사말은 시간대별 문구 — 서버에서 계산해 hydration 불일치를 피한다.
import { createClient } from "@/lib/supabase/server";

import { HomeTab } from "./HomeTab";

/** Supabase user 메타데이터/이메일에서 표시 이름을 도출한다(Figma HomeTab 로직 적응). */
function resolveDisplayName(user: {
  email?: string;
  user_metadata?: { name?: string };
}): string {
  return user.user_metadata?.name || user.email?.split("@")[0] || "게스트";
}

/** 시간대별 인사말(서버 렌더 — hydration 일관성). */
function resolveGreeting(hour: number): string {
  if (hour < 12) return "좋은 아침이에요";
  if (hour < 18) return "좋은 오후에요";
  return "좋은 저녁이에요";
}

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  // layout 가드가 세션을 보장하지만, 방어적으로 user 부재 시 기본값으로 폴백한다.
  const user = session?.user ?? {};
  const displayName = resolveDisplayName(user);
  const avatarInitial = displayName.charAt(0).toUpperCase();
  const greeting = resolveGreeting(new Date().getHours());

  return (
    <HomeTab displayName={displayName} avatarInitial={avatarInitial} greeting={greeting} />
  );
}
