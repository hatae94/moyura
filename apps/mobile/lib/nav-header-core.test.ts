// nav-header-core 순수 모듈 단위 테스트 (SPEC-MOBILE-NAV-001 M1 — REQ-MOBNAV-001/002/003).
//
// 네이티브 헤더 크롬(back chevron + title)의 렌더 결정을 검증한다. expo/RN import 0 —
// vitest node 환경에서 mock 없이 단위 테스트(mobile-pure-core-test-seam). 웹이 브리지
// nav:state 로 보고한 {pathname, title, canGoBack} 를 소비해 {headerVisible, showBackChevron,
// headerTitle} 를 결정한다(단일 진실 출처 = 웹, 네이티브는 그리기만 — plan §2.2).
//   - decideHeader: 헤더 필요 5페이지 판정 + chevron 가시성 + title passthrough.
//
// 헤더 필요 5페이지(REQ-MOBNAV-001):
//   /home/[id]              (2세그먼트: home + id)
//   /moims/new             (2세그먼트: moims + new)
//   /moims/[id]/chat       (3세그먼트: moims + id + chat)
//   /moims/[id]/schedule   (3세그먼트: moims + id + schedule)
//   /moims/[id]/expenses   (3세그먼트: moims + id + expenses)
// 헤더 숨김(REQ-MOBNAV-003): 탭 루트(/home, /explore, /notifications, /profile) +
//   보류 3페이지(/me, /invite, /invite/[token]).
import { describe, it, expect } from "vitest";

import { decideHeader } from "./nav-header-core";

describe("decideHeader — 헤더 필요 5페이지 렌더 판정 (REQ-MOBNAV-001)", () => {
  it("/home/[id] (모임 상세) 에서 헤더를 렌더한다", () => {
    const result = decideHeader({ pathname: "/home/42", title: "주말 등산 모임", canGoBack: true });
    expect(result.headerVisible).toBe(true);
  });

  it("/moims/new (새 모임 만들기) 에서 헤더를 렌더한다", () => {
    const result = decideHeader({ pathname: "/moims/new", title: "새 모임 만들기", canGoBack: true });
    expect(result.headerVisible).toBe(true);
  });

  it("/moims/[id]/chat 에서 헤더를 렌더한다", () => {
    const result = decideHeader({ pathname: "/moims/42/chat", title: "채팅", canGoBack: true });
    expect(result.headerVisible).toBe(true);
  });

  it("/moims/[id]/schedule 에서 헤더를 렌더한다", () => {
    const result = decideHeader({ pathname: "/moims/42/schedule", title: "일정", canGoBack: true });
    expect(result.headerVisible).toBe(true);
  });

  it("/moims/[id]/expenses 에서 헤더를 렌더한다", () => {
    const result = decideHeader({ pathname: "/moims/42/expenses", title: "정산", canGoBack: true });
    expect(result.headerVisible).toBe(true);
  });

  it("trailing slash / query / hash 가 있어도 5페이지로 판정한다 (pathname 정규화)", () => {
    expect(decideHeader({ pathname: "/home/42/", title: "x", canGoBack: true }).headerVisible).toBe(true);
    expect(decideHeader({ pathname: "/moims/42/chat?tab=x", title: "x", canGoBack: true }).headerVisible).toBe(
      true,
    );
    expect(decideHeader({ pathname: "/moims/new#section", title: "x", canGoBack: true }).headerVisible).toBe(
      true,
    );
  });
});

describe("decideHeader — 헤더 숨김 라우트 (REQ-MOBNAV-003)", () => {
  it("탭 루트 4종(/home, /explore, /notifications, /profile) 에서 헤더를 숨긴다", () => {
    expect(decideHeader({ pathname: "/home", title: "홈", canGoBack: false }).headerVisible).toBe(false);
    expect(decideHeader({ pathname: "/explore", title: "탐색", canGoBack: false }).headerVisible).toBe(false);
    expect(
      decideHeader({ pathname: "/notifications", title: "알림", canGoBack: false }).headerVisible,
    ).toBe(false);
    expect(decideHeader({ pathname: "/profile", title: "프로필", canGoBack: false }).headerVisible).toBe(
      false,
    );
  });

  it("보류 3페이지(/me, /invite, /invite/[token]) 에서 헤더를 숨긴다", () => {
    expect(decideHeader({ pathname: "/me", title: "내 정보", canGoBack: true }).headerVisible).toBe(false);
    expect(decideHeader({ pathname: "/invite", title: "초대", canGoBack: true }).headerVisible).toBe(false);
    expect(
      decideHeader({ pathname: "/invite/abc-123", title: "초대", canGoBack: true }).headerVisible,
    ).toBe(false);
  });

  it("루트(/) · 미매칭 경로에서 헤더를 숨긴다", () => {
    expect(decideHeader({ pathname: "/", title: "", canGoBack: false }).headerVisible).toBe(false);
    expect(decideHeader({ pathname: "/login", title: "로그인", canGoBack: false }).headerVisible).toBe(false);
    expect(
      decideHeader({ pathname: "/moims/42", title: "상세", canGoBack: true }).headerVisible,
    ).toBe(false); // /moims/[id] 자체는 웹 라우트 아님(홈 상세는 /home/[id])
    expect(
      decideHeader({ pathname: "/home/42/edit", title: "편집", canGoBack: true }).headerVisible,
    ).toBe(false); // 3세그먼트 home/* 는 5페이지 아님
    expect(
      decideHeader({ pathname: "/moims/42/photos", title: "사진", canGoBack: true }).headerVisible,
    ).toBe(false); // 알 수 없는 sub-route
  });
});

describe("decideHeader — back chevron 가시성 (REQ-MOBNAV-002)", () => {
  it("헤더 페이지 + canGoBack=true → chevron 표시", () => {
    expect(
      decideHeader({ pathname: "/home/42", title: "모임", canGoBack: true }).showBackChevron,
    ).toBe(true);
    expect(
      decideHeader({ pathname: "/moims/42/chat", title: "채팅", canGoBack: true }).showBackChevron,
    ).toBe(true);
  });

  it("헤더 페이지 + canGoBack=false → chevron 숨김 (title-only 헤더)", () => {
    const result = decideHeader({ pathname: "/home/42", title: "모임", canGoBack: false });
    expect(result.headerVisible).toBe(true);
    expect(result.showBackChevron).toBe(false);
  });

  it("헤더 숨김 라우트에서는 chevron 도 항상 false (헤더 자체가 없음)", () => {
    expect(decideHeader({ pathname: "/home", title: "홈", canGoBack: true }).showBackChevron).toBe(false);
    expect(decideHeader({ pathname: "/explore", title: "탐색", canGoBack: true }).showBackChevron).toBe(
      false,
    );
  });
});

describe("decideHeader — title passthrough (REQ-MOBNAV-012 정합)", () => {
  it("보고된 title 을 그대로 headerTitle 로 전달한다", () => {
    expect(decideHeader({ pathname: "/home/42", title: "주말 등산 모임", canGoBack: true }).headerTitle).toBe(
      "주말 등산 모임",
    );
    expect(decideHeader({ pathname: "/moims/new", title: "새 모임 만들기", canGoBack: true }).headerTitle).toBe(
      "새 모임 만들기",
    );
  });

  it("빈 title 도 그대로 전달한다 (웹이 산출 책임 — 네이티브는 가공하지 않음)", () => {
    expect(decideHeader({ pathname: "/moims/42/chat", title: "", canGoBack: true }).headerTitle).toBe("");
  });
});
