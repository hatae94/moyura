// register-device-core 순수 모듈 단위 테스트 (SPEC-CHAT-002 R-PUSH-005, T-008).
//
// expo-notifications/RN import 0 — vitest node 환경에서 mock 없이 단위 테스트(mobile-pure-core-test-seam).
// 디바이스 등록 요청 페이로드 조립 + 플랫폼 정규화의 순수 결정 로직만 담는다(실제 토큰 획득/REST 호출은
// register-device.ts 얇은 래퍼가 담당 — device-gated).
import { describe, it, expect } from "vitest";

import {
  buildRegisterDeviceBody,
  normalizePlatform,
  resolveUnregisterToken,
} from "./register-device-core";

describe("normalizePlatform (OS 문자열 → device_token.platform)", () => {
  it("android/ios 는 그대로 반환한다", () => {
    expect(normalizePlatform("android")).toBe("android");
    expect(normalizePlatform("ios")).toBe("ios");
  });

  it("그 외 OS(web/windows/macos 등)는 null (등록 비대상 — 네이티브 앱만 푸시)", () => {
    expect(normalizePlatform("web")).toBeNull();
    expect(normalizePlatform("windows")).toBeNull();
    expect(normalizePlatform("macos")).toBeNull();
    expect(normalizePlatform("")).toBeNull();
  });
});

describe("buildRegisterDeviceBody (POST /devices 요청 바디 조립)", () => {
  it("token + platform 으로 정확한 바디를 만든다", () => {
    expect(buildRegisterDeviceBody("tok-1", "ios")).toEqual({
      token: "tok-1",
      platform: "ios",
    });
  });

  it("token 이 빈 문자열이면 null (등록 불가 — 빈 토큰 전송 방지)", () => {
    expect(buildRegisterDeviceBody("", "ios")).toBeNull();
    expect(buildRegisterDeviceBody("   ", "android")).toBeNull();
  });

  it("platform 이 null/빈 값이면 null (정규화 실패한 OS)", () => {
    expect(buildRegisterDeviceBody("tok-1", null)).toBeNull();
    expect(buildRegisterDeviceBody("tok-1", "")).toBeNull();
  });

  it("token 은 trim 한다", () => {
    expect(buildRegisterDeviceBody("  tok-1  ", "android")).toEqual({
      token: "tok-1",
      platform: "android",
    });
  });
});

describe("resolveUnregisterToken (R-3: 로그아웃 해제 토큰 결정 — 재획득 비의존)", () => {
  it("명시 인자가 있으면 최우선으로 쓴다 (stored 무시)", () => {
    expect(resolveUnregisterToken("explicit-tok", "stored-tok")).toBe(
      "explicit-tok",
    );
  });

  it("명시 인자가 없으면 등록 시 저장한 토큰을 쓴다 (재획득하지 않음 — orphan 방지)", () => {
    expect(resolveUnregisterToken(undefined, "stored-tok")).toBe("stored-tok");
    expect(resolveUnregisterToken(null, "stored-tok")).toBe("stored-tok");
  });

  it("둘 다 없으면 null (no-op — 등록한 적 없는 디바이스)", () => {
    expect(resolveUnregisterToken(undefined, undefined)).toBeNull();
    expect(resolveUnregisterToken(null, null)).toBeNull();
    expect(resolveUnregisterToken("", "")).toBeNull();
  });

  it("공백뿐인 값은 미보유로 취급한다(trim)", () => {
    expect(resolveUnregisterToken("   ", "stored-tok")).toBe("stored-tok");
    expect(resolveUnregisterToken("  explicit  ", "stored-tok")).toBe("explicit");
  });
});
