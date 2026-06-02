// 웹 앱 API 클라이언트 배선 (SPEC-ENV-SETUP-001 R-A2 / R-E1).
//
// @moyura/api-client 의 타입드 클라이언트를 검증된 API_BASE_URL 로 구성한다.
// 이 SPEC 범위는 인프라 배선이므로 라이브 백엔드 호출을 강제하지 않는다 —
// import 가 컴파일/번들되고 타입이 해석되는 것까지가 목표다.
import { createApiClient, type ApiClient } from "@moyura/api-client";

import { API_BASE_URL } from "./env";

/** 웹 앱 공용 API 클라이언트. baseUrl 은 NEXT_PUBLIC_API_BASE_URL 가드를 거친 값이다. */
export const apiClient: ApiClient = createApiClient({ baseUrl: API_BASE_URL });
