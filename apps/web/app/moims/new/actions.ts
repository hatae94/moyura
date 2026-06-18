// 모임 생성 Server Action (SPEC-MOIM-004 REQ-MOIM4-005 / AC-4).
//
// onboarding/actions.ts 의 useActionState + Server Action 패턴을 구조적으로 미러한다:
//   - 빈 name/nickname → 폼에 머무르며 일반화된 오류 반환(모임 미생성).
//   - 세션 부재(만료) → /login 리다이렉트(보호 경로 미진입).
//   - 백엔드 오류(400/네트워크) → 폼 머무름 + 일반화된 오류(토큰/오류 상세 비노출 — R-A9).
//   - 성공 → 새 모임 상세 /home/{id} 로 redirect(데스크톱 일반 라우팅 / 모바일 SPEC-MOIM-003 detail-push).
//
// datetime-local 값(타임존 없는 로컬 시각)은 new Date(value).toISOString() 으로 ISO-8601 변환한다(MVP — §5).
// 빈 값이면 미전송(백엔드가 null 저장). 디자인 토큰은 onboarding(blue) 이 아닌 Meetup 오렌지를 폼에서 쓴다.
"use server";

import { redirect } from "next/navigation";

import {
  ApiError,
  createApiClient,
  type CreateMoimRequest,
} from "@moyura/api-client";

import { API_BASE_URL } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** 모임 생성 결과 상태(useActionState 로 소비 — 에러 시 폼에 머무른다). */
export type CreateMoimActionState = { error?: string } | undefined;

const GENERIC_ERROR = "모임을 만들지 못했습니다. 다시 시도해 주세요.";

/**
 * datetime-local 입력을 ISO-8601 로 변환한다. 빈 값이면 undefined(미전송 → null 저장).
 * 무효 입력은 undefined 로 떨어뜨려 백엔드 400 방어선에 맡기지 않고 미전송으로 처리한다(MVP — datetime-local
 * 만 쓰므로 무효 입력은 드물다. API 직접 호출 시 무효 ISO 는 백엔드가 400 으로 차단한다 — AC-2).
 */
function toIsoOrUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

/**
 * 모임을 생성한다. 세션은 쿠키에서 읽어 Bearer 로 백엔드 POST /moims 에 전달한다(api-client createMoim).
 * 성공 시 생성된 모임 상세 /home/{id} 로 진입한다.
 */
export async function createMoimAction(
  _prev: CreateMoimActionState,
  formData: FormData,
): Promise<CreateMoimActionState> {
  const name = String(formData.get("name") ?? "").trim();
  const nickname = String(formData.get("nickname") ?? "").trim();
  if (!name || !nickname) {
    // AC-4 Unwanted: 빈 값 제출 → 머무르며 일반화된 오류 표시(재제출 가능, /login 이동 없음).
    return { error: "모임 이름과 호스트 표시 이름을 입력해 주세요." };
  }

  // optional 일정/장소 — 빈 값이면 미전송(백엔드가 null 저장).
  const startsAt = toIsoOrUndefined(String(formData.get("startsAt") ?? ""));
  const location = String(formData.get("location") ?? "").trim() || undefined;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // 세션 만료/부재 → 로그인으로 보낸다(보호 경로 미진입, 모임 미생성).
    redirect("/login");
  }

  let createdId: string;
  try {
    const api = createApiClient({
      baseUrl: API_BASE_URL,
      getToken: () => session.access_token,
    });
    const body: CreateMoimRequest = { name, nickname, startsAt, location };
    const moim = await api.createMoim(body);
    createdId = moim.id;
  } catch (err) {
    // AC-4 Unwanted: 백엔드 생성 실패 → 머무르며 일반화된 오류 표시(토큰/상세 비노출 — R-A9). 재제출 가능.
    const status = err instanceof ApiError ? err.status : "unknown";
    console.error(`createMoimAction: POST /moims 실패 (status ${status})`);
    return { error: GENERIC_ERROR };
  }

  // 성공: 생성된 모임 상세로 진입한다(모바일은 SPEC-MOIM-003 detail-push 가 처리).
  redirect(`/home/${createdId}`);
}
