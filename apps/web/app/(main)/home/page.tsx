// /home 페이지 (Server Component, SPEC-MOBILE-003 R-WB2 + SPEC-MOIM-003 REQ-MOIM3-001) — 실 모임 목록.
//
// 세션 가드는 상위 (main)/layout.tsx 가 수행한다(없으면 /login, 이름 미보유면 /onboarding). 이 페이지는
// 세션 user 에서 표시 이름/아바타 이니셜/인사말을 도출하고(서버 계산 — hydration 일관), 세션 access_token
// 으로 GET /moims(자신이 속한 모임 목록)를 조회해 실 모임 카드를 HomeTab(필터 상태 보유 클라이언트)에 prop
// 으로 넘긴다. mock(MOCK_MEETUPS) 미사용 — 카드는 실 id 로 /home/{id} 로 이동한다(REQ-MOIM3-001).
import { createApiClient, type MoimResponse } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { requireNamedSession } from "@/lib/auth/require-named-session";

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
  // 세션 + 이름 온보딩 가드(layout 와 동일 — idempotent). access_token 확보 + 직접 진입 보호.
  const { session } = await requireNamedSession();

  const user = session.user;
  const displayName = resolveDisplayName(user);
  const avatarInitial = displayName.charAt(0).toUpperCase();
  const greeting = resolveGreeting(new Date().getHours());

  // 실 모임 목록 조회(REQ-MOIM3-001). 토큰은 Bearer 헤더로만 전달(R-A9). 조회 실패는 빈 목록으로 폴백해
  // 홈 진입 자체를 막지 않는다(빈 상태 UI 가 처리) — 토큰/오류 상세는 노출하지 않는다.
  const api = createApiClient({
    baseUrl: API_BASE_URL,
    getToken: () => session.access_token,
  });
  let moims: MoimResponse[] = [];
  try {
    moims = await api.listMoims();
  } catch (err) {
    // 목록 조회 실패는 빈 상태로 그레이스풀 폴백(홈 진입 차단 금지). 원인은 서버 로그로만 보존한다.
    console.error("[home] listMoims 실패 — 빈 목록으로 폴백:", err);
  }

  return (
    <HomeTab
      displayName={displayName}
      avatarInitial={avatarInitial}
      greeting={greeting}
      moims={moims}
    />
  );
}
