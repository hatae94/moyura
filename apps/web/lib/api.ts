// 웹 앱 API 클라이언트 배선 (SPEC-ENV-SETUP-001 R-A2 / R-E1 + SPEC-AUTH-001 R-D4).
//
// @moyura/api-client 의 타입드 클라이언트를 검증된 API_BASE_URL 로 구성한다.
// 이 공용 인스턴스는 토큰이 필요 없는 public 호출(/health 등)용이다 — getToken 미주입.
//
// 보호 라우트(/me)는 요청 스코프 세션의 access_token 을 Bearer 로 주입해야 하므로(R-D4),
// 해당 컨텍스트(app/me/page.tsx)에서 getToken 을 넣어 createApiClient 를 별도로 생성한다.
// 세션 토큰은 요청마다 다르고 서버 컴포넌트 스코프이므로 모듈 전역 인스턴스로 공유하지 않는다.
import { createApiClient, type ApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "./env";

/** 웹 앱 공용(미인증) API 클라이언트. baseUrl 은 NEXT_PUBLIC_API_BASE_URL 가드를 거친 값이다. */
export const apiClient: ApiClient = createApiClient({ baseUrl: API_BASE_URL });
