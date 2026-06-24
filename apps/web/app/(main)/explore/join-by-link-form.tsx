// 초대 링크로 참여 (Client Component) — 탐색 탭에서 받은 초대 링크/토큰으로 초대 수락 페이지로 이동한다.
//
// 받은 초대 URL(https://.../invite/{token}, moyura://invite/{token}) 또는 raw 토큰을 입력하면 토큰을 추출해
// 현재 origin 의 /invite/{token} 으로 라우팅한다. 무효 토큰이면 InviteInvalidHandler 가 처리한다
// (SPEC-MOIM-011 후속 — 앱: 네이티브 Alert→메인탭 / 미로그인: 로그인). 딥링크(moyura://) 대신 앱 내
// 라우팅이라 무효 초대 흐름을 셸/브라우저 모두에서 동일하게 트리거한다.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { extractInviteToken } from "@/lib/invite/token";

export function JoinByLinkForm() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const token = extractInviteToken(value);
    if (!token) {
      setError("초대 링크 또는 토큰을 입력해주세요.");
      return;
    }
    setError(null);
    // 앱 내 라우팅(현재 origin /invite/{token}). 무효면 invite 페이지가 InviteInvalidHandler 로 분기한다.
    router.push(`/invite/${encodeURIComponent(token)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-3">
      <input
        type="text"
        inputMode="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="초대 링크 또는 토큰을 붙여넣어 주세요"
        aria-label="초대 링크"
        className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
      />
      <button
        type="submit"
        className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        링크로 참여하기
      </button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}
