// 마이 페이지 (Server Component, SPEC-PROFILE-001) — 개인정보 조회 + 표시 이름 수정.
//
// SPEC-MOBILE-003 의 플레이스홀더를 실 기능으로 대체한다. (main) 그룹이라 layout 의 requireNamedSession
// 가드를 상속하지만, 페이지에서도 직접 호출해 {session, profile}(이름 보장)을 얻는다(me/page.tsx 패턴).
// 이메일은 Supabase 세션(session.user.email, read-only), 표시 이름은 GET /me 의 Profile.name(수정 가능).
// 모바일 "마이" 탭이 ${WEB_URL}/profile 을 WebView 로 호스팅하므로, 본 페이지가 양 표면(웹·앱)을 커버한다.
import { createApiClient } from "@moyura/api-client";

import { signOutAction } from "@/lib/auth/actions";
import { requireNamedSession } from "@/lib/auth/require-named-session";
import { API_BASE_URL } from "@/lib/env";
import { type BlockItem, listBlocks } from "@/lib/safety/api";

import { BlockedMembersSection } from "./blocked-members-section";
import { ProfileForm } from "./profile-form";

export default async function ProfilePage() {
  // 세션 + 이름 온보딩 가드(미충족 시 내부에서 /login 또는 /onboarding 으로 redirect).
  const { session, profile } = await requireNamedSession();

  // "차단한 멤버" 섹션 데이터(GET /blocks — block 행만). 조회 실패는 섹션만 빈 목록으로 폴백하고 나머지
  // 프로필은 정상 렌더한다(차단 목록 조회 실패가 프로필 전체를 막지 않도록 격리 — 비차단 UX).
  let blocks: BlockItem[] = [];
  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    blocks = await listBlocks(api);
  } catch (err) {
    console.error("ProfilePage: GET /blocks 실패 — 차단 목록 빈 상태로 폴백", err);
  }

  const email = session.user.email ?? "—";
  const joined = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "—";
  // 프로필 헤더 아바타 이니셜 — 표시 이름(보장) 첫 글자.
  const initial = (profile.name ?? email).charAt(0).toUpperCase() || "M";

  return (
    <main className="flex flex-1 flex-col gap-6 p-6 max-w-md w-full mx-auto">
      {/* 프로필 헤더 — 인스타 스타일 스토리링 아바타 + 이름 + 이메일. */}
      <div className="animate-fade-in-up flex flex-col items-center gap-3 pt-2">
        {/* [중요] 이니셜은 별도 span: bg-card(흰 원)와 text-gradient-brand 는 둘 다 background-image 를 써서
            같은 요소에 두면 충돌한다(흰 원이 그라데이션으로 덮이고 텍스트 투명). 원과 텍스트를 분리한다. */}
        <span className="gradient-ring shadow-lg shadow-primary/15">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-card text-3xl font-extrabold">
            <span className="text-gradient-brand">{initial}</span>
          </span>
        </span>
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-xl font-extrabold tracking-tight text-foreground">
            {profile.name}
          </span>
          <span className="break-all text-sm text-muted-foreground">{email}</span>
        </div>
      </div>

      {/* 개인정보 카드 — 이메일/가입일(read-only) + 표시 이름(수정) */}
      <section className="animate-fade-in-up flex flex-col gap-5 rounded-3xl border border-border bg-card p-5 shadow-sm [animation-delay:0.06s]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">이메일</span>
            <span className="break-all text-right text-sm font-medium text-foreground">{email}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">가입일</span>
            <span className="text-sm font-medium text-foreground">{joined}</span>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* 개인정보 수정 — 표시 이름 */}
        <ProfileForm initialName={profile.name ?? ""} />
      </section>

      {/* 차단한 멤버 섹션 — 조회(GET /blocks) + 해제(DELETE /blocks/:id). 전용 라우트 없이 프로필 내 배치. */}
      <BlockedMembersSection blocks={blocks} />

      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full rounded-2xl border border-border bg-card py-3 font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-[0.99]"
        >
          로그아웃
        </button>
      </form>
    </main>
  );
}
