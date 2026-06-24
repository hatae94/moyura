// 초대 토큰 추출 헬퍼 (SPEC-MOIM-011 후속) — 탐색 탭/로그인 화면의 "링크로 참여" 입력이 공유한다.

/**
 * 입력에서 초대 토큰을 추출한다(순수). URL 의 `/invite/{token}` 세그먼트가 있으면 그 토큰을, 없으면 입력
 * 전체를 토큰으로 본다(raw 토큰 붙여넣기 허용). origin/scheme(https·moyura)은 무시하고 토큰만 취한다 —
 * 라우팅은 항상 현재 origin 기준이다. 공백/빈 입력은 null.
 *
 * @param raw 사용자가 붙여넣은 초대 링크 또는 토큰
 * @returns 추출된 토큰, 비어 있으면 null
 */
export function extractInviteToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/\/invite\/([^/?#\s]+)/);
  const token = match ? match[1] : trimmed;
  try {
    return decodeURIComponent(token);
  } catch {
    return token; // 잘못된 % 인코딩 — 원문 그대로 토큰으로 사용(백엔드가 404 로 거른다).
  }
}
