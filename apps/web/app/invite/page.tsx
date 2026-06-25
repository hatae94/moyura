// 통합 초대 링크 진입 페이지 (Client Component).
//
// 탐색 탭("초대 링크로 참여")과 로그인 화면("초대를 받으셨나요?")이 공유하는 단일 진입점이다. 두 진입
// 버튼이 모두 이 공개 경로(/invite)로 라우팅한다. 인증 가드가 없어 로그인 사용자(탐색 탭)·미로그인
// 게스트(로그인 화면) 모두 동일하게 동작한다 — 네이티브 WebView 안에서도 앱 내 라우팅이라 그대로 열린다.
//
// 흐름: 링크/토큰을 붙여넣으면 디바운스(~450ms) 후 공개 GET /invites/:token 으로 자동 검증한다. 유효로
// 확정될 때만 참여 버튼이 활성화되고(fail-closed — 비-valid 상태에서는 절대 활성화하지 않음), 어떤 모임에
// 참여하는지 모임 이름·멤버 수 미리보기 카드를 보여준다. 무효면 상태별 안내 메시지를 띄운다. 참여 버튼을
// 누르면 기존 수락 흐름(/invite/{token} → 익명 가입 → 닉네임 → accept)으로 라우팅한다 — 여기서 수락을
// 재구현하지 않는다.
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { extractInviteToken } from "@/lib/invite/token";
import { fetchInviteValidity, type InviteValidity } from "@/lib/invite/validity";

// 디바운스 지연(ms). 붙여넣기/타이핑이 멎고 이 시간이 지나야 검증을 시작한다 — 키 입력마다 호출하지 않는다.
const DEBOUNCE_MS = 450;

// 빈 입력으로 되돌아왔을 때 idle 전환 지연(ms). effect 본문에서 직접 setState 하지 않으려는 목적상 0 에 가까운
// 짧은 지연이면 충분하다(시퀀스 가드가 진행 중 검증은 이미 무효화하므로 버튼은 그 사이에도 비활성 유지).
const IDLE_RESET_MS = 0;

// 진입 페이지의 검증 상태. idle(입력 없음/비어 있음), checking(검증 중), valid(미리보기 동반),
// invalid(상태 코드 동반). valid 일 때만 참여 버튼을 활성화한다(fail-closed).
type ValidationState =
  | { kind: "idle" }
  | { kind: "checking"; token: string }
  | ({ kind: "valid"; token: string } & Extract<InviteValidity, { kind: "valid" }>)
  | { kind: "invalid"; status: number };

// 무효 상태 코드별 사용자 안내 메시지. 404 미지 / 410 만료·폐기 / 그 외(0 네트워크·5xx)는 일시 오류 안내.
function invalidMessage(status: number): string {
  if (status === 404) {
    return "존재하지 않는 초대 링크예요.";
  }
  if (status === 410) {
    return "만료되었거나 취소된 초대예요.";
  }
  return "초대를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.";
}

