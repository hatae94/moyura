// per-session nonce 생성기 단위 테스트 (SPEC-MOBILE-002 R-T8/OD-11).
//
// nonce 는 cold-start 마다 1회 생성되는 unguessable 값이다. 위협 모델: 동일 page 의 임의 스크립트가
// nonce 를 모르게 한다(네이티브 메모리/injectedJavaScriptBeforeContentLoaded 내용은 관측 불가).
// 충분한 길이·hex 형식·매 호출 유일성만 검증한다(난수원 자체는 mock 하지 않음).
import { describe, it, expect } from "vitest";

import { generateBridgeNonce } from "./nonce-core";

describe("generateBridgeNonce (R-T8 / OD-11: per-session one-time nonce)", () => {
  it("비어 있지 않은 hex 문자열을 반환한다", () => {
    const nonce = generateBridgeNonce();
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
    expect(nonce).toMatch(/^[0-9a-f]+$/);
  });

  it("충분히 긴 엔트로피를 가진다 (>= 32 hex chars = 128-bit)", () => {
    expect(generateBridgeNonce().length).toBeGreaterThanOrEqual(32);
  });

  it("매 호출마다 다른 값을 생성한다 (per-session 유일성 — 위조 불가)", () => {
    const values = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      values.add(generateBridgeNonce());
    }
    expect(values.size).toBe(100);
  });
});
