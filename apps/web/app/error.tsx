"use client";

// 전역 에러 경계 (App Router error.tsx) — 하위 layout·page 의 렌더/서버 예외를 잡아 재시도 UI 로 전환한다.
//
// 도입 배경(SSR 무한 로딩 근인 차단): 모임 상세 등 Server Component 가 requireNamedSession(GET /me) +
// 모임 fetch 를 블로킹하는데, api-client 에 타임아웃이 없어 콜드 백엔드/네트워크 지연 시 영구 pending →
// 로딩 UI 가 멈춘 채 무한 회전했다. 이제 api-client 가 ApiTimeoutError 로 요청을 끊고(무한 대기 제거),
// requireNamedSession/상세 page 가 이 일시적 실패를 /login·404 로 오처리하지 않고 여기로 승격시킨다 →
// 사용자는 갇히지 않고 "다시 시도"로 재렌더(재fetch)한다. reset() 은 에러 세그먼트를 다시 렌더링해
// 서버 컴포넌트를 재실행하므로, 백엔드가 warm 되면 그대로 복구된다.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // 에러 원인은 서버 로그로만 보존한다(사용자에게는 상세를 노출하지 않는다 — 토큰/내부 상세 비노출).
    console.error("[app/error] 렌더 실패 — 재시도 UI 표시:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-background px-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-brand text-3xl font-extrabold text-white shadow-md shadow-primary/20">
          !
        </span>
        <h1 className="text-lg font-extrabold tracking-tight text-foreground">
          일시적인 문제가 발생했어요
        </h1>
        <p className="max-w-xs text-sm text-muted-foreground">
          네트워크 또는 서버 지연으로 화면을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2.5">
        {/* 다시 시도 — 에러 세그먼트를 재렌더링해 서버 컴포넌트(및 fetch)를 재실행한다. */}
        <button
          type="button"
          onClick={() => reset()}
          className="w-full rounded-2xl bg-gradient-brand px-5 py-3.5 text-base font-bold text-white shadow-md shadow-primary/20 active:scale-[0.98]"
        >
          다시 시도
        </button>
        {/* 재시도로도 복구되지 않을 때의 탈출구 — 홈으로 이동. */}
        <button
          type="button"
          onClick={() => router.push("/home")}
          className="w-full rounded-2xl border border-border/60 px-5 py-3.5 text-base font-semibold text-muted-foreground active:scale-[0.98]"
        >
          홈으로
        </button>
      </div>
    </div>
  );
}
