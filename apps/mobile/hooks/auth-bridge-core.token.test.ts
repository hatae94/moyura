// useAuthBridge 토큰 동기화 확장의 순수 결정 로직 테스트 (SPEC-MOBILE-002 R-T6/R-T7, AC-T6/AC-T7).
//
// SPEC-WEBVIEW-SHELL-001 의 OAuth 분기(auth-bridge-core.test.ts)와 별개로, MOBILE-002 가 useAuthBridge
// 에 얹는 토큰 동기화 결정만 검증한다: origin allowlist 매칭(콜드스타트+resume 공용 — H-3),
// session:restore 주입 race 대비 bounded 재시도 스케줄 결정(R-T7). expo/RN import 0.
import { describe, it, expect } from "vitest";

import {
  isTrustedOrigin,
  decideInjectionRetry,
  MAX_INJECTION_RETRIES,
} from "./auth-bridge-core";

describe("isTrustedOrigin (R-T6 / AC-T6: origin allowlist — 콜드스타트+resume 공용)", () => {
  const WEB_URL = "http://localhost:3000";

  it("현재 URL 의 origin 이 신뢰 WEB_URL 호스트와 같으면 true (토큰 주입 허용)", () => {
    expect(isTrustedOrigin("http://localhost:3000/me", WEB_URL)).toBe(true);
    expect(isTrustedOrigin("http://localhost:3000/login", WEB_URL)).toBe(true);
    expect(isTrustedOrigin("http://localhost:3000/", WEB_URL)).toBe(true);
  });

  it("에뮬레이터 호스트(10.0.2.2)도 WEB_URL 이 그 호스트면 허용 (OD-7 일관)", () => {
    const EMU = "http://10.0.2.2:3000";
    expect(isTrustedOrigin("http://10.0.2.2:3000/me", EMU)).toBe(true);
  });

  it("호스트가 다르면 false (third-party 페이지에 토큰 주입 금지 — H-3)", () => {
    expect(isTrustedOrigin("https://accounts.google.com/o/oauth2", WEB_URL)).toBe(false);
    expect(isTrustedOrigin("https://evil.example.com/", WEB_URL)).toBe(false);
  });

  it("포트가 다르면 false (origin 은 host+port 일치 — exact)", () => {
    expect(isTrustedOrigin("http://localhost:4000/me", WEB_URL)).toBe(false);
  });

  it("scheme 이 다르면 false (http vs https origin 불일치)", () => {
    expect(isTrustedOrigin("https://localhost:3000/me", WEB_URL)).toBe(false);
  });

  it("파싱 불가한 현재 URL 이면 false (방어적 — 주입 금지)", () => {
    expect(isTrustedOrigin("about:blank", WEB_URL)).toBe(false);
    expect(isTrustedOrigin("", WEB_URL)).toBe(false);
  });
});

describe("decideInjectionRetry (R-T7 / AC-T7: 핸들러 미등록 race → bounded 재시도)", () => {
  it("아직 ack 미수신이고 시도 횟수가 한도 미만이면 retry", () => {
    expect(decideInjectionRetry({ attempts: 0, acked: false })).toBe("retry");
    expect(decideInjectionRetry({ attempts: 1, acked: false })).toBe("retry");
  });

  it("ack 를 받았으면 더 이상 재시도하지 않는다 (stop — 메시지 도달)", () => {
    expect(decideInjectionRetry({ attempts: 1, acked: true })).toBe("stop");
  });

  it("최대 재시도 횟수에 도달하면 give-up (R-N6 타임아웃 폴백으로 이어짐)", () => {
    expect(decideInjectionRetry({ attempts: MAX_INJECTION_RETRIES, acked: false })).toBe(
      "give-up",
    );
    expect(
      decideInjectionRetry({ attempts: MAX_INJECTION_RETRIES + 1, acked: false }),
    ).toBe("give-up");
  });

  it("MAX_INJECTION_RETRIES 는 bounded(유한)하다", () => {
    expect(MAX_INJECTION_RETRIES).toBeGreaterThan(0);
    expect(Number.isFinite(MAX_INJECTION_RETRIES)).toBe(true);
  });
});
