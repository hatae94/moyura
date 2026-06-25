// 로그인 화면 초대 링크 진입 (Client Component, SPEC-MOIM-011 후속).
//
// 비가입 게스트 경로: 초대 링크를 받고 앱을 처음 연 사용자는 로그인 화면에 도착한다. 계정 없이도 받은
// 초대로 바로 참여할 수 있도록, 로그인 화면에 보조 진입을 둔다.
//
// UX: 정상 로그인(Google/Apple/이메일)과 경쟁하지 않는 보조 링크만 노출한다. 탭하면 통합 초대 진입
// 페이지(/invite)로 이동한다 — 거기서 링크/토큰을 붙여넣어 자동 검증·모임 미리보기 후 참여한다. 인라인
// 입력 폼은 통합 페이지로 일원화돼 여기서는 제거됐다(탐색 탭·로그인 화면 공통 진입). /invite 는 공개
// 경로라 미로그인 게스트도 그대로 열린다.
"use client";

import Link from "next/link";

export function InviteLinkEntry() {
  // 보조 링크: 정상 로그인과 경쟁하지 않는 질문형 라벨(blue/gray 스타일 유지). 통합 진입 페이지로 이동한다.
  return (
    <Link
      href="/invite"
      className="block w-full text-center text-sm text-gray-600 transition-colors hover:text-gray-800"
    >
      초대를 받으셨나요?{" "}
      <span className="font-semibold text-blue-600">초대 링크로 참여</span>
    </Link>
  );
}
