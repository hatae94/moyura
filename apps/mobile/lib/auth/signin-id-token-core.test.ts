// signin-id-token-core 순수 분류기 단위 테스트 (SPEC-MOBILE-004 T-007, REQ-MOB4-001/002/005, AC-1/2/5/6b).
//
// classifyIdTokenSession 은 Supabase auth.signInWithIdToken({provider:'google', token}) 가
// resolve 한 AuthTokenResponse({ data:{user,session}, error }) 를 순수하게 분류한다 — 실제
// @supabase/supabase-js import 없이 가짜 응답 객체로 테스트한다(mobile-pure-core-test-seam).
//
// 보안(AC-6b): session 결과에는 access/refresh 만 싣고, error 결과의 reason 에는 토큰 값이나
// 자격증명을 절대 노출하지 않는다. 이 테스트는 토큰이 reason 으로 새지 않음을 명시 검증한다.
import { describe, it, expect } from "vitest";

import { classifyIdTokenSession } from "./signin-id-token-core";

describe("classifyIdTokenSession — Supabase signInWithIdToken 응답 분류 (T-007)", () => {
  // ── 성공: 세션 토큰 획득 (AC-1/2/5) ───────────────────────────────────────────
  it("error:null + session{access_token,refresh_token} → {kind:'session', tokens}", () => {
    const raw = {
      data: {
        user: { id: "u-1" },
        session: {
          access_token: "access-jwt-abc",
          refresh_token: "refresh-tok-xyz",
          expires_in: 3600,
        },
      },
      error: null,
    };
    const result = classifyIdTokenSession(raw);
    expect(result).toEqual({
      kind: "session",
      tokens: { access: "access-jwt-abc", refresh: "refresh-tok-xyz" },
    });
  });

  it("access/refresh 만 매핑하고 user/expires 등은 결과에 싣지 않는다(PII 최소화 — OD-4 일관)", () => {
    const raw = {
      data: {
        user: { id: "u-1", email: "secret@x.com" },
        session: { access_token: "a", refresh_token: "r", token_type: "bearer" },
      },
      error: null,
    };
    const result = classifyIdTokenSession(raw);
    expect(result).toEqual({ kind: "session", tokens: { access: "a", refresh: "r" } });
  });

  // ── 실패: signInWithIdToken 오류 (AC-6b) ──────────────────────────────────────
  it("error 가 존재(토큰 검증 실패) → {kind:'error'}", () => {
    const raw = {
      data: { user: null, session: null },
      error: { message: "Invalid token", code: "validation_failed", status: 400 },
    };
    const result = classifyIdTokenSession(raw);
    expect(result.kind).toBe("error");
  });

  it("error:null 이지만 session 이 null(세션 없음) → {kind:'error'} (세션 확립 불가)", () => {
    const result = classifyIdTokenSession({ data: { user: null, session: null }, error: null });
    expect(result.kind).toBe("error");
  });

  it("session 은 있으나 access_token 누락 → {kind:'error'}", () => {
    const raw = { data: { session: { refresh_token: "r" } }, error: null };
    expect(classifyIdTokenSession(raw).kind).toBe("error");
  });

  it("session 은 있으나 refresh_token 누락 → {kind:'error'}", () => {
    const raw = { data: { session: { access_token: "a" } }, error: null };
    expect(classifyIdTokenSession(raw).kind).toBe("error");
  });

  it("access_token 이 빈 문자열 → {kind:'error'}", () => {
    const raw = { data: { session: { access_token: "", refresh_token: "r" } }, error: null };
    expect(classifyIdTokenSession(raw).kind).toBe("error");
  });

  // ── 방어적 unknown 입력 ───────────────────────────────────────────────────────
  it.each([null, undefined, "str", 7, true, {}, { data: null }, []])(
    "malformed/unknown 응답(%o) → {kind:'error'} (throw 없음)",
    (raw) => {
      expect(classifyIdTokenSession(raw).kind).toBe("error");
    },
  );

  // ── 자격증명 비노출 (AC-6b — 핵심) ────────────────────────────────────────────
  it("error 결과 reason 에 access/refresh 토큰 값이 절대 포함되지 않는다(AC-6b)", () => {
    // 토큰 한쪽만 있어 error 가 되는 케이스 — reason 에 존재하는 토큰 값이 새면 안 된다.
    const raw = {
      data: { session: { access_token: "LEAK_ACCESS_123", refresh_token: "" } },
      error: null,
    };
    const result = classifyIdTokenSession(raw);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).not.toContain("LEAK_ACCESS_123");
    }
  });

  it("error.message 가 자격증명을 담고 있어도 reason 으로 그대로 흘리지 않는다(AC-6b)", () => {
    const raw = {
      data: { user: null, session: null },
      error: { message: "token=SENSITIVE_REFRESH_TOKEN rejected" },
    };
    const result = classifyIdTokenSession(raw);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).not.toContain("SENSITIVE_REFRESH_TOKEN");
    }
  });
});
