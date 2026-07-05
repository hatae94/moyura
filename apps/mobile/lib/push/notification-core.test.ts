// notification-core 순수 모듈 단위 테스트 (SPEC-CHAT-002 R-PUSH-007, T-008).
//
// expo-notifications/RN import 0 — vitest node 환경에서 mock 없이 단위 테스트(mobile-pure-core-test-seam).
// FCM data 페이로드(moimId)에서 탭 시 이동할 대상 모임 채팅 WebView URL 을 조립하는 순수 로직만 담는다
// (네이티브 라우트 딥링크는 비범위 — R-4 최소 구현: 앱 열기 + WebView 대상 URL).
import { describe, it, expect } from "vitest";

import { extractMoimId, buildChatUrl } from "./notification-core";

describe("extractMoimId (FCM data 페이로드 → moimId)", () => {
  it("data.moimId 를 추출한다", () => {
    expect(extractMoimId({ moimId: "moim-A" })).toBe("moim-A");
  });

  it("moimId 가 없거나 빈 값이면 null (탭 네비게이션 불가 — 앱 열기만)", () => {
    expect(extractMoimId({})).toBeNull();
    expect(extractMoimId({ moimId: "" })).toBeNull();
    expect(extractMoimId(undefined)).toBeNull();
    expect(extractMoimId(null)).toBeNull();
  });

  it("moimId 가 문자열이 아니면 null (안전 — 신뢰 불가 페이로드)", () => {
    expect(extractMoimId({ moimId: 123 as unknown as string })).toBeNull();
  });
});

describe("buildChatUrl (moimId → 대상 모임 채팅 WebView URL)", () => {
  it("webUrl 호스트에 /moims/{id}/chat 경로를 결합한다 (R-4 최소 구현)", () => {
    expect(buildChatUrl("moim-A", "http://192.168.219.102:3000")).toBe(
      "http://192.168.219.102:3000/moims/moim-A/chat",
    );
  });

  it("webUrl 에 trailing slash 가 있어도 중복 슬래시 없이 결합한다", () => {
    expect(buildChatUrl("moim-A", "http://192.168.219.102:3000/")).toBe(
      "http://192.168.219.102:3000/moims/moim-A/chat",
    );
  });

  it("에뮬레이터 호스트(10.0.2.2)도 일관되게 결합한다", () => {
    expect(buildChatUrl("moim-B", "http://10.0.2.2:3000")).toBe(
      "http://10.0.2.2:3000/moims/moim-B/chat",
    );
  });

  it("moimId 가 빈 값이면 null (대상 불명 — 네비게이션 불가)", () => {
    expect(buildChatUrl("", "http://192.168.219.102:3000")).toBeNull();
    expect(buildChatUrl("   ", "http://192.168.219.102:3000")).toBeNull();
  });
});
