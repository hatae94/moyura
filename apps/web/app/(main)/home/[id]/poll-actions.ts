// 모임 투표 생성/투표 Server Action (SPEC-MOIM-005 REQ-MOIM5-006 / AC-5).
//
// moims/new/actions.ts(createMoimAction) 의 useActionState + Server Action 패턴을 구조적으로 미러한다:
//   - 빈 question/유효 옵션<2 → 폼에 머무르며 일반화된 오류 반환(poll 미생성).
//   - 세션 부재(만료) → /login 리다이렉트(보호 경로 미진입).
//   - 백엔드 오류(400/네트워크) → 폼/화면 머무름 + 일반화된 오류(토큰/오류 상세 비노출 — R-A9).
//   - 성공 → revalidatePath 로 상세를 재검증해 결과가 갱신되게 한다(라이브 푸시 아님 — Realtime 비범위).
//
// 디자인 토큰은 onboarding(blue) 이 아닌 Meetup 오렌지를 폼에서 쓴다(polls-section.tsx). 결과 갱신은
// revalidatePath("/home/{id}") 로 상세 Server Component 를 재렌더해 polls fetch 를 다시 돌린다.
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, createApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createPoll, votePoll } from "@/lib/moim/polls";
import { createClient } from "@/lib/supabase/server";

/** 투표 생성 결과 상태(useActionState 로 소비 — 에러 시 폼에 머무른다). */
export type CreatePollActionState = { error?: string } | undefined;

/** 투표(vote) 결과 상태(클라이언트가 실패 시 일반화 오류를 표시). */
export type VoteActionState = { error?: string } | undefined;

const CREATE_GENERIC_ERROR = "투표를 만들지 못했습니다. 다시 시도해 주세요.";
const VOTE_GENERIC_ERROR = "투표하지 못했습니다. 다시 시도해 주세요.";

/** 쿠키 세션을 읽어 access_token 을 돌려준다. 세션 부재면 /login 리다이렉트(보호 경로 미진입). */
async function requireToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    redirect("/login");
  }
  return session.access_token;
}

/**
 * 투표를 생성한다. question + 동적 옵션 입력(option[]) 을 FormData 에서 읽어 검증한 뒤 백엔드 POST 한다.
 * 성공 시 상세(/home/{id})를 revalidatePath 로 재검증해 새 투표가 목록에 나타나게 한다.
 */
export async function createPollAction(
  _prev: CreatePollActionState,
  formData: FormData,
): Promise<CreatePollActionState> {
  const moimId = String(formData.get("moimId") ?? "").trim();
  const question = String(formData.get("question") ?? "").trim();
  // 동적 옵션 입력은 name="option" 으로 여러 개 제출된다 — trim 후 비지 않은 항목만 모은다.
  const options = formData
    .getAll("option")
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0);

  if (!moimId) {
    // moimId 는 hidden 필드로 항상 동봉되지만, 누락 시 안전하게 일반화 오류로 처리한다.
    return { error: CREATE_GENERIC_ERROR };
  }
  if (!question || options.length < 2) {
    // AC-5 Unwanted: 빈 질문/유효 옵션<2 → 머무르며 일반화된 오류 표시(재제출 가능, /login 이동 없음).
    return { error: "질문과 선택지 2개 이상을 입력해 주세요." };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await createPoll(api, moimId, { question, options });
  } catch (err) {
    // AC-5 Unwanted: 백엔드 생성 실패 → 머무르며 일반화된 오류(토큰/상세 비노출 — R-A9). 재제출 가능.
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`createPollAction: POST polls 실패 (status ${status})`);
    return { error: CREATE_GENERIC_ERROR };
  }

  // 성공: 상세를 재검증해 새 투표가 목록에 나타나게 한다(라이브 푸시 아님 — revalidatePath).
  revalidatePath(`/home/${moimId}`);
  return undefined;
}

/**
 * 한 선택지에 투표한다(클라이언트 onClick 에서 호출). 단일 선택 — 재투표 시 백엔드가 표를 교체한다.
 * 성공 시 상세를 revalidatePath 로 재검증해 득표 수·내 표 강조가 갱신되게 한다.
 */
export async function voteAction(
  moimId: string,
  pollId: string,
  optionId: string,
): Promise<VoteActionState> {
  if (!moimId || !pollId || !optionId) {
    return { error: VOTE_GENERIC_ERROR };
  }

  const token = await requireToken();

  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => token,
    });
    await votePoll(api, moimId, pollId, optionId);
  } catch (err) {
    // 백엔드 투표 실패(400/403/404/네트워크) → 일반화된 오류(토큰/상세 비노출). 화면 머무름.
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`voteAction: POST vote 실패 (status ${status})`);
    return { error: VOTE_GENERIC_ERROR };
  }

  // 성공: 상세를 재검증해 득표 수/내 표 강조가 갱신되게 한다.
  revalidatePath(`/home/${moimId}`);
  return undefined;
}
