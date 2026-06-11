// 브리지 프로토콜 보안 확장 단위 테스트 (SPEC-MOBILE-002 R-T8/R-R4 — 보안 C-1/H-2/M-3).
//
// security-review.md 수정 RED 테스트:
//   - 메시지 envelope 에 nonce 필드 추가(R-T8/OD-11): 빌더가 nonce 를 싣고, 직렬화/파싱이 round-trip 한다.
//   - parse 시 nonce 누락/비문자열은 거부(미인증 메시지 — 스키마는 맞으나 nonce 없음).
//   - decideInboundAction 이 expected nonce 를 받아 nonce 불일치 메시지는 ignore(미인증 거부 — C-1).
//   - session:none → clear 동작(R-R4/M-3: stale refresh 토큰 잔존 방지 — 저장 스킵에 그치지 않음).
import { describe, it, expect } from "vitest";

import {
  BRIDGE_VERSION,
  BRIDGE_MESSAGE_TYPES,
  serializeBridgeMessage,
  parseBridgeMessage,
  buildRestoreMessage,
  buildRevalidateMessage,
  decideInboundAction,
} from "./bridge-protocol";

const NONCE = "nonce-abc-123";

describe("nonce envelope (R-T8 / OD-11: 모든 메시지가 nonce 를 싣고 round-trip)", () => {
  it("buildRestoreMessage 는 nonce 를 envelope 에 싣는다", () => {
    const msg = buildRestoreMessage({ access: "a", refresh: "r" }, NONCE);
    expect(msg.nonce).toBe(NONCE);
    expect(msg.type).toBe(BRIDGE_MESSAGE_TYPES.RESTORE);
  });

  it("buildRevalidateMessage 도 nonce 를 싣는다", () => {
    const msg = buildRevalidateMessage({ access: "a", refresh: "r" }, NONCE);
    expect(msg.nonce).toBe(NONCE);
    expect(msg.type).toBe(BRIDGE_MESSAGE_TYPES.REVALIDATE);
  });

  it("nonce 가 직렬화/파싱을 통해 정확히 round-trip 된다 (양방향 인증 기반)", () => {
    const msg = buildRestoreMessage({ access: "a", refresh: "r" }, NONCE);
    const parsed = parseBridgeMessage(serializeBridgeMessage(msg));
    expect(parsed?.nonce).toBe(NONCE);
  });

  it("nonce 필드가 없으면 파싱이 null (미인증 메시지 — 스키마는 맞으나 nonce 누락)", () => {
    const raw = JSON.stringify({
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.SYNCED,
      payload: { access: "a", refresh: "r" },
    });
    expect(parseBridgeMessage(raw)).toBeNull();
  });

  it("nonce 가 비문자열이면 파싱이 null (방어적)", () => {
    const raw = JSON.stringify({
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.NONE,
      nonce: 12345,
    });
    expect(parseBridgeMessage(raw)).toBeNull();
  });
});

describe("decideInboundAction + nonce 검증 (R-T8: 미인증 메시지 거부 — C-1)", () => {
  it("nonce 가 일치하는 session:synced → save (인증된 메시지만 처리)", () => {
    const msg = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.SYNCED,
      nonce: NONCE,
      payload: { access: "a", refresh: "r" },
    } as const;
    expect(decideInboundAction(msg, NONCE)).toEqual({
      kind: "save",
      tokens: { access: "a", refresh: "r" },
      resolvesHandshake: true,
    });
  });

  it("nonce 가 불일치하면 ignore (위조 메시지 — setSession/clear 등 부작용 없음)", () => {
    const msg = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.SYNCED,
      nonce: "forged-nonce",
      payload: { access: "evil-a", refresh: "evil-r" },
    } as const;
    expect(decideInboundAction(msg, NONCE)).toEqual({ kind: "ignore" });
  });

  it("위조 session:cleared(잘못된 nonce)는 ignore (clearTokens 강제 트리거 차단)", () => {
    const msg = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.CLEARED,
      nonce: "forged",
    } as const;
    expect(decideInboundAction(msg, NONCE)).toEqual({ kind: "ignore" });
  });
});

describe("session:none → clear (R-R4 / M-3: stale refresh 잔존 방지 — H-2)", () => {
  it("nonce 일치 session:none → clear (저장 스킵이 아니라 SecureStore 비움)", () => {
    const msg = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.NONE,
      nonce: NONCE,
    } as const;
    const action = decideInboundAction(msg, NONCE);
    // R-R4(a): none 수신 시 clearTokens 까지 수행 — stale refresh 토큰 잔존을 막는다.
    expect(action.kind).toBe("clear");
    // 콜드스타트 결과로도 작동(스플래시 해제) — none 은 핸드셰이크를 해결한다.
    // R-R4 (c): none 에는 쿠키 clear 미적용(웹이 세션 권위인 폴백 — 유효 쿠키 보존).
    expect(action).toEqual({ kind: "clear", resolvesHandshake: true, clearCookies: false });
  });

  it("nonce 일치 session:cleared → clear (로그아웃 + 쿠키 clear — 콜드스타트 결과 아님)", () => {
    const msg = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.CLEARED,
      nonce: NONCE,
    } as const;
    expect(decideInboundAction(msg, NONCE)).toEqual({
      kind: "clear",
      resolvesHandshake: false,
      clearCookies: true,
    });
  });

  it("synced 인데 payload 불완전 → none-처럼 clear + 핸드셰이크 해결(저장 안 함, 쿠키 보존)", () => {
    const msg = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.SYNCED,
      nonce: NONCE,
      payload: { access: "a", refresh: "" },
    } as const;
    expect(decideInboundAction(msg, NONCE)).toEqual({
      kind: "clear",
      resolvesHandshake: true,
      clearCookies: false,
    });
  });
});
