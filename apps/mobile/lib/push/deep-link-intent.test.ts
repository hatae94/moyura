// deep-link-intent 브로커 단위 테스트 (SPEC-MOBILE-NAV-001 정합 — 알림 탭 딥링크).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  consumeDeepLinkTarget,
  setDeepLinkTarget,
  subscribeDeepLinkTarget,
} from "./deep-link-intent";

// 모듈 스코프 상태를 각 테스트 후 비운다(pending 소비 + 구독 해제) — 테스트 간 누수 방지.
afterEach(() => {
  consumeDeepLinkTarget();
  subscribeDeepLinkTarget(() => {})();
});

describe("deep-link-intent", () => {
  it("set 한 대상을 consume 로 1회 반환한다", () => {
    setDeepLinkTarget("http://web/moims/m1/chat");
    expect(consumeDeepLinkTarget()).toBe("http://web/moims/m1/chat");
  });

  it("consume 는 1회성이다 — 두 번째 호출은 null", () => {
    setDeepLinkTarget("http://web/moims/m1/chat");
    consumeDeepLinkTarget();
    expect(consumeDeepLinkTarget()).toBeNull();
  });

  it("대기 intent 가 없으면 null 을 반환한다(일반 흐름 무영향)", () => {
    expect(consumeDeepLinkTarget()).toBeNull();
  });

  it("set 은 구독자에게 즉시 통지한다(마운트된 home 탭 소비 촉발)", () => {
    const cb = vi.fn();
    subscribeDeepLinkTarget(cb);
    setDeepLinkTarget("http://web/moims/m2/chat");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("해제된 구독자는 통지받지 않는다", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeDeepLinkTarget(cb);
    unsubscribe();
    setDeepLinkTarget("http://web/moims/m3/chat");
    expect(cb).not.toHaveBeenCalled();
  });

  it("재등록 시 이전 구독자를 대체한다(home 탭은 하나 — 단일 구독자)", () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeDeepLinkTarget(first);
    subscribeDeepLinkTarget(second);
    setDeepLinkTarget("http://web/moims/m4/chat");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