export default function InviteEntryPage() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, setState] = useState<ValidationState>({ kind: "idle" });

  // stale-response 경합 가드: 매 검증 시작 시 단조 증가하는 시퀀스를 발급하고, 가장 최근 발급분만
  // latestSeqRef 에 보관한다. 비동기 응답이 도착하면 자신이 캡처한 seq 가 여전히 최신인지 확인하고,
  // 아니면(더 새 입력이 들어와 새 검증이 시작됨) 결과를 버린다 — 느린 옛 응답이 최신 상태를 덮어쓰지 못한다.
  const latestSeqRef = useRef(0);

  const runValidation = useCallback(async (token: string) => {
    const seq = ++latestSeqRef.current;
    setState({ kind: "checking", token });
    try {
      // 공개(비인증) 엔드포인트라 토큰 주입 없이 클라이언트에서 직접 호출한다. fetchInviteValidity 는
      // 내부에서 모든 실패를 fail-closed invalid 로 변환하므로 여기서는 throw 가 거의 없지만, 만약을 대비해
      // catch 로 일시 오류(status 0) 처리한다.
      const api = createApiClient({ baseUrl: API_BASE_URL });
      const result = await fetchInviteValidity(api, token);
      // 응답이 도착했을 때 더 새로운 검증이 시작됐다면 이 결과는 폐기한다(stale 방지).
      if (seq !== latestSeqRef.current) {
        return;
      }
      if (result.kind === "valid") {
        setState({
          kind: "valid",
          token,
          moimId: result.moimId,
          name: result.name,
          memberCount: result.memberCount,
          maxMembers: result.maxMembers,
        });
      } else {
        setState({ kind: "invalid", status: result.status });
      }
    } catch {
      if (seq !== latestSeqRef.current) {
        return;
      }
      // 예기치 못한 오류도 fail-closed: 일시 오류로 안내(참여 버튼 비활성 유지).
      setState({ kind: "invalid", status: 0 });
    }
  }, []);

  // 디바운스된 라이브 검증. 입력이 바뀔 때마다 타이머를 재설정하고, 타이머 콜백(external system — effect 본문이
  // 아님)에서 토큰을 추출해 검증하거나 빈 입력이면 idle 로 되돌린다. 새 입력이 들어오면 타이머 클린업으로 이전
  // 타이머를 취소하고, 비동기 응답은 latestSeqRef 시퀀스 가드로 폐기되므로 둘이 함께 stale 결과를 막는다.
  // 빈 입력 전환에는 짧은 지연(IDLE_RESET_MS)을 둔다 — effect 본문에서 직접 setState 하지 않기 위함이며,
  // 진행 중이던 검증 결과는 시퀀스 증가로 곧장 무효화된다(버튼은 그 사이에도 valid 가 아니라 비활성 유지).
  useEffect(() => {
    const token = extractInviteToken(value);
    if (!token) {
      // 진행 중 검증 결과를 즉시 무효화(시퀀스 증가)하고, idle 전환은 타이머 콜백에서 수행한다.
      latestSeqRef.current++;
      const timer = setTimeout(() => setState({ kind: "idle" }), IDLE_RESET_MS);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => {
      void runValidation(token);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, runValidation]);

  const isValid = state.kind === "valid";
  const isChecking = state.kind === "checking";

  function handleJoin() {
    if (state.kind !== "valid") {
      return; // fail-closed: 유효 확정이 아니면 라우팅하지 않는다.
    }
    router.push(`/invite/${encodeURIComponent(state.token)}`);
  }

  return (
    // 공개 standalone 페이지(login/invite-token 과 동일 계열) — root layout 의 min-h-dvh body 안에서 flex-1
    // 로 뷰포트를 채워 수직 중앙 정렬한다. 문서 스크롤 모델과 일치(고정 높이 % 의존 회피).
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-10">
      <div className="flex w-full max-w-sm flex-col gap-5">
        {/* 헤딩 + 안내 */}
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-extrabold text-foreground">
            초대 링크로 참여
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            받은 초대 링크나 토큰을 붙여넣으면 어떤 모임인지 확인하고 바로 참여할 수
            있어요.
          </p>
        </div>

        {/* 입력 — 입력값이 바뀌면 디바운스 후 자동 검증된다. */}
        <div className="flex flex-col gap-2">
          <label htmlFor="invite-entry-input" className="sr-only">
            초대 링크 또는 토큰
          </label>
          <input
            id="invite-entry-input"
            type="text"
            inputMode="url"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="초대 링크 또는 토큰을 붙여넣어 주세요"
            aria-label="초대 링크"
            aria-invalid={state.kind === "invalid"}
            className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary"
          />
          {/* 검증 중 표시(미묘) */}
          {isChecking ? (
            <p className="text-xs text-muted-foreground" aria-live="polite">
              확인 중…
            </p>
          ) : null}
          {/* 무효 안내 — 상태별 메시지 */}
          {state.kind === "invalid" ? (
            <p role="alert" className="text-sm text-destructive">
              {invalidMessage(state.status)}
            </p>
          ) : null}
        </div>

        {/* 유효 미리보기 카드 — 어떤 모임에 참여하는지 이름·멤버 수로 안내(앱 시맨틱 토큰). */}
        {state.kind === "valid" ? (
          <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 text-card-foreground">
            <span className="text-base font-bold text-foreground">
              {state.name}
            </span>
            <span className="text-sm text-muted-foreground">
              멤버 {state.memberCount} / {state.maxMembers}명
            </span>
          </div>
        ) : null}

        {/* 참여 버튼 — 유효 확정 시에만 활성화(fail-closed). 누르면 기존 수락 흐름으로 라우팅. */}
        <button
          type="button"
          onClick={handleJoin}
          disabled={!isValid}
          className="w-full rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          링크로 참여하기
        </button>

        {/* 뒤로(보조) — 정상 로그인/탐색과 경쟁하지 않는 보조 링크. */}
        <Link
          href="/"
          className="text-center text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          돌아가기
        </Link>
      </div>
    </main>
  );
}
