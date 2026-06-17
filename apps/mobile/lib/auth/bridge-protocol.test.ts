// 버전드 양방향 브리지 프로토콜 단위 테스트 (SPEC-MOBILE-002 R-T1, AC-T1).
//
// 순수 로직만 검증한다(expo/RN import 0 — oauth-bridge.ts 패턴): type 상수 집합 닫힘, 직렬화/파싱
// round-trip, unknown type 무시(throw 없음), 페이로드 빌더(토큰만 — userId/프로필 미포함),
// 메시지 핸들러 분기 결정(synced→save / none→login / cleared→clear).
import { describe, it, expect } from "vitest";

import {
  BRIDGE_VERSION,
  BRIDGE_MESSAGE_TYPES,
  type BridgeMessage,
  serializeBridgeMessage,
  parseBridgeMessage,
  buildRestoreMessage,
  buildRevalidateMessage,
  decideInboundAction,
} from "./bridge-protocol";

describe("브리지 type 집합 (R-T1 / AC-T1: 5종 포함, enum/const 고정)", () => {
  it("5종 message type 을 모두 포함한다 (restore/synced/none/cleared/revalidate)", () => {
    const values = Object.values(BRIDGE_MESSAGE_TYPES);
    expect(values).toContain("session:restore");
    expect(values).toContain("session:synced");
    expect(values).toContain("session:none");
    expect(values).toContain("session:cleared");
    expect(values).toContain("resume:revalidate");
    expect(values.length).toBeGreaterThanOrEqual(5);
  });

  it("type 상수는 const 로 고정되어 오타를 컴파일 타임에 차단한다 (값 일관)", () => {
    expect(BRIDGE_MESSAGE_TYPES.RESTORE).toBe("session:restore");
    expect(BRIDGE_MESSAGE_TYPES.SYNCED).toBe("session:synced");
    expect(BRIDGE_MESSAGE_TYPES.NONE).toBe("session:none");
    expect(BRIDGE_MESSAGE_TYPES.CLEARED).toBe("session:cleared");
    expect(BRIDGE_MESSAGE_TYPES.REVALIDATE).toBe("resume:revalidate");
  });
});

// SPEC-MOBILE-002 v0.2.0(보안): 모든 메시지는 nonce 를 싣는다(R-T8/OD-11). 테스트 fixture nonce.
const NONCE = "test-nonce";

describe("serialize/parse round-trip (R-T1 / AC-T1)", () => {
  it("session:restore(토큰 페이로드)를 정확히 round-trip 한다", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.RESTORE,
      nonce: NONCE,
      payload: { access: "a-tok", refresh: "r-tok" },
    };
    const parsed = parseBridgeMessage(serializeBridgeMessage(msg));
    expect(parsed).toEqual(msg);
  });

  it("session:synced(토큰 페이로드)를 정확히 round-trip 한다", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.SYNCED,
      nonce: NONCE,
      payload: { access: "new-a", refresh: "new-r" },
    };
    const parsed = parseBridgeMessage(serializeBridgeMessage(msg));
    expect(parsed).toEqual(msg);
  });

  it("payload 없는 신호 type(none/cleared)도 round-trip 한다", () => {
    for (const type of [
      BRIDGE_MESSAGE_TYPES.NONE,
      BRIDGE_MESSAGE_TYPES.CLEARED,
    ] as const) {
      const msg: BridgeMessage = { version: BRIDGE_VERSION, type, nonce: NONCE };
      const parsed = parseBridgeMessage(serializeBridgeMessage(msg));
      expect(parsed).toEqual(msg);
    }
  });

  it("resume:revalidate(토큰 페이로드)를 정확히 round-trip 한다", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.REVALIDATE,
      nonce: NONCE,
      payload: { access: "a", refresh: "r" },
    };
    const parsed = parseBridgeMessage(serializeBridgeMessage(msg));
    expect(parsed).toEqual(msg);
  });
});

describe("parseBridgeMessage 방어 (R-T1 / OD-6: unknown type 무시, throw 없음)", () => {
  it("알 수 없는 type 이면 null 을 반환한다 (throw 없이 안전 무시)", () => {
    const raw = JSON.stringify({ version: BRIDGE_VERSION, type: "session:sync", nonce: NONCE }); // 오타
    expect(parseBridgeMessage(raw)).toBeNull();
  });

  it("JSON 이 아닌 값이면 null 을 반환한다 (throw 없음)", () => {
    expect(parseBridgeMessage("not-json")).toBeNull();
    expect(parseBridgeMessage("")).toBeNull();
  });

  it("type 필드가 없으면 null 을 반환한다", () => {
    expect(
      parseBridgeMessage(JSON.stringify({ version: BRIDGE_VERSION, nonce: NONCE })),
    ).toBeNull();
  });

  it("version 이 숫자가 아니거나 누락이면 null 을 반환한다 (graceful degrade)", () => {
    expect(
      parseBridgeMessage(JSON.stringify({ type: "session:none", nonce: NONCE })),
    ).toBeNull();
    expect(
      parseBridgeMessage(
        JSON.stringify({ version: "v1", type: "session:none", nonce: NONCE }),
      ),
    ).toBeNull();
  });
});

