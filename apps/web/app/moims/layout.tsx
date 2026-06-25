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

  // 패스스루: moims 페이지는 body(min-h-dvh flex-col)의 자식으로 직접 문서 스크롤한다(expenses/new). 각 페이지
  // 루트가 min-h-dvh 로 화면을 채우고 콘텐츠가 길면 자라 문서 스크롤된다. 채팅(chat)만 예외로 내부 스크롤 고정
  // 레이아웃(h-dvh-fixed)을 자체적으로 유지한다 — 메시지 리스트+고정 입력바 UX 보존. 탭바는 두지 않는다(풀스크린).
  return <>{children}</>;
}
