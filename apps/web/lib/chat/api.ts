// 채팅 API 헬퍼 (SPEC-CHAT-001 REQ-CHAT-006 / AC-5).
//
// api-client.request는 path를 baseUrl 뒤에 그대로 연결하므로(템플릿 치환 없음), 여기서 moimId/cursor를
// 인코딩해 구체 경로를 만든다(invite/accept.ts 패턴 동일). 타입 키와 런타임 경로가 달라 캐스팅이 필요하다.
import { ApiError, type ApiClient } from "@moyura/api-client";

// 백엔드 ChatMessageResponseDto(id는 BigInt PK의 문자열 표현, createdAt은 ISO-8601).
export interface ChatMessage {
  id: string;
  moimId: string;
  senderId: string;
  content: string;
  createdAt: string;
}

// keyset 히스토리 응답(내림차순 메시지 + 다음 커서).
export interface ChatHistoryPage {
  messages: ChatMessage[];
  nextCursor: string | null;
}

// 멤버 목록 항목(MemberResponseDto). senderId→nickname 해석에 쓴다.
export interface MoimMember {
  userId: string;
  nickname: string;
  role: string;
  joinedAt: string;
}

/** 모임 멤버 목록을 조회한다(senderId→nickname 매핑 출처). */
export async function loadMembers(
  api: ApiClient,
  moimId: string,
): Promise<MoimMember[]> {
  const path = `/moims/${encodeURIComponent(moimId)}/members`;
  return (await api.request(path as never, "get")) as MoimMember[];
}

/** keyset 히스토리를 조회한다(cursor 미지정 시 최신 페이지). */
export async function loadHistory(
  api: ApiClient,
  moimId: string,
  cursor?: string,
  limit = 30,
): Promise<ChatHistoryPage> {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("cursor", cursor);
  }
  params.set("limit", String(limit));
  const path = `/moims/${encodeURIComponent(moimId)}/messages?${params.toString()}`;
  return (await api.request(path as never, "get")) as ChatHistoryPage;
}

/** 메시지를 전송한다(성공 시 저장된 메시지 반환). */
export async function sendMessage(
  api: ApiClient,
  moimId: string,
  content: string,
): Promise<ChatMessage> {
  const path = `/moims/${encodeURIComponent(moimId)}/messages`;
  return (await api.request(path as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  })) as ChatMessage;
}

/** 채팅 API 호출 실패를 status로 분류한다(사용자 메시지 결정용 — 토큰 내용 비노출). */
export function chatErrorMessage(err: unknown): string {
  const status = err instanceof ApiError ? err.status : 0;
  switch (status) {
    case 400:
      return "메시지를 입력해주세요.";
    case 401:
      return "인증에 실패했습니다. 다시 로그인해주세요.";
    case 403:
      return "이 모임의 멤버만 채팅할 수 있습니다.";
    default:
      return "채팅 처리 중 오류가 발생했습니다.";
  }
}
