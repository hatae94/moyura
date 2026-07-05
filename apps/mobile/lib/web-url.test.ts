// resolveWebUrl 순수 가드 단위 테스트 (SPEC-MOBILE-001 R-W1 / R-W2, AC-W2).
//
// resolveWebUrl 은 process.env 에 의존하지 않는 순수 함수이므로(값을 인자로 받음),
// RN/Expo 모듈 import 없이 vitest node 환경에서 그대로 테스트한다.
// 모듈 import 시 평가되는 WEB_URL 가드는 vitest.config.ts 의 env(EXPO_PUBLIC_WEB_URL)로 통과시킨다.
import { describe, it, expect } from "vitest";

import { resolveWebUrl } from "./web-url";

describe("resolveWebUrl (R-W1/R-W2)", () => {
  it("정상 URL 이면 trim 한 값을 반환한다 (R-W1)", () => {
    expect(resolveWebUrl("  http://192.168.219.102:3000  ")).toBe("http://192.168.219.102:3000");
  });

  it("undefined 이면 설명 메시지와 함께 throw 한다 (R-W2/AC-W2)", () => {
    expect(() => resolveWebUrl(undefined)).toThrow(/EXPO_PUBLIC_WEB_URL/);
  });

  it("공백뿐인 문자열이면 throw 한다 (R-W2/AC-W2)", () => {
    expect(() => resolveWebUrl("   ")).toThrow(/EXPO_PUBLIC_WEB_URL/);
  });
});
