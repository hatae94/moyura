// google-signin-core 순수 분류기 단위 테스트 (SPEC-MOBILE-004 T-006, REQ-MOB4-001/005, AC-1/2/6a).
//
// classifyGoogleSignInResult 는 expo/RN 의 GoogleSignin.signIn() 이 resolve 한 응답(또는 throw 한
// 에러)을 순수하게 분류한다 — 네이티브 모듈 mock 없이 vitest node 환경에서 테스트한다
// (mobile-pure-core-test-seam, oauth.ts OAuthLaunchResult 분류 패턴과 동일).
//
// 보안: 분류 결과나 reason 에 idToken 값을 절대 노출하지 않는다(AC-6b 연계). 이 테스트는 토큰 값이
// reason 으로 새지 않음을 명시 검증한다.
import { describe, it, expect } from "vitest";

import { classifyGoogleSignInResult } from "./google-signin-core";

describe("classifyGoogleSignInResult — Google Original API signIn() 응답 분류 (T-006)", () => {
  // ── 성공: idToken 획득 (AC-1/AC-2) ────────────────────────────────────────────
  it("type:'success' + data.idToken 비어있지 않은 문자열 → {kind:'idToken', token}", () => {
    const raw = {
      type: "success",
      data: { idToken: "eyJhbGciOi.JWT.IDTOKEN", user: { id: "g-1", email: "a@b.com" } },
    };
    const result = classifyGoogleSignInResult(raw);
    expect(result).toEqual({ kind: "idToken", token: "eyJhbGciOi.JWT.IDTOKEN" });
  });

  it("idToken 만 분류하고 user/scopes 등 다른 PII 는 결과에 싣지 않는다(PII 최소화)", () => {
    const raw = {
      type: "success",
      data: { idToken: "tok-abc", user: { email: "secret@x.com" }, scopes: ["email"] },
    };
    const result = classifyGoogleSignInResult(raw);
    expect(result).toEqual({ kind: "idToken", token: "tok-abc" });
  });

  // ── 취소 (AC-6a) ──────────────────────────────────────────────────────────────
  it("type:'cancelled' (resolve 형태) → {kind:'cancelled'}", () => {
    const result = classifyGoogleSignInResult({ type: "cancelled", data: null });
    expect(result).toEqual({ kind: "cancelled" });
  });

  it("throw 된 취소 에러(code: 'SIGN_IN_CANCELLED') → {kind:'cancelled'}", () => {
    const result = classifyGoogleSignInResult({ code: "SIGN_IN_CANCELLED", message: "cancelled" });
    expect(result).toEqual({ kind: "cancelled" });
  });

  it("type:'noSavedCredentialFound' → {kind:'cancelled'} (토큰 없음 — 미인증 유지, 에러 노이즈 아님)", () => {
    const result = classifyGoogleSignInResult({ type: "noSavedCredentialFound", data: null });
    expect(result).toEqual({ kind: "cancelled" });
  });

  // ── 에러 (AC-6b decision 측 — idToken 없이 진행 불가) ──────────────────────────
  it("type:'success' 인데 idToken 누락 → {kind:'error'} (idToken 없이 진행 불가)", () => {
    const result = classifyGoogleSignInResult({ type: "success", data: { user: { id: "x" } } });
    expect(result.kind).toBe("error");
  });

  it("type:'success' 인데 idToken 이 빈 문자열 → {kind:'error'}", () => {
    const result = classifyGoogleSignInResult({ type: "success", data: { idToken: "" } });
    expect(result.kind).toBe("error");
  });

  it("type:'success' 인데 idToken 이 non-string → {kind:'error'}", () => {
    const result = classifyGoogleSignInResult({ type: "success", data: { idToken: 12345 } });
    expect(result.kind).toBe("error");
  });

  it("throw 된 비취소 에러(code: 'PLAY_SERVICES_NOT_AVAILABLE') → {kind:'error'}", () => {
    const result = classifyGoogleSignInResult({ code: "PLAY_SERVICES_NOT_AVAILABLE" });
    expect(result.kind).toBe("error");
  });

  it("throw 된 진행 중 에러(code: 'IN_PROGRESS') → {kind:'error'}", () => {
    const result = classifyGoogleSignInResult({ code: "IN_PROGRESS" });
    expect(result.kind).toBe("error");
  });

  // ── 방어적 unknown 입력 (parseBridgeMessage 스타일) ────────────────────────────
  it.each([null, undefined, "string", 42, true, {}, { type: "weird" }, []])(
    "malformed/unknown 입력(%o) → {kind:'error'} (throw 없음)",
    (raw) => {
      const result = classifyGoogleSignInResult(raw);
      expect(result.kind).toBe("error");
    },
  );

  // ── 자격증명 비노출 (AC-6b) ───────────────────────────────────────────────────
  it("error 결과의 reason 에 idToken 값이 절대 포함되지 않는다(자격증명 비노출 — AC-6b)", () => {
    // 토큰이 들어왔지만 다른 이유로 에러가 되는 케이스를 가정해도 reason 에 토큰이 새면 안 된다.
    const leakyish = { type: "success", data: { idToken: 999, leakedSecret: "SUPER_SECRET_TOKEN" } };
    const result = classifyGoogleSignInResult(leakyish);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).not.toContain("SUPER_SECRET_TOKEN");
      expect(result.reason).not.toContain("999");
    }
  });
});
