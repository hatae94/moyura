// /me 페이지 (Server Component, SPEC-AUTH-001 R-D4 / AC-C1 / AC-G5 + SPEC-MOBILE-004 REQ-MOB4-004).
//
// 흐름: requireNamedSession() 가 (1) 세션(없으면 /login) + (2) Profile.name(미보유면 /onboarding)을
//       함께 강제하고, 가드를 통과한 profile(이름 보장)을 반환한다. 토큰은 Bearer 헤더로만 전달된다(R-A9).
import { requireNamedSession } from "@/lib/auth/require-named-session";
import { signOutAction } from "@/lib/auth/actions";

export default async function MePage() {
  // 세션 + 이름 온보딩 가드. 미충족 시 내부에서 /login 또는 /onboarding 으로 redirect 한다.
  const { profile } = await requireNamedSession();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">내 프로필 (/me)</h1>

      <dl className="text-sm">
        <div className="flex gap-2">
          <dt className="font-medium">이름:</dt>
          <dd className="font-mono">{profile.name}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">id (sub):</dt>
          <dd className="font-mono">{profile.id}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-medium">createdAt:</dt>
          <dd className="font-mono">{profile.createdAt}</dd>
        </div>
      </dl>

      <form action={signOutAction}>
        <button type="submit" className="border rounded px-3 py-1">
          로그아웃
        </button>
      </form>
    </main>
  );
}
