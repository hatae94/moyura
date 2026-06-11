// token-store 의 순수 결정 로직 단위 테스트 (SPEC-MOBILE-002 R-N2, AC-N2).
//
// 이 테스트는 expo-secure-store import 가 없는 순수 함수만 검증한다 — 키 매핑(어떤 SecureStore
// 키에 access/refresh 를 저장하는가)과 로드된 한 쌍이 "유효한 토큰 캐시"인지의 결정 로직이다.
// 실제 SecureStore 비동기 호출(getItemAsync 등)은 node 환경에서 mock 없이 테스트하지 않는다
// (mobile-pure-core-test-seam 컨벤션) — token-store.ts 얇은 래퍼의 RN 배선은 수동(AC-V3)으로 검증.
import { describe, it, expect } from "vitest";

import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  decodeStoredTokens,
} from "./token-store-core";

describe("토큰 SecureStore 키 (R-N2 / AC-N2: access·refresh 분리 저장)", () => {
  it("access·refresh 키가 서로 다른 SecureStore 키를 사용한다", () => {
    expect(ACCESS_TOKEN_KEY).not.toBe(REFRESH_TOKEN_KEY);
  });

  it("SecureStore 키는 영숫자/언더스코어/점만 사용한다 (SecureStore 키 제약)", () => {
    // expo-secure-store 키는 [A-Za-z0-9._-] 만 허용한다(SDK 56). 위반 시 런타임 throw.
    expect(ACCESS_TOKEN_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(REFRESH_TOKEN_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe("decodeStoredTokens (R-N2: 로드된 한 쌍이 유효 토큰 캐시인지 결정)", () => {
  it("access·refresh 둘 다 있으면 토큰 객체를 반환한다", () => {
    expect(decodeStoredTokens("access-abc", "refresh-xyz")).toEqual({
      access: "access-abc",
      refresh: "refresh-xyz",
    });
  });

  it("access 가 null 이면 null 을 반환한다 (불완전 한 쌍 — 캐시 미보유 취급)", () => {
    expect(decodeStoredTokens(null, "refresh-xyz")).toBeNull();
  });

  it("refresh 가 null 이면 null 을 반환한다 (refresh 없는 access 는 갱신 불가 — 캐시 미보유)", () => {
    expect(decodeStoredTokens("access-abc", null)).toBeNull();
  });

  it("둘 다 null 이면 null 을 반환한다 (미인증 콜드스타트 — R-N5)", () => {
    expect(decodeStoredTokens(null, null)).toBeNull();
  });

  it("빈 문자열은 미보유로 취급한다 (공백 토큰은 유효하지 않음)", () => {
    expect(decodeStoredTokens("", "refresh-xyz")).toBeNull();
    expect(decodeStoredTokens("access-abc", "")).toBeNull();
  });
});
