// 로그인 화면 초대 링크 진입 (Client Component, SPEC-MOIM-011 후속).
//
// 비가입 게스트 경로: 초대 링크를 받고 앱을 처음 연 사용자는 로그인 화면에 도착한다. 계정 없이도 받은
// 초대로 바로 참여할 수 있도록(/invite/{token} → 익명 게스트 가입), 로그인 화면에 보조 진입을 둔다.
//
// UX: 평소엔 "초대를 받으셨나요? 초대 링크로 참여" 보조 링크만 노출해 정상 로그인(Google/Apple/이메일)과
// 경쟁하지 않는다. 탭하면 입력창이 인라인으로 펼쳐진다(autoFocus). 제출 시 토큰을 추출해 현재 origin 의
// /invite/{token} 으로 이동한다 — 유효하면 닉네임 입력(익명 가입), 무효면 InviteInvalidHandler 가 처리한다.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { extractInviteToken } from "@/lib/invite/token";

export function InviteLinkEntry() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
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
    router.push(`/invite/${encodeURIComponent(token)}`);
  }

  // 접힌 상태: 정상 로그인과 경쟁하지 않는 보조 링크. 게스트가 인지할 수 있게 질문형 라벨을 쓴다.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-center text-sm text-gray-600 hover:text-gray-800 transition-colors"
      >
        초대를 받으셨나요?{" "}
        <span className="font-semibold text-blue-600">초대 링크로 참여</span>
      </button>
    );
  }

  // 펼친 상태: 초대 링크/토큰 입력 + 참여 버튼(로그인 화면 blue/gray 스타일 일치).
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 text-left">
      <label
        htmlFor="invite-link-input"
        className="text-sm font-medium text-gray-700"
      >
        초대 링크로 참여
      </label>
      <input
        id="invite-link-input"
        type="text"
        inputMode="url"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="초대 링크 또는 토큰을 붙여넣어 주세요"
        aria-label="초대 링크"
        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors"
      >
        링크로 참여하기
      </button>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
