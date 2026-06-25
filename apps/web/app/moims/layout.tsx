// moims 서브트리 레이아웃 — 이름 온보딩 가드 (SPEC-WEB-GUARD-001 REQ-WG1-001~005).
//
// 채팅 등 app/moims/* 라우트는 (main) 그룹 밖이라 (main)/layout.tsx 의 세션·이름 가드가 미적용이다.
// 또한 chat/page.tsx 는 Client Component 라 서버 가드를 스스로 호출할 수 없다. 따라서 이 서버 레이아웃이
// 콘텐츠 렌더링 전에 기존·검증된 requireNamedSession() 을 호출해 보호한다(SPEC-MOBILE-004 와 동일 정책):
//   - 세션 없음            → /login
//   - 세션 있음 + name 없음  → /onboarding (둘 다 app/moims/ 밖이라 redirect 루프 없음)
//   - 세션 있음 + name 있음  → children 렌더링
// GET /me 실패/401 은 requireNamedSession() 내부에서 fail-closed(/login)로 처리된다.
//
// (main) 레이아웃과 달리 하단 탭바·셸 감지 스크립트는 두지 않는다 — chat 은 풀스크린 라우트다(AC-4).
import { requireNamedSession } from "@/lib/auth/require-named-session";

export default async function MoimsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // 미충족 시 내부에서 redirect 하므로(throw) 통과 시에만 children 이 렌더링된다(REQ-WG1-001).
  await requireNamedSession();

  // 풀스크린 앱 셸: (main) 레이아웃과 동일하게 h-svh-fixed(height:100svh, vh 폴백 — globals.css)로 높이를
  // small viewport 에 고정한다. chat/expenses/new 페이지는 내부 overflow-y-auto 로 스크롤하는 풀스크린 라우트라,
  // 고정 높이 조상이 있어야 내부 스크롤이 동작한다(없으면 body min-h-full 이 콘텐츠만큼 자라 문서 스크롤로 새고
  // 내부 스크롤이 깨진다). flex-col 로 자식 페이지 루트(flex-1 min-h-0)가 이 높이를 채우게 한다.
  // 위 주석대로 하단 탭바·셸 감지 스크립트는 두지 않는다(풀스크린 라우트). body 자체는 min-h-full 로 유지해
  // 다른 라우트 그룹(중앙 정렬 login/onboarding/invite)의 성장 여지를 보존한다.
  return <div className="flex h-svh-fixed flex-col">{children}</div>;
}