describe("페이로드 빌더 (R-T2/R-R1 / AC-T2: 토큰만 — userId/프로필 미포함, PII 최소화)", () => {
  it("buildRestoreMessage 는 토큰만 담은 session:restore 메시지를 만든다(nonce 포함)", () => {
    const msg = buildRestoreMessage({ access: "a", refresh: "r" }, NONCE);
    expect(msg.type).toBe(BRIDGE_MESSAGE_TYPES.RESTORE);
    expect(msg.version).toBe(BRIDGE_VERSION);
    expect(msg.nonce).toBe(NONCE);
    expect(msg.payload).toEqual({ access: "a", refresh: "r" });
    // PII 최소화: payload 키는 access·refresh 둘뿐(userId/profile 부재).
    expect(Object.keys(msg.payload).sort()).toEqual(["access", "refresh"]);
  });

  it("buildRevalidateMessage 는 토큰을 담은 resume:revalidate 메시지를 만든다(nonce 포함)", () => {
    const msg = buildRevalidateMessage({ access: "a", refresh: "r" }, NONCE);
    expect(msg.type).toBe(BRIDGE_MESSAGE_TYPES.REVALIDATE);
    expect(msg.nonce).toBe(NONCE);
    expect(msg.payload).toEqual({ access: "a", refresh: "r" });
    expect(Object.keys(msg.payload).sort()).toEqual(["access", "refresh"]);
  });
});

describe("decideInboundAction (R-T5/R-R3/R-N4/R-R4: 수신 메시지 분기 결정 — nonce 검증 포함)", () => {
  it("session:synced + 유효 토큰 + nonce 일치 → save (SecureStore 갱신) + 콜드스타트 종료", () => {
    const action = decideInboundAction(
      {
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.SYNCED,
        nonce: NONCE,
        payload: { access: "a", refresh: "r" },
      },
      NONCE,
    );
    expect(action).toEqual({ kind: "save", tokens: { access: "a", refresh: "r" }, resolvesHandshake: true });
  });

  it("session:none → clear (R-R4/M-3: stale refresh 제거) + 콜드스타트 종료 (쿠키는 보존)", () => {
    const action = decideInboundAction(
      { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.NONE, nonce: NONCE },
      NONCE,
    );
    // R-R4 (c): none 에는 쿠키 clear 미적용(웹이 세션 권위인 폴백 경로 — 유효 쿠키 보존).
    expect(action).toEqual({ kind: "clear", resolvesHandshake: true, clearCookies: false });
  });

  it("session:cleared → clear (로그아웃 클리어 + 쿠키 clear) — 콜드스타트 결과 아님(M-1)", () => {
    const action = decideInboundAction(
      { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.CLEARED, nonce: NONCE },
      NONCE,
    );
    // R-R4 (c): 명시 로그아웃에서만 clearCookies:true(WebView 쿠키 부활 차단).
    expect(action).toEqual({ kind: "clear", resolvesHandshake: false, clearCookies: true });
  });

  it("session:synced 인데 payload 토큰이 불완전하면 clear 처럼 처리한다 (save 안 함, 쿠키 보존)", () => {
    const action = decideInboundAction(
      {
        version: BRIDGE_VERSION,
        type: BRIDGE_MESSAGE_TYPES.SYNCED,
        nonce: NONCE,
        payload: { access: "a", refresh: "" },
      },
      NONCE,
    );
    expect(action).toEqual({ kind: "clear", resolvesHandshake: true, clearCookies: false });
  });

  it("네이티브가 보내는 type(restore/revalidate)은 수신 분기에서 무시한다 (ignore)", () => {
    expect(
      decideInboundAction(
        {
          version: BRIDGE_VERSION,
          type: BRIDGE_MESSAGE_TYPES.RESTORE,
          nonce: NONCE,
          payload: { access: "a", refresh: "r" },
        },
        NONCE,
      ),
    ).toEqual({ kind: "ignore" });
  });
});

// SPEC-MOBILE-004: 셸 Google 버튼 탭 명령(auth:google-request) — 토큰 없는 신호, additive type.
describe("auth:google-request 명령 (SPEC-MOBILE-004 — 네이티브 인앱 Google 로그인 트리거)", () => {
  it("type 집합에 auth:google-request 가 포함된다", () => {
    expect(BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST).toBe("auth:google-request");
    expect(Object.values(BRIDGE_MESSAGE_TYPES)).toContain("auth:google-request");
  });

  it("토큰 없는 신호 메시지로 정확히 round-trip 한다", () => {
    const msg: BridgeMessage = {
      version: BRIDGE_VERSION,
      type: BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST,
      nonce: NONCE,
    };
    expect(parseBridgeMessage(serializeBridgeMessage(msg))).toEqual(msg);
  });

  it("nonce 인증 통과 시 google-signin 액션을 반환한다", () => {
    expect(
      decideInboundAction(
        { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST, nonce: NONCE },
        NONCE,
      ),
    ).toEqual({ kind: "google-signin" });
  });

  it("nonce 불일치(위조) 시 ignore 한다 — 네이티브 SDK 미실행", () => {
    expect(
      decideInboundAction(
        { version: BRIDGE_VERSION, type: BRIDGE_MESSAGE_TYPES.GOOGLE_SIGNIN_REQUEST, nonce: "forged" },
        NONCE,
      ),
    ).toEqual({ kind: "ignore" });
  });
});
