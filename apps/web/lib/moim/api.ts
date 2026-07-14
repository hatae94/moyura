// 모임 상세/멤버 조회 헬퍼 (SPEC-MOIM-003 REQ-MOIM3-002/006).
//
// api-client.request 는 path 를 baseUrl 뒤에 그대로 연결하므로(템플릿 치환 없음 — verified), 여기서
// moimId 를 인코딩해 구체 경로를 만든다(chat/api.ts 와 동일 패턴). 타입 키와 런타임 경로가 달라 캐스팅이
// 필요하다. 목록(GET /moims)은 api-client 의 listMoims() 편의 메서드를 쓴다 — 여기는 path 파라미터가 있는
// 상세/멤버 조회만 담는다. chat 모듈 의존을 피해 독립 헬퍼로 둔다(상세는 chat realtime 비의존 — Exclusions).
import { ApiError, type ApiClient } from "@moyura/api-client";

import { type PollWithResults } from "./polls";
import { type ScheduleResponse } from "@/lib/schedule/api";

// 백엔드 MoimResponseDto — SPEC-MOIM-004 로 startsAt/location(이벤트 일정/장소)이 additive 추가됐다.
export interface MoimDetail {
  id: string;
  name: string;
  // SPEC-MOIM-004 REQ-MOIM4-003: 이벤트 일정(ISO-8601) 또는 null(일정 미정), 장소 또는 null.
  startsAt: string | null;
  location: string | null;
  createdBy: string;
  createdAt: string;
  // 최대 인원 정원(기본 15). 백엔드 MoimResponseDto 에 포함된다.
  maxMembers: number;
}

// 멤버 목록 항목(MemberResponseDto) — nickname + role(owner/member) 표시에 쓴다.
export interface MoimMember {
  userId: string;
  nickname: string;
  role: string;
  joinedAt: string;
}

/**
 * 모임 상세를 조회한다(GET /moims/:id). 비멤버는 백엔드가 403, 미존재는 404 를 반환하며 ApiError 로 전파한다
 * (인가를 약화시키지 않는다 — REQ-MOIM3-005). 호출부가 status 로 안전 처리(notFound/안내)한다.
 */
export async function getMoim(api: ApiClient, moimId: string): Promise<MoimDetail> {
  const path = `/moims/${encodeURIComponent(moimId)}`;
  return (await api.request(path as never, "get")) as MoimDetail;
}

/**
 * 모임 멤버 목록을 조회한다(GET /moims/:id/members). 멤버 nickname + role 출처.
 * 비멤버/미존재는 getMoim 과 동일하게 백엔드 인가가 ApiError(403/404)로 전파한다.
 */
export async function getMoimMembers(
  api: ApiClient,
  moimId: string,
): Promise<MoimMember[]> {
  const path = `/moims/${encodeURIComponent(moimId)}/members`;
  return (await api.request(path as never, "get")) as MoimMember[];
}

/**
 * GET /moims/:id/detail 집계 응답 번들(SPEC-MOIM-DETAIL-001). 개별 4개 엔드포인트
 * (moim/members/polls/schedule)를 백엔드 서버측에서 1회로 합친 형태다. 각 필드는 개별 엔드포인트와
 * byte-identical 하다(형태 드리프트 금지 — 백엔드가 동일 매퍼 재사용).
 */
export interface MoimDetailBundle {
  moim: MoimDetail;
  members: MoimMember[];
  polls: PollWithResults[];
  /** GET /moims/:id/schedule 의 body 형태({ schedule }) 그대로. schedule.schedule 이 null 이면 미설정. */
  schedule: ScheduleResponse;
}

/**
 * 모임 상세를 집계 엔드포인트로 1회에 조회한다(GET /moims/:id/detail, SPEC-MOIM-DETAIL-001).
 * 웹 SSR 의 4개 병렬 백엔드 호출(getMoim/getMoimMembers/listPolls/getSchedule)을 백엔드 1콜로 대체해
 * Vercel→백엔드 네트워크 왕복을 1개로 줄인다(백엔드가 DB fan-out 을 로컬에서 수행). 인가·오류 시맨틱은
 * 개별 엔드포인트와 동일 — 비멤버 403 / 미존재 404 를 ApiError 로 전파한다(호출부가 moimErrorStatus 로 분기).
 * atomic: 집계 내부 조회 실패는 전체를 500 으로 전파한다(개별 그레이스풀 디그레이드 아님 — 로컬 DB 조회라
 * 독립 네트워크 콜보다 실패가 드물다). 호출부는 일시 실패를 에러 경계(app/error.tsx)로 승격한다.
 */
export async function getMoimDetail(
  api: ApiClient,
  moimId: string,
): Promise<MoimDetailBundle> {
  const path = `/moims/${encodeURIComponent(moimId)}/detail`;
  return (await api.request(path as never, "get")) as MoimDetailBundle;
}

/** 모임 상세 조회 실패를 status 로 분류한다(403 비멤버 / 404 미존재 분기 — 토큰/오류 상세 비노출, REQ-MOIM3-005). */
export function moimErrorStatus(err: unknown): number {
  return err instanceof ApiError ? err.status : 0;
}

/**
 * 이벤트 일정을 한국어로 정직 표시한다(SPEC-MOIM-004 REQ-MOIM4-006). 서버/클라이언트 컴포넌트가 공유한다.
 * - startsAt 이 null/빈 값/무효 → "일정 미정"(허위 값 금지).
 * - 유효 ISO → "YYYY년 M월 D일 오전/오후 H:MM" 형식.
 */
export function formatMoimSchedule(startsAt: string | null): string {
  if (!startsAt) {
    return "일정 미정";
  }
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    return "일정 미정";
  }
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
