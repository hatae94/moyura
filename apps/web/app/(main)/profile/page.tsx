// 마이 페이지 (Server Component, SPEC-PROFILE-001) — 개인정보 조회 + 표시 이름 수정.
//
// SPEC-MOBILE-003 의 플레이스홀더를 실 기능으로 대체한다. (main) 그룹이라 layout 의 requireNamedSession
// 가드를 상속하지만, 페이지에서도 직접 호출해 {session, profile}(이름 보장)을 얻는다(me/page.tsx 패턴).
// 이메일은 Supabase 세션(session.user.email, read-only), 표시 이름은 GET /me 의 Profile.name(수정 가능).
// 모바일 "마이" 탭이 ${WEB_URL}/profile 을 WebView 로 호스팅하므로, 본 페이지가 양 표면(웹·앱)을 커버한다.
import { signOutAction } from "@/lib/auth/actions";
import { requireNamedSession } from "@/lib/auth/require-named-session";

import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  // 세션 + 이름 온보딩 가드(미충족 시 내부에서 /login 또는 /onboarding 으로 redirect).
  const { session, profile } = await requireNamedSession();

  const email = session.user.email ?? "—";
  const joined = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";

  return (
    <main className="flex flex-1 flex-col gap-6 p-6 max-w-md w-full mx-auto">
      <h1 className="text-2xl font-bold text-foreground">마이</h1>

      {/* 개인정보 카드 — 이메일/가입일(read-only) + 표시 이름(수정) */}
      <section className="bg-card border border-border rounded-2xl p-5 flex flex-col gap-5">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">이메일</span>
            <span className="text-sm text-foreground font-medium break-all text-right">
              {email}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">가입일</span>
            <span className="text-sm text-foreground font-medium">{joined}</span>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* 개인정보 수정 — 표시 이름 */}
        <ProfileForm initialName={profile.name ?? ""} />
      </section>

      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full border border-border text-muted-foreground py-3 rounded-lg font-medium hover:bg-card transition-colors"
        >
          로그아웃
        </button>
      </form>
    </main>
  );
}
