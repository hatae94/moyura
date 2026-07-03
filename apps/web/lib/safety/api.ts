// 신고·차단 API 헬퍼 (SPEC-SAFETY-001 T-009).
//
// lib/moim/polls.ts·members.ts 의 구체-경로 헬퍼 패턴을 미러한다(api.request(path as never)).
// safety 라우트(/reports·/blocks)는 openapi/api-client schema 재생성(T-010) 전이라 타입 표면에 없으므로,
// 기존 헬퍼들과 동일하게 `path as never` 캐스팅으로 호출한다(런타임 경로만 필요 — schema 타입 키 불요).
// 백엔드 인가는 WHERE 내장(reporterId==sub / blockerId==sub)이라 body 의 어떤 userId 필드도 신뢰되지 않는다.
import { type ApiClient } from "@moyura/api-client";

// POST /reports 바디(CreateReportDto 미러 — reporterId 필드 없음: 신고자는 백엔드가 검증 sub 로 강제).
// contentType 은 단일 PK 4종(chat_message/poll/expense/settlement_request)만 허용 — v1 웹 진입점은 chat_message.
export interface ReportInput {
  targetUserId: string;
  moimId: string;
  reason: string;
  contentType: "chat_message" | "poll" | "expense" | "settlement_request";
  contentId: string;
}

// GET /blocks 응답 항목(BlockResponseDto 미러). blockedUserId 는 sub(전역 차단 — 모임 무관).
// 닉네임은 포함되지 않는다(차단은 userId 매칭이며 프로필/모임 표시 이름과 분리 — REQ-BLK-003).
export interface BlockItem {
  blockerId: string;
  blockedUserId: string;
  createdAt: string;
}

/** GET /blocks 응답(BlockListResponseDto 미러 — block 행만, 신고 기반 숨김은 미포함). */
interface BlockListResponse {
  items: BlockItem[];
}

/**
 * UGC 를 신고한다(POST /reports). report 행만 생성하며 block 은 만들지 않는다(신고 ≠ 차단 — REQ-RPT-002).
 * content_type 화이트리스트 외·빈 reason 은 백엔드가 400(ApiError 전파). 201 로 저장된 report 를 반환한다.
 */
export async function createReport(
  api: ApiClient,
  input: ReportInput,
): Promise<void> {
  await api.request("/reports" as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/**
 * 특정 사용자를 차단한다(POST /blocks, 멱등 — 이미 차단됐어도 성공). 차단자는 백엔드가 검증 sub 로 강제하므로
 * body 는 blockedUserId 만 보낸다. 자기 차단은 백엔드가 400(ApiError 전파). 차단은 전역(모임 무관).
 */
export async function createBlock(
  api: ApiClient,
  blockedUserId: string,
): Promise<void> {
  await api.request("/blocks" as never, "post", {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blockedUserId }),
  });
}

/**
 * 차단을 해제한다(DELETE /blocks/:blockedUserId, 멱등 — 없는 행도 성공). block 행만 삭제하며 report 기반
 * 숨김은 되살아나지 않는다(해제 ≠ 신고 취소 — REQ-BLK-002). blockerId=검증 sub 로 남의 차단은 지울 수 없다.
 */
export async function unblock(
  api: ApiClient,
  blockedUserId: string,
): Promise<void> {
  await api.request(
    `/blocks/${encodeURIComponent(blockedUserId)}` as never,
    "delete",
  );
}

/**
 * 내(sub)가 차단한 목록을 조회한다(GET /blocks). block 행만 반환하며 신고 기반 숨김은 포함하지 않는다
 * (REQ-BLK-004 — 프로필 "차단한 멤버" 섹션은 명시적 차단만 노출). 인가는 백엔드가 blockerId==sub 로 강제.
 */
export async function listBlocks(api: ApiClient): Promise<BlockItem[]> {
  const result = (await api.request(
    "/blocks" as never,
    "get",
  )) as BlockListResponse;
  return result.items;
}
